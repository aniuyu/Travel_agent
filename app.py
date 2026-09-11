# 尝试用fastapi去写服务接口, 学习用
import json
import uuid
import asyncio
from typing import AsyncGenerator

import fastapi
from pydantic import BaseModel
from fastapi import WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from langchain_core.load import dumpd
from langchain_core.messages import AIMessageChunk, HumanMessage

# 用户数据库访问层（注册/登录）
from conn import user_db
# 行程规划器（高德 POI / wttr.in / 途牛 / 大模型）
from conn import trip_planner
# 行程分享存储（MySQL itinerary_share 表）
from conn import share_db

# 注意：`agent` 改为懒加载（见 websocket_chat 内部）。
# 原因：agent 初始化会触发 travily_search.get_tools() -> asyncio.run()，
#       而 uvicorn --reload 在 import 阶段处于事件循环上下文，直接 import 会报
#       "asyncio.run() cannot be called from a running event loop"。
#       注册/登录/分享接口不需要 agent，因此只在 /chat 真正连接时才加载。

# ===========================================================================
# 旅游助手集成说明（无需改动 agent 本体）
# ---------------------------------------------------------------------------
# `agent` 由 content/all_agent.py 的 AllAgent 组装，已经通过 `subagents` 参数
# 注册了 travel-agent（单点查询）与 itinerary-agent（完整行程规划），并为其挂载了：
#   - 工具（来自 content/mcps/travel_mcp.py + weather_mcp.py）：
#       · 途牛 MCP 实时数据（配置 TUNIU_API_KEY 后生效）：
#         hotel_search / hotel_detail（含酒店图片）、flight_search（实时票价）
#       · 无 Key 时自动降级为 Mock：search_flights / search_hotels / book_flight / book_hotel
#       · search_weather（wttr.in 真实天气）
#   - 技能（来自 skills/ 目录）：travel / flight_search / hotel_search / weather_search
#
# 因此，当用户在 /chat 里发送“帮我看看下周去北京的航班和酒店 / 查天气”时，
# 主代理会依据子代理 description 自动路由，子代理加载技能并调用工具返回结果。
#
# 启用实时数据：在 .env 中填入 TUNIU_API_KEY 即可（见 skills/travel/SKILL.md）。
# 若想临时关闭旅游助手，在 .env 里设置 USE_TRAVEL=false（见 base/config.py）。
# ===========================================================================

# ⚠️ 伪代码占位符：你需要替换成你项目里真实的 SQL 和 记忆管理 类
# sql_manager = ...
# menery_manager = ...


class Query(BaseModel):
    query: str
    session_id: str


# 启动时自动建库建表（幂等）。失败不阻断启动，只在日志告警——
# 避免 MySQL 未启动时整个服务挂掉，接口层面会返回友好错误。
@asynccontextmanager
async def lifespan(app: fastapi.FastAPI):
    try:
        user_db.init_db()
        share_db.ensure_table()
        print("[启动] 数据库初始化完成（Travel 库 + user 表 + itinerary_share 表）")
    except Exception as e:
        print(f"[警告] 数据库初始化失败（请确认 MySQL 已启动）：{e}")
    yield


app = fastapi.FastAPI(lifespan=lifespan)

# 跨域支持：前端 3000 访问后端 8000 必须加
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 用户注册 / 登录 / 退出 / 切换账号 接口
# ---------------------------------------------------------------------------
class RegisterBody(BaseModel):
    username: str
    password: str
    nickname: str | None = None


class LoginBody(BaseModel):
    username: str
    password: str


@app.post('/register')
def register(body: RegisterBody):
    """注册新用户。"""
    try:
        user = user_db.create_user(body.username, body.password, body.nickname)
        return {"status": "success", "data": user}
    except ValueError as e:
        return JSONResponse(status_code=409, content={"status": "error", "message": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": f"注册失败：{e}"})


@app.post('/login')
def login(body: LoginBody):
    """登录校验。成功返回用户信息（前端据此写本地登录态）。"""
    try:
        user = user_db.verify_user(body.username, body.password)
        if not user:
            return JSONResponse(status_code=401, content={"status": "error", "message": "用户名或密码错误"})
        return {"status": "success", "data": user}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": f"登录失败：{e}"})


@app.post('/logout')
def logout():
    """退出登录（无状态后端，前端清本地标记即可；这里提供占位便于未来扩展 token 黑名单）。"""
    return {"status": "success"}


@app.post('/switch_account')
def switch_account(body: LoginBody):
    """切换账号：即用另一个账号重新登录。返回新账号信息或错误。"""
    try:
        user = user_db.verify_user(body.username, body.password)
        if not user:
            return JSONResponse(status_code=401, content={"status": "error", "message": "用户名或密码错误"})
        return {"status": "success", "data": user}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": f"切换失败：{e}"})


# ---------------------------------------------------------------------------
# 行程分享接口（云端版分享链接）
# ---------------------------------------------------------------------------
class ShareCreateBody(BaseModel):
    title: str = ""
    payload: dict
    creator_id: int | None = None


@app.post('/share/create')
def share_create(body: ShareCreateBody):
    """
    创建一条行程分享，返回 share_id。
    前端访问路径：/share/{share_id}（前端路由）
    """
    try:
        sid = share_db.create_share(body.title, body.payload, body.creator_id)
        return {"status": "success", "data": {"share_id": sid}}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": f"分享创建失败：{e}"})


@app.get('/share/{share_id}')
def share_get(share_id: str):
    """读取分享内容（用于分享页渲染）。未找到或已过期返回 404。"""
    row = share_db.get_share(share_id)
    if not row:
        return JSONResponse(status_code=404, content={"status": "error", "message": "分享不存在或已过期"})
    return {"status": "success", "data": row}


# ---------------------------------------------------------------------------
# 行程保存到「我的行程」
# ---------------------------------------------------------------------------
class TripSaveBody(BaseModel):
    share_id: str  # 已经 /trip/plan 生成的 share_id
    creator_id: int  # 登录用户 id
    tier: str = "舒适档"  # 选中的档位


@app.post('/trip/save')
def trip_save(body: TripSaveBody):
    """
    把已生成的行程（share_id）绑定到当前用户，作为「我的行程」。
    实际是把 itinerary_share 表里该行的 creator_id 改成当前用户。
    """
    try:
        from conn.share_db import _connect
        conn = _connect()
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE itinerary_share SET creator_id = %s WHERE share_id = %s",
                (body.creator_id, body.share_id),
            )
            conn.commit()
            affected = cur.rowcount
        conn.close()
        if affected == 0:
            return JSONResponse(
                status_code=404,
                content={"status": "error", "message": "行程不存在或已被删除"},
            )
        return {"status": "success", "data": {"share_id": body.share_id, "tier": body.tier}}
    except Exception as e:
        return JSONResponse(
            status_code=500, content={"status": "error", "message": f"保存失败：{e}"}
        )


@app.get('/trips/mine')
def trips_mine(user_id: int, limit: int = 30):
    """返回当前用户的行程列表（按时间倒序）。"""
    try:
        rows = share_db.list_shares_by_creator(creator_id=user_id, limit=limit)
        return {"status": "success", "data": rows}
    except Exception as e:
        return JSONResponse(
            status_code=500, content={"status": "error", "message": f"读取失败：{e}"}
        )


@app.post('/trips/delete')
def trips_delete(share_id: str, user_id: int):
    """
    删除当前用户的某条行程（仅当 share_id 归属该用户时才删，避免误删他人分享）。
    前端调：POST /trips/delete?share_id=xxx&user_id=N
    """
    try:
        ok = share_db.delete_share(share_id=share_id, creator_id=user_id)
        if not ok:
            return JSONResponse(
                status_code=404,
                content={"status": "error", "message": "行程不存在或不属于当前用户"},
            )
        return {"status": "success", "data": {"share_id": share_id, "deleted": True}}
    except Exception as e:
        return JSONResponse(
            status_code=500, content={"status": "error", "message": f"删除失败：{e}"}
        )


# ---------------------------------------------------------------------------
# 酒店搜索（高德 POI type=住宿服务 + 城区下拉 + 详情）
# ---------------------------------------------------------------------------
@app.get('/hotels/search')
def hotels_search(city: str, district: str = "", limit: int = 10):
    """
    按城市搜酒店，可选 district（城区/商圈）筛选。
    """
    try:
        rows = trip_planner._search_hotel(city, district, offset=limit)
        # 加 stable id（前端 React key 用）
        for i, h in enumerate(rows):
            h["id"] = h.get("poi_id") or f"{city}-{district}-{i}"
        return {"status": "success", "data": rows}
    except Exception as e:
        return JSONResponse(
            status_code=500, content={"status": "error", "message": f"搜索失败：{e}"}
        )


@app.get('/hotels/detail')
def hotels_detail(poi_id: str):
    """拿酒店详情（评分/电话/营业时间/环境图/评价）。"""
    try:
        detail = trip_planner._get_poi_detail(poi_id)
        if not detail:
            return JSONResponse(
                status_code=404, content={"status": "error", "message": "未找到该酒店"}
            )
        return {"status": "success", "data": detail}
    except Exception as e:
        return JSONResponse(
            status_code=500, content={"status": "error", "message": f"详情失败：{e}"}
        )


@app.get('/districts')
def districts(city: str):
    """返回城市的所有城区/商圈列表（用于下拉选择）。"""
    try:
        rows = trip_planner._list_districts(city)
        return {"status": "success", "data": rows}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500, content={"status": "error", "message": f"读取城区失败：{e}"}
        )


@app.get('/hotels/photos')
def hotels_photos(name: str, city: str = ""):
    """
    按酒店名 + 城市，从高德 POI 匹配并返回该酒店的高清照片列表。
    用于「途牛给结构化数据 + 高德给图」的混合数据源。
    前端调：GET /hotels/photos?name=全季酒店（上海外滩金陵东路店）&city=上海
    """
    try:
        result = trip_planner._search_poi_photos(name, city)
        if not result:
            return JSONResponse(
                status_code=404, content={"status": "error", "message": "未匹配到该酒店的照片"}
            )
        return {"status": "success", "data": result}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500, content={"status": "error", "message": f"照片查询失败：{e}"}
        )


# ---------------------------------------------------------------------------
# AI 行程规划（调用真实工具：地理编码 + 天气 + 酒店/车票）
# ---------------------------------------------------------------------------
class TripPlanBody(BaseModel):
    destination: str
    from_city: str = ""
    days: str = "3天"
    budget: int = 5000
    pref: str = "自然风光"
    hotel_level: str = "舒适型"
    transport: str = "高铁"
    hotel_stars: int = 4
    dining_budget: str = "适中"
    depart_date: str = ""
    companion: str = "独旅"
    extra_notes: str = ""


@app.post('/trip/plan')
def trip_plan(body: TripPlanBody):
    """
    真实工具调用版行程生成：
      1. 高德地理编码 → 真实经纬度
      2. wttr.in → 真实天气
      3. 途牛酒店 / 车票（已有 tuniu_cli，调用失败时降级为 Mock）
    返回 3 档方案 + 行程数据
    """
    try:
        result = trip_planner.plan_trip(
            destination=body.destination,
            from_city=body.from_city,
            days=body.days,
            budget=body.budget,
            pref=body.pref,
            hotel_level=body.hotel_level,
            transport=body.transport,
            hotel_stars=body.hotel_stars,
            dining_budget=body.dining_budget,
            depart_date=body.depart_date,
            companion=body.companion,
            extra_notes=body.extra_notes,
        )
        # 同时存到 share_db，返回 share_id 供前端"选档"页用
        share_id = share_db.create_share(
            title=result["title"],
            payload=result,
            creator_id=None,
        )
        return {"status": "success", "data": {**result, "share_id": share_id}}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": f"行程生成失败：{e}"})


@app.get('/')
def hello_world():
    return 'Hello, World!'


@app.post('/new_thread')
def new_thread_id():
    thread_id = uuid.uuid4()
    # 在数据库thread表里新建一行数据
    # sql_manager.insert_thread(thread_id) # ← 这里需要补全真实逻辑
    return thread_id


@app.post('/switch_thread')
def switch_thread(thread_id: str):
    # 在数据库thread表里更新行数据
    # messages = menery_manager.get_history(thread_id)
    messages = []  # 伪代码占位
    # return 序列化的(messages)
    return json.dumps(messages)  # 注意不能直接用中文返回值，需要序列化


@app.post('/delete_thread')
def delete_thread(thread_id: str):
    # 删除数据库thread表里的数据
    # sql_manager.delete_thread(thread_id)
    # menery_manager.delete_history(thread_id)
    return {"status": "deleted"}

# 添加文件上传端点支持图片和文档处理
@app.post('/upload_file')
async def upload_file(file: UploadFile = File(...)):
    """上传文件用于图片解析或文档转换"""
    import os
    from pathlib import Path

    # 创建上传目录
    upload_dir = Path("uploads")
    upload_dir.mkdir(exist_ok=True)

    # 保存文件
    file_path = upload_dir / file.filename
    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)

    return {
        "status": "success",
        "file_path": str(file_path),
        "filename": file.filename
    }

@app.post('/parse_image')
async def parse_image(file_path: str):
    """解析图片内容"""
    try:
        from content.mytools import vlm_tool
        result = vlm_tool.read_image(file_path)
        return {"status": "success", "content": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post('/convert_document')
async def convert_document(file_path: str, output_format: str):
    """转换文档格式"""
    try:
        from content.mytools import write_doc_tools
        output_path = write_doc_tools.convert_file(file_path, output_format)
        return {"status": "success", "output_path": output_path}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post('/read_document')
async def read_document(file_path: str):
    """读取文档内容"""
    try:
        from content.mytools import read_doc_tools
        content = read_doc_tools.get_file_content(file_path)
        return {"status": "success", "content": content}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.websocket('/chat')
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    try:
        # 懒加载 agent：只在真正聊天时才导入，避免启动时因 asyncio 事件循环冲突崩溃
        from agent import agent
        while True:
            # 接收前端发送的消息
            data = await websocket.receive_text()
            query_data = json.loads(data)
            query = query_data.get('query', '')
            session_id = query_data.get('session_id', str(uuid.uuid4()))

            # 使用真实的 agent.astream 方法
            # 通过 config 传入 thread_id（即 session_id），
            # 一方面用于多会话隔离，另一方面供中间件（如 FileManagerMiddleware）
            # 和旅游子代理获取当前会话上下文。
            async for chunk in agent.astream(
                {"messages": [HumanMessage(content=query)]},
                stream_mode=["updates", "messages"],
                config={"configurable": {"thread_id": session_id}},
            ):
                if chunk[0] == 'updates':
                    # 处理更新消息
                    await websocket.send_text(json.dumps(dumpd(chunk[1])))
                elif chunk[0] == 'messages':
                    # 处理消息流
                    for message in chunk[1]:
                        if isinstance(message, AIMessageChunk) and message.content:
                            # 发送 token
                            await websocket.send_text(message.content)

            # 发送结束标记
            await websocket.send_text("[END]")

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error in websocket: {e}")
        await websocket.send_text(f"[ERROR] {str(e)}")


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host='127.0.0.1', port=8000)

#
# 尝试用fastapi去写服务接口, 学习用
#


# import json
# import uuid
# import os
# from pathlib import Path
#
# import fastapi
# from pydantic import BaseModel
# from fastapi import WebSocket, WebSocketDisconnect, UploadFile, File
# from fastapi.middleware.cors import CORSMiddleware
#
# from langchain_core.load import dumpd
# from langchain_core.messages import AIMessageChunk, HumanMessage
#
# # 不再导入全局的 agent，改为导入工具、模型和中间件
# from conn import llm
# import conn.llm as llm_module
# from content.mcps import excel_mcp
#
#
# class Query(BaseModel):
#     query: str
#     session_id: str
#
#
# app = fastapi.FastAPI()
#
# # 添加跨域支持 (前端3000访问后端8000/2024必须加这个)
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )
#
#
# # ================= 兼容前端的关键接口 =================
# @app.get('/threads/search')
# async def search_threads():
#     return []
#
#
# @app.get('/info')
# async def get_info():
#     return {"version": "v1.0.0", "agent": "FeiyunTong Agent"}
#
#
# # ======================================================
#
# @app.get('/')
# def hello_world():
#     return 'Hello, World!'
#
#
# @app.post('/new_thread')
# def new_thread_id():
#     return str(uuid.uuid4())
#
#
# @app.post('/switch_thread')
# def switch_thread(thread_id: str):
#     return json.dumps([])
#
#
# @app.post('/delete_thread')
# def delete_thread(thread_id: str):
#     return {"status": "deleted"}
#
#
# @app.post('/upload_file')
# async def upload_file(file: UploadFile = File(...)):
#     upload_dir = Path("uploads")
#     upload_dir.mkdir(exist_ok=True)
#     file_path = upload_dir / file.filename
#     with open(file_path, "wb") as buffer:
#         content = await file.read()
#         buffer.write(content)
#     return {"status": "success", "file_path": str(file_path), "filename": file.filename}
#
#
# @app.post('/parse_image')
# async def parse_image(file_path: str):
#     try:
#         from content.mytools import vlm_tool
#         result = vlm_tool.read_image(file_path)
#         return {"status": "success", "content": result}
#     except Exception as e:
#         return {"status": "error", "message": str(e)}
#
#
# @app.post('/convert_document')
# async def convert_document(file_path: str, output_format: str):
#     try:
#         from content.mytools import write_doc_tools
#         output_path = write_doc_tools.convert_file(file_path, output_format)
#         return {"status": "success", "output_path": output_path}
#     except Exception as e:
#         return {"status": "error", "message": str(e)}
#
#
# @app.post('/read_document')
# async def read_document(file_path: str):
#     try:
#         from content.mytools import read_doc_tools
#         content = read_doc_tools.get_file_content(file_path)
#         return {"status": "success", "content": content}
#     except Exception as e:
#         return {"status": "error", "message": str(e)}
#
#
# # ================= 核心：重构 Agent =================
# # 1. 获取 Excel 工具列表
# excel_tools = excel_mcp.get_tools()
#
#
# # 2. 绑定工具到大模型（禁止它自己写代码）
# def get_excel_llm():
#     # 强制提示词，切断它写 Python 的念头
#     system_prompt = """
# 你是一个Excel制作专家。你的唯一任务是使用提供的工具来创建、修改Excel。
# 绝对禁止自己编写Python代码生成Excel文件！
# 当用户要求制作Excel时，你可以：
# 1. 询问用户需要的表头和内容。
# 2. 使用提供的工具直接生成。
# """
#
#     agent_llm = llm_module.get_llm()
#     # 这里需要根据你的 llm 对象，添加 system_prompt
#     # 通常用 bind 或者包装一下
#     return llm.bind(system_prompt=system_prompt).bind_tools(excel_tools)
#
#
# # 3. 在 WebSocket 里使用绑定了工具的模型
# @app.websocket('/chat')
# async def websocket_chat(websocket: WebSocket):
#     await websocket.accept()
#     try:
#         while True:
#             data = await websocket.receive_text()
#             query_data = json.loads(data)
#             query = query_data.get('query', '')
#             session_id = query_data.get('session_id', str(uuid.uuid4()))
#
#             # 动态获取绑定工具的模型
#             agent_llm = get_excel_llm()
#
#             async for chunk in agent_llm.astream(
#                     [HumanMessage(content=query)],
#                     stream_mode=["updates", "messages"]
#             ):
#                 if chunk[0] == 'updates':
#                     await websocket.send_text(json.dumps(dumpd(chunk[1])))
#                 elif chunk[0] == 'messages':
#                     for message in chunk[1]:
#                         if isinstance(message, AIMessageChunk) and message.content:
#                             await websocket.send_text(message.content)
#
#             await websocket.send_text("[END]")
#
#     except WebSocketDisconnect:
#         print("Client disconnected")
#     except Exception as e:
#         print(f"Error in websocket: {e}")
#         await websocket.send_text(f"[ERROR] {str(e)}")
#
#
# if __name__ == '__main__':
#     import uvicorn
#
#     uvicorn.run(app, host='127.0.0.1', port=8000)
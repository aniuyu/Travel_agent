# 尝试用fastapi去写服务接口, 学习用
import json
import uuid
import asyncio
from typing import AsyncGenerator

import fastapi
from pydantic import BaseModel
from fastapi import WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
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
from conn import chat_db

# 注意：`agent` 改为懒加载（见 websocket_chat 内部）。
# 原因：agent 初始化会触发 travily_search.get_tools() -> asyncio.run()，
#       而 uvicorn --reload 在 import 阶段处于事件循环上下文，直接 import 会报
#       "asyncio.run() cannot be called from a running event loop"。
#       注册/登录/分享接口不需要 agent，因此只在 /chat 真正连接时才加载。
#
# 【重要】懒加载必须在「子线程」里做：
#   /chat 是 async 处理器，本身运行在 FastAPI 的事件循环里，直接 await 里 import
#   依然会触发 asyncio.run() 在运行中循环里报错。子线程没有运行中的事件循环，
#   因此用 asyncio.to_thread 包装导入即可；同时保留「启动快、首条消息才加载」的特性。
_agent = None
_agent_lock = asyncio.Lock()


def _load_agent():
    """在无事件循环的线程中导入 agent（模块级会调用 asyncio.run 加载 MCP 工具）。"""
    from agent import agent  # noqa: F401
    return agent


async def get_agent():
    """线程安全地懒加载并缓存 agent。"""
    global _agent
    if _agent is not None:
        return _agent
    async with _agent_lock:
        if _agent is None:
            print("[chat] 首次加载 agent（约 10s，加载 MCP 工具）…")
            _agent = await asyncio.to_thread(_load_agent)
            print("[chat] agent 加载完成")
    return _agent


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
        chat_db.ensure_table()
        print("[启动] 数据库初始化完成（Travel 库 + user 表 + itinerary_share 表 + chat_message 表）")
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
# 静态文件：把 /agent_files 挂载为 /files，让前端能直接渲染 AI 生成的图片
# ---------------------------------------------------------------------------
# 真实路径：base/config.py 的 ROOT_PATH_AGENT 默认是 D:\agent_files
# （不同机器/部署位置可能不同，下面这行做兼容：先取绝对路径，找不到再退回当前目录的 agent_files）
import os as _os
_AGENT_FILES_ROOT = _os.path.abspath("/agent_files")
if not _os.path.isdir(_AGENT_FILES_ROOT):
    _fallback = _os.path.join(_os.path.dirname(__file__), "agent_files")
    _os.makedirs(_fallback, exist_ok=True)
    _AGENT_FILES_ROOT = _fallback


@app.get("/files/list")
def list_agent_files(thread_id: str, subdir: str = ""):
    """列出 thread_id 下某子目录的文件名（前端图片加载失败时做兜底匹配）。"""
    if ".." in thread_id.replace("\\", "/").split("/"):
        return JSONResponse({"error": "bad path"}, status_code=400)
    base = _os.path.join(_AGENT_FILES_ROOT, thread_id)
    if not _os.path.isdir(base):
        return JSONResponse({"error": "no such thread", "files": []}, status_code=200)
    target = _os.path.join(base, subdir) if subdir else base
    if not _os.path.isdir(target):
        return JSONResponse({"error": "no such subdir", "files": []}, status_code=200)
    files = []
    for name in _os.listdir(target):
        full = _os.path.join(target, name)
        if _os.path.isfile(full):
            files.append({"name": name, "mtime": int(_os.path.getmtime(full))})
    # 按 mtime 倒序（最新的在前）
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return {"thread_id": thread_id, "subdir": subdir, "files": files}


@app.get("/files/{file_path:path}")
def serve_agent_file(file_path: str):
    """服务 agent_files 下的任意文件（图片、文档等）。
    前端 ChatDock 收到 AI 文本里的相对路径（generate_images/xxx.png），
    会自动补全成 http://localhost:8000/files/<thread_id>/<path>，从而拿到真实图片。
    """
    # 防穿越：禁止 ..
    if ".." in file_path.replace("\\", "/").split("/"):
        return JSONResponse({"error": "bad path"}, status_code=400)
    abs_path = _os.path.join(_AGENT_FILES_ROOT, file_path)
    if not _os.path.isfile(abs_path):
        return JSONResponse({"error": "not found", "path": file_path}, status_code=404)
    return FileResponse(abs_path)


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
# 对话历史（完整落库 + 查询 / 删除）
# ---------------------------------------------------------------------------
@app.get('/chat/history')
def chat_history(session_id: str, limit: int = 100):
    """按 session_id 拉取完整对话历史（正序）。"""
    try:
        rows = chat_db.get_history(session_id, limit)
        return {"status": "success", "data": rows}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": f"读取历史失败：{e}"})


@app.delete('/chat/history')
def chat_history_delete(session_id: str):
    """删除某个会话的全部历史。"""
    try:
        deleted = chat_db.delete_session(session_id)
        return {"status": "success", "data": {"deleted": deleted}}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "message": f"删除历史失败：{e}"})


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


@app.get('/poi/search')
def poi_search(city: str, keyword: str, limit: int = 8):
    """
    通用高德 POI 搜索。
    用于「租车门店」「保险公司网点」等非酒店/非景点场景。
    前端调：GET /poi/search?city=上海&keyword=汽车租赁&limit=8
    """
    try:
        n = max(1, min(int(limit), 20))
        rows = trip_planner._search_poi(city, keyword, offset=n)
        return {"status": "success", "data": rows}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            status_code=500, content={"status": "error", "message": f"POI 搜索失败：{e}"}
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
    # 用户明确选定的酒店名 / 车次号（新建行程前选定，创建后优先展示）
    selected_hotel: str = ""
    selected_ticket: str = ""
    # 选定时的完整信息（站点/时间/价格/星级等），用于生成更真实的展示数据
    selected_hotel_detail: dict | None = None
    selected_ticket_detail: dict | None = None


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
            selected_hotel=body.selected_hotel,
            selected_ticket=body.selected_ticket,
            selected_hotel_detail=body.selected_hotel_detail,
            selected_ticket_detail=body.selected_ticket_detail,
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


# ---------------------------------------------------------------------------
# 旅游保险建议（途牛没有保险服务，这里用 LLM 基于行程给常识性建议）
# ---------------------------------------------------------------------------
class InsuranceAdviceBody(BaseModel):
    destination: str = ""
    days: str = "3天"
    companion: str = "独旅"
    pref: str = ""


@app.post('/insurance/advice')
def insurance_advice(body: InsuranceAdviceBody):
    """
    基于行程生成旅游保险建议。
    注意：途牛开放平台**没有保险类接口**，这里输出的是常识性建议（非实时产品/报价）。
    """
    import json as _json
    import re as _re

    fallback = {
        "summary": "短途旅行建议优先配置意外险与医疗险，其余按行程特点取舍。",
        "items": [
            {"name": "旅游意外险", "reason": "覆盖旅途中的意外伤害，最基础必备", "priority": "高"},
            {"name": "旅游医疗保险", "reason": "异地就医费用高，医疗险可报销", "priority": "高"},
            {"name": "航班/列车延误险", "reason": "交通延误可获赔付", "priority": "中"},
            {"name": "行李丢失险", "reason": "行李延误或丢失时补偿", "priority": "中"},
            {"name": "紧急救援服务", "reason": "偏远地区或境外出行时的重要保障", "priority": "中"},
        ],
    }

    try:
        prompt = (
            "你是旅游保险顾问。请针对用户的行程，输出 JSON（不要任何多余文字）：\n"
            '{"summary":"一句话说明该行程最该关注的风险","items":['
            '{"name":"险种名称","reason":"为什么需要（20字内）","priority":"高/中/低"}]}\n'
            f"行程信息：目的地 {body.destination or '未指定'}，{body.days}，出行人群 {body.companion}，"
            f"偏好 {body.pref or '无'}。\n"
            "要求：\n"
            "- 给出 5-6 个具体险种，按该行程的实际风险从高到低排序；\n"
            "- 结合行程特点说明理由（如短途商务 vs 亲子游 vs 户外探险的风险不同）；\n"
            "- 只给常识性建议，不要编造具体产品名、保险公司或价格。"
        )
        raw = trip_planner._ai_summarize(prompt, timeout=90, max_tokens=600)
        if raw:
            m = _re.search(r"\{.*\}", raw, _re.DOTALL)
            if m:
                obj = _json.loads(m.group(0))
                if obj.get("items"):
                    return {
                        "status": "success",
                        "data": {
                            "summary": obj.get("summary") or fallback["summary"],
                            "items": obj["items"],
                            "source": "ai",
                        },
                    }
    except Exception:
        import traceback
        traceback.print_exc()

    return {"status": "success", "data": {**fallback, "source": "fallback"}}


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
    """
    对话 WebSocket。

    协议（客户端 → 服务端）：
      · { "query": "...", "session_id": "..." }   发起一轮对话
      · { "type": "stop" }                        终止当前正在生成的这一轮

    协议（服务端 → 客户端）：
      · 普通文本 token（流式增量）
      · updates JSON（LangGraph 节点/中间件状态）
      · "[END]"        正常结束
      · "[STOPPED]"    因客户端终止而结束
      · "[ERROR] xxx"  出错

    实现要点：用一个并发的 reader 任务专门收消息，
    这样在 `async for` 流式生成期间也能立刻收到 stop 信号并中断。
    """
    await websocket.accept()

    inbox: asyncio.Queue = asyncio.Queue()
    stop_event = asyncio.Event()

    async def reader():
        """并发读取客户端消息：查询入队；终止信号置位 stop_event。"""
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                except Exception:
                    msg = {"query": raw}
                if isinstance(msg, dict) and msg.get("type") == "stop":
                    stop_event.set()  # 立即中断当前生成
                else:
                    await inbox.put(msg)
        except WebSocketDisconnect:
            await inbox.put(None)
        except Exception as e:
            print(f"[chat] reader 结束: {e}")
            await inbox.put(None)

    reader_task = asyncio.create_task(reader())

    try:
        # 懒加载 agent（在子线程中导入，避免 asyncio.run 在运行中的事件循环里报错）
        # reader 已在跑，客户端可先发消息入队，不必等 agent 加载完
        agent = await get_agent()

        while True:
            query_data = await inbox.get()
            if query_data is None:
                break

            query = query_data.get('query', '')
            session_id = query_data.get('session_id', str(uuid.uuid4()))
            stop_event.clear()
            stopped = False

            # 累积这一轮 AI 的完整文本（用于落库）
            ai_text_parts: list[str] = []

            # 使用真实的 agent.astream 方法
            # 通过 config 传入 thread_id（即 session_id），
            # 一方面用于多会话隔离，另一方面供中间件（如 FileManagerMiddleware）
            # 和旅游子代理获取当前会话上下文。
            stream = agent.astream(
                {"messages": [HumanMessage(content=query)]},
                stream_mode=["updates", "messages"],
                config={"configurable": {"thread_id": session_id}},
            )
            try:
                async for chunk in stream:
                    # 每收到一块就检查一次终止信号
                    if stop_event.is_set():
                        stopped = True
                        break
                    if chunk[0] == 'updates':
                        # 处理更新消息
                        await websocket.send_text(json.dumps(dumpd(chunk[1])))
                    elif chunk[0] == 'messages':
                        # 处理消息流
                        for message in chunk[1]:
                            if isinstance(message, AIMessageChunk) and message.content:
                                # 发送 token
                                await websocket.send_text(message.content)
                                ai_text_parts.append(message.content)
            finally:
                # 被终止时主动关闭生成器，尽快释放底层任务（停止继续消耗模型算力）
                if stopped and hasattr(stream, "aclose"):
                    try:
                        await stream.aclose()
                    except Exception:
                        pass

            # ---- 落库：用户消息 + AI 完整回复（异步，失败不影响对话） ----
            # 放在发送 [END]/[STOPPED] 之前，确保客户端收到结束标记时数据已落库。
            try:
                await asyncio.to_thread(chat_db.insert_message, session_id, "user", query)
                ai_text = "".join(ai_text_parts).strip()
                if ai_text:
                    await asyncio.to_thread(chat_db.insert_message, session_id, "ai", ai_text)
            except Exception as e:
                print(f"[chat] 落库失败（忽略）：{e}")

            # 发送结束标记
            await websocket.send_text("[STOPPED]" if stopped else "[END]")

    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error in websocket: {e}")
        try:
            await websocket.send_text(f"[ERROR] {str(e)}")
        except Exception:
            pass
    finally:
        reader_task.cancel()


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
# 尝试用fastapi去写服务接口, 学习用
import json
import uuid
import asyncio
from typing import AsyncGenerator

import fastapi
from pydantic import BaseModel
from fastapi import WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import JSONResponse

from langchain_core.load import dumpd
from langchain_core.messages import AIMessageChunk, HumanMessage

# 导入真实的 agent
from agent import agent

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


app = fastapi.FastAPI()


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
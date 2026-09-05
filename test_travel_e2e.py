# -*- coding: utf-8 -*-
"""
旅游助手端到端测试脚本（可独立运行，不依赖外部已启动的服务）

流程：
    1. 在后台线程里启动 FastAPI（app.py）的 uvicorn 服务；
    2. 用 websockets 客户端连接 /chat WebSocket；
    3. 发送"帮我订一张北京到上海的机票"，观察 AI 回复（应路由到 travel-agent 并调用工具）。
"""
import asyncio
import threading
import time
import warnings
import json

warnings.filterwarnings("ignore")

import uvicorn
import websockets


def start_server():
    """在后台线程启动 FastAPI 服务"""
    import app  # noqa: F401  触发 app 导入，组装 agent
    config = uvicorn.Config(app.app, host="127.0.0.1", port=8000, log_level="warning")
    server = uvicorn.Server(config)
    server.run()


async def test_chat():
    """连接 WebSocket 并发送旅游需求，收集回复"""
    uri = "ws://127.0.0.1:8000/chat"
    # 等待服务就绪（最多 30 秒）
    for _ in range(60):
        try:
            async with websockets.connect(uri) as ws:
                break
        except Exception:
            await asyncio.sleep(0.5)
    else:
        print("[FAIL] 无法连接到 WebSocket 服务")
        return

    print("=== 已连接 WebSocket，开始发送旅游需求 ===")
    async with websockets.connect(uri) as ws:
        query = "帮我订一张2026年9月10日从北京到上海的机票，经济舱，1个人，单程"
        await ws.send(json.dumps({"query": query, "session_id": "test-travel-001"}))
        print(f"[用户] {query}")
        print("[AI] 回复如下（流式拼接）：")
        print("-" * 60)

        full = []
        tool_called = False
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=120)
                if msg == "[END]":
                    break
                if msg.startswith("[ERROR]"):
                    print(f"\n[错误] {msg}")
                    break
                # 尝试解析 updates JSON，探测工具调用
                try:
                    obj = json.loads(msg)
                    s = json.dumps(obj, ensure_ascii=False)
                    if "search_flights" in s or "search_hotels" in s:
                        tool_called = True
                    # 提取文本内容打印
                    def find(o):
                        if isinstance(o, dict):
                            if isinstance(o.get("content"), str):
                                return o["content"]
                            for v in o.values():
                                r = find(v)
                                if r:
                                    return r
                        elif isinstance(o, list):
                            for v in o:
                                r = find(v)
                                if r:
                                    return r
                        return ""
                    text = find(obj)
                    if text:
                        full.append(text)
                    continue
                except Exception:
                    pass
                # 纯 token
                full.append(msg)

        except asyncio.TimeoutError:
            print("\n[超时] 120 秒内未收到结束标记")

        print("-" * 60)
        result = "".join(full)
        print(f"[AI 回复] {result[:800]}")
        print("-" * 60)
        print(f"[结果] 是否调用了 search_flights / search_hotels 工具：{tool_called}")
        print("[结论]", "✅ 端到端链路打通" if (result or tool_called) else "⚠️ 未获得有效回复")


if __name__ == "__main__":
    # 1. 启动服务线程
    t = threading.Thread(target=start_server, daemon=True)
    t.start()
    # 2. 运行客户端测试
    asyncio.run(test_chat())

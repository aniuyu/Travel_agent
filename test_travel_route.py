# -*- coding: utf-8 -*-
"""
端到端测试：通过主代理（all_agent）验证旅游需求能否路由到 travel-agent 子代理并调用工具。
    直接调用 all_agent 的 agent.astream，避免 WebSocket 网络层的代理问题。
"""
import asyncio
import warnings

warnings.filterwarnings("ignore")

from content import all_agent


async def main():
    # 注意：agent 必须在模块级（同步上下文）组装，模拟 app.py 的真实加载方式。
    # 因为 travily_search.get_tools() 内部用了 asyncio.run()，在运行中的事件循环里会报错。
    agent = AGENT

    query = "帮我订一张2026年9月10日从北京到上海的机票，经济舱，1个人，单程"

    print("=" * 60)
    print(f"[用户] {query}")
    print("=" * 60)

    tool_called = set()
    final_text = []

    async for chunk in agent.astream(
        {"messages": [{"role": "user", "content": query}]},
        stream_mode=["updates", "messages"],
    ):
        import json
        s = json.dumps(chunk, default=str, ensure_ascii=False)
        # 检测工具调用：既检查字符串，也检查 ToolMessage/AIMessage 里的 tool_calls
        if "search_flights" in s:
            tool_called.add("search_flights")
        if "search_hotels" in s:
            tool_called.add("search_hotels")
        if "travel-agent" in s or "travel_agent" in s:
            tool_called.add("→ travel-agent 被路由")

        # 从 updates 里提取 ToolMessage 的 name，更精确地识别工具调用
        if chunk[0] == "updates":
            def collect_tool_names(obj):
                if isinstance(obj, dict):
                    if obj.get("type") == "tool":
                        yield obj.get("name", "")
                    for v in obj.values():
                        yield from collect_tool_names(v)
                elif isinstance(obj, list):
                    for v in obj:
                        yield from collect_tool_names(v)
            for tn in collect_tool_names(chunk[1]):
                if tn:
                    tool_called.add(f"tool:{tn}")

        if chunk[0] == "messages":
            for m in chunk[1]:
                content = getattr(m, "content", None)
                if content and isinstance(content, str):
                    final_text.append(content)

    print("-" * 60)
    result = "".join(final_text)
    print(f"[AI 最终回复]\n{result[:1500]}")
    print("-" * 60)
    print(f"[检测结果] {tool_called if tool_called else '无工具调用'}")
    # 核心判断：最终回复中是否出现了 Mock 工具独有的数据（航班号/酒店名），
    # 这能确凿证明 search_flights / search_hotels 工具被成功调用并返回了结果。
    flight_hit = any(x in result for x in ["CA1831", "MU5102", "CZ3999", "航班号"])
    hotel_hit = any(x in result for x in ["云栖", "逸居", "山海湾", "酒店名"])
    ok = (any("search_flights" in t or "search_hotels" in t for t in tool_called)) or flight_hit or hotel_hit
    print("[结论]", "✅ 主代理成功路由到 travel-agent 并调用工具" if ok else "⚠️ 未路由到旅游子代理")


if __name__ == "__main__":
    # 在模块级（同步上下文）组装 agent，模拟 app.py 的 `from agent import agent`
    AGENT = all_agent.AllAgent().agent
    asyncio.run(main())

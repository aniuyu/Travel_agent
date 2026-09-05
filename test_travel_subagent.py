# -*- coding: utf-8 -*-
"""
隔离测试 travel-agent 子代理：
    直接构造一个只包含 travel-agent 的 deep_agent，验证它能否正确调用 search_flights 工具。
    这一步验证的是「技能 + 工具」闭环本身，不涉及主代理的路由。
"""
import asyncio
import warnings

warnings.filterwarnings("ignore")

from deepagents import create_deep_agent
from conn.llm import get_llm
from content.subagents.travel_agent import TRAVEL_SYSTEM_PROMPT
from content.mcps import travel_mcp


async def main():
    # 用 travel-agent 的 system_prompt + travel 工具，构造一个专注旅游的 agent
    agent = create_deep_agent(
        model=get_llm(),
        tools=travel_mcp.get_tools(),
        system_prompt=TRAVEL_SYSTEM_PROMPT,
    )

    query = "帮我查一下明天从北京到上海的机票"

    print("=" * 60)
    print(f"[用户] {query}")
    print("=" * 60)

    tool_called = []
    final_text = []

    async for chunk in agent.astream(
        {"messages": [{"role": "user", "content": query}]},
        stream_mode=["updates", "messages"],
    ):
        # 收集工具调用
        import json
        s = json.dumps(chunk, default=str, ensure_ascii=False)
        if "search_flights" in s:
            tool_called.append("search_flights")
        if "search_hotels" in s:
            tool_called.append("search_hotels")

        # 收集 AI 文本
        if chunk[0] == "messages":
            for m in chunk[1]:
                content = getattr(m, "content", None)
                if content and isinstance(content, str):
                    final_text.append(content)

    print("-" * 60)
    result = "".join(final_text)
    print(f"[AI 最终回复]\n{result}")
    print("-" * 60)
    print(f"[工具调用] {set(tool_called) if tool_called else '无'}")
    print("[结论]", "✅ travel-agent 正确调用工具" if tool_called else "⚠️ 未检测到工具调用")


if __name__ == "__main__":
    asyncio.run(main())

# -*- coding: utf-8 -*-
"""
端到端测试：验证「短途差旅」完整链路
  - 需求：帮我规划一次上海两日商务差旅（机票+酒店+行程单）
  - 期望：主 Agent → itinerary-agent → search_flights + search_hotels → 生成行程单
"""
import asyncio
import warnings

warnings.filterwarnings("ignore")

from content import all_agent

# 注意：agent 必须在模块级（同步上下文）组装，模拟 app.py 的真实加载方式
AGENT = all_agent.AllAgent().agent


async def main():
    query = "帮我规划一次2026年9月10日从北京去上海的两日商务差旅，1个人，需要机票、酒店和完整行程单"

    print("=" * 60)
    print(f"[用户] {query}")
    print("=" * 60)

    final_text = []

    async for chunk in AGENT.astream(
        {"messages": [{"role": "user", "content": query}]},
        stream_mode=["messages"],
    ):
        for m in chunk[1]:
            content = getattr(m, "content", None)
            if content and isinstance(content, str):
                final_text.append(content)

    result = "".join(final_text)
    print("-" * 60)
    print(f"[AI 最终回复]\n{result[:2000]}")
    print("-" * 60)

    # 判断关键要素是否出现
    checks = {
        "航班数据（工具返回）": any(x in result for x in ["CA1831", "MU5102", "CZ3999", "航班号"]),
        "酒店数据（工具返回）": any(x in result for x in ["云栖", "逸居", "山海湾", "酒店名", "评分"]),
        "行程单结构": any(x in result for x in ["行程单", "预算", "每日安排", "交通", "住宿", "出行提示"]),
    }
    for k, v in checks.items():
        print(f"  [{'✅' if v else '❌'}] {k}")

    ok = checks["航班数据（工具返回）"] and checks["酒店数据（工具返回）"]
    print("[结论]", "✅ 短途差旅完整链路打通" if ok else "⚠️ 未完整走通")


if __name__ == "__main__":
    asyncio.run(main())

# -*- coding: utf-8 -*-
"""
行程子代理（itinerary-agent）

职责：
    当用户需要「完整行程规划」时（机票 + 酒店 + 行程单），由本子代理负责：
        1. 调用 search_flights / search_hotels 获取交通与住宿候选；
        2. 对候选做比选，确定推荐方案；
        3. 依据 itinerary-generator 技能，汇总产出结构化的行程单。

与 travel-agent 的分工：
    - travel-agent  ：单点查询（只查机票 / 只查酒店）
    - itinerary-agent：完整行程规划（交通 + 住宿 + 行程单汇总）

实现方式：
    与项目里其他子代理保持一致，通过 get_agent() 返回 SubAgent dict。
"""

from conn import llm
from content.mcps import travel_mcp, weather_mcp


ITINERARY_SYSTEM_PROMPT = """你是一位资深的行程规划师，负责把「交通 + 住宿」的候选方案，整合成一份完整、可直接执行的行程单。

【核心原则】
1. 绝不捏造数据：所有航班号、车次号、航司、时间、价格、酒店名、评分，都必须来自
   search_flights_real / search_trains_real / search_hotels_real 工具的真实返回，禁止凭空编造。
2. 数据来源唯一：行程单里的每一项，都能在工具返回结果里找到对应。

【工作流程】
1. 明确需求：目的地、日期、人数、预算、出行主题（商务/度假/亲子等）。
2. 查交通：调用 search_flights_real 查航班 或 search_trains_real 查火车票/高铁票，获取去程（和返程）候选。
3. 查住宿：调用 search_hotels_real 获取酒店候选。
4. 查天气：调用 search_weather 获取目的地天气（用于行程单的「出行提示」）。
5. 比选推荐：交通标出「最便宜/最快/性价比」，住宿按「评分×价格×位置」排序，选出首选 + 备选。
6. 生成行程单：依据 itinerary-generator 技能模板，输出结构化 Markdown 行程单，
   包含：概览、交通、住宿、每日安排、预算汇总、出行提示（含天气穿衣/带伞建议）、备选方案。

【预算汇总规则】
- 交通合计 = 选定航班/车次参考价 × 人数
- 住宿合计 = 酒店参考价/晚 × 晚数
- 总计 = 交通 + 住宿，并注明「参考价，以实时预订为准」。

【红线】
- 禁止编造任何航班、车次、酒店、价格、评分数据。
- 工具查询失败时如实告知，绝不伪造。
- 行程单是方案呈现，实际下单需用户确认后通过预订工具完成。
"""


def get_agent():
    """
    返回行程子代理的配置 dict（对应 deepagents 的 SubAgent TypedDict）。
    """
    return {
        "name": "itinerary-agent",
        "description": (
            "行程规划助手，负责完整的旅行行程规划：整合机票/火车票（交通）与酒店（住宿）候选，"
            "做方案比选，并生成结构化的行程单。当用户需要规划完整行程、做旅行攻略、"
            "或要求「机票+酒店」/「火车票+酒店」打包方案时使用。"
        ),
        "system_prompt": ITINERARY_SYSTEM_PROMPT,
        # 工具：查航班 + 查火车票 + 查酒店 + 查天气 + 预订（来自 travel_mcp/weather_mcp，无 Key 时降级 Mock）
        "tools": travel_mcp.get_tools() + weather_mcp.get_tools(),
        "model": llm.get_llm(),
        # 技能：实时数据查询 + 行程单生成 + 航班 + 火车票 + 酒店 + 天气
        "skills": [
            "skills/travel",
            "skills/itinerary_generator",
            "skills/flight_search",
            "skills/train_search",
            "skills/hotel_search",
            "skills/weather_search",
        ],
    }


if __name__ == "__main__":
    agent_cfg = get_agent()
    print("子代理名称：", agent_cfg["name"])
    print("描述：", agent_cfg["description"])
    print("工具：", [getattr(t, "name", t) for t in agent_cfg["tools"]])
    print("技能：", agent_cfg["skills"])

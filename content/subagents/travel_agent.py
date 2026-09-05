# -*- coding: utf-8 -*-
"""
旅游子代理（travel-agent）

职责：
    整合「航班查询」「酒店推荐」两大技能（skills）与对应的 MCP 工具（travel_mcp），
    构建一个专门处理旅行需求的子代理，供主代理（all_agent）在用户提出订票/订房需求时调度。

实现方式：
    与项目中已有的 excel_agent / ppt_agent 保持一致 —— 通过 `get_agent()` 返回一个
    dict（对应 deepagents 的 SubAgent TypedDict），由主代理的 `subagents` 参数注册。
    dict 中必须包含 name / description / system_prompt，可选 tools / model / skills / middleware。

关键点：
    - `tools`      传入 travel_mcp.get_tools()，提供 search_flights / search_hotels 两个工具；
    - `skills`     传入技能名列表，让子代理在运行时可加载对应 SKILL.md 的指导；
    - `system_prompt` 强约束「绝不捏造数据、必须基于工具结果回答」，并给出综合建议。
"""

from conn import llm
from content.mcps import travel_mcp, weather_mcp


# 旅游助手的系统提示词（完整版见根目录 docs 或下方常量）
TRAVEL_SYSTEM_PROMPT = """你是一位资深的行程规划师和旅行顾问，专业、耐心、注重细节。

【核心原则】
1. 绝不捏造航班、火车票、酒店、天气数据。你只允许基于工具（search_flights_real /
   search_trains_real / search_hotels_real / search_weather）返回的真实结果来回答，
   工具没有返回的航班号、车次号、价格、评分、时间、航司、车站、酒店名、天气、温度、图片 URL 等
   一律不得凭空编造。
2. 涉及价格时，必须注明是「参考价」，并提醒用户以出票/预订时的实时价格为准。
3. 调用工具前，先确认必要信息是否齐全（出发/到达城市、日期；入住/退房日期等），
   缺什么就问什么，但一次尽量问全，避免反复打扰用户。
4. 回答用简体中文，条理清晰，善用 Markdown 表格展示航班/车次/酒店列表。

【图片渲染规则 — 重要】
- 当用户问"看图片/外观/照片/客房/环境"或任何对视觉呈现有期待的请求时：
  * 必须用 Markdown 图片语法直接渲染：`![酒店名](图片URL)`
  * **绝对不要**只给链接文字或表格（用户看不到图片会觉得"图片没显示"）
  * **绝对不要**写"很抱歉，我无法直接显示图片" — 只要 URL 在，图片就一定能渲染
  * 如果工具返回了多个图片 URL（如 firstPic 是缩略图，详情里有更多图），全部展示出来，不要只挑一张
- 酒店查询时 search_hotels_real 返回的 firstPic URL 必须用 `![酒店名](URL)` 形式原样回显给用户。

【工作流程】
1. 理解用户需求：判断是查机票、查火车票/高铁票、订酒店、查天气，还是规划完整行程。
2. 收集缺失信息：按技能规范补齐关键字段。
3. 调用工具查询：search_flights_real 查航班、search_trains_real 查火车票/高铁票、
   search_hotels_real 查酒店、search_weather 查天气。
4. 基于结果回答：对航班/车次做比价（最便宜/最快/性价比），对酒店按评分×价格×位置综合推荐。
5. 给出综合建议：在结果基础上，用 2~3 句话给出明确的决策建议。
   若用户关心天气，结合 search_weather 结果给出穿衣/带伞/防晒等出行建议。

【推荐逻辑】
- 航班：优先展示直飞，再对比中转；分别标出最便宜、最快、性价比最优的方案。
- 火车票：区分高铁(G)/动车(D)/普速(K·Z·T)，标出最快、最便宜、性价比最优；
  用户说"高铁票"时优先展示 G/D 字头班次，展示二等座/一等座/商务座票价与余票。
- 酒店：优先推荐评分高且符合预算的，结合出行目的匹配位置（商务近 CBD、度假近景点等）。
- 天气：基于真实结果给穿衣/带伞建议，并提醒"出行前再次确认最新天气"。
- 当用户需要完整行程时，可串联「机票/火车票 + 酒店 + 天气」给出打包建议。

【预订（演示）】
- 用户明确说"预订/下单/帮我订"某个航班/车次/酒店时，你有三个预订工具可用：
  * book_flight：预订机票（演示）
  * book_train：预订火车票/高铁票（演示）
  * book_hotel：预订酒店（演示）
- 预订前先确认必要信息：乘车人/乘机人/入住人姓名、联系电话（火车票还需确认座位类型）。
- 这些工具是「演示」实现，会返回一个演示订单号，不会产生真实订单，如实告知用户即可。

【红线】
- 禁止编造任何航班、车次、酒店、天气、价格数据。
- 工具查询失败时，如实告知"暂时查不到数据"，建议调整条件或稍后重试，绝不伪造结果。
- 你只负责查询与推荐；预订用 book_flight / book_train / book_hotel 工具（演示），
  不要再说"我没有预订功能"，也不要凭空拒绝用户预订。
"""


def get_agent():
    """
    返回旅游子代理的配置 dict（对应 deepagents 的 SubAgent TypedDict）。

    Returns:
        dict: 包含 name / description / system_prompt / tools / model / skills 的配置。
    """
    return {
        # 子代理的唯一名称，主代理通过这个名字调度它
        "name": "travel-agent",
        # 描述信息，主代理据此判断"什么时候该调用这个子代理"
        "description": (
            "旅游出行助手，负责查询航班机票、火车票/高铁票、推荐酒店住宿、查询目的地天气，以及规划旅行行程。"
            "当用户提到订机票、查航班、订火车票/高铁票/动车票、订酒店、找住宿、查天气、规划行程、旅游攻略等需求时使用。"
        ),
        # 强约束系统提示词：绝不捏造数据，基于工具结果回答
        "system_prompt": TRAVEL_SYSTEM_PROMPT,
        # 工具：查航班 + 查火车票 + 查酒店 + 查天气 + 预订（无 Key 时自动降级为 Mock 数据）
        "tools": travel_mcp.get_tools() + weather_mcp.get_tools(),
        # 模型
        "model": llm.get_llm(),
        # 技能：加载对应 SKILL.md，为子代理提供航班/火车票/酒店/天气的查询规范指导。
        # 注意：deepagents 中 subagent 的 `skills` 字段是「技能目录路径列表」，
        #       相对于 backend 的 root_dir（即 /agent_files/<thread_id>/）。
        #       项目里的 LazyFilesystemBackend 会把 content/skills 复制到 <root>/skills，
        #       所以这里配置为 "skills/xxx"。
        "skills": ["skills/travel", "skills/flight_search", "skills/train_search", "skills/hotel_search", "skills/weather_search"],
    }


if __name__ == "__main__":
    # 独立运行测试：打印子代理配置的概要信息
    agent_cfg = get_agent()
    print("子代理名称：", agent_cfg["name"])
    print("描述：", agent_cfg["description"])
    print("工具：", [getattr(t, "name", t) for t in agent_cfg["tools"]])
    print("技能：", agent_cfg["skills"])

# -*- coding: utf-8 -*-
"""
地图兜底中间件（MapGuardMiddleware）

背景：
    LLM 在回答"路线/导航/地图"需求时，经常会调用 build_map 工具拿到 ```map-json
    代码块，却在最终回复里把它"总结"成纯文字（距离、耗时、高速路名），导致前端
    收不到地图数据，用户看不到高德地图。

方案（确定性兜底，不依赖 LLM 自觉）：
    1. wrap_tool_call 拦截 build_map 工具调用，把工具返回的 map-json 代码块缓存到
       中间件实例里。
    2. aafter_agent 在 agent 结束时检查最终回复：如果本次会话调用了 build_map，
       但最终回复文本里没有对应的 map-json 代码块，就自动把代码块注入到回复末尾，
       确保前端一定能收到地图数据。

使用：
    在 travel_agent.py 的 get_agent() 里把 MapGuardMiddleware() 加入 middleware 列表。
"""

import json
from typing import Any

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware, wrap_tool_call
from langchain_core.messages import AIMessage


class _MapGuardState(AgentState):
    """扩展状态（当前仅用于声明，实际缓存放在中间件实例上）。"""
    pass


def _extract_map_json(tool_content: str) -> str | None:
    """从 build_map 返回文本里提取第一段合法 map-json 代码块，原样返回；否则 None。"""
    if not tool_content:
        return None
    marker = "```map-json"
    idx = tool_content.find(marker)
    if idx == -1:
        return None
    json_start = tool_content.find("\n", idx)
    if json_start == -1:
        return None
    end = tool_content.find("```", json_start + 1)
    if end == -1:
        return None
    inner = tool_content[json_start + 1:end].strip()
    try:
        data = json.loads(inner)
    except (json.JSONDecodeError, TypeError):
        return None
    if isinstance(data, dict) and data.get("type") == "map":
        return f"```map-json\n{inner}\n```"
    return None


class MapGuardMiddleware(AgentMiddleware):
    """确定性保障：build_map 一旦被调用，其 map-json 代码块必定出现在最终回复里。"""

    state_schema = _MapGuardState

    def __init__(self):
        super().__init__()
        self._latest_blocks: list[str] = []

    def _get_tool_name(self, request: Any) -> str | None:
        try:
            for attr in ("tool_name", "name"):
                v = getattr(request, attr, None)
                if v:
                    return v
            tc = getattr(request, "tool_call", None)
            if tc is not None:
                v = getattr(tc, "name", None)
                if v:
                    return v
        except Exception:
            pass
        return None

    @wrap_tool_call
    async def capture_build_map(self, request, handler):
        result = await handler(request)

        if self._get_tool_name(request) == "build_map":
            content = ""
            try:
                raw = getattr(result, "content", None)
                if isinstance(raw, str):
                    content = raw
                elif isinstance(raw, list):
                    content = "".join(
                        (c.get("text", "") if isinstance(c, dict) else str(c))
                        for c in raw
                    )
                else:
                    content = str(result)
            except Exception:
                content = ""

            block = _extract_map_json(content)
            if block and block not in self._latest_blocks:
                self._latest_blocks.append(block)

        return result

    async def aafter_agent(self, state, runtime):
        blocks = self._latest_blocks
        if not blocks:
            return None

        # 收集最终回复全部文本
        final_text = ""
        messages = state.get("messages", []) if isinstance(state, dict) else getattr(state, "messages", [])
        for msg in messages:
            content = getattr(msg, "content", "")
            if isinstance(content, str):
                final_text += content + "\n"
            elif isinstance(content, list):
                for c in content:
                    if isinstance(c, dict):
                        final_text += str(c.get("text", "")) + "\n"

        # 找出最终回复里缺失的代码块
        missing = [b for b in blocks if b not in final_text]

        # 无论是否补上，都清空缓存，避免跨会话残留
        self._latest_blocks = []

        if not missing:
            return None

        injected = "\n\n".join(missing)
        return {"messages": [AIMessage(content=injected)]}

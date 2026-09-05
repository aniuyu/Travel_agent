# -*- coding: utf-8 -*-
"""
天气查询 MCP 客户端

设计说明：
    为旅游助手提供「查天气」能力。旅行必看天气，用于行程规划时判断穿衣、是否带伞、
    是否适合户外活动等。

    采用「真实 API + Mock 兜底」双通道策略，保证项目到手即可跑通：

        1. 首选真实天气源 wttr.in（免费、无需 API Key，返回 JSON）。
           通过 HTTP 请求 https://wttr.in/{city}?format=j1 获取真实天气数据；
        2. 若网络不可达或请求失败，自动降级为内置 Mock 数据，返回结构化的示例结果。

    用法：
        from content.mcps import weather_mcp
        tools = weather_mcp.get_tools()   # 返回工具列表，可直接传给子代理

    真实接口替换（可选）：
        后续若需接入和风天气（QWeather）或 OpenWeatherMap，只需替换 _fetch_weather
        内部的 HTTP 调用即可，工具签名保持不变。
"""

import json
from typing import Optional
from urllib import request, parse
from urllib.error import URLError

from langchain_core.tools import tool
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 一、参数模型
# ---------------------------------------------------------------------------

class WeatherInput(BaseModel):
    """查天气工具的入参结构"""
    city: str = Field(description="要查询天气的城市名，例如 '上海' 或 '北京'")
    date: Optional[str] = Field(
        default=None,
        description="要查询的日期，格式 YYYY-MM-DD。为空则查最近天气。注意：wttr.in 免费接口通常只能提供未来几天预报，超出范围会返回空。",
    )


# ---------------------------------------------------------------------------
# 二、真实天气源（wttr.in，免费无需 Key）
# ---------------------------------------------------------------------------

def _fetch_real_weather(city: str) -> dict:
    """
    从 wttr.in 拉取真实天气（JSON 格式）。

    返回结构化的 dict，若失败则抛出异常由上层降级处理。
    """
    url = f"https://wttr.in/{parse.quote(city)}?format=j1&lang=zh"
    # 设置 User-Agent，wttr.in 对无 UA 的请求可能返回 403
    req = request.Request(url, headers={"User-Agent": "travel-agent/1.0"})
    with request.urlopen(req, timeout=8) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data


def _parse_wttr(data: dict, city: str) -> str:
    """把 wttr.in 的 JSON 解析成易读的中文文本"""
    lines = [f"🌤 {city} 天气（真实数据 · wttr.in）："]

    # 当前天气
    try:
        cur = data["current_condition"][0]
        desc = cur.get("lang_zh", [{}])[0].get("value", cur.get("weatherDesc", [{}])[0].get("value", ""))
        temp_c = cur.get("temp_C", "?")
        feels = cur.get("FeelsLikeC", "?")
        humidity = cur.get("humidity", "?")
        wind = cur.get("windspeedKmph", "?")
        lines.append(f"当前：{desc}，气温 {temp_c}°C（体感 {feels}°C），湿度 {humidity}%，风速 {wind}km/h")
    except Exception:
        lines.append("当前天气：暂无数据")

    # 未来 2~3 天预报
    try:
        days = data.get("weather", [])[:3]
        lines.append("未来预报：")
        for d in days:
            date = d.get("date", "?")
            t_min = d.get("mintempC", "?")
            t_max = d.get("maxtempC", "?")
            hourly = d.get("hourly", [])
            # 取白天（中午）的天气描述
            desc = ""
            if hourly:
                midday = hourly[min(len(hourly) // 2, len(hourly) - 1)]
                desc = midday.get("lang_zh", [{}])[0].get("value", midday.get("weatherDesc", [{}])[0].get("value", ""))
            lines.append(f"  · {date}：{desc or '—'}，{t_min}°C ~ {t_max}°C")
    except Exception:
        pass

    lines.append("（数据来源 wttr.in，预报仅供参考）")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 三、Mock 兜底数据
# ---------------------------------------------------------------------------

def _mock_weather(city: str) -> str:
    """无网络时返回的示例天气数据（仅演示）"""
    return (
        f"🌤 {city} 天气（演示数据，未能连接真实天气源）：\n"
        f"当前：晴，气温 26°C（体感 27°C），湿度 55%，风速 12km/h\n"
        f"未来预报：\n"
        f"  · 明日：多云，22°C ~ 28°C\n"
        f"  · 后天：小雨，20°C ~ 25°C（记得带伞）\n"
        f"（以上为演示用参考数据，请以实时查询为准）"
    )


# ---------------------------------------------------------------------------
# 四、工具定义
# ---------------------------------------------------------------------------

@tool("search_weather", args_schema=WeatherInput)
def search_weather(city: str, date: Optional[str] = None) -> str:
    """
    查询城市天气。

    根据城市名（可选日期）查询天气，返回当前天气与未来预报（气温、天气现象、湿度、风速等）。
    优先使用真实天气源 wttr.in；网络不可用时降级为演示数据。
    """
    # 优先尝试真实天气
    try:
        data = _fetch_real_weather(city)
        return _parse_wttr(data, city)
    except (URLError, TimeoutError, json.JSONDecodeError, Exception) as e:
        # 网络失败或解析失败时降级为 Mock，保证工具始终可用
        print(f"[weather_mcp] 真实天气查询失败，降级为演示数据：{e}")
        return _mock_weather(city)


def get_tools():
    """返回天气查询工具列表"""
    return [search_weather]


# ---------------------------------------------------------------------------
# 五、独立运行测试
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 60)
    print("测试 search_weather（上海）：")
    print(search_weather.invoke({"city": "上海"}))
    print("=" * 60)
    print("工具列表：", [t.name for t in get_tools()])

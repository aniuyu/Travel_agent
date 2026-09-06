# -*- coding: utf-8 -*-
"""
地理编码 + 地图数据 MCP 客户端

设计说明：
    为旅游助手提供「地图打点 / 路线」能力。前端用高德 JS API 展示地图，
    但坐标数据需要后端提供——因为途牛酒店接口返回的是地址（无经纬度），
    需要用「地理编码」把地名/地址转成经纬度（GCJ-02）。

    采用「真实 API（高德 REST）+ Mock 兜底」双通道：
        1. 配置了 AMAP_KEY 时，调用高德地理编码 REST API 获取真实坐标；
        2. 未配置 Key 或调用失败时，降级为内置的「常见城市坐标」Mock 表。

    用法：
        from content.mcps import geo_mcp
        tools = geo_mcp.get_tools()   # 返回 [geocode, build_map]

    说明：
        高德 REST 地理编码 API：https://restapi.amap.com/v3/geocode/geo
        返回的 location 是 "lng,lat" 格式（GCJ-02 火星坐标）。
"""

import json
import os
from typing import Optional, List
from urllib import request, parse
from urllib.error import URLError

from langchain_core.tools import tool
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 一、参数模型
# ---------------------------------------------------------------------------

class GeocodeInput(BaseModel):
    """地理编码工具的入参结构"""
    address: str = Field(description="要查询经纬度的地名或地址，例如 '上海外滩' 或 '全季酒店 河南南路33号'")
    city: Optional[str] = Field(default=None, description="限定城市，可提高准确度，例如 '上海'")


class MapPointModel(BaseModel):
    """地图上的一个点"""
    name: str = Field(description="点名称，如酒店名/景点名/车站名")
    lng: float = Field(description="经度（GCJ-02）")
    lat: float = Field(description="纬度（GCJ-02）")
    icon: Optional[str] = Field(default=None, description="图标类型：hotel/scenic/station/food，缺省 default")


class MapRouteModel(BaseModel):
    """两点路线"""
    from_point: MapPointModel = Field(description="起点")
    to_point: MapPointModel = Field(description="终点")
    mode: Optional[str] = Field(default="driving", description="出行方式：driving/transit/walking/riding")


class BuildMapInput(BaseModel):
    """构建地图数据的入参结构（扁平化，方便大模型正确传参）"""
    title: Optional[str] = Field(default=None, description="地图标题，如 '南京到上海驾车路线'")
    points: Optional[List[MapPointModel]] = Field(default=None, description="要打点的位置列表（酒店/景点/车站等）")
    # 路线用扁平字段，避免嵌套对象导致大模型漏传
    from_name: Optional[str] = Field(default=None, description="路线起点名称，如 '南京'")
    from_lng: Optional[float] = Field(default=None, description="路线起点经度（GCJ-02）")
    from_lat: Optional[float] = Field(default=None, description="路线起点纬度（GCJ-02）")
    to_name: Optional[str] = Field(default=None, description="路线终点名称，如 '上海'")
    to_lng: Optional[float] = Field(default=None, description="路线终点经度（GCJ-02）")
    to_lat: Optional[float] = Field(default=None, description="路线终点纬度（GCJ-02）")
    mode: Optional[str] = Field(default="driving", description="出行方式：driving/transit/walking/riding")


# ---------------------------------------------------------------------------
# 二、高德地理编码（真实 API）
# ---------------------------------------------------------------------------

def _geocode_amap(address: str, city: Optional[str] = None) -> Optional[dict]:
    """
    调用高德地理编码 REST API，返回 {name, lng, lat}。
    未配置 AMAP_KEY 或调用失败返回 None。
    """
    key = os.getenv("AMAP_KEY", "") or os.getenv("GAODE_KEY", "")
    if not key:
        return None

    params = {
        "key": key,
        "address": address,
        "output": "JSON",
    }
    if city:
        params["city"] = city

    url = f"https://restapi.amap.com/v3/geocode/geo?{parse.urlencode(params)}"
    req = request.Request(url, headers={"User-Agent": "travel-agent/1.0"})
    try:
        with request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (URLError, TimeoutError, json.JSONDecodeError):
        return None

    if data.get("status") != "1" or data.get("info") != "OK":
        return None

    geocodes = data.get("geocodes") or []
    if not geocodes:
        return None

    loc = geocodes[0].get("location", "")
    if "," not in loc:
        return None
    lng, lat = loc.split(",", 1)
    return {
        "name": address,
        "lng": float(lng),
        "lat": float(lat),
    }


# Mock 坐标表：常见城市/景点（未配 AMAP_KEY 时兜底）
_MOCK_COORDS = {
    "北京": {"lng": 116.407, "lat": 39.904},
    "上海": {"lng": 121.473, "lat": 31.230},
    "上海外滩": {"lng": 121.490, "lat": 31.240},
    "上海虹桥": {"lng": 121.320, "lat": 31.197},
    "南京": {"lng": 118.796, "lat": 32.060},
    "南京南站": {"lng": 118.797, "lat": 31.970},
    "杭州": {"lng": 120.155, "lat": 30.274},
    "广州": {"lng": 113.264, "lat": 23.129},
    "深圳": {"lng": 114.057, "lat": 22.543},
    "成都": {"lng": 104.066, "lat": 30.572},
    "西安": {"lng": 108.939, "lat": 34.341},
}


def _mock_geocode(address: str) -> Optional[dict]:
    """从 Mock 坐标表里模糊匹配，返回 {name, lng, lat}"""
    for key, coord in _MOCK_COORDS.items():
        if key in address:
            return {"name": address, "lng": coord["lng"], "lat": coord["lat"]}
    return None


# ---------------------------------------------------------------------------
# 三、工具定义
# ---------------------------------------------------------------------------

@tool("geocode", args_schema=GeocodeInput)
def geocode(address: str, city: Optional[str] = None) -> str:
    """
    地理编码：把地名/地址转成经纬度（GCJ-02 火星坐标，高德坐标系）。

    用于地图打点前，先拿到酒店/景点/车站的坐标。
    优先调用高德真实 API（需配置 AMAP_KEY）；未配置或失败时降级为内置常见城市坐标。

    返回 JSON 字符串，格式 {"name": "...", "lng": 121.49, "lat": 31.24}。
    """
    # 优先真实 API
    result = _geocode_amap(address, city)
    if result:
        return json.dumps(result, ensure_ascii=False)

    # 降级 Mock
    result = _mock_geocode(address)
    if result:
        return json.dumps({**result, "_mock": True}, ensure_ascii=False)

    return json.dumps(
        {"_error": f"无法解析「{address}」的坐标，请检查 AMAP_KEY 配置或换更具体的地名"},
        ensure_ascii=False,
    )


@tool("build_map", args_schema=BuildMapInput)
def build_map(
    title: Optional[str] = None,
    points: Optional[List[MapPointModel]] = None,
    from_name: Optional[str] = None,
    from_lng: Optional[float] = None,
    from_lat: Optional[float] = None,
    to_name: Optional[str] = None,
    to_lng: Optional[float] = None,
    to_lat: Optional[float] = None,
    mode: Optional[str] = "driving",
) -> str:
    """
    构建地图数据（供前端 TravelMap 组件渲染成高德地图）。

    用于「路线规划」或「打点展示」：
    - 画路线：传入 from_name/from_lng/from_lat + to_name/to_lng/to_lat（必填，来自 geocode 结果）
    - 打点：传入 points=[{name,lng,lat,icon}]

    返回一个 ```map-json 代码块，前端会自动渲染成高德地图（含实时路况、路线、导航跳转按钮）。
    """
    payload: dict = {"type": "map"}
    if title:
        payload["title"] = title
    if points:
        payload["points"] = [p.model_dump() for p in points]
    # 有起点终点坐标，就组装 route
    if from_name and from_lng is not None and from_lat is not None and to_name and to_lng is not None and to_lat is not None:
        payload["route"] = {
            "from": {"name": from_name, "lng": from_lng, "lat": from_lat},
            "to": {"name": to_name, "lng": to_lng, "lat": to_lat},
            "mode": mode or "driving",
        }
    # 用带 map-json 标记的代码块输出，前端 markdown 渲染器会识别并渲染成高德地图
    return f"```map-json\n{json.dumps(payload, ensure_ascii=False)}\n```"


def get_tools():
    """返回地理编码 + 地图构建工具列表"""
    return [geocode, build_map]


# ---------------------------------------------------------------------------
# 四、独立运行测试
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=" * 60)
    print("工具列表：", [t.name for t in get_tools()])
    print("=" * 60)
    print("测试 geocode（上海外滩）：")
    print(geocode.invoke({"address": "上海外滩", "city": "上海"}))
    print("=" * 60)
    print("测试 build_map：")
    print(build_map.invoke({
        "title": "上海 1 日游",
        "points": [
            {"name": "外滩", "lng": 121.49, "lat": 31.24, "icon": "scenic"},
            {"name": "全季酒店", "lng": 121.48, "lat": 31.23, "icon": "hotel"},
        ],
    }))

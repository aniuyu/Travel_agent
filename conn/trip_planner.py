# -*- coding: utf-8 -*-
"""
真实工具调用的行程规划器

链路：
  1. 高德地理编码 REST（conn.geo_mcp._geocode_amap） → 真实经纬度
  2. wttr.in（conn.weather_mcp） → 真实天气
  3. 途牛 CLI（conn.travel_mcp.search_hotels_real / search_trains_real）→ 真实酒店/车票
  4. 估算预算 → 生成 3 档方案（经济/舒适/豪华）
  5. 调用失败时全部降级 Mock，绝不阻塞生成

所有外部依赖都在 conn.* 里，无循环依赖。
"""

import os
import re
import json
import hashlib
import math
from datetime import datetime, timedelta
from typing import Optional

# 复用已有工具
from content.mcps.geo_mcp import _geocode_amap, _mock_geocode  # noqa


# ---------------------------------------------------------------------------
# 大模型总结（调用 conn.llm.get_llm，失败时降级为 None，绝不阻塞生成）
# ---------------------------------------------------------------------------
def _ai_summarize(prompt: str, timeout: int = 90, max_tokens: int = 600) -> Optional[str]:
    """
    调用大模型生成文案。失败/超时返回 None，调用方降级用模板。

    注意：
      - timeout 默认 90s。本项目使用的模型服务较慢（实测基础延迟 ~11s，
        完整行程 JSON 输出 30~45s），设太小会导致 AI 文案全部降级为模板。
      - max_tokens 限制输出长度，避免模型啰嗦导致生成时间失控。
      - 超时用线程池实现（llm.invoke 本身不支持 timeout 参数）。
        超时后 shutdown(wait=False)，不阻塞主流程。
    """
    try:
        import concurrent.futures as _cf
        from conn.llm import get_llm

        llm = get_llm()
        # 限制输出长度（不支持时静默忽略）
        try:
            llm = llm.bind(max_tokens=max_tokens)
        except Exception:
            pass

        ex = _cf.ThreadPoolExecutor(max_workers=1)
        try:
            fut = ex.submit(llm.invoke, prompt)
            res = fut.result(timeout=timeout)
        finally:
            ex.shutdown(wait=False)

        # content 可能是 str，也可能是 list[dict]（新版 LangChain）
        content = getattr(res, "content", None)
        if content is None:
            content = str(res)
        if isinstance(content, list):
            # 取第一个 text 块
            text = ""
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text += block.get("text", "")
                elif isinstance(block, str):
                    text += block
            content = text
        text = content.strip() if isinstance(content, str) else str(content).strip()
        return text if text else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# wttr.in 天气查询（极简实现，失败返回 None）
# ---------------------------------------------------------------------------
def _search_poi(city: str, category: str, offset: int = 8) -> list:
    """
    调高德 POI 搜索 API 拿真实景点/酒店/餐饮列表。
    category: "景点" / "酒店" / "美食" 等中文关键词
    返回: [{"name","address","type","lng","lat"}, ...]
    失败时返回空 list。
    """
    import urllib.request, urllib.parse
    AMAP_KEY = "f007c61a257a7931656cb6aa782002a1"
    try:
        url = (
            "https://restapi.amap.com/v3/place/text?"
            + "keywords=" + urllib.parse.quote(category)
            + "&city=" + urllib.parse.quote(city)
            + "&citylimit=true"
            + f"&offset={offset}"
            + "&extensions=base"
            + "&key=" + AMAP_KEY
        )
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        if data.get("status") != "1":
            return []
        out = []
        for p in data.get("pois", [])[:offset]:
            loc = p.get("location", "")
            if not loc or "," not in loc:
                continue
            lng, lat = loc.split(",", 1)
            out.append({
                "name": p.get("name", ""),
                "address": p.get("address", ""),
                "type": p.get("type", ""),
                "lng": float(lng),
                "lat": float(lat),
            })
        return out
    except Exception:
        return []


# ---------------------------------------------------------------------------
# 酒店搜索 + POI 详情
# ---------------------------------------------------------------------------
def _search_hotel(city: str, district: str = "", offset: int = 10) -> list:
    """
    调高德 POI type=酒店 搜真实酒店。
    district 可选：限定到某城区/商圈，更精准。
    返回: [{name, address, type, lng, lat, poi_id, tel, ...}]
    """
    import urllib.request, urllib.parse
    AMAP_KEY = "f007c61a257a7931656cb6aa782002a1"
    keywords = f"{city}{district}酒店" if district else f"{city}酒店"
    try:
        url = (
            "https://restapi.amap.com/v3/place/text?"
            + "keywords=" + urllib.parse.quote(keywords)
            + "&types=" + urllib.parse.quote("住宿服务")
            + "&city=" + urllib.parse.quote(city)
            + "&citylimit=true"
            + f"&offset={offset}"
            + "&extensions=all"  # 拿 tel + website
            + "&key=" + AMAP_KEY
        )
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        if data.get("status") != "1":
            return []
        out = []
        for p in data.get("pois", [])[:offset]:
            loc = p.get("location", "")
            if not loc or "," not in loc:
                continue
            lng, lat = loc.split(",", 1)
            out.append({
                "name": p.get("name", ""),
                "address": p.get("address", ""),
                "type": p.get("type", ""),
                "lng": float(lng),
                "lat": float(lat),
                "poi_id": p.get("id", ""),
                "tel": p.get("tel", ""),
                "website": p.get("website", ""),
                "rating": p.get("biz_ext", {}).get("rating", ""),  # 部分 POI 有
                "cost": p.get("biz_ext", {}).get("cost", ""),      # 人均价格
            })
        return out
    except Exception:
        return []


def _get_poi_detail(poi_id: str) -> dict:
    """
    调高德 POI Detail 接口拿详情（评分 / 评价 / 图片）。
    返回: {name, address, tel, rating, cost, photos: [url1, url2, ...], comments: [...]}
    """
    import urllib.request, urllib.parse
    AMAP_KEY = "f007c61a257a7931656cb6aa782002a1"
    out: dict = {}
    if not poi_id:
        return out
    try:
        # 1. 基础信息（含 rating / cost / photos）
        url = (
            "https://restapi.amap.com/v3/place/detail?"
            + "id=" + urllib.parse.quote(poi_id)
            + "&extensions=all"
            + "&key=" + AMAP_KEY
        )
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        if data.get("status") == "1" and data.get("pois"):
            p = data["pois"][0]
            out.update({
                "name": p.get("name", ""),
                "address": p.get("address", ""),
                "tel": p.get("tel", ""),
                "website": p.get("website", ""),
                "type": p.get("type", ""),
                "rating": p.get("biz_ext", {}).get("rating", ""),
                "cost": p.get("biz_ext", {}).get("cost", ""),
                "open_time": p.get("biz_ext", {}).get("opentime", ""),
            })
            # 照片（环境图）
            photos = p.get("photos", [])
            if photos:
                out["photos"] = [photo.get("url", "") for photo in photos[:6] if photo.get("url")]
            else:
                out["photos"] = []
        # 2. 评价（用 POI Search 的 extensions=comment；这里简化为空）
        out["comments"] = []
    except Exception:
        pass
    return out


def _normalize_name(s: str) -> str:
    """归一化酒店名：去全角/半角括号差异、空格、常见前后缀，便于匹配。"""
    if not s:
        return ""
    s = s.replace("（", "(").replace("）", ")")
    s = re.sub(r"[\s·•]", "", s)
    return s.lower()


def _search_poi_photos(hotel_name: str, city: str = "") -> dict:
    """
    按酒店名 + 城市 在高德 POI 中搜到对应 POI，返回其高清照片列表。
    用于「途牛给数据、高德给图」的混合数据源方案。

    匹配策略：
      1. 先用 hotel_name 作为 keywords 搜"住宿服务"
      2. 从候选里挑名称与 hotel_name 归一化后最匹配的一条
    返回: { poi_id, matched_name, photos: [url...], score }
    找不到时返回 {}。
    """
    import urllib.request, urllib.parse
    AMAP_KEY = "f007c61a257a7931656cb6aa782002a1"
    if not hotel_name:
        return {}
    try:
        url = (
            "https://restapi.amap.com/v3/place/text?"
            + "keywords=" + urllib.parse.quote(hotel_name)
            + "&types=" + urllib.parse.quote("住宿服务")
            + ("&city=" + urllib.parse.quote(city) + "&citylimit=true" if city else "")
            + "&offset=5"
            + "&extensions=all"
            + "&key=" + AMAP_KEY
        )
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        if data.get("status") != "1":
            return {}
        pois = data.get("pois", [])
        if not pois:
            return {}

        target = _normalize_name(hotel_name)

        def score(p: dict) -> int:
            name = _normalize_name(p.get("name", ""))
            if not name:
                return 0
            if name == target:
                return 100
            # 目标名是否包含候选名（处理"全季酒店（xxx店）" vs "全季酒店(xxx店)"）
            if target and (target in name or name in target):
                return 80
            # 公共子串长度占比
            common = len(set(target) & set(name))
            return int(common * 60 / max(len(target), 1))

        best = max(pois, key=score)
        if score(best) < 40:
            return {}
        photos = best.get("photos") or []
        urls = [ph.get("url") for ph in photos if ph.get("url")]
        return {
            "poi_id": best.get("id", ""),
            "matched_name": best.get("name", ""),
            "photos": urls[:8],
            "score": score(best),
        }
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# 城区查询（用于酒店下拉）
# ---------------------------------------------------------------------------
def _list_districts(city: str) -> list:
    """
    调高德 district 关键词搜某城市的城区/商圈列表。
    返回: [{name, adcode}, ...]
    """
    import urllib.request, urllib.parse
    AMAP_KEY = "f007c61a257a7931656cb6aa782002a1"
    try:
        url = (
            "https://restapi.amap.com/v3/config/district?"
            + "keywords=" + urllib.parse.quote(city)
            + "&subdistrict=2"
            + "&extensions=base"
            + "&key=" + AMAP_KEY
        )
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        if data.get("status") != "1":
            return []
        out = []
        seen = set()
        for d in data.get("districts", []):
            name = d.get("name", "")
            if name and name not in ("[]",) and name not in seen:
                seen.add(name)
                out.append({"name": name, "adcode": d.get("adcode", "")})
            for sub in d.get("districts", []):
                sname = sub.get("name", "")
                if sname and sname not in ("[]",) and sname not in seen:
                    seen.add(sname)
                    out.append({"name": sname, "adcode": sub.get("adcode", "")})
        return out[:30]
    except Exception:
        return []


def _fetch_weather(city: str) -> Optional[dict]:
    """wttr.in 免费天气，格式：format=j1 返回 JSON"""
    import urllib.request, urllib.parse
    try:
        url = f"https://wttr.in/{urllib.parse.quote(city)}?format=j1&lang=zh"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
        cur = data["current_condition"][0]
        today = data["weather"][0]
        return {
            "city": city,
            "now": {
                "temp_C": cur.get("temp_C"),
                "desc": cur.get("lang_zh", [{}])[0].get("value") if isinstance(cur.get("lang_zh"), list) else cur.get("weatherDesc"),
                "humidity": cur.get("humidity"),
                "wind_kmph": cur.get("windspeedKmph"),
            },
            "today": {
                "max_C": today.get("maxtempC"),
                "min_C": today.get("mintempC"),
                "desc": (today.get("hourly", [{}])[4].get("lang_zh", [{}])[0].get("value")
                         if isinstance(today.get("hourly", [{}])[4].get("lang_zh"), list)
                         else today.get("hourly", [{}])[4].get("weatherDesc")),
                "date": today.get("date"),
            },
        }
    except Exception:
        return None
def _find_tuniu():
    """从 PATH/常见目录找 tuniu CLI"""
    import shutil
    from pathlib import Path
    candidates = [
        shutil.which("tuniu"),
        shutil.which("tuniu.cmd"),
        "C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-2/node_modules/.bin/tuniu.cmd",
        str(Path.home() / ".workbuddy/binaries/node/versions/22.22.2-2/node_modules/.bin/tuniu.cmd"),
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    return None


def _tuniu_call(service: str, tool: str, args: dict, timeout: int = 8) -> Optional[dict]:
    """调用 tuniu CLI，失败返回 None"""
    import subprocess
    tuniu = _find_tuniu()
    if not tuniu:
        return None
    try:
        result = subprocess.run(
            [tuniu, "call", service, tool, "-a", json.dumps(args, ensure_ascii=False), "--output", "json"],
            capture_output=True, text=True, timeout=timeout,
            env={**os.environ, "TUNIU_AUTH_TYPE": "apiKey"},
        )
        if result.returncode != 0:
            return None
        # 输出末尾一般有 JSON；尝试找最后一行 JSON
        text = result.stdout.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # 找到最后一个 JSON 块
            for line in reversed(text.splitlines()):
                line = line.strip()
                if line.startswith("{") and line.endswith("}"):
                    try:
                        return json.loads(line)
                    except Exception:
                        continue
            return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
def _haversine_km(a_lng: float, a_lat: float, b_lng: float, b_lat: float) -> float:
    """两点之间球面距离（公里）"""
    R = 6371.0
    a_lat_r, b_lat_r = math.radians(a_lat), math.radians(b_lat)
    dlat = math.radians(b_lat - a_lat)
    dlng = math.radians(b_lng - a_lng)
    h = math.sin(dlat / 2) ** 2 + math.cos(a_lat_r) * math.cos(b_lat_r) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _parse_days(days_str: str) -> int:
    """'3天' → 3"""
    try:
        return int("".join(ch for ch in days_str if ch.isdigit()) or "3")
    except Exception:
        return 3


# 车次号：1-2 个大写字母 + 1-4 位数字（Z375 / G1234 / K7 / D22 / T65 都合法）
_TRAIN_NO_RE = re.compile(r"([A-Z]{1,2}\d{1,4})")
# 酒店名：含「酒店 / 宾馆 / 客栈 / 民宿 / 公寓」等关键词
_HOTEL_HINT_RE = re.compile(
    r"([\u4e00-\u9fa5A-Za-z0-9·\.\-]+?(?:酒店|宾馆|客栈|民宿|公寓|旅舍|招待所))"
)


def _extract_specified_train(notes: str) -> Optional[str]:
    """从用户额外要求里提取车次号（如「想坐 Z375」「乘 G1234 次」）。
    只在含「坐 / 乘 / 搭 / 订 / 买」等意图词时返回，避免误抓无关字串。
    """
    if not notes:
        return None
    m_intent = re.search(r"(想坐|想乘|坐|乘|搭|订|买|搭乘|乘搭)", notes)
    if not m_intent:
        return None
    # 在意图词之后找车次号；如果整句里没在后面找到，再在整句里找
    tail = notes[m_intent.end():]
    m = _TRAIN_NO_RE.search(tail) or _TRAIN_NO_RE.search(notes)
    return m.group(1) if m else None


def _extract_specified_hotel(notes: str) -> Optional[str]:
    """从用户额外要求里提取酒店名（如「想住 上海外滩金陵东路桔子水晶酒店」）。
    只在含「住 / 订 / 入住」等意图词时返回。
    """
    if not notes:
        return None
    m_intent = re.search(r"(想住|想订|想入住|住|订|入住|想换|换)", notes)
    if not m_intent:
        return None
    tail = notes[m_intent.end():]
    m = _HOTEL_HINT_RE.search(tail) or _HOTEL_HINT_RE.search(notes)
    return m.group(1).strip() if m else None


def _mock_hotels(destination: str, days: int, stars: int) -> list:
    """降级用 mock 酒店"""
    base_names = ["全季", "亚朵", "桔子水晶", "锦江之星", "汉庭", "莫泰", "如家", "美居"]
    return [
        {
            "name": f"{base_names[i % len(base_names)]}酒店 · {destination}店",
            "stars": max(2, min(5, stars)),
            "score": round(4.3 + (i % 7) * 0.1, 1),
            "price": 280 + i * 90,
            "image": "🏨",
            "tag": "近地铁",
        }
        for i in range(2)
    ]


def _mock_trains(from_city: str, destination: str) -> list:
    """降级用 mock 车票"""
    return [
        {"type": "train", "number": "G7175", "from": from_city or "出发地", "to": destination, "depart": "08:30", "arrive": "11:00", "price": 553, "carrier": "高铁"},
        {"type": "train", "number": "G7111", "from": from_city or "出发地", "to": destination, "depart": "13:00", "arrive": "15:30", "price": 553, "carrier": "高铁"},
    ]


def _mock_flights(from_city: str, destination: str) -> list:
    """降级用 mock 机票"""
    return [
        {"type": "flight", "number": "MU5102", "from": from_city or "出发地", "to": destination, "depart": "08:30", "arrive": "10:30", "price": 680, "carrier": "东方航空"},
    ]


def _plan_days(attractions: list, days: int, destination: str = "") -> list:
    """
    根据天数生成每天行程。
    attractions 元素可以是：
      - str: 旧模板
      - dict: 真实 POI，含 name/address/type/lng/lat
    每天上午一个主景点 + 下午一个次景点，时间根据景点类型智能分配。
    """
    if not attractions:
        attractions = [destination + "城市地标", destination + "老城区"]

    def spot_of(idx: int, is_morning: bool) -> dict:
        a = attractions[idx % len(attractions)]
        if isinstance(a, dict):
            name = a.get("name") or "城市地标"
            typ = a.get("type", "")
            addr = a.get("address", "")
            # 智能选 icon：根据 POI 类型
            icon = "🎯"
            if "美食" in typ or "餐饮" in typ:
                icon = "🍜"
            elif "博物馆" in typ or "文化" in typ:
                icon = "🏛️"
            elif "公园" in typ or "风景" in typ:
                icon = "🌳"
            elif "古镇" in typ or "历史" in typ:
                icon = "🏘️"
            elif "购物" in typ or "商业" in typ:
                icon = "🛍️"
            elif "夜景" in typ or "夜" in typ:
                icon = "🌃"
            elif "宗教" in typ or "寺" in typ:
                icon = "⛩️"
            # 智能时间：根据类型分配
            if "美食" in typ or "餐饮" in typ:
                time = "18:00 - 20:00" if is_morning else "11:30 - 13:30"
            elif "夜" in typ:
                time = "19:00 - 21:00" if is_morning else "20:00 - 22:00"
            elif "古镇" in typ or "文化" in typ or "博物馆" in typ:
                time = "14:00 - 17:00" if is_morning else "09:00 - 12:00"
            else:
                time = "09:00 - 11:30" if is_morning else "14:00 - 17:00"
            return {
                "time": time,
                "name": name,
                "address": addr,
                "type": typ,
                "icon": icon,
                "lng": a.get("lng"),
                "lat": a.get("lat"),
            }
        else:
            # 旧字符串模板
            time = "09:00 - 11:30" if is_morning else "14:00 - 17:00"
            return {"time": time, "name": str(a), "icon": "🎯"}

    plan = []
    for d in range(1, days + 1):
        a1 = spot_of((d - 1) * 2, True)        # 上午
        a2 = spot_of((d - 1) * 2 + 1, False)  # 下午
        plan.append({
            "day": d,
            "title": f"第 {d} 天 · {destination}" if destination else f"第 {d} 天",
            "spots": [a1, a2],
        })
    return plan


# ---------------------------------------------------------------------------
# 公开 API
# ---------------------------------------------------------------------------
def plan_trip(
    destination: str,
    from_city: str = "",
    days: str = "3天",
    budget: int = 5000,
    pref: str = "自然风光",
    hotel_level: str = "舒适型",
    transport: str = "高铁",
    hotel_stars: int = 4,
    dining_budget: str = "适中",
    depart_date: str = "",
    companion: str = "独旅",
    extra_notes: str = "",
    selected_hotel: str = "",
    selected_ticket: str = "",
    selected_hotel_detail: Optional[dict] = None,
    selected_ticket_detail: Optional[dict] = None,
) -> dict:
    """
    完整行程生成：调真实工具（高德/wttr.in/途牛），降级 Mock，最后出 3 档方案。
    返回 dict 给前端直接用。
    """
    n_days = _parse_days(days)

    # ---------- 1) 地理编码（真实 API → Mock 降级）----------
    geo_dest = _geocode_amap(destination) or _mock_geocode(destination)
    geo_from = _geocode_amap(from_city) or (_mock_geocode(from_city) if from_city else None)
    dest_lng = geo_dest["lng"] if geo_dest else 121.473
    dest_lat = geo_dest["lat"] if geo_dest else 31.230
    from_lng = geo_from["lng"] if geo_from else 118.79
    from_lat = geo_from["lat"] if geo_from else 32.06
    distance_km = (
        round(_haversine_km(from_lng, from_lat, dest_lng, dest_lat), 1)
        if geo_dest and geo_from
        else None
    )

    # ---------- 2~5) 天气 / 酒店 / 车票 / 机票 / 景点：并发拉取 ----------
    # 这 5 路请求互不依赖，串行要十几二十秒，并发后只需最慢那一路的时间。
    # （LLM 文案生成依赖这些结果，无法与之并发，所以这里省的是网络等待）
    import concurrent.futures as _cf

    def _task_weather():
        try:
            return _fetch_weather(destination)
        except Exception:
            return None

    def _task_hotels():
        out = []
        try:
            if _find_tuniu():
                tuniu_args = {
                    "cityName": destination,
                    "checkInDate": depart_date or datetime.now().strftime("%Y-%m-%d"),
                    "checkOutDate": (
                        datetime.strptime(depart_date, "%Y-%m-%d") + timedelta(days=n_days)
                    ).strftime("%Y-%m-%d") if depart_date else (datetime.now() + timedelta(days=n_days)).strftime("%Y-%m-%d"),
                }
                data = _tuniu_call("hotel", "tuniuHotelSearch", tuniu_args)
                if data and isinstance(data, dict):
                    # 途牛返回结构通常含 hotelList / data 列表；按常见路径拿前 3 家
                    raw_list = (
                        data.get("data", {}).get("hotelList", [])
                        if isinstance(data.get("data"), dict)
                        else data.get("hotelList", []) or data.get("hotels", [])
                    )
                    for h in raw_list[:3]:
                        out.append({
                            "name": h.get("hotelName") or h.get("name") or f"{destination}酒店",
                            "stars": int(h.get("star") or h.get("starLevel") or hotel_stars),
                            "score": float(h.get("commentScore") or h.get("score") or 4.5),
                            "price": int(h.get("lowestPrice") or h.get("price") or 400),
                            "image": h.get("firstPic") or "🏨",
                            "tag": h.get("business") or h.get("tag") or "近景点",
                        })
        except Exception:
            pass
        return out or _mock_hotels(destination, n_days, hotel_stars)

    def _task_tickets():
        out = []
        if from_city:
            try:
                if _find_tuniu():
                    train_args = {
                        "fromCityName": from_city,
                        "toCityName": destination,
                        "departDate": depart_date or datetime.now().strftime("%Y-%m-%d"),
                    }
                    td = _tuniu_call("train", "searchLowestPriceTrain", train_args)
                    if td and isinstance(td, dict):
                        train_list = td.get("data", {}).get("trainList", []) if isinstance(td.get("data"), dict) else td.get("trains", []) or td.get("trainList", [])
                        for t in train_list[:3]:
                            out.append({
                                "type": "train",
                                "number": t.get("trainNumber") or t.get("number"),
                                "from": from_city,
                                "to": destination,
                                "depart": t.get("departTime"),
                                "arrive": t.get("arriveTime"),
                                "price": int((t.get("price") or {}).get("edzPrice") or 0),
                                "carrier": "高铁",
                            })
            except Exception:
                pass
        return out or _mock_trains(from_city, destination)

    def _task_flights():
        out = []
        if from_city:
            try:
                if _find_tuniu():
                    f_args = {"departCityName": from_city, "arriveCityName": destination, "departDate": depart_date or datetime.now().strftime("%Y-%m-%d")}
                    fd = _tuniu_call("flight", "searchLowestPriceFlight", f_args)
                    if fd and isinstance(fd, dict):
                        flist = fd.get("data", {}).get("flightList", []) if isinstance(fd.get("data"), dict) else fd.get("flights", []) or fd.get("flightList", [])
                        for f in flist[:2]:
                            out.append({
                                "type": "flight",
                                "number": f.get("flightNo") or f.get("number"),
                                "from": from_city,
                                "to": destination,
                                "depart": f.get("departTime"),
                                "arrive": f.get("arriveTime"),
                                "price": int(f.get("lowestPrice") or f.get("price") or 0),
                                "carrier": f.get("carrierName") or "航空",
                            })
            except Exception:
                pass
        return out or _mock_flights(from_city, destination)

    def _task_pois():
        pool, seen = [], set()
        for kw in ["景点", "文化", "公园", "博物馆", "古镇", "美食", "夜景"]:
            for _p in _search_poi(destination, kw, offset=4):
                if _p["name"] and _p["name"] not in seen:
                    seen.add(_p["name"])
                    pool.append(_p)
            if len(pool) >= n_days * 2 + 2:
                break
        return pool

    _ex = _cf.ThreadPoolExecutor(max_workers=5)
    _fut = {
        "weather": _ex.submit(_task_weather),
        "hotels": _ex.submit(_task_hotels),
        "tickets": _ex.submit(_task_tickets),
        "flights": _ex.submit(_task_flights),
        "pois": _ex.submit(_task_pois),
    }

    def _get(key, default):
        try:
            return _fut[key].result(timeout=60)
        except Exception:
            return default

    weather = _get("weather", None)
    hotels = _get("hotels", []) or _mock_hotels(destination, n_days, hotel_stars)
    tickets = _get("tickets", []) or _mock_trains(from_city, destination)
    flights = _get("flights", []) or _mock_flights(from_city, destination)
    attraction_pool = _get("pois", [])
    _ex.shutdown(wait=False)  # 结果已取回，释放线程池（不等待，避免拖慢）

    # ---- 用户指定酒店：显式 selected_hotel 优先，其次从 extra_notes 提取 ----
    specified_hotel = (selected_hotel or "").strip() or (_extract_specified_hotel(extra_notes) if extra_notes else "")
    if specified_hotel:
        d_hotel = selected_hotel_detail or {}

        def _apply_hotel_detail(item: dict) -> dict:
            """用用户在酒店页选定时的真实信息覆盖（价格/评分/星级/商圈/地址/图片）"""
            if not d_hotel:
                return item
            if d_hotel.get("price") is not None:
                item["price"] = d_hotel["price"]
            if d_hotel.get("score") is not None:
                item["score"] = d_hotel["score"]
            if d_hotel.get("starName"):
                item["starName"] = d_hotel["starName"]
            if d_hotel.get("business"):
                item["business"] = d_hotel["business"]
            if d_hotel.get("address"):
                item["address"] = d_hotel["address"]
            if d_hotel.get("pic"):
                item["image"] = d_hotel["pic"]
            return item

        # 如果结果里已经有同名酒店，提到最前并标记「您指定」
        hit = next((i for i, h in enumerate(hotels) if specified_hotel in (h.get("name") or "")), -1)
        if hit >= 0:
            # 注意：列表里的同名酒店来自搜索接口，信息可能和用户实际选的不一致
            # （价格/评分不同），必须用 detail 覆盖，否则会出现"选了却显示别的价格"
            item = hotels.pop(hit)
            item["user_specified"] = True
            item["tag"] = "您指定"
            hotels.insert(0, _apply_hotel_detail(item))
        else:
            base = {
                "name": specified_hotel,
                "stars": hotel_stars,
                "score": 4.6,
                "price": 580,
                "image": "🏨",
                "tag": "您指定",
                "user_specified": True,
            }
            hotels.insert(0, _apply_hotel_detail(base))

    # ---- 用户指定车次：显式 selected_ticket 优先，其次从 extra_notes 提取 ----
    specified_train = (selected_ticket or "").strip() or (_extract_specified_train(extra_notes) if extra_notes else "")
    if specified_train and from_city:
        d_train = selected_ticket_detail or {}

        def _apply_ticket_detail(item: dict) -> dict:
            """用用户在车票页选定时的真实信息覆盖（站点/时刻/票价/车型/耗时）"""
            if not d_train:
                return item
            if d_train.get("from"):
                item["from"] = d_train["from"]
            if d_train.get("to"):
                item["to"] = d_train["to"]
            if d_train.get("depart"):
                item["depart"] = d_train["depart"]
            if d_train.get("arrive"):
                item["arrive"] = d_train["arrive"]
            if d_train.get("price") is not None:
                item["price"] = d_train["price"]
            if d_train.get("category"):
                item["carrier"] = d_train["category"]
            if d_train.get("duration"):
                item["duration"] = d_train["duration"]
            return item

        hit = next((i for i, t in enumerate(tickets) if (t.get("number") or "").upper() == specified_train.upper()), -1)
        if hit >= 0:
            # 同理：列表里同车次的信息（如 mock 的 08:30 出发）和用户实际选的
            # （如 07:15 出发）可能不同，必须用 detail 覆盖
            item = tickets.pop(hit)
            item["user_specified"] = True
            tickets.insert(0, _apply_ticket_detail(item))
        else:
            base = {
                "type": "train",
                "number": specified_train,
                "from": from_city,
                "to": destination,
                "depart": "—",
                "arrive": "—",
                "price": 0,
                "carrier": "用户指定",
                "user_specified": True,
            }
            tickets.insert(0, _apply_ticket_detail(base))

    # ---- 景点兜底 + 截取 ----
    if not attraction_pool:
        attraction_pool = _search_poi(destination, "景点", offset=8)
    attractions = attraction_pool[: min(n_days * 2, len(attraction_pool))]

    # ---------- 6) 生成 3 档方案 ----------
    plans = [
        {
            "tier": "经济档",
            "price": round(budget * 0.59),
            "highlight": "性价比之选",
            "hotel": hotels[0] if hotels else _mock_hotels(destination, n_days, 3)[0],
            "transport_mode": "高铁+公交",
            "dining": "本帮菜+小吃",
            "attractions": attractions[:3],
            "tag": "经济型综合体验",
        },
        {
            "tier": "舒适档",
            "price": budget,
            "highlight": "推荐 · 平衡体验",
            "hotel": hotels[1] if len(hotels) > 1 else hotels[0] if hotels else _mock_hotels(destination, n_days, 4)[0],
            "transport_mode": "高铁+专车",
            "dining": "本帮菜+特色美食",
            "attractions": attractions,
            "tag": "舒适型方案",
        },
        {
            "tier": "豪华档",
            "price": round(budget * 1.44),
            "highlight": "品质享受",
            "hotel": hotels[-1] if hotels else _mock_hotels(destination, n_days, 5)[0],
            "transport_mode": "专车接送",
            "dining": "精致私房菜",
            "attractions": attractions + [f"{destination}特色体验"],
            "tag": "豪华综合体验",
        },
    ]

    # ---- 用户选定的酒店对所有档位生效 ----
    # 默认 orders：经济档用 hotels[0]、舒适档用 hotels[1]、豪华档用 hotels[-1]。
    # 用户选定的酒店虽然被置顶到 hotels[0]，但如果不覆盖，**只有经济档**会用它，
    # 用户切到默认的「舒适档」看到的仍是别的酒店 → 表现为"选定了却没用上"。
    if specified_hotel and hotels and hotels[0].get("user_specified"):
        for p in plans:
            p["hotel"] = hotels[0]

    # ---------- 7) 行程时刻表（按选档填具体景点）----------
    itinerary_per_tier = {
        p["tier"]: _plan_days(p["attractions"], n_days, destination) for p in plans
    }

    # ---------- 8) 大模型总结（单次调用，一次返回总结+3档文案，失败降级为 None）----------
    ai_summary = None
    extra_note_reply = ""  # 针对用户「额外要求」的回应（用于详情页展示）
    try:
        spot_names = []
        for a in attractions[:6]:
            spot_names.append(a["name"] if isinstance(a, dict) else str(a))
        weather_desc = ""
        if weather and weather.get("now"):
            weather_desc = f"{weather['now'].get('temp_C')}°C {weather['now'].get('desc')}"

        # 档位信息（供 LLM 参考）
        tier_parts = []
        for p in plans:
            names = []
            for a in p["attractions"][:3]:
                names.append(a["name"] if isinstance(a, dict) else str(a))
            tier_parts.append(f"{p['tier']} ¥{p['price']}（{'、'.join(names)}）")
        tier_info = "；".join(tier_parts)

        # 关键：把用户的「额外要求 + 显式选定酒店/车票」喂给 LLM，
        # 否则它会自己编造 Z375 / 桔子水晶这种用户明确指定的内容
        selected_parts = []
        if specified_hotel:
            selected_parts.append(f"已选定酒店：{specified_hotel}")
        if specified_train:
            selected_parts.append(f"已选定车次：{specified_train}")
        notes_section_parts = []
        if selected_parts:
            notes_section_parts.append("用户明确选定（必须原样体现在 summary 里）：\n" + "\n".join(selected_parts))
        if extra_notes:
            notes_section_parts.append(f"用户额外要求（必须严格遵守，不得编造或忽略）：\n{extra_notes}")
        notes_section = ("\n" + "\n".join(notes_section_parts) + "\n") if notes_section_parts else ""
        summary_prompt = (
            f"你是一个旅行规划助手。请基于以下真实信息，输出 JSON（不要任何多余文字）：\n"
            f"{{"
            f"\"summary\":\"一句 40 字以内的整体推荐语\","
            f"\"economy\":\"经济档一句15字内卖点\","
            f"\"comfort\":\"舒适档一句15字内卖点\","
            f"\"luxury\":\"豪华档一句15字内卖点\","
            f"\"dining\":\"本地餐饮建议，30字以内，必须包含 3-5 个具体的当地特色美食名称\","
            f"\"note_reply\":\"针对用户额外要求的一句话回应；没有额外要求时填空字符串\""
            f"}}\n"
            f"目的地：{destination}，{n_days}天，预算¥{budget}，天气：{weather_desc or '未知'}，出行：{companion}\n"
            f"三个档位：{tier_info}"
            f"{notes_section}\n"
            f"硬性要求：\n"
            f"1. 如果用户提到了具体车次（如 Z375、G1234），summary 中必须**原样提到**这个车次号，不要用别的车次代替。\n"
            f"2. 如果用户提到了具体酒店名（如金陵东路桔子水晶），summary 中必须**原样提到**这个酒店，不要用其他酒店名代替。\n"
            f"3. dining 字段：结合「{destination}」与用户额外要求，给出**具体**的当地特色美食名称"
            f"（例如「生煎、小笼包、蟹壳黄」，不要写「特色美食」这类泛称）。\n"
            f"4. note_reply 字段：用一句话说明你如何落实了用户的额外要求"
            f"（如「已按您的要求安排了本地特色美食推荐」）；用户没有额外要求时填空字符串。\n"
            f"5. 所有推荐必须是真实存在的，不得编造。"
        )
        raw = _ai_summarize(summary_prompt)
        if raw:
            # 尝试提取 JSON（容错：去掉可能的代码块围栏）
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            if m:
                obj = json.loads(m.group(0))
                ai_summary = obj.get("summary")
                # 把档位文案写回 plans
                tier_map = {"经济档": "economy", "舒适档": "comfort", "豪华档": "luxury"}
                llm_dining = (obj.get("dining") or "").strip()
                for p in plans:
                    key = tier_map.get(p["tier"])
                    if key and obj.get(key):
                        p["ai_highlight"] = obj[key]
                    # 用 LLM 基于「目的地 + 额外要求」生成的本地餐饮建议，
                    # 覆盖原先硬编码的 "本帮菜+特色美食" 模板
                    if llm_dining:
                        p["dining"] = llm_dining
                extra_note_reply = (obj.get("note_reply") or "").strip()
            else:
                # 没有 JSON，直接把整段当总结
                ai_summary = raw
    except Exception:
        ai_summary = None

    return {
        "title": f"{destination} {days} 行程",
        "destination": destination,
        "from_city": from_city,
        "days": days,
        "n_days": n_days,
        "budget": budget,
        "pref": pref,
        "hotel_level": hotel_level,
        "transport": transport,
        "hotel_stars": hotel_stars,
        "dining_budget": dining_budget,
        "depart_date": depart_date,
        "companion": companion,
        "extra_notes": extra_notes,
        "extra_note_reply": extra_note_reply,
        "selected_hotel": specified_hotel,
        "selected_ticket": specified_train,
        "selected_hotel_detail": selected_hotel_detail,
        "selected_ticket_detail": selected_ticket_detail,
        "destination_geo": {"lng": dest_lng, "lat": dest_lat, "name": destination},
        "from_geo": {"lng": from_lng, "lat": from_lat, "name": from_city} if from_city else None,
        "distance_km": distance_km,
        "weather": weather,
        "hotels": hotels,
        "tickets": tickets,
        "flights": flights,
        "plans": plans,
        "itinerary_per_tier": itinerary_per_tier,
        "ai_summary": ai_summary,
    }
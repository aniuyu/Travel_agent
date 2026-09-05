# -*- coding: utf-8 -*-
"""
旅游 MCP 客户端（航班 + 酒店）

设计说明：
    本模块提供 `search_flights`（查航班）与 `search_hotels`（查酒店）两个工具，
    以及 `book_flight` / `book_hotel`（预订演示工具）。

    真实数据接入：途牛 CLI（tuniu-cli，npm 包）
        关键点：tuniu-cli **不是 MCP server**，而是一个普通 CLI 工具；
        调用方式是 subprocess 执行 `tuniu call <service> <tool> -a '<json>' --output json`。
        CLI 内部会用 JSON-RPC 2.0 协议跟途牛服务端通信，但 CLI 本身启动会输出
        "tuniu skill install" 等非 JSON 内容，不能直接走 MCP stdio client。

    双通道策略：
        1. 配置了 TUNIU_API_KEY，则用 subprocess 调真实途牛 CLI 获取实时数据；
        2. 否则降级为内置 Mock 数据工具。

    用法：
        from content.mcps import travel_mcp
        tools = travel_mcp.get_tools()
"""

import asyncio
import json
import os
import subprocess
import shutil
from pathlib import Path
from typing import Optional, Any

from langchain_core.tools import tool
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# 一、参数模型（Pydantic）
# ---------------------------------------------------------------------------

class FlightSearchInput(BaseModel):
    """查航班工具的入参结构"""
    departure_city: str = Field(description="出发城市名或机场三字码，例如 '北京' 或 'PEK'")
    arrival_city: str = Field(description="到达城市名或机场三字码，例如 '上海' 或 'SHA'")
    departure_date: str = Field(description="出发日期，格式 YYYY-MM-DD，例如 '2026-09-10'")
    return_date: Optional[str] = Field(default=None, description="返程日期（往返票才需要），格式 YYYY-MM-DD")
    passengers: int = Field(default=1, description="乘客人数，默认 1")
    cabin_class: str = Field(default="经济舱", description="舱位等级：经济舱 / 公务舱 / 头等舱")


class HotelSearchInput(BaseModel):
    """查酒店工具的入参结构"""
    city: str = Field(description="目的地城市名，例如 '北京'")
    check_in: str = Field(description="入住日期，格式 YYYY-MM-DD")
    check_out: str = Field(description="退房日期，格式 YYYY-MM-DD")
    location: Optional[str] = Field(default=None, description="位置偏好：近机场 / 近市中心 / 近景点等")
    budget_min: Optional[int] = Field(default=None, description="每晚最低预算（元）")
    budget_max: Optional[int] = Field(default=None, description="每晚最高预算（元）")
    star_rating: Optional[str] = Field(default=None, description="星级/档次：经济型 / 舒适型 / 豪华型 / 五星级")
    guests: int = Field(default=2, description="入住人数，默认 2")


# ---------------------------------------------------------------------------
# 二、Mock 数据工具（无真实 API Key 时的兜底实现）
# ---------------------------------------------------------------------------

@tool("search_flights", args_schema=FlightSearchInput)
def search_flights(
    departure_city: str,
    arrival_city: str,
    departure_date: str,
    return_date: Optional[str] = None,
    passengers: int = 1,
    cabin_class: str = "经济舱",
) -> str:
    """
    查询航班信息（Mock 实现）。

    根据出发城市、到达城市、出发日期等条件查询航班列表，返回航班号、航司、
    起降时间、飞行时长、是否直飞、参考价格等信息。

    注意：当前为 Mock 数据，仅用于演示。真实场景请替换为实际航班 API。
    """
    flights = [
        {
            "航班号": "CA1831",
            "航司": "中国国航",
            "出发": f"{departure_city} 08:00",
            "到达": f"{arrival_city} 10:15",
            "飞行时长": "2小时15分",
            "类型": "直飞",
            "中转": "",
            "参考价": "¥860",
        },
        {
            "航班号": "MU5102",
            "航司": "东方航空",
            "出发": f"{departure_city} 09:30",
            "到达": f"{arrival_city} 11:50",
            "飞行时长": "2小时20分",
            "类型": "直飞",
            "中转": "",
            "参考价": "¥790",
        },
        {
            "航班号": "CZ3999",
            "航司": "南方航空",
            "出发": f"{departure_city} 07:10",
            "到达": f"{arrival_city} 12:40",
            "飞行时长": "5小时30分",
            "类型": "中转",
            "中转": "经停 武汉 1小时20分",
            "参考价": "¥520",
        },
    ]

    lines = [
        f"已查询 {departure_city} → {arrival_city}（{departure_date}，{cabin_class}，{passengers} 人）的航班：",
    ]
    if return_date:
        lines.append(f"返程日期：{return_date}")
    lines.append("")
    for f in flights:
        seg = [f"✈ {f['航班号']}（{f['航司']}）",
               f"起飞 {f['出发']} / 到达 {f['到达']}",
               f"时长 {f['飞行时长']}",
               f"{f['类型']}"]
        if f["中转"]:
            seg.append(f["中转"])
        seg.append(f"参考价 {f['参考价']}")
        lines.append(" | ".join(seg))
    lines.append("")
    lines.append("（以上为演示用参考数据，请以实时查询为准）")
    return "\n".join(lines)


@tool("search_hotels", args_schema=HotelSearchInput)
def search_hotels(
    city: str,
    check_in: str,
    check_out: str,
    location: Optional[str] = None,
    budget_min: Optional[int] = None,
    budget_max: Optional[int] = None,
    star_rating: Optional[str] = None,
    guests: int = 2,
) -> str:
    """
    查询酒店信息（Mock 实现）。

    根据城市、入住/退房日期、位置偏好、预算、星级等条件查询酒店列表，
    返回酒店名、位置、评分、参考价格、特色等信息。

    注意：当前为 Mock 数据，仅用于演示。真实场景请替换为实际酒店 API。
    """
    hotels = [
        {
            "酒店名": "云栖·城市精品酒店",
            "位置": "市中心/近地铁",
            "评分": "4.8",
            "参考价": "¥458/晚",
            "特色": "近商圈，含双早，交通便利",
        },
        {
            "酒店名": "逸居快捷酒店",
            "位置": "火车站附近",
            "评分": "4.3",
            "参考价": "¥239/晚",
            "特色": "性价比高，适合短住",
        },
        {
            "酒店名": "山海湾度假酒店",
            "位置": "近景区/海边",
            "评分": "4.7",
            "参考价": "¥680/晚",
            "特色": "海景房，含泳池与亲子设施",
        },
    ]

    lines = [
        f"已查询 {city} 的酒店（{check_in} 入住 / {check_out} 退房，{guests} 人）：",
    ]
    if location:
        lines.append(f"位置偏好：{location}")
    if budget_min is not None or budget_max is not None:
        lines.append(f"预算：¥{budget_min or '-'} ~ ¥{budget_max or '-'}/晚")
    if star_rating:
        lines.append(f"档次：{star_rating}")
    lines.append("")
    for h in hotels:
        lines.append(
            f"🏨 {h['酒店名']} ｜ {h['位置']} ｜ 评分 {h['评分']} ｜ {h['参考价']} ｜ {h['特色']}"
        )
    lines.append("")
    lines.append("（以上为演示用参考数据，请以实时查询为准）")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 二-b、预订服务工具（Mock 实现）
# ---------------------------------------------------------------------------

class BookFlightInput(BaseModel):
    """预订机票工具的入参结构"""
    flight_number: str = Field(description="要预订的航班号，例如 'MU5102'")
    passenger_name: str = Field(description="乘机人姓名")
    contact_phone: str = Field(description="联系人手机号")


class BookHotelInput(BaseModel):
    """预订酒店工具的入参结构"""
    hotel_name: str = Field(description="要预订的酒店名称")
    check_in: str = Field(description="入住日期，格式 YYYY-MM-DD")
    check_out: str = Field(description="退房日期，格式 YYYY-MM-DD")
    guest_name: str = Field(description="入住人姓名")
    contact_phone: str = Field(description="联系人手机号")


@tool("book_flight", args_schema=BookFlightInput)
def book_flight(
    flight_number: str,
    passenger_name: str,
    contact_phone: str,
) -> str:
    """
    预订机票（Mock 实现）。

    根据航班号、乘机人、联系方式生成一个预订记录，返回预订结果（订单号、状态）。
    注意：当前为 Mock 实现，仅用于演示预订流程，不会产生真实订单。
    """
    import uuid
    order_id = "FL" + uuid.uuid4().hex[:10].upper()
    return (
        f"机票预订成功（演示）\n"
        f"航班号：{flight_number}\n"
        f"乘机人：{passenger_name}\n"
        f"联系电话：{contact_phone}\n"
        f"订单号：{order_id}\n"
        f"状态：待支付（演示环境，实际预订请前往航司/平台完成支付）"
    )


@tool("book_hotel", args_schema=BookHotelInput)
def book_hotel(
    hotel_name: str,
    check_in: str,
    check_out: str,
    guest_name: str,
    contact_phone: str,
) -> str:
    """
    预订酒店（Mock 实现）。

    根据酒店名、入住/退房日期、入住人、联系方式生成一个预订记录，返回预订结果。
    注意：当前为 Mock 实现，仅用于演示预订流程，不会产生真实订单。
    """
    import uuid
    order_id = "HT" + uuid.uuid4().hex[:10].upper()
    return (
        f"酒店预订成功（演示）\n"
        f"酒店：{hotel_name}\n"
        f"入住：{check_in} / 退房：{check_out}\n"
        f"入住人：{guest_name}\n"
        f"联系电话：{contact_phone}\n"
        f"订单号：{order_id}\n"
        f"状态：待支付（演示环境，实际预订请前往平台完成支付）"
    )


class BookTrainInput(BaseModel):
    """预订火车票/高铁票工具的入参结构"""
    train_number: str = Field(description="要预订的车次号，例如 'G7175'")
    departure_date: str = Field(description="出发日期，格式 YYYY-MM-DD")
    passenger_name: str = Field(description="乘车人姓名")
    contact_phone: str = Field(description="联系人手机号")
    seat_type: str = Field(default="二等座", description="座位类型：二等座 / 一等座 / 商务座 / 硬卧 / 软卧 等")


@tool("book_train", args_schema=BookTrainInput)
def book_train(
    train_number: str,
    departure_date: str,
    passenger_name: str,
    contact_phone: str,
    seat_type: str = "二等座",
) -> str:
    """
    预订火车票/高铁票（演示实现）。

    根据车次号、出发日期、乘车人、联系方式、座位类型生成一个预订记录，返回预订结果。
    注意：当前为演示实现，仅用于演示预订流程，不会产生真实订单。
    真实预订需通过途牛 bookTrain 工具（需实名信息：身份证号等）。
    """
    import uuid
    order_id = "TR" + uuid.uuid4().hex[:10].upper()
    return (
        f"火车票预订成功（演示）\n"
        f"车次号：{train_number}\n"
        f"出发日期：{departure_date}\n"
        f"座位类型：{seat_type}\n"
        f"乘车人：{passenger_name}\n"
        f"联系电话：{contact_phone}\n"
        f"订单号：{order_id}\n"
        f"状态：待支付（演示环境，实际购票请前往 12306 / 平台完成）"
    )


# ---------------------------------------------------------------------------
# 三、途牛 CLI 真实数据接入（subprocess）
#
# 注意：tuniu-cli 是普通 CLI 工具，不是 MCP server。
# 调用方式：tuniu call <service> <tool> -a '<json>' --output json
# 服务/工具命名需先用 `tuniu list` / `tuniu list hotel` / `tuniu list flight` 发现。
# ---------------------------------------------------------------------------

def _find_tuniu() -> Optional[str]:
    """
    查找 tuniu 命令的绝对路径。

    在 langgraph dev / 多 Python 环境等场景下，subprocess 进程的 PATH 经常
    与 Git Bash / 当前 shell 不一致，导致 shutil.which("tuniu") 返回 None。
    这里显式按以下顺序查找：
        1. shutil.which("tuniu")  — 标准 PATH
        2. shutil.which("tuniu.cmd")  — Windows 的 cmd shim
        3. WorkBuddy 自带的 node 目录（.workbuddy/binaries/node/versions/<ver>/）
        4. 常见 npm 全局目录：%APPDATA%\npm, %LOCALAPPDATA%\npm, C:\npm-global
        5. npx -y tuniu-cli 兜底（不返回具体路径，由调用方处理）
    """
    # 1) 标准 PATH
    for name in ("tuniu", "tuniu.cmd", "tuniu.exe", "tuniu.bat", "tuniu.ps1"):
        p = shutil.which(name)
        if p:
            return p
    # 2) WorkBuddy 自带的 node 目录（按 versions 下所有子目录扫描）
    wb_node_root = Path("C:/Users/Administrator/.workbuddy/binaries/node/versions")
    if wb_node_root.is_dir():
        for ver_dir in wb_node_root.iterdir():
            if not ver_dir.is_dir():
                continue
            for candidate in ("tuniu.cmd", "tuniu.exe", "tuniu", "tuniu.bat"):
                p = ver_dir / candidate
                if p.is_file():
                    return str(p)
    # 3) 常见 npm 全局目录
    for var in ("APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "USERPROFILE"):
        base = os.environ.get(var)
        if not base:
            continue
        for sub in ("npm/tuniu.cmd", "npm/tuniu", "npm/tuniu.exe",
                    "Roaming/npm/tuniu.cmd", "Roaming/npm/tuniu"):
            p = Path(base) / sub
            if p.is_file():
                return str(p)
    # 4) 兜底：直接用 npx
    return None


def _run_tuniu(service: str, tool_name: str, args: dict, timeout: int = 30) -> dict:
    """
    调用途牛 CLI 的某个工具，返回解析后的 JSON。

    Args:
        service: 途牛服务名（如 'hotel' / 'flight'）
        tool_name: 工具名（如 'tuniuHotelSearch' / 'searchLowestPriceFlight'）
        args: 工具入参 dict，会被 JSON 序列化后通过 -a 传入
        timeout: subprocess 超时秒数

    Returns:
        dict: 途牛返回的 JSON 数据；失败时返回 {"_error": str, "_raw": str}
    """
    cli = _find_tuniu()
    if not cli:
        # 退化：npx -y tuniu-cli（要求 npx 在 PATH）
        npx = shutil.which("npx") or shutil.which("npx.cmd")
        if not npx:
            return {
                "_error": "tuniu-cli not found. 请先安装：npm install -g tuniu-cli，"
                          "或将 tuniu 所在目录加入 PATH。",
            }
        cmd = [npx, "-y", "tuniu-cli", "call", service, tool_name,
               "-a", json.dumps(args, ensure_ascii=False),
               "--output", "json"]
    else:
        cmd = [cli, "call", service, tool_name,
               "-a", json.dumps(args, ensure_ascii=False),
               "--output", "json"]

    env = os.environ.copy()
    # 注入 API Key 和认证方式（用户已配 TUNIU_API_KEY；这里显式补上 authType）
    if os.getenv("TUNIU_API_KEY"):
        env["TUNIU_API_KEY"] = os.getenv("TUNIU_API_KEY", "")
    env["TUNIU_AUTH_TYPE"] = os.getenv("TUNIU_AUTH_TYPE", "apiKey")

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            encoding="utf-8",
        )
        stdout = proc.stdout.strip()
        stderr = proc.stderr.strip()
        if proc.returncode != 0:
            return {"_error": f"tuniu-cli exit {proc.returncode}", "_stderr": stderr, "_stdout": stdout}
        # 尝试解析 JSON（CLI 在 --output json 时输出纯 JSON；但有时会包表格前缀，先尝试截取首个 JSON 块）
        try:
            return json.loads(stdout)
        except json.JSONDecodeError:
            # 截取首个 { 到末尾的 JSON 子串
            start = stdout.find("{")
            end = stdout.rfind("}")
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(stdout[start:end + 1])
                except json.JSONDecodeError:
                    pass
            return {"_error": "tuniu-cli output is not JSON", "_stdout": stdout, "_stderr": stderr}
    except subprocess.TimeoutExpired:
        return {"_error": f"tuniu-cli timeout after {timeout}s"}
    except FileNotFoundError:
        return {"_error": "tuniu-cli not found (npm install -g tuniu-cli)"}
    except Exception as e:
        return {"_error": f"{type(e).__name__}: {e}"}


def _format_hotel_result(data: Any) -> str:
    """把途牛酒店数据格式化成可读文本（含图片）"""
    if isinstance(data, dict) and data.get("_error"):
        return f"调用途牛真实数据失败：{data['_error']}\n（已自动降级为 Mock）"

    # 途牛 CLI 返回结构示例：
    # {"success": true, "result": {"content":[{"type":"text","text":"<内层 JSON 字符串>"}]}}
    payload = _unwrap_tuniu_payload(data)
    if isinstance(payload, dict) and payload.get("_error"):
        return f"调用途牛真实数据失败：{payload['_error']}\n（已自动降级为 Mock）"

    # 兼容多种结构：可能 list / dict{ hotels: [...] } / dict{ data: [...] }
    items: list = []
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        for key in ("hotels", "data", "items", "result", "hotelList"):
            if key in payload and isinstance(payload[key], list):
                items = payload[key]
                break
        if not items and ("hotelName" in payload or "hotel_name" in payload or "name" in payload):
            items = [payload]

    if not items:
        return f"途牛返回了空结果：{json.dumps(payload, ensure_ascii=False)[:500]}"

    lines = [f"已查询酒店（实时数据，共 {len(items)} 家）：", ""]
    for i, h in enumerate(items[:10], 1):
        name = h.get("hotelName") or h.get("hotel_name") or h.get("name") or "未知酒店"
        star = h.get("starName") or h.get("star_name") or ""
        score = h.get("commentScore") or h.get("comment_score") or h.get("score") or h.get("rating")
        brand = h.get("brandName") or h.get("brand_name") or ""
        business = h.get("business") or h.get("area") or ""
        price = h.get("lowestPrice") or h.get("minPrice") or h.get("price")
        price_str = f"¥{price}起" if price else "价格请询详情"
        location = h.get("address") or h.get("location") or ""
        distance = h.get("distance") or ""
        digest = h.get("commentDigest") or h.get("comment_digest") or ""
        meal = h.get("meal") or ""

        # 标题：序号 · 酒店名
        title = f"{i}. {name}"
        if star:
            title += f"（{star}）"
        lines.append(title)

        meta = []
        if brand:
            meta.append(f"品牌：{brand}")
        if score is not None:
            meta.append(f"评分：{score}分")
        if business:
            meta.append(f"商圈：{business}")
        if location:
            meta.append(f"地址：{location}")
        if distance:
            meta.append(distance)
        meta.append(f"价格：{price_str}")
        if meal:
            meta.append(f"餐食：{meal}")
        if meta:
            lines.append("  " + " ｜ ".join(meta))
        if digest:
            lines.append(f"点评：{digest}")

        # 图片：途牛 hotel_search 返回 firstPic（单张缩略图）
        # 注意：图片行不要缩进，否则会被 Markdown 解析器当成代码块/嵌套列表，
        #       导致前端 react-markdown 无法渲染成 <img>
        first_pic = h.get("firstPic") or h.get("first_pic")
        if first_pic:
            lines.append(f"![{name}]({first_pic})")

        lines.append("")
    lines.append("（数据来源：途牛开放平台实时数据）")
    return "\n".join(lines)


def _format_flight_result(data: Any) -> str:
    """把途牛航班数据格式化成可读文本"""
    if isinstance(data, dict) and data.get("_error"):
        return f"调用途牛真实数据失败：{data['_error']}\n（已自动降级为 Mock）"

    payload = _unwrap_tuniu_payload(data)
    if isinstance(payload, dict) and payload.get("_error"):
        return f"调用途牛真实数据失败：{payload['_error']}\n（已自动降级为 Mock）"

    items: list = []
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        for key in ("flights", "data", "items", "result", "flightList", "flightInfoList"):
            if key in payload and isinstance(payload[key], list):
                items = payload[key]
                break
        if not items:
            # 兼容 {"flightList":{"flightInfoList":[...]}}
            flight_list = payload.get("flightList")
            if isinstance(flight_list, dict):
                inner = flight_list.get("flightInfoList") or flight_list.get("items")
                if isinstance(inner, list):
                    items = inner

    if not items:
        return f"途牛返回了空结果：{json.dumps(payload, ensure_ascii=False)[:500]}"

    lines = [f"已查询航班（实时数据，共 {len(items)} 个）：", ""]
    for i, f in enumerate(items[:10], 1):
        flight_no = f.get("flightNo") or f.get("flightNumber") or f.get("flightNo") or "—"
        airline = f.get("airlineName") or f.get("airline") or f.get("airlineCode") or ""
        dep = f.get("departureTime") or f.get("depTime") or ""
        arr = f.get("arrivalTime") or f.get("arrTime") or ""
        base_price = f.get("basePrice")
        total_tax = f.get("totalTax")
        if base_price is not None and total_tax is not None:
            price_str = f"¥{base_price}+机建¥{total_tax}"
        else:
            price = f.get("price") or f.get("lowestPrice")
            price_str = f"¥{price}" if price else "—"
        lines.append(f"{i}. {flight_no}（{airline}）｜ {dep} → {arr} ｜ {price_str}")
    lines.append("")
    lines.append("（数据来源：途牛开放平台实时数据）")
    return "\n".join(lines)


def _unwrap_tuniu_payload(data: Any) -> Any:
    """
    途牛 CLI 返回的 JSON 经常是这种嵌套结构：
      {"success": true, "result": {"content":[{"type":"text","text":"<内层 JSON 字符串>"}]}, ...}
    本函数剥掉外层包装，返回真正的业务数据。
    """
    if not isinstance(data, dict):
        return data
    # 已经是 _error 包裹的，直接返回
    if "_error" in data:
        return data
    # 标准 MCP 风格包装
    if "result" in data and isinstance(data["result"], dict):
        result = data["result"]
        if "content" in result and isinstance(result["content"], list) and result["content"]:
            first = result["content"][0]
            if isinstance(first, dict) and first.get("type") == "text" and "text" in first:
                try:
                    return json.loads(first["text"])
                except (json.JSONDecodeError, TypeError):
                    return {"_error": "tuniu-cli inner payload not JSON", "_raw": str(first.get("text"))[:300]}
        return result
    return data


@tool("search_hotels_real", args_schema=HotelSearchInput)
def search_hotels_real(
    city: str,
    check_in: str,
    check_out: str,
    location: Optional[str] = None,
    budget_min: Optional[int] = None,
    budget_max: Optional[int] = None,
    star_rating: Optional[str] = None,
    guests: int = 2,
) -> str:
    """
    查询酒店信息（实时数据，走途牛 CLI）。

    需要配置环境变量 TUNIU_API_KEY；未配置或调用失败时，会返回降级提示。
    """
    # 途牛 tuniuHotelSearch 真实入参：
    #   第一页：cityName（必填）+ 可选 checkIn / checkOut / keyword / poiName / prices 等
    args = {
        "cityName": city,
        "checkIn": check_in,
        "checkOut": check_out,
    }
    if location:
        args["keyword"] = location
    # 途牛 prices 字段是字符串（如 "400-1500"），不是对象
    if budget_min is not None and budget_max is not None:
        args["prices"] = f"{budget_min}-{budget_max}"
    elif budget_min is not None:
        args["prices"] = f"{budget_min}-"
    elif budget_max is not None:
        args["prices"] = f"-{budget_max}"

    data = _run_tuniu("hotel", "tuniuHotelSearch", args)
    return _format_hotel_result(data)


@tool("search_flights_real", args_schema=FlightSearchInput)
def search_flights_real(
    departure_city: str,
    arrival_city: str,
    departure_date: str,
    return_date: Optional[str] = None,
    passengers: int = 1,
    cabin_class: str = "经济舱",
) -> str:
    """
    查询航班信息（实时数据，走途牛 CLI）。

    需要配置环境变量 TUNIU_API_KEY；未配置或调用失败时，会返回降级提示。
    """
    # 途牛 searchLowestPriceFlight 真实入参：
    #   departureCityName / arrivalCityName / departureDate（必填），searchType 可选
    args = {
        "departureCityName": departure_city,
        "arrivalCityName": arrival_city,
        "departureDate": departure_date,
    }

    data = _run_tuniu("flight", "searchLowestPriceFlight", args)
    return _format_flight_result(data)


# ---------------------------------------------------------------------------
# 三-b、火车票查询（实时数据，走途牛 CLI）
# ---------------------------------------------------------------------------

class TrainSearchInput(BaseModel):
    """查火车票/高铁票工具的入参结构"""
    departure_city: str = Field(description="出发站城市或车站名，例如 '南京' 或 '南京南'")
    arrival_city: str = Field(description="到达站城市或车站名，例如 '上海' 或 '上海虹桥'")
    departure_date: str = Field(description="出发日期，格式 YYYY-MM-DD，例如 '2026-09-10'")
    departure_time: Optional[str] = Field(default=None, description="出发时间范围筛选，如 '08:00-12:00'")
    sort: str = Field(default="5", description="排序方式：1出发最早 2出发最晚 3耗时最短 4耗时最长 5价格最低(默认) 6价格最高")


def _format_train_result(data: Any) -> str:
    """把途牛火车票数据格式化成可读文本"""
    if isinstance(data, dict) and data.get("_error"):
        return f"调用途牛真实数据失败：{data['_error']}\n（已自动降级为 Mock）"

    payload = _unwrap_tuniu_payload(data)
    if isinstance(payload, dict) and payload.get("_error"):
        return f"调用途牛真实数据失败：{payload['_error']}\n（已自动降级为 Mock）"

    items: list = []
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        for key in ("trains", "data", "items", "result", "trainList", "trainInfoList"):
            if key in payload and isinstance(payload[key], list):
                items = payload[key]
                break

    if not items:
        return f"途牛返回了空结果：{json.dumps(payload, ensure_ascii=False)[:500]}"

    # 座位类型中文名（价格 dict 的 key → 中文）
    SEAT_NAMES = {
        "swzPrice": "商务座", "tdzPrice": "特等座", "ydzPrice": "一等座", "edzPrice": "二等座",
        "gjrwPrice": "高级软卧", "rwPrice": "软卧", "ywPrice": "硬卧", "rzPrice": "软座",
        "yzPrice": "硬座", "wzPrice": "无座", "ydwPrice": "一等卧", "edwPrice": "二等卧",
        "dwPrice": "动卧",
    }

    lines = [f"已查询火车票（实时数据，共 {len(items)} 个车次）：", ""]
    for i, t in enumerate(items[:10], 1):
        train_no = t.get("trainNum") or t.get("trainNo") or t.get("trainNumber") or "—"
        dep_station = t.get("departStationName") or t.get("fromStationName") or t.get("departureStation") or ""
        arr_station = t.get("destStationName") or t.get("toStationName") or t.get("arrivalStation") or ""
        dep_time = t.get("departureTime") or t.get("fromTime") or ""
        arr_time = t.get("arrivalTime") or t.get("toTime") or ""
        duration = t.get("duration") or t.get("spendTime") or ""
        train_type = t.get("trainType") or ""

        # 时间只保留 HH:MM 部分（原始是 "2026-09-10 00:08"）
        dep_hm = dep_time.split(" ")[-1][:5] if " " in str(dep_time) else str(dep_time)[:5]
        arr_hm = arr_time.split(" ")[-1][:5] if " " in str(arr_time) else str(arr_time)[:5]

        # 票价：price 是 dict，取二等座/一等座/商务座等关键座位价格
        price_map = t.get("price") or {}
        seat_info = []
        for key, cn in SEAT_NAMES.items():
            val = price_map.get(key)
            if val not in (None, "", "0"):
                seat_info.append(f"{cn}¥{val}")
        # 余票
        avail = t.get("seatAvailable") or {}
        avail_map = {
            "swzNum": "商务座", "tdzNum": "特等座", "ydzNum": "一等座", "edzNum": "二等座",
            "gjrwNum": "高级软卧", "rwNum": "软卧", "ywNum": "硬卧", "rzNum": "软座",
            "yzNum": "硬座", "wzNum": "无座",
        }
        avail_info = []
        for key, cn in avail_map.items():
            n = avail.get(key)
            if n is not None:
                avail_info.append(f"{cn}余{n}")

        head = f"{i}. {train_no}"
        if train_type and train_type != "direct":
            head += f"（{train_type}）"
        lines.append(head)
        if dep_station or arr_station:
            lines.append(f"   {dep_station} {dep_hm} → {arr_station} {arr_hm} ｜ 耗时 {duration}")
        if seat_info:
            lines.append("   票价：" + " ｜ ".join(seat_info))
        if avail_info:
            lines.append("   余票：" + " ｜ ".join(avail_info))
        lines.append("")
    lines.append("（数据来源：途牛开放平台实时数据）")
    return "\n".join(lines)


@tool("search_trains_real", args_schema=TrainSearchInput)
def search_trains_real(
    departure_city: str,
    arrival_city: str,
    departure_date: str,
    departure_time: Optional[str] = None,
    sort: str = "5",
) -> str:
    """
    查询火车票/高铁票信息（实时数据，走途牛 CLI）。

    根据出发站、到达站、出发日期查询火车票车次列表，返回车次号、出发/到达时间、
    最低票价等信息。适用于高铁、动车、普速列车。

    需要配置环境变量 TUNIU_API_KEY；未配置或调用失败时，会返回降级提示。
    """
    # 途牛 searchLowestPriceTrain 真实入参：
    #   departureCityName / arrivalCityName / departureDate（必填），searchType 可选
    args = {
        "departureCityName": departure_city,
        "arrivalCityName": arrival_city,
        "departureDate": departure_date,
        "searchType": sort,
    }
    if departure_time:
        args["departureTime"] = departure_time

    data = _run_tuniu("train", "searchLowestPriceTrain", args)
    return _format_train_result(data)


# ---------------------------------------------------------------------------
# 四、统一入口：真实优先 + Mock 兜底
# ---------------------------------------------------------------------------

def _real_tools():
    """返回途牛真实工具（包装为 LangChain tool）+ 预订演示工具"""
    return [
        search_hotels_real, search_flights_real, search_trains_real,
        book_flight, book_hotel, book_train,
    ]


def _mock_tools():
    """返回内置的 Mock 工具列表"""
    return [search_flights, search_hotels, search_trains_real, book_flight, book_hotel, book_train]


def get_tools():
    """
    返回旅游相关的工具列表（真实优先，Mock 兜底）。

    逻辑：
        1. 若配置了 TUNIU_API_KEY，则使用途牛 CLI subprocess 工具（实时数据 + 酒店图片）；
        2. 若未配置 Key 或调用失败，自动降级为 Mock 工具（保证无 Key 也能跑通演示）。
    """
    tuniu_key = os.getenv("TUNIU_API_KEY", "")
    if tuniu_key:
        # 优先返回真实工具（不预热，懒调用：subprocess 一次最多 30s，超时不阻塞）
        return _real_tools()
    return _mock_tools()


# ---------------------------------------------------------------------------
# 五、独立运行测试
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("工具列表：", [t.name for t in get_tools()])
    print("=" * 60)
    if os.getenv("TUNIU_API_KEY"):
        print("检测到 TUNIU_API_KEY，将尝试走途牛真实数据：")
        print("--- 查酒店 ---")
        print(search_hotels_real.invoke({
            "city": "上海",
            "check_in": "2026-09-10",
            "check_out": "2026-09-11",
            "location": "市中心",
        }))
        print("--- 查航班 ---")
        print(search_flights_real.invoke({
            "departure_city": "北京",
            "arrival_city": "上海",
            "departure_date": "2026-09-10",
        }))
    else:
        print("未配置 TUNIU_API_KEY，走 Mock 演示：")
        print(search_flights.invoke({
            "departure_city": "北京",
            "arrival_city": "上海",
            "departure_date": "2026-09-10",
        }))
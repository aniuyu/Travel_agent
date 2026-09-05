---
name: travel
description: 实时旅游数据查询技能。当用户需要查询实时航班/票价、酒店列表/住宿价格、酒店图片，或预订机票酒店时使用。基于途牛 CLI 真实数据（subprocess 方式），必须遵循「先确认关键信息再查询」的流程。
---

# 实时旅游数据查询技能（travel）

## 目标

基于途牛 CLI（`tuniu-cli` npm 包）的实时数据，帮用户查航班票价、酒店价格与图片，并完成预订。绝不捏造数据——一切以工具真实返回为准。

## 一、接入说明

本技能依赖途牛 CLI（`content/mcps/travel_mcp.py` 中实现）。

**关键事实**：`tuniu-cli` 是**普通 CLI 工具**，不是 MCP server。调用方式是：

```
tuniu call <service> <tool> -a '<json_args>' --output json
```

工具清单（配置 `TUNIU_API_KEY` 后生效）：

| 工具 | 途牛 CLI 调用 | 用途 | 是否含图片 |
|------|--------------|------|:---:|
| `search_flights_real` | `tuniu call flight flight_search -a '{...}'` | 机票搜索：实时查询各舱位价格 | ❌ |
| `search_hotels_real` | `tuniu call hotel hotel_search -a '{...}'` | 酒店搜索：返回酒店名/价格/评分/**图片 URL** | ✅ 含酒店图片 URL |
| `book_flight` | (Mock) | 机票预订（演示） | ❌ |
| `book_hotel` | (Mock) | 酒店预订（演示） | ❌ |

> 未配置 `TUNIU_API_KEY` 时，系统自动降级为 Mock 演示数据（`search_flights` / `search_hotels` / `book_flight` / `book_hotel`）。

## 二、调用前必须确认的信息（红线）

**查航班**前必须确认：出发地、目的地、出发日期（返程日期如往返）。缺则先问。

**查酒店**前必须确认：城市、入住日期、退房日期。可选：关键词/商圈、价格区间、评分。

**看酒店图片**：先通过 `search_hotels_real` 拿到酒店列表（含图片 URL），再用 Markdown 图片语法 `![](url)` 直接渲染给用户。

## 三、智能调用流程

### 查航班
1. 确认出发/到达城市、日期。
2. 调用 `search_flights_real` 查询。
3. 结果按价格排序，标出最便宜/最快/性价比。

### 查酒店（必须带评分和图片）
1. 确认城市、入住/退房日期、偏好（商圈/预算/评分）。
2. 调用 `search_hotels_real` 拿到酒店列表（含评分、价格、图片 URL）。
3. **展示图片**：把返回的酒店图片 URL 直接以 Markdown 图片语法 `![](url)` 展示。
4. 按「评分 × 价格 × 位置」排序，给首选 + 备选。

### 预订
- 用户确认方案后，提供姓名/联系方式，调用 `book_flight` / `book_hotel`（演示）。

## 四、红线

- ❌ 绝不虚构航班号、价格、酒店名、评分、图片。
- ❌ 工具失败时如实告知，绝不编造数据顶替。
- ✅ 价格为实时参考价，提醒"以出票/下单时为准"。
- ✅ 图片 URL 来自工具返回，禁止用网络搜索拼凑假图。

## 五、API Key 配置（给使用者的说明）

1. 打开途牛开放平台：**https://open.tuniu.com/mcp**
2. 注册登录 → 控制台 → 申请 API Key。
3. 在项目 `.env` 中配置：
   ```
   TUNIU_API_KEY=你的APIKey（通常以 sk- 开头）
   TUNIU_AUTH_TYPE=apiKey
   ```
4. 安装途牛 CLI（一次性）：
   ```
   npm install -g tuniu-cli
   ```
5. 重启 `langgraph dev` 后，`travel_mcp.get_tools()` 会自动使用途牛真实工具。

> 注意：如果 npm 全局目录不在 PATH，可以不装全局，`travel_mcp` 会自动用 `npx -y tuniu-cli` 调用。
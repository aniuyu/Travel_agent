# 项目长期备忘（kunkun-models/ai_agent2 · 飞云通旅游平台）

## 文档体系（三份 md，别写重复内容）

| 文件 | 定位 | 面向 |
|---|---|---|
| `PROJECT_OVERVIEW.md` | 项目说明文档（技术细节、目录结构、快速开始） | 开发者 / 交接 |
| `RESUME_PROJECT.md` | 简历项目描述（含项目背景 / 标准版 / 精简版 / 面试亮点表） | 简历投递 |
| `INTERVIEW_GUIDE.md` | 面试口述稿（30s / 3min / 10min）+ 6 亮点 + 6 踩坑 + 8 组 Q&A + 风险提示 | 面试 |

> 写新文档前先看这三份，避免重复劳动；相关内容优先补充到已有文件。

## 架构速览
- 后端：`app.py`（FastAPI，端口 8000）—— 注册/登录、行程规划 `/trip/plan`、行程保存 `/trip/save`、`/trips/mine`、`/trips/delete`、分享 `/share/create` `/share/{id}`、酒店高德 `/hotels/search` `/hotels/detail` `/hotels/photos` `/districts`、对话 WebSocket `/chat`
- 前端：`sub_projects/agent-chat-ui`（Next.js + Tailwind v4 + pnpm），后台工作台在 `/workspace?t=xxx`
- 数据：MySQL（`conn/user_db.py`、`conn/share_db.py`，表 `itinerary_share`）；行程 payload 存在 `payload` JSON 字段
- 第三方：高德 POI（AMAP_KEY）、途牛（TUNIU_API_KEY，走 `tuniu` CLI）、wttr.in 天气

## 重要坑位（务必注意）

### 1. `content/mcps/*.get_tools()` 用了 `asyncio.run()`
- `travily_search.py` / `ppt_mcp.py` 的 `get_tools()` 内部是 `asyncio.run(client.get_tools())`
- 因此 **绝不能在已有运行中事件循环的地方直接 import `agent`**
  （`app.py` 的 `/chat` 就踩过：报 `asyncio.run() cannot be called from a running event loop`）
- 正确做法：在子线程里导入 → `await asyncio.to_thread(_load_agent)`（见 `app.py` 的 `get_agent()`）
- agent 首次加载约 10~12s（要连 MCP），之后缓存复用

### 1.1 `/chat` WebSocket 协议（支持终止 + 记忆）
- 客户端发：`{"query": "...", "session_id": "..."}` 发起一轮；`{"type": "stop"}` 终止当前生成
- 服务端发：普通 token / updates JSON / `[END]` / `[STOPPED]` / `[ERROR] xxx`
- 实现用**并发 reader 任务 + asyncio.Queue**，否则流式生成期间收不到 stop 信号
- 前端要点：updates JSON 一律不当正文；空白 token 不建气泡；流式渲染要节流 + memo
- **多轮上下文**：`create_deep_agent(..., checkpointer=MemorySaver())` + `config={"configurable":{"thread_id": session_id}}`
  - 前端把 session_id 存 `localStorage["fy_chat_session"]`，刷新页面后沿用同一 thread
  - 「新对话」按钮 = 重新生成 session_id 写 localStorage + 清空 UI + 关 socket
  - 注意：`MemorySaver` 是进程内存储，**后端重启会丢失所有会话**（生产可换 Postgres/Sqlite）

### 1.2 `app.py` /chat 历史 bug：finally 里引用了未定义变量 e
- 位置：`websocket_chat` 的最外层 `finally` 块里有 `await websocket.send_text(f"[ERROR] {str(e)}")`
- 现象：success 路径下 `e` 未定义，触发 `UnboundLocalError`；整个 ws 会话关时还会向客户端塞一条 `[ERROR] UnboundLocalError`
- 修复：删掉那行，`except` 块已经负责向客户端发错误了；`finally` 只剩 `reader_task.cancel()`

### 1.3 ChatDock 图片渲染：相对路径 + AI 写错文件名 的兜底链路- **问题**：AI 生图后引用 `![alt](generate_images/xxx.png)`，但 LLM 记不住 uuid，**经常引用一个不存在的文件名**；破图占位
- **根因（两层）**：
  1. 后端没有静态路由暴露 `/agent_files`，前端 3000 端口请求不到 8000 端口的磁盘文件
  2. AI 的相对路径不含 thread_id，前端根本不知道去哪个目录找
- **修复**：
  - `app.py` 新增两条路由：
    - `GET /files/{file_path:path}` → 服务 `D:\agent_files` 下的任意文件（防 `..` 穿越）
    - `GET /files/list?thread_id=...&subdir=...` → 列同目录下所有文件名（按 mtime 倒序）
  - `ChatDock.tsx` 新增 `ChatImg` 组件 + `resolveImgSrc(src, threadId)`：
    - `src` 是相对路径 → 补成 `${window.location.protocol}//${hostname}:8000/files/${threadId}/${path}`
    - `<img onError>` 时拉一次 `/files/list`，用**同目录最近生成**的图片兜底
    - 再失败 → 显示 alt 文本（不再破图占位）
  - `MessageRow` / `MarkdownBody` 都加 `threadId` prop，把 `sessionRef.current` 串下去
- **注意**：
  - `_AGENT_FILES_ROOT = os.path.abspath("/agent_files")` —— 找不到时回落到 `agent_files/` 子目录，避免硬编码炸
  - 前端 dev server (3000) 跨域访问后端 (8000) 已通过 `CORSMiddleware(allow_origins=["*"])` 放行，图片不需要走 Next 的 public/

### 1.4 对话历史双落：前端缓存 + MySQL 完整落库
- **前端缓存（最近 5 轮）**：`ChatDock.tsx` 里 `fy_chat_cache` key 存 localStorage
  - `loadCachedMsgs()` / `saveCachedMsgs()`，`msgs` 用 `useState(() => loadCachedMsgs())` 初始化 + `useEffect` 监听 `msgs` 自动写缓存（`slice(-10)` 只留 10 条）
  - 点「新对话」`setMsgs([])` 会触发 effect 把缓存清空
- **MySQL 完整落库**：`conn/chat_db.py` 表 `chat_message`
  ```sql
  chat_message(id, session_id, role('user'|'ai'), content TEXT, created_at)
  KEY idx_session(session_id, id)
  ```
  - 落库时机：`/chat` 每轮结束、**发 `[END]/[STOPPED]` 之前**，`asyncio.to_thread(chat_db.insert_message, ...)` 落 user + ai 两条
  - REST：`GET /chat/history?session_id=` 查历史、`DELETE /chat/history?session_id=` 删历史
  - 关键坑：落库必须放在发结束标记**之前**，否则客户端收到 `[END]` 后立刻断开，`to_thread` 可能没跑完就丢了

### 2. 改 Python 后端必须重启 uvicorn
- `app.py`、`conn/**` 改动不会热加载（除非用 `--reload`），需重启 8000 端口进程
- 启动：`.venv/Scripts/python.exe -c "from app import app; import uvicorn; uvicorn.run(app, host='127.0.0.1', port=8000)"`

### 2.1 前端鉴权：`src/middleware.ts` + `src/lib/auth.ts`
- middleware 跑在 edge，只有 cookie 没有 localStorage；读 `fy_auth` cookie 做服务端 302
- `auth.ts` 双写：cookie（max-age 3d，3 天的 cookie + JSON.exp，server / client 任意一侧都能校验） + localStorage `fy_auth`（含 user + exp）
- 兼容旧键：setAuth 时**也写** `fy_login`/`fy_user`，clearAuth 时一并清掉，避免 UI 组件断读
- 登录态访问 `/login` → middleware 自动送回 `/workspace`，登录页 useEffect 再兜底一次
- matcher `/`、`/login`、`/workspace/:path*`；不要把 `/_next/*` 或 `api/*` 加进 matcher（会浪费 edge 配额）

### 3. 高德 POI 免费接口的商业字段基本为空
- `biz_ext` 里的 `cost` / `lowest_price` / `star` 常返回 `[]`
- 酒店价格/评分/评价请用 **途牛**（`tuniuHotelSearch` / `tuniuHotelDetail`），图片可用高德（`store.is.autonavi.com`）

### 4. 途牛 CLI 调用
- 装在 workbuddy 托管 node 目录；Next 服务端要**直接调 node.exe + tuniu-cli/bin/tuniu.js**，别用 `.cmd`（Windows 参数转义会失败）
- 返回是 `{success, result:{content:[{type:"text", text:"<json 字符串>"}]}}`，需二次 `JSON.parse`
- 火车 `train.searchLowestPriceTrain`、机票 `flight.searchLowestPriceFlight`、酒店 `hotel.tuniuHotelSearch/tuniuHotelDetail`

### 3.9 途牛图片必须加 `referrerPolicy="no-referrer"`（重要！）

途牛图片有两个 CDN 域名，行为不同：

| 域名 | 防盗链 | 说明 |
|---|---|---|
| `m.tuniucdn.com` | ❌ 无 | 直接可加载 |
| `s.tuniu.net` | ✅ **有** | 带非白名单 Referer → **403 Forbidden** |

浏览器加载图片会带 `Referer: http://localhost:3000/` → `s.tuniu.net` 的图**全部裂掉**（表现为空白/占位）。
curl 不带 Referer 时却是 200，所以容易误判成"图片没问题"。

**解法**：所有渲染途牛图片的 `<img>` 加 `referrerPolicy="no-referrer"`
（浏览器就不发 Referer，防盗链放行）。

已加的地方：`ToursPanel` / `CarRentalPanel` / `HotelsPanel`（酒店卡片 / 详情大图 / 环境图缩略 / 房型图）。
**新增展示途牛图的组件时别忘了加**。

配套：`onError` 不要只 `display:none`（会留空白），要显示占位（如「🏞️ 暂无图片」）。

### 3.10 tuniu CLI 在 Windows 会偶发崩溃（已加重试）

报错形如：
```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
```
是 libuv 在 Windows 上的已知竞态，**重试一次就能成功**（实测首次 500 → 重试 200）。

`src/app/api/tuniu/route.ts` 的 `runTuniu()` 已内置重试：
只对 `/Assertion failed|UV_HANDLE_CLOSING/` 这类瞬时错误重试（间隔 300ms），
业务错误（参数错、无权限等）直接抛出，不浪费一次调用。

### 4.0 途牛能力边界（已全量核对，别再重复试）
`tuniu list` 只有 **9 个 server**，工具全集如下：

| server | 工具 | 覆盖业务 |
|---|---|---|
| `flight` | searchLowestPriceFlight / multiCabinDetails / getBookingRequiredInfo / saveOrder / cancelOrder | 国内机票 |
| `intelflight` | list_intel_flights / list_intel_round_trip_flights / get_intel_flight_details / … | 国际机票 |
| `train` | searchLowestPriceTrain / queryTrainDetail / bookTrain / queryTrainOrderDetail / cancelOrder | 火车票 |
| `hotel` | tuniuHotelSearch / tuniuHotelDetail / tuniuHotelCreateOrder | 酒店 |
| `ttms-hotel` | （需 sk- 前缀专用 key） | 企业商旅酒店 |
| `ticket` | query_cheapest_tickets / get_ticket_book_form / create_ticket_order | 门票 |
| `cruise` | searchCruiseList / getCruiseProductDetail / … | 邮轮 |
| `holiday` | searchHolidayList / getHolidayProductDetail / getHolidayBookingRequiredInfo / saveHolidayOrder | **度假产品（跟团 / 自助游 / 自驾游）** |
| `package-booking` | package_booking_create / package_booking_submit | 打包订（机/火/酒/门票任两类组合） |

**⚠️ 途牛没有「保险」和「纯租车」接口**（已核对全部工具名）。要这两个能力必须：
- **租车** → 高德 POI 搜「汽车租赁」拿真实门店（`GET /poi/search?city=&keyword=`），
  或途牛 `holiday` 的 `queryTypeName=自驾游`（打包产品，非裸车租赁）；
  真要比价下单需接专业租车平台 API（神州/一嗨）或聚合 API（携程/飞猪）
- **保险** → `POST /insurance/advice`（LLM 出常识性建议，`source=ai|fallback`）；
  真投保需接保险公司开放平台或聚合保险 API

**holiday 关键参数**：`queryTypeName` 只接受精确枚举 `跟团 / 自助游 / 自驾游`，传错会调用失败。
返回 `data.count`（总数）+ `data.rows[]`（productId / productName / price / tourDay / queryType /
satisfy / peopleNum / picUrl / customConditionName / brandTypeName）。

**holiday 详情 `getHolidayProductDetail`（4 个必填，全部来自列表行，缺一不可）**：
- `productId` ← 行内 `productId`
- `departCityCode` ← 行内 `departCityCode`，**必须是数组且原样传**（如 `[0]`，服务端取首元素）
- `classBrandParentId` ← 行内 `classBrandId`
- `proMode` ← 行内 `proMode`
- `departsDateBegin/End` 仅在列表行明确返回时才成对传

> ⚠️ 所以 `normalizeHolidays()` 必须把这 4 个字段一起带出来（前端要用来调详情）。
> 详情返回：`productName`(HTML 转义) / `departureCityName` / `duration` / `productNight` /
> `characteristic` / `productPicList[]` / `customCondition[]` /
> **`productPriceCalendar`**（count + rows[].departDate/tuniuPrice/tuniuChildPrice）/
> **`journeySummary`（是 list 不是 dict！）**，每项 `{day, title, moduleList[]}`，
> moduleList 项按 `moduleType` 分 hotel/scenic/food/activity/reminder/shopping/flight/traffic。

### 4.1 车票/机票：余票详情 + 分页（重要）
- **余票详情工具**（点「预订」才调，按需拉取）：
  - 火车：`train.queryTrainDetail`，参数 `departureStationName / arrivalStationName / departureDate / trainNum`
    - 返回路径 **多一层 data 包裹**：`{successCode, data:{trainInfo, seatInfo[]}}`
    - `seatInfo[]` 每项：`seatName`(无座/硬座/硬卧/软卧...) / `price` / `leftNumber` / `seatStatus` / `resId`
  - 机票：`flight.multiCabinDetails`，参数 `departureCityName / arrivalCityName / departureDate / flightNo`
    - `cabinInfo[]` 每项：`cabinClass` / `basePrice` / `totalTax` / `remainingSeats` / `baggageInfo` / `refundChangeRule` / `buyCondition` / `cabinPriceId`
    - 注意 `buyCondition` 可能是字符串 `"null"`，要过滤
- **分页**：
  - 火车：首次返回 `queryId`，翻页传 `{queryId, pageNum}`（**不需要城市日期**）
  - 机票：传 `{...城市日期, pageNum}`
- **searchType 决定排序，直接影响车型展示**（踩过的坑）：
  - `1` 出发时间升序（**默认用这个**，能混合高铁/动车/普速）
  - `5` 票价升序 ← 原代码用的这个，导致一页全是普速 K/T/Z
  - 每页 30 条，所以排序 + 分页会让某页车型单一
- **车型判断别信 `trainType` 字段**：搜索接口只给 `"direct"`，区分不了高铁/普速，
  必须按**车次号前缀**：G 高铁 / D 动车 / C 城际 / Z 直达 / T 特快 / K 快速 / 纯数字 普快

### 5. 前端字段映射要对准后端真实结构
- 行程 payload：`from_city` / `destination` / `days`(已是 "3天") / `itinerary_per_tier`(按档位分组的字典) / `plans` / `hotels` / `tickets` / `weather` / `ai_summary`
- 途牛酒店房型字段：`roomTypeName` / `roomSize` / `images[]` / `floor`（不是 roomName/roomArea/pic/window）
- `cancelText` 是短文案、`cancelDesc` 是长段落

### 5.0 `extra_notes`（额外要求）的完整链路
用户填的「额外要求」在 `plan_trip` 里有 **3 条消费路径**，缺一条就会出现"写了没效果"：
1. **提取结构化资源**：`_extract_specified_hotel` / `_extract_specified_train` 从文本里抓酒店名/车次号
2. **喂给 LLM 生成文案**：`notes_section` 塞进 summary prompt，产出
   - `ai_summary`（整体推荐语）
   - `plans[].dining` ← **餐饮卡片**。注意：`dining` 原本是**硬编码**的（"本帮菜+特色美食"），
     必须由 LLM 的 `dining` 字段覆盖才会生效
   - `extra_note_reply`（对额外要求的一句话落实说明）
3. **回显**：payload 带 `extra_notes` + `extra_note_reply`，详情页左栏「行程信息」末尾渲染展示卡片

> ⚠️ 加新需求时先想清楚：用户的要求是"要影响生成内容"还是"只要被看到"。
> 只做第 3 步（回显）会出现"我写了但没效果"的观感。

> ⚠️ Python f-string 里写中文示例时**不要用英文双引号**（会提前结束字符串），
> 用 `「」` 或转义 `\"`。

## 前端约定
- **筛选条件的输入框语义要明确，别只给单边**（踩过的坑）：
  旅游团页原本只有一个「预算下限 ¥」输入框，用户填 3500 以为是"预算 3500"，
  实际查的是"**¥3500 以上**"→ 结果 0 条，用户以为功能坏了。
  **正确做法**：给「最低价 + 最高价」区间；查不到时自动放宽并告知真实价格区间。
- 面向用户的页面**不要放技术说明块**（平台能力边界、备用方案、实现细节）——
  这些是开发向信息，归档到本文档即可
- 折叠/展开类 UI 状态要持久化到 localStorage（如 `fy_sidebar_services_open`），
  且折叠时若当前 tab 属于该分组，标题要保留高亮提示

- 行程名称统一显示 `出发地 → 目的地`
- 长文本放 flex 子项必须配 `min-w-0` + `truncate`，否则会被挤压成竖排
- 行程导出：图片（PNG，html-to-image + `TripExportCard.tsx` 内联样式）；分享：`/share/{id}` 链接（仅本机/局域网可打开）
- **预览 = 导出**：`/share/{id}` 页直接复用 `TripExportCard`，不要另写一套渲染

### 5.1 新建行程「选酒店/选车次」= 跳转 + 回填（不要内嵌 picker）
- 流程：create 页点按钮 → `onNavigate("hotels", {pick:"hotel"})` → `handleNavigate` 拼成 `/workspace?t=hotels&pick=hotel`
  → pick 页点「加入行程」→ 写 `localStorage["fy_pending_pick"] = {kind, value}` → `router.replace("/workspace?t=create")`
  → CreateTripPanel 挂载时 `useEffect` 读该 key 回填 → `removeItem`
- `handleNavigate` 已支持第二参数：`(key, extra?: Record<string,string>)`
- **为什么成立**：tab 是条件渲染，跳转必然导致 CreateTripPanel 卸载/重挂载，所以 `useEffect([], ...)` 每次都会跑
- HotelsPanel / TicketsPanel 用 `useSearchParams().get("pick")` 判 pick 模式，`useRouter()` 跳回
- **`value` 是对象不是字符串**（2026-09-12 增强）：
  - hotel → `{name, price, score, starName, business, address, pic}`
  - ticket → `{number, from, to, depart, arrive, price, category, duration}`
  - 前端 `normalizeHotelPick/normalizeTicketPick` 兼容旧字符串数据
  - 提交时同时传 `selected_xxx`(名称/车次号，兼容) + `selected_xxx_detail`(完整对象)
- 相关 localStorage key：`fy_create_trip_draft`（草稿）/ `fy_pending_pick`（回填信道）/ `fy_tickets_query` / `fy_hotels_query` / `fy_chat_session` / `fy_chat_cache` / `fy_chat_pos` / `fy_chat_size`

#### ⚠️ 5.1.1 选定资源「选了却没用上」的两个真实 bug（2026-09-15 修复）
1. **只管了经济档** —— `plans` 里经济档用 `hotels[0]`、**舒适档用 `hotels[1]`**、豪华档用 `hotels[-1]`。
   用户选定的酒店被置顶到 `hotels[0]`，但用户默认选的是**舒适档** → 看到的是别的酒店。
   **修复**：`specified_hotel and hotels[0].get("user_specified")` → 遍历覆盖 `p["hotel"] = hotels[0]`（所有档位都用选定的）。
2. **命中同名项时只用旧数据** —— 选定资源如果已在列表里（**很常见，用户就是从列表里选的**），
   原代码只打 `user_specified` 标记，**不覆盖字段** → 车次仍显示 mock 的 `08:30 出发 ¥553`，
   而用户选的是 `07:15 出发 ¥139.5`。
   **修复**：抽出 `_apply_hotel_detail(item)` / `_apply_ticket_detail(item)`，
   在 `hit >= 0` 分支也用它覆盖（价格/评分/星级/商圈/站点/时刻/车型/耗时）。

3. **回填入口太窄** —— 只有 `?pick=xxx` 模式才有「加入行程」按钮；
   用户从侧边栏直接进酒店/车票页只能点「预订」（只弹 toast，不写回填数据）。
   **修复**：非 pick 模式也加「+ 行程」次要按钮；详情弹窗底部也加「➕ 加入行程」。
4. **回填加兜底** —— CreateTripPanel 的回填 effect 除了挂载时读一次，
   还加了 5 秒内每 400ms 的轮询兜底，防止组件未重挂载 / 时序竞态丢数据。


### 5.2 ChatDock 默认收起 + 右下角
- `useState(false)` —— 进入页面默认收起，只留右下角「AI 助手」悬浮钮
- `posCustom` state 区分「用户拖过」与「默认位置」：
  - 未拖过 → 收起态用 CSS `right/bottom` 锚定右下角；展开态用 JS 算的右下角坐标
  - 拖过 → 两态都跟随 `pos`
- `fy_chat_pos` 只在 `posCustom` 为 true 时才写入（避免把默认坐标固化）
- `DEFAULT_BOTTOM = 24` 替代原来的 `DEFAULT_TOP`

## 性能与耗时（重要 · 排查过一轮）

### `/trip/plan` 实测 50~60 秒，耗时构成
| 环节 | 耗时 | 说明 |
|---|---|---|
| 5 路网络取数（酒店/车票/机票/景点/天气） | 串行 4.6s → **并发 2.3s** | 已用 ThreadPoolExecutor 并发 |
| **LLM 文案生成** | **40~50s** | **绝对瓶颈，占 90%+** |

### 模型服务本身很慢（实测）
- `llm.invoke("你好")` ≈ **11s**（基础延迟）
- 短 JSON 输出 ≈ 22s
- 完整行程 JSON（6 字段）≈ **43s**

### 结论
**总耗时无法靠代码优化显著改善**（网络只占 4.6s）。可行方向：
1. **换更快的模型** —— 改 `.env` 的 `BASE_LLM`（最有效）
2. **减少 LLM 输出字段/字数** —— 输出越短越快，线性关系
3. **两阶段返回** —— 先返回不含文案的骨架（~5s），AI 文案异步补（改动较大）

### 必做的体验补偿
- 前端**必须**有进度反馈（`genStage()` 阶段文案 + 计时 + 进度条 + 长等待提示），
  否则用户会以为"卡死/模型坏了"。**这次的问题就是这个，不是识别问题。**
- 前端 fetch 加 `AbortController` 超时（150s），避免真无限等待

### 已修的隐藏 bug
- `_ai_summarize(prompt, timeout=20)` 的 **`timeout` 参数原来从未生效**（没传给 LLM）。
  已改用 `ThreadPoolExecutor + future.result(timeout=90)` 实现真实超时；
  **默认 90s**（不能设小，否则 40s+ 的模型调用会被误杀导致文案全部降级）。

### 排查提示
- 独立脚本调 `plan_trip` 时 **tuniu 会返回 None** —— 因为 `trip_planner` 自身不 import `base.config`，
  `.env` 没被加载。脚本里要显式 `from dotenv import load_dotenv; load_dotenv()`。

## 常用命令
```bash
cd sub_projects/agent-chat-ui
node_modules/.bin/tsc --noEmit     # 类型检查
pnpm dev                            # 前端（新增依赖后需重启）
```

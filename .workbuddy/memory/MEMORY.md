# 项目长期备忘（kunkun-models/ai_agent2 · 飞云通旅游平台）

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

## 前端约定
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
  - 后端 `plan_trip` 用 detail 生成真实的 hotels[0]/tickets[0]（否则车次时刻是 `—`）
- 相关 localStorage key：`fy_create_trip_draft`（草稿）/ `fy_pending_pick`（回填信道）/ `fy_tickets_query` / `fy_hotels_query` / `fy_chat_session` / `fy_chat_cache` / `fy_chat_pos` / `fy_chat_size`

### 5.2 ChatDock 默认收起 + 右下角
- `useState(false)` —— 进入页面默认收起，只留右下角「AI 助手」悬浮钮
- `posCustom` state 区分「用户拖过」与「默认位置」：
  - 未拖过 → 收起态用 CSS `right/bottom` 锚定右下角；展开态用 JS 算的右下角坐标
  - 拖过 → 两态都跟随 `pos`
- `fy_chat_pos` 只在 `posCustom` 为 true 时才写入（避免把默认坐标固化）
- `DEFAULT_BOTTOM = 24` 替代原来的 `DEFAULT_TOP`

## 常用命令
```bash
cd sub_projects/agent-chat-ui
node_modules/.bin/tsc --noEmit     # 类型检查
pnpm dev                            # 前端（新增依赖后需重启）
```

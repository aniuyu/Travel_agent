"use client";

/**
 * 悬浮式 AI 对话助手
 *
 * 特点：
 *  - position: fixed 悬浮在页面之上，不占据布局空间（不挤压主内容）
 *  - 拖拽头部可移动，位置持久化到 localStorage
 *  - 支持鼠标与触摸（Pointer Events）
 *  - 可收起为小圆钮
 *
 * 后端：FastAPI WebSocket ws://<host>:8000/chat
 *   发送：{ "query": "...", "session_id": "..." }
 *   接收：① 普通 token（流式增量文本）
 *         ② updates JSON（节点状态，仅用于兜底内容，不做增量拼接，避免重复）
 *         ③ "[END]" 结束标记
 *         ④ "[ERROR] xxx" 错误
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  Send,
  Sparkles,
  X,
  MessageSquare,
  MessageSquarePlus,
  Trash2,
  Bot,
  GripVertical,
  Square,
} from "lucide-react";

interface Msg {
  id: string;
  role: "user" | "ai";
  content: string;
  error?: boolean;
}

// 最近对话缓存（浏览器 localStorage）
const CACHE_KEY = "fy_chat_cache";
const CACHE_MAX_ROUNDS = 5; // 保留最近 5 轮（user + ai 各一条 = 10 条消息）

/** 从 localStorage 恢复最近对话（最多 5 轮） */
function loadCachedMsgs(): Msg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m): m is Msg => m && typeof m.id === "string" && (m.role === "user" || m.role === "ai") && typeof m.content === "string")
      .slice(-CACHE_MAX_ROUNDS * 2); // 最多 10 条
  } catch {
    return [];
  }
}

/** 把最近对话写进 localStorage（只保留最后 5 轮） */
function saveCachedMsgs(msgs: Msg[]): void {
  if (typeof window === "undefined") return;
  try {
    const keep = msgs.slice(-CACHE_MAX_ROUNDS * 2);
    localStorage.setItem(CACHE_KEY, JSON.stringify(keep));
  } catch {
    /* ignore */
  }
}

const FUNC_WS_URL = "ws://127.0.0.1:8000/chat";

// 面板尺寸与边距（拖拽边界计算用）
const PANEL_W = 380;
const EDGE = 8; // 距视口边缘最小留白
const DEFAULT_GAP = 24; // 默认距右边距
const DEFAULT_BOTTOM = 24; // 默认距底（右下角锚点）
// 面板默认高度（与展开态 style 里的计算保持一致，用于右下角定位）
function defaultPanelHeight(): number {
  return Math.min(640, (typeof window !== "undefined" ? window.innerHeight : 800) - 100);
}
const MIN_W = 320; // 最小宽度
const MIN_H = 360; // 最小高度
const POS_KEY = "fy_chat_pos";
const SIZE_KEY = "fy_chat_size";

const QUICK = [
  "帮我查南京到上海的高铁票",
  "推荐上海的酒店",
  "帮我规划一次苏州三日游",
  "北京天气怎么样",
];

// ---------------------------------------------------------------------------
// Markdown 渲染
// remarkPlugins / components 都定义在模块级，保持引用稳定；
// 配合 React.memo，流式输出时只有「正在更新的那一条」会重新解析 Markdown，
// 历史消息不会跟着重渲染（这是抖动/卡顿的主要来源之一）。
// ---------------------------------------------------------------------------
const REMARK_PLUGINS = [remarkGfm];

// 远程图片代理基址：把后端 /agent_files 静态目录映射成 http://<host>:8000/files/...
// 逻辑跟 login 页里的 API_BASE 一致，前端跨域访问后端。
const FILE_BASE =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:8000/files`
    : "http://localhost:8000/files";

/**
 * 把 AI 返回的图片 src 归一化成可访问的 URL
 *   - 已经是 http(s)/data: 的：原样返回
 *   - 相对路径如 generate_images/xxx.png：补成 `${FILE_BASE}/${thread_id}/${path}`
 *     （thread_id 来自运行时闭包，由 React 组件注入；这里只处理不含 thread 的形式）
 *   - 含 thread_id 前缀的：直接补 FILE_BASE
 *   - 找不到 / 不可读的图片：返回 null（让组件渲染占位，不破图）
 */
function resolveImgSrc(src: string | undefined, threadId?: string): string | null {
  if (!src) return null;
  const s = src.trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:")) return s;
  // 已经是 /files/... 形式
  if (s.startsWith("/files/")) return s;
  // 已是 /agent_files/... 形式
  if (s.startsWith("/agent_files/")) return FILE_BASE + s.replace(/^\/agent_files/, "");
  // 形如 "01a07203-4a01-77e1-280/..." 或 "generate_images/xxx.png"
  if (threadId) return `${FILE_BASE}/${threadId}/${s}`.replace(/^\/+/, "");
  // 不知道 thread_id 时也试一下根级：FILE_BASE/...
  return `${FILE_BASE}/${s}`.replace(/^\/+/, "");
}

const MD_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1 whitespace-pre-wrap">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-indigo-600 underline">
      {children}
    </a>
  ),
  // 图片：自动把 AI 给的相对路径补全成后端可访问 URL，加载失败显示 alt 文本
  img: ({ src, alt }) => (
    <ChatImg src={typeof src === "string" ? src : undefined} alt={alt} />
  ),
  code: ({ children, className }) =>
    className ? (
      <code className="block overflow-x-auto rounded-lg bg-gray-900 p-2 text-[11px] text-gray-100">
        {children}
      </code>
    ) : (
      <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[11px]">{children}</code>
    ),
  pre: ({ children }) => <pre className="my-1">{children}</pre>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => <h1 className="my-1 text-base font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="my-1 text-sm font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="my-1 text-sm font-semibold">{children}</h3>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[11px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-gray-300 bg-white/60 px-2 py-1 text-left">{children}</th>,
  td: ({ children }) => <td className="border border-gray-300 px-2 py-1">{children}</td>,
};

const MarkdownBody = memo(function MarkdownBody({ content, threadId }: { content: string; threadId?: string }) {
  // 把当前会话的 thread_id 注入图片渲染：AI 引用的相对路径只有结合 thread_id 才能定位真实文件
  const components: Components = {
    ...MD_COMPONENTS,
    img: ({ src, alt }) => <ChatImg src={typeof src === "string" ? src : undefined} alt={alt} threadId={threadId} />,
  };
  return (
    <div className="chat-md">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

/**
 * 单张图片渲染：
 *   - 把相对路径补全成 FILE_BASE/<thread_id>/<path>，AI 写错的文件名也能加载到
 *   - onError 时拉一次 /files/list?subdir=...，用同目录最近生成的 png 兜底
 *   - 完全找不到时显示 alt 文本，不再出现破图占位
 */
function ChatImg({
  src,
  alt,
  threadId,
}: {
  src?: string;
  alt?: string;
  threadId?: string;
}) {
  const resolved = useMemo(() => resolveImgSrc(src, threadId), [src, threadId]);
  const [finalSrc, setFinalSrc] = useState<string | null>(resolved);
  const [failed, setFailed] = useState(false);

  // src 变化时重置
  useEffect(() => {
    setFinalSrc(resolved);
    setFailed(false);
  }, [resolved]);

  const tryFallback = useCallback(async () => {
    if (!threadId) {
      setFailed(true);
      return;
    }
    // 推断子目录：原 src 第一段路径（相对路径都长这样 generate_images/xxx.png）
    let subdir = "";
    if (src && !src.startsWith("/") && !src.startsWith("http")) {
      const parts = src.replace(/^\/+/, "").split("/");
      if (parts.length >= 2) subdir = parts.slice(0, -1).join("/");
    }
    try {
      const r = await fetch(`${FILE_BASE}/list?thread_id=${encodeURIComponent(threadId)}&subdir=${encodeURIComponent(subdir)}`);
      if (!r.ok) throw new Error("list failed");
      const data = await r.json();
      const pngs = (data.files || []).filter((f: { name: string }) => /\.(png|jpe?g|webp|gif)$/i.test(f.name));
      if (pngs.length === 0) {
        setFailed(true);
        return;
      }
      const cand = pngs[0].name;
      const guess = subdir ? `${FILE_BASE}/${threadId}/${subdir}/${cand}` : `${FILE_BASE}/${threadId}/${cand}`;
      setFinalSrc(guess);
    } catch {
      setFailed(true);
    }
  }, [src, threadId]);

  if (!resolved) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-500">
        🖼 <span className="italic">{alt || "(图片丢失)"}</span>
      </span>
    );
  }

  if (failed) {
    return (
      <a
        href={resolved}
        target="_blank"
        rel="noreferrer"
        className="my-1.5 block text-xs text-indigo-600 underline"
        title="点击尝试打开原 URL"
      >
        🖼 {alt || "(图片加载失败)"}
      </a>
    );
  }

  return (
    <a
      href={finalSrc || resolved}
      target="_blank"
      rel="noreferrer"
      className="my-1.5 block max-w-full"
      title="点击查看大图"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={finalSrc || resolved}
        alt={alt || ""}
        loading="lazy"
        className="max-h-72 max-w-full rounded-lg border border-gray-200 object-contain shadow-sm transition-opacity hover:opacity-90"
        onError={() => {
          // 已尝试过兜底就直接放弃；否则拉一次同目录最新文件
          if (finalSrc !== resolved) {
            setFailed(true);
          } else {
            void tryFallback();
          }
        }}
      />
    </a>
  );
}

/** 单条消息（memo）：内容没变就整条跳过重渲染 */
const MessageRow = memo(function MessageRow({
  role,
  content,
  error,
  threadId,
}: {
  role: "user" | "ai";
  content: string;
  error?: boolean;
  threadId?: string;
}) {
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      {role === "ai" && (
        <div className="mr-2 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500">
          <Bot className="size-3.5 text-white" />
        </div>
      )}
      <div
        className={
          role === "user"
            ? "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-gradient-to-br from-indigo-500 to-purple-500 px-3 py-2 text-sm leading-relaxed text-white"
            : `min-w-0 max-w-[88%] break-words rounded-2xl rounded-bl-sm px-3 py-2 text-sm leading-relaxed ${
                error ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-800"
              }`
        }
      >
        {role === "user" ? content : <MarkdownBody content={content} threadId={threadId} />}
      </div>
    </div>
  );
});

export function ChatDock(): React.ReactNode {
  const [mounted, setMounted] = useState(false);
  // 进入页面默认**收起**，只留右下角悬浮按钮
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // 位置是否是用户手动拖出来的（true 才跟随 pos；false 则收起/展开都用右下角锚点）
  const [posCustom, setPosCustom] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => loadCachedMsgs());
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [unread, setUnread] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string>("");
  const panelRef = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const dragStartRef = useRef<{ sx: number; sy: number } | null>(null);
  const resizeStartRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);
  const movedRef = useRef(false); // 本次拖拽是否真的移动过（用于区分「点击」与「拖动」）
  const openRef = useRef(true);

  // 当前这一轮 AI 回复的累积内容
  const accRef = useRef("");
  const jsonFallbackRef = useRef("");
  const aiMsgIdRef = useRef<string>("");
  // 流式渲染节流：token 可能每秒上百条，逐个 setState 会疯狂重渲染 Markdown
  const flushTimerRef = useRef<number | null>(null);
  // 是否"吸底"（用户没有手动往上滚时自动滚到底）
  const stickRef = useRef(true);
  // 是否已被用户终止（终止后到达的残余消息一律忽略）
  const stoppedRef = useRef(false);

  if (!sessionRef.current) {
    if (typeof window !== "undefined") {
      // 优先沿用上次会话的 session_id —— LangGraph 用它当 thread_id，
      // 配合 checkpointer 就能保留多轮上下文记忆。
      // 点「新对话」按钮会强制更新这一项。
      const cached = localStorage.getItem("fy_chat_session");
      if (cached) sessionRef.current = cached;
    }
    if (!sessionRef.current) {
      sessionRef.current = "s_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem("fy_chat_session", sessionRef.current); } catch { /* ignore */ }
    }
  }

  // 会话中改 session_id（新对话按钮）
  const startNewSession = useCallback(() => {
    if (!panelRef.current) return;
    const fresh = "s_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    sessionRef.current = fresh;
    try {
      localStorage.setItem("fy_chat_session", fresh);
    } catch { /* ignore */ }
    // 清空当前 UI 消息 + 关闭现有 socket（保留引用，下次 send() 会自动重连）
    setMsgs([]);
    try { wsRef.current?.close(); } catch { /* ignore */ }
    setStatus("ok");
    toast.success("已开启新对话");
  }, []);

  // 同步 open 到 ref（finalize 里读取，避免在 setState 更新函数里再触发 setState）
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // 最近对话持久化到浏览器缓存（只保留最后 5 轮）
  useEffect(() => {
    saveCachedMsgs(msgs);
  }, [msgs]);

  // ---------------- 位置：边界收敛 + 读取/保存 ----------------
  const clampPos = useCallback((x: number, y: number) => {
    if (typeof window === "undefined") return { x, y };
    const w = panelRef.current?.offsetWidth ?? PANEL_W;
    const h = panelRef.current?.offsetHeight ?? 620;
    const maxX = Math.max(EDGE, window.innerWidth - w - EDGE);
    const maxY = Math.max(EDGE, window.innerHeight - h - EDGE);
    return {
      x: Math.min(Math.max(x, EDGE), maxX),
      y: Math.min(Math.max(y, EDGE), maxY),
    };
  }, []);

  // 首次挂载：恢复上次位置/尺寸，否则默认右上角
  useEffect(() => {
    setMounted(true);
    let restored: { x: number; y: number } | null = null;
    let restoredSize: { w: number; h: number } | null = null;
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.x === "number" && typeof p?.y === "number") restored = { x: p.x, y: p.y };
      }
      const rawSize = localStorage.getItem(SIZE_KEY);
      if (rawSize) {
        const s = JSON.parse(rawSize);
        if (typeof s?.w === "number" && typeof s?.h === "number") {
          restoredSize = {
            w: Math.max(MIN_W, Math.min(s.w, window.innerWidth - EDGE * 2)),
            h: Math.max(MIN_H, Math.min(s.h, window.innerHeight - EDGE * 2)),
          };
        }
      }
    } catch {
      /* ignore */
    }
    if (restoredSize) setSize(restoredSize);
    // 有恢复位置 → 说明用户之前手动拖过，之后都跟随 pos
    if (restored) setPosCustom(true);

    // 等一帧让面板量到真实尺寸再收敛位置
    requestAnimationFrame(() => {
      setPos((prev) => {
        if (prev) return clampPos(prev.x, prev.y);
        if (restored) return clampPos(restored.x, restored.y);
        // 默认位置：右下角
        const w = restoredSize?.w ?? PANEL_W;
        const h = restoredSize?.h ?? defaultPanelHeight();
        return clampPos(
          window.innerWidth - w - DEFAULT_GAP,
          window.innerHeight - h - DEFAULT_BOTTOM,
        );
      });
    });
  }, [clampPos]);

  // 视口变化时重新收敛，避免窗口跑出屏幕
  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampPos(p.x, p.y) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampPos]);

  // 重新展开时按「面板真实尺寸」再收敛一次（收起态是小圆钮，尺寸不同）
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setPos((p) => (p ? clampPos(p.x, p.y) : p)));
    return () => cancelAnimationFrame(id);
  }, [open, clampPos]);

  // ---------------- 拖拽（Pointer Events，兼容鼠标/触摸）----------------
  /**
   * 开始拖拽
   * @param allowButton 收起态悬浮钮本身就是 <button>，需要放行；
   *                    面板顶栏里的「清空/收起」按钮则不参与拖拽。
   */
  const startDrag = useCallback((e: React.PointerEvent, allowButton = false) => {
    if (!allowButton && (e.target as HTMLElement).closest("button")) return;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffsetRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    dragStartRef.current = { sx: e.clientX, sy: e.clientY };
    movedRef.current = false;
    setDragging(true);
    // 注意：这里不调用 e.preventDefault()。
    // 对 pointerdown 调 preventDefault 可能抑制兼容鼠标事件，导致 <button> 的 click 不触发
    // （收起态悬浮钮要靠 click 打开）。防选中已由 select-none + 拖拽期间的 body.userSelect 处理。
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const off = dragOffsetRef.current;
      if (!off) return;
      // 4px 移动阈值：小于阈值视为点击时的手抖，不移动、也不算「拖动过」
      if (!movedRef.current) {
        const st = dragStartRef.current;
        if (st && Math.hypot(e.clientX - st.sx, e.clientY - st.sy) < 4) return;
        movedRef.current = true;
      }
      setPos(clampPos(e.clientX - off.dx, e.clientY - off.dy));
    };
    const onUp = () => {
      dragOffsetRef.current = null;
      dragStartRef.current = null;
      // 真的拖动过才算「用户自定义位置」
      if (movedRef.current) setPosCustom(true);
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, clampPos]);

  // ---------------- 调整大小（右下角把手）----------------
  const startResize = useCallback((e: React.PointerEvent) => {
    e.stopPropagation(); // 别触发头部拖拽
    const el = panelRef.current;
    if (!el) return;
    resizeStartRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      sw: el.offsetWidth,
      sh: el.offsetHeight,
    };
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: PointerEvent) => {
      const r = resizeStartRef.current;
      if (!r) return;
      // 不能超出视口（面板左上角固定，向右下扩展）
      const maxW = Math.max(MIN_W, window.innerWidth - (pos?.x ?? EDGE) - EDGE);
      const maxH = Math.max(MIN_H, window.innerHeight - (pos?.y ?? EDGE) - EDGE);
      const w = Math.min(Math.max(r.sw + (e.clientX - r.sx), MIN_W), maxW);
      const h = Math.min(Math.max(r.sh + (e.clientY - r.sy), MIN_H), maxH);
      setSize({ w: Math.round(w), h: Math.round(h) });
    };
    const onUp = () => {
      resizeStartRef.current = null;
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing, pos]);

  // 调整结束后保存尺寸
  useEffect(() => {
    if (resizing || !size) return;
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    } catch {
      /* ignore */
    }
  }, [resizing, size]);

  // 拖拽结束保存位置（只在用户手动拖过之后才记，避免把默认右下角坐标写死）
  useEffect(() => {
    if (dragging || !pos || !posCustom) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [dragging, pos, posCustom]);

  // 拖拽/缩放时禁止选中文字
  useEffect(() => {
    if (!dragging && !resizing) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [dragging, resizing]);

  // ---------------- 滚动到底（仅在"吸底"状态时）----------------
  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (!stickRef.current) return; // 用户手动往上翻了，别抢他的滚动
    el.scrollTop = el.scrollHeight;
  }, []);

  // 记录用户是否还停在底部附近（距底 < 80px 视为吸底）
  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    // 用 rAF 等 DOM 更新完再滚，避免在同一帧里读写布局造成抖动
    const id = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(id);
  }, [msgs, sending, scrollToBottom]);

  // ---------------- WebSocket ----------------
  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return wsRef.current;
    }
    let url = FUNC_WS_URL;
    try {
      if (typeof window !== "undefined" && window.location.hostname) {
        url = `ws://${window.location.hostname}:8000/chat`;
      }
    } catch {
      /* 用默认值 */
    }
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setStatus("ok");
    ws.onclose = () => setStatus("err");
    ws.onerror = () => setStatus("err");
    ws.onmessage = (ev) => handleIncoming(String(ev.data));
    return ws;
  }, []);

  useEffect(() => {
    return () => {
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      // 清掉未执行的节流刷新定时器
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  // ---------------- 消息处理 ----------------
  const upsertAi = useCallback((text: string, error = false) => {
    const id = aiMsgIdRef.current;
    setMsgs((prev) => {
      const idx = prev.findIndex((m) => m.id === id);
      if (idx === -1) return [...prev, { id, role: "ai", content: text, error }];
      // 内容没变就不触发重渲染（配合节流，去掉大量无谓渲染）
      if (prev[idx].content === text && prev[idx].error === error) return prev;
      const copy = prev.slice();
      copy[idx] = { ...copy[idx], content: text, error };
      return copy;
    });
  }, []);

  // 节流刷新：累积到 ref，最多约每 60ms 渲染一次
  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      // 后端开头的 token 常常是纯换行（"\n\n"）。
      // 此时不能创建气泡，否则会出现一个「空气泡」，同时打字气泡还在 → 两个 AI 气泡并排的 bug。
      if (!accRef.current.trim()) return;
      upsertAi(accRef.current.trimStart());
    }, 60);
  }, [upsertAi]);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  function extractAiText(obj: any): string {
    try {
      const m = obj?.messages || obj?.[Object.keys(obj)[0]]?.messages;
      if (Array.isArray(m)) {
        return m
          .filter(
            (x: any) =>
              x && (x.type === "ai" || x.role === "assistant") && typeof x.content === "string",
          )
          .map((x: any) => x.content)
          .join("");
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  const finalize = useCallback(() => {
    clearFlushTimer(); // 收尾时取消未执行的节流刷新，直接落最终内容
    if (accRef.current.trim()) {
      // 去掉首尾多余空白（后端回复常带前导换行）
      upsertAi(accRef.current.trim());
    } else if (jsonFallbackRef.current.trim()) {
      upsertAi(jsonFallbackRef.current.trim()); // token 为空 → 用 updates 兜底
    } else {
      upsertAi("（本次没有返回内容，请换个问法再试试）");
    }
    accRef.current = "";
    jsonFallbackRef.current = "";
    setSending(false);
    if (!openRef.current) setUnread((n) => n + 1);
  }, [upsertAi, clearFlushTimer]);

  // ---------------- 终止生成 ----------------
  const stopGeneration = useCallback(() => {
    if (!sending) return;
    stoppedRef.current = true;
    clearFlushTimer();
    // 通知服务端中断（真正停止模型继续生成）
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
    } catch {
      /* ignore */
    }
    // 用已收到的内容收尾
    const kept = accRef.current.trim() || jsonFallbackRef.current.trim();
    if (kept) upsertAi(kept);
    accRef.current = "";
    jsonFallbackRef.current = "";
    setSending(false);
  }, [sending, upsertAi, clearFlushTimer]);

  const handleIncoming = useCallback(
    (data: string) => {
      // 终止的收尾在点击「终止」时已完成，这里只复位标记。
      // 放在最前面：即使它属于上一轮的残余标记，也不会打断当前新一轮。
      if (data === "[STOPPED]") {
        stoppedRef.current = false;
        return;
      }
      // 已终止：忽略该轮残余消息，等 [END] 复位标记
      if (stoppedRef.current) {
        if (data === "[END]") stoppedRef.current = false;
        return;
      }
      if (data === "[END]") {
        finalize();
        return;
      }
      if (data.startsWith("[ERROR]")) {
        upsertAi("⚠️ " + data.replace("[ERROR]", "").trim(), true);
        accRef.current = "";
        jsonFallbackRef.current = "";
        setSending(false);
        return;
      }

      // LangGraph `updates` 是 JSON 对象（形如 {"XxxMiddleware.before_agent": {...}} 或 {...: null}）
      // 这类节点/中间件状态一律不作为对话内容，否则会把原始 JSON 显示成消息。
      // 只有「解析不出 JSON」的才是真正的流式 token。
      const trimmed = data.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const obj = JSON.parse(trimmed);
          if (obj && typeof obj === "object") {
            // 若状态里确实带了 AI 文本，仅存为兜底（token 流为空时才用），不参与增量拼接
            const t = extractAiText(obj);
            if (t) jsonFallbackRef.current = t;
            return;
          }
        } catch {
          /* 不是完整 JSON 片段 → 按 token 处理 */
        }
      }

      accRef.current += data;
      scheduleFlush(); // 节流渲染，避免每个 token 都重排 Markdown
    },
    [finalize, upsertAi, scheduleFlush],
  );

  // ---------------- 发送 ----------------
  const send = useCallback(
    (text?: string) => {
      const q = (text ?? input).trim();
      if (!q || sending) return;

      const ws = connect();
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setMsgs((prev) => [...prev, { id: `u_${Date.now()}`, role: "user", content: q }]);

      accRef.current = "";
      jsonFallbackRef.current = "";
      aiMsgIdRef.current = `a_${Date.now()}`;
      setSending(true);
      stickRef.current = true; // 新的一轮重新吸底
      clearFlushTimer();
      stoppedRef.current = false;

      const payload = JSON.stringify({ query: q, session_id: sessionRef.current });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      } else {
        const started = Date.now();
        const timer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            clearInterval(timer);
            ws.send(payload);
          } else if (ws.readyState === WebSocket.CLOSED || Date.now() - started > 8000) {
            clearInterval(timer);
            upsertAi("⚠️ 无法连接后端对话服务（请确认 FastAPI 已在 8000 端口启动）", true);
            setSending(false);
          }
        }, 200);
      }
    },
    [input, sending, connect, upsertAi, clearFlushTimer],
  );

  const clearChat = () => {
    setMsgs([]);
    setUnread(0);
    accRef.current = "";
    jsonFallbackRef.current = "";
  };

  // ---------------- 收起态：悬浮小圆钮（同样可拖拽）----------------
  if (!open) {
    return (
      <button
        ref={(el) => {
          panelRef.current = el;
        }}
        onPointerDown={(e) => startDrag(e, true)}
        onClick={() => {
          // 拖动过就不触发「打开」（避免拖完误开）
          if (movedRef.current) {
            movedRef.current = false;
            return;
          }
          setOpen(true);
          setUnread(0);
        }}
        style={{
          // 用户没拖过 → 固定右下角；拖过 → 跟随记录位置
          ...(posCustom && pos
            ? { left: pos.x, top: pos.y }
            : { right: DEFAULT_GAP, bottom: DEFAULT_BOTTOM }),
          touchAction: "none", // 触摸设备上允许拖拽（否则会被滚动/缩放手势抢走）
        }}
        className={`fixed z-40 flex select-none items-center gap-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-3 text-sm font-semibold text-white shadow-2xl shadow-indigo-500/40 transition-shadow ${
          dragging ? "cursor-grabbing" : "cursor-grab hover:shadow-indigo-500/60"
        }`}
        title="AI 对话助手（可拖动，点击打开）"
      >
        <MessageSquare className="size-5" />
        AI 助手
        {unread > 0 && (
          <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-indigo-600">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    );
  }

  // ---------------- 展开态：悬浮窗 ----------------
  return (
    <div
      ref={(el) => {
        panelRef.current = el;
      }}
      style={{
        ...(pos ? { left: pos.x, top: pos.y } : { right: DEFAULT_GAP, bottom: DEFAULT_BOTTOM }),
        width: size?.w ?? PANEL_W,
        height: size?.h ?? "min(640px, calc(100vh - 100px))",
        // 未完成定位前先隐藏，避免闪一下
        visibility: mounted && pos ? "visible" : "hidden",
      }}
      className="fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-black/25"
    >
      {/* 头部（拖拽把手） */}
      <div
        onPointerDown={startDrag}
        style={{ touchAction: "none" }}
        className={`flex h-14 shrink-0 select-none items-center gap-2 border-b border-gray-100 px-3 ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        <GripVertical className="size-4 shrink-0 text-gray-300" />
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 shadow-md shadow-indigo-500/30">
          <Bot className="size-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-800">AI 对话助手</div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span
              className={`size-1.5 rounded-full ${
                status === "ok" ? "bg-emerald-400" : status === "err" ? "bg-red-400" : "bg-gray-300"
              }`}
            />
            {status === "ok" ? "已连接" : status === "err" ? "未连接" : "待连接"}
            <span className="truncate">· 途牛 / 高德 / 实时数据</span>
          </div>
        </div>
        <button
          onClick={startNewSession}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title="新对话（清空上下文）"
        >
          <MessageSquarePlus className="size-4" />
        </button>
        <button
          onClick={clearChat}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title="清空当前屏幕（保留后端记忆）"
        >
          <Trash2 className="size-4" />
        </button>
        <button
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          title="收起"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* 消息区 */}
      <div
        ref={listRef}
        onScroll={onListScroll}
        // scrollbar-gutter: stable —— 预留滚动条位置，避免滚动条出现/消失时宽度突变导致内容重排（抖动）
        // overscroll-behavior: contain —— 滚到顶/底时不把滚动链传给外层页面
        style={{ scrollbarGutter: "stable", overscrollBehavior: "contain" }}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-4"
      >
        {msgs.length === 0 && (
          <div className="mt-6 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/30">
              <Sparkles className="size-6" />
            </div>
            <p className="text-sm font-medium text-gray-700">你好，我是你的旅行助手</p>
            <p className="mt-1 text-xs text-gray-400">可以帮你查车票机票、找酒店、规划行程</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map((m) => (
          <MessageRow key={m.id} role={m.role} content={m.content} error={m.error} threadId={sessionRef.current || undefined} />
        ))}

        {/* 打字气泡：只在「还没收到第一个 token」时显示。
            否则它会和正在流式输出的正文气泡同时存在，导致内容跳动/重复。 */}
        {sending && !msgs.some((m) => m.id === aiMsgIdRef.current && m.content.trim().length > 0) && (
          <div className="flex justify-start">
            <div className="mr-2 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500">
              <Bot className="size-3.5 text-white" />
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-gray-100 px-3 py-2.5">
              <span className="size-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-gray-100 p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-gray-200 px-3 py-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 100) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="问点什么…（Enter 发送）"
            className="max-h-[100px] flex-1 resize-none bg-transparent text-sm leading-relaxed text-gray-800 outline-none placeholder:text-gray-400"
          />
          {sending ? (
            // 生成中：只显示终止图标（无文字、无状态提示条）
            <button
              onClick={stopGeneration}
              className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-500 text-white transition-opacity hover:opacity-90"
              title="终止生成"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!input.trim()}
              className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              title="发送"
            >
              <Send className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* 右下角缩放手柄：拖动可手动调整窗口大小 */}
      <div
        onPointerDown={startResize}
        style={{ touchAction: "none" }}
        className={`absolute bottom-0 right-0 z-10 flex size-5 cursor-nwse-resize items-end justify-end p-1 ${
          resizing ? "text-indigo-500" : "text-gray-300 hover:text-indigo-400"
        }`}
        title="拖动调整窗口大小"
      >
        {/* 三条斜线示意可缩放 */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M11 5L5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M11 8.5L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M11 11.5L11.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

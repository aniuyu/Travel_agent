"use client";

/**
 * 工作台主页（按视频复刻的"AI Travel Planner"样式）
 *
 * 整体布局：
 *   - 左侧：深色 sidebar（紫色 logo + 主导航 + 其他 + 用户卡片）
 *   - 顶部：深色 6 tab 导航条
 *   - 主区：白底，按 ?t=xxx 切换页面
 *
 * 支持的 tab（与 sidebar/顶部 tab 对应）：
 *   - dashboard  : 主页（我的行程 + 创建按钮 + 行程列表）
 *   - create     : 创建行程（表单 + 预算滑块 + 偏好）
 *   - trips      : 我的行程（行程卡片列表）
 *   - hotels     : 酒店/民宿预订（沿用原 TicketsPanel/HotelsPanel 思路）
 *   - map        : 地图视图（占位，后续可接高德）
 *   - settings   : 设置（开关列表）
 *   - help       : 帮助中心（FAQ）
 *   - summary    : 总结（功能特色卡片）
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Sparkles,
  MessageSquare,
  Settings as SettingsIcon,
  HelpCircle,
  Calendar,
  Map as MapIcon,
  Plane,
  Building2,
  Star,
  Share2,
  Copy,
  LoaderCircle,
  Trash2,
  Eye,
  MapPin,
  X,
  Check,
  ImageDown,
} from "lucide-react";
import { toPng } from "html-to-image";
import { TopBar } from "@/components/workspace/TopBar";
import { Sidebar } from "@/components/workspace/Sidebar";
import { TicketsPanel } from "@/components/workspace/TicketsPanel";
import { HotelsPanel } from "@/components/workspace/HotelsPanel";
import { ItineraryPanel } from "@/components/workspace/ItineraryPanel";
import { TripExportCard } from "@/components/workspace/TripExportCard";
import { ChatDock } from "@/components/workspace/ChatDock";
import { TravelMap, type TravelMapData } from "@/components/thread/TravelMap";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// 主页（Dashboard）
// ---------------------------------------------------------------------------
function DashboardHome({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 拉取当前用户的真实行程
  const fetchTrips = async () => {
    try {
      const userRaw = localStorage.getItem("fy_user");
      if (!userRaw) { setLoading(false); return; }
      const user = JSON.parse(userRaw);
      const res = await fetch(`http://localhost:8000/trips/mine?user_id=${user.id}&limit=20`);
      const json = await res.json();
      setTrips(json.status === "success" ? (json.data || []) : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrips();
  }, []);

  // 监听「TripsPanel 里删了一条」的自定义事件
  // - 自定义事件：同 tab 内即时生效（先派发，立刻能收到）
  // - storage 事件：跨 tab 同步（其他标签页里删了的话，这里也能感知）
  useEffect(() => {
    const onLocalChange = () => fetchTrips();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "fy_trips_changed") fetchTrips();
    };
    window.addEventListener("fy_trips_changed", onLocalChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("fy_trips_changed", onLocalChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // 统计：从真实行程算
  const totalCount = trips.length;
  const today = new Date();
  const pastTrips = trips.filter((t) => {
    const p = t.payload || {};
    const d = p.depart_date || "";
    return d && new Date(d) < today;
  });
  const upcomingTrips = trips.filter((t) => {
    const p = t.payload || {};
    const d = p.depart_date || "";
    return d && new Date(d) >= today;
  });

  const STAT_CARDS = [
    { num: String(totalCount), label: "已规划行程", tag: totalCount ? "+ 实时同步" : "暂无行程" },
    { num: String(pastTrips.length), label: "已出行目的地", tag: pastTrips.length ? "已出行" : "—" },
    { num: String(upcomingTrips.length), label: "待出行", tag: upcomingTrips.length ? "准备出发" : "—" },
  ];

  // 渲染列表：把后端的 payload 展开成 UI 字段
  const TRIPS = trips.map((t) => {
    const p = t.payload || {};
    const isUpcoming = p.depart_date && new Date(p.depart_date) >= today;
    const fromCity = p.from_city || "";
    const dest = p.destination || "";
    // 行程名称：出发地 → 目的地（信息更完整）
    const routeName =
      fromCity && dest ? `${fromCity} → ${dest}` : dest || fromCity || t.title || "未命名";
    // 天数：p.days 可能已是 "3天"，避免出现 "3天天"
    const rawDays = p.days ?? (p.daysDetail?.length || "—");
    const daysText = rawDays === "—" ? "—" : String(rawDays).includes("天") ? String(rawDays) : `${rawDays} 天`;
    return {
      id: t.share_id,
      city: routeName,
      days: daysText,
      range: p.depart_date || (t.created_at || "").slice(0, 10),
      status: isUpcoming ? "待出行" : "已出行",
      tag: p.pref || p.companion || "—",
    };
  });

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">我的行程</h1>
            <p className="mt-1 text-sm text-gray-500">
              2026/3/14 - 2026/9/22 · 已规划 10 段旅行
            </p>
          </div>
          <button
            onClick={() => onNavigate("create")}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" />
            创建行程
          </button>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STAT_CARDS.map((s) => (
              <div
                key={s.label}
                className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
              >
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-6 translate-y-[-30%] bg-gradient-to-br from-indigo-500 to-purple-500 opacity-20 blur-2xl" />
                <div className="relative">
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-5xl font-bold text-transparent">
                    {s.num}
                  </div>
                  <div className="mt-2 text-sm font-medium text-gray-700">{s.label}</div>
                  <div className="mt-1 text-xs text-gray-400">{s.tag}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                <Sparkles className="size-4" />
              </div>
              <h3 className="text-sm font-semibold text-gray-800">热门评论</h3>
            </div>
            <div className="space-y-3">
              {[
                { user: "小张同学", text: "用 AI 做的行程比我自己规划的细致多了！" },
                { user: "Lily", text: "高德地图导航超方便，一键跳转 App" },
                { user: "Tom", text: "小红书分享卡片也太好看了吧" },
              ].map((c) => (
                <div key={c.user} className="flex gap-2 text-xs">
                  <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-gray-400" />
                  <div>
                    <div className="font-medium text-gray-700">{c.user}</div>
                    <div className="mt-0.5 text-gray-500">{c.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-800">行程列表</h2>
          <div className="space-y-2">
            {loading && (
              <div className="py-8 text-center text-sm text-gray-400">加载中…</div>
            )}
            {!loading && TRIPS.length === 0 && (
              <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center">
                <p className="text-sm text-gray-500">还没有保存的行程</p>
                <p className="mt-1 text-xs text-gray-400">去「新建行程」创建你的第一个旅行吧</p>
                <button
                  onClick={() => onNavigate("create")}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-4 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                >
                  立即创建
                </button>
              </div>
            )}
            {TRIPS.map((t, i) => (
              <div
                key={t.id || i}
                onClick={async () => {
                  // 先从后端拉完整行程数据，再跳详情
                  if (t.id) {
                    try {
                      const res = await fetch(`http://localhost:8000/share/${t.id}`);
                      const json = await res.json();
                      if (json.status === "success") {
                        const full = json.data || {};
                        const payload = full.payload || {};
                        sessionStorage.setItem("fy_selected_trip", JSON.stringify({
                          ...payload,
                          _tripData: payload,
                          tier: (t as any).tier || payload.selectedTier || "舒适档",
                          share_id: t.id,
                        }));
                        onNavigate("trip-detail");
                      } else {
                        toast.error("无法读取行程详情");
                      }
                    } catch {
                      toast.error("无法连接后端");
                    }
                  }
                }}
                className="flex cursor-pointer items-center gap-4 rounded-xl border border-gray-100 bg-gray-50/50 p-3 transition-colors hover:bg-indigo-50/40"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-600">
                  {i + 1}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{t.city}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    <span>{t.days}</span>
                    <span>·</span>
                    <span>{t.range}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">{t.tag}</span>
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] ${
                    t.status === "已出行"
                      ? "bg-indigo-50 text-indigo-600"
                      : "bg-amber-50 text-amber-600"
                  }`}
                >
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 创建行程页（按视频里那个表单的样式 + 真实生成 → 跳 3 档方案页）
// ---------------------------------------------------------------------------

// ----- 「新建行程」表单草稿持久化 -----
// 切 tab 时整个 CreateTripPanel 会重新挂载，useState 默认值会"重置"用户已填字段。
// 把整个表单状态落到 localStorage：切走再回来、刷新页面，都能继续填。
const CREATE_DRAFT_KEY = "fy_create_trip_draft";

// 「选择酒店 / 车次」页 → 新建行程页 的回填信道。
// 流程：新建页点「选择酒店」→ 跳 hotels/tickets 页(pick 模式) → 用户点「加入行程」
//       → 写这个 key → 跳回 create → CreateTripPanel 挂载时读取并消费
const PENDING_PICK_KEY = "fy_pending_pick";

interface PendingPick {
  kind: "hotel" | "ticket";
  value: HotelPick | TicketPick;
}

/** 选中的酒店（含价格/评分/星级等，用于回填展示与传给后端） */
interface HotelPick {
  name: string;
  price?: number | null;
  score?: number | null;
  starName?: string;
  business?: string;
  address?: string;
  pic?: string;
}

/** 选中的车次（含站点/时间/价格/车型） */
interface TicketPick {
  number: string;
  from?: string;
  to?: string;
  depart?: string;
  arrive?: string;
  price?: number | null;
  category?: string;
  duration?: string;
}

// 兼容旧数据：以前草稿里存的是纯字符串，这里统一转成对象
function normalizeHotelPick(v: any): HotelPick | null {
  if (!v) return null;
  if (typeof v === "string") return { name: v };
  if (v.name) return v as HotelPick;
  return null;
}
function normalizeTicketPick(v: any): TicketPick | null {
  if (!v) return null;
  if (typeof v === "string") return { number: v.toUpperCase() };
  if (v.number) return v as TicketPick;
  return null;
}

interface CreateDraft {
  destination: string;
  fromCity: string;
  people: number;
  days: string;
  budget: number;
  pref: string;
  hotelLevel: string;
  transport: string;
  hotelStars: number;
  diningBudget: string;
  departDate: string;
  companion: string;
  extraNotes: string;
  selectedHotel: HotelPick | null;
  selectedTicket: TicketPick | null;
}

function defaultDepartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

const CREATE_DRAFT_DEFAULTS: CreateDraft = {
  destination: "",
  fromCity: "",
  people: 2,
  days: "3天",
  budget: 5000,
  pref: "自然风光",
  hotelLevel: "舒适型",
  transport: "高铁",
  hotelStars: 4,
  diningBudget: "适中（¥100-200/天）",
  departDate: "", // 首次空：下面 useState 的兜底会自动填 7 天后
  companion: "独旅",
  extraNotes: "",
  selectedHotel: null,
  selectedTicket: null,
};

function loadDraft(): CreateDraft {
  if (typeof window === "undefined") return CREATE_DRAFT_DEFAULTS;
  try {
    const raw = localStorage.getItem(CREATE_DRAFT_KEY);
    if (!raw) return CREATE_DRAFT_DEFAULTS;
    const obj = JSON.parse(raw);
    return { ...CREATE_DRAFT_DEFAULTS, ...obj };
  } catch {
    return CREATE_DRAFT_DEFAULTS;
  }
}

function saveDraft(d: CreateDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CREATE_DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

function clearDraft(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CREATE_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function CreateTripPanel({
  onNavigate,
  onGenerated,
}: {
  onNavigate: (tab: string, extra?: Record<string, string>) => void;
  onGenerated: (shareId: string, info: TripInfo) => void;
}) {
  // -------- 草稿持久化 --------
  // 用户填了一半切走，回来字段全没了？—— 切 tab 时整个 panel 重新挂载 useState 回到默认。
  // 把整个 form state 落到 localStorage，刷新/切走再回来都能继续。
  const [destination, setDestination] = useState(() => loadDraft().destination);
  const [fromCity, setFromCity] = useState(() => loadDraft().fromCity);
  const [people, setPeople] = useState(() => loadDraft().people);
  const [days, setDays] = useState(() => loadDraft().days);
  const [budget, setBudget] = useState(() => loadDraft().budget);
  const [pref, setPref] = useState<string>(() => loadDraft().pref);
  // —— 新增字段（视频里真实存在的） ——
  const [hotelLevel, setHotelLevel] = useState<string>(() => loadDraft().hotelLevel);
  const [transport, setTransport] = useState<string>(() => loadDraft().transport);
  const [hotelStars, setHotelStars] = useState<number>(() => loadDraft().hotelStars);
  const [diningBudget, setDiningBudget] = useState<string>(() => loadDraft().diningBudget);
  const [departDate, setDepartDate] = useState<string>(() => loadDraft().departDate || defaultDepartDate());
  const [companion, setCompanion] = useState<string>(() => loadDraft().companion);
  const [extraNotes, setExtraNotes] = useState<string>(() => loadDraft().extraNotes);
  // 用户预先选定的具体酒店 / 车次
  const [selectedHotel, setSelectedHotel] = useState<HotelPick | null>(() => normalizeHotelPick(loadDraft().selectedHotel));
  const [selectedTicket, setSelectedTicket] = useState<TicketPick | null>(() => normalizeTicketPick(loadDraft().selectedTicket));
  const [submitting, setSubmitting] = useState(false);

  // 从「选择酒店 / 车次」页返回时回填
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(PENDING_PICK_KEY);
      if (!raw) return;
      const obj: PendingPick = JSON.parse(raw);
      if (obj?.kind === "hotel" && obj.value) {
        const h = normalizeHotelPick(obj.value);
        if (h) {
          setSelectedHotel(h);
          toast.success(`已加入酒店：${h.name}`);
        }
      } else if (obj?.kind === "ticket" && obj.value) {
        const t = normalizeTicketPick(obj.value);
        if (t) {
          setSelectedTicket(t);
          toast.success(`已加入车次：${t.number}${t.from ? ` ${t.from}→${t.to}` : ""}`);
        }
      }
      localStorage.removeItem(PENDING_PICK_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // 任一字段变化 → 写回 localStorage（防抖合并为 1 次）
  useEffect(() => {
    saveDraft({
      destination, fromCity, people, days, budget, pref,
      hotelLevel, transport, hotelStars, diningBudget, departDate, companion, extraNotes,
      selectedHotel, selectedTicket,
    });
  }, [destination, fromCity, people, days, budget, pref, hotelLevel, transport,
      hotelStars, diningBudget, departDate, companion, extraNotes, selectedHotel, selectedTicket]);

  const PREF_OPTIONS = ["自然风光", "人文历史", "美食之旅", "自由行", "摄影之旅", "探险之旅"];
  const DAY_OPTIONS = ["1天", "2天", "3天", "4天", "5天", "6天", "7天", "自定义"];
  const HOTEL_LEVEL = ["经济型", "舒适型", "精品", "豪华"];
  const TRANSPORT = ["飞机", "高铁", "汽车", "自驾", "火车"];
  const DINING = ["经济（<¥50/天）", "适中（¥100-200/天）", "精致（¥200-500/天）", "不限"];
  const COMPANION = ["独旅", "情侣", "亲子家庭", "商务", "朋友同行"];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) {
      toast.error("请填写目的地");
      return;
    }
    setSubmitting(true);
    try {
      // 真实工具调用：FastAPI /trip/plan → 高德地理编码 + wttr.in 天气 + 途牛酒店/车票
      const payload = {
        destination,
        from_city: fromCity,
        days,
        budget,
        pref,
        hotel_level: hotelLevel,
        transport,
        hotel_stars: hotelStars,
        dining_budget: diningBudget,
        depart_date: departDate,
        companion,
        extra_notes: extraNotes,
        selected_hotel: selectedHotel?.name ?? "",
        selected_ticket: selectedTicket?.number ?? "",
        // 完整信息一起传，后端用它生成更真实的酒店/车次数据
        selected_hotel_detail: selectedHotel,
        selected_ticket_detail: selectedTicket,
      };
      const res = await fetch("http://localhost:8000/trip/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        // 成功生成 → 清空草稿（避免下次打开还看到上一轮填了一半的内容）
        clearDraft();
        // 后端返回完整 plan 数据，传给 select-plan / 详情页
        onGenerated(data.data.share_id, {
          destination,
          fromCity,
          people,
          days,
          budget,
          pref,
          hotelLevel,
          transport,
          hotelStars,
          diningBudget,
          departDate,
          companion,
          extraNotes,
          selectedHotel,
          selectedTicket,
          // 附带完整 trip 数据（plan/plans/hotels/weather/...）
          _tripData: data.data,
        });
        onNavigate("select-plan");
      } else {
        toast.error(data.message || "生成失败");
      }
    } catch {
      toast.error("无法连接后端（localhost:8000），请确认 FastAPI 已启动");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">新建行程</h1>
          <p className="mt-1 text-sm text-gray-500">
            ✨ AI 智能规划 · 30 秒生成您的专属行程
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        >
          {/* 目的地 + 出发城市 */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                📍 目的地
              </label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="例如：苏州、成都"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                🚄 出发城市
              </label>
              <input
                type="text"
                value={fromCity}
                onChange={(e) => setFromCity(e.target.value)}
                placeholder="自动匹配"
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          {/* 出行人数 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              👥 出行人数
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={people}
              onChange={(e) => setPeople(parseInt(e.target.value) || 1)}
              className="w-32 rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <span className="ml-2 text-xs text-gray-400">人</span>
          </div>

          {/* 出游天数 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              🕐 出游天数
            </label>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    days === d
                      ? "border-indigo-500 bg-indigo-500 text-white"
                      : "border-gray-200 text-gray-600 hover:border-indigo-300"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* 人均预算 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              💰 人均预算（¥{budget.toLocaleString()}）
            </label>
            <input
              type="range"
              min={1000}
              max={20000}
              step={500}
              value={budget}
              onChange={(e) => setBudget(parseInt(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="mt-1 flex justify-between text-xs text-gray-400">
              <span>¥1,000</span>
              <span>¥20,000</span>
            </div>
          </div>

          {/* 旅游偏好 */}
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              ❤️ 旅游偏好
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {PREF_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPref(p)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border px-4 py-4 transition-colors ${
                    pref === p
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  <span className="text-2xl">
                    {p === "自然风光" ? "🌄" : p === "人文历史" ? "🏛️" : p === "美食之旅" ? "🍜" : p === "自由行" ? "🎒" : p === "摄影之旅" ? "📷" : "🧗"}
                  </span>
                  <span className="text-sm">{p}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 住宿 &交通 */}
          <div className="border-t border-gray-100 pt-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              🏨 住宿 & 交通
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-xs text-gray-500">酒店档次</div>
                <div className="flex flex-wrap gap-2">
                  {HOTEL_LEVEL.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHotelLevel(h)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        hotelLevel === h
                          ? "border-indigo-500 bg-indigo-500 text-white"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300"
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs text-gray-500">主要交通</div>
                <div className="flex flex-wrap gap-2">
                  {TRANSPORT.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTransport(t)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        transport === t
                          ? "border-indigo-500 bg-indigo-500 text-white"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 酒店服务 & 餐饮偏好 */}
          <div className="border-t border-gray-100 pt-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              ⭐ 酒店服务 & 餐饮偏好
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-xs text-gray-500">酒店星级</div>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setHotelStars(n)}
                      className={`text-xl transition-transform hover:scale-110 ${
                        n <= hotelStars ? "text-amber-400" : "text-gray-300"
                      }`}
                    >
                      ★
                    </button>
                  ))}
                  <span className="ml-1 text-xs text-gray-500">{hotelStars}星</span>
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs text-gray-500">餐饮预算</div>
                <div className="flex flex-wrap gap-2">
                  {DINING.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDiningBudget(d)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        diningBudget === d
                          ? "border-indigo-500 bg-indigo-500 text-white"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 出发日期 + 同伴需求 */}
          <div className="border-t border-gray-100 pt-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  📅 出发日期
                </label>
                <input
                  type="date"
                  value={departDate}
                  onChange={(e) => setDepartDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  👨‍👩‍👧 同伴需求
                </label>
                <div className="flex flex-wrap gap-2">
                  {COMPANION.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCompanion(c)}
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        companion === c
                          ? "border-indigo-500 bg-indigo-500 text-white"
                          : "border-gray-200 text-gray-600 hover:border-indigo-300"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 选定具体酒店 & 车票（创建后基于真实所选展示） */}
          <div className="border-t border-gray-100 pt-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              🎯 选定酒店 & 车票（选填）
            </label>
            <p className="mb-3 text-xs text-gray-400">
              点击跳转到「酒店 / 车票」页面自行查询挑选，选中后会自动回到这里并回填
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* 选酒店 */}
              <div className="rounded-xl border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600">🏨 酒店</span>
                  <button
                    type="button"
                    onClick={() => onNavigate("hotels", { pick: "hotel" })}
                    className="rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-100"
                  >
                    去选酒店 →
                  </button>
                </div>
                <div className="min-h-[38px] rounded-lg bg-gray-50 px-3 py-2">
                  {selectedHotel ? (
                    <div className="text-gray-700">
                      <div className="truncate text-sm font-medium" title={selectedHotel.name}>
                        {selectedHotel.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                        {selectedHotel.starName && <span>{selectedHotel.starName}</span>}
                        {selectedHotel.score != null && <span>{selectedHotel.score}分</span>}
                        {selectedHotel.price != null && <span>¥{selectedHotel.price}/晚</span>}
                      </div>
                      {selectedHotel.business && (
                        <div className="mt-0.5 truncate text-[11px] text-gray-400" title={selectedHotel.business}>
                          📍 {selectedHotel.business}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">未指定（AI 自动推荐）</span>
                  )}
                </div>
                {selectedHotel && (
                  <button
                    type="button"
                    onClick={() => setSelectedHotel(null)}
                    className="mt-1.5 text-xs text-gray-400 hover:text-red-500"
                  >
                    清除选择
                  </button>
                )}
              </div>

              {/* 选车票 */}
              <div className="rounded-xl border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600">🚄 车次</span>
                  <button
                    type="button"
                    onClick={() => onNavigate("tickets", { pick: "ticket" })}
                    className="rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-100"
                  >
                    去选车次 →
                  </button>
                </div>
                <div className="min-h-[38px] rounded-lg bg-gray-50 px-3 py-2">
                  {selectedTicket ? (
                    <div className="text-gray-700">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{selectedTicket.number}</span>
                        {selectedTicket.category && (
                          <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">
                            {selectedTicket.category}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-500">
                        {selectedTicket.from && (
                          <span>
                            {selectedTicket.from} → {selectedTicket.to}
                          </span>
                        )}
                        {selectedTicket.depart && (
                          <span>
                            {selectedTicket.depart}
                            {selectedTicket.arrive ? `-${selectedTicket.arrive}` : ""}
                          </span>
                        )}
                        {selectedTicket.price != null && <span>¥{selectedTicket.price}</span>}
                        {selectedTicket.duration && <span>{selectedTicket.duration}</span>}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">未指定（AI 自动推荐）</span>
                  )}
                </div>
                {selectedTicket && (
                  <button
                    type="button"
                    onClick={() => setSelectedTicket(null)}
                    className="mt-1.5 text-xs text-gray-400 hover:text-red-500"
                  >
                    清除选择
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 额外要求（多行文本） */}
          <div className="border-t border-gray-100 pt-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              💬 额外要求（选填）
            </label>
            <textarea
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              placeholder="例如：对景点、酒店的额外要求，饮食禁忌，想要避免的事等"
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "生成中…" : "✨ 点击生成行程"}
          </button>

          {/* 草稿操作：用户主动重置已填的字段 */}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>已自动保存草稿，切走再回来不丢失</span>
            <button
              type="button"
              onClick={() => {
                clearDraft();
                setDestination("");
                setFromCity("");
                setPeople(2);
                setDays("3天");
                setBudget(5000);
                setPref("自然风光");
                setHotelLevel("舒适型");
                setTransport("高铁");
                setHotelStars(4);
                setDiningBudget("适中（¥100-200/天）");
                setDepartDate(defaultDepartDate());
                setCompanion("独旅");
                setExtraNotes("");
                setSelectedHotel(null);
                setSelectedTicket(null);
                toast.success("草稿已清空");
              }}
              className="rounded-md px-2 py-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              清空草稿
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 复用的 TripInfo 类型声明
type TripInfo = {
  destination: string;
  fromCity: string;
  people: number;
  days: string;
  budget: number;
  pref: string;
  hotelLevel: string;
  transport: string;
  hotelStars: number;
  diningBudget: string;
  departDate: string;
  companion: string;
  extraNotes: string;
  selectedHotel: HotelPick | null;
  selectedTicket: TicketPick | null;
  // 后端 /trip/plan 返回的完整数据（含 hotels / weather / plans / itinerary_per_tier 等）
  _tripData?: any;
};

// ---------------------------------------------------------------------------
// 3 档方案选择页（视频里 select-plan）
// ---------------------------------------------------------------------------
function SelectPlanPanel({
  shareId,
  tripInfo,
  onNavigate,
}: {
  shareId: string;
  tripInfo: TripInfo | null;
  onNavigate: (tab: string) => void;
}) {
  const [selectedTier, setSelectedTier] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  if (!tripInfo) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[#f5f5f7] p-6">
        <div className="max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-gray-800">还没有新生成的行程</h2>
          <p className="mt-2 text-sm text-gray-500">请先到「新建行程」页面生成一个行程</p>
          <button
            onClick={() => onNavigate("create")}
            className="mt-5 rounded-xl bg-indigo-500 px-6 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            去新建行程
          </button>
        </div>
      </div>
    );
  }

  // 真实数据优先：后端 /trip/plan 返回的 plans；否则用预算推算（兜底）
  const realPlans = tripInfo._tripData?.plans;
  const plans = realPlans || [
    { tier: "经济档", price: Math.round(tripInfo.budget * 0.59), highlight: "性价比之选", tag: "经济型综合体验", hotel: { name: "推荐酒店" }, transport_mode: "高铁+公交", dining: "本地美食", attractions: [`${tripInfo.destination}城市地标`] },
    { tier: "舒适档", price: tripInfo.budget, highlight: "推荐 · 平衡体验", tag: "舒适型方案", hotel: { name: "精品酒店" }, transport_mode: "高铁+专车", dining: "本帮菜+特色", attractions: [`${tripInfo.destination}城市地标`, `${tripInfo.destination}老城区`] },
    { tier: "豪华档", price: Math.round(tripInfo.budget * 1.44), highlight: "品质享受", tag: "豪华综合体验", hotel: { name: "五星酒店" }, transport_mode: "专车接送", dining: "精致私房菜", attractions: [`${tripInfo.destination}全部精选`] },
  ];

  // 顶部标签条：包含更多真实信息
  const tags = [
    { icon: "📍", label: tripInfo.destination },
    { icon: "🕐", label: tripInfo.days },
    { icon: "💰", label: `预算 ¥${tripInfo.budget.toLocaleString()}` },
    { icon: "❤️", label: tripInfo.pref },
  ];
  if (tripInfo._tripData?.weather?.now?.temp_C) {
    tags.push({ icon: "🌤️", label: `${tripInfo._tripData.weather.now.temp_C}°C` });
  }
  if (tripInfo._tripData?.distance_km) {
    tags.push({ icon: "📏", label: `${tripInfo._tripData.distance_km}km` });
  }

  const handleSelect = async (tier: string) => {
    setSelectedTier(tier);
    setSubmitting(true);
    // 把"选中的 tier"也存到 lastTripInfo，详情页用它渲染
    if (tripInfo) {
      // 通过 sessionStorage 临时跨页传递选档结果
      try {
        sessionStorage.setItem(
          "fy_selected_trip",
          JSON.stringify({ tier, shareId, ...tripInfo }),
        );
      } catch {
        // ignore
      }
    }
    setTimeout(() => {
      setSubmitting(false);
      const p = plans.find((x: any) => x.tier === tier);
      toast.success(`已选择「${tier}」方案 ¥${p?.price?.toLocaleString()}`);
      onNavigate("trip-detail");
    }, 400);
  };

  return (
    <div className="min-h-full bg-[#0a0a1a] text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* 顶部标题 */}
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold">
            <span className="bg-gradient-to-r from-indigo-300 to-purple-300 bg-clip-text text-transparent">
              选择您的行程方案
            </span>
          </h1>
          <p className="text-sm text-gray-400">
            AI 为您生成了 3 个不同档次的行程方案，请选择最合适的
          </p>
        </div>

        {/* 顶部标签条（含真实天气+距离） */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
          {tags.map((t) => (
            <div
              key={t.label}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-200"
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </div>

        {/* 3 张方案卡片（横排） */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {plans.map((p: any) => {
            const isSelected = selectedTier === p.tier;
            const gradient =
              p.tier === "经济档"
                ? "from-emerald-500 to-green-500"
                : p.tier === "舒适档"
                ? "from-indigo-500 to-purple-500"
                : "from-amber-500 to-orange-500";
            const attractions: any[] = p.attractions || [];
            return (
              <div
                key={p.tier}
                className={`relative rounded-2xl border bg-white/5 p-6 backdrop-blur-md transition-all ${
                  isSelected
                    ? "border-indigo-400 shadow-lg shadow-indigo-500/30"
                    : "border-white/10 hover:-translate-y-1 hover:border-white/20"
                }`}
              >
                {/* 顶部标签 + 推荐 */}
                <div className="mb-4 flex items-center justify-between">
                  <span
                    className={`rounded-full bg-gradient-to-r ${gradient} px-3 py-1 text-xs font-medium text-white`}
                  >
                    {p.tier}
                  </span>
                  {p.tier === "舒适档" && (
                    <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300">
                      推荐
                    </span>
                  )}
                </div>

                {/* 大号价格 */}
                <div className="mb-1">
                  <span className={`bg-gradient-to-r ${gradient} bg-clip-text text-5xl font-bold text-transparent`}>
                    ¥{(p.price || 0).toLocaleString()}
                  </span>
                </div>
                <div className="text-xs text-gray-400">人均预算</div>

                {/* 标签（优先 AI 推荐语） */}
                <div className="my-4 text-sm font-medium text-white">
                  {p.ai_highlight || p.tag || p.highlight}
                </div>

                {/* 行程摘要（按真实字段渲染） */}
                <div className="mb-5 space-y-2 text-xs text-gray-300">
                  <div>
                    <div className="mb-1 text-gray-400">🎯 主要景点</div>
                    <div className="leading-relaxed">
                      {attractions.map((a: any) =>
                        typeof a === "string" ? a : a?.name || ""
                      ).filter(Boolean).join("、") || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-gray-400">🏨 酒店</div>
                    <div>{p.hotel?.name || "—"}（{p.hotel?.stars || tripInfo.hotelStars}星 ¥{p.hotel?.price || "—"}/晚）</div>
                  </div>
                  <div>
                    <div className="mb-1 text-gray-400">🍽️ 餐饮</div>
                    <div className="leading-relaxed">{p.dining || "本帮菜"}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-gray-400">🚄 任务&交通</div>
                    <div>{p.transport_mode || "高铁+公交"}</div>
                  </div>
                </div>

                <button
                  onClick={() => handleSelect(p.tier)}
                  disabled={submitting}
                  className={`w-full rounded-xl bg-gradient-to-r ${gradient} py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 disabled:opacity-60`}
                >
                  {submitting && isSelected ? "选择中…" : "选择此方案"}
                </button>
              </div>
            );
          })}
        </div>

        {/* 真实数据来源说明 */}
        {tripInfo._tripData && (
          <div className="mt-8 text-center text-xs text-gray-400">
            数据来源：高德地图 · wttr.in · 途牛 · 分享 ID: <span className="font-mono">{shareId}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 行程详情页（视频里 select-plan 后的那张详情页：行程概况 + 天气 + 地图 + 时刻表 + 预算）
// ---------------------------------------------------------------------------
function TripDetailPanel({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [trip, setTrip] = useState<any>(null);
  const [selectedTier, setSelectedTier] = useState<string>("");
  const [activeDay, setActiveDay] = useState<number>(0); // 0=总览, 1..n=第N天

  // 从 sessionStorage 取之前选档的结果
  useEffect(() => {
      try {
        const raw = sessionStorage.getItem("fy_selected_trip");
        if (raw) {
          const obj = JSON.parse(raw);
          setTrip(obj);
          setSelectedTier(obj.tier);
        }
      } catch {
        // ignore
      }
    }, []);

  if (!trip) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[#0f0f1a] p-6">
        <div className="max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-gray-200 shadow-sm">
          <h2 className="text-lg font-semibold">尚未选择方案</h2>
          <p className="mt-2 text-sm text-gray-400">请先到「新建行程」生成并选档</p>
          <button onClick={() => onNavigate("create")} className="mt-5 rounded-xl bg-indigo-500 px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90">
            去新建行程
          </button>
        </div>
      </div>
    );
  }

  const data = trip._tripData || {};
  const plans = data.plans || [];
  const selectedPlan = plans.find((p: any) => p.tier === selectedTier) || plans[0];
  const itineraryAll = data.itinerary_per_tier?.[selectedTier] || [];
  const hotels = data.hotels || [];
  const tickets = data.tickets || [];
  const flights = data.flights || [];
  const weather = data.weather;
  const destGeo = data.destination_geo;
  const fromGeo = data.from_geo;
  const n_days = data.n_days || 3;

  // 预算拆分（按档位估算，兼容多种数据来源）
  // 来源 1: 完整 plan（最准）来源 2: trip.budget 来源 3: payload.budget 来源 4: 默认 5000
  const totalBudget: number =
    Number(selectedPlan?.price) ||
    Number(trip.budget) ||
    Number((trip as any).payload?.budget) ||
    Number((trip as any)._tripData?.budget) ||
    5000;
  const breakdown = [
    { key: "transport", label: "交通", amount: Math.round(totalBudget * 0.30), color: "#06b6d4" },
    { key: "hotel", label: "酒店", amount: Math.round(totalBudget * 0.35), color: "#6366f1" },
    { key: "dining", label: "餐饮", amount: Math.round(totalBudget * 0.20), color: "#ec4899" },
    { key: "ticket", label: "景点", amount: Math.round(totalBudget * 0.15), color: "#f59e0b" },
  ];
  const maxBar = Math.max(...breakdown.map((b) => b.amount));

  // 当前显示的行程（0 = 总览；>0 = 对应天）
  const dayDetail = activeDay >= 1 ? itineraryAll.find((d: any) => d.day === activeDay) : null;

  return (
    <div className="min-h-full bg-[#0a0a1a] text-white">
      {/* 顶部标题栏 */}
      <div className="border-b border-white/5 bg-[#0f0f1a] px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">
              从 {trip.fromCity || "出发地"} 前往 {trip.destination} · {trip.days} 行程规划
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-indigo-200/70">
              <span>📍 出发日期：{trip.departDate || "—"}</span>
              <span>·</span>
              <span>👥 {trip.companion}</span>
              <span>·</span>
              <span>共 {trip.people} 人</span>
              <span>·</span>
              <span>🤖 AI Tour</span>
            </div>
            {/* AI 总结横幅（来自后端大模型） */}
            {data.ai_summary && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-3 py-2">
                <span className="mt-0.5 text-sm">✨</span>
                <p className="text-xs leading-relaxed text-indigo-100">
                  {data.ai_summary}
                </p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onNavigate("select-plan")} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/10">
              ← 换档
            </button>
            <button onClick={async () => {
              if (!data.share_id) { toast.error("行程数据未加载，请重试"); return; }
              const userRaw = localStorage.getItem("fy_user");
              if (!userRaw) { toast.error("请先登录"); return; }
              let user;
              try { user = JSON.parse(userRaw); } catch { toast.error("用户信息损坏，请重新登录"); return; }
              if (!user || !user.id) { toast.error("用户 ID 缺失，请重新登录"); return; }
              try {
                const res = await fetch("http://localhost:8000/trip/save", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ share_id: data.share_id, creator_id: user.id, tier: selectedTier || "舒适档" }),
                });
                const json = await res.json();
                if (json.status === "success") {
                  toast.success("✅ 已保存到「我的行程」");
                } else {
                  toast.error("保存失败：" + (json.message || "未知错误"));
                }
              } catch (e) {
                console.error("save trip error", e);
                toast.error("保存失败，请确认后端已启动 (localhost:8000)");
              }
            }} className="rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/30">
              💾 保存到我的行程
            </button>
            <button onClick={() => {
              if (data.share_id) {
                navigator.clipboard.writeText(`${window.location.origin}/share/${data.share_id}`);
                toast.success("分享链接已复制");
              }
            }} className="rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
              🔗 复制分享链接
            </button>
            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 text-xs font-semibold text-white">
              飞
            </div>
          </div>
        </div>
      </div>

      {/* Tab 切换：总览 + 每天 */}
      <div className="border-b border-white/5 bg-[#0f0f1a] px-6 py-2 flex items-center gap-2 overflow-x-auto">
        {[{ day: 0, label: "主页" }, ...itineraryAll.map((d: any) => ({ day: d.day, label: `第${d.day}天` }))]
          .map((t) => {
            const active = activeDay === t.day;
            return (
              <button
                key={t.day}
                onClick={() => setActiveDay(t.day)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                  active ? "bg-indigo-500/20 text-indigo-300 border border-indigo-400/40" : "text-gray-400 hover:bg-white/5"
                }`}
              >
                {t.label}
              </button>
            );
          })}
      </div>

      {/* 主内容区：3栏布局 */}
      <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[260px_280px_1fr]">
        {/* ========== 左栏 1：行程概况 ========== */}
        <div className="rounded-2xl border border-white/10 bg-[#161624] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">📋 行程概况</h3>

          {/* 所选档位大圆环 */}
          <div className="relative mb-4 flex h-44 items-center justify-center">
            <svg viewBox="0 0 100 100" className="size-40 -rotate-90">
              {breakdown.map((b, i) => {
                const offset = breakdown.slice(0, i).reduce((s, x) => s + (x.amount / totalBudget) * 100, 0);
                const length = (b.amount / totalBudget) * 100;
                return (
                  <circle key={b.key} cx="50" cy="50" r="40" fill="none" stroke={b.color} strokeWidth="14" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-offset} />
                );
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-xs text-indigo-300">所选档位</div>
              <div className="text-lg font-bold text-white">{selectedTier || "舒适档"}</div>
              <div className="text-xs text-gray-400">¥{totalBudget.toLocaleString()}</div>
            </div>
          </div>

          {/* 4 个概览数据 */}
          <div className="space-y-2">
            {[
              { label: "出行天数", value: n_days + " 天", hint: "每天 1 段" },
              { label: "住宿晚数", value: (n_days - 1) + " 晚", hint: "舒适型酒店" },
              { label: "预估总花销", value: "¥" + ((Number(selectedPlan?.price) || totalBudget) * (Number(trip.people) || 1)).toLocaleString(), hint: `预算 ¥${totalBudget.toLocaleString()}` },
              { label: "预算超支", value: "¥0", hint: "AI 优化" },
            ].map((it) => (
              <div key={it.label} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
                <div className="text-[10px] text-indigo-200/60">{it.label}</div>
                <div className="text-base font-bold text-white">{it.value}</div>
                <div className="text-[10px] text-gray-500">{it.hint}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ========== 左栏 2：行程信息 ========== */}
        <div className="rounded-2xl border border-white/10 bg-[#161624] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">🚆 行程信息</h3>
          <div className="space-y-2">
            {tickets.length > 0 && (
              <div className="rounded-lg bg-indigo-500/15 p-2.5">
                <div className="text-[10px] text-indigo-300">🚄 出发交通</div>
                <div className="mt-1 text-xs font-medium text-white">{tickets[0].number} {tickets[0].from} → {tickets[0].to}</div>
                <div className="text-[10px] text-indigo-200/70">{tickets[0].depart} - {tickets[0].arrive}</div>
                <div className="mt-0.5 text-[10px] text-gray-400">¥{tickets[0].price} · {tickets[0].carrier}</div>
              </div>
            )}
            {flights.length > 0 && (
              <div className="rounded-lg bg-sky-500/15 p-2.5">
                <div className="text-[10px] text-sky-300">✈️ 备选 · 飞机</div>
                <div className="mt-1 text-xs font-medium text-white">{flights[0].number}</div>
                <div className="text-[10px] text-sky-200/70">{flights[0].depart} - {flights[0].arrive}</div>
                <div className="mt-0.5 text-[10px] text-gray-400">¥{flights[0].price} · {flights[0].carrier}</div>
              </div>
            )}
            <div className="rounded-lg bg-purple-500/15 p-2.5">
              <div className="text-[10px] text-purple-300">🏨 住宿</div>
              <div className="mt-1 text-xs font-medium text-white">{selectedPlan?.hotel?.name || hotels[0]?.name || "推荐酒店"}</div>
              <div className="text-[10px] text-purple-200/70">{selectedPlan?.hotel?.stars || trip.hotelStars}星 · ¥{selectedPlan?.hotel?.price || hotels[0]?.price}/晚</div>
              <div className="mt-0.5 text-[10px] text-gray-400">共 {n_days - 1} 晚</div>
            </div>
            <div className="rounded-lg bg-pink-500/15 p-2.5">
              <div className="text-[10px] text-pink-300">🍽️ 餐饮</div>
              <div className="mt-1 text-xs font-medium text-white">{selectedPlan?.dining || "本帮菜 + 特色美食"}</div>
              <div className="text-[10px] text-pink-200/70">预算 {trip.diningBudget}</div>
              <div className="mt-0.5 text-[10px] text-gray-400">约 ¥{Math.round(totalBudget * 0.20).toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-amber-500/15 p-2.5">
              <div className="text-[10px] text-amber-300">🎯 预算档次</div>
              <div className="mt-1 text-xs font-medium text-white">{selectedTier || "舒适档"} · 综合体验</div>
              <div className="text-[10px] text-amber-200/70">最后行程安排 · 时间为独行 5-7 小时</div>
              {weather?.now && (
                <div className="mt-0.5 text-[10px] text-gray-400">{weather.city} {weather.now.temp_C}°C · {weather.now.desc}</div>
              )}
            </div>
          </div>
        </div>

        {/* ========== 中间：行程地图 ========== */}
        <div className="rounded-2xl border border-white/10 bg-[#161624] overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
            <h3 className="text-sm font-semibold text-white">🗺️ 行程地图</h3>
            <div className="flex items-center gap-2">
              {fromGeo && destGeo && (
                <a
                  href={`https://uri.amap.com/navigation?from=${fromGeo.lng},${fromGeo.lat},${encodeURIComponent(trip.fromCity || '出发地')}&to=${destGeo.lng},${destGeo.lat},${encodeURIComponent(trip.destination)}&mode=0&coordinate=gaode&src=fytt`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
                >
                  🚗 导航
                </a>
              )}
              <a
                href={destGeo ? `https://uri.amap.com/marker?markers=${destGeo.lng},${destGeo.lat},${encodeURIComponent(destGeo.name)}&src=fytt` : "https://uri.amap.com/marker"}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:bg-white/5"
              >
                🔗 全屏
              </a>
            </div>
          </div>
          <div style={{ height: "520px" }}>
            {destGeo && (
              <TravelMap
                data={{
                  type: "map",
                  title: `${trip.destination} 行程地图`,
                  route: fromGeo
                    ? {
                        from: { name: trip.fromCity || "出发地", lng: fromGeo.lng, lat: fromGeo.lat },
                        to: { name: destGeo.name, lng: destGeo.lng, lat: destGeo.lat },
                        mode: "driving",
                      }
                    : undefined,
                  points: [
                    { name: destGeo.name, lng: destGeo.lng, lat: destGeo.lat, icon: "scenic" },
                  ],
                } as TravelMapData}
              />
            )}
          </div>
          <div className="border-t border-white/5 px-4 py-2 text-[11px] text-indigo-200/70">
            📍 {destGeo ? `${destGeo.name} (${destGeo.lng.toFixed(2)}, ${destGeo.lat.toFixed(2)})` : ""}
            {fromGeo && destGeo && <span> · 从 {trip.fromCity || "出发地"} 出发，{data.distance_km?.toFixed(1) || "—"} km</span>}
          </div>
        </div>

        {/* ========== 底部：时刻表 + 预算开销 ========== */}
        <div className="col-span-1 lg:col-span-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* 时刻表 */}
          <div className="rounded-2xl border border-white/10 bg-[#161624] p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">
              🕐 {activeDay === 0 ? "行程时刻表" : dayDetail ? `第 ${dayDetail.day} 天` : ""}
            </h3>
            <div className="space-y-2">
              {activeDay === 0 && itineraryAll.length === 0 && (
                <div className="text-sm text-gray-400">暂无时刻表</div>
              )}
              {(activeDay === 0 ? itineraryAll : dayDetail ? [dayDetail] : []).map((d: any) => (
                <div key={d.day} className="rounded-lg border border-white/5 bg-white/5 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-[11px] font-bold text-white">
                      {d.day}
                    </div>
                    <div className="text-xs font-semibold text-white">第 {d.day} 天 · {trip._tripData?.destination || "行程"}</div>
                  </div>
                  <div className="ml-8 space-y-1">
                    {d.spots?.map((s: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-gray-300">
                        <span className="text-indigo-300">⏰ {s.time}</span>
                        <span>{s.icon}</span>
                        <span>{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 预算开销 + 天气 */}
          <div className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-[#161624] p-4">
              <h3 className="mb-3 text-sm font-semibold text-white">📊 预算开销</h3>
              <div className="space-y-2.5">
                {breakdown.map((b) => (
                  <div key={b.key}>
                    <div className="mb-1 flex justify-between text-[11px] text-gray-400">
                      <span>{b.label}</span>
                      <span className="font-medium text-white">¥{b.amount.toLocaleString()}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(b.amount / maxBar) * 100}%`, background: `linear-gradient(to right, ${b.color}, ${b.color})` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {weather?.now && (
              <div className="rounded-2xl border border-white/10 bg-[#161624] p-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">
                    {parseInt(weather.now.temp_C) >= 25 ? "☀️" : parseInt(weather.now.temp_C) >= 15 ? "🌤️" : "❄️"}
                  </span>
                  <div>
                    <div className="text-2xl font-bold text-white">{weather.now.temp_C}°C</div>
                    <div className="text-[11px] text-gray-400">{weather.city} · {weather.now.desc}</div>
                  </div>
                </div>
                {weather.today && (
                  <div className="mt-2 text-[11px] text-amber-300/80">☀️ 今日 {weather.today.min_C}° - {weather.today.max_C}° · {weather.today.desc}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 行程单展示（t=trips）：我的行程列表
// ---------------------------------------------------------------------------

/** 轮询等待导出卡片节点渲染完成（最多 2 秒） */
async function waitForExportNode(
  ref: React.RefObject<HTMLDivElement | null>,
  timeout = 2000,
): Promise<HTMLDivElement | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = ref.current;
    if (el && el.offsetHeight > 0) return el;
    await new Promise((r) => setTimeout(r, 30));
  }
  return ref.current ?? null;
}

/** 清理文件名里的非法字符 */
function sanitizeFileName(name: string): string {
  return (name || "行程").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}

function TripsPanel({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [shareModal, setShareModal] = useState<{
    open: boolean;
    url: string;
    title: string;
    trip: any | null;
  }>({
    open: false,
    url: "",
    title: "",
    trip: null,
  });
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; trip: any | null }>({
    open: false,
    trip: null,
  });
  // 图片导出：隐藏卡片的数据 + 节点引用
  const exportCardRef = useRef<HTMLDivElement>(null);
  const [exportData, setExportData] = useState<{ payload: any; title: string } | null>(null);

  // 拉取当前用户的行程
  const load = async () => {
    setLoading(true);
    try {
      const userRaw = localStorage.getItem("fy_user");
      if (!userRaw) { setTrips([]); setLoading(false); return; }
      const user = JSON.parse(userRaw);
      const res = await fetch(`http://localhost:8000/trips/mine?user_id=${user.id}&limit=50`);
      const json = await res.json();
      if (json.status === "success") setTrips(json.data || []);
    } catch {
      toast.error("无法连接后端");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // 用 share_id 拉完整 payload，存 sessionStorage，跳到详情页
  const openTrip = async (shareId: string) => {
    setOpeningId(shareId);
    try {
      const res = await fetch(`http://localhost:8000/share/${shareId}`);
      const json = await res.json();
      if (json.status === "success") {
        const payload = json.data?.payload || {};
        sessionStorage.setItem(
          "fy_selected_trip",
          JSON.stringify({
            ...payload,
            _tripData: payload,
            tier: payload.selectedTier || "舒适档",
            share_id: shareId,
          }),
        );
        onNavigate("trip-detail");
      } else {
        toast.error("无法读取行程详情");
      }
    } catch {
      toast.error("无法连接后端");
    } finally {
      setOpeningId(null);
    }
  };

  // 生成可分享链接：基于已有行程 payload，再调一次 /share/create 生成新 share_id
  const shareTrip = async (trip: any) => {
    const shareId = trip.share_id;
    setGeneratingId(shareId);
    try {
      // 先确保 payload 是可 JSON 序列化的（去掉 undefined/Func/Symbol）
      const safePayload = trip.payload ? JSON.parse(JSON.stringify(trip.payload)) : {};
      const body = {
        title: trip.title || "我的行程",
        payload: safePayload,
        creator_id: (() => {
          try { return JSON.parse(localStorage.getItem("fy_user") || "{}")?.id; } catch { return undefined; }
        })(),
      };
      const res = await fetch("http://localhost:8000/share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      });

      // 非 200：尝试读 json，否则读 text
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          detail = errJson?.detail || errJson?.message || JSON.stringify(errJson).slice(0, 200);
        } catch {
          try {
            const txt = await res.text();
            detail = txt.slice(0, 200);
          } catch {/* ignore */}
        }
        toast.error("生成失败：" + detail);
        return;
      }

      const json = await res.json();
      if (json.status === "success") {
        const newId = json.data.share_id;
        const url = `${window.location.origin}/share/${newId}`;
        setShareModal({ open: true, url, title: trip.title || "我的行程", trip });
        toast.success("分享链接已生成");
      } else {
        toast.error(json.message || json.detail || "生成失败");
      }
    } catch (err: any) {
      console.error("shareTrip error:", err);
      toast.error("无法连接后端：" + (err?.message || "请确认 FastAPI 已启动在 localhost:8000"));
    } finally {
      setGeneratingId(null);
    }
  };

  // 导出为图片（PNG）
  // 流程：拉 payload → 挂载隐藏卡片 → 等节点就绪 → html-to-image 截图 → 下载
  const downloadTrip = async (trip: any) => {
    const shareId = trip.share_id;
    setDownloadingId(shareId);
    try {
      const res = await fetch(`http://localhost:8000/share/${shareId}`);
      const json = await res.json();
      if (json.status !== "success") {
        toast.error("无法读取行程");
        return;
      }
      const payload = json.data?.payload || {};
      const title = trip.title || payload.title || "我的行程";

      // 1) 挂载隐藏卡片
      setExportData({ payload, title });

      // 2) 轮询等待 React 提交渲染（最多 2s）
      const node = await waitForExportNode(exportCardRef);
      if (!node) {
        toast.error("导出失败：卡片未就绪");
        return;
      }

      // 3) 生成 PNG（pixelRatio 2 = 高清二倍图）
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        skipFonts: true, // 用系统字体，避免拉取外部字体失败
      });

      // 4) 触发下载
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${sanitizeFileName(title)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("已导出图片，可直接发给朋友");
    } catch (err: any) {
      console.error("export image error", err);
      toast.error("导出失败：" + (err?.message || ""));
    } finally {
      setDownloadingId(null);
      setExportData(null);
    }
  };

  // 直接打开公开分享页（在新标签页）
  const previewTrip = (shareId: string) => {
    window.open(`/share/${shareId}`, "_blank");
  };

  // 删除行程：前端先弹确认 → 调后端 → 刷新本地列表 + 给 DashboardHome 发个 storage 事件让它也重新拉
  const askDelete = (trip: any) => {
    setConfirmDelete({ open: true, trip });
  };
  const cancelDelete = () => setConfirmDelete({ open: false, trip: null });
  const doDelete = async () => {
    const trip = confirmDelete.trip;
    if (!trip) return;
    const shareId = trip.share_id;
    setConfirmDelete({ open: false, trip: null });
    setDeletingId(shareId);
    try {
      const userRaw = localStorage.getItem("fy_user");
      if (!userRaw) { toast.error("请先登录"); setDeletingId(null); return; }
      const user = JSON.parse(userRaw);
      const res = await fetch(
        `http://localhost:8000/trips/delete?share_id=${encodeURIComponent(shareId)}&user_id=${user.id}`,
        { method: "POST" },
      );
      const json = await res.json();
      if (json.status === "success") {
        toast.success("已删除");
        // 1) 刷新当前列表
        await load();
        // 2) 同步 DashboardHome —— 同 tab 用自定义事件、跨 tab 用 storage event
        try {
          const stamp = String(Date.now());
          localStorage.setItem("fy_trips_changed", stamp);
          window.dispatchEvent(new CustomEvent("fy_trips_changed", { detail: { shareId } }));
        } catch {/* ignore */}
      } else {
        toast.error("删除失败：" + (json.message || json.detail || `HTTP ${res.status}`));
      }
    } catch (err: any) {
      toast.error("无法连接后端：" + (err?.message || ""));
    } finally {
      setDeletingId(null);
    }
  };

  const copyShareUrl = async () => {
    if (!shareModal.url) return;
    try {
      await navigator.clipboard.writeText(shareModal.url);
      toast.success("链接已复制，发到手机打开即可");
    } catch {
      toast.error("复制失败，请手动选中复制");
    }
  };

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">行程单展示</h1>
            <p className="mt-1 text-sm text-gray-500">
              查看所有已保存的行程 · 可导出成图片发给朋友（手机直接查看）
            </p>
          </div>
          <button
            onClick={() => onNavigate("create")}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" />
            新建行程
          </button>
        </div>

        {/* 加载态 */}
        {loading && (
          <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
            <LoaderCircle className="mx-auto size-6 animate-spin text-indigo-500" />
            <p className="mt-3 text-sm text-gray-500">加载中…</p>
          </div>
        )}

        {/* 空状态 */}
        {!loading && trips.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-indigo-50 text-3xl">
              🧳
            </div>
            <p className="text-base font-medium text-gray-700">还没有保存的行程</p>
            <p className="mt-1 text-sm text-gray-400">新建行程 → 保存到「我的行程」后，会自动出现在这里</p>
            <button
              onClick={() => onNavigate("create")}
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" />
              立即创建
            </button>
          </div>
        )}

        {/* 行程卡片列表 */}
        {!loading && trips.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              共 <span className="font-semibold text-indigo-600">{trips.length}</span> 条行程
            </p>
            {trips.map((t, i) => {
              const p = t.payload || {};
              const fromCity = p.from_city || "";
              const dest = p.destination || "";
              // 行程名称：出发地 → 目的地
              const routeName =
                fromCity && dest ? `${fromCity} → ${dest}` : dest || fromCity || t.title || "未命名";
              // 天数归一化：p.days 可能已是 "3天"，避免 "3天天"
              const rawDays = p.days ?? (p.daysDetail?.length || "—");
              const daysText =
                rawDays === "—" ? "—" : String(rawDays).includes("天") ? String(rawDays) : `${rawDays} 天`;
              const depart = p.depart_date || (t.created_at || "").slice(0, 10);
              const today = new Date();
              const isUpcoming = depart && new Date(depart) >= today;
              return (
                <div
                  key={t.share_id || i}
                  className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    {/* 左侧：路线图标 + 信息 */}
                    <div className="flex flex-1 items-start gap-4">
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-xl text-white">
                        <MapPin className="size-6" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-bold text-gray-800">{routeName}</h3>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              isUpcoming
                                ? "bg-emerald-50 text-emerald-600"
                                : "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {isUpcoming ? "待出行" : "已出行"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="size-3" /> {daysText}
                          </span>
                          <span>·</span>
                          <span>出发 {depart || "—"}</span>
                          {p.companion && (
                            <>
                              <span>·</span>
                              <span>{p.companion}</span>
                            </>
                          )}
                          {p.pref && (
                            <>
                              <span>·</span>
                              <span>{p.pref}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 右侧：操作按钮 */}
                    <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                      <button
                        onClick={() => openTrip(t.share_id)}
                        disabled={openingId === t.share_id}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {openingId === t.share_id ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                        打开
                      </button>
                      <button
                        onClick={() => previewTrip(t.share_id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-indigo-300 hover:text-indigo-600"
                      >
                        <Eye className="size-3.5" />
                        预览
                      </button>
                      <button
                        onClick={() => shareTrip(t)}
                        disabled={generatingId === t.share_id}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60"
                        title="生成可分享链接，或导出图片发给朋友"
                      >
                        {generatingId === t.share_id ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Share2 className="size-3.5" />
                        )}
                        分享
                      </button>
                      <button
                        onClick={() => downloadTrip(t)}
                        disabled={downloadingId === t.share_id}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-60"
                        title="导出为图片（PNG），可直接发给朋友"
                      >
                        {downloadingId === t.share_id ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <ImageDown className="size-3.5" />
                        )}
                        存图片
                      </button>
                      <button
                        onClick={() => askDelete(t)}
                        disabled={deletingId === t.share_id}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                        title="从「我的行程」删除这条行程"
                      >
                        {deletingId === t.share_id ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {confirmDelete.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={cancelDelete}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-red-100 text-red-600">
              <Trash2 className="size-6" />
            </div>
            <h3 className="mb-2 text-center text-lg font-bold text-gray-800">确认删除？</h3>
            <p className="mb-1 text-center text-sm text-gray-500">
              即将删除行程
            </p>
            <p className="mb-4 text-center font-semibold text-gray-800">
              《{confirmDelete.trip?.title || "此行程"}》
            </p>
            <p className="mb-5 text-center text-xs text-gray-400">
              删除后将从「我的行程」中移除，主页统计和列表也会同步更新
            </p>
            <div className="flex gap-2">
              <button
                onClick={cancelDelete}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300"
              >
                取消
              </button>
              <button
                onClick={doDelete}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分享弹窗：链接 + 下载 HTML 两种方式 */}
      {shareModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShareModal({ open: false, url: "", title: "", trip: null })}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">分享行程</h3>
              <button
                onClick={() => setShareModal({ open: false, url: "", title: "", trip: null })}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="size-5" />
              </button>
            </div>

            <p className="mb-3 text-sm text-gray-500">
              两种方式：① 复制链接（仅本电脑可打开）② 导出图片（微信 / 邮件发给朋友，手机直接查看）
            </p>

            {/* 链接区 */}
            <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Share2 className="size-3.5 text-indigo-500" />
                <span className="text-xs font-medium text-indigo-600">方式 1 · 分享链接（本机查看）</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate font-mono text-sm text-indigo-700">
                  {shareModal.url}
                </span>
                <button
                  onClick={copyShareUrl}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 shadow-sm hover:bg-indigo-100"
                >
                  <Copy className="size-3.5" />
                  复制
                </button>
              </div>
            </div>

            {/* 导出图片区 */}
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <ImageDown className="size-3.5 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-600">方式 2 · 导出图片（发给朋友，手机直接看）</span>
              </div>
              <p className="text-xs text-emerald-700">
                导出一张高清 PNG 长图，包含每日行程、方案、酒店与车票。直接发微信 / 邮件，对方点开即可查看，无需联网。
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <a
                href={shareModal.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:border-indigo-300 hover:text-indigo-600"
              >
                <Eye className="size-4" />
                在本机打开
              </a>
              <button
                onClick={() => {
                  if (shareModal.trip) {
                    setShareModal({ open: false, url: "", title: "", trip: null });
                    downloadTrip(shareModal.trip);
                  }
                }}
                disabled={!shareModal.trip}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <ImageDown className="size-4" />
                导出为图片
              </button>
            </div>

            <button
              onClick={() => setShareModal({ open: false, url: "", title: "", trip: null })}
              className="mt-3 w-full text-center text-xs text-gray-400 hover:text-gray-600"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 隐藏的导出卡片：仅用于截图导出 PNG（移到屏幕外，保持可渲染） */}
      {exportData && (
        <div
          aria-hidden
          style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none", zIndex: -1 }}
        >
          <div ref={exportCardRef}>
            <TripExportCard payload={exportData.payload} title={exportData.title} />
          </div>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// 地图视图（占位）
// ---------------------------------------------------------------------------
function MapPanel(): React.ReactNode {
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  // 拉取用户最新一条行程
  useEffect(() => {
    let cancelled = false;
    async function fetchLatest() {
      try {
        const userRaw = localStorage.getItem("fy_user");
        if (!userRaw) { setLoading(false); return; }
        const user = JSON.parse(userRaw);
        const res = await fetch(`http://localhost:8000/trips/mine?user_id=${user.id}&limit=1`);
        const json = await res.json();
        if (!cancelled && json.status === "success" && json.data.length > 0) {
          const t = json.data[0];
          const payload = t.payload || {};
          setTrip({ ...payload, _tripData: payload, share_id: t.share_id });
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchLatest();
    return () => { cancelled = true; };
  }, []);

  // 渲染高德地图：底图 + 起终点 marker + 3 套驾车路线对比（用不同 policy 调 3 次）
  useEffect(() => {
    if (!trip || !mapContainerRef.current) return;
    const data = trip._tripData || {};
    const destGeo = data.destination_geo;
    const fromGeo = data.from_geo;
    const itinerary = data.itinerary_per_tier || {};
    const tier = data.selectedTier || Object.keys(itinerary)[0] || "舒适档";
    const dayList = itinerary[tier] || [];
    // 收集所有景点坐标
    const midway = (dayList || []).flatMap((d: any) =>
      (d.spots || []).map((s: any) => ({
        name: s.name, lng: s.lng, lat: s.lat,
      })).filter((p: any) => p.lng && p.lat)
    );

    if (!destGeo) return;
    const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY || "";

    const init = () => {
      if (!window.AMap || mapInstanceRef.current) return;
      try {
        const map = new window.AMap.Map(mapContainerRef.current!, {
          zoom: 7,
          center: [(fromGeo?.lng || destGeo.lng), (fromGeo?.lat || destGeo.lat)],
          viewMode: "2D",
          // 不传 layers（保留默认底图）；实时路况通过 setMap 后添加
        });
        mapInstanceRef.current = map;
        // 单独加实时路况图层
        try {
          new window.AMap.TileLayer.Traffic({ autoRefresh: true, interval: 180 }).setMap(map);
        } catch {}

        // 终点 marker
        new window.AMap.Marker({
          position: [destGeo.lng, destGeo.lat],
          title: destGeo.name,
          content: '<div style="background:#ef4444;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);">终</div>',
          offset: new window.AMap.Pixel(-14, -14),
        }).setMap(map);

        // 起点 marker
        if (fromGeo && fromGeo.lng) {
          new window.AMap.Marker({
            position: [fromGeo.lng, fromGeo.lat],
            title: fromGeo.name,
            content: '<div style="background:#3b82f6;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);">起</div>',
            offset: new window.AMap.Pixel(-14, -14),
          }).setMap(map);

          // 3 套驾车路线对比（不同 policy = 不同高德推荐策略）
          const policies: { name: string; policy: number; color: string; width: number }[] = [
            { name: "推荐", policy: 0, color: "#22c55e", width: 7 },  // 最优
            { name: "高速优先", policy: 1, color: "#10b981", width: 5 },
            { name: "最短距离", policy: 3, color: "#34d399", width: 4 },
          ];
          const results: any[] = [];
          policies.forEach((p, idx) => {
            try {
              const driving = new window.AMap.Driving({
                map,
                hideMarkers: true,
                policy: p.policy as any,
                // 不同策略不同描边色
                outlineColor: "#ffffff",
                strokeColor: p.color,
                strokeWeight: p.width,
              });
              driving.search(
                new window.AMap.LngLat(fromGeo.lng, fromGeo.lat),
                new window.AMap.LngLat(destGeo.lng, destGeo.lat),
                (status: string, result: any) => {
                  if (status === "complete" && result.routes?.[0]) {
                    results[idx] = result.routes[0];
                    // 在路线中点加个 "方案X 耗时" 标签
                    const path = result.routes[0].path;
                    if (path && path.length > 0) {
                      const mid = path[Math.floor(path.length / 2)];
                      const dur = Math.round((result.routes[0].time || 0) / 3600 * 10) / 10;
                      const km = Math.round(result.routes[0].distance / 1000);
                      new window.AMap.Marker({
                        position: [mid.lng, mid.lat],
                        offset: new window.AMap.Pixel(-50, -15),
                        content: `<div style="background:#fff;border:1.5px solid ${p.color};color:#333;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,.1);white-space:nowrap;">方案${idx + 1} ${dur}小时<br/><span style="color:#6b7280;font-size:11px;font-weight:400;">${km}km</span></div>`,
                      }).setMap(map);
                    }
                  }
                  // 全部 3 条画完后调整视野
                  if (results.filter(Boolean).length === 3) {
                    map.setFitView();
                  }
                },
              );
            } catch {}
          });
        }

        // 中途景点小红点
        midway.forEach((p: any) => {
          new window.AMap.Marker({
            position: [p.lng, p.lat],
            title: p.name,
            offset: new window.AMap.Pixel(-4, -4),
            content: '<div style="width:10px;height:10px;border-radius:50%;background:#fff;border:2px solid #ef4444;box-shadow:0 0 0 2px rgba(255,255,255,0.4);"></div>',
          }).setMap(map);
        });
      } catch (e) {
        console.error("[MapPanel] 初始化失败", e);
      }
    };

    if (window.AMap) {
      init();
    } else {
      const script = document.createElement("script");
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}&plugin=AMap.Driving`;
      script.async = true;
      script.onload = init;
      document.head.appendChild(script);
    }

    return () => {
      if (mapInstanceRef.current) {
        try { mapInstanceRef.current.destroy(); mapInstanceRef.current = null; } catch {}
      }
    };
  }, [trip]);

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-800">🗺️ 地图预览</h1>
          {trip ? (
            <div>
              <p className="mt-1 text-sm text-gray-500">
                {trip._tripData?.from_city || "出发地"} → {trip._tripData?.destination || "目的地"} · 实时路况
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1 w-6 rounded bg-[#22c55e]" />
                  方案 1（推荐）
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1 w-6 rounded bg-[#10b981]" />
                  方案 2（高速优先）
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1 w-6 rounded bg-[#34d399]" />
                  方案 3（最短距离）
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-sm text-gray-500">先去「新建行程」生成你的旅行吧</p>
          )}
        </div>

        {loading ? (
          <div className="flex h-96 items-center justify-center rounded-2xl border-2 border-dashed border-gray-200">
            <p className="text-sm text-gray-400">加载中…</p>
          </div>
        ) : !trip ? (
          <div className="flex h-96 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200">
            <MapIcon className="mb-3 size-12 text-gray-300" />
            <p className="text-sm text-gray-500">还没有保存的行程</p>
            <p className="mt-1 text-xs text-gray-400">去「新建行程」生成你的第一个旅行</p>
          </div>
        ) : (
          <div
            ref={mapContainerRef}
            className="w-full overflow-hidden rounded-2xl border border-gray-200 shadow-sm"
            style={{ height: "560px", minHeight: "560px" }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 设置页（开关列表）
// ---------------------------------------------------------------------------
function SettingsPanel(): React.ReactNode {
  // 真实设置项（每个都有具体功能，不是摆设开关）
  // 头像行 index=0 不参与开关数组，单独处理
  const [toggles, setToggles] = useState<Record<number, boolean>>(() => {
    // 启动时从 localStorage 恢复
    const init: Record<number, boolean> = {};
    for (let i = 1; i <= 6; i++) {
      try {
        const v = localStorage.getItem(`fy_setting_${i}`);
        init[i] = v === null ? (i === 5) : v === "1";
      } catch {
        init[i] = i === 5; // 默认自动保存=true，其他=false
      }
    }
    return init;
  });
  const [nickname, setNickname] = useState("");
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // 初始化用户昵称
  useEffect(() => {
    try {
      const u = localStorage.getItem("fy_user");
      if (u) setNickname(JSON.parse(u).nickname || JSON.parse(u).username || "用户");
    } catch {}
  }, []);

  // 真正申请浏览器通知权限
  const requestNotification = async () => {
    if (typeof Notification === "undefined") {
      toast.error("当前浏览器不支持通知");
      return;
    }
    if (Notification.permission === "granted") {
      toast.success("通知权限已开启");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      toast.success("通知权限已开启");
      new Notification("飞云通旅游", { body: "行程开始前会通知你 ✈️" });
    } else {
      toast.error("通知权限被拒绝");
    }
  };

  // 深色模式切换（加/去 .dark-mode class 到 html）
  const toggleDarkMode = (on: boolean) => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark-mode", on);
      try { localStorage.setItem("fy_dark_mode", on ? "1" : "0"); } catch {}
    }
  };

  // 上传头像
  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("头像大小不能超过 2MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const user = JSON.parse(localStorage.getItem("fy_user") || "{}");
        user.avatar = reader.result;
        localStorage.setItem("fy_user", JSON.stringify(user));
        toast.success("头像已更新");
        setShowAvatarPicker(false);
      } catch {}
    };
    reader.readAsDataURL(file);
  };

  const setToggle = (i: number, v: boolean) => {
    setToggles((p) => ({ ...p, [i]: v }));
    try { localStorage.setItem(`fy_setting_${i}`, v ? "1" : "0"); } catch {}
    // 每个开关的真实行为
    switch (i) {
      case 1: // 行程数据通知
        toast.success(v ? "已开启：行程开始前会提醒" : "已关闭");
        break;
      case 2: // 积分查询通知
        toast.success(v ? "已开启：积分变动会通知" : "已关闭");
        break;
      case 3: // 系统公告推送
        toast.success(v ? "已开启：系统公告推送" : "已关闭");
        break;
      case 4: // 推送设置（浏览器通知权限）
        if (v) requestNotification();
        else toast.success("已关闭推送");
        break;
      case 5: // 深色模式
        toggleDarkMode(v);
        toast.success(v ? "已切换为深色模式" : "已切换为浅色模式");
        break;
      case 6: // 自动保存行程
        toast.success(v ? "已开启：创建行程自动保存" : "已关闭");
        break;
    }
  };

  const ITEMS = [
    { icon: "👤", label: "个人头像", desc: "点击修改头像" },     // i=0 走头像逻辑
    { icon: "🔔", label: "行程数据通知", desc: "行程开始前一天推送提醒" }, // i=1
    { icon: "⭐", label: "积分查询通知", desc: "积分变动实时通知" },         // i=2
    { icon: "📢", label: "系统公告推送", desc: "产品更新和公告" },           // i=3
    { icon: "🔔", label: "推送设置", desc: "申请浏览器通知权限" },           // i=4
    { icon: "🌙", label: "深色模式", desc: "切换深色/浅色主题" },             // i=5
    { icon: "💾", label: "自动保存行程", desc: "创建行程后自动加入我的行程" }, // i=6
  ];

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">设置</h1>
          <p className="mt-1 text-sm text-gray-500">个性化配置您的使用体验</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-2 shadow-sm">
          {ITEMS.map((it, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-50 text-lg">
                  {it.icon}
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-800">{it.label}</div>
                  <div className="mt-0.5 text-xs text-gray-400">{it.desc}</div>
                </div>
              </div>
              {i === 0 ? (
                // 个人头像：显示「更换」按钮
                <div className="flex items-center gap-2">
                  <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 text-xs font-semibold text-white">
                    {nickname ? nickname.slice(0, 1).toUpperCase() : "飞"}
                  </div>
                  <label className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white cursor-pointer transition-opacity hover:opacity-90">
                    更换
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                  </label>
                </div>
              ) : (
                <button
                  onClick={() => setToggle(i, !toggles[i])}
                  role="switch"
                  aria-checked={!!toggles[i]}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    toggles[i] ? "bg-indigo-500" : "bg-gray-300"
                  }`}
                >
                  {/* 圆钮：显式 left 基准 + 位移，避免按钮默认内边距造成的错位 */}
                  <span
                    className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                      toggles[i] ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 帮助中心
// ---------------------------------------------------------------------------
function HelpPanel(): React.ReactNode {
  const FAQ = [
    { q: "如何新建一个行程？", a: "点击左侧「新建行程」按钮，填写目的地、天数、预算、偏好后点击生成。" },
    { q: "如何查看行程的地图？", a: "行程生成后，进入行程详情页面可查看地图展示与导航。" },
    { q: "如何分享给好友？", a: "在行程规划页面生成行程后，点击「生成云端分享链接」或「下载离线版」。" },
    { q: "如何使用行程？", a: "查看行程单后，可逐日查看活动安排和交通信息。" },
    { q: "联系客服", a: "通过设置页面或邮箱 contact@fytt.com 联系我们。" },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">帮助中心</h1>
          <p className="mt-1 text-sm text-gray-500">常见问题与使用指引</p>
        </div>
        <div className="space-y-2">
          {FAQ.map((f, i) => (
            <div key={i} className="rounded-2xl border border-gray-100 bg-white shadow-sm">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
              >
                <span className="text-sm font-medium text-gray-800">{f.q}</span>
                <span className="text-gray-400">{open === i ? "▾" : "▸"}</span>
              </button>
              {open === i && (
                <div className="border-t border-gray-100 px-5 py-3 text-sm text-gray-600">
                  {f.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 总结页（6 张功能特色卡片）
// ---------------------------------------------------------------------------
function SummaryPanel({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const FEATURES = [
    { icon: "🏠", label: "主页", tab: "dashboard" },
    { icon: "➕", label: "新建行程", tab: "create" },
    { icon: "📋", label: "行程单展示", tab: "trips" },
    { icon: "💰", label: "价格档次对比", tab: "trips" },
    { icon: "🗺️", label: "地图与行程一体化", tab: "map" },
  ];
  return (
    <div className="min-h-full bg-[#0a0a1a]">
      <div className="mx-auto max-w-5xl px-6 py-12 text-white">
        {/* 顶部标题 */}
        <div className="mb-2 text-sm text-indigo-300">项目</div>
        <h1 className="mb-8 text-4xl font-bold">
          <span className="text-purple-400">项目</span>{" "}
          <span className="text-gray-500">|</span>{" "}
          <span className="bg-gradient-to-r from-indigo-300 to-purple-300 bg-clip-text text-transparent">
            完成了 AI 旅行规划工具的开发
          </span>
        </h1>

        {/* 6 张功能卡片 */}
        <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <button
              key={f.label}
              onClick={() => onNavigate(f.tab)}
              className="group rounded-2xl border border-white/10 bg-white/5 p-6 text-left backdrop-blur-md transition-all hover:-translate-y-1 hover:border-white/20 hover:bg-white/10"
            >
              <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-purple-500/30 text-2xl">
                {f.icon}
              </div>
              <div className="text-sm font-semibold text-white">{f.label}</div>
              <div className="mt-2 text-[10px] text-indigo-300">适用情景：核心功能</div>
              <div className="mt-3 text-[10px] text-gray-500">
                点击进入 →
              </div>
            </button>
          ))}
        </div>

        <div className="text-center text-xs text-gray-500">
          © 2026 飞云通旅游平台 · 让每一次出发都心中有数
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceContent 主容器
// ---------------------------------------------------------------------------
function WorkspaceContent(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("t") || "dashboard";
  // 保存"刚生成的行程"id（创建行程页 → 选档页用）
  const [lastShareId, setLastShareId] = useState<string>("");
  const [lastTripInfo, setLastTripInfo] = useState<TripInfo | null>(null);

  const handleNavigate = (key: string, extra?: Record<string, string>) => {
    const q = new URLSearchParams({ t: key, ...(extra || {}) });
    router.replace(`/workspace?${q.toString()}`);
  };

  return (
    <div className="flex h-screen w-full flex-col bg-[#0a0a1a]">
      <TopBar />
      <div className="flex flex-1 overflow-hidden bg-[#f5f5f7]">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          {tab === "dashboard" && <DashboardHome onNavigate={handleNavigate} />}
          {tab === "create" && (
            <CreateTripPanel
              onNavigate={handleNavigate}
              onGenerated={(id, info) => {
                setLastShareId(id);
                setLastTripInfo(info);
              }}
            />
          )}
          {tab === "select-plan" && (
            <SelectPlanPanel
              shareId={lastShareId}
              tripInfo={lastTripInfo}
              onNavigate={handleNavigate}
            />
          )}
          {tab === "trip-detail" && <TripDetailPanel onNavigate={handleNavigate} />}
          {tab === "trips" && <TripsPanel onNavigate={handleNavigate} />}
          {tab === "hotels" && <HotelsPanel />}
          {tab === "map" && <MapPanel />}
          {tab === "settings" && <SettingsPanel />}
          {tab === "help" && <HelpPanel />}
          {tab === "summary" && <SummaryPanel onNavigate={handleNavigate} />}
          {/* 兼容旧 tab 路由 */}
          {tab === "tickets" && <TicketsPanel />}
          {tab === "itinerary" && (
            <div className="mx-auto max-w-4xl p-6">
              <ItineraryPanel />
            </div>
          )}
        </main>
      </div>
      {/* 悬浮 AI 对话助手：fixed 定位，不占布局空间，头部可拖拽移动 */}
      <ChatDock />
    </div>
  );
}

export default function WorkspacePage(): React.ReactNode {
  return <WorkspaceContent />;
}
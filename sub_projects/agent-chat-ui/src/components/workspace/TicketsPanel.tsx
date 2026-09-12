"use client";

/**
 * 火车票 / 机票查询面板
 *
 * 功能：
 *  - 切换「全部 / 机票 / 火车票」，火车票再按车型筛选（高铁动车 / 普速）
 *  - 输入出发地、目的地、日期，查询真实数据（途牛）
 *  - 分页：车次太多时「加载更多」（火车用 queryId 续页）
 *  - 点「预订」弹窗查看**实时余票**：
 *      火车 → 席别（无座/硬座/硬卧/软座/一等座/二等座…）+ 价格 + 余票数
 *      机票 → 舱位（经济舱/公务舱/头等舱）+ 价格含税 + 余票 + 行李额/退改
 *  - 查询条件 / 结果 / 车型筛选 都会持久化到 localStorage
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plane,
  Train,
  Search,
  Clock,
  Loader2,
  Database,
  CloudOff,
  X,
  Ticket as TicketIcon,
  Luggage,
  RotateCcw,
  Armchair,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

interface Ticket {
  id: string;
  type: "flight" | "train";
  number: string;
  from: string;
  to: string;
  depart: string;
  arrive: string;
  duration: string;
  price: number;
  carrier: string;
  category?: string;
  seats?: string;
}

// ----- 查询状态持久化 -----
const TICKETS_KEY = "fy_tickets_query";

type CategoryFilter = "all" | "gd" | "normal";

interface TicketsDraft {
  from: string;
  to: string;
  date: string;
  type: "all" | "flight" | "train";
  categoryFilter: CategoryFilter;
  results: Ticket[];
  dataSource: "live" | "mock" | null;
  queryId: string | null;
  hasMore: boolean;
  pageNum: number;
}

const TICKETS_DEFAULTS: TicketsDraft = {
  from: "南京",
  to: "上海",
  date: "",
  type: "all",
  categoryFilter: "all",
  results: [],
  dataSource: null,
  queryId: null,
  hasMore: false,
  pageNum: 1,
};

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function loadTicketsDraft(): TicketsDraft {
  if (typeof window === "undefined") return TICKETS_DEFAULTS;
  try {
    const raw = localStorage.getItem(TICKETS_KEY);
    if (!raw) return TICKETS_DEFAULTS;
    return { ...TICKETS_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return TICKETS_DEFAULTS;
  }
}

function saveTicketsDraft(d: TicketsDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TICKETS_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

/** 火车车型：优先用后端给的 category，兜底按车次号前缀推断 */
function categoryOf(t: Ticket): string {
  if (t.category) return t.category;
  const n = (t.number || "").toUpperCase();
  if (n.startsWith("G")) return "高铁";
  if (n.startsWith("D")) return "动车";
  if (n.startsWith("C")) return "城际";
  if (n.startsWith("Z")) return "直达";
  if (n.startsWith("T")) return "特快";
  if (n.startsWith("K")) return "快速";
  if (/^\d/.test(n)) return "普快";
  return t.carrier || "";
}

// 车型归组：高铁动车 = G/D/C，普速 = Z/T/K/纯数字
const GD_SET = new Set(["高铁", "动车", "城际"]);
const NORMAL_SET = new Set(["直达", "特快", "快速", "普快", "其他"]);

// 降级演示数据（后端未配 key / 无结果时兜底）
const MOCK_TICKETS: Ticket[] = [
  { id: "1",  type: "flight", number: "MU5102", from: "南京",     to: "上海",     depart: "08:30", arrive: "09:50", duration: "1h20m", price: 680,   carrier: "东方航空" },
  { id: "2",  type: "flight", number: "CA1506", from: "南京",     to: "上海",     depart: "11:00", arrive: "12:25", duration: "1h25m", price: 580,   carrier: "国航" },
  { id: "3",  type: "flight", number: "HO1652", from: "南京",     to: "上海",     depart: "15:40", arrive: "17:00", duration: "1h20m", price: 460,   carrier: "吉祥航空" },
  { id: "4",  type: "train",  number: "G7175",  from: "南京南",   to: "上海虹桥", depart: "07:15", arrive: "08:48", duration: "1h33m", price: 139.5, carrier: "高铁" },
  { id: "5",  type: "train",  number: "G7111",  from: "南京南",   to: "上海虹桥", depart: "10:00", arrive: "11:30", duration: "1h30m", price: 139.5, carrier: "高铁" },
  { id: "6",  type: "train",  number: "D2281",  from: "南京南",   to: "上海",     depart: "14:25", arrive: "16:20", duration: "1h55m", price: 92,    carrier: "动车" },
  { id: "7",  type: "flight", number: "CA1857", from: "北京",     to: "上海",     depart: "07:30", arrive: "09:45", duration: "2h15m", price: 1180,  carrier: "国航" },
  { id: "8",  type: "flight", number: "MU5101", from: "北京",     to: "上海",     depart: "13:00", arrive: "15:20", duration: "2h20m", price: 980,   carrier: "东方航空" },
  { id: "9",  type: "train",  number: "G1",     from: "北京南",   to: "上海虹桥", depart: "09:00", arrive: "13:28", duration: "4h28m", price: 553,   carrier: "高铁" },
  { id: "10", type: "train",  number: "G7",     from: "北京南",   to: "上海虹桥", depart: "13:00", arrive: "17:28", duration: "4h28m", price: 553,   carrier: "高铁" },
  { id: "11", type: "train",  number: "Z281",   from: "北京",     to: "上海",     depart: "19:00", arrive: "07:30", duration: "12h30m", price: 179.5, carrier: "直达" },
  { id: "12", type: "train",  number: "K101",   from: "北京",     to: "上海",     depart: "21:00", arrive: "14:00", duration: "17h",   price: 156.5, carrier: "快速" },
  { id: "13", type: "flight", number: "FM9201", from: "上海",     to: "杭州",     depart: "10:00", arrive: "11:10", duration: "1h10m", price: 520,   carrier: "上海航空" },
  { id: "14", type: "train",  number: "G7335",  from: "上海虹桥", to: "杭州东",   depart: "08:15", arrive: "09:00", duration: "45m",   price: 73,    carrier: "高铁" },
  { id: "15", type: "train",  number: "K8551",  from: "上海南",   to: "杭州",     depart: "06:20", arrive: "08:30", duration: "2h10m", price: 28.5,  carrier: "快速" },
  { id: "16", type: "train",  number: "G6011",  from: "广州南",   to: "深圳北",   depart: "07:00", arrive: "07:29", duration: "29m",   price: 74.5,  carrier: "高铁" },
  { id: "17", type: "flight", number: "CA1411", from: "成都",     to: "重庆",     depart: "09:30", arrive: "10:30", duration: "1h00m", price: 480,   carrier: "国航" },
  { id: "18", type: "train",  number: "G8501",  from: "成都东",   to: "重庆西",   depart: "08:00", arrive: "09:39", duration: "1h39m", price: 154,   carrier: "高铁" },
];

export function TicketsPanel(): React.ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 来自「新建行程 → 选择车次」的 pick 模式：选中车次后回填并跳回
  const pickMode = searchParams.get("pick") === "ticket";

  const _init = loadTicketsDraft();
  const [from, setFrom] = useState(_init.from);
  const [to, setTo] = useState(_init.to);
  const [date, setDate] = useState(_init.date || defaultDate());
  const [type, setType] = useState<"all" | "flight" | "train">(_init.type);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(_init.categoryFilter);
  const [results, setResults] = useState<Ticket[]>(_init.results);
  const [searched, setSearched] = useState(_init.results.length > 0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dataSource, setDataSource] = useState<"live" | "mock" | null>(_init.dataSource);
  // 分页
  const [queryId, setQueryId] = useState<string | null>(_init.queryId); // 火车续页 token
  const [pageNum, setPageNum] = useState(_init.pageNum);
  const [hasMore, setHasMore] = useState(_init.hasMore);
  // 余票详情弹窗
  const [detailTicket, setDetailTicket] = useState<Ticket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [detailError, setDetailError] = useState("");

  // 持久化（结果 + 条件 + 分页状态）
  useEffect(() => {
    saveTicketsDraft({
      from, to, date, type, categoryFilter, results, dataSource, queryId, hasMore, pageNum,
    });
  }, [from, to, date, type, categoryFilter, results, dataSource, queryId, hasMore, pageNum]);

  // 调用 /api/tuniu；失败返回 null（由上层降级到 mock）
  async function fetchTuniu(
    kind: "flight" | "train",
    page = 1,
    qid: string | null = null,
  ): Promise<{ data: Ticket[] | null; queryId: string | null; hasMore: boolean }> {
    try {
      const params = new URLSearchParams({ type: kind, from: from.trim(), to: to.trim(), date });
      if (page > 1) params.set("pageNum", String(page));
      if (qid) params.set("queryId", qid);
      const resp = await fetch(`/api/tuniu?${params.toString()}`);
      const json = await resp.json();
      if (!json.success || !Array.isArray(json.data)) {
        return { data: null, queryId: null, hasMore: false };
      }
      return {
        data: json.data.map((t: Ticket, i: number) => ({ ...t, id: `${kind}-${page}-${i}-${t.number}` })),
        queryId: json.queryId || null,
        hasMore: !!json.hasMore,
      };
    } catch {
      return { data: null, queryId: null, hasMore: false };
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!from.trim() || !to.trim()) {
      toast.error("请填写出发地和目的地");
      return;
    }
    if (!date) {
      toast.error("请选择出行日期");
      return;
    }

    setLoading(true);
    setSearched(false);
    setDetailTicket(null);

    const normalize = (s: string) => s.replace(/(南|北|东|虹桥|西|站)$/g, "");
    const fromKey = normalize(from.trim());
    const toKey = normalize(to.trim());

    // 先用真实数据（途牛）
    let liveResults: Ticket[] = [];
    let newQueryId: string | null = null;
    let more = false;
    try {
      if (type === "all") {
        const [trains, flights] = await Promise.all([
          fetchTuniu("train"),
          fetchTuniu("flight"),
        ]);
        liveResults = [...(trains.data ?? []), ...(flights.data ?? [])];
        newQueryId = trains.queryId;
        more = !!trains.hasMore;
      } else {
        const r = await fetchTuniu(type);
        liveResults = r.data ?? [];
        newQueryId = r.queryId;
        more = r.hasMore;
      }
    } catch {
      liveResults = [];
    }

    // 真实数据命中 → 用真实数据
    if (liveResults.length > 0) {
      liveResults.sort((a, b) => a.depart.localeCompare(b.depart));
      setResults(liveResults);
      setDataSource("live");
      setQueryId(newQueryId);
      setPageNum(1);
      setHasMore(more);
      setSearched(true);
      setLoading(false);
      const trainCount = liveResults.filter((t) => t.type === "train").length;
      const flightCount = liveResults.filter((t) => t.type === "flight").length;
      toast.success(`已查询到 ${liveResults.length} 个班次（${trainCount} 车次 · ${flightCount} 航班）`);
      return;
    }

    // 降级：mock 数据
    const filtered = MOCK_TICKETS.filter((t) => {
      if (type !== "all" && t.type !== type) return false;
      const tFrom = normalize(t.from);
      const tTo = normalize(t.to);
      const fromHit = fromKey === "" || tFrom.includes(fromKey) || fromKey.includes(tFrom);
      const toHit = toKey === "" || tTo.includes(toKey) || toKey.includes(tTo);
      return fromHit && toHit;
    });
    filtered.sort((a, b) => a.depart.localeCompare(b.depart));
    setResults(filtered);
    setDataSource("mock");
    setQueryId(null);
    setPageNum(1);
    setHasMore(false);
    setSearched(true);
    setLoading(false);

    if (filtered.length === 0) {
      toast.info("未找到匹配的班次，试试其它城市或出行方式");
    } else {
      toast.info("暂未获取到真实数据，已展示演示数据", { description: "请确认已在服务端配置 TUNIU_API_KEY" });
    }
  };

  // 加载更多（仅真实数据 + 有更多页时可用）
  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const next = pageNum + 1;
      if (type === "flight") {
        const r = await fetchTuniu("flight", next);
        if (r.data && r.data.length > 0) {
          setResults((prev) => [...prev, ...r.data!]);
          setPageNum(next);
          setHasMore(r.hasMore);
          toast.success(`已追加 ${r.data.length} 个航班`);
        } else {
          setHasMore(false);
          toast.info("没有更多航班了");
        }
      } else {
        // 火车（含"全部"）：用 queryId 续页
        const r = await fetchTuniu("train", next, queryId);
        if (r.data && r.data.length > 0) {
          setResults((prev) => {
            const merged = [...prev, ...r.data!];
            merged.sort((a, b) => a.depart.localeCompare(b.depart));
            return merged;
          });
          setPageNum(next);
          setHasMore(r.hasMore);
          toast.success(`已追加 ${r.data.length} 个车次`);
        } else {
          setHasMore(false);
          toast.info("没有更多车次了");
        }
      }
    } finally {
      setLoadingMore(false);
    }
  };

  // 打开余票详情（实时拉取）
  const openDetail = async (t: Ticket) => {
    setDetailTicket(t);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      if (t.type === "train") {
        const params = new URLSearchParams({
          type: "train-detail",
          depStation: t.from,
          arrStation: t.to,
          date,
          trainNum: t.number,
        });
        const r = await fetch(`/api/tuniu?${params.toString()}`);
        const j = await r.json();
        if (j.success) setDetail(j.data);
        else setDetailError(j.error || "余票查询失败");
      } else {
        const params = new URLSearchParams({
          type: "flight-detail",
          from: from.trim(),
          to: to.trim(),
          date,
          flightNo: t.number,
        });
        const r = await fetch(`/api/tuniu?${params.toString()}`);
        const j = await r.json();
        if (j.success) setDetail(j.data);
        else setDetailError(j.error || "舱位查询失败");
      }
    } catch {
      setDetailError("无法连接后端服务");
    } finally {
      setDetailLoading(false);
    }
  };

  // pick 模式：把车次（含站点/时间/价格/车型）加入「新建行程」并跳回
  const handlePick = (t: Ticket) => {
    const detail = {
      number: String(t.number || "").toUpperCase(),
      from: t.from || "",
      to: t.to || "",
      depart: t.depart || "",
      arrive: t.arrive || "",
      price: t.price ?? null,
      category: categoryOf(t),
      duration: t.duration || "",
    };
    try {
      localStorage.setItem("fy_pending_pick", JSON.stringify({ kind: "ticket", value: detail }));
    } catch {
      /* ignore */
    }
    toast.success(`已加入行程：${detail.number} ${detail.from}→${detail.to}`);
    router.replace("/workspace?t=create");
  };

  const QUICK_CITIES = ["南京", "上海", "北京", "杭州", "广州", "深圳", "成都", "重庆"];

  // 车型筛选后的结果（机票不受车型筛选影响）
  const visibleResults = results.filter((t) => {
    if (t.type === "flight") return true;
    if (categoryFilter === "all") return true;
    const c = categoryOf(t);
    if (categoryFilter === "gd") return GD_SET.has(c);
    if (categoryFilter === "normal") return NORMAL_SET.has(c);
    return true;
  });

  const trainCount = visibleResults.filter((r) => r.type === "train").length;
  const flightCount = visibleResults.filter((r) => r.type === "flight").length;

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">
            {pickMode ? "选择车次（添加到行程）" : "火车票 / 机票查询"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {pickMode
              ? "搜索并挑好想坐的车次，点「加入行程」即可自动回到新建行程页"
              : "通过途牛（tuniu）实时查询真实车次与航班，含余票与价格"}
          </p>
          {pickMode && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-700">
              <Plus className="size-4 shrink-0" />
              <span>选择模式：建议切到「🚄 火车票」查询，找到车次后点「加入行程」</span>
              <button
                onClick={() => router.replace("/workspace?t=create")}
                className="ml-auto text-xs text-indigo-500 hover:underline"
              >
                放弃并返回新建行程
              </button>
            </div>
          )}
        </div>

        {/* 搜索表单 */}
        <form onSubmit={handleSearch} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap gap-2">
            {[
              { k: "all", label: "全部" },
              { k: "flight", label: "✈️ 机票" },
              { k: "train", label: "🚄 火车票" },
            ].map((opt) => (
              <button
                key={opt.k}
                type="button"
                onClick={() => setType(opt.k as typeof type)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  type === opt.k
                    ? "bg-indigo-500 text-white"
                    : "border border-gray-200 text-gray-600 hover:border-indigo-300"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* 车型筛选（仅在包含火车票时显示） */}
          {type !== "flight" && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>车型：</span>
              {[
                { k: "all", label: "全部" },
                { k: "gd", label: "🚄 高铁动车" },
                { k: "normal", label: "🚂 普速列车" },
              ].map((opt) => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setCategoryFilter(opt.k as CategoryFilter)}
                  className={`rounded-full px-3 py-1 transition-colors ${
                    categoryFilter === opt.k
                      ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300"
                      : "border border-gray-200 text-gray-500 hover:border-indigo-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr_180px] sm:items-center">
            <input
              type="text"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="出发地（如：上海）"
              className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="button"
              onClick={() => { const a = from; setFrom(to); setTo(a); }}
              className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-500 transition-colors hover:border-indigo-300 hover:text-indigo-500"
              title="交换出发地与目的地"
            >
              ⇄
            </button>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="目的地（如：南京）"
              className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>快捷城市：</span>
            {QUICK_CITIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setTo(c)}
                className="rounded-full border border-gray-200 px-2.5 py-0.5 hover:border-indigo-300 hover:text-indigo-500"
              >
                {c}
              </button>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {loading ? "查询中…" : <>查询 {date && <span className="opacity-80">· {date}</span>}</>}
          </button>
        </form>

        {/* 加载态 */}
        {loading && (
          <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-indigo-500" />
            <p className="mt-3 text-sm text-gray-500">正在从途牛获取实时数据…</p>
          </div>
        )}

        {/* 结果列表 */}
        {searched && !loading && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {visibleResults.length > 0 ? (
                  <>
                    {from} → {to} ·
                    <span className="ml-1 font-medium text-indigo-600">
                      共 {visibleResults.length} 个班次
                    </span>
                    {categoryFilter !== "all" && (
                      <span className="ml-1 text-gray-400">（已按车型筛选）</span>
                    )}
                  </>
                ) : (
                  "暂无结果"
                )}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setResults([]);
                    setSearched(false);
                    setDataSource(null);
                    setQueryId(null);
                    setPageNum(1);
                    setHasMore(false);
                    setCategoryFilter("all");
                    try { localStorage.removeItem(TICKETS_KEY); } catch { /* ignore */ }
                    toast.success("已清空历史查询");
                  }}
                  className="rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                >
                  清空
                </button>
                {dataSource === "live" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                    <Database className="size-3" /> 实时数据
                  </span>
                ) : dataSource === "mock" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-600">
                    <CloudOff className="size-3" /> 演示数据
                  </span>
                ) : null}
                <div className="text-xs text-gray-400">
                  {flightCount} 航班 · {trainCount} 车次
                </div>
              </div>
            </div>

            {visibleResults.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`flex size-10 items-center justify-center rounded-lg ${
                      t.type === "flight" ? "bg-sky-50 text-sky-600" : "bg-emerald-50 text-emerald-600"
                    }`}
                  >
                    {t.type === "flight" ? <Plane className="size-5" /> : <Train className="size-5" />}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-800">
                      {t.from} → {t.to}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {t.depart} – {t.arrive}
                      </span>
                      <span>· {t.duration}</span>
                      <span>· {t.carrier}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">{t.number}</span>
                      {t.type === "train" && categoryOf(t) && (
                        <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">
                          {categoryOf(t)}
                        </span>
                      )}
                    </div>
                    {t.seats && <div className="mt-1 text-[11px] text-gray-400">余票：{t.seats}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-lg font-bold text-indigo-600">¥{t.price.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400">起</div>
                  </div>
                  {pickMode ? (
                    <>
                      <button
                        onClick={() => openDetail(t)}
                        className="rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                      >
                        余票
                      </button>
                      <button
                        onClick={() => handlePick(t)}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                      >
                        <Plus className="size-3" /> 加入行程
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => openDetail(t)}
                      className="rounded-lg bg-indigo-500 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      预订
                    </button>
                  )}
                </div>
              </div>
            ))}

            {visibleResults.length === 0 && results.length > 0 && (
              <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center">
                <p className="text-sm text-gray-500">当前车型筛选下没有班次</p>
                <button
                  onClick={() => setCategoryFilter("all")}
                  className="mt-2 text-xs text-indigo-600 hover:underline"
                >
                  查看全部车型
                </button>
              </div>
            )}

            {results.length === 0 && (
              <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center">
                <p className="text-sm text-gray-500">暂无匹配的班次</p>
                <p className="mt-1 text-xs text-gray-400">试试更换出发地/目的地，或切换「全部」</p>
              </div>
            )}

            {/* 加载更多 */}
            {dataSource === "live" && hasMore && results.length > 0 && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full rounded-xl border border-indigo-200 bg-white py-2.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:opacity-60"
              >
                {loadingMore ? "加载中…" : "加载更多班次"}
              </button>
            )}
          </div>
        )}

        {/* 未搜索时的引导 */}
        {!searched && !loading && (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white/60 p-10 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-indigo-50 text-2xl">
              🚄✈️
            </div>
            <p className="text-sm font-medium text-gray-700">输入出发地、目的地与日期，实时查询火车票与机票</p>
            <p className="mt-1 text-xs text-gray-400">
              数据由途牛（tuniu）提供，点击「预订」可查看实时余票与价格
            </p>
          </div>
        )}
      </div>

      {/* ============ 余票详情弹窗 ============ */}
      {detailTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setDetailTicket(null)}
        >
          <div
            className="relative max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div
                  className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                    detailTicket.type === "flight" ? "bg-sky-50 text-sky-600" : "bg-emerald-50 text-emerald-600"
                  }`}
                >
                  {detailTicket.type === "flight" ? <Plane className="size-4" /> : <Train className="size-4" />}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-gray-800">
                    {detailTicket.number} · {detailTicket.from} → {detailTicket.to}
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {detailTicket.depart} – {detailTicket.arrive} · {detailTicket.duration} · {detailTicket.carrier}
                    {detailTicket.type === "train" && categoryOf(detailTicket) ? ` · ${categoryOf(detailTicket)}` : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDetailTicket(null)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200"
                aria-label="关闭"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-5">
              {detailLoading ? (
                <div className="flex h-40 flex-col items-center justify-center gap-3">
                  <Loader2 className="size-6 animate-spin text-indigo-500" />
                  <p className="text-xs text-gray-400">正在获取实时余票…</p>
                </div>
              ) : detailError ? (
                <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center">
                  <p className="text-sm text-gray-500">{detailError}</p>
                  <button
                    onClick={() => openDetail(detailTicket)}
                    className="mt-3 rounded-lg bg-indigo-500 px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
                  >
                    重试
                  </button>
                </div>
              ) : detail?.seats?.length > 0 ? (
                /* ---------- 火车：席别列表 ---------- */
                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <Armchair className="size-4 text-indigo-500" />
                    实时余票（{detail.departsDate || date}）
                  </div>
                  <div className="space-y-2">
                    {detail.seats.map((s: any, i: number) => {
                      const hasTicket = Number(s.leftNumber) > 0;
                      return (
                        <div
                          key={i}
                          className={`flex items-center justify-between rounded-xl border border-gray-100 p-3 ${
                            hasTicket ? "bg-gray-50" : "bg-gray-50/50 opacity-60"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex size-9 items-center justify-center rounded-lg bg-white text-sm">
                              🪑
                            </span>
                            <div>
                              <div className="text-sm font-medium text-gray-800">{s.seatName}</div>
                              <div className="mt-0.5 text-xs text-gray-500">
                                {hasTicket ? (
                                  <>
                                    余票 <span className="font-semibold text-emerald-600">{s.leftNumber}</span> 张
                                  </>
                                ) : (
                                  <span className="text-gray-400">无票</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className={`text-base font-bold ${hasTicket ? "text-indigo-600" : "text-gray-400"}`}>
                              ¥{s.price ?? "—"}
                            </div>
                            <button
                              disabled={!hasTicket}
                              onClick={() =>
                                toast.success(`已选择 ${detailTicket.number} · ${s.seatName} ¥${s.price}（演示）`)
                              }
                              className="rounded-lg bg-indigo-500 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300"
                            >
                              {hasTicket ? "预订" : "无票"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : detail?.cabins?.length > 0 ? (
                /* ---------- 机票：舱位列表 ---------- */
                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
                    <TicketIcon className="size-4 text-indigo-500" />
                    舱位与价格（含税）
                  </div>
                  <div className="space-y-2">
                    {detail.cabins.map((c: any, i: number) => {
                      const hasSeat = Number(c.remainingSeats) > 0;
                      return (
                        <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-gray-800">{c.cabinClass}</span>
                                <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-500">
                                  {c.cabinClassCodes}
                                </span>
                                {c.buyCondition && (
                                  <span className="rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">
                                    {c.buyCondition}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                                {c.baggageInfo && (
                                  <span className="flex items-center gap-1">
                                    <Luggage className="size-3" /> {c.baggageInfo}
                                  </span>
                                )}
                                {c.refundChangeRule && (
                                  <span className="flex items-center gap-1">
                                    <RotateCcw className="size-3" /> {c.refundChangeRule}
                                  </span>
                                )}
                                {c.mealCode && <span>· {c.mealCode}</span>}
                                <span>
                                  余票{" "}
                                  <span className={hasSeat ? "font-semibold text-emerald-600" : "text-gray-400"}>
                                    {c.remainingSeats ?? "—"}
                                  </span>
                                </span>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <div className="whitespace-nowrap text-base font-bold text-indigo-600">
                                ¥{c.totalPrice}
                              </div>
                              <div className="whitespace-nowrap text-[10px] text-gray-400">
                                ¥{c.basePrice}+税¥{c.totalTax}
                              </div>
                              <button
                                disabled={!hasSeat}
                                onClick={() =>
                                  toast.success(`已选择 ${detailTicket.number} · ${c.cabinClass} ¥${c.totalPrice}（演示）`)
                                }
                                className="rounded-lg bg-indigo-500 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300"
                              >
                                {hasSeat ? "订" : "无票"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-gray-200 py-10 text-center">
                  <p className="text-sm text-gray-500">暂无余票信息</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

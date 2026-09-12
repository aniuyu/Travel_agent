"use client";

/**
 * 酒店预订面板（真实数据：途牛 tuniu hotel）
 *
 * 数据源：/api/tuniu（type=hotel / hotel-detail）
 * 展示：真实照片、人均消费(lowestPrice)、评分(commentScore)、用户评价摘要(commentDigest)
 * 支持：城市 / 关键词 / 入离店日期 搜索，点击酒店查看房型与价格详情
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Building2,
  Search,
  MapPin,
  Star,
  X,
  Loader2,
  BedDouble,
  Wifi,
  ChevronRight,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

// ----- 查询状态持久化 -----
// 切 tab 时整个 panel 重新挂载，搜索条件 + 结果列表 + 详情弹窗 全部会丢。
// 整个面板状态存 localStorage，切走再回来 / 刷新页面都还在。
const HOTELS_KEY = "fy_hotels_query";

interface HotelsDraft {
  city: string;
  keyword: string;
  checkIn: string;
  checkOut: string;
  hotels: Hotel[];
  // 详情弹窗：只存 hotelId，重新打开时自动重拉详情 + 照片
  selectedHotelId: number | null;
}

const HOTELS_DEFAULTS: HotelsDraft = {
  city: "上海",
  keyword: "",
  checkIn: "", // 首次空，下面 useState 兜底 7/8 天后
  checkOut: "",
  hotels: [],
  selectedHotelId: null,
};

function defaultCheckIn(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}
function defaultCheckOut(): string {
  const d = new Date();
  d.setDate(d.getDate() + 8);
  return d.toISOString().slice(0, 10);
}

function loadHotelsDraft(): HotelsDraft {
  if (typeof window === "undefined") return HOTELS_DEFAULTS;
  try {
    const raw = localStorage.getItem(HOTELS_KEY);
    if (!raw) return HOTELS_DEFAULTS;
    return { ...HOTELS_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return HOTELS_DEFAULTS;
  }
}

function saveHotelsDraft(d: HotelsDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HOTELS_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

interface Hotel {
  id: string;
  hotelId: number;
  name: string;
  address: string;
  city: string;
  business: string;
  starName: string;
  brandName: string;
  pic: string;
  score: number | null;
  commentDigest: string;
  price: number | null;
  meal: string;
  refund: string;
  roomName: string;
  roomArea: string;
}

interface RatePlan {
  ratePlanName: string;
  price: number | null;
  mealText: string;
  cancelText: string;
  cancelDesc: string;
}

interface Room {
  roomTypeId?: string;
  roomName: string;
  bedType: string;
  area: string | number;
  floor: string;
  window: string;
  maxOccupancy?: number | null;
  pic: string;
  ratePlans: RatePlan[];
}

interface HotelDetail {
  hotelId: number;
  name: string;
  nameEn: string;
  starName: string;
  pic: string;
  city: string;
  business: string;
  score: number | null;
  reviewCount: number | null;
  policies: any[];
  rooms: Room[];
}

export function HotelsPanel(): React.ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 来自「新建行程 → 选择酒店」的 pick 模式：选中酒店后回填并跳回
  const pickMode = searchParams.get("pick") === "hotel";

  // 初始化从 localStorage 读，失败时回落默认
  const _init = loadHotelsDraft();
  const [city, setCity] = useState(_init.city);
  const [keyword, setKeyword] = useState(_init.keyword);
  const [checkIn, setCheckIn] = useState(_init.checkIn || defaultCheckIn());
  const [checkOut, setCheckOut] = useState(_init.checkOut || defaultCheckOut());
  const [hotels, setHotels] = useState<Hotel[]>(_init.hotels);
  const [loading, setLoading] = useState(false);
  // selectedHotel：恢复时由 useEffect 异步拉回
  const [selectedHotel, setSelectedHotel] = useState<Hotel | null>(
    _init.hotels.find((h) => h.hotelId === _init.selectedHotelId) || null,
  );
  const [detail, setDetail] = useState<HotelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [amapPhotos, setAmapPhotos] = useState<string[]>([]);

  // 任何查询条件 / 结果 / 选中酒店变化 → 写回 localStorage
  useEffect(() => {
    saveHotelsDraft({
      city, keyword, checkIn, checkOut, hotels,
      selectedHotelId: selectedHotel?.hotelId ?? null,
    });
  }, [city, keyword, checkIn, checkOut, hotels, selectedHotel]);

  // 搜索酒店（途牛真实数据）
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!city.trim()) { toast.error("请填写城市"); return; }
    if (!checkIn || !checkOut) { toast.error("请选择入离店日期"); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: "hotel",
        city: city.trim(),
        checkIn,
        checkOut,
      });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const res = await fetch(`/api/tuniu?${params.toString()}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setHotels(json.data);
        if (json.data.length === 0) toast.info("未找到匹配的酒店，换个城市或日期试试");
      } else {
        toast.error(json.error || "搜索失败");
        setHotels([]);
      }
    } catch (err: any) {
      toast.error("无法连接服务：" + (err?.message || ""));
    } finally {
      setLoading(false);
    }
  };

  // 点击酒店 → 并行拉「途牛详情（价格/评价/房型）」+「高德照片（高清环境图）」
  const handleOpenDetail = async (h: Hotel) => {
    setSelectedHotel(h);
    setDetail(null);
    setAmapPhotos([]);
    setDetailLoading(true);

    // 并行：途牛详情 + 高德照片（互不阻塞）
    const tuniuDetail = (async () => {
      try {
        const params = new URLSearchParams({
          type: "hotel-detail",
          hotelId: String(h.hotelId),
          checkIn,
          checkOut,
        });
        const res = await fetch(`/api/tuniu?${params.toString()}`);
        const json = await res.json();
        if (json.success && json.data) {
          setDetail(json.data);
        } else {
          toast.error(json.error || "详情加载失败");
        }
      } catch {
        toast.error("途牛详情服务连接失败");
      } finally {
        setDetailLoading(false);
      }
    })();

    const amapPic = (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/hotels/photos?name=${encodeURIComponent(h.name)}&city=${encodeURIComponent(h.city || city)}`,
        );
        const json = await res.json();
        if (res.ok && json.status === "success" && Array.isArray(json.data?.photos)) {
          setAmapPhotos(json.data.photos);
        }
      } catch {
        // 高德照片拉不到就静默，用 途牛图兜底
      }
    })();

    await Promise.allSettled([tuniuDetail, amapPic]);
  };

  const handleBook = (h: Hotel | HotelDetail, room?: Room, plan?: RatePlan) => {
    const hAny = h as any;
    const priceText =
      plan?.price != null
        ? `¥${plan.price}`
        : hAny.price != null
          ? `¥${hAny.price}`
          : "";
    toast.success(`已预订 ${h.name}${room?.roomName ? ` · ${room.roomName}` : ""} ${priceText}（演示）`);
  };

  // pick 模式：把酒店（含价格/评分/星级/位置）加入「新建行程」并跳回
  const handlePick = (h: Hotel) => {
    const detail = {
      name: h.name,
      price: h.price ?? null,
      score: h.score ?? null,
      starName: h.starName || "",
      business: h.business || "",
      address: h.address || "",
      pic: h.pic || "",
    };
    try {
      localStorage.setItem("fy_pending_pick", JSON.stringify({ kind: "hotel", value: detail }));
    } catch {
      /* ignore */
    }
    toast.success(`已加入行程：${detail.name}`);
    router.replace("/workspace?t=create");
  };

  const scoreColor = (s: number | null) =>
    s == null ? "text-gray-400" : s >= 4.5 ? "text-emerald-600" : s >= 4.0 ? "text-amber-600" : "text-red-500";

  // 途牛 firstPic 默认是 w200 小图（模糊），去掉裁剪参数换成原图（800px，更清晰）
  const tuniuHd = (url: string): string => {
    if (!url) return "";
    return url.replace(/_w\d+_h\d+_c1_t0\.(jpg|png|jpeg)$/i, ".$1").replace(/_w\d+_h\d+/i, "");
  };

  const API_BASE = "http://localhost:8000";

  return (
    <div className="min-h-full bg-[#f5f5f7]">
      <div className="mx-auto max-w-4xl p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">
            {pickMode ? "选择酒店（添加到行程）" : "酒店/民宿预订"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {pickMode
              ? "先搜索并挑选酒店，点「加入行程」即可自动回到新建行程页"
              : "真实数据 · 途牛酒店搜索 · 含价格、评分与用户评价"}
          </p>
          {pickMode && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-700">
              <Plus className="size-4 shrink-0" />
              <span>选择模式：搜索并找到想住的酒店，点「加入行程」自动回填</span>
              <button
                onClick={() => router.replace("/workspace?t=create")}
                className="ml-auto text-xs text-indigo-500 hover:underline"
              >
                放弃并返回新建行程
              </button>
            </div>
          )}
        </div>

        <form onSubmit={handleSearch} className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs text-gray-500">城市</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="例如：上海、北京"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-gray-500">入住日期</label>
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-gray-500">离店日期</label>
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-gray-500">关键词（可选）</label>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="酒店名"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {loading ? "搜索中…" : "搜索酒店"}
          </button>
          <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
            <span>查询条件 / 结果 / 详情已自动保存，切走再回来不丢失</span>
            <button
              type="button"
              onClick={() => {
                setHotels([]);
                setSelectedHotel(null);
                setDetail(null);
                setAmapPhotos([]);
                try { localStorage.removeItem(HOTELS_KEY); } catch { /* ignore */ }
                toast.success("已清空历史查询");
              }}
              className="rounded-md px-2 py-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              清空
            </button>
          </div>
        </form>

        {/* 酒店列表 */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {hotels.length === 0 && !loading && (
            <div className="col-span-2 rounded-2xl border-2 border-dashed border-gray-200 py-10 text-center">
              <p className="text-sm text-gray-500">选择城市和日期，搜索真实酒店</p>
              <p className="mt-1 text-xs text-gray-400">数据由途牛（tuniu）提供，含价格、评分与真实评价</p>
            </div>
          )}
          {hotels.map((h) => (
            <div
              key={h.id}
              onClick={() => handleOpenDetail(h)}
              className="cursor-pointer overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {/* 照片（途牛原图，比默认 firstPic 小图清晰） */}
              <div className="relative h-40 overflow-hidden bg-gradient-to-br from-indigo-100 to-purple-100">
                {h.pic ? (
                  <img
                    src={tuniuHd(h.pic)}
                    alt={h.name}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement;
                      if (el.src !== h.pic) el.src = h.pic; // 原图失败则回退到小图
                      else el.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-4xl">🏨</div>
                )}
                {h.starName && (
                  <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] text-white">
                    {h.starName}
                  </span>
                )}
                {h.score != null && (
                  <span className={`absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-bold ${scoreColor(h.score)}`}>
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    {h.score}
                  </span>
                )}
              </div>

              <div className="p-3">
                <div className="line-clamp-1 text-sm font-semibold text-gray-800">{h.name}</div>
                <div className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                  <MapPin className="size-3 shrink-0" />
                  <span className="line-clamp-1">{h.address || h.business || "地址暂无"}</span>
                </div>

                {/* 用户评价摘要 */}
                {h.commentDigest && (
                  <p className="mt-1.5 line-clamp-1 text-xs text-gray-400">
                    💬 {h.commentDigest}
                  </p>
                )}

                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-baseline gap-1">
                    {h.price != null ? (
                      <>
                        <span className="text-lg font-bold text-indigo-600">¥{h.price}</span>
                        <span className="text-[10px] text-gray-400">起</span>
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">价格详询</span>
                    )}
                    {h.meal && <span className="ml-1 text-[10px] text-emerald-600">{h.meal}</span>}
                  </div>
                  {pickMode ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handlePick(h); }}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      <Plus className="size-3" /> 加入行程
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleBook(h); }}
                      className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      预订
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 酒店详情弹窗 */}
      {selectedHotel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedHotel(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-5 py-3">
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-1 text-lg font-bold text-gray-800">{selectedHotel.name}</h3>
                <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">
                  {selectedHotel.starName} · {selectedHotel.address}
                </p>
              </div>
              <button
                onClick={() => setSelectedHotel(null)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200"
                aria-label="关闭"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="p-5">
              {detailLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="size-6 animate-spin text-indigo-500" />
                </div>
              ) : (
                <>
                  {/* 大图 + 关键信息 */}
                  <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <div className="overflow-hidden rounded-xl bg-indigo-50">
                        {(() => {
                          // 照片优先级：高德高清图 > 途牛原图 > 占位
                          const hdUrl = amapPhotos[0] || tuniuHd(detail?.pic || selectedHotel.pic);
                          return hdUrl ? (
                            <img
                              src={hdUrl}
                              alt={selectedHotel.name}
                              className="aspect-[4/3] w-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div className="flex aspect-[4/3] items-center justify-center text-5xl">🏨</div>
                          );
                        })()}
                      </div>
                      {/* 高德环境图缩略条（多张时） */}
                      {amapPhotos.length > 1 && (
                        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                          {amapPhotos.slice(0, 6).map((u, i) => (
                            <img
                              key={i}
                              src={u}
                              alt={`环境图 ${i + 1}`}
                              className="h-14 w-20 shrink-0 cursor-pointer rounded-md border border-gray-200 object-cover hover:border-indigo-400"
                              onClick={(e) => {
                                // 点击缩略图换主图：把当前图与第一张交换
                                const copy = [...amapPhotos];
                                [copy[0], copy[i]] = [copy[i], copy[0]];
                                setAmapPhotos(copy);
                              }}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-amber-50 p-3">
                        <div className="text-[10px] text-gray-500">综合评分</div>
                        <div className="mt-1 flex items-baseline gap-1 text-amber-600">
                          <Star className="size-4 fill-amber-400 text-amber-400" />
                          <span className="text-lg font-bold">{detail?.score ?? selectedHotel.score ?? "—"}</span>
                        </div>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-3">
                        <div className="text-[10px] text-gray-500">人均消费</div>
                        <div className="mt-1 text-lg font-bold text-emerald-600">
                          ¥{selectedHotel.price ?? "—"}
                        </div>
                      </div>
                      <div className="rounded-xl bg-indigo-50 p-3">
                        <div className="text-[10px] text-gray-500">档次</div>
                        <div className="mt-1 text-sm font-medium text-indigo-700">
                          {detail?.starName || selectedHotel.starName || "—"}
                        </div>
                      </div>
                      <div className="rounded-xl bg-purple-50 p-3">
                        <div className="text-[10px] text-gray-500">位置</div>
                        <div className="mt-1 line-clamp-1 text-sm font-medium text-purple-700">
                          {detail?.business || selectedHotel.business || "—"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 用户评价 */}
                  <div className="mb-5">
                    <h4 className="mb-2 text-sm font-semibold text-gray-800">💬 用户真实评价</h4>
                    {selectedHotel.commentDigest ? (
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                        <div className="flex items-start gap-2">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm">
                            👤
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-gray-700">途牛住客</span>
                              <span className="flex items-center gap-0.5 text-xs font-bold text-amber-600">
                                <Star className="size-3 fill-amber-400 text-amber-400" />
                                {detail?.score ?? selectedHotel.score ?? ""}
                              </span>
                            </div>
                            <p className="mt-1 text-sm leading-relaxed text-gray-600">
                              {selectedHotel.commentDigest}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border-2 border-dashed border-gray-200 py-6 text-center">
                        <p className="text-sm text-gray-400">暂无用户评价摘要</p>
                        <p className="mt-1 text-xs text-gray-400">
                          综合评分 {detail?.score ?? selectedHotel.score ?? "—"} · 更多评价可在预订页查看
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 房型与价格 */}
                  {detail && detail.rooms.length > 0 && (
                    <div className="mb-5">
                      <h4 className="mb-2 text-sm font-semibold text-gray-800">
                        🛏️ 房型与价格
                        <span className="ml-2 text-xs font-normal text-gray-400">
                          （{checkIn} 至 {checkOut}）
                        </span>
                      </h4>
                      <div className="space-y-2">
                        {detail.rooms.map((room, ri) => {
                          const plan = room.ratePlans?.[0];
                          const roomName = room.roomName || plan?.ratePlanName || "标准房型";
                          // 房型规格：床型 · 面积 · 楼层 · 可住N人
                          const specs = [
                            room.bedType,
                            room.area ? `${room.area}㎡` : "",
                            room.floor,
                            room.maxOccupancy ? `可住${room.maxOccupancy}人` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          // 取消政策：优先短文案，长段落放 tooltip
                          const cancelShort = plan?.cancelText || plan?.cancelDesc || "";
                          const cancelFull = plan?.cancelDesc || cancelShort;
                          return (
                            <div
                              key={room.roomTypeId || ri}
                              className="rounded-xl border border-gray-100 bg-gray-50 p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                {/* 左：房型信息（min-w-0 + truncate 防止被挤压成竖排） */}
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                  <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-indigo-100 text-indigo-600">
                                    {room.pic ? (
                                      <img
                                        src={room.pic}
                                        alt={roomName}
                                        className="size-full object-cover"
                                        onError={(e) => {
                                          const el = e.target as HTMLImageElement;
                                          el.style.display = "none";
                                        }}
                                      />
                                    ) : (
                                      <BedDouble className="size-5" />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div
                                      className="truncate text-sm font-medium text-gray-800"
                                      title={roomName}
                                    >
                                      {roomName}
                                    </div>
                                    {specs && (
                                      <div className="mt-0.5 truncate text-xs text-gray-500" title={specs}>
                                        {specs}
                                      </div>
                                    )}
                                    {plan?.mealText && (
                                      <div className="mt-0.5 truncate text-xs text-emerald-600">
                                        {plan.mealText}
                                      </div>
                                    )}
                                    {cancelShort && (
                                      <div
                                        className="mt-1 truncate text-[11px] text-gray-400"
                                        title={cancelFull}
                                      >
                                        {cancelShort}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* 右：价格 + 订（shrink-0，不被长文本挤压） */}
                                <div className="flex shrink-0 flex-col items-end gap-1.5">
                                  <div className="whitespace-nowrap text-base font-bold text-indigo-600">
                                    ¥{plan?.price ?? "—"}
                                  </div>
                                  <button
                                    onClick={() => handleBook(detail, room, plan)}
                                    className="rounded-lg bg-indigo-500 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                                  >
                                    订
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => { setSelectedHotel(null); }}
                      className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      关闭
                    </button>
                    <button
                      onClick={() => {
                        if (pickMode) handlePick(selectedHotel);
                        else handleBook(detail || selectedHotel);
                      }}
                      className="flex-1 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      {pickMode ? "➕ 加入行程" : `立即预订 ¥${selectedHotel.price ?? "—"}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

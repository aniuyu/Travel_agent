import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 途牛火车票/机票查询代理
 *
 * 前端无法直接调用 tuniu CLI（只能在 Node 服务端跑），
 * 本 route 作为中间层：接收查询参数 → 调用 tuniu CLI → 返回真实数据。
 *
 * 请求：
 *   GET  /api/tuniu?type=flight|train&from=南京&to=上海&date=2026-10-20
 * 响应：
 *   { success: true, type, data: [...] }  或  { success: false, error: "..." }
 *
 * 认证：
 *   优先读环境变量 TUNIU_API_KEY（配合 TUNIU_AUTH_TYPE=apiKey）。
 *   .env 里的 key 会被 Next.js 自动加载进 process.env，但 shell 里的 tuniu
 *   子进程读不到 Next 的 process.env，所以这里显式把 key 传给子进程 env。
 */

interface TicketResult {
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
  seats?: string;
  /** 车型细分：高铁/动车/城际/直达/特快/快速/普快（火车）；机型大类（飞机留空） */
  category?: string;
  raw?: unknown;
}

// 按车次号前缀判断车型。
// 搜索接口的 trainType 字段只给 "direct"，区分不出高铁/普速，必须靠车次号：
//   G 高铁 / D 动车 / C 城际 / Z 直达特快 / T 特快 / K 快速 / 纯数字 普快
function trainCategory(trainNum: string): string {
  const n = (trainNum || "").toUpperCase();
  if (n.startsWith("G")) return "高铁";
  if (n.startsWith("D")) return "动车";
  if (n.startsWith("C")) return "城际";
  if (n.startsWith("Z")) return "直达";
  if (n.startsWith("T")) return "特快";
  if (n.startsWith("K")) return "快速";
  if (/^\d/.test(n)) return "普快";
  return "其他";
}

const TUNIU_API_KEY = process.env.TUNIU_API_KEY || "";
const TUNIU_AUTH_TYPE = process.env.TUNIU_AUTH_TYPE || "apiKey";

// 定位 tuniu 可执行文件。
// 开发机上 tuniu 装在 workbuddy 托管的 node 目录下，Next dev server 的 PATH 里
// 可能没有它。最可靠的方式是直接调用该目录下的 node.exe 跑 tuniu-cli/bin/tuniu.js，
// 绕开 Windows 下 .cmd 包装脚本的参数转义问题。
import { existsSync } from "fs";

interface TuniuRuntime {
  cmd: string;
  args: string[];
}

function resolveTuniuRuntime(): TuniuRuntime {
  const nodeBin = "C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\versions\\22.22.2-2\\node.exe";
  const tuniuJs =
    "C:\\Users\\Administrator\\.workbuddy\\binaries\\node\\versions\\22.22.2-2\\node_modules\\tuniu-cli\\bin\\tuniu.js";

  if (existsSync(nodeBin) && existsSync(tuniuJs)) {
    return { cmd: nodeBin, args: [tuniuJs] };
  }
  // 回退：裸命令名
  return { cmd: process.platform === "win32" ? "tuniu.cmd" : "tuniu", args: [] };
}

// 调用 tuniu CLI，返回 stdout 字符串
async function runTuniu(server: string, tool: string, args: object): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (TUNIU_API_KEY) {
    env.TUNIU_API_KEY = TUNIU_API_KEY;
    env.TUNIU_AUTH_TYPE = TUNIU_AUTH_TYPE;
  }
  const rt = resolveTuniuRuntime();
  const fullArgs = [...rt.args, "call", server, tool, "-a", JSON.stringify(args)];
  const { stdout, stderr } = await execFileAsync(rt.cmd, fullArgs, {
    timeout: 60000,
    maxBuffer: 20 * 1024 * 1024,
    env,
  });
  if (stderr) {
    console.warn("[tuniu] stderr:", stderr.slice(0, 500));
  }
  return stdout;
}

// 途牛返回结构：{ success, result: { content: [ { type:"text", text:"<json string>" } ] } }
// 把最内层的业务 data 解出来
function extractData(raw: string): { data: any[]; error?: string } {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { data: [], error: "途牛返回非 JSON：" + raw.slice(0, 200) };
  }

  if (parsed?.success === false) {
    return {
      data: [],
      error: parsed?.error?.message || parsed?.error?.type || "途牛服务调用失败",
    };
  }

  // 解包 content[0].text
  let inner = parsed?.result;
  if (inner?.content && Array.isArray(inner.content)) {
    const text = inner.content.find((c: any) => c?.type === "text")?.text;
    if (text) {
      try {
        inner = JSON.parse(text);
      } catch {
        inner = { raw: text };
      }
    }
  }

  const data = inner?.data;
  if (Array.isArray(data)) return { data };

  // 兜底：尝试 result 本身是数组
  if (Array.isArray(inner)) return { data: inner };

  return { data: [], error: "未找到数据列表" };
}

// 把可能是字符串/数字的价格统一转成 number（取不到返回 null）
function toNumber(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 从席别价格对象里取一个最合适的展示价（优先二等座/经济舱，其次任一非空）
function pickPrice(price: any, seatAvailable: any): number {
  if (typeof price === "number") return price;
  if (!price || typeof price !== "object") return 0;

  // 火车席别优先级：二等座 > 一等座 > 硬卧 > 软卧 > 硬座 > 无座
  const trainOrder = [
    "edzPrice", "ydzPrice", "swzPrice", "ydwPrice", "edwPrice",
    "ywPrice", "rwPrice", "yzPrice", "wzPrice",
  ];
  // 机票：basePrice 已是单值，这里兜底
  if (price.basePrice != null && price.basePrice !== "") {
    return Number(price.basePrice) || 0;
  }
  for (const k of trainOrder) {
    const v = price[k];
    if (v != null && v !== "" && Number(v) > 0) return Number(v);
  }
  // 兜底任意非空数值
  for (const k in price) {
    const v = price[k];
    if (v != null && v !== "" && !isNaN(Number(v)) && Number(v) > 0) return Number(v);
  }
  return 0;
}

// 归一化火车票数据
function normalizeTrains(data: any[]): TicketResult[] {
  return data.map((t: any, i: number) => {
    const dep = (t.departureTime || "").replace("T", " ").slice(0, 16);
    const arr = (t.arrivalTime || "").replace("T", " ").slice(0, 16);
    const num = t.trainNum || t.trainNo || "";
    const cat = trainCategory(num);
    return {
      id: `train-${i}-${num}`,
      type: "train" as const,
      number: num,
      from: t.departStationName || t.depStationName || "",
      to: t.destStationName || t.arrStationName || "",
      depart: dep.split(" ").pop() || dep,
      arrive: arr.split(" ").pop() || arr,
      duration: t.duration || "",
      price: pickPrice(t.price, t.seatAvailable),
      carrier: cat,
      category: cat,
      seats: summarizeSeats(t.seatAvailable),
      raw: t,
    };
  });
}

// 余票摘要：把 seatAvailable 里数量>0 的席别拼出来
function summarizeSeats(seatAvailable: any): string {
  if (!seatAvailable || typeof seatAvailable !== "object") return "";
  const names: Record<string, string> = {
    rwNum: "软卧", ywNum: "硬卧", yzNum: "硬座", wzNum: "无座",
    swzNum: "商务座", tdzNum: "特等座", edzNum: "二等座", ydzNum: "一等座",
    dwNum: "动卧", ydwNum: "软动卧", edwNum: "硬动卧",
  };
  const parts: string[] = [];
  for (const k in names) {
    const n = seatAvailable[k];
    if (typeof n === "number" && n > 0) parts.push(`${names[k]}${n}`);
  }
  return parts.join(" / ") || "暂无余票";
}

// 归一化机票数据
function normalizeFlights(data: any[]): TicketResult[] {
  return data.map((f: any, i: number) => {
    const dep = (f.departureTime || "").replace("T", " ").slice(0, 16);
    const arr = (f.arrivalTime || "").replace("T", " ").slice(0, 16);
    const base = Number(f.basePrice ?? 0);
    const tax = Number(f.totalTax ?? 0);
    return {
      id: `flight-${i}-${f.flightNumber}`,
      type: "flight" as const,
      number: f.flightNumber || f.flightNo || "",
      from: f.departureAirport || f.depCityName || "",
      to: f.arrivalAirport || f.arrCityName || "",
      depart: dep.split(" ").pop() || dep,
      arrive: arr.split(" ").pop() || arr,
      duration: f.totalDuration || f.flyTime || "",
      price: base + tax,
      carrier: f.airlineCompany || f.carrier || "",
      seats: f.remainingSeats != null ? `余票 ${f.remainingSeats}` : "",
      raw: f,
    };
  });
}

// 从 tuniu 响应里解包出业务对象（可能含 content[0].text 二次 JSON）
function extractResult(raw: string): any {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "途牛返回非 JSON：" + raw.slice(0, 200) };
  }
  if (parsed?.success === false) {
    return { error: parsed?.error?.message || parsed?.error?.type || "途牛服务调用失败" };
  }
  let inner = parsed?.result;
  if (inner?.content && Array.isArray(inner.content)) {
    const text = inner.content.find((c: any) => c?.type === "text")?.text;
    if (text) {
      try {
        inner = JSON.parse(text);
      } catch {
        inner = { raw: text };
      }
    }
  }
  return inner;
}

// 从途牛原始返回里提取 queryId（火车翻页用）
function extractQueryId(raw: string): string | null {
  try {
    const inner = extractResult(raw);
    return inner?.queryId ? String(inner.queryId) : null;
  } catch {
    return null;
  }
}

// 归一化酒店搜索结果（tuniu hotel tuniuHotelSearch）
function normalizeHotels(result: any): any[] {
  const hotels = result?.hotels || result?.data?.hotels || [];
  if (!Array.isArray(hotels)) return [];
  return hotels.map((h: any, i: number) => ({
    id: `hotel-${h.hotelId ?? i}`,
    hotelId: h.hotelId,
    name: h.hotelName || "",
    address: h.address || "",
    city: h.cityName || "",
    business: h.business || "",
    starName: h.starName || "",
    brandName: h.brandName || "",
    pic: h.firstPic || "",
    score: h.commentScore ?? null,
    commentDigest: h.commentDigest || "",
    price: h.lowestPrice ?? null,
    meal: h.meal || "",
    refund: h.refund || "",
    roomName: h.roomName || "",
    roomArea: h.roomArea || "",
    raw: h,
  }));
}

// 归一化酒店详情（tuniu hotel tuniuHotelDetail）
function normalizeHotelDetail(result: any): any {
  const rooms = Array.isArray(result?.roomTypes) ? result.roomTypes : [];
  const reviews = result?.reviews || {};
  return {
    hotelId: result?.hotelId,
    name: result?.hotelName || "",
    nameEn: result?.hotelNameEn || "",
    starName: result?.starName || "",
    pic: result?.firstPic || "",
    city: result?.cityName || "",
    business: result?.business || "",
    score: result?.commentScore ?? reviews?.score ?? null,
    reviewCount: reviews?.count ?? null,
    policies: Array.isArray(result?.policies) ? result.policies : [],
    rooms: rooms.map((r: any) => ({
      roomTypeId: r?.roomTypeId,
      // 途牛真实字段：roomTypeName / roomSize / images[]
      roomName: r?.roomTypeName || r?.roomName || "",
      bedType: r?.bedType || "",
      area: r?.roomSize ?? r?.roomArea ?? r?.area ?? "",
      floor: r?.floor || "",
      window: r?.roomWindow || r?.window || "",
      maxOccupancy: r?.maxOccupancy ?? null,
      pic: Array.isArray(r?.images) ? r.images[0] || "" : r?.firstPic || r?.pic || "",
      ratePlans: Array.isArray(r?.ratePlans)
        ? r.ratePlans.map((rp: any) => ({
            ratePlanName: rp?.ratePlanName || "",
            // rmbPrices 是字符串（如 "554.0"），转成数字，避免显示 ¥554.0
            price: toNumber(rp?.rmbPrices ?? rp?.price),
            mealText: rp?.mealText || "",
            // cancelText 是短文案（适合标签展示）；cancelDesc 是长段落（适合展开/提示）
            cancelText: rp?.cancelText || "",
            cancelDesc: rp?.cancelDesc || rp?.cancelDes || "",
            preBookParam: rp?.preBookParam || "",
            vendorRatePlanId: rp?.vendorRatePlanId || "",
            count: rp?.count ?? null,
          }))
        : [],
    })),
    raw: result,
  };
}

// 归一化火车余票详情（queryTrainDetail → seatInfo[] 各席别）
// 注意：内层返回是 { successCode, data: { trainInfo, seatInfo } }，多一层 data 包裹
function normalizeTrainDetail(result: any): any {
  const r = result?.data ?? result ?? {};
  const info = r?.trainInfo || {};
  const seats = Array.isArray(r?.seatInfo) ? r.seatInfo : [];
  return {
    trainNum: info.trainNum || "",
    trainTypeName: info.trainTypeName || "",
    departStationName: info.departStationName || "",
    destStationName: info.destStationName || "",
    departTime: info.departTime || "",
    arriveTime: info.arriveTime || "",
    duration: info.duration || "",
    departsDate: info.departsDate || "",
    seats: seats.map((s: any) => ({
      seatName: s.seatName || "",
      price: toNumber(s.price ?? s.adultPrice),
      leftNumber: s.leftNumber ?? null,
      // seatStatus 有值是「有/无」，没值时按余票数推断
      seatStatus: s.seatStatus || (Number(s.leftNumber) > 0 ? "有" : "无"),
      resId: s.resId ?? null,
    })),
  };
}

// 归一化机票舱位详情（multiCabinDetails → cabinInfo[] 各舱位）
// 同样兼容 { data: { cabinInfo } } 的包裹形式
function normalizeFlightDetail(result: any): any {
  const r = result?.data ?? result ?? {};
  const cabins = Array.isArray(r?.cabinInfo) ? r.cabinInfo : [];
  return {
    flightNo: result?.flightNo || "",
    cabins: cabins.map((c: any) => {
      const base = toNumber(c.basePrice) ?? 0;
      const tax = toNumber(c.totalTax) ?? 0;
      return {
        cabinClass: c.cabinClass || "",
        cabinClassCodes: c.cabinClassCodes || "",
        basePrice: base,
        totalTax: tax,
        totalPrice: base + tax,
        remainingSeats: c.remainingSeats ?? null,
        baggageInfo: c.baggageInfo || "",
        mealCode: c.mealCode || "",
        refundChangeRule: c.refundChangeRule || "",
        // 途牛有时返回字符串 "null"，清理掉
        buyCondition: c.buyCondition && c.buyCondition !== "null" ? c.buyCondition : "",
        cabinPriceId: c.cabinPriceId || "",
      };
    }),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "train";

  if (!TUNIU_API_KEY) {
    return NextResponse.json(
      { success: false, error: "服务端未配置 TUNIU_API_KEY" },
      { status: 500 },
    );
  }

  try {
    // ---------- 酒店搜索 ----------
    if (type === "hotel") {
      const city = (url.searchParams.get("city") || "").trim();
      const checkIn = (url.searchParams.get("checkIn") || "").trim();
      const checkOut = (url.searchParams.get("checkOut") || "").trim();
      const keyword = (url.searchParams.get("keyword") || "").trim();
      if (!city || !checkIn || !checkOut) {
        return NextResponse.json(
          { success: false, error: "缺少参数：需要 city、checkIn、checkOut" },
          { status: 400 },
        );
      }
      const args: any = { cityName: city, checkIn, checkOut };
      if (keyword) args.hotelName = keyword;
      const raw = await runTuniu("hotel", "tuniuHotelSearch", args);
      const result = extractResult(raw);
      if (result?.error) {
        return NextResponse.json({ success: false, error: String(result.error) }, { status: 502 });
      }
      return NextResponse.json({
        success: true,
        type: "hotel",
        data: normalizeHotels(result),
        queryId: result?.queryId || null,
      });
    }

    // ---------- 酒店详情 ----------
    if (type === "hotel-detail") {
      const hotelId = (url.searchParams.get("hotelId") || "").trim();
      const checkIn = (url.searchParams.get("checkIn") || "").trim();
      const checkOut = (url.searchParams.get("checkOut") || "").trim();
      if (!hotelId || !checkIn || !checkOut) {
        return NextResponse.json(
          { success: false, error: "缺少参数：需要 hotelId、checkIn、checkOut" },
          { status: 400 },
        );
      }
      const raw = await runTuniu("hotel", "tuniuHotelDetail", {
        hotelId: Number(hotelId),
        checkIn,
        checkOut,
      });
      const result = extractResult(raw);
      if (result?.error) {
        return NextResponse.json({ success: false, error: String(result.error) }, { status: 502 });
      }
      return NextResponse.json({
        success: true,
        type: "hotel-detail",
        data: normalizeHotelDetail(result),
      });
    }

    // ---------- 火车票余票详情（席别 + 价格 + 余票）----------
    if (type === "train-detail") {
      const depStation = (url.searchParams.get("depStation") || "").trim();
      const arrStation = (url.searchParams.get("arrStation") || "").trim();
      const date = (url.searchParams.get("date") || "").trim();
      const trainNum = (url.searchParams.get("trainNum") || "").trim();
      if (!depStation || !arrStation || !date || !trainNum) {
        return NextResponse.json(
          { success: false, error: "缺少参数：需要 depStation、arrStation、date、trainNum" },
          { status: 400 },
        );
      }
      const raw = await runTuniu("train", "queryTrainDetail", {
        departureStationName: depStation,
        arrivalStationName: arrStation,
        departureDate: date,
        trainNum,
      });
      const result = extractResult(raw);
      if (result?.error) {
        return NextResponse.json({ success: false, error: String(result.error) }, { status: 502 });
      }
      return NextResponse.json({
        success: true,
        type: "train-detail",
        data: normalizeTrainDetail(result),
      });
    }

    // ---------- 机票舱位详情（舱位 + 价格 + 余票 + 行李额/退改）----------
    if (type === "flight-detail") {
      const from = (url.searchParams.get("from") || "").trim();
      const to = (url.searchParams.get("to") || "").trim();
      const date = (url.searchParams.get("date") || "").trim();
      const flightNo = (url.searchParams.get("flightNo") || "").trim();
      if (!from || !to || !date || !flightNo) {
        return NextResponse.json(
          { success: false, error: "缺少参数：需要 from、to、date、flightNo" },
          { status: 400 },
        );
      }
      const raw = await runTuniu("flight", "multiCabinDetails", {
        departureCityName: from,
        arrivalCityName: to,
        departureDate: date,
        flightNo,
      });
      const result = extractResult(raw);
      if (result?.error) {
        return NextResponse.json({ success: false, error: String(result.error) }, { status: 502 });
      }
      return NextResponse.json({
        success: true,
        type: "flight-detail",
        data: { ...normalizeFlightDetail(result), flightNo },
      });
    }

    // ---------- 机票 / 火车票搜索（支持分页）----------
    const from = (url.searchParams.get("from") || "").trim();
    const to = (url.searchParams.get("to") || "").trim();
    const date = (url.searchParams.get("date") || "").trim();
    const pageNum = Math.max(1, Number(url.searchParams.get("pageNum") || "1") || 1);
    // 火车续页 token：首次查询返回 queryId，翻页带上它 + pageNum 即可
    const queryId = (url.searchParams.get("queryId") || "").trim();
    // 火车排序：1 时间升序（默认，混合车型）2 时间降序 3 耗时升序 5 票价升序 6 票价降序
    const searchType = (url.searchParams.get("searchType") || "1").trim();

    const isTrainContinue = type === "train" && !!queryId;
    if (!isTrainContinue && (!from || !to || !date)) {
      return NextResponse.json(
        { success: false, error: "缺少参数：需要 from、to、date" },
        { status: 400 },
      );
    }

    if (type === "flight") {
      const args: any = {
        departureCityName: from,
        arrivalCityName: to,
        departureDate: date,
      };
      if (pageNum > 1) args.pageNum = pageNum;
      const raw = await runTuniu("flight", "searchLowestPriceFlight", args);
      const { data, error } = extractData(raw);
      if (error) {
        return NextResponse.json({ success: false, error }, { status: 502 });
      }
      const normalized = normalizeFlights(data).sort((a, b) =>
        a.depart.localeCompare(b.depart),
      );
      return NextResponse.json({
        success: true,
        type: "flight",
        data: normalized,
        pageNum,
        hasMore: normalized.length >= 20,
      });
    }

    // ---------- 火车票搜索（分页 + 默认按出发时间，能混合高铁/动车/普速）----------
    const trainArgs: any = isTrainContinue
      ? { queryId, pageNum }
      : {
          departureCityName: from,
          arrivalCityName: to,
          departureDate: date,
          searchType,
        };
    const raw = await runTuniu("train", "searchLowestPriceTrain", trainArgs);
    const { data, error } = extractData(raw);
    if (error) {
      return NextResponse.json({ success: false, error }, { status: 502 });
    }
    const normalized = normalizeTrains(data);
    if (!isTrainContinue) {
      normalized.sort((a, b) => a.depart.localeCompare(b.depart));
    }
    return NextResponse.json({
      success: true,
      type: "train",
      data: normalized,
      pageNum,
      queryId: isTrainContinue ? queryId : extractQueryId(raw),
      hasMore: normalized.length >= 20,
    });
  } catch (err: any) {
    console.error("[tuniu] call failed:", err);
    const msg = err?.message || (err?.stderr ? String(err.stderr).slice(0, 500) : "途牛服务调用失败");
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

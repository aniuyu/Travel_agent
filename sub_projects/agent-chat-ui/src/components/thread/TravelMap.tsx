"use client";

/**
 * 全国行程路线图（信息面板风格的紧凑小地图）
 *
 * 视觉规格（视频同款）：
 *  - 整面深蓝色/黑色边框的信息面板
 *  - 左上角标题栏：「🛫 全国行程路线图」白色字体
 *  - 起点：绿色胶囊（圆角矩形）+ ✈️ 飞机图标 + 城市名
 *  - 终点：红色胶囊 + ✈️ 飞机图标 + 城市名
 *  - 中间途经城市：白底红边小圆点
 *  - 连线：蓝色虚线 + 箭头指示方向
 *  - 不显示默认缩放控件（保持画面纯净）
 *
 * 数据来源：上游传入 TravelMapData（route.from → route.to + itinerary 中间途经）
 */

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: {
      securityJsCode?: string;
    };
  }
}

interface MapPoint {
  name: string;
  lng: number;
  lat: number;
  icon?: string;
}

interface MapRoute {
  from: MapPoint;
  to: MapPoint;
  mode?: "driving" | "transit" | "walking" | "riding";
}

interface ItineraryPoint extends MapPoint {
  day: number;
}

export interface TravelMapData {
  type: "map";
  points?: MapPoint[];
  route?: MapRoute;
  itinerary?: ItineraryPoint[];
  title?: string;
}

const AMAP_KEY = process.env.NEXT_PUBLIC_AMAP_KEY ?? "";
const AMAP_SECURITY_CODE = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE ?? "";

// 高德地图 JS API 加载器（模块级单例，避免重复注入）
let _loadPromise: Promise<void> | null = null;
let _loadError: string | null = null;

function loadAMapSDK(): Promise<void> {
  if (typeof window !== "undefined" && window.AMap) {
    return Promise.resolve();
  }
  if (_loadError) {
    return Promise.reject(new Error(_loadError));
  }
  if (_loadPromise) {
    return _loadPromise;
  }

  if (!AMAP_KEY) {
    _loadError = "未配置 NEXT_PUBLIC_AMAP_KEY，请在 .env 中填写高德 Key";
    return Promise.reject(new Error(_loadError));
  }

  _loadPromise = new Promise<void>((resolve, reject) => {
    if (AMAP_SECURITY_CODE) {
      window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
    }
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}`;
    script.async = true;
    script.onload = () => {
      // 脚本 onload 后等微任务，确保 AMap 全局对象就绪
      setTimeout(() => {
        if (window.AMap) resolve();
        else {
          _loadError = "高德地图 SDK 加载异常（AMap 未就绪）";
          reject(new Error(_loadError));
        }
      }, 0);
    };
    script.onerror = () => {
      _loadError = "高德地图 SDK 加载失败，请检查网络或 Key 是否正确";
      reject(new Error(_loadError));
    };
    document.head.appendChild(script);
  });

  return _loadPromise;
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------
export function TravelMap({ data }: { data: TravelMapData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    loadAMapSDK()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        try {
          initMap();
        } catch (e: any) {
          console.error("[TravelMap] 初始化失败", e);
          setError(e?.message || "地图初始化失败");
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "地图加载失败");
      });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        try {
          mapRef.current.destroy();
          mapRef.current = null;
        } catch {
          // ignore
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // data 变化时重新渲染（marker / 连线）
  useEffect(() => {
    if (mapRef.current) {
      try {
        renderData(mapRef.current, data);
      } catch (e: any) {
        console.error("[TravelMap] 渲染地图数据失败", e);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ---------------- 初始化地图 ----------------
  function initMap() {
    if (!containerRef.current || !window.AMap) return;
    const AMap = window.AMap;

    // 中心点（优先 route.to / itinerary 第一项 / points 第一项）
    const centerPoint =
      data.route?.to ??
      data.itinerary?.[0] ??
      data.points?.[0] ??
      ({ lng: 116.397, lat: 39.909 } as MapPoint);
    let centerLng = Number(centerPoint.lng);
    let centerLat = Number(centerPoint.lat);
    if (!Number.isFinite(centerLng) || !Number.isFinite(centerLat)) {
      centerLng = 116.397;
      centerLat = 39.909;
    }

    // 创建地图（不使用路况图层，保持底图地名清晰可见）
    const map = new AMap.Map(containerRef.current, {
      zoom: 7,
      center: [centerLng, centerLat],
      viewMode: "2D",
      // 隐藏所有默认控件：缩放、工具条、比例尺、罗盘
      zoomEnable: false, // 禁止鼠标滚轮缩放
      dragEnable: true, // 保留拖动
      doubleClickZoom: false, // 禁止双击缩放
      scrollWheel: false,
      keyboardEnable: false,
      features: ["bg", "point", "road"], // 保留底图、地名点、道路
    });
    mapRef.current = map;
    renderData(map, data);
  }

  // ---------------- 渲染数据 ----------------
  function renderData(map: any, d: TravelMapData) {
    const AMap = window.AMap;
    try {
      map.clearMap();
    } catch {
      // ignore
    }

    // 收集所有路径点（用于缩放视野）
    const pathCoords: [number, number][] = [];

    // ----- 1) 起点 / 终点 圆形 marker（绿/红小圆点）-----
    if (d.route && isValidCoord(d.route.from)) {
      const p = d.route.from;
      pathCoords.push([p.lng, p.lat]);
      try {
        new AMap.Marker({
          position: [p.lng, p.lat],
          title: p.name,
          offset: new AMap.Pixel(-14, -14),
          content: cityCapsule(p.name, "start"),
        }).setMap(map);
      } catch (e) {
        console.warn("[TravelMap] 起点 marker 失败", e);
      }
    }
    if (d.route && isValidCoord(d.route.to)) {
      const p = d.route.to;
      pathCoords.push([p.lng, p.lat]);
      try {
        new AMap.Marker({
          position: [p.lng, p.lat],
          title: p.name,
          offset: new AMap.Pixel(-14, -14),
          content: cityCapsule(p.name, "end"),
        }).setMap(map);
      } catch (e) {
        console.warn("[TravelMap] 终点 marker 失败", e);
      }
    }

    // ----- 2) 中间途经城市：小红白圆点 -----
    if (d.itinerary && d.itinerary.length > 0) {
      d.itinerary.forEach((p) => {
        if (!isValidCoord(p)) return;
        pathCoords.push([p.lng, p.lat]);
        try {
          new AMap.Marker({
            position: [p.lng, p.lat],
            title: `${p.name}（第 ${p.day} 天）`,
            offset: new AMap.Pixel(-4, -4),
            content: midwayDot(),
          }).setMap(map);
        } catch (e) {
          console.warn("[TravelMap] 中途 marker 失败", e);
        }
      });
    }

    // ----- 3) 绿色实线 + 箭头（从起点 → 途经 → 终点；视频同款）-----
    const ordered = buildOrderedPath(d);
    if (ordered.length >= 2) {
      try {
        // 绿色实线主体（视频同款：驾车路线 + 绿色）
        new AMap.Polyline({
          path: ordered,
          strokeColor: "#22c55e",
          strokeWeight: 5,
          strokeStyle: "solid",
          strokeOpacity: 0.9,
          lineJoin: "round",
          lineCap: "round",
        }).setMap(map);

        // 在每段中间画一个箭头（三角形 SVG）
        for (let i = 0; i < ordered.length - 1; i++) {
          drawArrow(map, AMap, ordered[i], ordered[i + 1]);
        }
      } catch (e) {
        console.warn("[TravelMap] 连线失败", e);
      }
    }

    // ----- 4) 自动缩放到合适视野（多留 padding）-----
    try {
      if (pathCoords.length >= 2) {
        map.setFitView(null, false, [60, 60, 60, 60]);
      } else if (pathCoords.length === 1) {
        map.setZoomAndCenter(8, pathCoords[0]);
      }
    } catch {
      // 兼容老 SDK
      try {
        if (pathCoords.length >= 2) {
          const lngs = pathCoords.map((c) => c[0]);
          const lats = pathCoords.map((c) => c[1]);
          const amapBounds = new AMap.Bounds(
            new AMap.LngLat(Math.min(...lngs), Math.min(...lats)),
            new AMap.LngLat(Math.max(...lngs), Math.max(...lats)),
          );
          map.setBounds(amapBounds, false, [60, 60, 60, 60]);
        }
      } catch {
        // ignore
      }
    }
  }

  // ----- 错误占位 -----
  if (error) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
        ⚠️ 地图加载失败：{error}
        <p className="mt-2 text-xs text-amber-600">
          请确认 .env 已配置 NEXT_PUBLIC_AMAP_KEY，并开通「Web 端 JS API」权限。
        </p>
      </div>
    );
  }

  return (
    <div className="my-3 w-full">
      {/* 全国行程路线图 面板（深色边框 + 左上角标题栏） */}
      <div className="relative overflow-hidden rounded-xl border-2 border-slate-700 bg-[#0f1729] shadow-lg">
        {/* 左上角标题栏 */}
        <div className="pointer-events-none absolute left-0 top-0 z-10 flex items-center gap-2 rounded-br-lg bg-slate-900/85 px-3 py-1.5 backdrop-blur-sm">
          <span className="text-xs">📍</span>
          <span className="text-xs font-semibold tracking-wide text-white">
            全国行程路线图
          </span>
        </div>

        {/* 高德地图容器 */}
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: "440px", minHeight: "440px" }}
        />
      </div>

      {/* 跳转高德 App 导航（保留原功能） */}
      {data.route && isValidCoord(data.route.to) && (
        <a
          href={`https://uri.amap.com/navigation?to=${data.route.to.lng},${data.route.to.lat},${encodeURIComponent(
            data.route.to.name || "目的地",
          )}&mode=0&coordinate=gaode&src=fytt`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-indigo-600 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-600 hover:text-white"
        >
          🚗 在高德地图中导航（实时导航）
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 判断坐标是否有效数字 */
function isValidCoord(p?: { lng?: number; lat?: number }): boolean {
  if (!p) return false;
  const lng = Number(p.lng);
  const lat = Number(p.lat);
  return Number.isFinite(lng) && Number.isFinite(lat);
}

/**
 * 起点 / 终点胶囊 marker HTML
 * - start：绿色 + ✈️ 图标
 * - end：红色 + ✈️ 图标
 * 字体小、不遮挡县城名
 */
function cityCapsule(name: string, kind: "start" | "end"): string {
  const isStart = kind === "start";
  const bg = isStart ? "#22c55e" : "#ef4444";
  const ring = isStart ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)";
  return `
    <div style="
      display:inline-flex;align-items:center;gap:6px;
      padding:6px 14px 6px 8px;
      background:${bg};
      color:#fff;
      border-radius:999px;
      font-size:12px;
      font-weight:600;
      line-height:1;
      white-space:nowrap;
      box-shadow:0 4px 12px ${ring}, 0 0 0 2px rgba(255,255,255,0.15);
      pointer-events:auto;
    ">
      <span style="
        display:inline-flex;align-items:center;justify-content:center;
        width:20px;height:20px;border-radius:50%;
        background:rgba(255,255,255,0.2);
        font-size:11px;
      ">✈️</span>
      <span style="letter-spacing:0.5px;">${escapeHtml(name)}</span>
    </div>
  `;
}

/**
 * 中途途经城市：小红白点
 */
function midwayDot(): string {
  return `
    <div style="
      width:10px;height:10px;border-radius:50%;
      background:#fff;
      border:2px solid #ef4444;
      box-shadow:0 0 0 2px rgba(255,255,255,0.4);
    "></div>
  `;
}

/** 在 from→to 这段线的中点位置画一个箭头（SVG 旋转到方向） */
function drawArrow(map: any, AMap: any, from: [number, number], to: [number, number]) {
  try {
    const [fx, fy] = from;
    const [tx, ty] = to;
    // 跳过零距离
    if (fx === tx && fy === ty) return;
    // 中点
    const midLng = (fx + tx) / 2;
    const midLat = (fy + ty) / 2;
    // 角度（高德是经度-纬度，注意 atan2 的 dy 是纬度方向，所以负号）
    const angle = (Math.atan2(ty - fy, tx - fx) * 180) / Math.PI;
    // 箭头 SVG（三角形，旋转到方向）
    const svg = `
      <div style="width:0;height:0;transform:rotate(${
        angle - 90
      }deg);">
        <svg width="20" height="20" viewBox="0 0 20 20" style="overflow:visible;display:block;">
          <polygon points="0,0 14,8 0,16 4,8" fill="#ffffff" stroke="#22c55e" stroke-width="1.5" stroke-linejoin="round"/>
        </svg>
      </div>
    `;
    new AMap.Marker({
      position: [midLng, midLat],
      offset: new AMap.Pixel(-10, -10),
      content: svg,
    }).setMap(map);
  } catch {
    // ignore
  }
}

/**
 * 按"起点 → 途经（按 day 排序）→ 终点"构造有序路径
 */
function buildOrderedPath(d: TravelMapData): [number, number][] {
  const out: [number, number][] = [];
  const pushIf = (p?: { lng?: number; lat?: number }) => {
    if (isValidCoord(p)) out.push([Number(p!.lng), Number(p!.lat)]);
  };
  if (d.route) {
    pushIf(d.route.from);
    if (d.itinerary && d.itinerary.length > 0) {
      const sorted = [...d.itinerary].sort((a, b) => a.day - b.day);
      sorted.forEach(pushIf);
    }
    pushIf(d.route.to);
  } else if (d.itinerary && d.itinerary.length > 0) {
    const sorted = [...d.itinerary].sort((a, b) => a.day - b.day);
    sorted.forEach(pushIf);
  }
  return out;
}

/** HTML 转义，避免 XSS / 渲染异常 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === '"'
            ? "&quot;"
            : "&#39;",
  );
}
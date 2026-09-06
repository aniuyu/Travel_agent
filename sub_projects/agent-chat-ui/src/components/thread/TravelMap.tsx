"use client";

/**
 * 高德地图组件（健壮版）
 *
 * 依赖：高德 JS API 2.0（通过 CDN <script> 动态加载，带加载去重）
 * 能力：① 多点打点 ② 两点路线规划 ③ 多日行程串联
 *
 * 健壮性设计：
 *   1. SDK 加载去重 + 单例 Promise，避免多组件重复注入 <script> 或竞态
 *   2. 所有 AMap 对象创建（Map/Marker/Driving/Bounds/Traffic）都包 try/catch，
 *      任何一步失败都不会让 React 组件崩溃，而是降级为"能画多少画多少"
 *   3. 由 ErrorBoundary 包裹，极端异常也不会导致整个应用白屏
 */

import { useEffect, useRef, useState } from "react";

// 高德全局对象类型声明（未加载前为 undefined）
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
  icon?: string; // 图标类型，如 hotel / scenic / station / food
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

// 图标配色（按类型区分）
const ICON_COLORS: Record<string, string> = {
  hotel: "#7c3aed", // 紫：酒店
  scenic: "#059669", // 绿：景点
  station: "#2563eb", // 蓝：车站
  food: "#f59e0b", // 橙：美食
  default: "#ef4444", // 红：默认
};

// ---------------------------------------------------------------------------
// SDK 加载器（模块级单例，保证只加载一次，且多个组件共享同一个加载 Promise）
// ---------------------------------------------------------------------------
let _loadPromise: Promise<void> | null = null;
let _loadError: string | null = null;

function loadAMapSDK(): Promise<void> {
  // 已加载成功
  if (typeof window !== "undefined" && window.AMap) {
    return Promise.resolve();
  }
  // 上次加载失败，直接返回失败（可重试由用户刷新页面触发）
  if (_loadError) {
    return Promise.reject(new Error(_loadError));
  }
  // 正在加载中，复用同一个 Promise
  if (_loadPromise) {
    return _loadPromise;
  }

  if (!AMAP_KEY) {
    _loadError = "未配置 NEXT_PUBLIC_AMAP_KEY，请在 .env 中填写高德 Key";
    return Promise.reject(new Error(_loadError));
  }

  _loadPromise = new Promise<void>((resolve, reject) => {
    // 配置安全密钥（推荐）
    if (AMAP_SECURITY_CODE) {
      window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
    }

    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}`;
    script.async = true;
    script.onload = () => {
      // 脚本 onload 后，AMap 全局对象应已就绪；再等一个微任务确保挂载完成
      setTimeout(() => {
        if (window.AMap) {
          resolve();
        } else {
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
          console.error("[TravelMap] 初始化地图失败", e);
          setError(e?.message || "地图初始化失败");
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(e?.message || "地图加载失败");
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当 data 变化时（同一会话里 AI 连续返回多张地图），复用地图实例重新渲染
  useEffect(() => {
    if (mapRef.current && containerRef.current) {
      try {
        renderData(mapRef.current, data);
      } catch (e: any) {
        console.error("[TravelMap] 渲染地图数据失败", e);
        setError(e?.message || "地图渲染失败");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function initMap() {
    if (!containerRef.current || !window.AMap) return;

    const AMap = window.AMap;

    // 确定地图中心点（优先取第一个点；坐标非法时回退到北京天安门）
    const firstPoint =
      data.points?.[0] ??
      data.itinerary?.[0] ??
      data.route?.from ??
      ({ lng: 116.397, lat: 39.909 } as MapPoint);
    let centerLng = Number(firstPoint.lng);
    let centerLat = Number(firstPoint.lat);
    if (!Number.isFinite(centerLng) || !Number.isFinite(centerLat)) {
      centerLng = 116.397;
      centerLat = 39.909;
    }

    // 实时路况图层：单独 try，避免 TileLayer.Traffic 不可用导致地图整个失败
    let layers: any[] | undefined;
    try {
      if (AMap.TileLayer && AMap.TileLayer.Traffic) {
        layers = [new AMap.TileLayer.Traffic({ autoRefresh: true, interval: 180 })];
      }
    } catch (e) {
      console.warn("[TravelMap] 实时路况图层加载失败，已忽略", e);
    }

    const map = new AMap.Map(containerRef.current, {
      zoom: 11,
      center: [centerLng, centerLat],
      viewMode: "2D",
      ...(layers ? { layers } : {}),
    });
    mapRef.current = map;
    renderData(map, data);
  }

  // 渲染逻辑：打点 + 连线 + 路线（每一步独立 try，能画多少画多少）
  function renderData(map: any, d: TravelMapData) {
    const AMap = window.AMap;

    // 安全清空
    try {
      map.clearMap();
    } catch {
      // 忽略
    }

    const bounds: [number, number][] = [];

    // --- 3.1 打点 ---
    const allPoints: MapPoint[] = [
      ...(d.points ?? []),
      ...(d.itinerary?.map(({ day, ...rest }) => rest) ?? []),
    ];
    if (d.route) {
      allPoints.push(d.route.from, d.route.to);
    }

    allPoints.forEach((p) => {
      if (typeof p.lng !== "number" || typeof p.lat !== "number") return;
      if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) return;
      bounds.push([p.lng, p.lat]);
      try {
        const color = ICON_COLORS[p.icon ?? "default"] ?? ICON_COLORS.default;
        const label = p.name ? p.name.slice(0, 1) : "●";
        const marker = new AMap.Marker({
          position: [p.lng, p.lat],
          title: p.name,
          content: `<div style="background:${color};color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.3);">${label}</div>`,
          offset: new AMap.Pixel(-12, -12),
        });
        marker.setMap(map);
      } catch (e) {
        console.warn("[TravelMap] 打点失败", p, e);
      }
    });

    // --- 3.2 多日行程串联 ---
    if (d.itinerary && d.itinerary.length > 1) {
      try {
        const line = new AMap.Polyline({
          path: d.itinerary.map((p) => [p.lng, p.lat]),
          strokeColor: "#7c3aed",
          strokeWeight: 4,
          strokeStyle: "dashed",
          strokeOpacity: 0.8,
        });
        line.setMap(map);
      } catch (e) {
        console.warn("[TravelMap] 行程连线失败", e);
      }
    }

    // --- 3.3 两点路线规划 ---
    if (d.route) {
      const mode = d.route.mode ?? "driving";
      const serviceMap: Record<string, string> = {
        driving: "Driving",
        transit: "Transfer",
        walking: "Walking",
        riding: "Riding",
      };
      // 坐标必须是有效数字，否则跳过路线规划（避免 AMap 内部抛异常）
      const fl = Number(d.route.from?.lng);
      const fa = Number(d.route.from?.lat);
      const tl = Number(d.route.to?.lng);
      const ta = Number(d.route.to?.lat);
      const coordsValid =
        [fl, fa, tl, ta].every((v) => Number.isFinite(v));
      try {
        if (coordsValid) {
          const ServiceClass = AMap[serviceMap[mode] ?? "Driving"];
          if (ServiceClass) {
            const service = new ServiceClass({ map, panel: null, hideMarkers: false });
            service.search(
              new AMap.LngLat(fl, fa),
              new AMap.LngLat(tl, ta),
              (status: string, result: any) => {
                if (status !== "complete") {
                  console.warn("[TravelMap] 路线规划失败", status, result);
                }
              },
            );
          }
        }
      } catch (e) {
        console.warn("[TravelMap] 路线规划异常（可能缺少路线规划权限）", e);
      }
    }

    // --- 3.4 自动缩放视野 ---
    try {
      if (bounds.length > 1) {
        const lngs = bounds.map((b) => b[0]);
        const lats = bounds.map((b) => b[1]);
        const southWest = new AMap.LngLat(Math.min(...lngs), Math.min(...lats));
        const northEast = new AMap.LngLat(Math.max(...lngs), Math.max(...lats));
        const amapBounds = new AMap.Bounds(southWest, northEast);
        if (typeof map.setBounds === "function") {
          map.setBounds(amapBounds, false, [60, 60, 60, 60]);
        } else {
          map.setZoomAndCenter(7, [
            (Math.min(...lngs) + Math.max(...lngs)) / 2,
            (Math.min(...lats) + Math.max(...lats)) / 2,
          ]);
        }
      } else if (bounds.length === 1) {
        map.setZoomAndCenter(15, bounds[0]);
      }
    } catch (e) {
      console.warn("[TravelMap] 视野缩放失败", e);
    }
  }

  // 生成「在高德地图中导航」的跳转链接
  const navUrl = (() => {
    if (!data.route) return null;
    const { from, to } = data.route;
    if (
      typeof to.lng !== "number" ||
      typeof to.lat !== "number" ||
      !Number.isFinite(to.lng) ||
      !Number.isFinite(to.lat)
    ) {
      return null;
    }
    const mode =
      data.route.mode === "transit"
        ? "1"
        : data.route.mode === "walking"
          ? "4"
          : data.route.mode === "riding"
            ? "3"
            : "0";
    const endName = encodeURIComponent(to.name || "目的地");
    return `https://uri.amap.com/navigation?to=${to.lng},${to.lat},${endName}&mode=${mode}&coordinate=gaode`;
  })();

  if (error) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
        ⚠️ 地图加载失败：{error}
        <p className="mt-2 text-xs text-amber-600">
          请确认已配置 NEXT_PUBLIC_AMAP_KEY，且高德 Key 已开通「Web 端 JS API」权限。
          若已配置，请刷新页面重试。
        </p>
      </div>
    );
  }

  return (
    <div className="my-3 w-full">
      {data.title && (
        <div className="mb-2 text-sm font-semibold text-foreground">
          🗺️ {data.title}
        </div>
      )}
      <div
        ref={containerRef}
        className="h-72 w-full rounded-lg border border-border bg-muted"
        style={{ minHeight: "280px" }}
      />
      {navUrl && (
        <a
          href={navUrl}
          target="_blank"
          rel="noopener noreferrer"
          // 不依赖主题变量，用对比度稳定的"白底蓝紫边蓝紫字+主色背景"双态样式。
          // 浅色背景 + 深色字 → 在 light/dark 主题下都清晰可读。
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-indigo-600 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition-colors hover:bg-indigo-600 hover:text-white"
        >
          🚗 在高德地图中导航（实时导航）
        </a>
      )}
      <div className="mt-1 text-xs text-muted-foreground">
        {data.route && "地图已叠加实时路况（红=拥堵 黄=缓行 绿=畅通）"}
      </div>
    </div>
  );
}

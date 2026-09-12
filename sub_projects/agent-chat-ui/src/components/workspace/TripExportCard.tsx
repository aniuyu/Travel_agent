"use client";

/**
 * 行程导出卡片（用于「导出图片」）
 *
 * 为什么用内联样式：html-to-image 通过读取 getComputedStyle 把样式内联到
 * 克隆节点再画到 canvas。内联样式可以 100% 还原，不受 Tailwind 类是否被内联影响。
 *
 * 数据来源：/share/{id} 返回的 payload
 *   destination / days / pref / companion / depart_date / ai_summary / budget / transport
 *   itinerary_per_tier: { "经济档": [{day,title,spots:[{name,time,icon,address}]}], ... }
 *   plans:   [{tier,price,hotel{name,stars,price},dining,attractions[],ai_highlight,transport_mode}]
 *   hotels:  [{name,price,score,stars}]
 *   tickets: [{type,number,from,to,depart,arrive,price}]
 *   weather: {city, today:{desc,min_C,max_C}}
 */

interface Spot {
  name: string;
  time: string;
  icon: string;
  address: string;
}

export interface TripView {
  title: string;
  /** 出发地 → 目的地（有出发地时）；否则退回 title */
  routeName: string;
  fromCity: string;
  destination: string;
  daysStr: string;
  aiSummary: string;
  weather: string;
  tags: string[];
  days: { day: number | string; title: string; spots: Spot[] }[];
  plans: {
    tier: string;
    price: number | string | null;
    tag: string;
    hotelName: string;
    hotelStars: number;
    hotelPrice: number | string | null;
    dining: string;
    transportMode: string;
    attractions: string;
    highlight: string;
  }[];
  hotels: { name: string; price: number | string | null; score: number | string | null; stars: number; userSpecified?: boolean }[];
  tickets: {
    type: string;
    number: string;
    from: string;
    to: string;
    depart: string;
    arrive: string;
    price: number | string | null;
    userSpecified?: boolean;
  }[];
}

/** 把后端 payload 提取成用于展示/导出的纯数据结构 */
export function extractTripView(payload: any, fallbackTitle: string): TripView {
  const p = payload || {};
  const fromCity = p.from_city || "";
  const destination = p.destination || "";
  const daysStr = p.days || (p.n_days ? `${p.n_days}天` : "");
  const pref = p.pref || "";
  const companion = p.companion || "";
  const departDate = p.depart_date || "";
  const aiSummary = p.ai_summary || "";
  const budget = p.budget;
  const transport = p.transport || "";

  // 行程名称：优先「出发地 → 目的地」，信息更完整
  const routeName =
    fromCity && destination
      ? `${fromCity} → ${destination}`
      : destination || fromCity || fallbackTitle || "我的行程";

  // 每日行程：itinerary_per_tier 是以档位名为 key 的字典
  const tierMap = p.itinerary_per_tier || {};
  const tiers = Object.keys(tierMap);
  const plans = Array.isArray(p.plans) ? p.plans : [];
  const defaultTier = plans[0]?.tier || tiers[0] || "";
  const rawDays = tierMap[defaultTier] || tierMap[tiers[0]] || [];
  const days = (Array.isArray(rawDays) ? rawDays : []).map((d: any) => ({
    day: d?.day ?? "",
    title: d?.title || `第 ${d?.day ?? ""} 天`,
    spots: (Array.isArray(d?.spots) ? d.spots : [])
      .map((s: any) =>
        typeof s === "string"
          ? { name: s, time: "", icon: "📍", address: "" }
          : {
              name: s?.name || "",
              time: s?.time || "",
              icon: s?.icon || "📍",
              address: s?.address || "",
            },
      )
      .filter((s: Spot) => s.name),
  }));

  const planList = plans.map((pl: any) => ({
    tier: pl?.tier || "方案",
    price: pl?.price ?? null,
    tag: pl?.tag || "",
    hotelName: pl?.hotel?.name || "",
    hotelStars: pl?.hotel?.stars || 0,
    hotelPrice: pl?.hotel?.price ?? null,
    dining: pl?.dining || "",
    transportMode: pl?.transport_mode || "",
    attractions: (Array.isArray(pl?.attractions) ? pl.attractions : [])
      .map((a: any) => (typeof a === "string" ? a : a?.name || ""))
      .filter(Boolean)
      .join(" · "),
    highlight: pl?.ai_highlight || "",
  }));

  const hotels = (Array.isArray(p.hotels) ? p.hotels : []).map((h: any) => ({
    name: h?.name || "",
    price: h?.price ?? null,
    score: h?.score ?? null,
    stars: h?.stars || 0,
    userSpecified: !!h?.user_specified,
  }));

  const tickets = (Array.isArray(p.tickets) ? p.tickets : []).map((t: any) => ({
    type: t?.type || "train",
    number: t?.number || "",
    from: t?.from || "",
    to: t?.to || "",
    depart: t?.depart || "",
    arrive: t?.arrive || "",
    price: t?.price ?? null,
    userSpecified: !!t?.user_specified,
  }));

  const w = p.weather || {};
  const wt = w.today || w.now || {};
  const weather =
    wt && (wt.desc || wt.max_C)
      ? [w.city || destination, wt.desc, wt.max_C ? `${wt.min_C ?? ""}° ~ ${wt.max_C}°` : ""]
          .filter(Boolean)
          .join("   ")
      : "";

  const tags = [
    pref,
    companion,
    departDate ? `出发 ${departDate}` : "",
    daysStr,
    budget ? `预算 ¥${budget}` : "",
    transport ? `交通 ${transport}` : "",
  ].filter(Boolean) as string[];

  return {
    title: fallbackTitle,
    routeName,
    fromCity,
    destination,
    daysStr,
    aiSummary,
    weather,
    tags,
    days,
    plans: planList,
    hotels,
    tickets,
  };
}

// ---------------------------------------------------------------------------
// 卡片渲染（内联样式）
// ---------------------------------------------------------------------------
const C = {
  indigo: "#6366f1",
  text: "#1f2937",
  sub: "#6b7280",
  faint: "#9ca3af",
  line: "#eef0f6",
  emerald: "#059669",
  emeraldBg: "#ecfdf5",
  indigoBg: "#eef2ff",
  indigoDeep: "#4338ca",
  tealBg: "#f0fdfa",
};

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>{children}</div>
  );
}

export function TripExportCard({ payload, title }: { payload: any; title: string }) {
  const v = extractTripView(payload, title);

  return (
    <div
      style={{
        width: 640,
        background: "#ffffff",
        color: C.text,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      }}
    >
      {/* 头部 */}
      <div style={{ background: "linear-gradient(135deg,#6366f1,#a855f7)", color: "#fff", padding: "30px 32px" }}>
        <div style={{ fontSize: 13, opacity: 0.9, letterSpacing: 0.5 }}>AI 旅行规划 · 飞云通</div>
        <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8, lineHeight: 1.3 }}>{v.routeName}</div>
        {v.daysStr && <div style={{ fontSize: 14, opacity: 0.92, marginTop: 8 }}>{v.daysStr}</div>}
        {v.tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
            {v.tags.map((t, i) => (
              <span
                key={i}
                style={{
                  background: "rgba(255,255,255,0.22)",
                  color: "#fff",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: 12,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "24px 32px 8px" }}>
        {/* AI 总结 */}
        {v.aiSummary && (
          <div
            style={{
              background: C.indigoBg,
              border: `1px solid #e0e7ff`,
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 13,
              color: C.indigoDeep,
              lineHeight: 1.7,
              marginBottom: 20,
            }}
          >
            ✨ {v.aiSummary}
          </div>
        )}

        {/* 天气 */}
        {v.weather && (
          <div
            style={{
              background: C.tealBg,
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13,
              color: "#374151",
              marginBottom: 20,
            }}
          >
            🌤 {v.weather}
          </div>
        )}

        {/* 每日行程 */}
        {v.days.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <SectionTitle>🗓 每日行程</SectionTitle>
            {v.days.map((d, di) => (
              <div key={di} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: C.indigo,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {d.day}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "#374151" }}>{d.title}</span>
                </div>
                {d.spots.length > 0 ? (
                  d.spots.map((s, si) => (
                    <div key={si} style={{ display: "flex", gap: 10, margin: "6px 0 6px 4px" }}>
                      <span style={{ width: 22, flexShrink: 0, fontSize: 14, lineHeight: 1.4 }}>{s.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{s.name}</div>
                        {s.time && <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{s.time}</div>}
                        {s.address && <div style={{ fontSize: 12, color: C.faint, marginTop: 2 }}>{s.address}</div>}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: C.faint, marginLeft: 4 }}>暂无景点安排</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 方案对比 */}
        {v.plans.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <SectionTitle>💎 方案对比</SectionTitle>
            {v.plans.map((pl, pi) => (
              <div
                key={pi}
                style={{
                  border: `1px solid ${C.line}`,
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{pl.tier}</span>
                  <span style={{ fontWeight: 800, fontSize: 16, color: C.indigo }}>¥{pl.price ?? "—"}</span>
                </div>
                {pl.tag && (
                  <div
                    style={{
                      display: "inline-block",
                      background: "#f3e8ff",
                      color: "#7c3aed",
                      borderRadius: 6,
                      padding: "2px 8px",
                      fontSize: 11,
                      marginBottom: 8,
                    }}
                  >
                    {pl.tag}
                  </div>
                )}
                {pl.hotelName && (
                  <div style={{ fontSize: 13, color: "#4b5563", margin: "4px 0" }}>
                    🏨 {pl.hotelName}
                    {pl.hotelStars ? ` ${"★".repeat(pl.hotelStars)}` : ""}
                    {pl.hotelPrice ? ` ¥${pl.hotelPrice}/晚` : ""}
                  </div>
                )}
                {pl.dining && <div style={{ fontSize: 13, color: "#4b5563", margin: "4px 0" }}>🍜 {pl.dining}</div>}
                {pl.transportMode && (
                  <div style={{ fontSize: 13, color: "#4b5563", margin: "4px 0" }}>🚄 {pl.transportMode}</div>
                )}
                {pl.attractions && (
                  <div style={{ fontSize: 13, color: "#4b5563", margin: "4px 0" }}>📍 {pl.attractions}</div>
                )}
                {pl.highlight && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#0f766e",
                      background: C.emeraldBg,
                      borderRadius: 8,
                      padding: "6px 10px",
                      marginTop: 8,
                    }}
                  >
                    ✨ {pl.highlight}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 推荐酒店 */}
        {v.hotels.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <SectionTitle>🏨 推荐酒店</SectionTitle>
            {v.hotels.map((h, hi) => (
              <div
                key={hi}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: `1px dashed ${C.line}`,
                  fontSize: 13,
                  color: "#374151",
                }}
              >
                <span>🏨</span>
                <span style={{ flex: 1 }}>{h.name}</span>
                {h.userSpecified && (
                  <span
                    style={{
                      background: "#eef2ff",
                      color: "#4338ca",
                      borderRadius: 6,
                      padding: "1px 6px",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    您指定
                  </span>
                )}
                <span style={{ color: C.faint, fontSize: 12 }}>
                  {h.stars ? "★".repeat(h.stars) : ""}
                  {h.score ? ` ${h.score}分` : ""}
                  {h.price ? ` ¥${h.price}/晚` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 交通车票 */}
        {v.tickets.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <SectionTitle>🎫 交通车票</SectionTitle>
            {v.tickets.map((t, ti) => (
              <div
                key={ti}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: `1px dashed ${C.line}`,
                  fontSize: 13,
                  color: "#374151",
                }}
              >
                <span>{t.type === "flight" ? "✈️" : "🚄"}</span>
                <span style={{ flex: 1 }}>
                  {t.number} {t.from}→{t.to}
                </span>
                {t.userSpecified && (
                  <span
                    style={{
                      background: "#eef2ff",
                      color: "#4338ca",
                      borderRadius: 6,
                      padding: "1px 6px",
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    您指定
                  </span>
                )}
                <span style={{ color: C.sub, fontSize: 12 }}>
                  {t.depart} - {t.arrive}
                </span>
                <span style={{ color: C.indigo, fontWeight: 700 }}>¥{t.price ?? "—"}</span>
              </div>
            ))}
          </div>
        )}

        {/* 完全没内容时的兜底 */}
        {v.days.length === 0 && v.plans.length === 0 && v.hotels.length === 0 && v.tickets.length === 0 && (
          <div style={{ color: C.faint, textAlign: "center", padding: "20px 0", fontSize: 13 }}>
            暂无详细行程内容
          </div>
        )}
      </div>

      <div
        style={{
          textAlign: "center",
          color: C.faint,
          fontSize: 12,
          padding: "16px 32px 24px",
          borderTop: `1px solid #f3f4f6`,
          margin: "0 32px",
        }}
      >
        由「飞云通旅游平台」生成 · 分享给你
      </div>
    </div>
  );
}

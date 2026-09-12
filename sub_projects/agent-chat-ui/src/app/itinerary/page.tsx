"use client";

/**
 * 行程规划 + 小红书分享页面
 *
 * 数据来源：纯前端本地生成（不依赖 langgraph / AI），
 * 保证「填完表单 → 出结果 → 可分享」这条链路稳定不报错。
 * 后续可接入后端 itinerary-agent 做真正的 AI 规划。
 *
 * 小红书分享：
 *   1) 云端版：调 FastAPI /share/create 生成短链 /share/{id}
 *   2) 离线版：前端生成自包含 HTML，通过 Blob 下载
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  MapPin,
  Calendar,
  Wallet,
  Sparkles,
  Share2,
  Download,
  Copy,
  LoaderCircle,
} from "lucide-react";

const API_BASE = "http://localhost:8000";

interface ItineraryDay {
  day: number;
  title: string;
  spots: string[];
}

interface Itinerary {
  title: string;
  destination: string;
  days: number;
  budget: string;
  daysDetail: ItineraryDay[];
}

// 根据目的地 + 天数生成示例行程（占位逻辑，后续可替换为 AI 生成）
function buildItinerary(destination: string, days: number, style: string): Itinerary {
  const spotsPool = [
    `${destination}城市地标`,
    `${destination}老城区漫步`,
    `${destination}特色美食街`,
    `${destination}博物馆/文化馆`,
    `${destination}自然风光区`,
    `${destination}网红打卡点`,
    `${destination}本地市集`,
  ];
  const daysDetail: ItineraryDay[] = [];
  for (let d = 1; d <= days; d++) {
    daysDetail.push({
      day: d,
      title: `第 ${d} 天 · ${style}`,
      spots: [spotsPool[(d * 2 - 2) % spotsPool.length], spotsPool[(d * 2 - 1) % spotsPool.length]],
    });
  }
  return {
    title: `${destination} ${days} 日游`,
    destination,
    days,
    budget: "",
    daysDetail,
  };
}

export default function ItineraryPage(): React.ReactNode {
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState(3);
  const [style, setStyle] = useState("轻松慢游");
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) {
      toast.error("请填写目的地");
      return;
    }
    const result = buildItinerary(destination.trim(), days, style);
    setItinerary(result);
    setShareUrl("");
    toast.success("行程已生成");
  };

  // 云端分享：调 FastAPI /share/create
  const handleCloudShare = async () => {
    if (!itinerary) return;
    setSharing(true);
    try {
      const res = await fetch(`${API_BASE}/share/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: itinerary.title,
          payload: { ...itinerary },
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        const url = `http://localhost:3000/share/${data.data.share_id}`;
        setShareUrl(url);
        toast.success("分享链接已生成，可复制发给朋友");
      } else {
        toast.error(data.message || "分享失败，请确认后端已启动");
      }
    } catch {
      toast.error("无法连接后端（localhost:8000），请确认 FastAPI 已启动");
    } finally {
      setSharing(false);
    }
  };

  // 复制链接
  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("链接已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  // 离线导出：生成自包含 HTML 并下载
  const handleOfflineExport = () => {
    if (!itinerary) return;
    const html = buildOfflineHtml(itinerary);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${itinerary.title}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("离线版已下载，可直接发微信/小红书");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 p-6">
      <div className="mx-auto max-w-3xl">
        {/* 标题 */}
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-lg">
            <Sparkles className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">行程规划</h1>
            <p className="text-sm text-gray-500">填写信息，一键生成你的旅行行程</p>
          </div>
        </div>

        {/* 表单 */}
        <form
          onSubmit={handleGenerate}
          className="mb-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <MapPin className="size-4 text-indigo-500" /> 目的地
              </label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="例如：南京、成都、三亚"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <Calendar className="size-4 text-indigo-500" /> 天数
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <Wallet className="size-4 text-indigo-500" /> 旅行风格
            </label>
            <div className="flex flex-wrap gap-2">
              {["轻松慢游", "特种兵打卡", "亲子家庭", "美食寻味", "深度文化"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStyle(s)}
                  className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                    style === s
                      ? "bg-indigo-500 text-white"
                      : "border border-gray-200 text-gray-600 hover:border-indigo-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-opacity hover:opacity-90"
          >
            生成行程
          </button>
        </form>

        {/* 行程结果 */}
        {itinerary && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-bold text-gray-800">
              {itinerary.title}
            </h2>
            <div className="space-y-3">
              {itinerary.daysDetail.map((d) => (
                <div key={d.day} className="flex gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-600">
                    {d.day}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">{d.title}</p>
                    <p className="text-sm text-gray-500">{d.spots.join(" · ")}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 分享操作 */}
            <div className="mt-6 flex flex-wrap gap-3 border-t border-gray-100 pt-5">
              <button
                onClick={handleCloudShare}
                disabled={sharing}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {sharing ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Share2 className="size-4" />
                )}
                生成云端分享链接
              </button>
              <button
                onClick={handleOfflineExport}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-indigo-300 hover:text-indigo-600"
              >
                <Download className="size-4" />
                下载离线版（HTML）
              </button>
            </div>

            {/* 分享链接展示 */}
            {shareUrl && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-indigo-50 px-4 py-3">
                <span className="flex-1 truncate text-sm text-indigo-700">{shareUrl}</span>
                <button
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 shadow-sm hover:bg-indigo-100"
                >
                  <Copy className="size-3.5" />
                  复制
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 生成自包含的离线 HTML（小红书风格卡片）
function buildOfflineHtml(it: Itinerary): string {
  const daysHtml = it.daysDetail
    .map(
      (d) => `
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div style="flex:0 0 32px;height:32px;border-radius:50%;background:#6366f1;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:bold;">${d.day}</div>
        <div>
          <div style="font-weight:600;color:#374151;">${d.title}</div>
          <div style="color:#6b7280;">${d.spots.join(" · ")}</div>
        </div>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${it.title}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f5f5f7;margin:0;padding:24px;color:#1f2937;}
  .card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 8px 30px rgba(0,0,0,0.06);}
  .header{background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border-radius:12px;padding:20px;margin-bottom:20px;}
  .header h1{margin:0;font-size:20px;}
  .header p{margin:4px 0 0;opacity:0.9;font-size:13px;}
  .tag{display:inline-block;background:#eef2ff;color:#4f46e5;border-radius:999px;padding:2px 10px;font-size:12px;margin-top:8px;}
  .footer{text-align:center;color:#9ca3af;font-size:12px;margin-top:20px;}
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <h1>${it.title}</h1>
    <p>目的地：${it.destination} · ${it.days} 天</p>
    <span class="tag">AI 旅行规划</span>
  </div>
  ${daysHtml}
  <div class="footer">由「飞云通旅游平台」生成 · 分享给你</div>
</div>
</body>
</html>`;
}

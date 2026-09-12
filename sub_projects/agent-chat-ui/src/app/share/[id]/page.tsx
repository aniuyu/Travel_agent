"use client";

/**
 * 分享页 /share/{id}
 *
 * 从 FastAPI GET /share/{id} 读取行程内容，并**直接复用 TripExportCard 渲染**。
 *
 * 这样「预览」和「导出图片」用同一个组件、同一份 payload，
 * 保证两者内容 100% 一致（含用户选定的酒店/车票）。
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { TripExportCard } from "@/components/workspace/TripExportCard";

const API_BASE = "http://localhost:8000";

interface ShareData {
  share_id: string;
  title: string;
  payload: any;
  created_at?: string;
}

export default function SharePage(): React.ReactNode {
  const params = useParams();
  const id = params?.id as string;

  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`${API_BASE}/share/${id}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.status === "success") {
          setData(json.data);
        } else {
          setError(json.message || "分享不存在");
        }
      })
      .catch(() => setError("无法连接服务器，请稍后重试"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7]">
        <LoaderCircle className="size-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] p-6">
        <div className="text-center">
          <p className="text-lg text-gray-600">{error || "分享不存在或已过期"}</p>
        </div>
      </div>
    );
  }

  const payload = data.payload || {};
  const fallbackTitle = data.title || payload.title || "旅行行程";

  return (
    <div className="min-h-screen bg-[#e9eaf0] py-8">
      {/* 用与导出完全相同的卡片组件渲染 → 预览即导出 */}
      <div className="mx-auto w-fit overflow-hidden rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
        <TripExportCard payload={payload} title={fallbackTitle} />
      </div>
      <p className="mt-4 text-center text-xs text-gray-400">
        由「飞云通旅游平台」生成 · 分享给你
      </p>
    </div>
  );
}


"use client";

/**
 * 首页 /：保留一个 loading 占位。
 * middleware 已在请求到达时统一跳转到 /workspace 或 /login，
 * 所以这里基本不会被实际渲染。留个 fallback 防止中间件 matcher 失效时一片白屏。
 */

import { Sparkles } from "lucide-react";

export default function HomePage(): React.ReactNode {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0a0a1a] text-indigo-100/40">
      <Sparkles className="mr-2 size-5 animate-pulse text-indigo-400" />
      正在跳转工作台…
    </div>
  );
}

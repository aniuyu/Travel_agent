"use client";

/**
 * 首页 / → 重定向到登录页或工作台
 * 不再渲染聊天页（聊天依赖 langgraph，已迁移到独立工作台 /workspace）
 */

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export default function HomePage(): React.ReactNode {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loggedIn = localStorage.getItem("fy_login") === "1";
    window.location.replace(loggedIn ? "/workspace" : "/login");
  }, []);

  if (!ready) {
    setReady(true);
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 text-gray-400">
      <Sparkles className="mr-2 size-5 animate-pulse text-indigo-400" />
      加载中…
    </div>
  );
}

"use client";

/**
 * 工作台顶部导航条（深色，复刻视频样式）
 *
 * 结构：
 *   - 5 个 tab：主页 / 创建行程 / 行程单展示 / 地图展示 / 总结
 *   - 右侧：完成指示 + 通知铃 + 头像下拉（切换账户 / 退出登录）
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, LogOut, UserRoundCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { clearAuth } from "@/lib/auth";

const TABS = [
  { key: "dashboard", label: "主页" },
  { key: "create", label: "创建行程" },
  { key: "trips", label: "行程单展示" },
  { key: "map", label: "地图展示" },
  { key: "summary", label: "总结" },
] as const;

interface User {
  id?: number;
  username?: string;
  nickname?: string;
}

export function TopBar(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const currentTab = params.get("t") || "dashboard";
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("fy_user");
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const handleTab = (key: string) => {
    router.replace(`/workspace?t=${key}`);
  };

  const handleLogout = () => {
    clearAuth();
    window.location.href = "/login";
  };

  const handleSwitch = () => {
    clearAuth();
    window.location.href = "/login";
  };

  const displayName = user?.nickname || user?.username || "U";

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/5 bg-[#0f0f1a] px-4 text-gray-300">
      {/* 左侧 tab 列表 */}
      <div className="flex h-full items-center gap-1">
        {TABS.map((t) => {
          const active = currentTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => handleTab(t.key)}
              className={cn(
                "h-full px-3 text-xs transition-colors",
                active
                  ? "border-b-2 border-indigo-400 text-white"
                  : "text-gray-400 hover:text-white",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* 右侧：完成指示 + 通知 + 头像 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          完成
        </div>
        <button className="relative rounded-full p-1.5 transition-colors hover:bg-white/5">
          <Bell className="size-4" />
          <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-red-500" />
        </button>

        <div className="relative">
          <button
            onClick={() => setOpen(!open)}
            className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 text-xs font-semibold text-white transition-shadow hover:shadow-lg"
          >
            {displayName.slice(0, 1).toUpperCase()}
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-2 w-44 overflow-hidden rounded-lg border border-gray-100 bg-white text-gray-700 shadow-lg">
                <button
                  onClick={handleSwitch}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  <UserRoundCog className="size-4" />
                  切换账户
                </button>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut className="size-4" />
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
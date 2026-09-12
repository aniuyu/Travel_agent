"use client";

/**
 * 工作台左侧 Sidebar（深色宽版，复刻视频样式）
 *
 * 结构：
 *   - 顶部：紫色 logo + "AI Travel Planner"
 *   - 「主导航」分组：主页、我的行程、新建行程、地图视图
 *   - 「其他」分组：设置、帮助中心
 *   - 底部：用户卡片（头像 + 昵称 + 等级）
 *
 * 当前选中的菜单项加 indigo 高亮底色
 */

import { useRouter, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  MapPin,
  Plus,
  Map,
  Settings,
  HelpCircle,
  Compass,
  Plane,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PRIMARY = [
  { key: "dashboard", label: "主页", icon: LayoutDashboard },
  { key: "trips", label: "我的行程", icon: MapPin },
  { key: "create", label: "新建行程", icon: Plus },
  { key: "tickets", label: "车票/机票", icon: Plane },
  { key: "hotels", label: "酒店/民宿", icon: Map }, // 复用地图 icon 表示酒店
] as const;

const OTHERS = [
  { key: "settings", label: "设置", icon: Settings },
  { key: "help", label: "帮助中心", icon: HelpCircle },
] as const;

export function Sidebar(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const currentTab = params.get("t") || "dashboard";

  const handleClick = (key: string) => {
    router.replace(`/workspace?t=${key}`);
  };

  return (
    <aside className="hidden w-[208px] shrink-0 flex-col bg-[#0f0f1a] text-gray-300 lg:flex">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 shadow-lg shadow-indigo-500/30">
          <Compass className="size-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">AI Travel Planner</div>
          <div className="text-[10px] tracking-widest text-gray-500">飞云通 · 旅行助手</div>
        </div>
      </div>

      {/* 主导航 */}
      <div className="px-3 pt-4">
        <div className="mb-1 px-2 text-[10px] font-medium tracking-wider text-gray-500 uppercase">
          主导航
        </div>
        <nav className="space-y-1">
          {PRIMARY.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => handleClick(item.key)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-indigo-500/15 text-indigo-300"
                    : "text-gray-400 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className={cn("size-4", active && "text-indigo-400")} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 其他 */}
      <div className="px-3 pt-6">
        <div className="mb-1 px-2 text-[10px] font-medium tracking-wider text-gray-500 uppercase">
          其他
        </div>
        <nav className="space-y-1">
          {OTHERS.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => handleClick(item.key)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-indigo-500/15 text-indigo-300"
                    : "text-gray-400 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* 底部用户卡片 */}
      <div className="mt-auto px-3 pb-4">
        <div className="flex items-center gap-2.5 rounded-xl bg-white/5 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-purple-400 text-xs font-semibold text-white">
            飞
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white">飞云通用户</div>
            <div className="text-[10px] text-gray-500">免费版</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
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

import { useState } from "react";
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
  Users,
  Car,
  ShieldCheck,
  ChevronDown,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SERVICES_OPEN_KEY = "fy_sidebar_services_open";

const PRIMARY = [
  { key: "dashboard", label: "主页", icon: LayoutDashboard },
  { key: "trips", label: "我的行程", icon: MapPin },
  { key: "create", label: "新建行程", icon: Plus },
  { key: "tickets", label: "车票/机票", icon: Plane },
  { key: "hotels", label: "酒店/民宿", icon: Map }, // 复用地图 icon 表示酒店
] as const;

// 其他服务（旅游团走途牛 holiday；租车走高德 POI；保险为 AI 建议）
const SERVICES = [
  { key: "tours", label: "旅游团", icon: Users },
  { key: "car-rental", label: "租车", icon: Car },
  { key: "insurance", label: "保险", icon: ShieldCheck },
] as const;

const OTHERS = [
  { key: "settings", label: "设置", icon: Settings },
  { key: "help", label: "帮助中心", icon: HelpCircle },
] as const;

export function Sidebar(): React.ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const currentTab = params.get("t") || "dashboard";

  // 「其他服务」可展开/收起（状态持久化，默认展开）
  const [servicesOpen, setServicesOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(SERVICES_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleServices = () => {
    setServicesOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(SERVICES_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleClick = (key: string) => {
    router.replace(`/workspace?t=${key}`);
  };

  // 当前 tab 属于「其他服务」时，即使收起也要让分组标题高亮，避免用户找不到自己在哪
  const servicesActive = SERVICES.some((s) => s.key === currentTab);

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

      {/* 导航区（菜单项较多，可滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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

        {/* 其他服务（可展开 / 收起） */}
        <div className="px-3 pt-6">
          <button
            type="button"
            onClick={toggleServices}
            aria-expanded={servicesOpen}
            className={cn(
              "group mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
              servicesActive
                ? "bg-indigo-500/15 text-indigo-300"
                : "text-gray-400 hover:bg-white/5 hover:text-white",
            )}
            title={servicesOpen ? "收起「其他服务」" : "展开「其他服务」"}
          >
            <span className={cn("flex items-center gap-2.5", servicesActive && "text-indigo-300")}>
              <Package className={cn("size-4", servicesActive && "text-indigo-400")} />
              其他服务
            </span>
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                !servicesOpen && "-rotate-90",
              )}
            />
          </button>
          {servicesOpen && (
            <nav className="space-y-1">
              {SERVICES.map((item) => {
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
          )}
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
      </div>

      {/* 底部用户卡片 */}
      <div className="px-3 pb-4 pt-3">
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
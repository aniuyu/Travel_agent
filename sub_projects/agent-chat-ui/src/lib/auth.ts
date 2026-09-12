"use client";

/**
 * 登录态工具
 *
 * 数据存放：
 *   - cookie `fy_auth`  → 服务端 middleware 用（决定是否 302 跳登录）
 *   - localStorage `fy_auth` → 客户端读取用户信息用
 *   - 旧键 `fy_login` / `fy_user` 同步写入，保持现有 UI 组件不破坏
 *
 * 有效期：3 天（同时写在 cookie 的 max-age 和 JSON.exp，server / client 任意一侧都能校验）
 */

const COOKIE_NAME = "fy_auth";
const LS_KEY = "fy_auth";
const LEGACY_LOGIN_FLAG = "fy_login"; // 兼容旧代码
const LEGACY_USER_KEY = "fy_user";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const THREE_DAYS_S = 3 * 24 * 60 * 60;

export interface AuthInfo {
  user: unknown;
  /** 过期时间（ms 时间戳） */
  exp: number;
}

function writeCookie(value: string) {
  // SameSite=Lax：跨顶级导航时仍能携带（确保从 /workspace 跳转仍可用）
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; max-age=${THREE_DAYS_S}; path=/; SameSite=Lax`;
}

function deleteCookie() {
  document.cookie = `${COOKIE_NAME}=; max-age=0; path=/`;
}

/** 登录成功后调用，同时写入 cookie + localStorage */
export function setAuth(user: unknown): void {
  const info: AuthInfo = { user, exp: Date.now() + THREE_DAYS_MS };
  const json = JSON.stringify(info);

  // 新格式（统一存储）
  localStorage.setItem(LS_KEY, json);
  writeCookie(json);

  // 兼容旧代码（TopBar 头像、thread/index.tsx 等还在读这两个键）
  localStorage.setItem(LEGACY_LOGIN_FLAG, "1");
  localStorage.setItem(LEGACY_USER_KEY, JSON.stringify(user));
}

/** 退出登录：清掉 cookie + 所有本地副本 */
export function clearAuth(): void {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LEGACY_LOGIN_FLAG);
  localStorage.removeItem(LEGACY_USER_KEY);
  deleteCookie();
}

/** 是否在登录态（未过期） */
export function isAuthed(): boolean {
  if (typeof window === "undefined") return false;
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return false;
  try {
    const info = JSON.parse(raw) as AuthInfo;
    if (!info?.exp || Date.now() > info.exp) {
      // 过期了 → 顺手清掉，避免下次脏读
      clearAuth();
      return false;
    }
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

/** 当前登录用户（自动校验过期） */
export function getUser<T = unknown>(): T | null {
  if (!isAuthed()) return null;
  try {
    const info = JSON.parse(localStorage.getItem(LS_KEY)!) as AuthInfo;
    return info.user as T;
  } catch {
    return null;
  }
}

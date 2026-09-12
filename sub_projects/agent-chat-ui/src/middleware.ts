import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * 服务端鉴权
 *
 * 规则：
 *   - 访问 /workspace（含子路由）时，若没有有效 fy_auth cookie → 302 到 /login
 *   - 访问 /            时，统一跳到 /workspace
 *   - 已登录用户访问 /login → 302 到 /workspace（避免重复登录）
 *
 * 客户端兜底：workspace 页面在 mount 时也会再读一次 localStorage，
 * 不过兜底只是 UX 表现，主导权在 cookie。
 *
 * 注意：middleware 跑在 edge runtime，没有 localStorage，只能看 cookie。
 */

const COOKIE_NAME = "fy_auth";

function isAuthedFromCookie(req: NextRequest): boolean {
  const raw = req.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return false;
  try {
    const decoded = JSON.parse(decodeURIComponent(raw));
    const exp = decoded?.exp;
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = isAuthedFromCookie(req);

  // 首页：直接跳转到 /workspace（是否登录由 /workspace 自身再判断）
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/workspace";
    return NextResponse.redirect(url);
  }

  // 受保护页：未登录 → /login
  if (pathname.startsWith("/workspace") && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // 已登录用户停在 /login：直接送回 /workspace
  if (pathname === "/login" && authed) {
    const url = req.nextUrl.clone();
    url.pathname = "/workspace";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 仅匹配需要鉴权的路由；next 资源、_next/*、api/* 不进 middleware
  matcher: ["/", "/login", "/workspace/:path*"],
};

"use client";

/**
 * AI 旅行规划 · 登录页
 *
 * 设计参照：深色紫蓝科技风 + 动态颗粒背景。
 * 左侧：品牌（指南针 Logo + 标题 + Slogan + 功能标签）
 * 右侧：登录卡片（账号密码登录）
 */

import { useEffect, useState } from "react";
import { Compass, User, Lock, Sparkles, UserPlus, LogIn } from "lucide-react";
import { toast } from "sonner";
import { setAuth, isAuthed } from "@/lib/auth";

// 后端 FastAPI 地址（前端 3000 跨域访问后端 8000）
const API_BASE = "http://localhost:8000";

// 功能标签（左下角的圆角按钮）
const FEATURE_TAGS = [
  "个性化路线",
  "景点地图",
  "预算优化",
  "美食推荐",
  "酒店预定",
  "车票预定",
];

export default function LoginPage(): React.ReactNode {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);

  // 登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast.error("请输入用户名和密码");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        // 写入登录态：cookie（3 天过期）+ localStorage（供 UI 读取）
        setAuth(data.data);
        toast.success("登录成功，正在进入工作台…");
        window.location.href = "/workspace";
      } else {
        toast.error(data.message || "登录失败");
      }
    } catch (err) {
      toast.error("无法连接后端服务，请确认已启动 FastAPI（端口 8000）");
    } finally {
      setLoading(false);
    }
  };

  // 注册
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast.error("请输入用户名和密码");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          nickname: nickname.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        toast.success("注册成功，请登录");
        setMode("login");
        setNickname("");
      } else {
        toast.error(data.message || "注册失败");
      }
    } catch (err) {
      toast.error("无法连接后端服务，请确认已启动 FastAPI（端口 8000）");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full overflow-hidden bg-[#0a0a1a] text-white">
      {/* 动态颗粒背景（Canvas）—— 蓝色紫色粒子缓慢漂浮 */}
      <ParticleField />

      {/* 左侧品牌区 */}
      <aside className="relative z-10 hidden flex-1 flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-3">
          <CompassLogo />
          <span className="text-sm font-medium tracking-widest text-indigo-300/80">
            AI TRAVEL PLANNER
          </span>
        </div>

        <div className="max-w-xl space-y-8">
          <div>
            <h1 className="text-5xl font-bold leading-tight">
              <span className="bg-gradient-to-r from-white via-indigo-100 to-purple-200 bg-clip-text text-transparent">
                飞云通规划
              </span>
              <br />
              <span className="bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300 bg-clip-text text-transparent">
                说走就走
              </span>
            </h1>
            <p className="mt-6 text-base leading-relaxed text-indigo-100/70">
              基于人工智能的旅行规划智能助手，为您打造专属的旅行方案。
              <br />
              从景点到美食，从交通到住宿，全程智能推荐。
            </p>
          </div>

          {/* 功能标签（左下角圆角按钮）*/}
          <div className="flex flex-wrap gap-3">
            {FEATURE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm text-indigo-100/90 backdrop-blur-md transition-all hover:border-indigo-400/40 hover:bg-indigo-500/10 hover:text-white"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-indigo-200/40">© 2026 飞云通 · 让每一次出发都心中有数</p>
      </aside>

      {/* 右侧登录卡片 */}
      <main className="relative z-10 flex flex-1 items-center justify-center p-6 lg:flex-none lg:w-[480px] xl:w-[540px]">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/60 p-10 shadow-2xl backdrop-blur-xl">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-semibold text-white">
              {mode === "login" ? "欢迎回来" : "创建账号"}
            </h2>
            <p className="mt-2 text-sm text-indigo-200/60">
              {mode === "login" ? "选择登录方式，继续你的旅程" : "注册一个新账号，开启你的旅程"}
            </p>
          </div>

          {/* 账号密码表单（登录/注册切换） */}
          <form
            onSubmit={mode === "login" ? handleLogin : handleRegister}
            className="space-y-5"
          >
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-indigo-300/60" />
              <input
                type="text"
                placeholder="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white placeholder:text-indigo-200/40 outline-none transition-all focus:border-indigo-400/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>

            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-indigo-300/60" />
              <input
                type="password"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white placeholder:text-indigo-200/40 outline-none transition-all focus:border-indigo-400/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>

            {/* 注册模式多一个昵称输入框 */}
            {mode === "register" && (
              <div className="relative">
                <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-indigo-300/60" />
                <input
                  type="text"
                  placeholder="昵称（可选）"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white placeholder:text-indigo-200/40 outline-none transition-all focus:border-indigo-400/60 focus:bg-white/[0.08] focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full overflow-hidden rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="relative z-10 inline-flex items-center justify-center gap-2">
                {loading ? (
                  mode === "login" ? "登录中…" : "注册中…"
                ) : mode === "login" ? (
                  <>
                    <LogIn className="size-4" />
                    登录
                  </>
                ) : (
                  <>
                    <UserPlus className="size-4" />
                    注册
                  </>
                )}
              </span>
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500 transition-transform duration-500 group-hover:translate-x-0" />
            </button>
          </form>

          {/* 注册/登录切换引导 */}
          <p className="mt-8 text-center text-sm text-indigo-200/60">
            {mode === "login" ? "还没有账号？" : "已有账号？"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setPassword("");
              }}
              className="font-medium text-indigo-300 transition-colors hover:text-white"
            >
              {mode === "login" ? "立即注册" : "返回登录"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * 指南针 Logo（纯 SVG，复用 lucide-react 的 Compass 风格但用渐变 + 圆形外框）
 */
function CompassLogo() {
  return (
    <div className="relative">
      <div className="absolute inset-0 animate-pulse rounded-full bg-indigo-500/30 blur-xl" />
      <div className="relative flex size-20 items-center justify-center rounded-full border border-indigo-300/30 bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 backdrop-blur-md">
        <Compass className="size-10 text-indigo-200" strokeWidth={1.5} />
        <div className="absolute inset-0 rounded-full border-2 border-indigo-400/20" />
      </div>
    </div>
  );
}

/**
 * 动态颗粒背景：Canvas 绘制蓝色/紫色粒子，缓慢漂浮并连成淡线，
 * 形成"科技感动态颗粒"效果。性能可控（粒子数少 + requestAnimationFrame）。
 */
function ParticleField() {
  useEffect(() => {
    const canvas = document.getElementById("login-particle-canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    // 粒子：颜色从蓝紫到粉紫渐变
    const particles = Array.from({ length: 60 }).map(() => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3 * dpr,
      vy: (Math.random() - 0.5) * 0.3 * dpr,
      r: (Math.random() * 1.6 + 0.6) * dpr,
      hue: 220 + Math.random() * 80, // 220 蓝 → 300 紫
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 连线
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120 * dpr) {
            const alpha = 1 - dist / (120 * dpr);
            ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2}, 70%, 70%, ${alpha * 0.18})`;
            ctx.lineWidth = 0.6 * dpr;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // 粒子
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        grad.addColorStop(0, `hsla(${p.hue}, 80%, 75%, 0.9)`);
        grad.addColorStop(1, `hsla(${p.hue}, 80%, 75%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <>
      <canvas
        id="login-particle-canvas"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {/* 径向渐变叠加：让中央略亮、边缘深，强化卡片聚焦感 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(99,102,241,0.18),_transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-950/50 via-transparent to-purple-950/50" />
    </>
  );
}

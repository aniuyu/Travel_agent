"use client";

/**
 * 动态粒子背景
 *
 * 蓝色/紫色粒子在深色背景上缓慢漂浮，模拟视频里那种"星空+科技"动效。
 * 用 Canvas 绘制，performance 友好（粒子数少 + requestAnimationFrame）。
 * 挂在绝对定位的 canvas 上，z-index 在内容之下。
 */

import { useEffect, useRef } from "react";

export function ParticleField(): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    // 粒子：颜色从蓝紫到粉紫渐变
    const particles = Array.from({ length: 50 }).map(() => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.4 * dpr,
      vy: (Math.random() - 0.5) * 0.4 * dpr,
      r: (Math.random() * 1.6 + 0.6) * dpr,
      hue: 220 + Math.random() * 80, // 220 蓝 → 300 紫
    }));

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 粒子间淡线
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130 * dpr) {
            const alpha = 1 - dist / (130 * dpr);
            ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2}, 70%, 70%, ${alpha * 0.15})`;
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
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {/* 径向渐变叠加：让中心略亮、边缘深，强化 Hero 聚焦感 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(99,102,241,0.15),_transparent_60%)]" />
    </>
  );
}

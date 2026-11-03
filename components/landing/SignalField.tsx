"use client";

import { useEffect, useRef } from "react";

// Generatief stippenveld achter de hero: elke stip is een "signaal". Rond de muis lichten ze op en wijken ze
// iets uit; daarbuiten ademt het veld langzaam. Tekent alleen zolang het in beeld is en het tabblad zichtbaar
// is. Bij reduced motion of een aanraakscherm wordt het één keer stil getekend.
export function SignalField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const animate = !reduce && fine;
    // Zachte stippen hebben geen retina-resolutie nodig: maximaal 1,5× scheelt veel pixels per frame.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    let gap = 30;
    let raf = 0;
    let inView = true;
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999 };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      gap = w < 700 ? 26 : 30;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    // Stippen worden per kleur en (afgeronde) dekking gebundeld in één pad: een handvol fill-aanroepen per
    // frame in plaats van één per stip.
    const LEVELS = 8;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      mouse.x += (mouse.tx - mouse.x) * 0.14;
      mouse.y += (mouse.ty - mouse.y) * 0.14;
      const paths = Array.from({ length: LEVELS * 2 }, () => new Path2D());
      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          const dx = x - mouse.x;
          const dy = y - mouse.y;
          const d = Math.hypot(dx, dy) || 1;
          const k = Math.max(0, 1 - d / 190);
          const wave = animate ? Math.sin(x * 0.011 + y * 0.007 + t * 0.0011) * 0.5 + 0.5 : 0.5;
          const push = k * k * 14;
          const px = x + (dx / d) * push;
          const py = y + (dy / d) * push;
          const r = 0.9 + wave * 0.55 + k * 2.4;
          const alpha = Math.min(0.95, 0.14 + wave * 0.12 + k * 0.55);
          const level = Math.min(LEVELS - 1, Math.floor(alpha * LEVELS));
          const path = paths[(k > 0.02 ? LEVELS : 0) + level];
          path.moveTo(px + r, py);
          path.arc(px, py, r, 0, Math.PI * 2);
        }
      }
      paths.forEach((path, i) => {
        const level = i % LEVELS;
        const a = ((level + 0.5) / LEVELS).toFixed(3);
        // Petrol in rust, helder blauw bij de muis.
        ctx.fillStyle = i >= LEVELS ? `rgba(30,155,215,${a})` : `rgba(0,74,109,${a})`;
        ctx.fill(path);
      });
    };

    let last = 0;
    const loop = (t: number) => {
      if (t - last > 30) {
        last = t;
        draw(t);
      }
      raf = inView && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (animate && !raf && inView && !document.hidden) raf = requestAnimationFrame(loop);
    };

    resize();
    draw(0);
    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    ro.observe(canvas);

    if (!animate) return () => ro.disconnect();

    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      start();
    });
    io.observe(canvas);
    const host = canvas.parentElement ?? canvas;
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = e.clientX - r.left;
      mouse.ty = e.clientY - r.top;
      if (mouse.x < -999) {
        mouse.x = mouse.tx;
        mouse.y = mouse.ty;
      }
    };
    const leave = () => {
      mouse.tx = -9999;
      mouse.ty = -9999;
    };
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", start);
    start();
    return () => {
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", start);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

"use client";

import { useEffect, useRef } from "react";
import { STRIDE, stepDots, type Ring } from "./halftone";

const WORD = "Ritwik";
// Ink to warm: dots blush the further they are pushed from home.
const SHADES = ["#E1E0CC", "#E6CBB0", "#EBB695", "#F0A27F"];

function Wordmark() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!, ctx = canvas.getContext("2d");
    if (!ctx) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let d = new Float32Array(0), v = new Float32Array(0), radii = new Float32Array(0);
    let w = 0, h = 0, raf = 0, visible = false;
    let px: number | null = null, py: number | null = null;
    const rings: Ring[] = [];

    const build = () => {
      w = wrap.clientWidth;
      if (!w) return;
      const font = getComputedStyle(document.body).fontFamily;
      const off = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      off.font = `600 100px ${font}`;
      const size = (100 * w * 0.96) / off.measureText(WORD).width;
      h = Math.round(size * 0.72); // the baseline sits below this, so the bottom edge crops the letters
      off.canvas.width = w;
      off.canvas.height = h;
      off.font = `600 ${size}px ${font}`;
      off.textAlign = "center";
      off.fillText(WORD, w / 2, size * 0.84);
      const img = off.getImageData(0, 0, w, h).data;

      const s = Math.max(5, Math.round(w / 190));
      const pts: number[] = [], rs: number[] = [];
      for (let row = 0, y = s / 2; y < h; row++, y += s * 0.87) {
        for (let x = (row % 2) * (s / 2) + s / 2; x < w; x += s) {
          if (img[((y | 0) * w + (x | 0)) * 4 + 3] < 128) continue;
          pts.push(x, y, x, y);
          rs.push(s * 0.48 * (1 - 0.62 * (y / h))); // halftone: dots thin out toward the bottom edge
        }
      }
      d = Float32Array.from(pts);
      v = new Float32Array((pts.length / STRIDE) * 2);
      radii = Float32Array.from(rs);

      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (let shade = 0; shade < SHADES.length; shade++) {
        ctx.beginPath();
        for (let i = 0, k = 0; i < d.length; i += STRIDE, k++) {
          const off = Math.abs(d[i] - d[i + 2]) + Math.abs(d[i + 1] - d[i + 3]);
          if ((off < 1.5 ? 0 : off < 10 ? 1 : off < 24 ? 2 : 3) !== shade) continue;
          ctx.moveTo(d[i + 2] + radii[k], d[i + 3]);
          ctx.arc(d[i + 2], d[i + 3], radii[k], 0, Math.PI * 2);
        }
        ctx.fillStyle = SHADES[shade];
        ctx.fill();
      }
    };

    const frame = () => {
      raf = 0;
      for (const r of rings) r.r += 11;
      while (rings.length && rings[0].r > w) rings.shift();
      const unrest = stepDots(d, v, px, py, rings);
      draw();
      // Runs only while something moves and the footer is on screen.
      if (visible && (unrest > 0.05 || rings.length)) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf && visible && !still) raf = requestAnimationFrame(frame); };
    const at = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const move = (e: PointerEvent) => { [px, py] = at(e); kick(); };
    const leave = () => { px = py = null; kick(); };
    const down = (e: PointerEvent) => { const [x, y] = at(e); rings.push({ x, y, r: 0 }); kick(); };

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); });
    const ro = new ResizeObserver(() => { build(); draw(); });
    document.fonts.ready.then(() => { build(); draw(); ro.observe(wrap); io.observe(canvas); });
    if (!still) {
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerleave", leave);
      canvas.addEventListener("pointerdown", down);
    }
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointerdown", down);
    };
  }, []);

  return (
    <div ref={wrapRef} className="mt-16 md:mt-24">
      <canvas ref={canvasRef} role="img" aria-label={WORD} className="block w-full touch-pan-y" />
    </div>
  );
}

const linkCls = "text-base text-primary/80 underline-offset-4 transition-colors duration-300 hover:text-primary hover:underline";

export function HalftoneFooter() {
  return (
    <footer className="overflow-hidden rounded-2xl bg-[#141311] md:rounded-[2rem]">
      <div className="grid gap-10 px-4 pt-16 sm:px-6 md:grid-cols-12 md:px-10 md:pt-24">
        <p className="max-w-xl text-[clamp(1.5rem,3vw,2.25rem)] font-medium leading-[1.1] tracking-[-0.03em] text-primary md:col-span-6">
          Flux is designed and built by Ritwik. Bring a teammate, or at least a rubber duck.
        </p>
        <nav aria-label="Footer" className="md:col-span-3 md:col-start-8">
          <ul className="grid gap-3">
            <li><a href="#top" className={linkCls}>Start a code room</a></li>
            <li><a href="/?mode=web" className={linkCls}>Start a web room</a></li>
            <li><a href="/privacy" className={linkCls}>Privacy</a></li>
          </ul>
        </nav>
        <div className="flex flex-col gap-3 md:col-span-2 md:col-start-11 md:items-end">
          <a
            href="#top"
            className="group flex w-max items-center gap-2 rounded-full bg-primary py-1.5 pl-4 pr-1.5 text-[14px] font-medium text-ground transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]"
          >
            Back to top
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ground text-primary transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-0.5">
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" /></svg>
            </span>
          </a>
          <span suppressHydrationWarning className="text-[13px] text-primary/50">&copy; {new Date().getFullYear()} Ritwik</span>
          <span className="max-w-[16rem] text-[13px] leading-snug text-primary/50 md:text-right">Language logos from Devicon (MIT) and Simple Icons (CC0). Trademarks belong to their owners.</span>
        </div>
      </div>
      <Wordmark />
    </footer>
  );
}

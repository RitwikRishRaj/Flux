"use client";

import { animate, motion, useInView, useMotionValue, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RoomPanel } from "./room-panel";

/* ---------------- WordsPullUp ---------------- */
interface WordsPullUpProps {
  text: string;
  className?: string;
  showAsterisk?: boolean;
  style?: React.CSSProperties;
}

export const WordsPullUp = ({ text, className = "", showAsterisk = false, style }: WordsPullUpProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });
  const words = text.split(" ");

  return (
    <div ref={ref} className={`inline-flex flex-wrap ${className}`} style={style}>
      {words.map((word, i) => {
        const isLast = i === words.length - 1;
        return (
          <motion.span
            key={i}
            initial={{ y: 20, opacity: 0 }}
            animate={isInView ? { y: 0, opacity: 1 } : {}}
            transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block relative"
            style={{ marginRight: isLast ? 0 : "0.25em" }}
          >
            {word}
            {showAsterisk && isLast && (
              <span className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]">*</span>
            )}
          </motion.span>
        );
      })}
    </div>
  );
};

/* ---------------- WordsPullUpMultiStyle ---------------- */
interface Segment {
  text: string;
  className?: string;
}

interface WordsPullUpMultiStyleProps {
  segments: Segment[];
  className?: string;
  style?: React.CSSProperties;
}

export const WordsPullUpMultiStyle = ({ segments, className = "", style }: WordsPullUpMultiStyleProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true });

  const words: { word: string; className?: string }[] = [];
  segments.forEach((seg) => {
    seg.text.split(" ").forEach((w) => {
      if (w) words.push({ word: w, className: seg.className });
    });
  });

  return (
    <div ref={ref} className={`inline-flex flex-wrap justify-center ${className}`} style={style}>
      {words.map((w, i) => (
        <motion.span
          key={i}
          initial={{ y: 20, opacity: 0 }}
          animate={isInView ? { y: 0, opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          className={`inline-block ${w.className ?? ""}`}
          style={{ marginRight: "0.25em" }}
        >
          {w.word}
        </motion.span>
      ))}
    </div>
  );
};

/* ---------------- FluxWord ---------------- */
// Letters rise in one by one, drift in a slow wave, and spring up when hovered.
const FluxWord = ({ text }: { text: string }) => {
  const reduce = useReducedMotion();
  const letters = [...text];
  return (
    <span className="inline-flex" aria-label={text}>
      {letters.map((c, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="relative inline-block cursor-default"
          initial={{ y: "45%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.9, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
          whileHover={reduce ? undefined : { y: "-7%", transition: { type: "spring", stiffness: 260, damping: 11 } }}
        >
          <motion.span
            className="inline-block"
            animate={reduce ? undefined : { y: ["0%", "-2.5%", "0%"] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 1.2 + i * 0.35 }}
          >
            {c}
          </motion.span>
          {i === letters.length - 1 && (
            <span className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]">*</span>
          )}
        </motion.span>
      ))}
    </span>
  );
};

/* ---------------- Cursors ---------------- */
// Two teammates on the picture: they glide about, now and then drag-select a word of the description or
// press one of the links (a fake press: nothing navigates). The page says "collaborative" before anyone reads it.
const CURSORS = [
  { name: "Mateo", color: "#7FB2F0", opening: ["wait", "select", "drift"] },
  { name: "Sam", color: "#E58FB4", opening: ["wait", "drift", "click"] },
] as const;
type Action = "wait" | "drift" | "select" | "click";
const taken = new Set<string>(); // the word or link one cursor is on, so the other picks something else
const glideEase = [0.45, 0.05, 0.25, 1] as const;

function pickAction(): Action {
  const r = Math.random();
  return r < 0.6 ? "drift" : r < 0.9 ? "select" : "click"; // presses stay rare: about one action in ten
}

function Cursor({ name, color, opening, index, layer, text }: {
  name: string; color: string; opening: readonly Action[]; index: number;
  layer: React.RefObject<HTMLDivElement | null>; text: React.RefObject<HTMLDivElement | null>;
}) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0), y = useMotionValue(0), shown = useMotionValue(0), press = useMotionValue(1);
  const ring = useMotionValue(0), ringFade = useMotionValue(0);
  const selX = useMotionValue(0), selY = useMotionValue(0), selW = useMotionValue(0), selH = useMotionValue(0);
  const selGrow = useMotionValue(0), selFade = useMotionValue(0);

  useEffect(() => {
    let alive = true;
    const runs: { stop: () => void }[] = [];
    const go = <T,>(c: T & { stop: () => void }) => (runs.push(c), c);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const box = () => {
      const l = layer.current?.getBoundingClientRect(), t = text.current?.getBoundingClientRect();
      return l && t && l.width ? { l, t } : null;
    };
    const rel = (r: DOMRect, l: DOMRect) => ({ left: r.left - l.left, top: r.top - l.top, right: r.right - l.left, bottom: r.bottom - l.top, height: r.height });

    // Slow, eased travel; x and y on slightly different curves so the path bends a little instead of running on rails.
    const glide = async (tx: number, ty: number) => {
      const d = Math.hypot(tx - x.get(), ty - y.get());
      const duration = Math.min(4.2, Math.max(1.4, d / 110));
      await Promise.all([go(animate(x, tx, { duration, ease: glideEase })), go(animate(y, ty, { duration, ease: [0.35, 0, 0.3, 1] }))]);
    };

    const drift = async () => {
      const b = box(); if (!b) return;
      const t = rel(b.t, b.l);
      await glide(t.left + Math.random() * (t.right - t.left + 60), t.top + 30 + Math.random() * (t.bottom - t.top + 110));
    };

    const select = async () => {
      const b = box(), p = text.current?.querySelector("[data-desc]")?.firstChild;
      if (!b || !p?.textContent) return;
      const words = [...p.textContent.matchAll(/[A-Za-z]{4,}/g)].filter((m) => !taken.has(m[0]));
      const m = words[Math.floor(Math.random() * words.length)];
      if (!m) return;
      const range = document.createRange();
      range.setStart(p, m.index!);
      range.setEnd(p, m.index! + m[0].length);
      const w = rel(range.getBoundingClientRect(), b.l);
      taken.add(m[0]);
      await glide(w.left - 1, w.top + w.height * 0.55);
      selX.set(w.left - 1); selY.set(w.top); selW.set(w.right - w.left + 2); selH.set(w.height); selGrow.set(0); selFade.set(1);
      const drag = 0.45 + (w.right - w.left) / 260;
      await Promise.all([go(animate(x, w.right + 1, { duration: drag, ease: "easeInOut" })), go(animate(selGrow, 1, { duration: drag, ease: "easeInOut" }))]);
      await wait(1700);
      await go(animate(selFade, 0, { duration: 0.5 }));
      taken.delete(m[0]);
    };

    const click = async () => {
      const b = box();
      const links = [...(text.current?.querySelectorAll<HTMLAnchorElement>("nav a") ?? [])].filter((a) => !taken.has(a.href));
      const a = links[Math.floor(Math.random() * links.length)];
      if (!b || !a) return;
      taken.add(a.href);
      const r = rel(a.getBoundingClientRect(), b.l);
      await glide(r.left + (r.right - r.left) * 0.45, r.top + r.height * 0.5);
      a.dataset.ghost = "on";
      ring.set(0.3); ringFade.set(0.55);
      go(animate(ring, 1.6, { duration: 0.6, ease: "easeOut" }));
      go(animate(ringFade, 0, { duration: 0.6, ease: "easeOut" }));
      await go(animate(press, [1, 0.82, 1], { duration: 0.32 }));
      await wait(900);
      delete a.dataset.ghost;
      taken.delete(a.href);
    };

    (async () => {
      await wait(1600 + index * 700); // let the words land first
      const b = box();
      if (!alive || !b) return;
      const t = rel(b.t, b.l);
      // Start beside the words: Mateo off the end of the description, Sam under it.
      x.set(index ? t.left + 40 : t.right - 30);
      y.set(index ? t.bottom + 70 : t.top + (t.bottom - t.top) * 0.55);
      go(animate(shown, 1, { duration: 0.8 }));
      if (reduce) return;
      for (let step = 0; alive; step++) {
        const act = opening[step] ?? pickAction();
        if (act === "wait") await wait(1800);
        else await (act === "drift" ? drift() : act === "select" ? select() : click());
        await wait(1800 + Math.random() * 2600);
      }
    })();
    return () => { alive = false; runs.forEach((r) => r.stop()); };
  }, [index, layer, opening, reduce, text]);

  return (
    <>
      <motion.div
        className="absolute left-0 top-0 origin-left rounded-[3px]"
        style={{ x: selX, y: selY, width: selW, height: selH, scaleX: selGrow, opacity: selFade, background: `${color}66` }}
      />
      <motion.div className="absolute left-0 top-0" style={{ x, y, opacity: shown }}>
        <motion.span className="absolute -left-3 -top-3 h-6 w-6 rounded-full border-2" style={{ scale: ring, opacity: ringFade, borderColor: color }} />
        <motion.div className="origin-top-left" style={{ scale: press }}>
          <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-[0_2px_6px_rgba(0,0,0,0.35)]">
            <path d="M1.5 1.5 16 9.2l-6.6 1.6-3.1 6.6z" fill={color} stroke="#0a0a09" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span className="ml-4 inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-ground" style={{ background: color }}>
            {name}
          </span>
        </motion.div>
      </motion.div>
    </>
  );
}

const HeroCursors = ({ text }: { text: React.RefObject<HTMLDivElement | null> }) => {
  const layer = useRef<HTMLDivElement>(null);
  return (
    <div ref={layer} aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
      {CURSORS.map((c, i) => <Cursor key={c.name} {...c} index={i} layer={layer} text={text} />)}
    </div>
  );
};

/* ---------------- Hero ---------------- */

// data-ghost: a cursor in the hero is pressing the link.
const linkCls = "text-primary/60 underline-offset-4 transition-colors duration-300 hover:text-primary hover:underline data-[ghost=on]:text-primary data-[ghost=on]:underline";

const FluxHero = () => {
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // Parallax as the hero scrolls away: the wordmark lags, the words (and the cursors working on them) lag less.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const k = reduce ? 0 : 1;
  const yWord = useTransform(scrollYProgress, [0, 1], [0, 220 * k]);
  const yText = useTransform(scrollYProgress, [0, 1], [0, 90 * k]);

  return (
    <section ref={ref} id="top" className="h-screen min-h-[740px] w-full lg:min-h-0">
      <div className="relative h-full w-full overflow-hidden rounded-2xl md:rounded-[2rem]">
        {/* Background video */}
        <video autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" src="/hero-loop.mp4" />

        {/* Noise overlay */}
        <div className="noise-overlay pointer-events-none absolute inset-0 opacity-[0.7] mix-blend-overlay" />

        {/* Gradient overlay */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />

        {/* Room panel: top on small screens, vertically centred on the right from lg */}
        <div className="absolute inset-x-4 top-4 z-10 mx-auto max-w-[420px] sm:top-6 lg:inset-x-auto lg:right-10 lg:top-1/2 lg:mx-0 lg:w-[420px] lg:-translate-y-1/2">
          <RoomPanel
            onEnter={({ room, user }) =>
              router.push(`/room/${room}?name=${encodeURIComponent(user.name)}&color=${encodeURIComponent(user.color)}&id=${encodeURIComponent(user.id)}${new URLSearchParams(location.search).get("mode") === "web" ? "&mode=web" : ""}`)
            }
          />
        </div>

        {/* Words and wordmark. Phones: wordmark, then words, under the panel. From lg: words top-left, clear of the panel. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end px-4 pb-2 sm:px-6 md:px-10 lg:justify-between lg:pt-10">
          <motion.div ref={textRef} style={{ y: yText }} className="pointer-events-auto order-2 flex flex-col gap-4 pb-6 lg:order-1 lg:max-w-[min(30rem,calc(100%-32rem))] lg:pb-0">
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="hidden text-[clamp(1.5rem,2.4vw,2.25rem)] font-medium leading-[1.08] tracking-[-0.03em] text-primary lg:block"
            >
              Write, run and test code together, from one link.
            </motion.p>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
              data-desc
              className="max-w-md text-xs text-primary/75 sm:text-sm md:text-base"
              style={{ lineHeight: 1.35 }}
            >
              A shared code editor that lives in a link. Open a room, send it to your team, and everyone types, runs and tests in the same file. No sign-up, no installs, no merge conflicts.
            </motion.p>
            <motion.nav
              aria-label="Page"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.7 }}
              className="flex gap-5 text-xs sm:text-sm"
            >
              <a href="#features" className={linkCls}>Features</a>
              <a href="#languages" className={linkCls}>Languages</a>
              <a href="/privacy" className={linkCls}>Privacy</a>
            </motion.nav>
          </motion.div>

          <motion.h1
            style={{ y: yWord, color: "#E1E0CC" }}
            className="order-1 font-medium leading-[0.85] tracking-[-0.07em] text-[26vw] sm:text-[24vw] md:text-[22vw] lg:order-2 lg:text-[20vw] xl:text-[19vw] 2xl:text-[20vw]"
          >
            <span className="pointer-events-auto"><FluxWord text="Flux" /></span>
          </motion.h1>
        </div>

        {/* Over the words, under the panel; moves with the words so a selection stays on its word. */}
        <motion.div style={{ y: yText }} className="pointer-events-none absolute inset-0 z-[5]">
          <HeroCursors text={textRef} />
        </motion.div>
      </div>
    </section>
  );
};

export { FluxHero };

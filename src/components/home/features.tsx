"use client";

import { motion, useInView, useMotionValue, useReducedMotion, useScroll, useTransform, type MotionValue, type Variants } from "framer-motion";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { buildSrcDoc } from "@/lib/web-preview";
import { tokens, typing, type Lang } from "./code-demo";

const ease = [0.16, 1, 0.3, 1] as const;
const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease } },
};
const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };

/* ---------------- Parallax ---------------- */
// Section scroll progress, and 0 when parallax is off (reduced motion, one-column layout).
const Depth = createContext<{ p: MotionValue<number> | null; on: number }>({ p: null, on: 0 });

/** Moves its children from +d to -d px while the section scrolls past. */
function Layer({ d, className, children }: { d: number; className?: string; children: React.ReactNode }) {
  const { p, on } = useContext(Depth);
  const still = useMotionValue(0);
  const y = useTransform(p ?? still, [0, 1], [d * on, -d * on]);
  return <motion.div style={{ y }} className={className}>{children}</motion.div>;
}

/* ---------------- Shared pieces ---------------- */

// Same palette people pick from in the room panel.
const PEOPLE = [
  { name: "Priya", color: "#5FD0A8", doing: "typing on line 8" },
  { name: "Mateo", color: "#7FB2F0", doing: "selected line 6" },
  { name: "Sam", color: "#E58FB4", doing: "reading the tests" },
];

const Card = ({ title, body, children }: { title: string; body: string; children: React.ReactNode }) => (
  <motion.article variants={rise} className="flex h-full min-w-0 flex-col rounded-[1.75rem] bg-[#141311] p-2 transition-colors duration-500 hover:bg-[#181715]">
    <div data-ui className="flex flex-1 flex-col overflow-hidden rounded-[1.375rem] bg-[#0c0b0a] p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:p-5">
      {/* The fragment drifts against the card: a second, smaller depth inside the first. */}
      <Layer d={-10} className="flex flex-1 flex-col">{children}</Layer>
    </div>
    <div className="px-4 pb-5 pt-6 sm:px-5">
      <h3 className="text-xl font-medium tracking-tight text-primary md:text-2xl">{title}</h3>
      <p className="mt-2 max-w-md text-base leading-relaxed text-primary/80">{body}</p>
    </div>
  </motion.article>
);

const Avatar = ({ name, color, ring = false }: { name: string; color: string; ring?: boolean }) => (
  <span
    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-ground ${ring ? "ring-2 ring-[#0c0b0a]" : ""}`}
    style={{ background: color }}
  >
    {name[0]}
  </span>
);

const Caret = ({ name, color }: { name: string; color: string }) => (
  <span className="relative ml-px inline-block h-[1.15em] w-[2px] translate-y-[0.22em]" style={{ background: color }}>
    <span className="absolute -top-[1.05rem] left-0 whitespace-nowrap rounded-[4px] rounded-bl-none px-1.5 py-px font-sans text-[10px] font-semibold leading-4 text-ground" style={{ background: color }}>
      {name}
    </span>
  </span>
);

const N = ({ n }: { n: number }) => <span className="inline-block w-7 select-none text-primary/30">{n}</span>;
const S = ({ children }: { children: React.ReactNode }) => <span className="text-[#F0A27F]">{children}</span>;
const K = ({ children }: { children: React.ReactNode }) => <span className="text-[#E58FB4]">{children}</span>;
const F = ({ children }: { children: React.ReactNode }) => <span className="text-[#7FB2F0]">{children}</span>;

/* ---------------- Presence ---------------- */

const TYPED = "monthly.idxmax())";

function PresenceCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduce = useReducedMotion();
  const [n, setN] = useState(TYPED.length);

  // Priya types the end of line 8 over and over, while the card is on screen.
  useEffect(() => {
    if (!inView || reduce) return;
    let tick = 0;
    const t = setInterval(() => { tick = (tick + 1) % (TYPED.length + 24); setN(Math.min(tick, TYPED.length)); }, 110);
    return () => clearInterval(t);
  }, [inView, reduce]);

  return (
    <Card
      title="Everyone's in the same file"
      body="See who's here, where they're typing and what they've selected. Edits merge as you type, so nobody asks who has the latest copy."
    >
      <div ref={ref} className="flex items-center justify-between">
        <span className="rounded-lg bg-white/[0.06] px-3 py-1.5 text-[13px] text-primary/80">main.py</span>
        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-2">
            {PEOPLE.map((p) => <Avatar key={p.name} {...p} ring />)}
          </div>
          <span className="text-[13px] text-primary/60">3 here</span>
        </div>
      </div>

      <pre className="mt-6 overflow-x-auto pt-3 font-mono text-[12.5px] leading-[2] text-primary/75 [scrollbar-width:none] sm:text-[13.5px]">
        <code>
          <N n={1} /><K>import</K> pandas <K>as</K> pd{"\n"}
          <N n={2} /><K>import</K> matplotlib.pyplot <K>as</K> plt{"\n"}
          <N n={3} />plt.style.use(<S>&quot;dark_background&quot;</S>){"\n"}
          <N n={4} />{"\n"}
          <N n={5} />orders = pd.read_csv(<S>&quot;orders.csv&quot;</S>)<Caret {...PEOPLE[2]} />{"\n"}
          <N n={6} />monthly = orders.<span className="rounded-[3px] bg-[#7FB2F0]/25 text-primary">groupby(<S>&quot;month&quot;</S>, sort=<K>False</K>)</span>
          <Caret {...PEOPLE[1]} />[<S>&quot;units&quot;</S>].sum(){"\n"}
          <N n={7} /><F>print</F>(<S>&quot;Total units:&quot;</S>, monthly.sum()){"\n"}
          <N n={8} /><F>print</F>(<S>&quot;Best month:&quot;</S>, {TYPED.slice(0, n)}<Caret {...PEOPLE[0]} />{"\n"}
          <N n={9} />colors = [<S>&quot;#57564E&quot;</S>] * <F>len</F>(monthly){"\n"}
          <N n={10} />colors[monthly.argmax()] = <S>&quot;#F0A27F&quot;</S>{"\n"}
          <N n={11} />ax = monthly.plot.bar(title=<S>&quot;Units by month&quot;</S>, rot=<F>0</F>, color=colors){"\n"}
          <N n={12} />ax.spines[[<S>&quot;top&quot;</S>, <S>&quot;right&quot;</S>]].set_visible(<K>False</K>){"\n"}
          <N n={13} />ax.bar_label(ax.containers[<F>0</F>]){"\n"}
          <N n={14} />plt.show()
        </code>
      </pre>

      <ul className="mt-auto grid gap-2 pt-6 sm:grid-cols-3">
        {PEOPLE.map((p) => (
          <li key={p.name} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] p-3">
            <Avatar {...p} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[14px] font-medium text-primary">
                {p.name}
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#5FD0A8]" />
              </span>
              <span className="block truncate text-[12px] text-primary/55">{p.doing}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------- Run ---------------- */

// What the code in the presence card prints and plots: 963 units in total, June the best month.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const UNITS = [118, 142, 131, 166, 150, 256];

/** Drawn the way matplotlib draws the presence card's code (dark_background, two colours, no top/right spines). */
function Figure() {
  const [x0, x1, top, base] = [52, 436, 40, 248];
  const yScale = (base - top) / (Math.max(...UNITS) * 1.05);
  const slot = (x1 - x0) / UNITS.length;
  const y = (v: number) => base - v * yScale;
  const best = UNITS.indexOf(Math.max(...UNITS));
  const ink = "#E1E0CC";
  const txt = { fontFamily: "DejaVu Sans, Verdana, sans-serif", fontSize: 10, fill: ink };
  return (
    <svg viewBox="0 0 450 290" className="w-full rounded-xl bg-[#060605]" role="img" aria-label="Bar chart titled Units by month: Jan 118, Feb 142, Mar 131, Apr 166, May 150, Jun 256, June highlighted">
      <text x={(x0 + x1) / 2} y={24} textAnchor="middle" {...txt} fontSize={12}>Units by month</text>
      {[0, 50, 100, 150, 200, 250].map((t) => (
        <g key={t}>
          <line x1={x0 - 3.5} x2={x0} y1={y(t)} y2={y(t)} stroke={ink} strokeOpacity={0.6} strokeWidth={0.8} />
          <text x={x0 - 6} y={y(t) + 3.5} textAnchor="end" {...txt} fillOpacity={0.7}>{t}</text>
        </g>
      ))}
      {UNITS.map((v, i) => {
        const cx = x0 + slot * (i + 0.5);
        return (
          <g key={i}>
            <rect x={cx - slot / 4} y={y(v)} width={slot / 2} height={v * yScale} fill={i === best ? "#F0A27F" : "#57564E"} />
            <text x={cx} y={y(v) - 5} textAnchor="middle" {...txt} fill={i === best ? "#F0A27F" : ink}>{v}</text>
            <line x1={cx} x2={cx} y1={base} y2={base + 3.5} stroke={ink} strokeOpacity={0.6} strokeWidth={0.8} />
            <text x={cx} y={base + 15} textAnchor="middle" {...txt} fillOpacity={0.7}>{MONTHS[i]}</text>
          </g>
        );
      })}
      <path d={`M${x0} ${top}V${base}H${x1}`} fill="none" stroke={ink} strokeOpacity={0.6} strokeWidth={0.8} />
      <text x={(x0 + x1) / 2} y={base + 32} textAnchor="middle" {...txt} fillOpacity={0.7}>month</text>
    </svg>
  );
}

function RunCard() {
  return (
    <Card title="One Run, same output for everyone" body="Press Run once and the whole room sees the output, the exit code and every plt.show() chart. No more pasting terminal output into chat.">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-primary/60">main.py · Python 3.14</span>
        <span className="flex items-center gap-2 rounded-full bg-primary py-1 pl-3.5 pr-1 text-[13px] font-medium text-ground">
          Run
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ground">
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-primary" aria-hidden><path d="M2 1l7 4-7 4z" /></svg>
          </span>
        </span>
      </div>
      <pre className="mt-5 font-mono text-[12.5px] leading-6 text-primary/85">Total units: {UNITS.reduce((a, b) => a + b)}{"\n"}Best month: Jun</pre>
      <div className="mt-3"><Figure /></div>
      <p className="mt-3 flex flex-wrap gap-x-2 text-[12px] text-primary/55">
        <span className="text-[#5FD0A8]">Exited 0</span><span>0.21 s</span><span>figure-1.png, 450 × 300</span><span>run by Priya</span>
      </p>
    </Card>
  );
}

/* ---------------- Tests ---------------- */

const TESTS = [
  { name: "Test 1", ok: true, note: "0.04 s" },
  { name: "Test 2", ok: true, note: "0.05 s" },
  { name: "Test 3", ok: false, note: "differs at line 2" },
];

function TestsCard() {
  return (
    <Card title="Tests that settle arguments" body="Write an input and the output you expect, run them all and see the first line that differs. The program decides who was right.">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium text-primary">2 of 3 passed</span>
        <span className="flex gap-1.5">
          {TESTS.map((t) => <span key={t.name} className={`h-2 w-2 rounded-full ${t.ok ? "bg-[#5FD0A8]" : "bg-[#FF8A7A]"}`} />)}
        </span>
      </div>
      <ul className="mt-5 grid gap-2">
        {TESTS.map((t) => (
          <li key={t.name} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-[13px]">
            <span className="text-primary/85">{t.name}</span>
            <span className="flex items-center gap-3">
              <span className="text-primary/50">{t.note}</span>
              <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] ${t.ok ? "bg-[#5FD0A8]/[0.12] text-[#8FE3C4]" : "bg-[#FF8A7A]/[0.12] text-[#FFB4A8]"}`}>
                {t.ok ? "Passed" : "Wrong answer"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-5 whitespace-pre rounded-xl bg-[#FF8A7A]/[0.06] p-3.5 font-mono text-[12px] leading-5">
        <p className="text-primary/50">Test 3, line 2</p>
        <p className="text-[#8FE3C4]">expected  You typed: Robert</p>
        <p className="text-[#FFB4A8]">got       You typed: Bob</p>
      </div>
    </Card>
  );
}

/* ---------------- Web ---------------- */

// Each file is text with live slots; a slot belongs to one person, who keeps retyping its value.
type Slot = { who: number; values: readonly string[]; offset: number };
type WebFile = { key: "html" | "css" | "js"; label: string; parts: (string | Slot)[] };
type WebKey = WebFile["key"];

const WEB: WebFile[] = [
  {
    key: "html", label: "index.html",
    parts: ['<div id="blob"><i></i><i></i></div>\n<button id="pat">', { who: 2, values: ["Pat the blob", "Boop", "Say hi"], offset: 46 }, '</button>\n<p id="mood"></p>'],
  },
  {
    key: "css", label: "style.css",
    parts: [
      "body {\n  display: grid; place-items: center;\n  height: 100vh; margin: 0; gap: 12px;\n  background: #FBF3EA; font: 14px system-ui;\n}\n#blob {\n  width: 90px; height: 76px;\n  border-radius: ",
      { who: 1, values: ["50% 50% 42% 42%", "40%", "50% 50% 22% 22%"], offset: 20 },
      // A line between the two slots, so Priya's and Mateo's name flags never cover each other.
      ";\n  display: flex; justify-content: center;\n  background: ",
      { who: 0, values: ["#F0A27F", "#7FB2F0", "#5FD0A8", "#E58FB4"], offset: 0 },
      ";\n  gap: 16px; padding-top: 26px;\n  box-sizing: border-box; transition: scale .3s;\n}\n#blob i {\n  width: 9px; height: 13px; background: #111;\n  border-radius: 9px;\n  animation: blink 3s steps(1) infinite;\n}\n@keyframes blink { 97% { height: 2px } }\nbutton {\n  border: 0; border-radius: 99px; color: #fff;\n  padding: 8px 16px; background: #111;\n}",
    ],
  },
  {
    key: "js", label: "script.js",
    parts: ["let pats = 0;\nmood.textContent = \"Hi, I'm Blob\";\npat.onclick = () => {\n  blob.style.scale = 1 + (++pats % 5) / 10;\n  mood.textContent = `Pats: ${pats}`;\n};"],
  },
];
const LANG = { html: "html", css: "css", js: "js" } as const;
const TONE = { k: "text-[#E58FB4]", f: "text-[#7FB2F0]", s: "text-[#F0A27F]" };
const CODE = "m-0 whitespace-pre p-4 pt-7 font-mono text-[12px] leading-[2]";

/** Highlighted code with other people's carets placed at their offsets. */
function Highlighted({ code, lang, carets }: { code: string; lang: Lang; carets: { at: number; who: number }[] }) {
  const out: React.ReactNode[] = [];
  const marks = [...carets].sort((a, b) => a.at - b.at);
  let pos = 0, m = 0, key = 0;
  for (const tk of tokens(code, lang)) {
    let t = tk.t, start = pos;
    while (m < marks.length && marks[m].at <= start + t.length) {
      const cut = marks[m].at - start;
      if (cut > 0) out.push(<span key={key++} className={tk.c && TONE[tk.c]}>{t.slice(0, cut)}</span>);
      out.push(<Caret key={key++} {...PEOPLE[marks[m].who]} />);
      t = t.slice(cut); start += cut; m++;
    }
    if (t) out.push(<span key={key++} className={tk.c && TONE[tk.c]}>{t}</span>);
    pos += tk.t.length;
  }
  for (; m < marks.length; m++) out.push(<Caret key={key++} {...PEOPLE[marks[m].who]} />);
  return <>{out}</>;
}

function WebCard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<WebKey>("css");
  const [tick, setTick] = useState(0);
  const [mine, setMine] = useState<Record<WebKey, string> | null>(null); // set once the visitor takes over

  useEffect(() => {
    if (!inView || reduce || mine) return;
    const t = setInterval(() => setTick((n) => n + 1), 85);
    return () => clearInterval(t);
  }, [inView, reduce, mine]);

  // Start each slot mid-hold, so the first frame shows finished code.
  const slot = (s: Slot) => (reduce ? { typed: s.values[0], done: s.values[0] } : typing(tick + s.values[0].length + s.offset, s.values));
  const text = (f: WebFile, which: "typed" | "done") => (mine ? mine[f.key] : f.parts.map((p) => (typeof p === "string" ? p : slot(p)[which])).join(""));
  const file = WEB.find((f) => f.key === tab)!;
  const code = text(file, "typed");
  const carets: { at: number; who: number }[] = [];
  if (!mine) file.parts.reduce((at, p) => {
    if (typeof p === "string") return at + p.length;
    const typed = slot(p).typed;
    carets.push({ at: at + typed.length, who: p.who });
    return at + typed.length;
  }, 0);

  // The preview takes whole words only (or the visitor's edits), shortly after they land.
  const doc = buildSrcDoc(text(WEB[0], "done"), text(WEB[1], "done"), text(WEB[2], "done"));
  const [srcDoc, setSrcDoc] = useState(doc);
  useEffect(() => {
    const t = setTimeout(() => setSrcDoc(doc), 250);
    return () => clearTimeout(t);
  }, [doc]);

  return (
    <Card
      title="HTML, CSS and JS, previewed as you type"
      body="Web rooms give everyone the same three files and a preview that redraws as they type. Click into the code to take over from Priya and Mateo."
    >
      <div ref={ref} className="grid flex-1 gap-3 md:grid-cols-[1.15fr_1fr]">
        <div className="flex min-w-0 flex-col">
          <div role="tablist" aria-label="Files" className="flex gap-1">
            {WEB.map((f) => {
              const here = mine ? [] : f.parts.filter((p): p is Slot => typeof p !== "string");
              return (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={tab === f.key}
                  onClick={() => setTab(f.key)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-300 ${tab === f.key ? "bg-white/[0.08] text-primary" : "text-primary/50 hover:text-primary/80"}`}
                >
                  {f.label}
                  {here.map((p) => <span key={p.who} aria-hidden className="h-2 w-2 rounded-full" style={{ background: PEOPLE[p.who].color }} />)}
                </button>
              );
            })}
          </div>
          {/* A transparent textarea over the highlighted code: it looks like a code view and types like an editor. */}
          <div data-lenis-prevent className="mt-2 h-[17.5rem] overflow-auto rounded-xl bg-white/[0.03] transition-[box-shadow] duration-300 [scrollbar-color:rgba(225,224,204,0.2)_transparent] [scrollbar-width:thin] focus-within:ring-2 focus-within:ring-[#7FB2F0]/40">
            <div className="relative w-max min-w-full">
              <pre aria-hidden className={`${CODE} text-primary/80`}><Highlighted code={code} lang={LANG[tab]} carets={carets} />{"\n"}</pre>
              <textarea
                aria-label={`Edit ${file.label}`}
                spellCheck={false}
                wrap="off"
                value={code}
                onFocus={() => setMine((m) => m ?? (Object.fromEntries(WEB.map((f) => [f.key, text(f, "typed")])) as Record<WebKey, string>))}
                onChange={(e) => setMine((m) => ({ ...m!, [tab]: e.target.value }))}
                className={`${CODE} absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-primary outline-none selection:bg-[#7FB2F0]/30`}
              />
            </div>
          </div>
        </div>
        <div className="flex h-[17.5rem] flex-col overflow-hidden rounded-xl bg-white md:h-auto">
          <div className="flex items-center gap-2 bg-[#f1f0ea] px-3 py-2 text-[12px] text-black/55">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2fb37f]" aria-hidden />
            Live preview
          </div>
          {/* No allow-same-origin: the visitor's code runs in an opaque origin and cannot touch this page. */}
          <iframe title="Live preview" sandbox="allow-scripts" srcDoc={srcDoc} className="w-full flex-1 border-0" />
        </div>
      </div>
    </Card>
  );
}

/* ---------------- Section ---------------- */

export function Features() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const depth = { p: scrollYProgress, on: reduce || !wide ? 0 : 1 };

  // Big cards travel slowly, small ones fast. Cards stacked over each other differ by at most 30 px over
  // the whole pass, so the 32 px row gap means they never touch.
  return (
    <Depth.Provider value={depth}>
      <section ref={ref} id="features" aria-labelledby="together" className="px-4 py-20 sm:px-6 md:px-10 md:pb-16 md:pt-28">
        <Layer d={40}>
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.4 }} variants={stagger}>
            <motion.h2 id="together" variants={rise} className="max-w-5xl text-[clamp(2.25rem,6vw,5.5rem)] font-medium leading-[0.95] tracking-[-0.05em] text-primary">
              Pair programming, minus the elbows.
            </motion.h2>
            <motion.p variants={rise} className="mt-6 max-w-xl text-base leading-relaxed text-primary/80 md:text-lg">
              Open a room, send the link, and code with whoever opens it. No accounts, no installs, no &ldquo;can you see my screen?&rdquo;
            </motion.p>
          </motion.div>
        </Layer>

        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.1 }}
          variants={stagger}
          className="mt-12 grid gap-4 md:mt-16 lg:grid-cols-12 lg:gap-x-4 lg:gap-y-8"
        >
          <Layer d={25} className="min-w-0 lg:col-span-7"><PresenceCard /></Layer>
          <Layer d={55} className="min-w-0 lg:col-span-5"><RunCard /></Layer>
          <Layer d={55} className="min-w-0 lg:col-span-4"><TestsCard /></Layer>
          <Layer d={25} className="min-w-0 lg:col-span-8"><WebCard /></Layer>
        </motion.div>
      </section>
    </Depth.Provider>
  );
}

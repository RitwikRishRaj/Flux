"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ArrowRight, Check, Link2, MousePointer2, Palette, Plus, RefreshCw, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Mode = "create" | "join";

export interface RoomEntry {
  mode: Mode;
  id: string;
  room: string;
  user: { id: string; name: string; color: string };
}

const COLORS = ["#5FD0A8", "#7FB2F0", "#F0A27F", "#E58FB4"];
const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ease = [0.32, 0.72, 0, 1] as const;

const makeId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
};

// Accepts a bare ID or a full room link, so pasting either just works.
const parseId = (raw: string) => raw.trim().split(/[/?#]/).filter(Boolean).pop() ?? "";
const ID_RE = /^[A-Za-z0-9]{6,32}$/;

const inputCls =
  "h-11 w-full rounded-full bg-black/30 px-5 text-[15px] text-white placeholder:text-white/65 outline-none " +
  "ring-1 ring-inset ring-white/25 transition-[box-shadow,background-color] duration-300 " +
  "focus:bg-black/40 focus:ring-2 focus:ring-white/70";

/** SVG lens used by .liquid-glass in Chromium: bends whatever is behind the panel. */
const LiquidFilter = () => (
  <svg width="0" height="0" className="absolute" aria-hidden>
    <filter id="flux-liquid" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.01" numOctaves="2" seed="7" result="noise" />
      <feGaussianBlur in="noise" stdDeviation="3" result="soft" />
      <feDisplacementMap in="SourceGraphic" in2="soft" scale="46" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);

export function RoomPanel({ onEnter }: { onEnter: (entry: RoomEntry) => void }) {
  const [mode, setMode] = useState<Mode>("create");
  const [roomId, setRoomId] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<"name" | "room" | null>(null);
  const [lens, setLens] = useState(false);
  const isCustom = !COLORS.includes(color);
  const nameRef = useRef<HTMLInputElement>(null);
  const joinRef = useRef<HTMLInputElement>(null);

  // Generated on the client to avoid a hydration mismatch; name and colour are remembered.
  useEffect(() => {
    setRoomId(makeId());
    try {
      const savedId = localStorage.getItem("flux-id");
      const savedName = localStorage.getItem("flux-name");
      const savedColor = localStorage.getItem("flux-color");
      const id = savedId || crypto.randomUUID();
      if (!savedId) localStorage.setItem("flux-id", id);
      setName(savedName ?? "");
      setColor(savedColor ?? COLORS[0]);
    } catch {
      // localStorage blocked: use in-memory fallback
    }
    // SVG backdrop filters only work in Chromium; others get plain frosted glass.
    setLens(/Chrome\//.test(navigator.userAgent) && !/OPR\//.test(navigator.userAgent));
  }, []);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/room/${roomId}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the ID stays visible and selectable */
    }
  }, [roomId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim().slice(0, 24);
    const parsedRoomId = mode === "create" ? roomId : parseId(joinInput);
    if (mode === "join" && !ID_RE.test(parsedRoomId)) return setError("room"), joinRef.current?.focus();
    if (!cleanName) return setError("name"), nameRef.current?.focus();
    try {
      localStorage.setItem("flux-name", cleanName);
      localStorage.setItem("flux-color", color);
    } catch { /* blocked */ }
    const userId = (() => {
      try { return localStorage.getItem("flux-id") || crypto.randomUUID(); }
      catch { return crypto.randomUUID(); }
    })();
    onEnter({ mode, id: userId, room: parsedRoomId, user: { id: userId, name: cleanName, color } });
  };

  const tabs: { key: Mode; label: string }[] = [
    { key: "create", label: "Create room" },
    { key: "join", label: "Join room" },
  ];

  return (
    <>
      <LiquidFilter />
      <motion.form
        onSubmit={submit}
        noValidate
        data-lens={lens || undefined}
        aria-label="Create or join a room"
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.45, ease }}
        className="liquid-glass w-full rounded-[2rem] p-6 text-white sm:p-7"
      >
        <LayoutGroup>
          <div role="tablist" className="relative mb-5 grid h-11 grid-cols-2 rounded-full bg-black/40 p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={mode === t.key}
                onClick={() => {
                  setMode(t.key);
                  setError(null);
                  setTimeout(() => (t.key === "create" ? nameRef : joinRef).current?.focus(), 80);
                }}
                className={`relative z-10 rounded-full text-sm font-medium transition-colors duration-300 ${
                  mode === t.key ? "text-black [text-shadow:none]" : "text-white/85 hover:text-white"
                }`}
              >
                {mode === t.key && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                {t.label}
              </button>
            ))}
          </div>
        </LayoutGroup>

        <p className="text-[15px] leading-snug text-white/95">
          {mode === "create"
            ? "Your room is ready. Share the link, then step in."
            : "Paste a room link or ID from your teammate."}
        </p>

        {/* Room: the code is the focal point */}
        <div className="mt-4">
          <AnimatePresence mode="wait" initial={false}>
            {mode === "create" ? (
              <motion.div
                key="c"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease }}
                className="flex items-stretch gap-2"
              >
                <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-full bg-black/30 pl-5 pr-1 ring-1 ring-inset ring-white/25">
                  <span
                    className="min-w-0 flex-1 select-all truncate font-mono text-[17px] font-medium leading-none tracking-wide"
                    aria-label="Room ID"
                  >
                    {roomId}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRoomId(makeId())}
                    aria-label="Generate a new room ID"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/85 transition-all duration-300 hover:bg-white/15 hover:text-white active:scale-95"
                  >
                    <RefreshCw className="h-[18px] w-[18px]" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-black/30 px-5 text-[15px] font-medium ring-1 ring-inset ring-white/25 transition-all duration-300 hover:bg-black/45 active:scale-[0.97]"
                >
                  {copied ? <Check className="h-[18px] w-[18px] text-[#5FD0A8]" /> : <Link2 className="h-[18px] w-[18px]" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="j"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease }}
              >
                <input
                  ref={joinRef}
                  value={joinInput}
                  onChange={(e) => {
                    setJoinInput(e.target.value);
                    setError(null);
                  }}
                  placeholder="Room link or ID"
                  aria-label="Room link or ID"
                  aria-invalid={error === "room"}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 w-full rounded-full bg-black/30 px-5 font-mono text-[17px] text-white outline-none ring-1 ring-inset ring-white/25 transition-[box-shadow,background-color] duration-300 placeholder:font-sans placeholder:text-[15px] placeholder:text-white/65 focus:bg-black/40 focus:ring-2 focus:ring-white/70"
                />
                {error === "room" && (
                  <p role="alert" className="mt-2 text-[13px] font-medium text-[#FFC9A8]">
                    That doesn&rsquo;t look like a room ID. Check the link and try again.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <label htmlFor="flux-name" className="mt-5 flex items-center gap-2.5 text-[15px] font-medium">
          <User className="h-5 w-5 text-white/75" /> Your name
        </label>
        <input
          id="flux-name"
          ref={nameRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={24}
          placeholder="How should others see you?"
          autoComplete="nickname"
          aria-invalid={error === "name"}
          className={`${inputCls} mt-2`}
        />
        {error === "name" && (
          <p role="alert" className="mt-2 text-[13px] font-medium text-[#FFC9A8]">
            Add a name so your teammates know who&rsquo;s typing.
          </p>
        )}

        {/* Colour: equal 36px circles, one selected state (check + ring) */}
        <div className="mt-5 flex items-center gap-2.5 text-[15px] font-medium">
          <Palette className="h-5 w-5 text-white/75" /> Your colour
        </div>
        <div role="radiogroup" aria-label="Your colour" className="mt-3 flex items-center gap-4 px-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className="relative flex h-9 w-9 items-center justify-center rounded-full transition-transform duration-300 active:scale-90"
              style={{ backgroundColor: c }}
            >
              {color === c && (
                <>
                  <motion.span
                    layoutId="swatch-ring"
                    className="absolute -inset-[5px] rounded-full ring-2 ring-white"
                    transition={{ type: "spring", stiffness: 420, damping: 30 }}
                  />
                  <Check className="h-[18px] w-[18px] text-black/75" strokeWidth={3} />
                </>
              )}
            </button>
          ))}
          {/* Custom: the native picker sits invisibly on top of a spectrum circle */}
          <label
            className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-transform duration-300 active:scale-90"
            style={{
              background: isCustom
                ? color
                : "conic-gradient(from 90deg, #f87171, #fbbf24, #a3e635, #34d399, #38bdf8, #a78bfa, #f472b6, #f87171)",
            }}
            title="Pick any colour"
          >
            {isCustom ? (
              <>
                <motion.span
                  layoutId="swatch-ring"
                  className="absolute -inset-[5px] rounded-full ring-2 ring-white"
                  transition={{ type: "spring", stiffness: 420, damping: 30 }}
                />
                <Check className="h-[18px] w-[18px] text-black/75" strokeWidth={3} />
              </>
            ) : (
              <Plus className="h-[18px] w-[18px] text-black/70" strokeWidth={3} />
            )}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              aria-label="Pick a custom colour"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>

        {/* Footer: live preview in the chosen colour on the left, the main action on the right */}
        <div className="mt-6 flex items-center justify-between gap-4">
          <div
            aria-hidden
            title="How teammates will see you"
            className="pointer-events-none inline-flex h-10 max-w-[52%] select-none items-center gap-2 rounded-full px-4 text-sm font-semibold text-black transition-colors duration-500 [text-shadow:none]"
            style={{ backgroundColor: color }}
          >
            <MousePointer2 className="h-4 w-4 shrink-0 fill-black/80 stroke-black/80" />
            <span className="truncate">{name.trim() || "You"}</span>
          </div>
          <button
            type="submit"
            className="group inline-flex h-14 shrink-0 items-center gap-4 rounded-full bg-primary pl-7 pr-1.5 text-base font-semibold text-black transition-transform duration-300 active:scale-[0.97] [text-shadow:none]"
          >
            {mode === "create" ? "Create" : "Join"}
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black transition-transform duration-500 group-hover:translate-x-0.5 group-hover:scale-105">
              <ArrowRight className="h-[18px] w-[18px] text-primary" />
            </span>
          </button>
        </div>
      </motion.form>
    </>
  );
}

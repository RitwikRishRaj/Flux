"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { COMPILERS, type Compiler, type CompilerId } from "@/lib/compilers";

// Matches label, version or id ("node" finds JavaScript; "cpp" won't find C++, but "c++" and "g++" do).
const matches = (c: Compiler, q: string) => !q || c.label.toLowerCase().includes(q) || c.version.toLowerCase().includes(q) || c.id.includes(q);

// A combobox (ARIA 1.2 pattern): focus stays in the search box, arrows move the active option, Enter picks it.
export function LanguagePicker({ value, onChange }: { value: CompilerId; onChange: (id: CompilerId) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const current = COMPILERS.find(c => c.id === value) ?? COMPILERS[0];

  const q = query.trim().toLowerCase();
  const results = useMemo(() => COMPILERS.filter(c => matches(c, q)), [q]);
  const groups = useMemo(() => [...new Set(results.map(c => c.group))], [results]);

  const show = () => { setQuery(""); setActive(Math.max(0, COMPILERS.indexOf(current))); setOpen(true); };
  const close = (refocus = true) => { setOpen(false); if (refocus) buttonRef.current?.focus(); };
  const pick = (c: Compiler | undefined) => { if (c) { if (c.id !== value) onChange(c.id); close(); } };

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active, open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) close(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const last = results.length - 1;
    const move: Record<string, number> = { ArrowDown: Math.min(active + 1, last), ArrowUp: Math.max(active - 1, 0), Home: 0, End: last, PageDown: Math.min(active + 8, last), PageUp: Math.max(active - 8, 0) };
    if (e.key in move) { e.preventDefault(); setActive(Math.max(0, move[e.key])); }
    else if (e.key === "Enter") { e.preventDefault(); pick(results[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Language: ${current.label} ${current.version}`}
        onClick={() => (open ? close() : show())}
        onKeyDown={e => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); } }}
        className="flex h-9 items-center gap-1.5 rounded-full pl-3 pr-2 sm:pl-4 sm:pr-2.5 text-sm font-medium text-primary outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.06]"
      >
        {current.label}
        <span className="hidden font-normal text-primary/45 md:inline">{current.version}</span>
        <ChevronDown className={`h-4 w-4 text-primary/50 transition-transform duration-300 ${open ? "rotate-180" : ""}`} strokeWidth={1.5} />
      </button>

      {open && (
        <div className="fixed inset-x-3 top-[4.25rem] z-50 overflow-hidden sm:absolute sm:inset-x-auto sm:left-0 sm:top-11 sm:w-72 rounded-2xl bg-[#121211] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/[0.08]">
          <label className="flex items-center gap-2 border-b border-white/[0.06] px-3.5">
            <Search className="h-4 w-4 shrink-0 text-primary/40" strokeWidth={1.5} aria-hidden />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Search languages"
              aria-expanded
              aria-controls={`${uid}-list`}
              aria-autocomplete="list"
              aria-activedescendant={results[active] ? `${uid}-${results[active].id}` : undefined}
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={onKey}
              placeholder="Search 48 languages"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full bg-transparent text-sm text-primary outline-none placeholder:text-primary/35"
            />
          </label>

          <div ref={listRef} id={`${uid}-list`} role="listbox" aria-label="Languages" className="max-h-[min(22rem,60dvh)] overflow-y-auto overscroll-contain p-1.5 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]">
            {results.length === 0 && <p className="px-3 py-6 text-center text-sm text-primary/40">No language matches “{query.trim()}”</p>}
            {groups.map(g => (
              <div key={g} role="group" aria-labelledby={`${uid}-g-${g}`}>
                <div id={`${uid}-g-${g}`} className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.08em] text-primary/35">{g}</div>
                {results.map((c, i) => c.group !== g ? null : (
                  <div
                    key={c.id}
                    id={`${uid}-${c.id}`}
                    data-index={i}
                    role="option"
                    aria-selected={c.id === value}
                    onPointerMove={() => setActive(i)}
                    onClick={() => pick(c)}
                    className={`flex h-9 cursor-pointer items-center justify-between rounded-xl px-2.5 text-sm ${i === active ? "bg-white/[0.07] text-primary" : "text-primary/75"}`}
                  >
                    <span>{c.label}</span>
                    <span className="ml-auto flex items-center gap-2 pl-3 text-[12px] text-primary/40">
                      {c.version}
                      <span className={`h-1.5 w-1.5 rounded-full ${c.id === value ? "bg-primary" : ""}`} aria-hidden />
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

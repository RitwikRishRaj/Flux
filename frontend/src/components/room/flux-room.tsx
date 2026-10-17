"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type * as monacoNS from "monaco-editor";
import * as Y from "yjs";
import { motion } from "framer-motion";
import { ArrowLeft, Check, ChevronDown, Link2, Loader2, Play, SquareTerminal, FlaskConical, Terminal } from "lucide-react";
import { COMPILERS, byId, type CompilerId, type RunResult } from "@/lib/compilers";
import { FLUX_THEME } from "@/lib/flux-monaco";
import { connect } from "@/lib/party";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-primary/40">Loading editor…</div>,
});

type Tab = "output" | "input" | "tests";
const EASE = [0.32, 0.72, 0, 1] as const;

export interface RoomUser { name: string; color: string }

export function FluxRoom({ id, user }: { id: string; user: RoomUser }) {
  const [compilerId, setCompilerId] = useState<CompilerId>("python-3.14");
  const compiler = byId(compilerId);
  const [code, setCode] = useState(compiler.hello as string);
  const [stdin, setStdin] = useState("");
  const [tab, setTab] = useState<Tab>("output");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<Array<{ name: string; color: string }>>([]);
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monacoNS.editor.ITextModel | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const roomStateRef = useRef<Y.Map<string> | null>(null);
  const awarenessRef = useRef<any>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (disconnectRef.current) disconnectRef.current();
    };
  }, [id]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setNetErr(null);
    setTab("output");
    try {
      const res = await fetch("/api/backend/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compiler: compilerId, code: editorRef.current?.getValue() ?? code, input: stdin }),
      });
      const data = (await res.json()) as RunResult & { error?: string };
      if (!res.ok) setNetErr(data.error ?? `Request failed (${res.status})`);
      else setResult(data);
    } catch {
      setNetErr("Could not reach backend on :8787");
    } finally {
      setRunning(false);
    }
  };
  const runRef = useRef(run);
  runRef.current = run;

  const switchLanguage = (cid: CompilerId) => {
    setCompilerId(cid);
    setCode(byId(cid).hello as string);
    // Sync language to other users
    if (roomStateRef.current) {
      roomStateRef.current.set("compilerId", cid);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* blocked */ }
  };

  const outputText = result
    ? result.error
      ? (result.output ? result.output + "\n" : "") + result.error
      : result.output || "(no output)"
    : null;
  const failed = !!result && result.exit_code !== 0;

  const tabs: { key: Tab; label: string; icon: typeof Terminal }[] = [
    { key: "output", label: "Output", icon: SquareTerminal },
    { key: "input", label: "Input", icon: Terminal },
    { key: "tests", label: "Tests", icon: FlaskConical },
  ];

  return (
    <main className="flex h-[100dvh] flex-col gap-2 bg-ground p-2 text-primary md:p-3">
      <header className="flex h-14 shrink-0 items-center gap-2 rounded-full bg-white/[0.03] px-3 ring-1 ring-inset ring-white/[0.08] md:px-4">
        <a href="/" aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full text-primary/60 transition-colors duration-300 hover:bg-white/[0.06] hover:text-primary active:scale-95">
          <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={1.5} />
        </a>
        <span className="hidden font-mono text-[13px] text-primary/50 sm:block">/{id}</span>

        <div className="relative ml-1">
          <select value={compilerId} onChange={e => switchLanguage(e.target.value as CompilerId)} aria-label="Language" className="h-9 appearance-none rounded-full bg-transparent pl-4 pr-8 text-sm font-medium text-primary outline-none transition-colors hover:bg-white/[0.06] focus:bg-white/[0.06]">
            {COMPILERS.map(c => <option key={c.id} value={c.id} className="bg-ground">{c.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/50" strokeWidth={1.5} />
        </div>

        <div className="flex-1" />

        {/* Remote users */}
        {remoteUsers.map((u, i) => (
          <div key={i} title={u.name} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-black" style={{ backgroundColor: u.color }}>
            <span className="max-w-24 truncate">{u.name}</span>
          </div>
        ))}

        <div title={`${user.name} (you)`} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-black" style={{ backgroundColor: user.color }}>
          <span className="max-w-24 truncate">{user.name || "You"}</span>
        </div>

        <button type="button" onClick={copyLink} className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium text-primary/70 transition-all duration-300 hover:bg-white/[0.06] hover:text-primary active:scale-[0.97]">
          {copied ? <Check className="h-4 w-4 text-[#5FD0A8]" strokeWidth={1.5} /> : <Link2 className="h-4 w-4" strokeWidth={1.5} />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Share"}</span>
        </button>

        <button type="button" onClick={run} disabled={running} className="group inline-flex h-10 items-center gap-3 rounded-full bg-primary pl-5 pr-1.5 text-sm font-semibold text-black transition-all duration-300 active:scale-[0.97] disabled:opacity-60">
          {running ? "Running" : "Run"}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black transition-transform duration-500 group-hover:scale-105">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" strokeWidth={1.5} /> : <Play className="h-3.5 w-3.5 fill-primary text-primary" strokeWidth={1.5} />}
          </span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:flex-row">
        <div className="min-h-0 flex-1 rounded-[1.6rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.08]">
          <div className="flex h-full flex-col overflow-hidden rounded-[calc(1.6rem-0.375rem)] bg-[#0B0B0A]">
            <div className="flex h-10 shrink-0 items-center px-4">
              <span className="font-mono text-[13px] text-primary/50">{compiler.file}</span>
            </div>
            <div className="min-h-[16rem] flex-1">
              <Editor
                language={compiler.monaco}
                value={code}
                onChange={v => setCode(v ?? "")}
                onMount={(editor, monaco) => {
                  editorRef.current = editor;
                  modelRef.current = editor.getModel();
                  monaco.editor.defineTheme("flux", FLUX_THEME);
                  monaco.editor.setTheme("flux");
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
                  if (!disconnectRef.current && modelRef.current) {
                    const [disconnect, { getRoomState, getAwareness }] = connect(id, editor, modelRef.current, user, monaco);
                    disconnectRef.current = disconnect;
                    roomStateRef.current = getRoomState();
                    awarenessRef.current = getAwareness();

                    // Listen for language changes from other users
                    roomStateRef.current.observe(() => {
                      const newCompilerId = roomStateRef.current?.get("compilerId");
                      if (newCompilerId && newCompilerId !== compilerId && COMPILERS.some(c => c.id === newCompilerId)) {
                        setCompilerId(newCompilerId as CompilerId);
                      }
                    });

                    // Listen for awareness changes (remote users)
                    awarenessRef.current.on("change", () => {
                      const entries = Array.from(awarenessRef.current.getStates().entries()) as [number, { user: { name: string; color: string } }][];
                      const users = entries
                        .filter(([id]) => id !== awarenessRef.current.clientID)
                        .map(([, state]) => state.user);
                      setRemoteUsers(users);
                    });
                  }
                }}
                options={{
                  fontSize: 14,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  minimap: { enabled: false },
                  padding: { top: 4, bottom: 16 },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorBlinking: "smooth",
                  cursorSmoothCaretAnimation: "on",
                  renderLineHighlight: "line",
                  stickyScroll: { enabled: false },
                }}
              />
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col lg:w-[400px] xl:w-[440px]">
          <div className="flex min-h-0 flex-1 flex-col rounded-[1.6rem] bg-white/[0.03] ring-1 ring-inset ring-white/[0.08]">
            <div className="flex h-12 shrink-0 items-end gap-1 px-2">
              {tabs.map(t => (
                <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`flex h-10 items-center gap-2 rounded-t-xl px-4 text-sm font-medium transition-colors duration-300 ${tab === t.key ? "bg-white/[0.05] text-primary" : "text-primary/50 hover:text-primary"}`}>
                  <t.icon className="h-4 w-4" strokeWidth={1.5} /> {t.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 p-2 pt-0">
              {tab === "output" && (
                <motion.div key="output" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex h-full min-h-[12rem] flex-col rounded-2xl bg-[#0B0B0A] p-4">
                  {netErr ? (
                    <p className="font-mono text-[13px] leading-relaxed text-[#FFC9A8]">{netErr}</p>
                  ) : result ? (
                    <>
                      <pre className={`min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-relaxed ${failed ? "text-[#FFC9A8]" : "text-primary/90"}`}>{outputText}</pre>
                      <p className="mt-3 shrink-0 font-mono text-[11px] text-primary/40">exit {result.exit_code}{result.signal ? ` · signal ${result.signal}` : ""} · {result.time}s · {result.memory}KB</p>
                    </>
                  ) : (
                    <p className="font-mono text-[13px] text-primary/35">{running ? "Running…" : "Run the code to see output. Ctrl+Enter works too."}</p>
                  )}
                </motion.div>
              )}

              {tab === "input" && (
                <motion.div key="input" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex h-full min-h-[12rem] flex-col rounded-2xl bg-[#0B0B0A] p-4">
                  <textarea value={stdin} onChange={e => setStdin(e.target.value)} spellCheck={false} aria-label="Standard input" placeholder="Standard input — passed to your program on each run." className="min-h-0 flex-1 resize-none bg-transparent font-mono text-[13px] leading-relaxed text-primary/90 outline-none placeholder:text-primary/35" />
                </motion.div>
              )}

              {tab === "tests" && (
                <motion.div key="tests" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 rounded-2xl bg-[#0B0B0A] p-4 text-center">
                  <FlaskConical className="h-5 w-5 text-primary/35" strokeWidth={1.5} />
                  <p className="max-w-56 text-sm text-primary/45">Test cases land next — stdin, expected output, pass/fail diff.</p>
                </motion.div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

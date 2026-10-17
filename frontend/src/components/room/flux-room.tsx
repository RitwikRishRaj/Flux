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
import { TestsTab } from "@/components/tests-tab";
import type { TestCase } from "@/components/tests-tab";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-primary/40">Loading editor…</div>,
});

type Tab = "output" | "input" | "tests";
const EASE = [0.32, 0.72, 0, 1] as const;

export interface RoomUser { id: string; name: string; color: string }

export function FluxRoom({ id, user }: { id: string; user: RoomUser }) {
  const [compilerId, setCompilerId] = useState<CompilerId>("python-3.14");
  const compiler = byId(compilerId);
  const [code, setCode] = useState(""); // Empty: template seeded by Yjs after first sync
  const [stdin, setStdin] = useState("");
  const [tab, setTab] = useState<Tab>("output");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [netErr, setNetErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<Array<{ id: string; name: string; color: string }>>([]); // GROUP by user.id, SHOW most recently updated per user; on pagehide, setLocalState(null) to remove ghost
  const [tabPresence, setTabPresence] = useState<Map<Tab, Array<{ id: string; name: string; color: string }>>>(new Map());
  const [tests, setTests] = useState<TestCase[]>([]);
  const [lastRun, setLastRun] = useState<{ stdout: string; stderr: string; status: string; runBy: string; runById: string; finishedAt: number } | null>(null);
  const [testRun, setTestRun] = useState<{ runId: string; runBy: string; runById: string; startedAt: number; finishedAt: number | null; interrupted: boolean; results: Map<string, { status: string; actual?: string; stderr?: string; durationMs?: number }> } | null>(null);
  const [runningBy, setRunningBy] = useState<string | null>(null);
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monacoNS.editor.ITextModel | null>(null);
  const stdinEditorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);
  const stdinModelRef = useRef<monacoNS.editor.ITextModel | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const disconnectStdinRef = useRef<(() => void) | null>(null);
  const roomStateRef = useRef<Y.Map<string> | null>(null);
  const awarenessRef = useRef<any>(null);
  const testsRef = useRef<Y.Array<TestCase> | null>(null);
  const stdinRef = useRef<Y.Text | null>(null);
  const lastRunRef = useRef<Y.Map<any> | null>(null);
  const testRunRef = useRef<Y.Map<any> | null>(null);
  const userIdRef = useRef<string>(user.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runRef.current();
      }
    };
       window.addEventListener("keydown", onKey);
    
    const onPageHide = () => {
      awarenessRef.current?.setLocalStateField("running", null);
      awarenessRef.current?.setLocalStateField("activeTab", null);
    };
    window.addEventListener("pagehide", onPageHide);
    
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (disconnectRef.current) disconnectRef.current();
      if (disconnectStdinRef.current) disconnectStdinRef.current();
    };
  }, [id]);

  const run = async () => {
    if (running || runningBy) return;
    setRunning(true);
    setNetErr(null);
    setTab("output");
    
    // Set awareness: running state
    const runId = crypto.randomUUID();
    awarenessRef.current?.setLocalStateField("running", { runId, user: { name: user.name, id: user.id } });
    
    try {
      const currentStdin = stdinRef.current?.toString().slice(0, 20000) || "";
      const res = await fetch("/api/backend/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compiler: compilerId, code: editorRef.current?.getValue() ?? code, input: currentStdin }),
      });
      const data = (await res.json()) as RunResult & { error?: string };
      
      if (!res.ok) {
        setNetErr(data.error ?? `Request failed (${res.status})`);
      } else {
        setResult(data);
        // Write to shared Y.Map
        if (lastRunRef.current) {
          lastRunRef.current.doc!.transact(() => {
            lastRunRef.current!.set("stdout", (data.output || "").slice(0, 50000));
            lastRunRef.current!.set("stderr", (data.error || "").slice(0, 50000));
            lastRunRef.current!.set("status", data.exit_code === 0 ? "ok" : "error");
            lastRunRef.current!.set("runBy", user.name.replace(/["\\<>\n]/g, "").slice(0, 24));
            lastRunRef.current!.set("runById", user.id);
            lastRunRef.current!.set("finishedAt", Date.now());
          });
        }
      }
    } catch {
      setNetErr("Could not reach backend on :8787");
    } finally {
      setRunning(false);
      awarenessRef.current?.setLocalStateField("running", null);
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

  // Update activeTab in awareness when tab changes
  useEffect(() => {
    if (awarenessRef.current) {
      awarenessRef.current.setLocalStateField("activeTab", tab);
    }
  }, [tab]);

  const addTest = () => {
    if (!testsRef.current) return;
    testsRef.current.push([{ id: crypto.randomUUID(), stdin: "", expectedOutput: "" }]);
  };

  const editTest = (id: string, field: "stdin" | "expectedOutput", value: string) => {
    if (!testsRef.current) return;
    const idx = testsRef.current.toArray().findIndex(tc => tc.id === id);
    if (idx === -1) return;
    const tc = testsRef.current.get(idx);
    if (tc instanceof Y.Map) {
      tc.set(field, value);
    } else {
      // Plain object case: replace the entry
      const current = tc as TestCase;
      testsRef.current.delete(idx, 1);
      testsRef.current.insert(idx, [{ ...current, [field]: value }]);
    }
    // Clear the result when case is edited
    if (testRunRef.current) {
      const results = testRunRef.current.get("results") as Record<string, any> | undefined;
      if (results && results[id]) {
        delete results[id];
        testRunRef.current.set("results", results);
      }
    }
  };

  const deleteTest = (id: string) => {
    if (!testsRef.current) return;
    const idx = testsRef.current.toArray().findIndex(tc => tc.id === id);
    if (idx !== -1) testsRef.current.delete(idx, 1);
    // Clear the result when case is deleted
    if (testRunRef.current) {
      const results = testRunRef.current.get("results") as Record<string, any> | undefined;
      if (results && results[id]) {
        delete results[id];
        testRunRef.current.set("results", results);
      }
    }
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
        {remoteUsers.map(u => (
          <div key={u.id} title={u.name} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-black" style={{ backgroundColor: u.color }}>
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

        <button type="button" onClick={run} disabled={running || !!runningBy} className="group inline-flex h-10 items-center gap-3 rounded-full bg-primary pl-5 pr-1.5 text-sm font-semibold text-black transition-all duration-300 active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed">
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
                theme="flux"
                beforeMount={(monaco) => {
                  monaco.editor.defineTheme("flux", FLUX_THEME);
                }}
                onMount={(editor, monaco) => {
                  editorRef.current = editor;
                  modelRef.current = editor.getModel();
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => runRef.current());
                  editor.getDomNode()?.setAttribute("data-editor", "main");
                  if (!disconnectRef.current && modelRef.current) {
                    const [disconnect, { getRoomState, getAwareness, getStdin }] = connect(id, editor, modelRef.current, user, monaco, "main");
                    disconnectRef.current = disconnect;
                    roomStateRef.current = getRoomState();
                    awarenessRef.current = getAwareness();
                    stdinRef.current = getStdin();

                    // Listen for language changes from other users
                    let initialized = false;
                    roomStateRef.current.observe(() => {
                      const newCompilerId = roomStateRef.current?.get("compilerId");
                      // Skip initial load, only respond to remote changes
                      if (initialized && newCompilerId && newCompilerId !== compilerId && COMPILERS.some(c => c.id === newCompilerId)) {
                        setCompilerId(newCompilerId as CompilerId);
                      }
                      initialized = true;
                    });

                    // Listen for awareness changes (remote users)
                    awarenessRef.current.on("change", () => {
                      const meta = awarenessRef.current.meta;
                      const states = awarenessRef.current.getStates();
                      
                      // Group by user.id, keep most recently updated per user
                      const byUser = new Map<string, { user: { id: string; name: string; color: string }; lastUpdated: number; activeTab?: Tab }>();
                      states.forEach((state: any, clientId: number) => {
                        if (clientId !== awarenessRef.current.clientID && state.user?.id) {
                          const lastUpdated = meta.get(clientId)?.lastUpdated ?? 0;
                          const existing = byUser.get(state.user.id);
                          if (!existing || lastUpdated > existing.lastUpdated) {
                            // Validate activeTab
                            const tabValue = state.activeTab;
                            const validTab = (tabValue === "output" || tabValue === "input" || tabValue === "tests") ? tabValue : undefined;
                            byUser.set(state.user.id, { user: state.user, lastUpdated, activeTab: validTab });
                          }
                        }
                      });
                      
                      setRemoteUsers(Array.from(byUser.values()).map(v => v.user));
                      
                      // Build tab presence map
                      const newTabPresence = new Map<Tab, Array<{ id: string; name: string; color: string }>>();
                      (['output', 'input', 'tests'] as Tab[]).forEach(t => newTabPresence.set(t, []));
                      
                      byUser.forEach(data => {
                        if (data.activeTab) {
                          const list = newTabPresence.get(data.activeTab);
                          if (list) list.push(data.user);
                        }
                      });
                      
                      setTabPresence(newTabPresence);
                    });

                    // Observe shared tests
                    const doc = roomStateRef.current.doc!;
                    testsRef.current = doc.getArray<TestCase>("tests");
                    stdinRef.current = doc.getText("stdin");
                    lastRunRef.current = doc.getMap<any>("lastRun");
                    testRunRef.current = doc.getMap<any>("testRun");
                    
                    const updateTests = () => {
                      const caseArr = testsRef.current?.toArray() || [];
                      const valid = caseArr.filter((tc): tc is TestCase => 
                        tc && typeof tc.id === "string" && typeof tc.stdin === "string" && typeof tc.expectedOutput === "string"
                      );
                      setTests(valid.slice(0, 50));
                    };
                    
                    testsRef.current.observe(updateTests);
                    updateTests();
                    
                    // Observe lastRun
                    const updateLastRun = () => {
                      const lr = lastRunRef.current;
                      if (!lr) return;
                      const stdout = lr.get("stdout");
                      const stderr = lr.get("stderr");
                      const status = lr.get("status");
                      const runBy = lr.get("runBy");
                      const runById = lr.get("runById");
                      const finishedAt = lr.get("finishedAt");
                      
                      if (typeof stdout === "string" && typeof stderr === "string" && typeof status === "string") {
                        setLastRun({
                          stdout: stdout.slice(0, 50000),
                          stderr: stderr.slice(0, 50000),
                          status,
                          runBy: (typeof runBy === "string" ? runBy : "Anonymous").replace(/["\\<>\n]/g, "").slice(0, 24),
                          runById: typeof runById === "string" ? runById : "",
                          finishedAt: typeof finishedAt === "number" ? finishedAt : 0
                        });
                      }
                    };
                    
                    lastRunRef.current.observe(updateLastRun);
                    updateLastRun();
                    
                    // Observe testRun
                    const updateTestRun = () => {
                      const tr = testRunRef.current;
                      if (!tr) return;
                      const runId = tr.get("runId");
                      const runBy = tr.get("runBy");
                      const runById = tr.get("runById");
                      const startedAt = tr.get("startedAt");
                      const finishedAt = tr.get("finishedAt");
                      const interrupted = tr.get("interrupted");
                      const resultsMap = tr.get("results");
                      
                      if (typeof runId === "string") {
                        const results = new Map<string, { status: string; actual?: string; stderr?: string; durationMs?: number }>();
                        if (resultsMap && typeof resultsMap === "object") {
                          Object.entries(resultsMap).forEach(([id, data]: [string, any]) => {
                            if (data && typeof data.status === "string") {
                              results.set(id, {
                                status: data.status,
                                actual: typeof data.actual === "string" ? data.actual.slice(0, 20000) : undefined,
                                stderr: typeof data.stderr === "string" ? data.stderr.slice(0, 20000) : undefined,
                                durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined
                              });
                            }
                          });
                        }
                        setTestRun({
                          runId,
                          runBy: (typeof runBy === "string" ? runBy : "Anonymous").replace(/["\\<>\n]/g, "").slice(0, 24),
                          runById: typeof runById === "string" ? runById : "",
                          startedAt: typeof startedAt === "number" ? startedAt : 0,
                          finishedAt: typeof finishedAt === "number" ? finishedAt : null,
                          interrupted: interrupted === true,
                          results
                        });
                      } else {
                        setTestRun(null);
                      }
                    };
                    
                    testRunRef.current.observe(updateTestRun);
                    updateTestRun();
                    
                    // Observe running state from awareness
                    const updateRunningBy = () => {
                      const states = awarenessRef.current.getStates();
                      let runner: string | null = null;
                      states.forEach((state: any, clientId: number) => {
                        if (clientId !== awarenessRef.current.clientID && state.running?.user?.name) {
                          runner = state.running.user.name.replace(/["\\<>\n]/g, "").slice(0, 24);
                        }
                      });
                      setRunningBy(runner);
                      
                      // Mark as interrupted if runner disappears and run not finished
                      if (!runner && testRunRef.current && testRunRef.current.get("finishedAt") === null) {
                        testRunRef.current.set("interrupted", true);
                        testRunRef.current.set("finishedAt", Date.now());
                      }
                    };
                    
                    awarenessRef.current.on("change", updateRunningBy);
                    updateRunningBy();
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
              {tabs.map(t => {
                const users = tabPresence.get(t.key) || [];
                const display = users.slice(0, 5);
                const extra = users.length > 5 ? users.length - 5 : 0;
                return (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`flex h-10 items-center gap-2 rounded-t-xl px-4 text-sm font-medium transition-colors duration-300 ${tab === t.key ? "bg-white/[0.05] text-primary" : "text-primary/50 hover:text-primary"}`}>
                    <t.icon className="h-4 w-4" strokeWidth={1.5} /> {t.label}
                    {display.length > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        {display.map(u => {
                          const color = /^#[0-9a-fA-F]{6}$/.test(u.color) ? u.color : "#5FD0A8";
                          const name = u.name.replace(/["\\<>\n]/g, "").slice(0, 24) || "Anonymous";
                          return (
                            <span
                              key={u.id}
                              title={name}
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                          );
                        })}
                        {extra > 0 && (
                          <span className="ml-0.5 text-[10px] text-primary/40">+{extra}</span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 p-2 pt-0">
              {tab === "output" && (
                <motion.div key="output" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex h-full min-h-[12rem] flex-col rounded-2xl bg-[#0B0B0A] p-4">
                  {runningBy ? (
                    <p className="font-mono text-[13px] text-primary/50">Running by {runningBy}…</p>
                  ) : netErr ? (
                    <p className="font-mono text-[13px] leading-relaxed text-[#FFC9A8]">{netErr}</p>
                  ) : lastRun ? (
                    <>
                      <p className="mb-2 shrink-0 font-mono text-[11px] text-primary/40">
                        Run by {lastRun.runBy || "Anonymous"} · {new Date(lastRun.finishedAt).toLocaleTimeString()}
                      </p>
                      <pre className={`min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-relaxed ${lastRun.status !== "ok" ? "text-[#FFC9A8]" : "text-primary/90"}`}>
                        {lastRun.stdout}{lastRun.stderr ? "\n" + lastRun.stderr : ""}
                      </pre>
                    </>
                  ) : (
                    <p className="font-mono text-[13px] text-primary/35">Run the code to see output. Ctrl+Enter works too.</p>
                  )}
                </motion.div>
              )}

              {tab === "input" && (
                <motion.div key="input" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex h-full min-h-[12rem] flex-col rounded-2xl bg-[#0B0B0A]">
                  <Editor
                    language="plaintext"
                    value={stdin}
                    onChange={v => {
                      const trimmed = (v ?? "").slice(0, 20000);
                      setStdin(trimmed);
                      if (stdinRef.current) {
                        stdinRef.current.delete(0, stdinRef.current.length);
                        stdinRef.current.insert(0, trimmed);
                      }
                    }}
                    theme="flux"
                    onMount={(editor, monaco) => {
                      stdinEditorRef.current = editor;
                      stdinModelRef.current = editor.getModel();
                      editor.getDomNode()?.setAttribute("data-editor", "stdin");
                      editor.updateOptions({
                        minimap: { enabled: false },
                        lineNumbers: "off",
                        folding: false,
                        glyphMargin: false,
                        lineDecorationsWidth: 0,
                        renderLineHighlight: "none",
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 14,
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                        lineHeight: 22,
                        placeholder: "Standard input — passed to your program on each run."
                      });
                      if (stdinRef.current && stdinModelRef.current && awarenessRef.current) {
                        import("y-monaco").then(({ MonacoBinding }) => {
                          const binding = new MonacoBinding(stdinRef.current!, stdinModelRef.current, new Set([editor]), awarenessRef.current);
                          disconnectStdinRef.current = () => binding.destroy();
                        });
                      }
                    }}
                    options={{
                      minimap: { enabled: false },
                      lineNumbers: "off",
                      folding: false
                    }}
                  />
                </motion.div>
              )}

              {tab === "tests" && (
                <motion.div key="tests" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex h-full min-h-[12rem] flex-col rounded-2xl bg-[#0B0B0A] p-4">
                  <TestsTab 
                    tests={tests} 
                    compiler={compilerId} 
                    code={editorRef.current?.getValue() ?? ""} 
                    onAdd={addTest} 
                    onEdit={editTest} 
                    onDelete={deleteTest}
                    testRun={testRun}
                    runningBy={runningBy}
                    testRunRef={testRunRef}
                    awarenessRef={awarenessRef}
                    user={user}
                  />
                </motion.div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

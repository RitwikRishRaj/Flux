"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type * as monacoNS from "monaco-editor";
import * as Y from "yjs";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Link2, Loader2, Play, SquareTerminal, FlaskConical, Terminal } from "lucide-react";
import { COMPILERS, RETIRED, byId, isEmptyOrStarter, describeExit, formatSeconds, formatMemory, type CompilerId } from "@/lib/compilers";
import { FLUX_THEME } from "@/lib/flux-monaco";
import { LanguagePicker } from "@/components/room/language-picker";
import { connect, partyOrigin } from "@/lib/party";
import { bannerFor, messageFor, type RunStatus } from "@/lib/run-api";
import { TestsTab } from "@/components/tests-tab";
import type { TestCase, TestResult, TestRunState } from "@/components/tests-tab";
import { WebStudio } from "@/components/room/web-studio";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-primary/40">Loading editor…</div>,
});

type Tab = "output" | "input" | "tests";
const EASE = [0.32, 0.72, 0, 1] as const;

export interface RoomUser { id: string; name: string; color: string }

export function FluxRoom({ id, user, initialMode }: { id: string; user: RoomUser; initialMode: "code" | "web" }) {
  const [compilerId, setCompilerId] = useState<CompilerId>("python-3.14");
  const compiler = byId(compilerId);
  const [tab, setTab] = useState<Tab>("output");
  const [copied, setCopied] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<Array<{ id: string; name: string; color: string }>>([]); // GROUP by user.id, SHOW most recently updated per user; on pagehide, setLocalState(null) to remove ghost
  const [tabPresence, setTabPresence] = useState<Map<Tab, Array<{ id: string; name: string; color: string }>>>(new Map());
  const [tests, setTests] = useState<TestCase[]>([]);
  // exitCode is null for runs saved before the status line existed; they show no status line.
  const [lastRun, setLastRun] = useState<{
    stdout: string; stderr: string; status: string; runBy: string; runById: string; finishedAt: number;
    exitCode: number | null; signal: number | null; time: string; memory: string; truncated: boolean; timeLimit: number | null; memoryLimit: number | null;
    errorCode: string | null; error: string; resetsAt: string | null; // a run the room couldn't do (busy, budget, ...)
  } | null>(null);
  const [testRun, setTestRun] = useState<TestRunState | null>(null);
  // The room's run in progress (code or tests), from the shared doc: the room runs it, so it ends even if its starter leaves.
  const [runState, setRunState] = useState<{ active: "run" | "tests" | null; by: string; note: string | null }>({ active: null, by: "", note: null });
  const runningBy = runState.active ? runState.by || "Someone" : null;
  const running = runState.active === "run";
  const sendRef = useRef<((message: object) => boolean) | null>(null);
  const [sendError, setSendError] = useState<string | null>(null); // a request that couldn't be sent (not connected)
  const netErr = sendError ?? (lastRun?.errorCode ? messageFor(lastRun.errorCode, { error: lastRun.error, resets_at: lastRun.resetsAt }, 0) : null);
  const [mode, setMode] = useState(initialMode);
  const [conn, setConn] = useState<{ doc: Y.Doc; awareness: any; whenSynced: (cb: () => void) => () => void } | null>(null);
  const [offerStarter, setOfferStarter] = useState<CompilerId | null>(null);
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [refused, setRefused] = useState(false); // a brand-new room the browser couldn't be verified for
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

  // The room reads the code, input and language from the shared doc and runs it; results come back the same way.
  const ask = (message: object) => setSendError(sendRef.current?.(message) ? null : messageFor("offline", {}, 0));
  const run = () => {
    if (mode === "web" || runningBy) return;
    setTab("output");
    ask({ type: "run", by: user.name });
  };
  const runAllTests = () => ask({ type: "runTests", by: user.name });
  const runRef = useRef(run);
  runRef.current = run;

  const switchLanguage = (cid: CompilerId) => {
    setCompilerId(cid);
    // Never overwrite real code silently: empty or starter-only gets the new starter, anything else asks first.
    if (isEmptyOrStarter(editorRef.current?.getValue() ?? "")) replaceCode(byId(cid).hello);
    else setOfferStarter(cid);
    // Sync language to other users, with who switched it (one transaction, so both arrive together)
    const rs = roomStateRef.current;
    rs?.doc!.transact(() => {
      rs.set("compilerId", cid);
      rs.set("compilerBy", user.name.replace(/["\\<>\n]/g, "").slice(0, 24));
    });
  };

  // Writes text over the editor's content as one undoable edit; y-monaco shares it with the room like any keystroke.
  // (The editors used to be React-controlled as well: a stale value could overwrite remote edits and corrupt the doc.)
  const replaceCode = (text: string) => {
    const editor = editorRef.current, model = editor?.getModel();
    if (!editor || !model) return;
    editor.executeEdits("starter", [{ range: model.getFullModelRange(), text }]);
    editor.pushUndoStop();
  };

  // Mode lives in the URL so a reload (or a shared link) opens in the same mode.
  const switchMode = (m: "code" | "web") => {
    setMode(m);
    const url = new URL(location.href);
    if (m === "web") url.searchParams.set("mode", "web"); else url.searchParams.delete("mode");
    history.replaceState(history.state, "", url);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* blocked */ }
  };

  // Runs left and service health for the banner. The Worker caches /status for 60 s, so polling at that pace
  // costs the API nothing extra however many rooms are open; hidden tabs skip it.
  useEffect(() => {
    let active = true;
    const load = () => {
      if (document.hidden) return;
      fetch(`${partyOrigin()}/status`)
        .then(r => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null))
        .then(d => { if (active && d && typeof d.service === "string") setRunStatus(d as unknown as RunStatus); })
        .catch(() => { /* no banner rather than a wrong one */ });
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const banner = refused
    ? "This browser couldn't be verified, so the new room wasn't created. Reload the page to try again."
    : bannerFor(runStatus);

  // Each new notice restarts the timer, so back-to-back switches show the latest for the full time.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

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

        <div role="tablist" aria-label="Mode" className="relative z-0 ml-1 flex h-9 items-center rounded-full bg-white/[0.04] p-0.5">
          {(["code", "web"] as const).map(m => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={`relative h-8 rounded-full px-3.5 text-sm font-medium transition-colors duration-300 ${mode === m ? "text-black" : "text-primary/60 hover:text-primary"}`}>
              {mode === m && <motion.span layoutId="mode-pill" className="absolute inset-0 -z-10 rounded-full bg-primary" transition={{ type: "spring", stiffness: 380, damping: 32 }} />}
              {m === "code" ? "Code" : "Web"}
            </button>
          ))}
        </div>

        <div className={`ml-1 ${mode === "web" ? "hidden" : ""}`}>
          <LanguagePicker value={compilerId} onChange={switchLanguage} />
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

        <button type="button" onClick={run} disabled={running || !!runningBy} className={`group ${mode === "web" ? "hidden" : "inline-flex"} h-10 items-center gap-3 rounded-full bg-primary pl-5 pr-1.5 text-sm font-semibold text-black transition-all duration-300 active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed`}>
          {running ? "Running" : "Run"}
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black transition-transform duration-500 group-hover:scale-105">
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" strokeWidth={1.5} /> : <Play className="h-3.5 w-3.5 fill-primary text-primary" strokeWidth={1.5} />}
          </span>
        </button>
      </header>

      {banner && (
        <p role="status" title={banner} className="flux-enter shrink-0 truncate rounded-full bg-amber-500/[0.08] px-4 py-2 text-[13px] text-amber-200/90">
          {banner}
        </p>
      )}

      {mode === "web" && conn && <WebStudio doc={conn.doc} awareness={conn.awareness} whenSynced={conn.whenSynced} />}

      {/* Hidden, not unmounted: unmounting disposes the model the Yjs binding is attached to. */}
      <div className={`min-h-0 flex-1 flex-col gap-2 lg:flex-row ${mode === "web" ? "hidden" : "flex flux-enter"}`}>
        <div className="min-h-0 flex-1 rounded-[1.6rem] bg-white/[0.03] p-1.5 ring-1 ring-inset ring-white/[0.08]">
          <div className="flex h-full flex-col overflow-hidden rounded-[calc(1.6rem-0.375rem)] bg-[#0B0B0A]">
            <div className="flex h-10 shrink-0 items-center gap-3 pl-4 pr-1.5">
              <span className="shrink-0 font-mono text-[13px] text-primary/50">{compiler.file}</span>
              {/* Lives in the editor row, not the crowded header, so it stays one line at every width.
                  Shown only while the language it offers is still current, so a later switch (local or remote) retires it. */}
              {offerStarter === compilerId && (
                <div role="status" className="flux-enter ml-auto flex min-w-0 items-center gap-0.5 rounded-full bg-white/[0.05] py-0.5 pl-3.5 pr-0.5 text-[13px] text-primary/75">
                  <span className="min-w-0 truncate">
                    <span className="hidden sm:inline">Replace your code with the {compiler.label} starter?</span>
                    <span className="sm:hidden">{compiler.label} starter?</span>
                  </span>
                  <button type="button" onClick={() => { replaceCode(compiler.hello); setOfferStarter(null); }} className="ml-1.5 h-7 shrink-0 rounded-full bg-primary px-3.5 font-semibold text-black transition-transform duration-300 active:scale-[0.97]">
                    Replace
                  </button>
                  <button type="button" onClick={() => setOfferStarter(null)} className="h-7 shrink-0 rounded-full px-3 font-medium text-primary/70 transition-colors duration-300 hover:bg-white/[0.06] hover:text-primary">
                    Keep
                  </button>
                </div>
              )}
            </div>
            <div className="min-h-[16rem] flex-1">
              <Editor
                language={compiler.monaco}
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
                    const [disconnect, { getRoomState, getAwareness, getStdin, isSynced, whenSynced, send, refused: onRefused }] = connect(id, editor, modelRef.current, user, monaco, "main");
                    disconnectRef.current = disconnect;
                    sendRef.current = send;
                    onRefused(() => setRefused(true));
                    roomStateRef.current = getRoomState();
                    awarenessRef.current = getAwareness();
                    stdinRef.current = getStdin();
                    setConn({ doc: getRoomState().doc!, awareness: getAwareness(), whenSynced });

                    // Language changes from other users, and the saved language arriving on first sync after a reload.
                    // Only the language follows; the code itself comes from Yjs, so nothing is overwritten.
                    roomStateRef.current.observe(event => {
                      const saved = roomStateRef.current?.get("compilerId");
                      // A room saved before an id was retired (e.g. dotnet-csharp-9) opens on the id it runs as now.
                      const newCompilerId = saved ? (RETIRED[saved] ?? saved) : saved;
                      if (!newCompilerId || !COMPILERS.some(c => c.id === newCompilerId)) return;
                      setCompilerId(newCompilerId as CompilerId);
                      // Tell others, but not the switcher (local) and not for saved state replayed on load (not yet synced).
                      if (!event.transaction.local && isSynced() && event.keysChanged.has("compilerId")) {
                        const by = String(roomStateRef.current?.get("compilerBy") ?? "").replace(/["\\<>\n]/g, "").slice(0, 24) || "Someone";
                        setNotice({ text: `${by} switched to ${byId(newCompilerId as CompilerId).label}`, key: Date.now() });
                      }
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
                      const num = (k: string) => (typeof lr.get(k) === "number" ? Number(lr.get(k)) : null);
                      const str = (k: string) => (typeof lr.get(k) === "string" ? String(lr.get(k)).slice(0, 20) : "");
                      
                      if (typeof stdout === "string" && typeof stderr === "string" && typeof status === "string") {
                        setLastRun({
                          stdout: stdout.slice(0, 50000),
                          stderr: stderr.slice(0, 50000),
                          status,
                          runBy: (typeof runBy === "string" ? runBy : "Anonymous").replace(/["\\<>\n]/g, "").slice(0, 24),
                          runById: typeof runById === "string" ? runById : "",
                          finishedAt: typeof finishedAt === "number" ? finishedAt : 0,
                          exitCode: num("exitCode"),
                          signal: num("signal"),
                          time: str("time"),
                          memory: str("memory"),
                          truncated: lr.get("truncated") === true,
                          timeLimit: num("timeLimit"),
                          memoryLimit: num("memoryLimit"),
                          errorCode: typeof lr.get("errorCode") === "string" ? String(lr.get("errorCode")) : null,
                          error: typeof lr.get("error") === "string" ? String(lr.get("error")).slice(0, 500) : "",
                          resetsAt: typeof lr.get("resetsAt") === "string" ? String(lr.get("resetsAt")) : null,
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
                        const results = new Map<string, TestResult>();
                        if (resultsMap && typeof resultsMap === "object") {
                          Object.entries(resultsMap).forEach(([id, data]: [string, any]) => {
                            if (data && typeof data.status === "string") {
                              results.set(id, {
                                status: data.status,
                                verdict: typeof data.verdict === "string" ? data.verdict : undefined,
                                truncated: data.truncated === true,
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
                          results,
                          verdict: typeof tr.get("verdict") === "string" ? tr.get("verdict") : null,
                          compileError: typeof tr.get("compileError") === "string" ? String(tr.get("compileError")).slice(0, 20000) : null,
                          error: typeof tr.get("error") === "string"
                            ? (() => {
                                // Keep the room's "Batch 2 of 3: " prefix in front of the friendly message for the code.
                                const raw = String(tr.get("error")).slice(0, 500);
                                const batch = /^Batch \d+ of \d+: /.exec(raw)?.[0] ?? "";
                                const code = typeof tr.get("errorCode") === "string" ? String(tr.get("errorCode")) : "";
                                return batch + messageFor(code, { error: raw.slice(batch.length), resets_at: tr.get("resetsAt") }, 0);
                              })()
                            : null,
                          timeLimit: typeof tr.get("timeLimit") === "number" ? Number(tr.get("timeLimit")) : null,
                          batchIndex: typeof tr.get("batchIndex") === "number" ? Number(tr.get("batchIndex")) : 0,
                          batchCount: typeof tr.get("batchCount") === "number" ? Number(tr.get("batchCount")) : 0,
                        });
                      } else {
                        setTestRun(null);
                      }
                    };
                    
                    testRunRef.current.observe(updateTestRun);
                    updateTestRun();
                    
                    // The room's run in progress, written by the room itself.
                    const runStateMap = doc.getMap<any>("runState");
                    const updateRunState = () => {
                      const active = runStateMap.get("active");
                      setRunState({
                        active: active === "run" || active === "tests" ? active : null,
                        by: String(runStateMap.get("by") ?? "").replace(/["\\<>\n]/g, "").slice(0, 24),
                        note: typeof runStateMap.get("note") === "string" ? runStateMap.get("note") : null,
                      });
                    };
                    runStateMap.observe(updateRunState);
                    updateRunState();
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
                    <p className="font-mono text-[13px] text-primary/50">{runState.note ?? `Running by ${runningBy}…`}</p>
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
                      {lastRun.exitCode !== null && (() => {
                        const time = formatSeconds(lastRun.time);
                        const memory = formatMemory(lastRun.memory);
                        return (
                          <p className="mt-2 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-primary/50">
                            <span className={lastRun.exitCode === 0 ? "text-[#5FD0A8]" : "text-[#FFC9A8]"}>
                              {describeExit(lastRun.exitCode, lastRun.signal, lastRun.timeLimit, lastRun.memoryLimit) ?? "Exited 0"}
                            </span>
                            {time && <><span aria-hidden>·</span><span>{time}</span></>}
                            {memory && <><span aria-hidden>·</span><span title="Peak memory, including the language runtime">{memory}</span></>}
                            {lastRun.truncated && (
                              <span className="rounded-full bg-[#FFC9A8]/10 px-2 py-0.5 text-[#FFC9A8]">Output cut at 64 KB</span>
                            )}
                          </p>
                        );
                      })()}
                    </>
                  ) : (
                    <p className="font-mono text-[13px] text-primary/35">Run the code to see output. Ctrl+Enter works too.</p>
                  )}
                </motion.div>
              )}

              {tab === "input" && (
                <motion.div key="input" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }} className="flex h-full min-h-[12rem] flex-col rounded-2xl bg-[#0B0B0A]">
                  {compiler.inputHint && <p className="px-4 pt-3 text-[13px] text-primary/50">{compiler.inputHint}</p>}
                  <Editor
                    language="plaintext"
                    theme="flux"
                    beforeMount={(monaco) => {
                      monaco.editor.defineTheme("flux", FLUX_THEME);
                    }}
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
                          stdinModelRef.current!.setEOL(0); // LF on every OS, as in party.ts
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
                    onAdd={addTest}
                    onEdit={editTest}
                    onDelete={deleteTest}
                    onRunAll={runAllTests}
                    testRun={testRun}
                    runningBy={runningBy}
                    runNote={runState.active ? runState.note : sendError}
                  />
                </motion.div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Live region stays mounted so screen readers announce each new notice. Outer div centres, so the enter animation's transform is free. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {notice && (
          <p key={notice.key} className="flux-enter rounded-full bg-[#1A1A18] px-5 py-2.5 text-sm font-medium text-primary ring-1 ring-inset ring-white/[0.1]">
            {notice.text}
          </p>
        )}
      </div>
    </main>
  );
}

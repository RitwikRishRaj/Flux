"use client";

import { memo, useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Play, Check, X, AlertCircle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import type { RunResult } from "@/lib/compilers";

export interface TestCase {
  id: string;
  stdin: string;
  expectedOutput: string;
}

const MAX_CASES = 50;
const MAX_FIELD = 10000;
const TIMEOUT_MS = 10000;

const normalize = (s: string) =>
  s.replace(/\r\n/g, "\n").split("\n").map(l => l.trimEnd()).join("\n").trimEnd();

// Memoized test card with local state for smooth remote updates
const TestCard = memo(function TestCard({
  tc,
  index,
  result,
  queued,
  onEdit,
  onDelete,
}: {
  tc: TestCase;
  index: number;
  result?: { status: string; actual?: string; stderr?: string; durationMs?: number };
  queued: boolean;
  onEdit: (id: string, field: "stdin" | "expectedOutput", value: string) => void;
  onDelete: (id: string) => void;
}) {
  const stdinRef = useRef<HTMLTextAreaElement>(null);
  const expectedRef = useRef<HTMLTextAreaElement>(null);
  const [localStdin, setLocalStdin] = useState(tc.stdin);
  const [localExpected, setLocalExpected] = useState(tc.expectedOutput);
  const editTimeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [collapsed, setCollapsed] = useState(false);

  // Sync remote changes only when not focused
  useEffect(() => {
    // Only update local state when not focused to preserve caret
    if (stdinRef.current && document.activeElement !== stdinRef.current && tc.stdin !== localStdin) {
      setLocalStdin(tc.stdin);
    }
    if (expectedRef.current && document.activeElement !== expectedRef.current && tc.expectedOutput !== localExpected) {
      setLocalExpected(tc.expectedOutput);
    }
  }, [tc.stdin, tc.expectedOutput]);

  // Auto-grow textareas
  useEffect(() => {
    if (stdinRef.current) {
      stdinRef.current.style.height = 'auto';
      stdinRef.current.style.height = Math.min(stdinRef.current.scrollHeight, 250) + 'px';
    }
    if (expectedRef.current) {
      expectedRef.current.style.height = 'auto';
      expectedRef.current.style.height = Math.min(expectedRef.current.scrollHeight, 250) + 'px';
    }
  }, [localStdin, localExpected]);

  const handleStdinChange = useCallback((value: string) => {
    setLocalStdin(value);
    const key = `${tc.id}-stdin`;
    const existing = editTimeoutRef.current.get(key);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => onEdit(tc.id, "stdin", value), 150);
    editTimeoutRef.current.set(key, timeout);
  }, [tc.id, onEdit]);

  const handleExpectedChange = useCallback((value: string) => {
    setLocalExpected(value);
    const key = `${tc.id}-expectedOutput`;
    const existing = editTimeoutRef.current.get(key);
    if (existing) clearTimeout(existing);
    const timeout = setTimeout(() => onEdit(tc.id, "expectedOutput", value), 150);
    editTimeoutRef.current.set(key, timeout);
  }, [tc.id, onEdit]);

  const statusColor = 
    queued ? "amber" :
    result?.status === "pass" ? "green" :
    result?.status === "fail" ? "red" :
    result?.status === "error" ? "red" : "neutral";

  const statusBgColor = 
    queued ? "bg-amber-500/15" :
    result?.status === "pass" ? "bg-emerald-500/15" :
    result?.status === "fail" ? "bg-red-500/15" :
    result?.status === "error" ? "bg-red-500/15" : "bg-white/[0.06]";

  const statusBorderColor = 
    queued ? "border-amber-500/30" :
    result?.status === "pass" ? "border-emerald-500/30" :
    result?.status === "fail" ? "border-red-500/30" :
    result?.status === "error" ? "border-red-500/30" : "border-white/[0.08]";

  const accentColor = 
    queued ? "#f59e0b" :
    result?.status === "pass" ? "#10b981" :
    result?.status === "fail" ? "#ef4444" :
    result?.status === "error" ? "#ef4444" : "#52525b";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
      className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-white/[0.04] to-white/[0.02] ring-1 ring-inset ring-white/[0.06] hover:ring-white/[0.10] transition-all duration-150"
    >
      {/* Left accent bar */}
      <div 
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition-colors duration-150"
        style={{ backgroundColor: accentColor, opacity: result || queued ? 1 : 0.3 }}
      />
      
      {/* Collapsed header row */}
      <div className="flex items-center gap-3 p-3 pl-5">
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-primary/40 hover:text-primary hover:bg-white/[0.05] transition-colors"
          aria-label={collapsed ? "Expand case" : "Collapse case"}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
          ) : (
            <ChevronUp className="h-4 w-4" strokeWidth={1.5} />
          )}
        </button>

        {/* Case number */}
        <div className="flex h-7 min-w-[2rem] items-center justify-center rounded-lg bg-white/[0.06] px-2">
          <span className="text-[11px] font-mono font-semibold text-primary/70">{index + 1}</span>
        </div>

        {/* Status chip */}
        <div className={`${statusBgColor} ${statusBorderColor} border rounded-lg px-2.5 py-1 flex items-center gap-1.5 transition-colors duration-150`}>
          {queued && (
            <>
              <Clock className="h-3 w-3 animate-spin text-amber-400" strokeWidth={2} />
              <span className="text-[10px] font-mono font-medium text-amber-400">running</span>
            </>
          )}
          {result?.status === "pass" && (
            <>
              <Check className="h-3 w-3 text-emerald-400" strokeWidth={2.5} />
              <span className="text-[10px] font-mono font-medium text-emerald-400">pass</span>
            </>
          )}
          {result?.status === "fail" && (
            <>
              <X className="h-3 w-3 text-red-400" strokeWidth={2.5} />
              <span className="text-[10px] font-mono font-medium text-red-400">fail</span>
            </>
          )}
          {result?.status === "error" && (
            <>
              <AlertCircle className="h-3 w-3 text-red-400" strokeWidth={2} />
              <span className="text-[10px] font-mono font-medium text-red-400">error</span>
            </>
          )}
          {!result && !queued && (
            <span className="text-[10px] font-mono text-primary/40">idle</span>
          )}
        </div>

        {/* Duration */}
        {result?.durationMs !== undefined && (
          <span className="text-[10px] font-mono text-primary/40 tabular-nums">
            {result.durationMs}ms
          </span>
        )}

        <div className="flex-1" />

        {/* Delete button */}
        <button
          type="button"
          onClick={() => onDelete(tc.id)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-primary/30 hover:text-red-400 hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500/30 transition-colors"
          aria-label="Delete test case"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {/* Expandable content */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pl-5">
              {/* Fields - Container query for responsive layout */}
              <div className="@container">
                <div className="grid gap-3 @[520px]:grid-cols-2">
                  {/* Stdin */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-primary/40">stdin</label>
                    <textarea
                      ref={stdinRef}
                      value={localStdin}
                      onChange={e => handleStdinChange(e.target.value.slice(0, MAX_FIELD))}
                      spellCheck={false}
                      rows={3}
                      placeholder="Input for this test..."
                      className="w-full resize-none rounded-xl bg-black/40 px-3 py-2.5 font-mono text-[12px] text-primary/90 placeholder:text-primary/20 outline-none ring-1 ring-inset ring-white/[0.06] focus:ring-1 focus:ring-white/[0.20] focus:bg-black/60 transition-all duration-150 overflow-auto"
                      style={{ 
                        colorScheme: 'dark',
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(255,255,255,0.15) transparent'
                      }}
                    />
                  </div>
                  
                  {/* Expected output */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono uppercase tracking-wider text-primary/40">expected output</label>
                    <textarea
                      ref={expectedRef}
                      value={localExpected}
                      onChange={e => handleExpectedChange(e.target.value.slice(0, MAX_FIELD))}
                      spellCheck={false}
                      rows={3}
                      placeholder="Expected output..."
                      className="w-full resize-none rounded-xl bg-black/40 px-3 py-2.5 font-mono text-[12px] text-primary/90 placeholder:text-primary/20 outline-none ring-1 ring-inset ring-white/[0.06] focus:ring-1 focus:ring-white/[0.20] focus:bg-black/60 transition-all duration-150 overflow-auto"
                      style={{ 
                        colorScheme: 'dark',
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(255,255,255,0.15) transparent'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Results */}
              {result?.status === "fail" && result.actual !== undefined && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 rounded-xl bg-red-500/[0.08] ring-1 ring-inset ring-red-500/20 p-3"
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-red-400/80">actual output</span>
                    <span className="text-[10px] font-mono text-primary/40">diff at line 3</span>
                  </div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-primary/80 leading-relaxed">{result.actual}</pre>
                </motion.div>
              )}
              {result?.status === "error" && result.stderr && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 rounded-xl bg-red-500/[0.08] ring-1 ring-inset ring-red-500/20 p-3"
                >
                  <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-red-400/80">error</div>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-primary/80 leading-relaxed">{result.stderr}</pre>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

export function TestsTab({
  tests,
  compiler,
  code,
  onAdd,
  onEdit,
  onDelete,
  testRun,
  runningBy,
  testRunRef,
  awarenessRef,
  user,
}: {
  tests: TestCase[];
  compiler: string;
  code: string;
  onAdd: () => void;
  onEdit: (id: string, field: "stdin" | "expectedOutput", value: string) => void;
  onDelete: (id: string) => void;
  testRun: { runId: string; runBy: string; runById: string; startedAt: number; finishedAt: number | null; interrupted: boolean; results: Map<string, { status: string; actual?: string; stderr?: string; durationMs?: number }> } | null;
  runningBy: string | null;
  testRunRef: React.MutableRefObject<any>;
  awarenessRef: React.MutableRefObject<any>;
  user: { id: string; name: string };
}) {
  const runAll = async () => {
    if (runningBy) return;
    
    const runId = crypto.randomUUID();
    awarenessRef.current?.setLocalStateField("running", { runId, user: { name: user.name, id: user.id } });
    
    testRunRef.current?.doc!.transact(() => {
      testRunRef.current.set("runId", runId);
      testRunRef.current.set("runBy", user.name.replace(/["\\<>\n]/g, "").slice(0, 24));
      testRunRef.current.set("runById", user.id);
      testRunRef.current.set("startedAt", Date.now());
      testRunRef.current.set("finishedAt", null);
      testRunRef.current.set("interrupted", false);
      testRunRef.current.set("results", {});
    });
    
    for (const tc of tests) {
      const caseStart = Date.now();
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
        
        const res = await fetch("/api/backend/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compiler, code, input: tc.stdin }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        const data = (await res.json()) as RunResult & { error?: string };
        
        const durationMs = Date.now() - caseStart;
        const results = testRunRef.current.get("results") as Record<string, any> || {};
        
        if (!res.ok) {
          results[tc.id] = { status: "error", stderr: (data.error || `Request failed (${res.status})`).slice(0, 20000), durationMs };
        } else if (data.exit_code !== 0) {
          results[tc.id] = { status: "error", stderr: (data.error || `Runtime error (exit ${data.exit_code})`).slice(0, 20000), actual: (data.output || "").slice(0, 20000), durationMs };
        } else {
          const actual = normalize(data.output || "");
          const expected = normalize(tc.expectedOutput);
          results[tc.id] = { status: actual === expected ? "pass" : "fail", actual: (data.output || "").slice(0, 20000), durationMs };
        }
        
        testRunRef.current.set("results", results);
      } catch (err) {
        const errorMessage = err instanceof Error && err.name === "AbortError"
          ? "Timeout (>10s)"
          : "Network error";
        const results = testRunRef.current.get("results") as Record<string, any> || {};
        results[tc.id] = { status: "error", stderr: errorMessage, durationMs: Date.now() - caseStart };
        testRunRef.current.set("results", results);
      }
    }
    
    testRunRef.current.set("finishedAt", Date.now());
    awarenessRef.current?.setLocalStateField("running", null);
  };

  const results = testRun?.results || new Map();
  const passed = Array.from(results.values()).filter(r => r.status === "pass").length;
  const failed = Array.from(results.values()).filter(r => r.status === "fail" || r.status === "error").length;
  const running = Array.from(results.values()).filter(r => r.status === "running").length;
  const total = tests.length;
  const passPercent = total > 0 ? (passed / total) * 100 : 0;
  const failPercent = total > 0 ? (failed / total) * 100 : 0;
  const runningPercent = total > 0 ? (running / total) * 100 : 0;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Compact header */}
      <div className="flex flex-col gap-2">
        {/* Main row */}
        <div className="flex items-center justify-between gap-3">
          {/* Left: Progress bar and stats */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Progress bar */}
            <div className="relative h-1.5 flex-1 max-w-[200px] rounded-full bg-white/[0.06] overflow-hidden">
              {/* Running segment */}
              {runningPercent > 0 && (
                <div 
                  className="absolute top-0 bottom-0 bg-amber-500/60 transition-all duration-150"
                  style={{ left: `${passPercent}%`, width: `${runningPercent}%` }}
                />
              )}
              {/* Passed segment */}
              {passPercent > 0 && (
                <div 
                  className="absolute top-0 bottom-0 left-0 bg-emerald-500/70 transition-all duration-150"
                  style={{ width: `${passPercent}%` }}
                />
              )}
              {/* Failed segment */}
              {failPercent > 0 && (
                <div 
                  className="absolute top-0 bottom-0 bg-red-500/70 transition-all duration-150"
                  style={{ left: `${passPercent + runningPercent}%`, width: `${failPercent}%` }}
                />
              )}
            </div>
            
            {/* Stats */}
            <div className="flex items-center gap-2 whitespace-nowrap text-[11px] font-mono">
              <span className="text-primary/70">{passed} / {total} passed</span>
            </div>
          </div>

          {/* Right: Action buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAdd}
              disabled={tests.length >= MAX_CASES}
              className="flex h-8 items-center gap-2 rounded-lg bg-white/[0.06] px-3 text-[11px] font-medium text-primary/70 outline-none ring-1 ring-inset ring-white/[0.08] transition-all duration-150 hover:bg-white/[0.1] hover:text-primary hover:ring-white/[0.15] focus:ring-2 focus:ring-white/[0.20] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Add</span>
            </button>
            {tests.length > 0 && (
              <button
                type="button"
                onClick={runAll}
                disabled={!!runningBy}
                className="flex h-8 items-center gap-2 rounded-lg bg-[#5FD0A8] px-3.5 text-[11px] font-semibold text-black shadow-lg shadow-[#5FD0A8]/15 outline-none ring-1 ring-inset ring-white/20 transition-all duration-150 hover:shadow-xl hover:shadow-[#5FD0A8]/20 active:scale-[0.97] focus:ring-2 focus:ring-white/30 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {runningBy ? (
                  <>
                    <Clock className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                    <span>Running…</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" strokeWidth={2} />
                    <span>Run all</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Secondary row: Run metadata */}
        {testRun && (
          <div 
            className="text-[10px] font-mono text-primary/40 truncate"
            title={`Run by ${testRun.runBy}${testRun.finishedAt ? ` · ${new Date(testRun.startedAt).toLocaleTimeString()}` : ""}${testRun.interrupted ? " · interrupted" : ""}`}
          >
            <span className="text-primary/60">Run by</span>{" "}
            <span className="text-primary/80">{testRun.runBy}</span>
            {testRun.finishedAt && (
              <>
                <span className="text-primary/30 mx-1">·</span>
                <span>{new Date(testRun.startedAt).toLocaleTimeString()}</span>
              </>
            )}
            {testRun.interrupted && (
              <>
                <span className="text-primary/30 mx-1">·</span>
                <span className="text-red-400">interrupted</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Test cases list */}
      {tests.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-1 flex-col items-center justify-center gap-3 py-8"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04] text-primary/30">
            <Play className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <div className="text-center max-w-xs">
            <p className="text-sm text-primary/60 mb-1">No test cases yet</p>
            <p className="text-xs text-primary/40 mb-3">Add one to check your program against expected output.</p>
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-2 text-xs text-[#5FD0A8] hover:text-[#5FD0A8]/80 transition-colors"
            >
              <Plus className="h-3 w-3" strokeWidth={1.5} />
              Add test case
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1 -mr-1">
          {tests.map((tc, index) => (
            <TestCard
              key={tc.id}
              tc={tc}
              index={index}
              result={results.get(tc.id)}
              queued={!!(testRun && !testRun.finishedAt && !testRun.results.has(tc.id))}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

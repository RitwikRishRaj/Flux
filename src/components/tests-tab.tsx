"use client";

import { memo, useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { TestResult } from "@/lib/test-results";
import { Plus, Trash2, Play, Loader2, ChevronRight, CornerDownLeft } from "lucide-react";

export interface TestCase {
  id: string;
  stdin: string;
  expectedOutput: string;
}

export type { TestResult };
// The room's last test run, written by the room (party/run/jobs.ts) and shared through Yjs.
export type TestRunState = {
  runId: string; runBy: string; runById: string; startedAt: number; finishedAt: number | null; interrupted: boolean;
  results: Map<string, TestResult>;
  verdict: string | null; compileError: string | null; error: string | null;
  timeLimit: number | null; // seconds per test the server chose; fewer tests get more time
  batchIndex: number; batchCount: number; // progress: tests go in batches small enough to keep the full time limit
};

const MAX_CASES = 32;            // the free plan's tests per run-tests request
const MAX_FIELD = 10000;
const EASE = [0.32, 0.72, 0, 1] as const;
const VERDICT_LABEL: Record<string, string> = {
  accepted: "pass",
  wrong_answer: "wrong answer",
  time_limit_exceeded: "time limit",
  memory_limit_exceeded: "memory limit",
  output_limit_exceeded: "output limit",
  runtime_error: "runtime error",
  compilation_error: "compile error",
  skipped: "skipped",
  internal_error: "service error",
};

// Shown when a failing test has no stderr of its own to explain it.
const VERDICT_HINT: Record<string, string> = {
  time_limit_exceeded: "Took longer than the time limit shown above.",
  memory_limit_exceeded: "Used more than the 512 MB memory limit.",
  output_limit_exceeded: "Printed more output than allowed.",
  compilation_error: "The code didn't compile. The compiler output is above.",
  skipped: "Didn't start in time. Run again to finish it.",
  internal_error: "The run service failed on this test. Run again.",
};

const normalize = (s: string) =>
  s.replace(/\r\n/g, "\n").split("\n").map(l => l.trimEnd()).join("\n").trimEnd();

// First line (1-based) where actual and expected differ under the same rules as the trim checker; null if equal.
export const firstDiffLine = (actual: string, expected: string) => {
  const a = normalize(actual).split("\n"), e = normalize(expected).split("\n");
  for (let i = 0; i < Math.max(a.length, e.length); i++) if (a[i] !== e[i]) return i + 1;
  return null;
};

type Tone = "pass" | "fail" | "running" | "muted";
const toneOf = (result: TestResult | undefined, queued: boolean): Tone | null =>
  queued || result?.status === "running" ? "running"
  : result?.status === "pass" ? "pass"
  : result?.status === "fail" || result?.status === "error" ? "fail"
  : result?.status === "skipped" ? "muted" : null;
const PILL: Record<Tone, string> = {
  pass: "bg-[#5FD0A8]/[0.12] text-[#7FE0BD]",
  fail: "bg-[#FF8A7A]/[0.12] text-[#FFB4A8]",
  running: "bg-amber-400/[0.12] text-amber-200",
  muted: "bg-white/[0.06] text-primary/55",
};
const DOT: Record<Tone, string> = { pass: "bg-[#5FD0A8]", fail: "bg-[#FF8A7A]", running: "bg-amber-300 animate-pulse", muted: "bg-white/30" };

const firstLine = (s: string) => s.split("\n").find(l => l.trim()) ?? "";
const FIELD = "block w-full resize-none rounded-lg bg-black/40 px-3 py-2 font-mono text-[12px] leading-[1.6] text-primary/90 outline-none ring-1 ring-inset ring-white/[0.06] transition-[box-shadow,background-color] duration-300 placeholder:text-primary/25 focus:bg-black/60 focus:ring-white/[0.18] [color-scheme:dark] [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]";

// One test. Edits stay local while typing (caret-safe) and reach the room 150 ms later; remote edits show when not focused.
const TestCard = memo(function TestCard({
  tc, index, result, queued, focus, onEdit, onDelete, onRunAll,
}: {
  tc: TestCase;
  index: number;
  result?: TestResult;
  queued: boolean;
  focus: boolean;            // just added here: put the caret in its input
  onEdit: (id: string, field: "stdin" | "expectedOutput", value: string) => void;
  onDelete: (tc: TestCase, index: number) => void;
  onRunAll: () => void;
}) {
  const stdinRef = useRef<HTMLTextAreaElement>(null);
  const expectedRef = useRef<HTMLTextAreaElement>(null);
  const [localStdin, setLocalStdin] = useState(tc.stdin);
  const [localExpected, setLocalExpected] = useState(tc.expectedOutput);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [collapsed, setCollapsed] = useState(false);
  const tone = toneOf(result, queued);

  useEffect(() => {
    if (document.activeElement !== stdinRef.current && tc.stdin !== localStdin) setLocalStdin(tc.stdin);
    if (document.activeElement !== expectedRef.current && tc.expectedOutput !== localExpected) setLocalExpected(tc.expectedOutput);
  }, [tc.stdin, tc.expectedOutput]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (focus) { setCollapsed(false); setTimeout(() => stdinRef.current?.focus(), 60); } }, [focus]);

  // Grow with the content, from one line up to ~10.
  useEffect(() => {
    for (const el of [stdinRef.current, expectedRef.current]) {
      if (!el) continue;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight + 2, 200) + "px";
    }
  }, [localStdin, localExpected, collapsed]);

  const change = useCallback((field: "stdin" | "expectedOutput", value: string) => {
    (field === "stdin" ? setLocalStdin : setLocalExpected)(value);
    const t = timers.current.get(field);
    if (t) clearTimeout(t);
    timers.current.set(field, setTimeout(() => onEdit(tc.id, field, value), 150));
  }, [tc.id, onEdit]);

  // Ctrl+Enter here runs the tests, not the room-wide "run the code" shortcut.
  const keys = (e: React.KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onRunAll(); } };
  const label = tone === "running" ? "running" : result ? VERDICT_LABEL[result.verdict ?? ""] ?? result.status : null;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ duration: 0.35, ease: EASE }}
      className="group rounded-xl bg-white/[0.025] p-1 ring-1 ring-inset ring-white/[0.06] transition-[box-shadow] duration-300 focus-within:ring-white/[0.12]"
    >
      <div className="flex h-9 items-center gap-2 pl-1.5 pr-1">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
          aria-label={`Test ${index + 1}${label ? `, ${label}` : ""}. ${collapsed ? "Expand" : "Collapse"}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-primary/35 transition-transform duration-300 ${collapsed ? "" : "rotate-90"}`} strokeWidth={1.5} />
          <span className="shrink-0 font-mono text-[11px] font-medium text-primary/60">Test {index + 1}</span>
          {label && tone && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] ${PILL[tone]}`}>{label}</span>
          )}
          {result?.durationMs !== undefined && <span className="shrink-0 font-mono text-[10px] tabular-nums text-primary/35">{result.durationMs} ms</span>}
          {collapsed && (
            <span className="min-w-0 truncate font-mono text-[11px] text-primary/35">
              {firstLine(localStdin) || "no input"} <span className="text-primary/20">→</span> {firstLine(localExpected) || "no output"}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onDelete(tc, index)}
          aria-label={`Delete test ${index + 1}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-primary/30 outline-none transition-[opacity,color,background-color] duration-300 hover:bg-[#FF8A7A]/10 hover:text-[#FFB4A8] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[#FF8A7A]/30 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="px-1.5 pb-1.5">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-primary/35">Input</span>
                  <textarea ref={stdinRef} value={localStdin} rows={1} spellCheck={false} placeholder="stdin for this test"
                    onChange={e => change("stdin", e.target.value.slice(0, MAX_FIELD))} onKeyDown={keys} className={FIELD} />
                </label>
                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-primary/35">Expected output</span>
                  <textarea ref={expectedRef} value={localExpected} rows={1} spellCheck={false} placeholder="what it should print"
                    onChange={e => change("expectedOutput", e.target.value.slice(0, MAX_FIELD))} onKeyDown={keys} className={FIELD} />
                </label>
              </div>

              {result?.status === "fail" && result.actual !== undefined && (() => {
                const line = firstDiffLine(result.actual, tc.expectedOutput);
                return (
                  <div className="mt-2 rounded-lg bg-[#FF8A7A]/[0.06] p-3 ring-1 ring-inset ring-[#FF8A7A]/15">
                    <div className="mb-1.5 flex items-center justify-between gap-3 font-mono text-[10px]">
                      <span className="uppercase tracking-[0.12em] text-[#FFB4A8]/80">Actual output</span>
                      <span className="text-primary/40">
                        {/* The API returns only the first 4,096 characters, so past the cut the line number can't be trusted. */}
                        {result.truncated ? "output cut at 4,096 characters" : line ? `differs at line ${line}` : null}
                      </span>
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary/80">{result.actual}</pre>
                  </div>
                );
              })()}
              {(result?.status === "error" || result?.status === "skipped") && (result.stderr || VERDICT_HINT[result.verdict ?? ""]) && (
                <div className={`mt-2 rounded-lg p-3 ring-1 ring-inset ${result.status === "skipped" ? "bg-white/[0.03] ring-white/[0.08]" : "bg-[#FF8A7A]/[0.06] ring-[#FF8A7A]/15"}`}>
                  <div className={`mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] ${result.status === "skipped" ? "text-primary/50" : "text-[#FFB4A8]/80"}`}>
                    {VERDICT_LABEL[result.verdict ?? ""] ?? "error"}
                  </div>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary/80">{result.stderr || VERDICT_HINT[result.verdict ?? ""]}</pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
});

export function TestsTab({
  tests,
  onAdd,
  onEdit,
  onDelete,
  onRestore,
  onSaveRun,
  onRunAll,
  testRun,
  runningBy,
  runNote,
}: {
  tests: TestCase[];
  onAdd: () => void;
  onEdit: (id: string, field: "stdin" | "expectedOutput", value: string) => void;
  onDelete: (id: string) => void;
  onRestore: (tc: TestCase, index: number) => void; // undo a delete
  onSaveRun: (() => void) | null;     // add the last run's input and output as a test; null when there's no clean run
  onRunAll: () => void;               // asks the room to run them; the room runs the batches and shares the results
  testRun: TestRunState | null;
  runningBy: string | null;           // whoever has a run going in the room (code or tests), from the shared doc
  runNote: string | null;             // e.g. "The run queue is busy, retrying…", or that a request couldn't be sent
}) {
  const busy = !!runningBy;
  const full = tests.length >= MAX_CASES;
  const runAll = useCallback(() => { if (!busy && tests.length > 0) onRunAll(); }, [busy, tests.length, onRunAll]);

  // The newest test gets the caret when it was added from this tab (not when someone else adds one).
  const [focusNext, setFocusNext] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const prevCount = useRef(tests.length);
  useEffect(() => {
    if (focusNext && tests.length > prevCount.current) { setFocusId(tests[tests.length - 1].id); setFocusNext(false); }
    prevCount.current = tests.length;
  }, [tests, focusNext]);
  const add = (fn: () => void) => { if (full) return; setFocusNext(true); fn(); };

  // A delete is shared with the whole room at once, so it can be undone for a few seconds.
  const [deleted, setDeleted] = useState<{ tc: TestCase; index: number } | null>(null);
  useEffect(() => { if (!deleted) return; const t = setTimeout(() => setDeleted(null), 6000); return () => clearTimeout(t); }, [deleted]);
  const remove = useCallback((tc: TestCase, index: number) => { setDeleted({ tc, index }); onDelete(tc.id); }, [onDelete]);

  const results = testRun?.results || new Map<string, TestResult>();
  const passed = tests.filter(tc => results.get(tc.id)?.status === "pass").length;
  const queuedOf = (id: string) => !!(testRun && !testRun.finishedAt && !testRun.results.has(id));
  const anyResult = tests.some(tc => results.has(tc.id) || queuedOf(tc.id));

  const addRow = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => add(onAdd)}
        disabled={full}
        className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] text-[12px] font-medium text-primary/60 outline-none transition-[background-color,color,border-color] duration-300 hover:border-white/[0.2] hover:bg-white/[0.03] hover:text-primary focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
        {full ? `${MAX_CASES} tests, the most per run` : "Add test"}
      </button>
      {onSaveRun && !full && (
        <button
          type="button"
          onClick={() => add(onSaveRun)}
          title="A new test with the Input tab as its input and the last run's output as expected"
          className="flex h-9 items-center gap-2 rounded-xl px-3 text-[12px] font-medium text-primary/55 outline-none ring-1 ring-inset ring-white/[0.08] transition-[background-color,color] duration-300 hover:bg-white/[0.04] hover:text-primary focus-visible:ring-2 focus-visible:ring-white/20"
        >
          <CornerDownLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Save last run as test
        </button>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="whitespace-nowrap font-mono text-[11px] text-primary/70">
              {!tests.length ? "" : anyResult ? `${passed} of ${tests.length} passed` : `${tests.length} test${tests.length === 1 ? "" : "s"}`}
            </span>
            {anyResult && (
              <span className="flex min-w-0 flex-wrap items-center gap-1" aria-hidden>
                {tests.map((tc, i) => {
                  const tone = toneOf(results.get(tc.id), queuedOf(tc.id));
                  return <span key={tc.id} title={`Test ${i + 1}`} className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${tone ? DOT[tone] : "bg-white/15"}`} />;
                })}
              </span>
            )}
          </div>
          {tests.length > 0 && (
            <button
              type="button"
              onClick={runAll}
              disabled={busy}
              title="Run all tests (Ctrl+Enter in a test)"
              className="group inline-flex h-8 shrink-0 items-center gap-2 rounded-full bg-primary pl-3.5 pr-1 text-[12px] font-semibold text-black outline-none transition-transform duration-300 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Running" : "Run all"}
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black transition-transform duration-500 group-hover:scale-105">
                {busy ? <Loader2 className="h-3 w-3 animate-spin text-primary" strokeWidth={1.5} /> : <Play className="h-3 w-3 fill-primary text-primary" strokeWidth={1.5} />}
              </span>
            </button>
          )}
        </div>

        {testRun && (
          <div className="truncate font-mono text-[10px] text-primary/40" title={`Run by ${testRun.runBy}`}>
            Run by <span className="text-primary/70">{testRun.runBy}</span>
            {testRun.finishedAt && <> · {new Date(testRun.startedAt).toLocaleTimeString()}</>}
            {testRun.batchCount > 1 && <> · {testRun.finishedAt ? `${testRun.batchCount} batches` : `batch ${testRun.batchIndex}/${testRun.batchCount}`}</>}
            {testRun.timeLimit !== null && <> · {testRun.timeLimit} s per test</>}
            {testRun.interrupted && <> · <span className="text-[#FFB4A8]">interrupted</span></>}
          </div>
        )}

        {tests.length > MAX_CASES && (
          <p className="rounded-lg bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-200/90">
            Only the first {MAX_CASES} tests run. That&apos;s the free plan&apos;s limit per run.
          </p>
        )}
        {runNote && <p className="rounded-lg bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-200/90">{runNote}</p>}
        {testRun?.error && <p role="alert" className="rounded-lg bg-[#FF8A7A]/[0.08] px-3 py-2 text-[11px] text-[#FFB4A8]">{testRun.error}</p>}
        {/* Any skipped test, not just an "incomplete" verdict: with batches, a failure in one batch decides the verdict
            while another batch may still have tests that never started. */}
        {Array.from(results.values()).some(r => r.verdict === "skipped") && (
          <p className="rounded-lg bg-amber-500/[0.08] px-3 py-2 text-[11px] text-amber-200/90">
            Some tests didn&apos;t start in time: the service stops starting tests 45 s into a run. Run again to finish them. Every test runs, and counts, again.
          </p>
        )}
        {testRun?.compileError && (
          <div className="rounded-lg bg-[#FF8A7A]/[0.06] p-3 ring-1 ring-inset ring-[#FF8A7A]/15">
            <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#FFB4A8]/80">Didn&apos;t compile</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary/80">{testRun.compileError}</pre>
          </div>
        )}
      </div>

      {tests.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }} className="flex flex-1 flex-col justify-center gap-4 py-6">
          <div className="text-center">
            <p className="text-sm text-primary/70">Check the program against expected output</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-primary/40">
              Each test gives the program an input and compares what it prints. Everyone in the room sees the results.
            </p>
          </div>
          {addRow}
        </motion.div>
      ) : (
        <ul className="-mr-1 flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1 [scrollbar-color:rgba(255,255,255,0.15)_transparent] [scrollbar-width:thin]">
          <AnimatePresence initial={false}>
            {tests.map((tc, index) => (
              <TestCard
                key={tc.id}
                tc={tc}
                index={index}
                result={results.get(tc.id)}
                queued={queuedOf(tc.id)}
                focus={tc.id === focusId}
                onEdit={onEdit}
                onDelete={remove}
                onRunAll={runAll}
              />
            ))}
          </AnimatePresence>
          <li className="pt-1">{addRow}</li>
        </ul>
      )}

      <AnimatePresence>
        {deleted && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3, ease: EASE }}
            role="status"
            className="flex shrink-0 items-center justify-between gap-3 rounded-xl bg-white/[0.05] py-1.5 pl-3.5 pr-1.5 text-[12px] text-primary/70 ring-1 ring-inset ring-white/[0.08]"
          >
            Test {deleted.index + 1} deleted
            <button
              type="button"
              onClick={() => { onRestore(deleted.tc, deleted.index); setDeleted(null); }}
              className="h-7 rounded-lg px-3 font-medium text-primary outline-none transition-colors duration-300 hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/20"
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

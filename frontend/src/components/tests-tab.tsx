"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { Plus, Trash2, Play, Check, X, AlertCircle, Clock } from "lucide-react";
import type { RunResult } from "@/lib/compilers";

export interface TestCase {
  id: string;
  stdin: string;
  expectedOutput: string;
}

export interface TestResult {
  id: string;
  status: "not-run" | "running" | "pass" | "fail" | "error";
  actual?: string;
  error?: string;
}

const MAX_CASES = 50;
const MAX_FIELD = 10000;
const TIMEOUT_MS = 10000;

const normalize = (s: string) =>
  s.replace(/\r\n/g, "\n").split("\n").map(l => l.trimEnd()).join("\n").trimEnd();

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
  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-inset ring-white/[0.08]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-primary/40">Case {index + 1}</span>
          {queued && <Clock className="h-3.5 w-3.5 animate-pulse text-primary/50" strokeWidth={1.5} />}
          {result?.status === "pass" && <Check className="h-3.5 w-3.5 text-[#5FD0A8]" strokeWidth={1.5} />}
          {result?.status === "fail" && <X className="h-3.5 w-3.5 text-[#F0A27F]" strokeWidth={1.5} />}
          {result?.status === "error" && <AlertCircle className="h-3.5 w-3.5 text-[#E58FB4]" strokeWidth={1.5} />}
        </div>
        <button
          type="button"
          onClick={() => onDelete(tc.id)}
          className="text-primary/40 hover:text-primary"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-mono text-primary/40">stdin</label>
          <textarea
            value={tc.stdin}
            onChange={e => {
              const value = e.target.value.slice(0, MAX_FIELD);
              onEdit(tc.id, "stdin", value);
            }}
            spellCheck={false}
            rows={3}
            className="w-full resize-none rounded-lg bg-black/30 px-2 py-1.5 font-mono text-[11px] text-primary/90 outline-none ring-1 ring-inset ring-white/[0.08] focus:ring-2 focus:ring-white/30"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-mono text-primary/40">expected output</label>
          <textarea
            value={tc.expectedOutput}
            onChange={e => {
              const value = e.target.value.slice(0, MAX_FIELD);
              onEdit(tc.id, "expectedOutput", value);
            }}
            spellCheck={false}
            rows={3}
            className="w-full resize-none rounded-lg bg-black/30 px-2 py-1.5 font-mono text-[11px] text-primary/90 outline-none ring-1 ring-inset ring-white/[0.08] focus:ring-2 focus:ring-white/30"
          />
        </div>
      </div>

      {result?.status === "fail" && result.actual !== undefined && (
        <div className="mt-2 rounded-lg bg-red-500/10 p-2 ring-1 ring-inset ring-red-500/20">
          <div className="mb-1 text-[10px] font-mono text-red-300">actual</div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-primary/90">{result.actual}</pre>
        </div>
      )}
      {result?.status === "error" && result.stderr && (
        <div className="mt-2 rounded-lg bg-orange-500/10 p-2 ring-1 ring-inset ring-orange-500/20">
          <div className="mb-1 text-[10px] font-mono text-orange-300">error</div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] text-primary/90">{result.stderr}</pre>
        </div>
      )}
    </div>
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
  const runningAll = runningBy !== null;

  const runAll = async () => {
    if (runningAll) return;
    
    const runId = crypto.randomUUID();
    
    // Set awareness: running state
    awarenessRef.current?.setLocalStateField("running", { runId, user: { name: user.name, id: user.id } });
    
    // Initialize testRun in Yjs
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
    
    // Mark as finished
    testRunRef.current.set("finishedAt", Date.now());
    awarenessRef.current?.setLocalStateField("running", null);
  };

  const results = testRun?.results || new Map();
  const passed = Array.from(results.values()).filter(r => r.status === "pass").length;
  const total = tests.length;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] font-mono text-primary/50">
          {testRun && (
            <span>
              Run by {testRun.runBy}{testRun.finishedAt ? ` · ${new Date(testRun.startedAt).toLocaleTimeString()}` : "…"}
              {testRun.interrupted && " · interrupted"} · {passed} / {total} passed
            </span>
          )}
          {!testRun && total > 0 && <span>{total} case{total !== 1 ? "s" : ""}</span>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onAdd}
            disabled={tests.length >= MAX_CASES}
            className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium text-primary/70 transition-colors hover:bg-white/[0.06] hover:text-primary disabled:opacity-40"
          >
            <Plus className="h-3 w-3" strokeWidth={1.5} />
            Add
          </button>
          {tests.length > 0 && (
            <button
              type="button"
              onClick={runAll}
              disabled={runningAll}
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              <Play className="h-3 w-3" strokeWidth={1.5} />
              {runningBy ? `Running by ${runningBy}` : "Run all"}
            </button>
          )}
        </div>
      </div>

      {tests.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-1 flex-col items-center justify-center gap-2 text-center"
        >
          <p className="text-sm text-primary/40">No test cases yet.</p>
          <button
            type="button"
            onClick={onAdd}
            className="text-sm text-primary/60 hover:text-primary"
          >
            Add one
          </button>
        </motion.div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
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

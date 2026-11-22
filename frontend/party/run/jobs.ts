// What the room does when someone presses Run or Run all: the backend's request handling and the browser's batch loop,
// now in one place. Everything outside (the Limiter, the API, the clock) comes in as deps, so tests use fakes.
import { maxBatchSize, runTestsPayload, runTestsWithRetry, sanitize, type TestCaseInput, type UpstreamResult } from "./limits";
import { classifyUpstreamFailure, failureFromError, type FailureCode, type Usage } from "./upstream";
import type { Reservation } from "./limiter-core";
import { overallVerdict, statusFromVerdict, type TestResult } from "../../src/lib/test-results";

export const BUSY_RETRY_MS = 3_000;
export const RETRY_NOTE = "The run queue is busy, retrying…";

export type JobDeps = {
  reserve(wantSlots: number, runs: number): Promise<Reservation>;
  release(leaseId: string): unknown;
  refund(runs: number): Promise<unknown>;
  post(path: string, payload: unknown, timeoutMs: number): Promise<UpstreamResult>;
  getUsage(): Promise<Usage>;
  sleep(ms: number): Promise<void>;
  note(text: string | null): void;            // shown to the room while waiting to retry
};

// code: a FailureCode from the API side, or "invalid" for a request the room refuses (bad compiler, no code, ...).
export type JobError = { code: FailureCode | "invalid"; error: string; resets_at?: string | null };
type Outcome<T> = { ok: true; value: T } | { ok: false; error: JobError };

// Codes for calls the API refused before running anything; their runs go back to the daily budget.
const NOT_RUN: ReadonlySet<string> = new Set(["busy", "monthly_cap", "misconfigured", "upstream_down"]);

// One upstream call inside the account-wide cap: reserve slots, call, release, read failures. "busy" (Flux's queue
// or the API's 429) is retried once after 3 s, as the browser used to. A 400 is the user's to read and comes back as is.
// Limiter RPCs can fail in transit (Limiter reset, overloaded). Releasing and refunding are best-effort, so a failure
// there never throws away a result; a lease that isn't released ends on its own after 90 s.
const quietly = async (fn: () => unknown) => { try { await fn(); } catch (err) { console.error("limiter call failed", err); } };
const LIMITER_DOWN: JobError = { code: "upstream_down", error: "Flux's run limiter isn't answering. Try again in a moment." };

export const callWithinCap = async (
  deps: JobDeps, slots: number, runs: number, call: () => Promise<UpstreamResult>,
): Promise<Outcome<UpstreamResult>> => {
  for (let attempt = 0; ; attempt++) {
    let error: JobError;
    let reservation;
    try { reservation = await deps.reserve(slots, runs); }
    catch { return { ok: false, error: LIMITER_DOWN }; }
    if (!reservation.ok) {
      error = reservation.failure.body;            // busy or daily_budget; nothing was counted
    } else {
      let result: UpstreamResult | null = null;
      try {
        result = await call();
      } catch (err) {
        const failure = failureFromError(err);
        error = failure.body;
        if (failure.body.code === "upstream_down") await quietly(() => deps.refund(runs)); // unreachable: never ran. A timeout may have.
      } finally {
        await quietly(() => deps.release(reservation.leaseId));
      }
      if (result) {
        const failure = result.status >= 400 ? await classifyUpstreamFailure(result, deps.getUsage) : null;
        if (!failure) return { ok: true, value: result };
        error = failure.body;
        if (NOT_RUN.has(failure.body.code)) await quietly(() => deps.refund(runs));
      }
    }
    if (error!.code !== "busy" || attempt > 0) return { ok: false, error: error! };
    deps.note(RETRY_NOTE);
    await deps.sleep(BUSY_RETRY_MS);
    deps.note(null);
  }
};

// A 400 relayed from the API carries its own message.
const userError = (result: UpstreamResult): JobError => {
  let message = `Request failed (${result.status})`;
  try { message = JSON.parse(result.text).error ?? message; } catch { /* not JSON */ }
  return { code: "invalid", error: message };
};

export type RunCodeResult = Record<string, unknown>; // the API's run-code-sync answer (docs/run-code)

export const runCode = async (
  deps: JobDeps, job: { compiler: string; code: string; input: string },
): Promise<Outcome<RunCodeResult>> => {
  // 40 s: a run may take the full 30 s (docs/limits) plus compile and network.
  const call = await callWithinCap(deps, 1, 1,
    () => deps.post("/api/run-code-sync/", { compiler: job.compiler, code: job.code, input: sanitize(job.input) }, 40_000));
  if (!call.ok) return call;
  if (call.value.status >= 400) return { ok: false, error: userError(call.value) };
  try { return { ok: true, value: JSON.parse(call.value.text) as RunCodeResult }; }
  catch { return { ok: false, error: { code: "upstream_down", error: "The code runner sent an answer Flux couldn't read." } }; }
};

export type TestCaseJob = TestCaseInput & { id: string };
export type TestRunSummary = {
  results: Record<string, TestResult>;
  verdict: string | null;           // null when a batch failed and later tests never ran
  compileError: string | null;
  error: JobError | null;
  timeLimit: number | null;         // seconds per test; the smallest any batch got
  batchCount: number;
};

// Runs the tests in batches small enough to keep the full time limit, one after another. onBatch is told before each
// batch starts and gets the results so far after each one ends, so the room can share progress.
export const runTests = async (
  deps: JobDeps,
  job: { compiler: string; code: string; tests: TestCaseJob[] },
  onBatch: (progress: { batchIndex: number; batchCount: number; results: Record<string, TestResult> }) => void,
): Promise<TestRunSummary> => {
  const size = maxBatchSize(job.compiler);
  const batches: TestCaseJob[][] = [];
  for (let i = 0; i < job.tests.length; i += size) batches.push(job.tests.slice(i, i + size));

  const results: Record<string, TestResult> = {};
  let compileError: string | null = null, error: JobError | null = null, timeLimit: number | null = null;

  for (let b = 0; b < batches.length && !error && !compileError; b++) {
    const batch = batches[b];
    const failed = (e: JobError): JobError => batches.length > 1 ? { ...e, error: `Batch ${b + 1} of ${batches.length}: ${e.error}` } : e;
    onBatch({ batchIndex: b + 1, batchCount: batches.length, results: { ...results } });
    const payload = runTestsPayload(job.compiler, job.code, batch);
    // The API runs up to 4 of a request's tests at once, so a batch asks for up to 4 slots; each test is one run.
    const call = await callWithinCap(deps, Math.min(batch.length, 4), batch.length,
      () => runTestsWithRetry(payload, p => deps.post("/api/run-tests/", p, 70_000)));
    if (!call.ok) { error = failed(call.error); break; }
    if (call.value.status >= 400) { error = failed(userError(call.value)); break; }

    let data: Record<string, any>;
    try { data = JSON.parse(call.value.text); }
    catch { error = failed({ code: "upstream_down", error: "The code runner sent an answer Flux couldn't read." }); break; }
    if (typeof data.time_limit === "number") timeLimit = Math.min(timeLimit ?? Infinity, data.time_limit);
    if (typeof data.compile_error === "string") compileError = data.compile_error.slice(0, 20000);
    // Results come back in the order the tests were sent (docs/run-tests).
    batch.forEach((tc, i) => {
      const r = Array.isArray(data.tests) ? data.tests[i] : null;
      if (!r || typeof r.verdict !== "string") return;
      const seconds = parseFloat(r.time);
      results[tc.id] = {
        status: statusFromVerdict(r.verdict),
        verdict: r.verdict,
        actual: typeof r.output === "string" ? r.output.slice(0, 20000) : "",
        stderr: typeof r.error === "string" ? r.error.slice(0, 20000) : "",
        ...(Number.isFinite(seconds) ? { durationMs: Math.round(seconds * 1000) } : {}),
        truncated: r.truncated === true,
      };
    });
  }
  // The same code won't compile in later batches either, so they are marked without spending runs on them.
  if (compileError) for (const tc of job.tests) results[tc.id] ??= { status: "error", verdict: "compilation_error" };

  return {
    results,
    verdict: error ? null : overallVerdict(job.tests.map(tc => results[tc.id]?.verdict ?? "skipped")),
    compileError,
    error,
    timeLimit,
    batchCount: batches.length,
  };
};

// @vitest-environment node
// The room's run and test jobs against a fake Limiter and a fake API: no network, no waiting.
import { describe, test } from "vitest";
import assert from "node:assert";
import { RETRY_NOTE, runCode, runTests, type JobDeps, type TestCaseJob } from "./jobs";
import type { UpstreamResult } from "./limits";
import type { Reservation } from "./limiter-core";

const json = (status: number, body: unknown): UpstreamResult => ({ status, contentType: "application/json", text: JSON.stringify(body) });

// answers: what each post() returns in turn (or throws); reservations: what each reserve() returns in turn (default ok).
const fakeDeps = (answers: Array<UpstreamResult | Error>, reservations: Reservation[] = []) => {
  const log = { posts: [] as Array<{ path: string; payload: any }>, reserved: [] as Array<[number, number]>, released: [] as string[],
    refunded: [] as number[], notes: [] as Array<string | null>, slept: [] as number[] };
  let n = 0;
  const deps: JobDeps = {
    async reserve(slots, runs) { log.reserved.push([slots, runs]); return reservations.shift() ?? { ok: true, leaseId: `l${++n}`, slots }; },
    release(id) { log.released.push(id); },
    async refund(runs) { log.refunded.push(runs); },
    async post(path, payload) {
      log.posts.push({ path, payload });
      const a = answers.shift();
      if (!a) throw new Error("no more fake answers");
      if (a instanceof Error) throw a;
      return a;
    },
    async getUsage() { return { remaining: 50_000, monthly_limit: 100_000 }; },
    async sleep(ms) { log.slept.push(ms); },
    note(text) { log.notes.push(text); },
  };
  return { deps, log };
};
const busyReservation: Reservation = { ok: false, failure: { status: 503, body: { code: "busy", error: "The run queue is busy." } } };
const timeoutError = () => { const e = new Error("timed out"); e.name = "TimeoutError"; return e; };

describe("Limiter failures", () => {
  test("a reserve that fails becomes an error the room can show", async () => {
    const { deps } = fakeDeps([]);
    deps.reserve = async () => { throw new Error("rpc reset"); };
    const r = await runCode(deps, { compiler: "python-3.14", code: "x", input: "" });
    assert.ok(!r.ok && r.error.code === "upstream_down");
  });

  test("a release that fails doesn't throw away a finished run", async () => {
    const { deps } = fakeDeps([json(200, { output: "kept" })]);
    deps.release = () => { throw new Error("rpc reset"); };
    const r = await runCode(deps, { compiler: "python-3.14", code: "x", input: "" });
    assert.ok(r.ok && r.value.output === "kept");
  });
});

describe("runCode", () => {
  test("a normal run: one slot, one run, released, the API's answer back", async () => {
    const { deps, log } = fakeDeps([json(200, { output: "hi\n", exit_code: 0 })]);
    const r = await runCode(deps, { compiler: "python-3.14", code: "print('hi')", input: "x\r\n" });
    assert.ok(r.ok && r.value.output === "hi\n");
    assert.deepStrictEqual(log.reserved, [[1, 1]]);
    assert.deepStrictEqual(log.released, ["l1"]);
    assert.strictEqual(log.posts[0].payload.input, "x\n", "stdin sanitized");
    assert.deepStrictEqual(log.refunded, []);
  });

  test("busy is retried once after 3 s, with a note for the room", async () => {
    const { deps, log } = fakeDeps([json(200, { output: "ok" })], [busyReservation]);
    const r = await runCode(deps, { compiler: "python-3.14", code: "x", input: "" });
    assert.ok(r.ok);
    assert.deepStrictEqual(log.slept, [3000]);
    assert.deepStrictEqual(log.notes, [RETRY_NOTE, null], "note shown, then cleared");
  });

  test("busy twice gives up; the API's own 429 counts as busy and is refunded", async () => {
    const { deps, log } = fakeDeps([json(429, { error: "Too many runs" }), json(429, { error: "Too many runs" })]);
    const r = await runCode(deps, { compiler: "python-3.14", code: "x", input: "" });
    assert.ok(!r.ok && r.error.code === "busy");
    assert.strictEqual(log.posts.length, 2, "one retry");
    assert.deepStrictEqual(log.refunded, [1, 1], "the API ran neither");
    assert.deepStrictEqual(log.released, ["l1", "l2"], "slots always released");
  });

  test("a timeout keeps the run counted (it may have run); an unreachable API refunds it", async () => {
    const t = fakeDeps([timeoutError()]);
    const r1 = await runCode(t.deps, { compiler: "python-3.14", code: "x", input: "" });
    assert.ok(!r1.ok && r1.error.code === "upstream_timeout");
    assert.deepStrictEqual(t.log.refunded, []);
    const u = fakeDeps([new TypeError("fetch failed")]);
    const r2 = await runCode(u.deps, { compiler: "python-3.14", code: "x", input: "" });
    assert.ok(!r2.ok && r2.error.code === "upstream_down");
    assert.deepStrictEqual(u.log.refunded, [1]);
  });

  test("a 400 from the API is the user's to read; the daily budget refusal is passed on", async () => {
    const { deps } = fakeDeps([json(400, { error: "Unknown compiler" })]);
    const r = await runCode(deps, { compiler: "python-3.14", code: "x", input: "" });
    assert.ok(!r.ok && r.error.code === "invalid" && r.error.error === "Unknown compiler");
    const over = fakeDeps([], [{ ok: false, failure: { status: 429, body: { code: "daily_budget", error: "Flux has used today's runs.", resets_at: "2026-11-23T00:00:00.000Z" } } }]);
    const r2 = await runCode(over.deps, { compiler: "python-3.14", code: "x", input: "" });
    assert.ok(!r2.ok && r2.error.code === "daily_budget" && r2.error.resets_at === "2026-11-23T00:00:00.000Z");
    assert.strictEqual(over.log.posts.length, 0, "nothing sent");
  });
});

const tests = (n: number, wrongAt = -1): TestCaseJob[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, input: String(i + 1), expected_output: String((i + 1) * 2) + (i === wrongAt ? "x" : "") }));
const batchAnswer = (verdicts: string[], extra: Record<string, unknown> = {}) =>
  json(200, { verdict: "accepted", time_limit: 10, compile_error: null, tests: verdicts.map(v => ({ verdict: v, output: "2\n", error: "", time: "0.0400" })), ...extra });

describe("runTests", () => {
  test("20 tests go as 16 + 4, results merged in order, progress reported before each batch", async () => {
    const verdicts1 = Array.from({ length: 16 }, () => "accepted");
    const verdicts2 = ["accepted", "wrong_answer", "accepted", "accepted"];
    const { deps, log } = fakeDeps([batchAnswer(verdicts1), batchAnswer(verdicts2)]);
    const progress: Array<[number, number, number]> = [];
    const s = await runTests(deps, { compiler: "python-3.14", code: "x", tests: tests(20) }, p => progress.push([p.batchIndex, p.batchCount, Object.keys(p.results).length]));
    assert.deepStrictEqual(progress, [[1, 2, 0], [2, 2, 16]]);
    assert.deepStrictEqual(log.reserved, [[4, 16], [4, 4]], "up to 4 slots, one run per test");
    assert.strictEqual(log.posts[0].payload.tests.length, 16);
    assert.strictEqual(log.posts[0].payload.time_limit, 10);
    assert.strictEqual(s.results.t18.verdict, "wrong_answer", "the 2nd test of batch 2 is test 18");
    assert.strictEqual(s.results.t18.status, "fail");
    assert.strictEqual(s.results.t1.durationMs, 40);
    assert.deepStrictEqual([s.verdict, s.batchCount, s.timeLimit, s.error], ["wrong_answer", 2, 10, null]);
  });

  test("a compile error stops later batches and marks their tests without running them", async () => {
    const { deps, log } = fakeDeps([batchAnswer(Array.from({ length: 16 }, () => "compilation_error"), { compile_error: "main.c:1: error" })]);
    const s = await runTests(deps, { compiler: "gcc-15", code: "x", tests: tests(20) }, () => {});
    assert.strictEqual(log.posts.length, 1, "batch 2 never sent");
    assert.strictEqual(s.compileError, "main.c:1: error");
    assert.strictEqual(s.results.t20.verdict, "compilation_error");
    assert.strictEqual(s.verdict, "compilation_error");
  });

  test("a failure in batch 2 says so, keeps batch 1's results, and claims no verdict", async () => {
    const over: Reservation = { ok: false, failure: { status: 429, body: { code: "daily_budget", error: "Flux has used today's runs." } } };
    const { deps } = fakeDeps([batchAnswer(Array.from({ length: 16 }, () => "accepted"))], [{ ok: true, leaseId: "a", slots: 4 }, over]);
    const s = await runTests(deps, { compiler: "python-3.14", code: "x", tests: tests(20) }, () => {});
    assert.strictEqual(s.error?.code, "daily_budget");
    assert.strictEqual(s.error?.error, "Batch 2 of 2: Flux has used today's runs.");
    assert.strictEqual(Object.keys(s.results).length, 16);
    assert.strictEqual(s.verdict, null);
  });

  test("F# batches of 12 keep the full 10 s", async () => {
    const { deps, log } = fakeDeps([batchAnswer(Array.from({ length: 12 }, () => "accepted")), batchAnswer(["accepted"])]);
    await runTests(deps, { compiler: "dotnet-fsharp-10", code: "x", tests: tests(13) }, () => {});
    assert.deepStrictEqual(log.posts.map(p => [p.payload.tests.length, p.payload.time_limit]), [[12, 10], [1, 10]]);
  });
});

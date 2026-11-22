// @vitest-environment node
// The Worker's run modules (party/run). Ported from backend/server.test.js; no network, the API is replaced by fakes.
import { describe, test } from "vitest";
import assert from "node:assert";
import { maxBatchSize, runTestsPayload, runTestsWithRetry, sanitize, suggestedTimeLimit, testTimeLimit, type UpstreamResult } from "./limits";
import { localCompilers, parseCompilerList, resolveCompiler } from "./compilers";
import { classifyUpstreamFailure, failureFromError, type Usage } from "./upstream";
import { checkCode, checkTests, ROOM_RE } from "./validate";
import { STATUS_TTL_MS, summarizeStatus, TtlCache } from "./status";
import { BusyError, SlotPool } from "./slots";

const result = (status: number, body: unknown): UpstreamResult =>
  ({ status, contentType: "application/json", text: typeof body === "string" ? body : JSON.stringify(body) });

describe("limits", () => {
  test("testTimeLimit matches the API's suggested limits, capped at 10 s", () => {
    // [compiler, tests, largest time_limit the API accepted], from its 400 refusals
    const measured: Array<[string, number, number]> = [
      ["python-3.14", 5, 27], ["python-3.14", 9, 17], ["python-3.14", 16, 12], ["python-3.14", 17, 8.2],
      ["python-3.14", 24, 6], ["python-3.14", 28, 4.5], ["python-3.14", 32, 3.4], ["g++-15", 32, 3.4],
      ["openjdk-25", 5, 26], ["openjdk-25", 32, 2.4], ["groovy-6.0", 32, 1.9], ["dotnet-fsharp-10", 32, 0.9],
    ];
    for (const [compiler, n, apiMax] of measured) {
      assert.strictEqual(testTimeLimit(compiler, n), Math.min(10, apiMax), `${compiler} × ${n}`);
    }
    for (let n = 1; n <= 4; n++) assert.strictEqual(testTimeLimit("python-3.14", n), 10);
  });

  test("maxBatchSize is the largest batch that keeps the full 10 s", () => {
    for (const compiler of ["python-3.14", "g++-15", "openjdk-25", "groovy-6.0", "dotnet-fsharp-9", "dotnet-fsharp-10"]) {
      const n = maxBatchSize(compiler);
      assert.strictEqual(testTimeLimit(compiler, n), 10, `${compiler} batch ${n} keeps 10 s`);
      assert.ok(n === 32 || testTimeLimit(compiler, n + 1) < 10, `${compiler}: ${n + 1} would lose time`);
    }
    assert.strictEqual(maxBatchSize("python-3.14"), 16);
    assert.strictEqual(maxBatchSize("dotnet-fsharp-10"), 12);
  });

  test("suggestedTimeLimit reads the API's advice and nothing else", () => {
    assert.strictEqual(suggestedTimeLimit("32 tests need up to 104 seconds, over the 60-second limit for one request; use time_limit 3.4 or less"), 3.4);
    assert.strictEqual(suggestedTimeLimit("... use time_limit 27 or less"), 27);
    assert.strictEqual(suggestedTimeLimit("Unknown compiler"), null);
    assert.strictEqual(suggestedTimeLimit(undefined), null);
    assert.strictEqual(suggestedTimeLimit("use time_limit 0 or less"), null);
    assert.strictEqual(suggestedTimeLimit("use time_limit 99 or less"), null);
  });

  test("runTestsWithRetry retries once with the advised limit", async () => {
    const sent: number[] = [];
    const refuse = result(400, { error: "5 tests need up to 68 seconds, over the 60-second limit for one request; use time_limit 2.4 or less" });
    const ok = result(200, { verdict: "accepted" });
    const payload = runTestsPayload("python-3.14", "print(1)", []);
    const out = await runTestsWithRetry({ ...payload, time_limit: 10 }, async p => (sent.push(p.time_limit), sent.length === 1 ? refuse : ok));
    assert.deepStrictEqual(sent, [10, 2.4]);
    assert.strictEqual(out, ok);
  });

  test("runTestsWithRetry does not retry other refusals, or twice", async () => {
    const payload = { ...runTestsPayload("python-3.14", "print(1)", []), time_limit: 10 };
    const other = result(400, { error: "Unknown compiler" });
    let calls = 0;
    assert.strictEqual(await runTestsWithRetry(payload, async () => (calls++, other)), other);
    assert.strictEqual(calls, 1);

    const always = result(400, { error: "use time_limit 2 or less" });
    const seen: number[] = [];
    assert.strictEqual(await runTestsWithRetry(payload, async p => (seen.push(p.time_limit), always)), always);
    assert.deepStrictEqual(seen, [10, 2], "one retry, then the refusal is relayed");

    const notJson: UpstreamResult = { status: 400, contentType: "text/plain", text: "Bad Request" };
    assert.strictEqual(await runTestsWithRetry(payload, async () => notJson), notJson);
  });

  test("runTestsPayload sanitizes inputs and picks the time limit for the batch size", () => {
    const p = runTestsPayload("python-3.14", "print(1)", [{ input: "1 2\r\n", expected_output: "3" }]);
    assert.deepStrictEqual(p.tests, [{ input: "1 2\n", expected_output: "3" }]);
    assert.strictEqual(p.time_limit, 10);
    assert.deepStrictEqual([p.checker, p.scoring], ["trim", "percent"]);
  });

  test("sanitize turns CRLF into LF and drops control characters", () => {
    assert.strictEqual(sanitize("1 2\r\n3 4\r\n"), "1 2\n3 4\n");
    assert.strictEqual(sanitize("a\tb\x00c\x07"), "a\tbc");
    assert.strictEqual(sanitize(42), "");
  });
});

describe("slots", () => {
  test("a full cap queues, and a freed slot lets the next request in", async () => {
    const pool = new SlotPool(4, 200);
    const all = await pool.acquire(4);
    assert.strictEqual(all.slots, 4);
    let got: number | null = null;
    const waiter = pool.acquire(1).then(l => { got = l.slots; return l; });
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(got, null, "waits while every slot is taken");
    pool.release(all.id);
    const lease = await waiter;
    assert.strictEqual(got, 1, "starts once a slot frees up");
    pool.release(lease.id);
    assert.strictEqual(pool.freeSlots, 4);
  });

  test("waiting longer than the queue time rejects as busy", async () => {
    const pool = new SlotPool(4, 200);
    const all = await pool.acquire(4);
    const t0 = Date.now();
    await assert.rejects(pool.acquire(1), BusyError);
    assert.ok(Date.now() - t0 >= 180, "waited for the queue time first");
    pool.release(all.id);
    assert.strictEqual((await pool.acquire(4)).slots, 4, "every slot is free again afterwards");
  });

  test("a batch takes what is free, so nothing waits behind it while a slot is free", async () => {
    const pool = new SlotPool(4, 200);
    const run = await pool.acquire(1);              // a long run in another room
    const batch = await pool.acquire(4);
    assert.strictEqual(batch.slots, 3, "the batch starts at once with the 3 free slots");
    let got: number | null = null;
    const next = pool.acquire(1).then(l => { got = l.slots; return l; });
    await new Promise(r => setTimeout(r, 50));
    assert.strictEqual(got, null, "now everything is taken, so the next run waits");
    pool.release(run.id);
    const nextLease = await next;
    assert.strictEqual(got, 1, "and gets the freed slot");
    pool.release(nextLease.id); pool.release(batch.id);
    assert.strictEqual(pool.freeSlots, 4, "all slots accounted for");
  });

  test("a full queue refuses at once", async () => {
    const pool = new SlotPool(1, 1000, 2);
    const first = await pool.acquire(1);
    const a = pool.acquire(1), b = pool.acquire(1);
    await assert.rejects(pool.acquire(1), BusyError);
    pool.release(first.id); pool.release((await a).id); pool.release((await b).id);
    assert.strictEqual(pool.freeSlots, 1);
  });

  test("a lease that is never released (crashed room) ends on its own", async () => {
    let clock = 1_000_000;
    const pool = new SlotPool(4, 200, 16, 90_000, () => clock);
    const lost = await pool.acquire(4);
    clock += 89_000;
    assert.strictEqual(pool.freeSlots, 0, "still held inside 90 s");
    clock += 2_000;
    assert.strictEqual(pool.freeSlots, 4, "freed after 90 s");
    pool.release(lost.id);
    assert.strictEqual(pool.freeSlots, 4, "a late release of the expired lease frees nothing twice");
  });

  test("a waiter gets a slot whose lease ran out while it waited", async () => {
    let clock = 1_000_000;
    const pool = new SlotPool(1, 200, 16, 90_000, () => clock);
    await pool.acquire(1);                         // never released
    const waiter = pool.acquire(1);
    clock += 91_000;                               // the lease runs out during the wait
    const lease = await waiter;                    // checked once more at the queue deadline instead of "busy"
    assert.strictEqual(lease.slots, 1);
  });

  test("releasing twice, or an unknown id, changes nothing", async () => {
    const pool = new SlotPool(2, 200);
    const lease = await pool.acquire(1);
    pool.release(lease.id); pool.release(lease.id); pool.release("nope");
    assert.strictEqual(pool.freeSlots, 2);
  });
});

describe("validate", () => {
  test("room ids: anything the room page can open, but no control characters", () => {
    for (const ok of ["reproRoom42", "my-room", "room_1", "a", "Ünïcødé"]) assert.ok(ROOM_RE.test(ok), ok);
    for (const bad of ["", "x".repeat(129), "a\nb", "a\x00b"]) assert.ok(!ROOM_RE.test(bad), JSON.stringify(bad));
  });

  test("checkCode resolves the compiler and rejects empty, oversized or binary code", () => {
    assert.deepStrictEqual(checkCode({ compiler: "dotnet-csharp-9", code: "x" }, null), { ok: true, value: { compiler: "dotnet-csharp-10", code: "x" } });
    assert.deepStrictEqual(checkCode({ compiler: "nope", code: "x" }, null), { ok: false, error: "Unknown compiler" });
    assert.deepStrictEqual(checkCode({ compiler: "python-3.14", code: "  " }, null), { ok: false, error: "Code is required" });
    assert.deepStrictEqual(checkCode({ compiler: "python-3.14", code: "x".repeat(100_001) }, null), { ok: false, error: "Code exceeds 100KB" });
    assert.deepStrictEqual(checkCode({ compiler: "python-3.14", code: "a\x01b" }, null), { ok: false, error: "Code contains invalid characters" });
  });

  test("checkTests wants 1 to 32 tests with text fields of at most 10,000 characters", () => {
    assert.strictEqual(checkTests([]).ok, false);
    assert.strictEqual(checkTests(Array.from({ length: 33 }, () => ({ input: "", expected_output: "" }))).ok, false);
    assert.strictEqual(checkTests([{ stdin: "", expectedOutput: "" }]).ok, false);
    assert.strictEqual(checkTests([{ input: "x".repeat(10_001), expected_output: "" }]).ok, false);
    assert.strictEqual(checkTests([{ input: "1", expected_output: "2" }]).ok, true);
  });
});

describe("upstream failures", () => {
  test("map to codes the browser can act on", async () => {
    const err = (status: number, error: string) => ({ status, text: JSON.stringify({ error }) });
    const usage = (u: Usage | null) => async () => u as Usage;
    const busy = await classifyUpstreamFailure(err(429, "Too many runs at once"), usage({ remaining: 5000, resets_at: "2026-12-01T00:00:00Z" }));
    assert.deepStrictEqual([busy?.status, busy?.body.code], [503, "busy"]);
    const cap = await classifyUpstreamFailure(err(429, "Monthly limit"), usage({ remaining: 0, resets_at: "2026-12-01T00:00:00Z" }));
    assert.deepStrictEqual([cap?.status, cap?.body.code, cap?.body.resets_at], [429, "monthly_cap", "2026-12-01T00:00:00Z"]);
    const keyCap = await classifyUpstreamFailure(err(429, "Key limit"), usage({ remaining: 900, key: { remaining: 0 } }));
    assert.strictEqual(keyCap?.body.code, "monthly_cap");
    const unknown = await classifyUpstreamFailure(err(429, "?"), async () => { throw new Error("offline"); });
    assert.strictEqual(unknown?.body.code, "busy", "if usage can't be read, assume busy (one retry follows)");
    assert.strictEqual((await classifyUpstreamFailure(err(503, "Execution queue unavailable"), usage(null)))?.body.code, "upstream_down");
    assert.strictEqual((await classifyUpstreamFailure(err(404, "Invalid API key"), usage(null)))?.body.code, "misconfigured");
    assert.strictEqual(await classifyUpstreamFailure(err(400, "Unknown compiler"), usage(null)), null, "400s are relayed as they are");
  });

  test("a thrown fetch error is a timeout or the API being unreachable", () => {
    const timeout = new Error("t"); timeout.name = "TimeoutError";
    assert.strictEqual(failureFromError(timeout).body.code, "upstream_timeout");
    assert.strictEqual(failureFromError(new TypeError("fetch failed")).body.code, "upstream_down");
  });
});

describe("compilers", () => {
  test("the local table is the fallback list, retired ids resolve", () => {
    for (const id of ["python-3.14", "nodejs-24", "kotlin-2.4", "swift-6.4", "g++-15-cpp20", "bash-5.2", "r-4.6", "lua-5.5", "dotnet-csharp-10"]) {
      assert.ok(localCompilers.ids.has(id), `${id} in the frontend table`);
    }
    assert.strictEqual(resolveCompiler("dotnet-csharp-9"), "dotnet-csharp-10", "an old room's id runs as its successor");
    assert.strictEqual(resolveCompiler("sqlite-3"), null, "not in the local table yet");
    assert.strictEqual(resolveCompiler("nope"), null);
    assert.strictEqual(resolveCompiler(42), null);
  });

  test("the API's list wins once loaded, with its retired map", () => {
    const api = parseCompilerList({ compilers: [{ id: "python-3.14", name: "Python" }, { id: "zig-0.17", name: "Zig" }], retired: { "python-3.13": "python-3.14" } });
    assert.strictEqual(resolveCompiler("zig-0.17", api), "zig-0.17", "any id the API lists is accepted");
    assert.strictEqual(resolveCompiler("python-3.13", api), "python-3.14", "the API's retired map applies");
    assert.strictEqual(resolveCompiler("dotnet-fsharp-9", api), null, "mapped by the local retired map, but the API doesn't list the successor");
    assert.strictEqual(parseCompilerList({ compilers: [] }), null, "an empty list is ignored, keeping the last good one");
    assert.strictEqual(parseCompilerList({ error: "x" }), null);
  });
});

describe("status", () => {
  test("runs left uses the tighter of account and key; health maps to ok/down/unknown", () => {
    const usage: Usage = { remaining: 95_000, monthly_limit: 100_000, resets_at: "2026-12-01T00:00:00Z", key: { remaining: 200, monthly_limit: 5_000 } };
    const s = summarizeStatus(usage, { status: "ok" });
    assert.deepStrictEqual([s.runs_left, s.monthly_limit, s.resets_at, s.service], [200, 5_000, "2026-12-01T00:00:00Z", "ok"], "the key's 4% beats the account's 95%");
    assert.strictEqual(summarizeStatus({ ...usage, key: { remaining: null, monthly_limit: null } }, { status: "ok" }).runs_left, 95_000, "a key with no limit is ignored");
    assert.strictEqual(summarizeStatus(usage, { status: "down" }).service, "down");
    assert.strictEqual(summarizeStatus(null, null).service, "unknown");
    assert.strictEqual(summarizeStatus(null, { status: "ok" }).runs_left, null, "usage unreadable (e.g. no key): no runs-left figure");
  });

  test("cached for 60 s, and concurrent requests share one load", async () => {
    let loads = 0, clock = 1_000_000;
    const load = async () => { loads++; await new Promise(r => setTimeout(r, 20)); return { service: "ok", n: loads }; };
    const cache = new TtlCache(STATUS_TTL_MS, load, () => clock);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    assert.strictEqual(loads, 1, "two requests at once, one load");
    assert.strictEqual(a, b);
    clock += STATUS_TTL_MS - 1000;
    await cache.get();
    assert.strictEqual(loads, 1, "still fresh inside 60 s");
    clock += 2000;
    const later = await cache.get();
    assert.strictEqual(loads, 2, "reloaded after 60 s");
    assert.strictEqual(later.n, 2);

    let fail = true;
    const flaky = new TtlCache(STATUS_TTL_MS, async () => { if (fail) throw new Error("down"); return { service: "ok" }; });
    await assert.rejects(flaky.get());
    fail = false;
    assert.strictEqual((await flaky.get()).service, "ok", "a failed load isn't cached");
  });
});

// Run with: npm test (node --test). No network: the API is replaced by fakes.
const test = require("node:test");
const assert = require("node:assert");
process.env.FLUX_QUEUE_WAIT_MS = "200"; // set before loading server.js, so "busy" takes 0.2 s here, not 10 s
const {
  testTimeLimit, maxBatchSize, suggestedTimeLimit, runTestsWithRetry, sanitize,
  acquireSlots, releaseSlots, BusyError, lockRoom, unlockRoom, sweepRoomLocks, roomLocks, classifyUpstreamFailure,
  nextBatchWillCome, ROOM_RE, parseCompilerList, resolveCompiler, localCompilers,
  summarizeStatus, getStatus, resetStatusCache, STATUS_TTL_MS,
} = require("./server.js");

test("testTimeLimit matches the API's suggested limits, capped at 10 s", () => {
  // [compiler, tests, largest time_limit the API accepted], from its 400 refusals
  const measured = [
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
  const sent = [];
  const refuse = { status: 400, contentType: "application/json", text: JSON.stringify({ error: "5 tests need up to 68 seconds, over the 60-second limit for one request; use time_limit 2.4 or less" }) };
  const ok = { status: 200, contentType: "application/json", text: "{\"verdict\":\"accepted\"}" };
  const result = await runTestsWithRetry({ time_limit: 10, tests: [] }, async p => (sent.push(p.time_limit), sent.length === 1 ? refuse : ok));
  assert.deepStrictEqual(sent, [10, 2.4]);
  assert.strictEqual(result, ok);
});

test("runTestsWithRetry does not retry other refusals, or twice", async () => {
  const calls = [];
  const other = { status: 400, contentType: "application/json", text: JSON.stringify({ error: "Unknown compiler" }) };
  assert.strictEqual(await runTestsWithRetry({ time_limit: 10 }, async p => (calls.push(p), other)), other);
  assert.strictEqual(calls.length, 1);

  const always = { status: 400, contentType: "application/json", text: JSON.stringify({ error: "use time_limit 2 or less" }) };
  const seen = [];
  assert.strictEqual(await runTestsWithRetry({ time_limit: 10 }, async p => (seen.push(p.time_limit), always)), always);
  assert.deepStrictEqual(seen, [10, 2]); // one retry, then the refusal is relayed

  const notJson = { status: 400, contentType: "text/plain", text: "Bad Request" };
  assert.strictEqual(await runTestsWithRetry({ time_limit: 10 }, async () => notJson), notJson);
});

test("sanitize turns CRLF into LF and drops control characters", () => {
  assert.strictEqual(sanitize("1 2\r\n3 4\r\n"), "1 2\n3 4\n");
  assert.strictEqual(sanitize("a\tb\x00c\x07"), "a\tbc");
  assert.strictEqual(sanitize(42), "");
});

test("slots: a full cap queues, and a freed slot lets the next request in", async () => {
  assert.strictEqual(await acquireSlots(4), 4); // all four taken (a 16-test batch)
  let got = null;
  const waiter = acquireSlots(1).then(n => { got = n; });
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(got, null, "waits while every slot is taken");
  releaseSlots(4);
  await waiter;
  assert.strictEqual(got, 1, "starts once a slot frees up");
  releaseSlots(1);
});

test("slots: waiting longer than the queue time rejects as busy", async () => {
  await acquireSlots(4);
  const t0 = Date.now();
  await assert.rejects(acquireSlots(1), BusyError);
  assert.ok(Date.now() - t0 >= 180, "waited for the queue time first");
  releaseSlots(4);
  assert.strictEqual(await acquireSlots(4), 4, "every slot is free again afterwards");
  releaseSlots(4);
});

test("slots: a batch takes what is free, so nothing waits behind it while a slot is free", async () => {
  assert.strictEqual(await acquireSlots(1), 1);  // a long /run in another room
  assert.strictEqual(await acquireSlots(4), 3, "the batch starts at once with the 3 free slots");
  let got = null;
  const run = acquireSlots(1).then(n => { got = n; });
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(got, null, "now everything is taken, so the next /run waits");
  releaseSlots(1);                               // the long /run ends
  await run;
  assert.strictEqual(got, 1, "and gets the freed slot");
  releaseSlots(1); releaseSlots(3);
  assert.strictEqual(await acquireSlots(4), 4, "all slots accounted for");
  releaseSlots(4);
});

test("room lock: one run per room; its own requests pass; kept only for a coming request", () => {
  roomLocks.clear();
  assert.strictEqual(lockRoom("roomAAAA", "run-1"), true);
  assert.strictEqual(lockRoom("roomAAAA", "run-2"), false, "another run in the same room is refused");
  assert.strictEqual(lockRoom("roomBBBB", "run-2"), true, "other rooms are independent");
  unlockRoom("roomBBBB", 0);

  unlockRoom("roomAAAA", 10_000);               // batch 1 of run-1 done, more to come
  assert.strictEqual(lockRoom("roomAAAA", "run-2"), false, "kept between batches");
  assert.strictEqual(lockRoom("roomAAAA", "run-1"), true, "run-1's next batch passes");
  unlockRoom("roomAAAA", 0);                    // final batch
  assert.strictEqual(roomLocks.has("roomAAAA"), false, "released after the final batch");
  assert.strictEqual(lockRoom("roomAAAA", "run-2"), true, "free for the next run");
  unlockRoom("roomAAAA", 0);
});

test("room lock: a kept lock whose next request never came expires and is swept", () => {
  roomLocks.clear();
  lockRoom("roomCCCC", "run-1");
  unlockRoom("roomCCCC", 10_000);
  roomLocks.get("roomCCCC").heldUntil = Date.now() - 1; // as if the gap had passed
  assert.strictEqual(lockRoom("roomCCCC", "run-2"), true, "an expired lock doesn't block");
  unlockRoom("roomCCCC", 10_000);
  roomLocks.get("roomCCCC").heldUntil = Date.now() - 1;
  sweepRoomLocks();
  assert.strictEqual(roomLocks.size, 0, "sweep removes it");
});

test("the lock is kept for a next batch only when one will come", () => {
  const ok = (body) => ({ status: 200, text: JSON.stringify(body) });
  assert.strictEqual(nextBatchWillCome(ok({ verdict: "accepted", compile_error: null })), true);
  assert.strictEqual(nextBatchWillCome(ok({ verdict: "compilation_error", compile_error: "code.cc:2: error" })), false, "the browser stops after a compile error");
  assert.strictEqual(nextBatchWillCome({ status: 400, text: JSON.stringify({ error: "use time_limit 2 or less" }) }), false, "or after a refusal");
  assert.strictEqual(nextBatchWillCome({ status: 200, text: "not json" }), false);
});

test("room ids: anything the room page can open, but no control characters", () => {
  for (const ok of ["reproRoom42", "my-room", "room_1", "a", "Ünïcødé"]) assert.ok(ROOM_RE.test(ok), ok);
  for (const bad of ["", "x".repeat(129), "a\nb", "a\x00b"]) assert.ok(!ROOM_RE.test(bad), JSON.stringify(bad));
});

test("upstream failures map to codes the browser can act on", async () => {
  const err = (status, error) => ({ status, text: JSON.stringify({ error }) });
  const usage = (u) => async () => u;
  const busy = await classifyUpstreamFailure(err(429, "Too many runs at once"), usage({ remaining: 5000, resets_at: "2026-12-01T00:00:00Z" }));
  assert.deepStrictEqual([busy.status, busy.body.code], [503, "busy"]);
  const cap = await classifyUpstreamFailure(err(429, "Monthly limit"), usage({ remaining: 0, resets_at: "2026-12-01T00:00:00Z" }));
  assert.deepStrictEqual([cap.status, cap.body.code, cap.body.resets_at], [429, "monthly_cap", "2026-12-01T00:00:00Z"]);
  const keyCap = await classifyUpstreamFailure(err(429, "Key limit"), usage({ remaining: 900, key: { remaining: 0 } }));
  assert.strictEqual(keyCap.body.code, "monthly_cap");
  const unknown = await classifyUpstreamFailure(err(429, "?"), async () => { throw new Error("offline"); });
  assert.strictEqual(unknown.body.code, "busy", "if usage can't be read, assume busy (the client retries once)");
  assert.strictEqual((await classifyUpstreamFailure(err(503, "Execution queue unavailable"), usage(null))).body.code, "upstream_down");
  assert.strictEqual((await classifyUpstreamFailure(err(404, "Invalid API key"), usage(null))).body.code, "misconfigured");
  assert.strictEqual(await classifyUpstreamFailure(err(400, "Unknown compiler"), usage(null)), null, "400s are relayed as they are");
});

test("compiler ids: the local table is the fallback list, retired ids resolve", () => {
  for (const id of ["python-3.14", "nodejs-24", "kotlin-2.4", "swift-6.4", "g++-15-cpp20", "bash-5.2", "r-4.6", "lua-5.5", "dotnet-csharp-10"]) {
    assert.ok(localCompilers.ids.has(id), `${id} in the frontend table`);
  }
  assert.strictEqual(resolveCompiler("dotnet-csharp-9"), "dotnet-csharp-10", "an old room's id runs as its successor");
  assert.strictEqual(resolveCompiler("sqlite-3"), null, "not in the local table (skipped for now)");
  assert.strictEqual(resolveCompiler("nope"), null);
  assert.strictEqual(resolveCompiler(42), null);
});

test("compiler ids: the API's list wins once loaded, with its retired map", () => {
  const api = parseCompilerList({ compilers: [{ id: "python-3.14", name: "Python" }, { id: "zig-0.17", name: "Zig" }], retired: { "python-3.13": "python-3.14" } });
  assert.strictEqual(resolveCompiler("zig-0.17", api), "zig-0.17", "any id the API lists is accepted");
  assert.strictEqual(resolveCompiler("python-3.13", api), "python-3.14", "the API's retired map applies");
  assert.strictEqual(resolveCompiler("dotnet-fsharp-9", api), null, "mapped by the local retired map, but the API doesn't list the successor");
  assert.strictEqual(parseCompilerList({ compilers: [] }), null, "an empty list is ignored, keeping the last good one");
  assert.strictEqual(parseCompilerList({ error: "x" }), null);
});

test("status: runs left uses the tighter of account and key; health maps to ok/down/unknown", () => {
  const usage = { remaining: 95_000, monthly_limit: 100_000, resets_at: "2026-12-01T00:00:00Z", key: { remaining: 200, monthly_limit: 5_000 } };
  const s = summarizeStatus(usage, { status: "ok" });
  assert.deepStrictEqual([s.runs_left, s.monthly_limit, s.resets_at, s.service], [200, 5_000, "2026-12-01T00:00:00Z", "ok"], "the key's 4% beats the account's 95%");
  assert.strictEqual(summarizeStatus({ ...usage, key: { remaining: null, monthly_limit: null } }, { status: "ok" }).runs_left, 95_000, "a key with no limit is ignored");
  assert.strictEqual(summarizeStatus(usage, { status: "down", checks: { sandbox: "failed" } }).service, "down");
  assert.strictEqual(summarizeStatus(null, null).service, "unknown");
  assert.strictEqual(summarizeStatus(null, { status: "ok" }).runs_left, null, "usage unreadable (e.g. no key): no runs-left figure");
});

test("status: cached for 60 s, and concurrent requests share one load", async () => {
  resetStatusCache();
  let loads = 0;
  const load = async () => { loads++; await new Promise(r => setTimeout(r, 20)); return { service: "ok", n: loads }; };
  const [a, b] = await Promise.all([getStatus(load), getStatus(load)]);
  assert.strictEqual(loads, 1, "two requests at once, one load");
  assert.strictEqual(a, b);
  await getStatus(load, Date.now() + STATUS_TTL_MS - 1000);
  assert.strictEqual(loads, 1, "still fresh inside 60 s");
  const later = await getStatus(load, Date.now() + STATUS_TTL_MS + 1000);
  assert.strictEqual(loads, 2, "reloaded after 60 s");
  assert.strictEqual(later.n, 2);
  resetStatusCache();
  await assert.rejects(getStatus(async () => { throw new Error("down"); }));
  assert.strictEqual((await getStatus(load)).service, "ok", "a failed load isn't cached");
  resetStatusCache();
});

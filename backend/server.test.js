// Run with: npm test (node --test). No network: the API is replaced by a fake post().
const test = require("node:test");
const assert = require("node:assert");
const { testTimeLimit, maxBatchSize, suggestedTimeLimit, runTestsWithRetry, sanitize } = require("./server.js");

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

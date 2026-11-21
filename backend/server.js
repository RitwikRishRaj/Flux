// Flux backend: holds the onlinecompiler key and proxies /run.
// Zero dependencies — Node 18+ (uses global fetch).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Load .env
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, ...valueParts] = trimmed.split("=");
    if (key && valueParts.length > 0) {
      const value = valueParts.join("=").replace(/^["']|["']$/g, "").trim();
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

const API_KEY = process.env.ONLINECOMPILER_API_KEY;
const PORT = Number(process.env.PORT) || 8788; // 8787 is wrangler dev's default (the sync server)

const COMPILERS = new Set([
  "python-3.14", "typescript-deno", "g++-15", "gcc-15", "openjdk-25",
  "go-1.26", "rust-1.93", "ruby-4.0", "php-8.5", "dotnet-csharp-9",
  "dotnet-fsharp-9", "haskell-9.12",
]);

// Rate limiting: trace requests per IP
const limits = new Map();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60000; // 1 minute

const json = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

const readBody = (req, maxBytes = 250_000) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) reject(new Error("Body too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

// Sanitize stdin: CRLF becomes LF (a pasted Windows line would otherwise reach input() as "x\r"),
// then drop control characters except tab and newline.
const sanitize = (str) => {
  if (typeof str !== "string") return "";
  return str.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").substring(0, 100_000);
};

const checkRateLimit = (ip) => {
  const now = Date.now();
  const entry = limits.get(ip);
  if (!entry || now - entry.window > RATE_WINDOW) {
    limits.set(ip, { count: 1, window: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
};

// Run-tests: one request judges every case (https://onlinecompiler.io/docs/run-tests).
const MAX_TESTS = 32;            // Free plan's tests per request
const TEST_TIME_LIMIT = 10;      // seconds per test at most; the API default is only 2
const RUNS_AT_ONCE = 4;          // Free plan; tests run in rounds of this size (docs/limits)
const STARTUP_ALLOWANCE = { "openjdk-25": 1, "groovy-6.0": 1.5, "dotnet-fsharp-9": 2.5, "dotnet-fsharp-10": 2.5 }; // docs/run-tests

// The API refuses (400) a run-tests request whose tests can't finish in 60 s with the last round starting by 45 s.
// Not in the docs; measured from its refusals: each test is budgeted at time_limit + 3 s + the start-up allowance.
// Pick the largest limit that fits, capped at TEST_TIME_LIMIT, rounded down to 0.1 s like the API's own advice.
const testTimeLimit = (compiler, testCount) => {
  const perTestOverhead = 3 + (STARTUP_ALLOWANCE[compiler] ?? 0);
  const rounds = Math.ceil(testCount / RUNS_AT_ONCE);
  const fits = Math.min(60 / rounds, rounds > 1 ? 45 / (rounds - 1) : Infinity) - perTestOverhead;
  return Math.min(TEST_TIME_LIMIT, Math.floor(fits * 10 + 1e-9) / 10);
};
const MAX_TEST_FIELD = 10_000;   // matches the tests tab's field cap

// Largest batch in which every test still gets the full TEST_TIME_LIMIT (16 for most languages, 12 for F#).
const maxBatchSize = (compiler) => {
  for (let n = MAX_TESTS; n > 1; n--) if (testTimeLimit(compiler, n) >= TEST_TIME_LIMIT) return n;
  return 1;
};

// The API's own advice in a refusal, e.g. "...; use time_limit 3.4 or less". null when there is none.
const suggestedTimeLimit = (errorText) => {
  const match = /use time_limit (\d+(?:\.\d+)?) or less/.exec(String(errorText ?? ""));
  const seconds = match ? Number(match[1]) : NaN;
  return seconds > 0 && seconds <= 30 ? seconds : null;
};

// One run-tests call; if the API refuses the time limit and names one that fits, retry once with it.
// post(payload) resolves to { status, contentType, text }; passed in so the tests can run without the network.
const runTestsWithRetry = async (payload, post) => {
  const first = await post(payload);
  if (first.status !== 400) return first;
  let advice = null;
  try { advice = suggestedTimeLimit(JSON.parse(first.text).error); } catch { /* not JSON: relay as is */ }
  if (advice === null || advice >= payload.time_limit) return first;
  return post({ ...payload, time_limit: advice });
};

const postUpstream = async (path, payload, timeoutMs) => {
  const upstream = await fetch(`https://api.onlinecompiler.io${path}`, {
    method: "POST",
    headers: { Authorization: API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: upstream.status, contentType: upstream.headers.get("content-type") ?? "application/json", text: await upstream.text() };
};

// Relays the API's answer unchanged; a timeout or network failure becomes a 504 or 502.
const relayUpstream = async (res, call) => {
  try {
    const { status, contentType, text } = await call();
    res.writeHead(status, { "Content-Type": contentType });
    res.end(text);
  } catch (err) {
    if (err.name === "TimeoutError") json(res, 504, { error: "Compilation timed out" });
    else json(res, 502, { error: "Execution service unreachable" });
  }
};

// Shared by /run and /run-tests: key present, rate limit, JSON body, known compiler, text-only code.
const readRunRequest = async (req, res, maxBytes) => {
  if (!API_KEY || API_KEY === "PASTE_YOUR_KEY_HERE") {
    json(res, 500, { error: "Set ONLINECOMPILER_API_KEY in backend/.env" });
    return null;
  }
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  if (!checkRateLimit(ip)) {
    json(res, 429, { error: "Rate limit exceeded. Try again later." });
    return null;
  }
  let body;
  try {
    body = JSON.parse(await readBody(req, maxBytes));
  } catch (err) {
    if (err.message === "Body too large") json(res, 413, { error: "Request too large" });
    else json(res, 400, { error: "Invalid JSON" });
    return null;
  }
  const { compiler, code } = body ?? {};
  const fail = (error) => (json(res, 400, { error }), null);
  if (!COMPILERS.has(compiler)) return fail("Unknown compiler");
  if (typeof code !== "string" || !code.trim()) return fail("Code is required");
  if (code.length > 100_000) return fail("Code exceeds 100KB");
  if (/[\x00-\x08\x0E-\x1F]/.test(code)) return fail("Code contains invalid characters");
  return body;
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && req.url === "/run") {
    const body = await readRunRequest(req, res, 250_000);
    if (!body) return;
    const { compiler, code, input } = body;
    return relayUpstream(res, () => postUpstream("/api/run-code-sync/", { compiler, code, input: sanitize(input) }, 30_000));
  }

  // How many tests the client should send per /run-tests batch so each gets the full time limit.
  if (req.method === "GET" && req.url.startsWith("/run-tests/plan?")) {
    const compiler = new URL(req.url, "http://localhost").searchParams.get("compiler");
    if (!COMPILERS.has(compiler)) return json(res, 400, { error: "Unknown compiler" });
    return json(res, 200, { batch_size: maxBatchSize(compiler), time_limit: TEST_TIME_LIMIT });
  }

  if (req.method === "POST" && req.url === "/run-tests") {
    // Field limits are in characters; 32 tests × 2 fields × 10,000 chars of 3-byte UTF-8, plus code, fits in 4 MB.
    const body = await readRunRequest(req, res, 4_000_000);
    if (!body) return;
    const { compiler, code, tests } = body;
    if (!Array.isArray(tests) || tests.length < 1) return json(res, 400, { error: "Add at least one test" });
    if (tests.length > MAX_TESTS) return json(res, 400, { error: `At most ${MAX_TESTS} tests per run` });
    if (!tests.every(t => typeof t?.input === "string" && typeof t?.expected_output === "string"
      && t.input.length <= MAX_TEST_FIELD && t.expected_output.length <= MAX_TEST_FIELD)) {
      return json(res, 400, { error: "Each test needs input and expected_output text" });
    }
    const payload = {
      compiler,
      code,
      tests: tests.map(t => ({ input: sanitize(t.input), expected_output: t.expected_output })),
      time_limit: testTimeLimit(compiler, tests.length),
      checker: "trim",      // trailing whitespace per line + trailing blank lines, like the old normalize()
      scoring: "percent",   // percent also turns off stop_on_failure, so every test gets a verdict
    };
    // 70 s: the API gives one request 60 s (docs/run-tests). A refusal comes back at once, so a retry adds little.
    return relayUpstream(res, () => runTestsWithRetry(payload, p => postUpstream("/api/run-tests/", p, 70_000)));
  }

  json(res, 404, { error: "Not found" });
});

module.exports = { testTimeLimit, maxBatchSize, suggestedTimeLimit, runTestsWithRetry, sanitize };
if (require.main !== module) return; // imported by the tests: don't start the server

server.listen(PORT, () => {
  console.log(`flux-backend listening on :${PORT}${API_KEY && API_KEY !== "PASTE_YOUR_KEY_HERE" ? "" : " (no API key set yet)"}`);
});

// Flux backend: holds the onlinecompiler key, proxies /run and /run-tests, and serves /status for the room banner.
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

// --- Compiler ids -------------------------------------------------------------------------------------------
// The API's own list (GET /api/compilers/, no key needed) decides which ids are valid, refreshed hourly. Until it
// loads, or when it can't be fetched, the frontend's compiler table is the fallback: one table for both.
const LOCAL_TABLE_PATH = path.join(__dirname, "..", "frontend", "src", "lib", "compilers.json");
const loadLocalTable = () => {
  try {
    const table = JSON.parse(fs.readFileSync(LOCAL_TABLE_PATH, "utf8"));
    return { ids: new Set(table.compilers.map(c => c.id)), retired: table.retired ?? {} };
  } catch {
    return { ids: new Set(), retired: {} }; // backend deployed without the frontend: rely on the API's list
  }
};
const localCompilers = loadLocalTable();
let apiCompilers = null; // { ids: Set, retired: { oldId: newId } } once fetched

// Shape of GET /api/compilers/: { compilers: [{ id, name, ... }], retired: { "dotnet-csharp-9": "dotnet-csharp-10" } }
const parseCompilerList = (json) => {
  if (!json || !Array.isArray(json.compilers)) return null;
  const ids = new Set(json.compilers.map(c => c?.id).filter(id => typeof id === "string"));
  return ids.size ? { ids, retired: json.retired && typeof json.retired === "object" ? json.retired : {} } : null;
};

const refreshCompilers = async () => {
  try {
    const res = await fetch("https://api.onlinecompiler.io/api/compilers/", { signal: AbortSignal.timeout(10_000) });
    const parsed = res.ok ? parseCompilerList(await res.json()) : null;
    if (parsed) apiCompilers = parsed; // a failed refresh keeps the last good list
  } catch { /* keep the last good list, or the local table */ }
};

// The id to send upstream for one the browser sent: retired ids become the one they run as now; unknown → null.
const resolveCompiler = (id, list = apiCompilers ?? localCompilers) => {
  if (typeof id !== "string") return null;
  const current = list.retired[id] ?? localCompilers.retired[id] ?? id;
  return list.ids.has(current) ? current : null;
};

// --- Limits -----------------------------------------------------------------------------------------------
// The account runs at most 4 programs at once (docs/limits); more and a sync request gets 429. So the backend
// keeps its own requests within 4 sandbox slots and queues the rest briefly. Env overrides exist for testing.
const MAX_SLOTS = Number(process.env.FLUX_MAX_SLOTS) || 4;
const QUEUE_WAIT_MS = Number(process.env.FLUX_QUEUE_WAIT_MS) || 10_000;
const MAX_QUEUE = 16;

class BusyError extends Error {}

let freeSlots = MAX_SLOTS;
const waiting = []; // FIFO of { want, resolve, timer }

const take = (want) => { const got = Math.min(want, freeSlots); freeSlots -= got; return got; };

const grantWaiting = () => {
  while (waiting.length && freeSlots >= 1) {
    const next = waiting.shift();
    clearTimeout(next.timer);
    next.resolve(take(next.want));
  }
};

// Resolves with how many slots it got: 1 up to `want`, as soon as one is free. A batch that gets fewer than it
// wanted still works (the API runs its tests in more rounds; late ones may come back skipped), and nothing waits
// behind a big request while a slot sits free. Rejects with BusyError after QUEUE_WAIT_MS, or if the queue is full.
const acquireSlots = (want) => new Promise((resolve, reject) => {
  if (waiting.length === 0 && freeSlots >= 1) return resolve(take(want));
  if (waiting.length >= MAX_QUEUE) return reject(new BusyError());
  const entry = { want, resolve, timer: null };
  entry.timer = setTimeout(() => {
    waiting.splice(waiting.indexOf(entry), 1);
    reject(new BusyError());
  }, QUEUE_WAIT_MS);
  waiting.push(entry);
});

const releaseSlots = (got) => { freeSlots += got; grantWaiting(); };

// One run per room. Requests of the same run (same run_id) share the lock. It is kept briefly only when this run
// will send another request: BATCH_GAP_MS after a non-final batch that succeeded, RETRY_GAP_MS after a "busy"
// (the browser retries once after 3 s). Otherwise (a /run, a final batch, a compile error, a failure) it is released.
const BATCH_GAP_MS = 10_000;
const RETRY_GAP_MS = 5_000;
const roomLocks = new Map(); // room → { runId, active, heldUntil }

const lockRoom = (room, runId) => {
  const lock = roomLocks.get(room);
  const held = lock && (lock.active > 0 || Date.now() < lock.heldUntil);
  if (held && lock.runId !== runId) return false;
  if (held) lock.active++;
  else roomLocks.set(room, { runId, active: 1, heldUntil: 0 });
  return true;
};

const unlockRoom = (room, keepForMs) => {
  const lock = roomLocks.get(room);
  if (!lock) return;
  lock.active--;
  if (lock.active === 0) {
    if (keepForMs > 0) lock.heldUntil = Date.now() + keepForMs;
    else roomLocks.delete(room);
  }
};

// After a non-final batch, the browser sends the next one unless this one failed to compile (it stops there).
const nextBatchWillCome = (result) => {
  if (result.status < 200 || result.status >= 300) return false;
  try { return typeof JSON.parse(result.text).compile_error !== "string"; } catch { return false; }
};

// Locks kept for a next batch that never came would pile up; sweep them once a minute.
const sweepRoomLocks = () => {
  const now = Date.now();
  for (const [room, lock] of roomLocks) if (lock.active === 0 && now >= lock.heldUntil) roomLocks.delete(room);
};
setInterval(sweepRoomLocks, 60_000).unref();

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

const usageUrl = "https://api.onlinecompiler.io/api/usage/";

// A 429 means either "all 4 runs busy" or "monthly allowance used" (docs/limits); /api/usage/ (free) tells which.
// getUsage is passed in so the tests can run without the network.
const classifyUpstreamFailure = async ({ status, text }, getUsage) => {
  let message = "";
  try { message = JSON.parse(text).error ?? ""; } catch { /* not JSON */ }
  if (status === 429) {
    const usage = await getUsage().catch(() => null);
    const keyOut = usage?.key && usage.key.remaining === 0;
    if (usage && (usage.remaining === 0 || keyOut)) {
      return { status: 429, body: { code: "monthly_cap", error: "This month's free runs are used up.", resets_at: usage.resets_at ?? null } };
    }
    return { status: 503, body: { code: "busy", error: "The run queue is busy." } };
  }
  if (status === 403 || status === 404) {
    return { status: 500, body: { code: "misconfigured", error: `The run server's API key was refused${message ? `: ${message}` : "."}` } };
  }
  if (status === 503 || status >= 500) return { status: 502, body: { code: "upstream_down", error: "The code runner is having problems." } };
  return null; // 400s etc. are the user's to read, relayed as they are
};

const fetchUsage = async () => {
  const res = await fetch(usageUrl, { headers: { Authorization: API_KEY }, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`usage ${res.status}`);
  return res.json();
};

// --- Status for the room banner ------------------------------------------------------------------------------
// Runs left (GET /api/usage/) and service health (GET /api/health/), cached 60 s: however many rooms are open,
// the API sees at most one pair of calls a minute. Neither call spends runs (docs/limits).
const STATUS_TTL_MS = 60_000;
let statusCache = { at: 0, body: null, pending: null };

const fetchHealth = async () => {
  try {
    const res = await fetch("https://api.onlinecompiler.io/api/health/", { signal: AbortSignal.timeout(10_000) });
    return await res.json(); // 200 when every check is ok, 503 with the same shape when not
  } catch {
    return { status: "down" }; // if Flux can't reach the API, runs fail too
  }
};

// { runs_left, monthly_limit, resets_at, service: "ok" | "down" | "unknown", checked_at }. runs_left uses the
// tighter of the account's allowance and the key's own monthly limit, when the key has one.
const summarizeStatus = (usage, health, now = new Date()) => {
  const pools = [usage, usage?.key].filter(p => p && Number.isFinite(p.remaining) && Number.isFinite(p.monthly_limit) && p.monthly_limit > 0);
  const tightest = pools.sort((a, b) => a.remaining / a.monthly_limit - b.remaining / b.monthly_limit)[0];
  return {
    runs_left: tightest ? tightest.remaining : null,
    monthly_limit: tightest ? tightest.monthly_limit : null,
    resets_at: typeof usage?.resets_at === "string" ? usage.resets_at : null,
    service: health?.status === "ok" ? "ok" : health?.status === "down" ? "down" : "unknown",
    checked_at: now.toISOString(),
  };
};

const loadStatus = async () => {
  const [usage, health] = await Promise.all([fetchUsage().catch(() => null), fetchHealth()]);
  return summarizeStatus(usage, health);
};

// Serves the cached status while fresh; concurrent requests share one load. load and clock are passed in by the tests.
const getStatus = (load = loadStatus, now = Date.now()) => {
  if (statusCache.body && now - statusCache.at < STATUS_TTL_MS) return Promise.resolve(statusCache.body);
  if (!statusCache.pending) {
    statusCache.pending = load().then(
      body => { statusCache = { at: Date.now(), body, pending: null }; return body; },
      err => { statusCache.pending = null; throw err; },
    );
  }
  return statusCache.pending;
};
const resetStatusCache = () => { statusCache = { at: 0, body: null, pending: null }; };

const postUpstream = async (path, payload, timeoutMs) => {
  const upstream = await fetch(`https://api.onlinecompiler.io${path}`, {
    method: "POST",
    headers: { Authorization: API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: upstream.status, contentType: upstream.headers.get("content-type") ?? "application/json", text: await upstream.text() };
};

// Runs one upstream call inside the room lock and the slot cap, then relays the answer: successes and the
// user's own 400s unchanged, everything else as { code, error } (see classifyUpstreamFailure).
const runUpstream = async (res, { room, runId, slots, keepLock }, call) => {
  if (!lockRoom(room, runId)) {
    return json(res, 409, { code: "room_busy", error: "Someone in this room is already running code." });
  }
  let gotSlots = 0, keepForMs = 0;
  try {
    gotSlots = await acquireSlots(slots);
    const result = await call();
    const failure = result.status >= 400 ? await classifyUpstreamFailure(result, fetchUsage) : null;
    if (failure) return json(res, failure.status, failure.body);
    if (keepLock && nextBatchWillCome(result)) keepForMs = BATCH_GAP_MS;
    res.writeHead(result.status, { "Content-Type": result.contentType });
    res.end(result.text);
  } catch (err) {
    if (err instanceof BusyError) {
      keepForMs = RETRY_GAP_MS;
      json(res, 503, { code: "busy", error: "The run queue is busy." });
    }
    else if (err.name === "TimeoutError") json(res, 504, { code: "upstream_timeout", error: "The code runner took too long to answer." });
    else json(res, 502, { code: "upstream_down", error: "The code runner can't be reached." });
  } finally {
    if (gotSlots) releaseSlots(gotSlots);
    unlockRoom(room, keepForMs);
  }
};

const ROOM_RE = /^[^\x00-\x1F\x7F]{1,128}$/; // any room the page can open (it takes the URL segment as is)
const RUN_ID_RE = /^[A-Za-z0-9-]{1,64}$/;  // crypto.randomUUID() from the browser

// Shared by /run and /run-tests: key present, JSON body, room and run ids, known compiler, text-only code.
const readRunRequest = async (req, res, maxBytes) => {
  if (!API_KEY || API_KEY === "PASTE_YOUR_KEY_HERE") {
    json(res, 500, { code: "misconfigured", error: "Set ONLINECOMPILER_API_KEY in backend/.env" });
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
  const { code, room, run_id } = body ?? {};
  const fail = (error) => (json(res, 400, { error }), null);
  if (typeof room !== "string" || !ROOM_RE.test(room)) return fail("Missing or invalid room");
  if (typeof run_id !== "string" || !RUN_ID_RE.test(run_id)) return fail("Missing or invalid run_id");
  const compiler = resolveCompiler(body?.compiler);
  if (!compiler) return fail("Unknown compiler");
  body.compiler = compiler;
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
    const { compiler, code, input, room, run_id } = body;
    // 40 s: a run may take the full 30 s (docs/limits) plus compile and network, so 30 s cut off the API's own
    // "time limit" answer (exit 124) before it arrived.
    return runUpstream(res, { room, runId: run_id, slots: 1, keepLock: false },
      () => postUpstream("/api/run-code-sync/", { compiler, code, input: sanitize(input) }, 40_000));
  }

  if (req.method === "GET" && req.url === "/status") {
    try { return json(res, 200, await getStatus()); }
    catch { return json(res, 502, { code: "upstream_down", error: "Status unavailable." }); }
  }

  // How many tests the client should send per /run-tests batch so each gets the full time limit.
  if (req.method === "GET" && req.url.startsWith("/run-tests/plan?")) {
    const compiler = resolveCompiler(new URL(req.url, "http://localhost").searchParams.get("compiler"));
    if (!compiler) return json(res, 400, { error: "Unknown compiler" });
    return json(res, 200, { batch_size: maxBatchSize(compiler), time_limit: TEST_TIME_LIMIT });
  }

  if (req.method === "POST" && req.url === "/run-tests") {
    // Field limits are in characters; 32 tests × 2 fields × 10,000 chars of 3-byte UTF-8, plus code, fits in 4 MB.
    const body = await readRunRequest(req, res, 4_000_000);
    if (!body) return;
    const { compiler, code, tests, room, run_id, final } = body;
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
    // The API runs up to 4 of a request's tests at once, so a batch asks for that many of the account's slots.
    // 70 s: the API gives one request 60 s (docs/run-tests). A refusal comes back at once, so a retry adds little.
    return runUpstream(res, { room, runId: run_id, slots: Math.min(tests.length, MAX_SLOTS), keepLock: final === false },
      () => runTestsWithRetry(payload, p => postUpstream("/api/run-tests/", p, 70_000)));
  }

  json(res, 404, { error: "Not found" });
});

module.exports = {
  testTimeLimit, maxBatchSize, suggestedTimeLimit, runTestsWithRetry, sanitize,
  acquireSlots, releaseSlots, BusyError, lockRoom, unlockRoom, sweepRoomLocks, roomLocks, classifyUpstreamFailure,
  nextBatchWillCome, ROOM_RE, parseCompilerList, resolveCompiler, localCompilers,
  summarizeStatus, getStatus, resetStatusCache, STATUS_TTL_MS,
};
if (require.main !== module) return; // imported by the tests: don't start the server

refreshCompilers();
setInterval(refreshCompilers, 60 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`flux-backend listening on :${PORT}${API_KEY && API_KEY !== "PASTE_YOUR_KEY_HERE" ? "" : " (no API key set yet)"}`);
});

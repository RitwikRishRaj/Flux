// Run-tests batching and the API's time budget (ported from backend/server.js, behaviour unchanged).
// https://onlinecompiler.io/docs/run-tests

export const MAX_TESTS = 32;          // the Free plan's tests per request
export const TEST_TIME_LIMIT = 10;    // seconds per test at most; the API's default is only 2
export const RUNS_AT_ONCE = 4;        // Free plan: the account runs 4 programs at once, so tests go in rounds of 4
export const MAX_TEST_FIELD = 10_000; // matches the tests tab's field cap

// Extra start-up time the API allows these languages on top of time_limit (docs/run-tests).
export const STARTUP_ALLOWANCE: Record<string, number> = {
  "openjdk-25": 1, "groovy-6.0": 1.5, "dotnet-fsharp-9": 2.5, "dotnet-fsharp-10": 2.5,
};

// The API refuses (400) a run-tests request whose tests can't finish in 60 s with the last round starting by 45 s.
// Not in the docs; measured from its refusals: each test is budgeted at time_limit + 3 s + the start-up allowance.
// Picks the largest limit that fits, capped at TEST_TIME_LIMIT, rounded down to 0.1 s like the API's own advice.
export const testTimeLimit = (compiler: string, testCount: number): number => {
  const perTestOverhead = 3 + (STARTUP_ALLOWANCE[compiler] ?? 0);
  const rounds = Math.ceil(testCount / RUNS_AT_ONCE);
  const fits = Math.min(60 / rounds, rounds > 1 ? 45 / (rounds - 1) : Infinity) - perTestOverhead;
  return Math.min(TEST_TIME_LIMIT, Math.floor(fits * 10 + 1e-9) / 10);
};

// Largest batch in which every test still gets the full TEST_TIME_LIMIT (16 for most languages, 12 for F#).
export const maxBatchSize = (compiler: string): number => {
  for (let n = MAX_TESTS; n > 1; n--) if (testTimeLimit(compiler, n) >= TEST_TIME_LIMIT) return n;
  return 1;
};

// The API's own advice in a refusal, e.g. "...; use time_limit 3.4 or less". null when there is none.
export const suggestedTimeLimit = (errorText: unknown): number | null => {
  const match = /use time_limit (\d+(?:\.\d+)?) or less/.exec(String(errorText ?? ""));
  const seconds = match ? Number(match[1]) : NaN;
  return seconds > 0 && seconds <= 30 ? seconds : null;
};

// What one call to the API came back with.
export type UpstreamResult = { status: number; contentType: string; text: string };

export type TestCaseInput = { input: string; expected_output: string };
export type RunTestsPayload = {
  compiler: string;
  code: string;
  tests: TestCaseInput[];
  time_limit: number;
  checker: "trim";      // trailing whitespace per line + trailing blank lines are ignored
  scoring: "percent";   // percent also turns off stop_on_failure, so every test gets a verdict
};

// The payload for one batch, with the largest time limit the API will accept for it.
export const runTestsPayload = (compiler: string, code: string, tests: TestCaseInput[]): RunTestsPayload => ({
  compiler,
  code,
  tests: tests.map(t => ({ input: sanitize(t.input), expected_output: t.expected_output })),
  time_limit: testTimeLimit(compiler, tests.length),
  checker: "trim",
  scoring: "percent",
});

// One run-tests call; if the API refuses the time limit and names one that fits, retries once with it.
// post is passed in so the tests can run without the network.
export const runTestsWithRetry = async (
  payload: RunTestsPayload,
  post: (payload: RunTestsPayload) => Promise<UpstreamResult>,
): Promise<UpstreamResult> => {
  const first = await post(payload);
  if (first.status !== 400) return first;
  let advice: number | null = null;
  try { advice = suggestedTimeLimit(JSON.parse(first.text).error); } catch { /* not JSON: relay as is */ }
  if (advice === null || advice >= payload.time_limit) return first;
  return post({ ...payload, time_limit: advice });
};

// Stdin as the program should see it: CRLF becomes LF (a pasted Windows line would otherwise reach input() as
// "x\r"), control characters other than tab and newline are dropped, and it is capped at 100,000 characters.
export const sanitize = (str: unknown): string => {
  if (typeof str !== "string") return "";
  return str.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").substring(0, 100_000);
};

// Test-run results as the room stores them in the shared document (written by party/run/jobs.ts, shown by tests-tab.tsx).

// One test's outcome. verdict is the API's (docs/run-tests); status drives the card colours.
export type TestResult = { status: string; verdict?: string; actual?: string; stderr?: string; durationMs?: number; truncated?: boolean };

export const statusFromVerdict = (verdict: string) =>
  verdict === "accepted" ? "pass" : verdict === "wrong_answer" ? "fail" : verdict === "skipped" ? "skipped" : "error";

// The API's rule, applied across batches: the first test (in order) that failed decides; skipped only makes it incomplete.
export const overallVerdict = (verdicts: string[]) =>
  verdicts.find(v => v !== "accepted" && v !== "skipped") ?? (verdicts.includes("skipped") ? "incomplete" : "accepted");

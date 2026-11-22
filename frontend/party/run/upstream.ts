// Calls to onlinecompiler.io and what their failures mean (ported from backend/server.js, behaviour unchanged).
import type { UpstreamResult } from "./limits";

export const API_BASE = "https://api.onlinecompiler.io";

// Failure codes the browser turns into messages (frontend/src/lib/run-api.ts messageFor).
export type FailureCode =
  | "busy" | "monthly_cap" | "misconfigured" | "upstream_down" | "upstream_timeout" | "room_busy" | "daily_budget";
export type Failure = { status: number; body: { code: FailureCode; error: string; resets_at?: string | null } };

export type Usage = {
  remaining?: number; monthly_limit?: number; resets_at?: string;
  key?: { remaining?: number | null; monthly_limit?: number | null };
};

export const postUpstream = async (
  apiKey: string, path: string, payload: unknown, timeoutMs: number, fetchImpl: typeof fetch = fetch,
): Promise<UpstreamResult> => {
  const upstream = await fetchImpl(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: upstream.status, contentType: upstream.headers.get("content-type") ?? "application/json", text: await upstream.text() };
};

// GET /api/usage/: this month's runs and limits. Free to call (docs/limits).
export const fetchUsage = async (apiKey: string, fetchImpl: typeof fetch = fetch): Promise<Usage> => {
  const res = await fetchImpl(`${API_BASE}/api/usage/`, { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`usage ${res.status}`);
  return res.json() as Promise<Usage>;
};

// GET /api/health/: 200 when every check is ok, 503 with the same shape when not. No key, free.
export const fetchHealth = async (fetchImpl: typeof fetch = fetch): Promise<{ status?: string }> => {
  try {
    const res = await fetchImpl(`${API_BASE}/api/health/`, { signal: AbortSignal.timeout(10_000) });
    return (await res.json()) as { status?: string };
  } catch {
    return { status: "down" }; // if Flux can't reach the API, runs fail too
  }
};

// A 429 means either "all 4 runs busy" or "monthly allowance used" (docs/limits); /api/usage/ (free) tells which.
// null for 400s and other answers that are the user's to read as they are. getUsage is passed in for the tests.
export const classifyUpstreamFailure = async (
  { status, text }: Pick<UpstreamResult, "status" | "text">,
  getUsage: () => Promise<Usage>,
): Promise<Failure | null> => {
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
  if (status >= 500) return { status: 502, body: { code: "upstream_down", error: "The code runner is having problems." } };
  return null;
};

// A thrown fetch error as a failure: our own timeout, or the API being unreachable.
export const failureFromError = (err: unknown): Failure =>
  err instanceof Error && err.name === "TimeoutError"
    ? { status: 504, body: { code: "upstream_timeout", error: "The code runner took too long to answer." } }
    : { status: 502, body: { code: "upstream_down", error: "The code runner can't be reached." } };

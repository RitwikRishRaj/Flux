// Calls Flux's backend (/api/backend/*) for runs and test batches, and turns failures into messages people can act on.
// The backend answers failures as { code, error }; see backend/server.js runUpstream.

export type RunApiResult =
  | { ok: true; data: Record<string, any> }
  | { ok: false; code: string; message: string };

export const BUSY_RETRY_MS = 3000;
const OFFLINE = "Flux's run server is offline.";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// The message for each failure code the backend sends; anything else falls back to its own error text.
export const messageFor = (code: string, data: Record<string, any>, status: number): string => {
  switch (code) {
    case "busy": return "The run queue is busy. Try again in a moment.";
    case "room_busy": return "Someone in this room is already running code.";
    case "monthly_cap": {
      const resets = typeof data.resets_at === "string" ? new Date(data.resets_at) : null;
      const when = resets && !isNaN(resets.getTime()) ? ` They reset on ${resets.toLocaleDateString(undefined, { day: "numeric", month: "long" })}.` : "";
      return `Flux has used this month's free runs.${when}`;
    }
    case "upstream_down": return "The code runner is having problems. Check status.onlinecompiler.io.";
    case "upstream_timeout": return "The code runner took too long to answer. Try again.";
    case "offline": case "network": return OFFLINE;
    default: return typeof data.error === "string" ? data.error : `Request failed (${status})`;
  }
};

// POSTs to the backend. "busy" is retried once after BUSY_RETRY_MS (onRetry lets the caller say so).
// code "network" means the request itself failed (backend down, or this page is closing); "timeout" means timeoutMs passed.
export async function callRunApi(
  path: string,
  body: unknown,
  { timeoutMs, onRetry }: { timeoutMs?: number; onRetry?: () => void } = {},
): Promise<RunApiResult> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let res: Response;
    try {
      res = await fetch(`/api/backend${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, code: "timeout", message: `No answer after ${Math.round((timeoutMs ?? 0) / 1000)} s. Try again.` };
      }
      return { ok: false, code: "network", message: OFFLINE };
    } finally {
      if (timer) clearTimeout(timer);
    }

    // The backend always answers JSON. Plain text with a 5xx comes from Next's proxy: the backend isn't running.
    const parsed = await res.json().then(d => d as Record<string, any>, () => null);
    if (parsed === null && res.status >= 500) return { ok: false, code: "offline", message: OFFLINE };
    if (parsed === null && res.ok) return { ok: false, code: "bad_response", message: "The run server sent an answer Flux couldn't read. Try again." };
    const data = parsed ?? {};
    if (res.ok) return { ok: true, data };

    const code = typeof data.code === "string" ? data.code : "";
    if (code === "busy" && attempt === 0) {
      onRetry?.();
      await sleep(BUSY_RETRY_MS);
      continue;
    }
    return { ok: false, code, message: messageFor(code, data, res.status) };
  }
}

// What GET /api/backend/status returns (backend/server.js summarizeStatus).
export type RunStatus = {
  runs_left: number | null; monthly_limit: number | null; resets_at: string | null;
  service: "ok" | "down" | "unknown"; checked_at: string;
};

// The room's one-line banner: the service being down comes first, then fewer than 10% of the month's runs left.
export const bannerFor = (status: RunStatus | null): string | null => {
  if (!status) return null;
  if (status.service === "down") return "The code runner is having problems right now, so runs may fail. Check status.onlinecompiler.io.";
  const { runs_left, monthly_limit, resets_at } = status;
  if (runs_left === null || !monthly_limit || runs_left / monthly_limit >= 0.1) return null;
  const resets = resets_at ? new Date(resets_at) : null;
  const until = resets && !isNaN(resets.getTime()) ? ` They reset on ${resets.toLocaleDateString(undefined, { day: "numeric", month: "long" })}.` : "";
  return runs_left === 0
    ? `Flux has used this month's free runs.${until}`
    : `Flux has ${runs_left.toLocaleString()} free runs left this month.${until}`;
};

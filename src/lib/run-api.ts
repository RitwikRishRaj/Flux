// Messages for the failure codes the room writes into the shared doc (party/run/jobs.ts, party/run/upstream.ts),
// and the banner text for GET /status.

const OFFLINE = "Not connected to the room right now, so that wasn't sent. Try again once it reconnects.";

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
    case "daily_budget": {
      const resets = typeof data.resets_at === "string" ? new Date(data.resets_at) : null;
      const when = resets && !isNaN(resets.getTime()) ? ` They reset at ${resets.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.` : "";
      return `Flux has used today's free runs.${when}`;
    }
    case "upstream_down": return "The code runner is having problems. Check status.onlinecompiler.io.";
    case "upstream_timeout": return "The code runner took too long to answer. Try again.";
    case "offline": case "network": return OFFLINE;
    default: return typeof data.error === "string" ? data.error : `Request failed (${status})`;
  }
};

// What GET /status returns (party/run/status.ts and limiter-core.ts).
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

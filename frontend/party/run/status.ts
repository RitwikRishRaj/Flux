// What GET /status reports, and a small cache for it (ported from backend/server.js, behaviour unchanged).
import type { Usage } from "./upstream";

export const STATUS_TTL_MS = 60_000;

export type RunStatus = {
  runs_left: number | null; monthly_limit: number | null; resets_at: string | null;
  service: "ok" | "down" | "unknown"; checked_at: string;
};

// runs_left uses the tighter of the account's allowance and the key's own monthly limit, when the key has one.
export const summarizeStatus = (usage: Usage | null, health: { status?: string } | null, now = new Date()): RunStatus => {
  type Pool = { remaining: number; monthly_limit: number };
  const pools = [usage, usage?.key].filter((p): p is Pool =>
    !!p && Number.isFinite(p.remaining) && Number.isFinite(p.monthly_limit) && (p.monthly_limit as number) > 0);
  const tightest = pools.sort((a, b) => a.remaining / a.monthly_limit - b.remaining / b.monthly_limit)[0];
  return {
    runs_left: tightest ? tightest.remaining : null,
    monthly_limit: tightest ? tightest.monthly_limit : null,
    resets_at: typeof usage?.resets_at === "string" ? usage.resets_at : null,
    service: health?.status === "ok" ? "ok" : health?.status === "down" ? "down" : "unknown",
    checked_at: now.toISOString(),
  };
};

// Serves the last value while it is fresh; concurrent callers share one load; a failed load isn't kept.
// One clock for both reading and stamping (the tests pass a fake one).
export class TtlCache<T> {
  private at = 0;
  private value: T | null = null;
  private pending: Promise<T> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    private readonly now: () => number = Date.now,
  ) {}

  get(): Promise<T> {
    if (this.value !== null && this.now() - this.at < this.ttlMs) return Promise.resolve(this.value);
    if (!this.pending) {
      this.pending = this.load().then(
        value => { this.value = value; this.at = this.now(); this.pending = null; return value; },
        err => { this.pending = null; throw err; },
      );
    }
    return this.pending;
  }
}

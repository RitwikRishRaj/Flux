// What the global Limiter Durable Object decides, as a plain class so it can be tested with a fake clock and storage.
// One instance serves every room: the account-wide slot cap, a daily run budget, and cached compiler list and status.
import { BusyError, SlotPool } from "./slots";
import { STATUS_TTL_MS, TtlCache, type RunStatus } from "./status";
import type { CompilerList } from "./compilers";
import type { Failure } from "./upstream";

export const DEFAULT_DAILY_BUDGET = 3_000;
const COMPILERS_TTL_MS = 60 * 60 * 1000;     // refresh the API's compiler list hourly
const COMPILERS_RETRY_MS = 5 * 60 * 1000;    // after a failed fetch, wait before asking again

// The subset of Durable Object storage the core needs.
export interface KvStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export type Reservation = { ok: true; leaseId: string; slots: number } | { ok: false; failure: Failure };
export type LimiterStatus = RunStatus & { daily_budget: number; daily_runs_left: number };
export type CompilerListWire = { ids: string[]; retired: Record<string, string> }; // Sets don't cross RPC as such

// DAILY_RUN_BUDGET from the Worker's vars; anything that isn't a positive whole number means the default.
export const parseDailyBudget = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_BUDGET;
};

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nextUtcMidnight = (ms: number) => { const d = new Date(ms); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };

export class LimiterCore {
  private readonly statusCache: TtlCache<RunStatus>;
  private compilerList: CompilerList | null = null;
  private compilersCheckedAt = -Infinity;
  private compilersPending: Promise<CompilerList | null> | null = null;

  constructor(
    private readonly storage: KvStorage,
    private readonly dailyBudget: number,
    private readonly loadStatus: () => Promise<RunStatus>,
    private readonly loadCompilers: () => Promise<CompilerList | null>,
    private readonly pool = new SlotPool(),
    private readonly now: () => number = Date.now,
  ) {
    this.statusCache = new TtlCache(STATUS_TTL_MS, loadStatus, now);
  }

  // Runs used today (UTC). One key, reset on the first use of a new day.
  private async usedToday(): Promise<number> {
    const saved = await this.storage.get<{ day: string; used: number }>("budget");
    return saved?.day === utcDay(this.now()) ? saved.used : 0;
  }

  private async addUsed(runs: number) {
    const used = Math.max(0, (await this.usedToday()) + runs);
    await this.storage.put("budget", { day: utcDay(this.now()), used });
  }

  // Checks the daily budget, then waits for slots. `runs` is what the call will cost upstream (1 for a run, the test
  // count for a batch); it is counted now and can be handed back with refund() if the API never ran it.
  async reserve(wantSlots: number, runs: number): Promise<Reservation> {
    // Count before waiting for slots, so concurrent requests can't all pass the check and overshoot the budget.
    const used = await this.usedToday();
    if (used + runs > this.dailyBudget) {
      return { ok: false, failure: { status: 429, body: { code: "daily_budget", error: "Flux has used today's runs.", resets_at: nextUtcMidnight(this.now()) } } };
    }
    await this.storage.put("budget", { day: utcDay(this.now()), used: used + runs });
    try {
      const lease = await this.pool.acquire(wantSlots);
      return { ok: true, leaseId: lease.id, slots: lease.slots };
    } catch (err) {
      await this.refund(runs);
      if (err instanceof BusyError) return { ok: false, failure: { status: 503, body: { code: "busy", error: "The run queue is busy." } } };
      throw err;
    }
  }

  release(leaseId: string) { this.pool.release(leaseId); }

  // For calls the API refused before running (busy, monthly cap, a refused key, an outage).
  async refund(runs: number) { await this.addUsed(-runs); }

  async status(): Promise<LimiterStatus> {
    const [base, used] = await Promise.all([this.statusCache.get(), this.usedToday()]);
    return { ...base, daily_budget: this.dailyBudget, daily_runs_left: Math.max(0, this.dailyBudget - used) };
  }

  // The API's compiler list, refreshed hourly; null until one has loaded (rooms then use the local table).
  // A failed fetch keeps the last good list and isn't retried for 5 minutes, so an outage doesn't add a slow
  // request to every run.
  async compilers(): Promise<CompilerListWire | null> {
    const age = this.now() - this.compilersCheckedAt;
    const stale = this.compilerList ? age >= COMPILERS_TTL_MS : age >= COMPILERS_RETRY_MS;
    if (stale && !this.compilersPending) {
      this.compilersPending = this.loadCompilers().catch(() => null).then(list => {
        this.compilersCheckedAt = this.now();
        if (list) this.compilerList = list;
        this.compilersPending = null;
        return list;
      });
    }
    if (this.compilersPending && !this.compilerList) await this.compilersPending;
    return this.compilerList ? { ids: [...this.compilerList.ids], retired: this.compilerList.retired } : null;
  }
}

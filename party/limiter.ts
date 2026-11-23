// The one global Limiter Durable Object: every room asks it before calling onlinecompiler (Durable Object RPC).
// The decisions live in run/limiter-core.ts; this class only wires in storage, the clock and the API calls.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { LimiterCore, parseDailyBudget } from "./run/limiter-core";
import { summarizeStatus } from "./run/status";
import { fetchHealth, fetchUsage } from "./run/upstream";
import { fetchCompilerList } from "./run/compilers";

export class Limiter extends DurableObject<Env> {
  private readonly core: LimiterCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const apiKey = env.ONLINECOMPILER_API_KEY ?? "";
    this.core = new LimiterCore(
      ctx.storage,
      parseDailyBudget(env.DAILY_RUN_BUDGET),
      async () => {
        const [usage, health] = await Promise.all([apiKey ? fetchUsage(apiKey).catch(() => null) : null, fetchHealth()]);
        return summarizeStatus(usage, health);
      },
      () => fetchCompilerList(),
    );
  }

  reserve(wantSlots: number, runs: number) { return this.core.reserve(wantSlots, runs); }
  release(leaseId: string) { this.core.release(leaseId); }
  refund(runs: number) { return this.core.refund(runs); }
  status() { return this.core.status(); }
  compilers() { return this.core.compilers(); }
}

// The single instance every room talks to.
export const limiterFor = (env: Env) => env.LIMITER.get(env.LIMITER.idFromName("global"));

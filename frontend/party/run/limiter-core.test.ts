// @vitest-environment node
// The Limiter's decisions with a fake clock and storage; no network.
import { describe, test } from "vitest";
import assert from "node:assert";
import { DEFAULT_DAILY_BUDGET, LimiterCore, parseDailyBudget, type KvStorage } from "./limiter-core";
import { SlotPool } from "./slots";
import type { RunStatus } from "./status";
import type { CompilerList } from "./compilers";

const memoryStorage = (): KvStorage & { data: Map<string, unknown> } => {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) { return data.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { data.set(key, value); },
  };
};
const okStatus: RunStatus = { runs_left: 99_000, monthly_limit: 100_000, resets_at: null, service: "ok", checked_at: "" };

const setup = (opts: { budget?: number; loadCompilers?: () => Promise<CompilerList | null> } = {}) => {
  let clock = Date.parse("2026-11-22T10:00:00Z");
  const storage = memoryStorage();
  const loads = { status: 0, compilers: 0 };
  const core = new LimiterCore(
    storage,
    opts.budget ?? 10,
    async () => { loads.status++; return okStatus; },
    async () => { loads.compilers++; return (opts.loadCompilers ?? (async () => ({ ids: new Set(["python-3.14"]), retired: {} })))(); },
    new SlotPool(4, 200, 16, 90_000, () => clock),
    () => clock,
  );
  return { core, storage, loads, tick: (ms: number) => { clock += ms; } };
};

describe("daily budget", () => {
  test("counts runs, refuses what would go over, and resets at UTC midnight", async () => {
    const { core, tick } = setup({ budget: 10 });
    const a = await core.reserve(1, 8);
    assert.ok(a.ok);
    if (a.ok) core.release(a.leaseId);
    const over = await core.reserve(4, 3);
    assert.ok(!over.ok && over.failure.body.code === "daily_budget", "8 + 3 > 10");
    assert.ok(!over.ok && over.failure.body.resets_at === "2026-11-23T00:00:00.000Z");
    const fits = await core.reserve(1, 2);
    assert.ok(fits.ok, "8 + 2 = 10 still fits");
    if (fits.ok) core.release(fits.leaseId);
    assert.strictEqual((await core.status()).daily_runs_left, 0);
    tick(14 * 60 * 60 * 1000);                      // past midnight UTC
    assert.strictEqual((await core.status()).daily_runs_left, 10, "a new day starts from zero");
  });

  test("refund hands back runs the API never ran, and busy refunds by itself", async () => {
    const { core } = setup({ budget: 10 });
    const r = await core.reserve(4, 6);
    assert.ok(r.ok);
    await core.refund(6);
    assert.strictEqual((await core.status()).daily_runs_left, 10);
    const busy = await core.reserve(1, 3);          // all 4 slots still leased to r: waits 200 ms, then busy
    assert.ok(!busy.ok && busy.failure.body.code === "busy");
    assert.strictEqual((await core.status()).daily_runs_left, 10, "a busy reservation costs nothing");
  });

  test("DAILY_RUN_BUDGET: a positive whole number, otherwise the default", () => {
    assert.strictEqual(parseDailyBudget("500"), 500);
    for (const bad of [undefined, "", "0", "-5", "2.5", "lots"]) assert.strictEqual(parseDailyBudget(bad), DEFAULT_DAILY_BUDGET);
  });
});

describe("status and compiler list", () => {
  test("status adds the daily budget and is cached", async () => {
    const { core, loads } = setup({ budget: 3000 });
    const s = await core.status();
    assert.deepStrictEqual([s.service, s.daily_budget, s.daily_runs_left], ["ok", 3000, 3000]);
    await core.status();
    assert.strictEqual(loads.status, 1, "second call from the 60 s cache");
  });

  test("compiler list: fetched once an hour, sent as a plain array", async () => {
    const { core, loads, tick } = setup();
    assert.deepStrictEqual(await core.compilers(), { ids: ["python-3.14"], retired: {} });
    await core.compilers();
    assert.strictEqual(loads.compilers, 1);
    tick(61 * 60 * 1000);
    await core.compilers();
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(loads.compilers, 2, "refreshed after an hour");
  });

  test("compiler list: a failed fetch gives null and isn't retried for 5 minutes", async () => {
    const { core, loads, tick } = setup({ loadCompilers: async () => null });
    assert.strictEqual(await core.compilers(), null, "rooms then use the local table");
    await core.compilers();
    assert.strictEqual(loads.compilers, 1, "no retry straight away");
    tick(5 * 60 * 1000);
    await core.compilers();
    assert.strictEqual(loads.compilers, 2, "retried after 5 minutes");
  });
});

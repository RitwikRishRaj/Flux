import { YServer } from "y-partyserver";
import { routePartykitRequest, type Connection, type ConnectionContext } from "partyserver";
import type * as Y from "yjs";
import type { Env } from "./env";
import { limiterFor } from "./limiter";
import { runCode, runTests, type JobDeps, type JobError, type TestCaseJob } from "./run/jobs";
import { checkCode, checkTests } from "./run/validate";
import { MAX_TESTS } from "./run/limits";
import { fetchUsage, postUpstream } from "./run/upstream";
import type { CompilerList } from "./run/compilers";
import { isAllowedOrigin } from "./run/origin";
import { verifyTurnstile } from "./run/turnstile";
import { idleAction, parseIdleMinutes } from "./run/idle";

export { Limiter } from "./limiter";

// A websocket that opens and closes at once with a code the page can read (a refused upgrade looks like a network error).
const closedSocket = (code: number, reason: string) => {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
};

const cleanName = (value: unknown) => String(value ?? "").replace(/["\\<>\n]/g, "").slice(0, 24) || "Someone";

export class FluxRoom extends YServer<Env> {
  // Hibernation lets an idle room leave memory while its sockets stay open, so it stops costing duration.
  // A run in progress keeps the object awake (its fetch is pending I/O), so the in-memory lock below can't be lost mid-run.
  static options = { hibernate: true };

  static callbackOptions = {
    debounceWait: 1000,
    debounceMaxWait: 10000,
    timeout: 5000
  };

  // One run per room (code or tests). Set before any await, so a second request meanwhile sees it.
  private running = false;
  // How long a room is kept once nobody is in it (ROOM_IDLE_MINUTES, default 2).
  private readonly idleMs = parseIdleMinutes(this.env.ROOM_IDLE_MINUTES) * 60_000;

  async onLoad() {
    const persisted = await this.ctx.storage.get<Uint8Array>("doc");
    if (persisted) {
      const Y = await import("yjs");
      Y.applyUpdate(this.document, persisted);
    }
    // A run saved as in progress can't still be going after a restart (deploy, crash): say so instead of hanging.
    const state = this.document.getMap("runState");
    const testRun = this.document.getMap("testRun");
    if (state.get("active") || testRun.get("finishedAt") === null) {
      this.document.transact(() => {
        state.set("active", null);
        state.set("note", null);
        if (testRun.get("finishedAt") === null) { testRun.set("interrupted", true); testRun.set("finishedAt", Date.now()); }
      });
    }
    // Safety net: every room that loads has a deletion alarm, even if its last close was never seen. Someone connecting
    // cancels it; with people present it just finds them and keeps the room.
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + this.idleMs);
  }

  onConnect(connection: Connection, ctx: ConnectionContext) {
    super.onConnect(connection, ctx);
    void this.ctx.storage.deleteAlarm();
  }

  onClose(connection: Connection, code: number, reason: string, wasClean: boolean) {
    super.onClose(connection, code, reason, wasClean);
    const othersLeft = [...this.getConnections()].some(c => c.id !== connection.id);
    if (!othersLeft) void this.ctx.storage.setAlarm(Date.now() + this.idleMs);
  }

  async onAlarm() {
    const [doc, created] = await Promise.all([this.ctx.storage.get("doc"), this.ctx.storage.get("createdAt")]);
    const action = idleAction({ connections: [...this.getConnections()].length, running: this.running, hasData: !!doc || !!created });
    if (action === "later") await this.ctx.storage.setAlarm(Date.now() + this.idleMs);
    if (action !== "delete") return;
    await this.ctx.storage.deleteAll(); // also deletes the alarm (compatibility date after 2026-02-24)
    // Drop the copy in memory too, so it can't be served to the next visitor or saved back. The alarm counts as failed
    // and is retried once; the retry finds nothing stored and keeps the (now empty) room.
    this.ctx.abort("room deleted after being empty");
  }

  // A brand-new room: never saved, never marked created, nobody in it. Only its first connection must carry a
  // Turnstile token; joining or reconnecting to any other room needs nothing. Called by the Worker over RPC.
  async isNew() {
    const [doc, created] = await Promise.all([this.ctx.storage.get("doc"), this.ctx.storage.get("createdAt")]);
    return !doc && !created && [...this.getConnections()].length === 0;
  }

  async markCreated() {
    await this.ctx.storage.put("createdAt", Date.now());
  }

  async onSave() {
    const Y = await import("yjs");
    await this.ctx.storage.put("doc", Y.encodeStateAsUpdate(this.document));
  }

  // Requests from people in the room, over the room's own websocket: { type: "run" | "runTests", by }.
  // Only someone connected to a real room can send one. The room reads code, input, language and tests from the shared
  // doc and writes results back to it, so a run finishes and everyone sees it even if the person who asked leaves.
  onCustomMessage(_connection: Connection, message: string) {
    let request: { type?: unknown; by?: unknown };
    try { request = JSON.parse(message); } catch { return; }
    if ((request.type !== "run" && request.type !== "runTests") || this.running) return; // the UI disables Run meanwhile
    this.running = true;
    this.runJob(request.type === "runTests", cleanName(request.by))
      .catch(err => console.error("run failed", err))
      .finally(() => { this.running = false; });
  }

  private async runJob(isTests: boolean, by: string) {
    const doc = this.document;
    const state = doc.getMap("runState");
    doc.transact(() => { state.set("active", isTests ? "tests" : "run"); state.set("by", by); state.set("note", null); });
    try {
      const limiter = limiterFor(this.env);
      const apiKey = this.env.ONLINECOMPILER_API_KEY ?? "";
      const deps: JobDeps = {
        reserve: (slots, runs) => limiter.reserve(slots, runs),
        release: leaseId => limiter.release(leaseId),
        refund: runs => limiter.refund(runs),
        post: (path, payload, timeoutMs) => postUpstream(apiKey, path, payload, timeoutMs),
        getUsage: () => fetchUsage(apiKey),
        sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        note: text => { state.set("note", text); },
      };
      const wire = await limiter.compilers().catch(() => null);
      const compilers: CompilerList | null = wire ? { ids: new Set(wire.ids), retired: wire.retired } : null;
      const checked = checkCode({
        compiler: doc.getMap("roomState").get("compilerId") ?? "python-3.14",
        code: doc.getText("monaco").toString(),
      }, compilers);
      if (isTests) await this.runAllTests(deps, checked, by);
      else await this.runOnce(deps, checked, by);
    } finally {
      doc.transact(() => { state.set("active", null); state.set("note", null); });
    }
  }

  private async runOnce(deps: JobDeps, checked: ReturnType<typeof checkCode>, by: string) {
    const lastRun = this.document.getMap<unknown>("lastRun");
    // Anything unexpected still ends as an error everyone can see, never a run that silently produced nothing.
    const outcome = checked.ok
      ? await runCode(deps, { ...checked.value, input: this.document.getText("stdin").toString() })
          .catch(() => ({ ok: false as const, error: { code: "upstream_down" as const, error: "The run failed unexpectedly. Try again." } }))
      : { ok: false as const, error: { code: "invalid" as const, error: checked.error } };
    const data: Record<string, unknown> = outcome.ok ? outcome.value : {};
    const error: JobError | null = outcome.ok ? null : outcome.error;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
    const num = (v: unknown) => (typeof v === "number" ? v : null);
    // Fields as the output panel reads them (docs/run-code); a failed run clears the output and says why.
    this.document.transact(() => {
      lastRun.set("stdout", str(data.output, 50000));
      lastRun.set("stderr", str(data.error, 50000));
      lastRun.set("status", data.exit_code === 0 ? "ok" : "error");
      lastRun.set("runBy", by);
      lastRun.set("runById", "");
      lastRun.set("finishedAt", Date.now());
      lastRun.set("exitCode", num(data.exit_code));
      lastRun.set("signal", num(data.signal));
      lastRun.set("time", str(data.time, 20));
      lastRun.set("memory", str(data.memory, 20));
      lastRun.set("truncated", data.truncated === true);
      lastRun.set("timeLimit", num(data.time_limit));
      lastRun.set("memoryLimit", num(data.memory_limit));
      lastRun.set("errorCode", error?.code ?? null);
      lastRun.set("error", error?.error ?? null);
      lastRun.set("resetsAt", error?.resets_at ?? null);
    });
  }

  private async runAllTests(deps: JobDeps, checked: ReturnType<typeof checkCode>, by: string) {
    const doc = this.document;
    const testRun = doc.getMap<unknown>("testRun");
    // Test cases as the tests tab stores them: plain objects, or Y.Maps once edited; only the first 32 run.
    const cases = doc.getArray<unknown>("tests").toArray().slice(0, MAX_TESTS)
      .map(item => (typeof (item as Y.Map<unknown>)?.toJSON === "function" ? (item as Y.Map<unknown>).toJSON() : item) as Record<string, unknown>)
      .map(t => ({ id: String(t?.id ?? ""), input: t?.stdin, expected_output: t?.expectedOutput }));
    const tests = checkTests(cases);

    doc.transact(() => {
      testRun.set("runId", crypto.randomUUID());
      testRun.set("runBy", by);
      testRun.set("runById", "");
      testRun.set("startedAt", Date.now());
      testRun.set("finishedAt", null);
      testRun.set("interrupted", false);
      testRun.set("results", {});
      for (const key of ["verdict", "compileError", "error", "errorCode", "resetsAt", "timeLimit"]) testRun.set(key, null);
      testRun.set("batchIndex", 1);
      testRun.set("batchCount", 1);
    });

    const problem = !checked.ok ? checked.error : !tests.ok ? tests.error : null;
    const summary = !checked.ok || !tests.ok
      ? { results: {}, verdict: null, compileError: null, error: { code: "invalid" as const, error: problem! }, timeLimit: null, batchCount: 1 }
      : await runTests(deps, { ...checked.value, tests: tests.value as TestCaseJob[] }, progress => doc.transact(() => {
          testRun.set("batchIndex", progress.batchIndex);
          testRun.set("batchCount", progress.batchCount);
          testRun.set("results", progress.results);
        })).catch(() => ({ // anything unexpected still finishes the run with an error, never a stuck "batch 1/N"
          results: {}, verdict: null, compileError: null,
          error: { code: "upstream_down", error: "The test run failed unexpectedly. Try again." } as JobError, timeLimit: null, batchCount: 1,
        }));

    doc.transact(() => {
      testRun.set("results", summary.results);
      testRun.set("verdict", summary.verdict);
      testRun.set("compileError", summary.compileError);
      testRun.set("error", summary.error?.error ?? null);
      testRun.set("errorCode", summary.error?.code ?? null);
      testRun.set("resetsAt", summary.error?.resets_at ?? null);
      testRun.set("timeLimit", summary.timeLimit);
      testRun.set("batchCount", summary.batchCount);
      testRun.set("finishedAt", Date.now());
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = isAllowedOrigin(origin, env.ALLOWED_ORIGINS);
    if (request.method === "GET" && new URL(request.url).pathname === "/status") {
      // Public figures (runs left, service health), but only listed pages may read them cross-origin.
      return Response.json(await limiterFor(env).status(), { headers: allowed ? { "Access-Control-Allow-Origin": origin!, Vary: "Origin" } : {} });
    }
    // Rooms (websocket and plain requests) only for pages on ALLOWED_ORIGINS, refused before the room is created.
    const refuse = async () => (allowed ? undefined : new Response("Origin not allowed", { status: 403 }));
    const beforeConnect = async (req: Request, lobby: { name: string }) => {
      if (!allowed) return refuse();
      const room = env.Main.get(env.Main.idFromName(lobby.name));
      if (!(await room.isNew())) return undefined;
      // shortcut: with no TURNSTILE_SECRET_KEY, new rooms aren't checked; the deploy config requires the secret.
      if (env.TURNSTILE_SECRET_KEY) {
        const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, new URL(req.url).searchParams.get("cf"), req.headers.get("CF-Connecting-IP"));
        if (!ok) return closedSocket(4001, "Turnstile verification failed");
      }
      await room.markCreated();
      return undefined;
    };
    // routePartykitRequest exposes every Durable Object binding it is given as /parties/<name>/...; only rooms are public.
    return (
      (await routePartykitRequest(request, { Main: env.Main } as Env, { onBeforeConnect: beforeConnect, onBeforeRequest: refuse })) ||
      new Response("Not Found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;

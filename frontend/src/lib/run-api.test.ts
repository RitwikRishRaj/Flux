import { describe, it, expect } from "vitest";
import { callRunApi, messageFor } from "./run-api";

// Replaces fetch with a list of canned answers; returns the bodies that were sent.
const fakeFetch = (answers: Array<{ status: number; body: unknown } | "throw">) => {
  const sent: unknown[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    const a = answers.shift();
    if (!a || a === "throw") throw new TypeError("Failed to fetch");
    const text = typeof a.body === "string" ? a.body : JSON.stringify(a.body);
    return new Response(text, { status: a.status });
  }) as typeof fetch;
  return sent;
};

describe("callRunApi", () => {
  it("returns the data on success", async () => {
    fakeFetch([{ status: 200, body: { output: "hi" } }]);
    const r = await callRunApi("/run", { room: "abcdef" });
    expect(r.ok && r.data.output).toBe("hi");
  });
  it("retries once when busy, then succeeds", async () => {
    const sent = fakeFetch([{ status: 503, body: { code: "busy" } }, { status: 200, body: { output: "ok" } }]);
    let retried = 0;
    const r = await callRunApi("/run", { n: 1 }, { onRetry: () => retried++ });
    expect(retried).toBe(1);
    expect(sent.length).toBe(2);
    expect(r.ok).toBe(true);
  });
  it("gives up after one retry", async () => {
    const sent = fakeFetch([{ status: 503, body: { code: "busy" } }, { status: 503, body: { code: "busy" } }]);
    const r = await callRunApi("/run", {});
    expect(sent.length).toBe(2);
    expect(!r.ok && r.message).toBe("The run queue is busy. Try again in a moment.");
  });
  it("reads Next's plain-text 500 as the backend being offline", async () => {
    fakeFetch([{ status: 500, body: "Internal Server Error" }]);
    const r = await callRunApi("/run", {});
    expect(!r.ok && r.code).toBe("offline");
    expect(!r.ok && r.message).toBe("Flux's run server is offline.");
  });
  it("does not report an unreadable 200 as a successful run", async () => {
    fakeFetch([{ status: 200, body: "<html>oops</html>" }]);
    const r = await callRunApi("/run", {});
    expect(!r.ok && r.code).toBe("bad_response");
  });
  it("calls a failed request 'network', with the offline message", async () => {
    fakeFetch(["throw"]);
    const r = await callRunApi("/run", {});
    expect(!r.ok && r.code).toBe("network");
    expect(!r.ok && r.message).toBe("Flux's run server is offline.");
  });
});

describe("messageFor", () => {
  it("covers each code from the backend", () => {
    expect(messageFor("room_busy", {}, 409)).toBe("Someone in this room is already running code.");
    expect(messageFor("monthly_cap", { resets_at: "2026-12-01T00:00:00Z" }, 429)).toContain("Flux has used this month's free runs. They reset on");
    expect(messageFor("monthly_cap", {}, 429)).toBe("Flux has used this month's free runs.");
    expect(messageFor("upstream_down", {}, 502)).toBe("The code runner is having problems. Check status.onlinecompiler.io.");
    expect(messageFor("upstream_timeout", {}, 504)).toBe("The code runner took too long to answer. Try again.");
    expect(messageFor("", { error: "Unknown compiler" }, 400)).toBe("Unknown compiler");
    expect(messageFor("", {}, 418)).toBe("Request failed (418)");
  });
});

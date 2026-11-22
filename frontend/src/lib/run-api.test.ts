import { describe, it, expect } from "vitest";
import { bannerFor, messageFor } from "./run-api";

describe("messageFor", () => {
  it("covers each code from the backend", () => {
    expect(messageFor("room_busy", {}, 409)).toBe("Someone in this room is already running code.");
    expect(messageFor("monthly_cap", { resets_at: "2026-12-01T00:00:00Z" }, 429)).toContain("Flux has used this month's free runs. They reset on");
    expect(messageFor("monthly_cap", {}, 429)).toBe("Flux has used this month's free runs.");
    expect(messageFor("upstream_down", {}, 502)).toBe("The code runner is having problems. Check status.onlinecompiler.io.");
    expect(messageFor("upstream_timeout", {}, 504)).toBe("The code runner took too long to answer. Try again.");
    expect(messageFor("", { error: "Unknown compiler" }, 400)).toBe("Unknown compiler");
    expect(messageFor("", {}, 418)).toBe("Request failed (418)");
    expect(messageFor("daily_budget", { resets_at: "2026-11-23T00:00:00.000Z" }, 429)).toContain("Flux has used today's free runs. They reset at");
  });
});

describe("bannerFor", () => {
  const base = { runs_left: 50_000, monthly_limit: 100_000, resets_at: "2026-12-01T00:00:00Z", service: "ok" as const, checked_at: "" };
  it("shows nothing when all is well, or when nothing is known", () => {
    expect(bannerFor(base)).toBeNull();
    expect(bannerFor(null)).toBeNull();
    expect(bannerFor({ ...base, runs_left: null, monthly_limit: null, service: "unknown" })).toBeNull();
  });
  it("warns under 10% of the month's runs, and at zero", () => {
    expect(bannerFor({ ...base, runs_left: 10_000 })).toBeNull();
    expect(bannerFor({ ...base, runs_left: 9_999 })).toContain("free runs left this month. They reset on");
    expect(bannerFor({ ...base, runs_left: 0 })).toContain("Flux has used this month's free runs.");
  });
  it("puts the service being down first", () => {
    expect(bannerFor({ ...base, runs_left: 5, service: "down" })).toContain("The code runner is having problems right now");
  });
});

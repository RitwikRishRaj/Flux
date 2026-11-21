import { describe, it, expect } from "vitest";
import { firstDiffLine, overallVerdict, statusFromVerdict } from "./tests-tab";

describe("overallVerdict", () => {
  it("is accepted only when every test is", () => {
    expect(overallVerdict(["accepted", "accepted"])).toBe("accepted");
  });
  it("takes the first failing test in order, across batches", () => {
    expect(overallVerdict(["accepted", "time_limit_exceeded", "wrong_answer"])).toBe("time_limit_exceeded");
  });
  it("says incomplete when tests were skipped but none failed", () => {
    expect(overallVerdict(["accepted", "skipped"])).toBe("incomplete");
    expect(overallVerdict(["skipped", "runtime_error"])).toBe("runtime_error");
  });
});

describe("statusFromVerdict", () => {
  it("maps verdicts to card colours", () => {
    expect(statusFromVerdict("accepted")).toBe("pass");
    expect(statusFromVerdict("wrong_answer")).toBe("fail");
    expect(statusFromVerdict("skipped")).toBe("skipped");
    expect(statusFromVerdict("memory_limit_exceeded")).toBe("error");
  });
});

describe("firstDiffLine", () => {
  it("finds the first differing line under the trim checker's rules", () => {
    expect(firstDiffLine("3\nok\n", "3\nOK")).toBe(2);
    expect(firstDiffLine("3  \r\nok\n\n", "3\nok")).toBeNull();
    expect(firstDiffLine("3", "3\nok")).toBe(2);
  });
});

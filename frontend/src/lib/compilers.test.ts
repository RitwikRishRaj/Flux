import { describe, it, expect } from "vitest";
import { COMPILERS, isEmptyOrStarter, describeExit, formatSeconds, formatMemory } from "./compilers";

describe("isEmptyOrStarter", () => {
  it("allows replacing empty or whitespace-only code", () => {
    expect(isEmptyOrStarter("")).toBe(true);
    expect(isEmptyOrStarter("  \n\t")).toBe(true);
  });

  it("allows replacing any untouched starter snippet", () => {
    for (const c of COMPILERS) expect(isEmptyOrStarter(c.hello)).toBe(true);
  });

  it("protects code the user has written or edited", () => {
    expect(isEmptyOrStarter("print(42)")).toBe(false);
    expect(isEmptyOrStarter(COMPILERS[0].hello + "\n# my change")).toBe(false);
  });
});

describe("describeExit", () => {
  it("says nothing for a clean exit", () => {
    expect(describeExit(0, null)).toBe(null);
  });
  it("names the documented exit codes, using the run's own limits", () => {
    expect(describeExit(124, null, 30)).toBe("Stopped at the 30 s time limit");
    expect(describeExit(137, 9, 30, 512)).toBe("Out of memory (512 MB limit)");
    expect(describeExit(139, 11)).toBe("Crashed (segmentation fault)");
    expect(describeExit(153, 25)).toBe("Stopped: more than 8 MB of output");
    expect(describeExit(71, null)).toBe("Stopped: too many processes");
    expect(describeExit(-1, null)).toBe("The run service failed. Try again.");
  });
  it("falls back to the code or the signal", () => {
    expect(describeExit(3, null)).toBe("Exited with code 3");
    expect(describeExit(134, 6)).toBe("Killed by signal 6");
  });
});

describe("formatSeconds and formatMemory", () => {
  it("keep two decimals under 10 s and turn KB into MB", () => {
    expect(formatSeconds("0.0248")).toBe("0.02 s");
    expect(formatSeconds("12.345")).toBe("12.3 s");
    expect(formatSeconds("")).toBe(null);
    expect(formatMemory("8192")).toBe("8 MB");
    expect(formatMemory("640")).toBe("640 KB");
    expect(formatMemory("x")).toBe(null);
    expect(formatMemory("0")).toBe(null);
  });
});

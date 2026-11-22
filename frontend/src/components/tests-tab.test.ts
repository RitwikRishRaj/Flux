import { describe, it, expect } from "vitest";
import { firstDiffLine } from "./tests-tab";

describe("firstDiffLine", () => {
  it("finds the first differing line under the trim checker's rules", () => {
    expect(firstDiffLine("3\nok\n", "3\nOK")).toBe(2);
    expect(firstDiffLine("3  \r\nok\n\n", "3\nok")).toBeNull();
    expect(firstDiffLine("3", "3\nok")).toBe(2);
  });
});

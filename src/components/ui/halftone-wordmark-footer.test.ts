import { describe, expect, it } from "vitest";
import { hwfFitSize, hwfHex, hwfRadius, hwfStep, hwfWarmth } from "./halftone-wordmark-footer";

describe("halftone helpers", () => {
  it("reads #rgb and #rrggbb, rejects the rest", () => {
    expect(hwfHex("#E1E0CC")).toEqual([225, 224, 204]);
    expect(hwfHex("#fff")).toEqual([255, 255, 255]);
    expect(hwfHex("tomato")).toBeNull();
  });

  it("sizes dots by area and clamps coverage", () => {
    expect(hwfRadius(1, 6)).toBeCloseTo(3.36);
    expect(hwfRadius(0.25, 6)).toBeCloseTo(1.68);
    expect(hwfRadius(2, 6)).toBe(hwfRadius(1, 6));
  });

  it("a pushed dot moves away from the pointer, then settles home", () => {
    let s = [100, 50, 0, 0];
    for (let i = 0; i < 10; i++) s = hwfStep(s[0], s[1], s[2], s[3], 100, 50, 90, 50, 80);
    expect(s[0]).toBeGreaterThan(100);
    for (let i = 0; i < 400; i++) s = hwfStep(s[0], s[1], s[2], s[3], 100, 50, -1e5, -1e5, 80);
    expect(Math.abs(s[0] - 100)).toBeLessThan(0.05);
    expect(hwfWarmth(s[0], s[1], 100, 50, 28)).toBeLessThan(0.01);
  });

  it("fits the word to the width", () => {
    expect(hwfFitSize(300, 1200)).toBe(400);
    expect(hwfFitSize(0, 1200)).toBe(0);
  });
});

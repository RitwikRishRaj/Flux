import { describe, expect, it } from "vitest";
import { PUSH, stepDots } from "./halftone";

describe("stepDots", () => {
  it("pushes a dot away from the pointer, then springs it home", () => {
    const d = Float32Array.from([100, 50, 100, 50]);
    const v = new Float32Array(2);
    for (let i = 0; i < 10; i++) stepDots(d, v, 90, 50, []);
    expect(d[2]).toBeGreaterThan(100); // pushed right, away from a pointer on its left
    expect(d[2] - 90).toBeLessThan(PUSH + 20);
    let unrest = Infinity;
    for (let i = 0; i < 400; i++) unrest = stepDots(d, v, null, null, []);
    expect(unrest).toBeLessThan(0.05);
    expect(Math.abs(d[2] - 100)).toBeLessThan(0.05);
  });

  it("a ring passing a dot kicks it outward", () => {
    const d = Float32Array.from([0, 30, 0, 30]);
    const v = new Float32Array(2);
    stepDots(d, v, null, null, [{ x: 0, y: 0, r: 30 }]);
    expect(d[3]).toBeGreaterThan(30);
  });
});

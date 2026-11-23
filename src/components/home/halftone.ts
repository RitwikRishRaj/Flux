// Dot physics for the footer wordmark. Each dot is 4 floats: home x, home y, x, y.
// Velocities live in a second array so the step stays allocation-free.
export const STRIDE = 4;

export type Ring = { x: number; y: number; r: number };

export const PUSH = 90; // pointer radius, px
const SPRING = 0.07;
const DAMP = 0.82;

/** Advances every dot one frame. Returns the most restless dot's motion so the caller can stop when all are settled. */
export function stepDots(d: Float32Array, v: Float32Array, px: number | null, py: number | null, rings: Ring[]): number {
  let max = 0;
  for (let i = 0, j = 0; i < d.length; i += STRIDE, j += 2) {
    const x = d[i + 2], y = d[i + 3];
    let vx = v[j] + (d[i] - x) * SPRING;
    let vy = v[j + 1] + (d[i + 1] - y) * SPRING;
    if (px !== null && py !== null) {
      const dx = x - px, dy = y - py, dist = Math.hypot(dx, dy);
      if (dist < PUSH && dist > 0.01) {
        const f = (1 - dist / PUSH) * 2.4;
        vx += (dx / dist) * f;
        vy += (dy / dist) * f;
      }
    }
    for (const ring of rings) {
      const dx = x - ring.x, dy = y - ring.y, dist = Math.hypot(dx, dy);
      const band = Math.abs(dist - ring.r);
      if (band < 24 && dist > 0.01) {
        const f = (1 - band / 24) * 3;
        vx += (dx / dist) * f;
        vy += (dy / dist) * f;
      }
    }
    vx *= DAMP;
    vy *= DAMP;
    v[j] = vx;
    v[j + 1] = vy;
    d[i + 2] = x + vx;
    d[i + 3] = y + vy;
    // Speed plus distance from home, so a dot paused at the far end of a swing does not count as settled.
    const unrest = Math.abs(vx) + Math.abs(vy) + Math.abs(d[i] - d[i + 2]) + Math.abs(d[i + 1] - d[i + 3]);
    if (unrest > max) max = unrest;
  }
  return max;
}

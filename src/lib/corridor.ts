/**
 * The shared zone between two projects, drawn like a surveyor would: a loose,
 * slightly irregular outline around the gap between their closest points,
 * filled with hand-set hatching instead of a flat tint.
 */
import type { Position } from "./types";

type XY = [number, number];

function toXY(p: Position, lat0: number): XY {
  return [p[0] * 111.32 * Math.cos((lat0 * Math.PI) / 180), p[1] * 110.57];
}
function toLL(p: XY, lat0: number): Position {
  return [p[0] / (111.32 * Math.cos((lat0 * Math.PI) / 180)), p[1] / 110.57];
}

/** Smooth deterministic wobble in [-1, 1] (no randomness, so the drawing is stable). */
function wobble(i: number, seed: number): number {
  return 0.55 * Math.sin(i * 1.7 + seed) + 0.3 * Math.sin(i * 3.9 + seed * 2.3) + 0.15 * Math.sin(i * 7.3 + seed * 0.7);
}

export interface Corridor {
  outline: Position[];
  hatches: [Position, Position][];
}

/**
 * Capsule around the segment a–b (or a blob around a point when they touch),
 * `halfWidthKm` wide, outlined with a gentle wobble and hatched at ~38°.
 */
export function hatchedCorridor(a: Position, b: Position, halfWidthKm: number, seed = 1): Corridor {
  const lat0 = (a[1] + b[1]) / 2;
  const A = toXY(a, lat0);
  const B = toXY(b, lat0);
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const len = Math.hypot(dx, dy);
  const ux = len > 1e-6 ? dx / len : 1;
  const uy = len > 1e-6 ? dy / len : 0;
  const nx = -uy;
  const ny = ux;
  const w = halfWidthKm;

  // Capsule outline: a half circle around each end joined by straight sides.
  const pts: XY[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI / 2 - (Math.PI * i) / steps; // B end, from +n to -n
    pts.push([B[0] + (ux * Math.cos(t) + nx * Math.sin(t)) * w, B[1] + (uy * Math.cos(t) + ny * Math.sin(t)) * w]);
  }
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI / 2 - (Math.PI * i) / steps; // A end, from -n back to +n
    pts.push([A[0] + (ux * Math.cos(t) + nx * Math.sin(t)) * w, A[1] + (uy * Math.cos(t) + ny * Math.sin(t)) * w]);
  }
  // Wobble each vertex outward/inward a little, relative to the centre.
  const cx = (A[0] + B[0]) / 2;
  const cy = (A[1] + B[1]) / 2;
  const drawn = pts.map((p, i) => {
    const k = 1 + 0.06 * wobble(i, seed);
    return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k] as XY;
  });
  drawn.push(drawn[0]);

  // Hatching: parallel lines at a fixed angle, clipped to the (convex) outline.
  const angle = (38 * Math.PI) / 180;
  const hx = Math.cos(angle);
  const hy = Math.sin(angle);
  const px = -hy;
  const py = hx;
  const spacing = Math.max(0.09, w / 4.5);
  const extent = len / 2 + w * 1.2;
  const hatches: [Position, Position][] = [];
  let i = 0;
  for (let off = -extent; off <= extent; off += spacing, i++) {
    const ox = cx + px * off;
    const oy = cy + py * off;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (let k = 1; k < drawn.length; k++) {
      const [x1, y1] = drawn[k - 1];
      const [x2, y2] = drawn[k];
      const ex = x2 - x1;
      const ey = y2 - y1;
      const den = hx * ey - hy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((x1 - ox) * ey - (y1 - oy) * ex) / den;
      const s = ((x1 - ox) * hy - (y1 - oy) * hx) / den;
      if (s >= 0 && s <= 1) {
        tMin = Math.min(tMin, t);
        tMax = Math.max(tMax, t);
      }
    }
    if (tMax - tMin < spacing * 0.6) continue;
    // Hand-set: stop a touch short of the outline, unevenly.
    const inset = (tMax - tMin) * (0.06 + 0.04 * (wobble(i, seed + 3) + 1));
    const s0 = tMin + inset;
    const s1 = tMax - inset * 0.8;
    hatches.push([toLL([ox + hx * s0, oy + hy * s0], lat0), toLL([ox + hx * s1, oy + hy * s1], lat0)]);
  }

  return { outline: drawn.map((p) => toLL(p, lat0)), hatches };
}

/** Half-width of the shared zone for a pair at `distanceKm` apart. */
export function corridorHalfWidth(distanceKm: number): number {
  if (distanceKm < 0.3) return 0.9;
  return Math.min(6, Math.max(0.5, distanceKm * 0.3));
}

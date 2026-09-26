/**
 * Overlap finder, the same rules as the pipeline, for utility pairs that have
 * no precomputed pair file. Runs in a Web Worker (overlap.worker.ts).
 *
 *   distance  = closest-point distance between the two geometries (km),
 *               computed in a local equirectangular projection
 *   tier      = crossing (touch or cross) · row < 1.6 km · logistics < 8 km · crew ≤ 40 km
 *   timeline  = months both build windows overlap
 *   score     = 0.7 · (1 − distance/40) + 0.3 · min(timeline, 24)/24
 */
import type { OverlapTier, Position, ProjectGeometry } from "./types";

export interface ProjectLite {
  id: string;
  geometry: ProjectGeometry;
  buildWindow: [string, string] | null;
  locationConfidence: number;
  name: string;
}

export interface ComputedOverlap {
  aId: string;
  bId: string;
  distanceKm: number;
  tier: OverlapTier;
  closestPoints: [Position, Position];
  timelineOverlapMonths: number;
  robustness: "robust" | "uncertain";
  shareable: string[];
  score: number;
  rank: number;
  summary: string;
}

const MAX_KM = 40;

function project(p: Position, lat0: number): [number, number] {
  return [p[0] * 111.32 * Math.cos((lat0 * Math.PI) / 180), p[1] * 110.57];
}
function unproject(p: [number, number], lat0: number): Position {
  return [p[0] / (111.32 * Math.cos((lat0 * Math.PI) / 180)), p[1] / 110.57];
}

type XY = [number, number];

function closestOnSeg(p: XY, a: XY, b: XY): XY {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return [a[0] + dx * t, a[1] + dy * t];
}

function segIntersect(a: XY, b: XY, c: XY, d: XY): XY | null {
  const cross = (o: XY, p: XY, q: XY) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    const t = d1 / (d1 - d2);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  return null;
}

function segments(g: ProjectGeometry, lat0: number): [XY, XY][] {
  const pts = (g.type === "Point" ? [g.coordinates] : g.coordinates).map((p) => project(p, lat0));
  if (pts.length === 1) return [[pts[0], pts[0]]];
  const out: [XY, XY][] = [];
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]]);
  return out;
}

/** Closest points and distance (km) between two geometries. */
export function closestBetween(ga: ProjectGeometry, gb: ProjectGeometry): { d: number; pa: Position; pb: Position } {
  const lat0 = (ga.type === "Point" ? ga.coordinates[1] : ga.coordinates[0][1]) || 33;
  let best = { d: Infinity, pa: [0, 0] as XY, pb: [0, 0] as XY };
  for (const [a, b] of segments(ga, lat0))
    for (const [c, d] of segments(gb, lat0)) {
      const x = a !== b && c !== d ? segIntersect(a, b, c, d) : null;
      if (x) return { d: 0, pa: unproject(x, lat0), pb: unproject(x, lat0) };
      const cands: [XY, XY][] = [
        [a, closestOnSeg(a, c, d)],
        [b, closestOnSeg(b, c, d)],
        [closestOnSeg(c, a, b), c],
        [closestOnSeg(d, a, b), d],
      ];
      for (const [p, q] of cands) {
        const dd = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (dd < best.d) best = { d: dd, pa: p, pb: q };
      }
    }
  return { d: best.d, pa: unproject(best.pa, lat0), pb: unproject(best.pb, lat0) };
}

export function tierFor(km: number): OverlapTier | null {
  if (km <= 0.05) return "crossing";
  if (km < 1.6) return "row";
  if (km < 8) return "logistics";
  if (km <= MAX_KM) return "crew";
  return null;
}

export function windowOverlapMonths(a: [string, string] | null, b: [string, string] | null): number {
  if (!a || !b) return 0;
  const s = Math.max(Date.parse(a[0]), Date.parse(b[0]));
  const e = Math.min(Date.parse(a[1]), Date.parse(b[1]));
  return e > s ? Math.round(((e - s) / (1000 * 3600 * 24 * 30.44)) * 10) / 10 : 0;
}

const SHARE: Record<OverlapTier, string[]> = {
  crossing: ["crossing design", "outage coordination"],
  row: ["right-of-way", "permits"],
  logistics: ["laydown yard", "material deliveries"],
  crew: ["crews", "equipment"],
};
const ORDER: OverlapTier[] = ["crossing", "row", "logistics", "crew"];

export function computeOverlaps(
  a: ProjectLite[],
  b: ProjectLite[],
): { pairsCompared: number; overlaps: ComputedOverlap[] } {
  const out: ComputedOverlap[] = [];
  for (const pa of a)
    for (const pb of b) {
      const c = closestBetween(pa.geometry, pb.geometry);
      const tier = tierFor(c.d);
      if (!tier) continue;
      const km = tier === "crossing" ? 0 : Math.round(c.d * 100) / 100;
      const months = windowOverlapMonths(pa.buildWindow, pb.buildWindow);
      const score =
        Math.round((0.7 * (1 - Math.min(km, MAX_KM) / MAX_KM) + (0.3 * Math.min(months, 24)) / 24) * 1000) / 1000;
      const at = ORDER.indexOf(tier);
      out.push({
        aId: pa.id,
        bId: pb.id,
        distanceKm: km,
        tier,
        closestPoints: [c.pa, c.pb],
        timelineOverlapMonths: months,
        robustness: pa.locationConfidence >= 0.7 && pb.locationConfidence >= 0.7 ? "robust" : "uncertain",
        shareable: ORDER.slice(at).flatMap((t) => SHARE[t]),
        score,
        rank: 0,
        summary: `${pa.name} and ${pb.name} ${
          tier === "crossing"
            ? "touch or cross"
            : `come within ${km < 10 ? km.toFixed(1) : Math.round(km)} km of each other`
        }.${months > 0 ? ` Their build windows overlap by about ${Math.round(months)} months.` : ""}`,
      });
    }
  out.sort((x, y) => y.score - x.score || x.distanceKm - y.distanceKm);
  out.forEach((o, i) => (o.rank = i + 1));
  return { pairsCompared: a.length * b.length, overlaps: out };
}

/**
 * Geometry for the realistic map effects: river orientation, tower placement,
 * catenary wire shapes and storm wind spirals. Pure functions, no rendering.
 */
import type { Position } from "../types";

const DEG = Math.PI / 180;
/** Web Mercator world width in metres at the equator. */
const EARTH_CIRCUMFERENCE_M = 40075016.686;

/** Metres per screen pixel at a zoom level and latitude (512 px tiles, as MapLibre and deck.gl use). */
export function metersPerPixel(zoom: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * DEG)) / (512 * 2 ** zoom);
}

/** Local east/north metre offset from a to b (equirectangular, fine at these distances). */
export function offsetMeters(a: Position, b: Position): [number, number] {
  const k = Math.cos(((a[1] + b[1]) / 2) * DEG);
  return [(b[0] - a[0]) * 111320 * k, (b[1] - a[1]) * 110540];
}

export function distanceMeters(a: Position, b: Position): number {
  const [x, y] = offsetMeters(a, b);
  return Math.hypot(x, y);
}

/** Cumulative distance (metres) at each vertex of a path, starting at 0. */
export function cumulativeMeters(path: Position[]): number[] {
  const out = new Array<number>(path.length);
  let d = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) d += distanceMeters(path[i - 1], path[i]);
    out[i] = d;
  }
  return out;
}

/** Drops consecutive duplicate vertices, which break per-vertex attributes in deck.gl paths. */
export function dedupe(path: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of path) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out;
}

/* ---------------- River ---------------- */

/** Upstream reference (Augusta) and the river mouth below Savannah. */
const RIVER_UPSTREAM: Position = [-82.0, 33.5];
const RIVER_MOUTH: Position = [-80.88, 32.03];

const JOIN_TOLERANCE_M = 250;

/**
 * Chains river pieces end to end and orients every chain downstream
 * (Augusta in the north-west towards the Atlantic in the south-east).
 * Pieces from OpenStreetMap arrive in arbitrary order and direction.
 */
export function orientDownstream(pieces: Position[][]): Position[][] {
  const pool = pieces.map(dedupe).filter((p) => p.length > 1);
  const chains: Position[][] = [];
  while (pool.length) {
    let chain = pool.shift()!.slice();
    let grew = true;
    while (grew && pool.length) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];
        const ps = p[0];
        const pe = p[p.length - 1];
        let joined: Position[] | null = null;
        if (distanceMeters(tail, ps) < JOIN_TOLERANCE_M) joined = [...chain, ...p.slice(1)];
        else if (distanceMeters(tail, pe) < JOIN_TOLERANCE_M) joined = [...chain, ...p.slice(0, -1).reverse()];
        else if (distanceMeters(head, pe) < JOIN_TOLERANCE_M) joined = [...p.slice(0, -1), ...chain];
        else if (distanceMeters(head, ps) < JOIN_TOLERANCE_M) joined = [...p.slice(1).reverse(), ...chain];
        if (joined) {
          chain = joined;
          pool.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    chains.push(chain);
  }
  const axis = offsetMeters(RIVER_UPSTREAM, RIVER_MOUTH);
  const along = (p: Position) => {
    const o = offsetMeters(RIVER_UPSTREAM, p);
    return o[0] * axis[0] + o[1] * axis[1];
  };
  for (const c of chains) if (along(c[0]) > along(c[c.length - 1])) c.reverse();
  return chains.sort((a, b) => b.length - a.length);
}

/* ---------------- Towers and wires ---------------- */

export interface Tower {
  position: Position;
  /** Unit vector (east, north) along the cross-arm, perpendicular to the line. */
  arm: [number, number];
  /** Style index: 0 neutral, 1 DESC, 2 GPC. */
  style: number;
}

export interface Span {
  a: Tower;
  b: Tower;
  meters: number;
  style: number;
}

export type Bbox = [number, number, number, number];

function inBbox(p: Position, b: Bbox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

function pathBbox(path: Position[]): Bbox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of path) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

function bboxOverlap(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function unit(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/**
 * Places towers along a line: one at every bend (angle towers) and evenly
 * spaced suspension towers in between, no further apart than `spacingM`.
 * Only spans touching `bbox` are kept, so dense networks stay cheap.
 */
export function placeTowers(path: Position[], spacingM: number, style: number, bbox: Bbox): { towers: Tower[]; spans: Span[] } {
  const clean = dedupe(path);
  if (clean.length < 2 || !bboxOverlap(pathBbox(clean), bbox)) return { towers: [], spans: [] };
  const pts: Position[] = [clean[0]];
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1];
    const b = clean[i];
    const n = Math.max(1, Math.ceil(distanceMeters(a, b) / spacingM));
    for (let k = 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const towers: Tower[] = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dIn = unit(offsetMeters(i > 0 ? prev : p, p));
    const dOut = unit(offsetMeters(p, i < pts.length - 1 ? next : p));
    // Cross-arms bisect the angle at bends.
    const dir = unit([
      (i > 0 ? dIn[0] : 0) + (i < pts.length - 1 ? dOut[0] : 0),
      (i > 0 ? dIn[1] : 0) + (i < pts.length - 1 ? dOut[1] : 0),
    ]);
    return { position: p, arm: [-dir[1], dir[0]], style };
  });
  const spans: Span[] = [];
  const keep = new Set<number>();
  for (let i = 1; i < towers.length; i++) {
    const a = towers[i - 1];
    const b = towers[i];
    if (!inBbox(a.position, bbox) && !inBbox(b.position, bbox)) continue;
    spans.push({ a, b, meters: distanceMeters(a.position, b.position), style });
    keep.add(i - 1);
    keep.add(i);
  }
  return { towers: towers.filter((_, i) => keep.has(i)), spans };
}

/**
 * Normalised catenary sag along a span: 0 at both towers, 1 at mid-span.
 * `c` is the shape parameter (larger = flatter middle, steeper ends).
 */
export function catenarySag(u: number, c = 1.4): number {
  const x = (u - 0.5) * 2 * c;
  return 1 - (Math.cosh(x) - 1) / (Math.cosh(c) - 1);
}

/* ---------------- Storm wind ---------------- */

/** Deterministic pseudo-random in [0, 1). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WindArc {
  /** Offsets from the storm centre in units of the storm radius (east, north). */
  path: [number, number][];
  /** 0..1 along the arc for each vertex. */
  along: number[];
  /** Packed animation seed: integer part = speed x100, fraction = phase. */
  seed: number;
  /** 0..1, 1 near the core. */
  strength: number;
}

/**
 * Short inflow arcs following a logarithmic spiral that winds
 * counter-clockwise towards the centre (northern hemisphere).
 * Denser near the core, sparser outside.
 */
export function windArcs(count: number, seed = 7): WindArc[] {
  const rnd = seeded(seed);
  const inflow = Math.tan(22 * DEG);
  const arcs: WindArc[] = [];
  for (let i = 0; i < count; i++) {
    const r0 = 0.16 + 1.0 * rnd() ** 1.5;
    const a0 = rnd() * Math.PI * 2;
    const sweep = 0.7 + 0.9 * rnd();
    const steps = 14;
    const path: [number, number][] = [];
    const along: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const th = a0 + (sweep * k) / steps;
      const r = r0 * Math.exp(-inflow * (th - a0));
      path.push([r * Math.cos(th), r * Math.sin(th)]);
      along.push(k / steps);
    }
    // Angular speed grows towards the eyewall.
    const speed = Math.min(2.4, 0.5 / Math.sqrt(Math.max(0.12, r0)));
    arcs.push({
      path,
      along,
      seed: Math.round(speed * 100) + rnd() * 0.999,
      strength: Math.max(0, Math.min(1, 1.15 - r0)),
    });
  }
  return arcs;
}

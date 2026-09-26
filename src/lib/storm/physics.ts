/**
 * In-browser storm physics for MrGridy "next hurricane" runs.
 *
 * A TypeScript port of the Python Response pipeline (pipeline/gridsight/response):
 *   wind.py       Holland (1980) gradient-wind profile, B fitted to the 34-kt radius when
 *                 one is given (else Vickery & Wadhera 2008), 20 deg inflow, translation
 *                 asymmetry a = 0.55 rotated 20 deg (Lin & Chavas 2012), marine-to-land
 *                 reduction K_LAND = 0.83 while the centre is over water, 3-s gust factor.
 *   fragility.py  Darestani & Shafieezadeh (2019) Class 1 wood pole 4-D surface (age 40,
 *                 conductor area 8 m^2) and Raj, Kumar & Bhatia (2021) lattice tower
 *                 lognormal (median 280.4 km/h, beta 0.088).
 *   treefall.py   Hou & Muraleetharan (2023) logistic tree fragility (Bur oak, zero-wind
 *                 rate removed), fall-reach geometry, hazard-tree density 0.03 per m^2 of
 *                 canopy times the managed right-of-way factor F_ROW.
 *   simulate.py   Monte Carlo over perturbed tracks: cross-track offset, intensity offset,
 *                 Rmax multiplier exp(N(0, 0.25^2)), gust factor N(1.23, 0.05^2) clipped to
 *                 [1.10, 1.40]. Default 50 members (the pipeline uses 500 on CPU, 10,000 on
 *                 GPU), best-track sigmas (15 km, 5 kt) or NHC forecast-error sigmas by lead.
 *
 * Differences from the Python run, all documented:
 *   - It scores the downsampled network in public/data/response/segments-lite.json
 *     (lite.py); totals are scaled back with each segment's weight.
 *   - The random stream differs (seeded mulberry32 + Box-Muller instead of torch).
 *   - The R34 B-fit is decided per member (Python decides per chunk of members).
 *   - Whether the centre is over land uses a 0.1 deg grid of the same US-states land
 *     test (landMask in segments-lite.json), not the exact polygons.
 *   - Track steps whose centre is farther than MAX_RADIUS_KM from every lite point are
 *     skipped (Python skips a step when every point is farther than 900 km).
 */

import type { StormTrackPoint } from "../types";

// ---------- network ----------

export type LiteUtility = "DESC" | "GPC" | "OTHER";

export interface LiteNetwork {
  utilities: LiteUtility[];
  sampling: { stride: Record<string, number>; sourceSegments: number; segments: number };
  segments: {
    utility: number[];
    lattice: number[];
    lon: number[];
    lat: number[];
    bearing: number[];
    lengthKm: number[];
    nStructures: number[];
    land: number[];
    county: number[];
    canopy: number[];
    rowHalfWidthM: number[];
    conductorHeightM: number[];
    weight: number[];
  };
  counties: { fips: string[]; name: string[]; state: string[]; lon: number[]; lat: number[] };
  landMask: { west: number; south: number; east: number; north: number; step: number; nx: number; ny: number; bits: string };
  constants?: { treefall?: { fRow?: number; rhoPerM2?: number } };
}

// ---------- options / results ----------

export interface SimulateOptions {
  network: LiteNetwork;
  /** Ensemble size (perturbed tracks). Default 50. */
  members?: number;
  seed?: number;
  /** "best": fixed sigmas (15 km, 5 kt). "forecast": NHC OFCL error sigmas by lead time from issuedAt. */
  mode?: "best" | "forecast";
  issuedAt?: string;
  /** Mean 34-kt wind radius (km) per track point, same length as the track; null = unknown. */
  r34Km?: (number | null)[];
  /** Track interpolation step (minutes). Default 30, as in the pipeline. */
  dtMin?: number;
}

export interface UtilityDamage {
  expectedFailedSegments: number;
  p05: number;
  p95: number;
  expectedWindFailedSegments: number;
  expectedFailedStructures: number;
  expectedTreeSpans: number;
}

export interface CountyDamage {
  fips: string;
  name: string;
  expectedFailedSegments: number;
  gustMph: number;
  tsHours: number;
}

export interface SimulateResult {
  /** Mean failure probability per lite segment (wind or trees). */
  segmentRisk: Float32Array;
  pWind: Float32Array;
  pTree: Float32Array;
  /** Mean peak 3-s gust per lite segment, mph. */
  gustMph: Float32Array;
  perUtility: Record<LiteUtility, UtilityDamage>;
  perCounty: CountyDamage[];
  members: number;
  steps: number;
  millis: number;
}

// ---------- constants (mirroring the Python modules) ----------

const KT_TO_MS = 0.514444;
const MS_TO_MPH = 2.236936;
const KM_PER_DEG = 111.195;
const OMEGA = 7.292e-5;
const A_TRANS = 0.55;
const TRANS_ROT = (20 * Math.PI) / 180;
const INFLOW = (20 * Math.PI) / 180;
const K_LAND = 0.83;
const V34_MS = 34 * KT_TO_MS;
const MAX_RADIUS_KM = 900;
const BBOX = [-85.7, 30.3, -78.4, 35.3];
const NEAR_MARGIN_DEG = 7;

const BEST_TRACK_SIGMA_KM = 15;
const BEST_INT_SIGMA_KT = 5;
const RMAX_LN_SIGMA = 0.25;
const GF_MEAN = 1.23;
const GF_SD = 0.05;
const LEAD_H = [0, 12, 24, 36, 48, 72, 96, 120];
const OFCL_TRACK_NM = [6.9, 22.7, 34.2, 45.5, 58.2, 89.4, 126.8, 182.9];
const OFCL_INT_KT = [1.4, 5.2, 7.5, 9.0, 10.3, 11.4, 12.9, 14.3];

// Darestani & Shafieezadeh (2019) Table 14, Class 1, height uncertain.
const CLASS1_MU = [5.581, -4.306e-3, -2.408e-2, 5.986e-3, 2.569e-5, -1.231e-3, 3.524e-3, -1.176e-6, -1.324e-5, -1.327e-4];
const CLASS1_SIGMA = [2.974e-1, -1.411e-3, -9.462e-3, -2.678e-3, 7.782e-6, -5.088e-5, 6.199e-4, 6.805e-6, 5.63e-5, 6.037e-5];
const WOOD_AGE = 40;
const WOOD_AC = 8;
const LN_LATTICE_MEDIAN_MPH = Math.log(280.4 / 1.609344);
const LATTICE_BETA = 0.088;

// Hou & Muraleetharan (2023) Table 2 (Bur oak): a0, a1 (H, m), a2 (3-s gust, m/s).
const SB = [-17.28, 0.42, 0.13];
const UP = [-2.22, -0.43, 0.11];
const H_GRID = Array.from({ length: 11 }, (_, i) => 8 + 2 * i);
const DEFAULT_RHO = 0.03;
const DEFAULT_F_ROW = 0.11;

// ---------- small math helpers ----------

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7).
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + f * (ys[i] - ys[i - 1]);
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalStream(seed: number) {
  const u = mulberry32(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u1 = u();
    while (u1 <= 1e-12) u1 = u();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = 2 * Math.PI * u();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

// ---------- land mask ----------

function landTester(mask: LiteNetwork["landMask"]) {
  const bin = typeof atob === "function" ? atob(mask.bits) : Buffer.from(mask.bits, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return (lon: number, lat: number) => {
    const ix = Math.floor((lon - mask.west) / mask.step);
    const iy = Math.floor((lat - mask.south) / mask.step);
    if (ix < 0 || iy < 0 || ix >= mask.nx || iy >= mask.ny) return false;
    const k = iy * mask.nx + ix;
    return ((bytes[k >> 3] >> (k & 7)) & 1) === 1;
  };
}

// ---------- track interpolation (wind.interpolate) ----------

interface Steps {
  hours: number[];
  lat: number[];
  lon: number[];
  vmax: number[];
  rmw: number[];
  r34: number[];
  vte: number[];
  vtn: number[];
  lead: number[];
  land: boolean[];
}

function rmaxWilloughby(vmaxKt: number, lat: number): number {
  return 46.4 * Math.exp(-0.0155 * vmaxKt * KT_TO_MS + 0.0169 * Math.abs(lat));
}

function gradient(f: number[]): number[] {
  const n = f.length;
  if (n < 2) return f.map(() => 0);
  return f.map((_, i) => (i === 0 ? f[1] - f[0] : i === n - 1 ? f[n - 1] - f[n - 2] : (f[i + 1] - f[i - 1]) / 2));
}

function interpolateTrack(
  track: StormTrackPoint[],
  r34In: (number | null)[] | undefined,
  dtMin: number,
  issuedAt: string | undefined,
  isLand: (lon: number, lat: number) => boolean,
): Steps {
  const t = track.map((p) => Date.parse(p.time) / 3.6e6);
  const lat = track.map((p) => p.position[1]);
  const lon = track.map((p) => p.position[0]);
  const vk = track.map((p) => p.windKt);
  const rmw = track.map((p, i) => (p.rmwKm != null && Number.isFinite(p.rmwKm) ? p.rmwKm : rmaxWilloughby(vk[i], lat[i])));
  const step = dtMin / 60;
  const hrs: number[] = [];
  for (let x = t[0]; x <= t[t.length - 1] + 1e-9; x += step) hrs.push(x);
  const la = hrs.map((x) => interp(x, t, lat));
  const lo = hrs.map((x) => interp(x, t, lon));
  const vm = hrs.map((x) => interp(x, t, vk) * KT_TO_MS);
  const rm = hrs.map((x) => interp(x, t, rmw));
  const okT: number[] = [];
  const okR: number[] = [];
  (r34In ?? []).forEach((r, i) => {
    if (r != null && Number.isFinite(r) && i < t.length) {
      okT.push(t[i]);
      okR.push(r);
    }
  });
  const r34 = hrs.map((x) => (okT.length >= 2 && x >= okT[0] && x <= okT[okT.length - 1] ? interp(x, okT, okR) : NaN));
  const dy = gradient(la).map((d) => d * KM_PER_DEG * 1000);
  const dx = gradient(lo).map((d, i) => d * KM_PER_DEG * 1000 * Math.cos((la[i] * Math.PI) / 180));
  const issued = issuedAt ? Date.parse(issuedAt) / 3.6e6 : null;
  return {
    hours: hrs.map((x) => x - hrs[0]),
    lat: la,
    lon: lo,
    vmax: vm,
    rmw: rm,
    r34,
    vte: dx.map((d) => d / (step * 3600)),
    vtn: dy.map((d) => d / (step * 3600)),
    lead: hrs.map((x) => (issued == null ? 0 : Math.max(0, x - issued))),
    land: hrs.map((_, i) => isLand(lo[i], la[i])),
  };
}

function nearRegion(s: Steps): number[] {
  const [w, so, e, n] = BBOX;
  const m = NEAR_MARGIN_DEG;
  const idx: number[] = [];
  for (let i = 0; i < s.lat.length; i++) {
    if (s.lon[i] > w - m && s.lon[i] < e + m && s.lat[i] > so - m && s.lat[i] < n + m) idx.push(i);
  }
  return idx;
}

// ---------- Holland B ----------

function hollandB(rm: number, lat: number): number {
  return Math.min(2.2, Math.max(0.8, 1.881 - 0.00557 * rm - 0.01295 * lat));
}

function fitBR34(vs: number, rm: number, r34: number): number {
  let lo = 0.8;
  let hi = 2.5;
  const ratio = Math.min(rm / r34, 0.999);
  for (let k = 0; k < 40; k++) {
    const mid = 0.5 * (lo + hi);
    const x = Math.pow(ratio, mid);
    const v = vs * Math.sqrt(x * Math.exp(1 - x));
    if (v > V34_MS) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---------- fragility ----------

function surface(b: number[], th: number, ac: number, t: number): number {
  return b[0] + b[1] * th + b[2] * ac + b[3] * t + b[4] * th * th + b[5] * th * ac + b[6] * ac * ac + b[7] * th * t + b[8] * ac * t + b[9] * t * t;
}

/** Per-structure failure probability given the peak 3-s gust (m/s) and wind-line angle (deg). */
export function structureFailure(gustMs: number, thetaDeg: number, lattice: boolean): number {
  const lnv = Math.log(Math.max(gustMs * MS_TO_MPH, 1e-3));
  if (lattice) return phi((lnv - LN_LATTICE_MEDIAN_MPH) / LATTICE_BETA);
  const th = Math.min(90, Math.max(0, thetaDeg));
  const age = Math.max(WOOD_AGE, 25);
  const mu = surface(CLASS1_MU, th, WOOD_AC, age);
  const sg = surface(CLASS1_SIGMA, th, WOOD_AC, age);
  return phi((lnv - mu) / Math.max(sg, 1e-3));
}

// Zero-wind failure rates per height class, removed from the logistic curves.
const SB_P0 = H_GRID.map((H) => sigmoid(SB[0] + SB[1] * H));
const UP_P0 = H_GRID.map((H) => sigmoid(UP[0] + UP[1] * H));

function logisticAdj(a: number[], p0: number, H: number, U: number): number {
  const p = sigmoid(a[0] + a[1] * H + a[2] * U);
  return Math.max(0, (p - p0) / (1 - p0));
}

/** Expected fraction of trees (H ~ U[8, 28] m) that break or uproot at this gust (m/s). */
export function treeFailFraction(gustMs: number): number {
  let acc = 0;
  for (let k = 0; k < H_GRID.length; k++) {
    const H = H_GRID[k];
    const ps = logisticAdj(SB, SB_P0[k], H, gustMs);
    const pu = logisticAdj(UP, UP_P0[k], H, gustMs);
    acc += 1 - (1 - ps) * (1 - pu);
  }
  return acc / H_GRID.length;
}

/** Expected tree strikes per km of line (treefall.strike_rate_per_km). */
export function strikeRatePerKm(
  gustMs: number,
  thetaDeg: number,
  canopy: number,
  halfWidthM: number,
  heightM: number,
  rho = DEFAULT_RHO,
  fRow = DEFAULT_F_ROW,
): number {
  if (canopy <= 0) return 0;
  const s = Math.sin((Math.min(90, Math.max(0, thetaDeg)) * Math.PI) / 180);
  let band = 0;
  for (let k = 0; k < H_GRID.length; k++) {
    const H = H_GRID[k];
    const hb = 0.946 * H - 1.827;
    const hBrk = heightM - (H - hb);
    const reachUp = s * Math.sqrt(Math.max(H * H - heightM * heightM, 0));
    const reachSb = s * Math.sqrt(Math.max(hb * hb - hBrk * hBrk, 0));
    if (reachSb > halfWidthM) band += logisticAdj(SB, SB_P0[k], H, gustMs) * (reachSb - halfWidthM);
    if (reachUp > halfWidthM) band += logisticAdj(UP, UP_P0[k], H, gustMs) * (reachUp - halfWidthM);
  }
  return (1000 * rho * fRow * canopy * band) / H_GRID.length;
}


// ---------- the Monte Carlo ----------

function percentile(sorted: Float64Array, q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

interface Points {
  n: number;
  lon: Float64Array;
  lat: Float64Array;
  cos: Float64Array;
  land: Uint8Array;
  le: Float64Array;
  ln: Float64Array;
}

const COS_I = Math.cos(INFLOW);
const SIN_I = Math.sin(INFLOW);
const BOUND_DR_KM = 5;
const BOUND_BINS = 800; // 4,000 km

/**
 * Upper bound of the surface wind speed (m/s) at radius r >= Rm for one step: the
 * symmetric Holland profile without the Coriolis term (which only lowers it) plus the
 * full translation component. Monotone decreasing beyond Rm, so the value at a bin's
 * inner edge bounds the whole bin.
 */
function speedBound(bound: Float64Array, rm: number, B: number, vs: number, trans: number): void {
  for (let b = 0; b < BOUND_BINS; b++) {
    const r = Math.max(b * BOUND_DR_KM, rm);
    const x = Math.pow(rm / r, B);
    bound[b] = vs * Math.sqrt(x * Math.exp(1 - x)) + trans;
  }
}

/**
 * One track step of wind.peak_wind for one ensemble member. Tracks the peak sustained
 * speed (the gust factor is a per-member constant, so the peak gust is at the same step),
 * the cosine of the wind-line angle at that peak, and hours of >= 34 kt wind. A point is
 * skipped only when the bound proves it can neither beat its current peak nor reach 34 kt,
 * so the result equals evaluating every point.
 */
function windStep(
  p: Points, peak: Float64Array, cosTh: Float64Array, tsH: Float64Array, bound: Float64Array,
  clon: number, clat: number, rm: number, B: number, vs2: number, f: number,
  ae: number, an: number, reduce: boolean, dtH: number,
): void {
  const { n, lon, lat, cos, land, le, ln } = p;
  const halfF = 500 * f;
  const lnRm = Math.log(rm);
  for (let i = 0; i < n; i++) {
    const dx = (lon[i] - clon) * KM_PER_DEG * cos[i];
    const dy = (lat[i] - clat) * KM_PER_DEG;
    const r2 = dx * dx + dy * dy;
    const r = Math.max(Math.sqrt(r2), 0.5);
    if (r > rm) {
      const b = Math.floor(r / BOUND_DR_KM);
      const ub = b < BOUND_BINS ? bound[b] : bound[BOUND_BINS - 1];
      if (ub <= peak[i] && ub < V34_MS) continue;
    }
    const rf2 = r * halfF;
    const x = Math.exp(B * (lnRm - Math.log(r)));
    const vSym = Math.sqrt(vs2 * x * Math.exp(1 - x) + rf2 * rf2) - rf2;
    const ir = 1 / r;
    const we = vSym * (-dy * COS_I - dx * SIN_I) * ir + ae;
    const wn = vSym * (dx * COS_I - dy * SIN_I) * ir + an;
    let speed = Math.sqrt(we * we + wn * wn);
    if (reduce && land[i] === 1) speed *= K_LAND;
    if (speed > peak[i]) {
      peak[i] = speed;
      cosTh[i] = Math.min(1, Math.abs(we * le[i] + wn * ln[i]) / Math.max(speed, 1e-6));
    }
    if (speed >= V34_MS) tsH[i] += dtH;
  }
}

/** Sums over a block of ensemble members; blocks from several workers add up exactly. */
export interface PartialResult {
  memberStart: number;
  members: number;
  steps: number;
  sumP: Float64Array;
  sumWind: Float64Array;
  sumTree: Float64Array;
  sumGust: Float64Array; // segments then county points, m/s
  sumTs: Float64Array;
  /** Expected failed segments per utility for each member, [member * 3 + utility]. */
  utilSeg: Float64Array;
  utilWind: Float64Array;
  utilStruct: Float64Array;
  utilSpans: Float64Array;
  countySeg: Float64Array;
  millis: number;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Members [memberStart, memberStart + count) of the ensemble. Member m always uses the
 *  same random draws (seeded by seed and m), whatever the split across workers. */
export function simulateMembers(
  track: StormTrackPoint[],
  opts: SimulateOptions,
  memberStart: number,
  count: number,
): PartialResult {
  const t0 = now();
  const net = opts.network;
  const mode = opts.mode ?? "best";
  const rho = net.constants?.treefall?.rhoPerM2 ?? DEFAULT_RHO;
  const fRow = net.constants?.treefall?.fRow ?? DEFAULT_F_ROW;
  const isLand = landTester(net.landMask);
  const all = interpolateTrack(track, opts.r34Km, opts.dtMin ?? 30, mode === "forecast" ? opts.issuedAt : undefined, isLand);
  const keep = nearRegion(all);
  const T = keep.length;

  const sg = net.segments;
  const nSeg = sg.lon.length;
  const nCty = net.counties.fips.length;
  const N = nSeg + nCty;
  const pts: Points = {
    n: N,
    lon: new Float64Array(N),
    lat: new Float64Array(N),
    cos: new Float64Array(N),
    land: new Uint8Array(N),
    le: new Float64Array(N),
    ln: new Float64Array(N),
  };
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < N; i++) {
    const seg = i < nSeg;
    const lon = seg ? sg.lon[i] : net.counties.lon[i - nSeg];
    const lat = seg ? sg.lat[i] : net.counties.lat[i - nSeg];
    pts.lon[i] = lon;
    pts.lat[i] = lat;
    pts.cos[i] = Math.cos((lat * Math.PI) / 180);
    pts.land[i] = seg ? sg.land[i] : 1;
    const b = seg ? (sg.bearing[i] * Math.PI) / 180 : 0;
    pts.le[i] = Math.sin(b);
    pts.ln[i] = Math.cos(b);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }

  const sigCt = keep.map((k) =>
    mode === "forecast" ? (interp(all.lead[k], LEAD_H, OFCL_TRACK_NM) * 1.852) / Math.sqrt(Math.PI / 2) : BEST_TRACK_SIGMA_KM,
  );
  const sigInt = keep.map((k) =>
    mode === "forecast" ? interp(all.lead[k], LEAD_H, OFCL_INT_KT) * Math.sqrt(Math.PI / 2) * KT_TO_MS : BEST_INT_SIGMA_KT * KT_TO_MS,
  );
  const dtH = T > 1 ? all.hours[keep[1]] - all.hours[keep[0]] : 0.5;
  const seed = opts.seed ?? 20240927;

  const out: PartialResult = {
    memberStart,
    members: count,
    steps: T,
    sumP: new Float64Array(nSeg),
    sumWind: new Float64Array(nSeg),
    sumTree: new Float64Array(nSeg),
    sumGust: new Float64Array(N),
    sumTs: new Float64Array(N),
    utilSeg: new Float64Array(count * 3),
    utilWind: new Float64Array(3),
    utilStruct: new Float64Array(3),
    utilSpans: new Float64Array(3),
    countySeg: new Float64Array(nCty),
    millis: 0,
  };
  const peak = new Float64Array(N);
  const cosTh = new Float64Array(N);
  const tsH = new Float64Array(N);
  const bound = new Float64Array(BOUND_BINS);

  for (let s = 0; s < count; s++) {
    const randn = normalStream((seed ^ Math.imul(memberStart + s + 1, 0x9e3779b1)) >>> 0);
    const z0 = randn(), z1 = randn(), z2 = randn(), z3 = randn();
    const rmMult = Math.exp(RMAX_LN_SIGMA * z2);
    const gf = Math.min(1.4, Math.max(1.1, GF_MEAN + GF_SD * z3));
    peak.fill(0);
    cosTh.fill(0);
    tsH.fill(0);
    for (let j = 0; j < T; j++) {
      const k = keep[j];
      const latC = all.lat[k], lonC = all.lon[k];
      const vte = all.vte[k], vtn = all.vtn[k];
      const vt = Math.hypot(vte, vtn);
      const ne = vt > 0.1 ? vtn / vt : 0;
      const nn = vt > 0.1 ? -vte / vt : 0;
      const off = z0 * sigCt[j];
      const clat = latC + (off * nn) / KM_PER_DEG;
      const clon = lonC + (off * ne) / (KM_PER_DEG * Math.cos((latC * Math.PI) / 180));
      // skip steps farther than MAX_RADIUS_KM from every point (bounding-box distance)
      const bx = Math.max(minLon - clon, 0, clon - maxLon) * KM_PER_DEG * Math.cos((clat * Math.PI) / 180);
      const by = Math.max(minLat - clat, 0, clat - maxLat) * KM_PER_DEG;
      if (Math.hypot(bx, by) > MAX_RADIUS_KM) continue;
      const vmax = Math.max(all.vmax[k] + z1 * sigInt[j], 8);
      const vs = Math.max(vmax - A_TRANS * vt, 5);
      const rm = all.rmw[k] * rmMult;
      const r34 = all.r34[k];
      const B = Number.isFinite(r34) && vmax > V34_MS * 1.05 ? fitBR34(vs, rm, r34) : hollandB(rm, clat);
      const f = 2 * OMEGA * Math.sin((Math.abs(latC) * Math.PI) / 180);
      const ae = A_TRANS * (vte * Math.cos(TRANS_ROT) - vtn * Math.sin(TRANS_ROT));
      const an = A_TRANS * (vte * Math.sin(TRANS_ROT) + vtn * Math.cos(TRANS_ROT));
      speedBound(bound, rm, B, vs, Math.hypot(ae, an));
      windStep(pts, peak, cosTh, tsH, bound, clon, clat, rm, B, vs * vs, f, ae, an, !all.land[k], dtH);
    }
    // damage per segment
    for (let i = 0; i < nSeg; i++) {
      const g = peak[i] * gf;
      const th = (Math.acos(cosTh[i]) * 180) / Math.PI;
      const ps = structureFailure(g, th, sg.lattice[i] === 1);
      const n = sg.nStructures[i];
      const pWind = 1 - Math.pow(1 - ps, n);
      const lamLen = strikeRatePerKm(g, th, sg.canopy[i], sg.rowHalfWidthM[i], sg.conductorHeightM[i], rho, fRow) * sg.lengthKm[i];
      const pTree = 1 - Math.exp(-lamLen);
      const spans = n * (1 - Math.exp(-lamLen / n));
      const p = 1 - (1 - pWind) * (1 - pTree);
      out.sumP[i] += p;
      out.sumWind[i] += pWind;
      out.sumTree[i] += pTree;
      const u = sg.utility[i];
      const w = sg.weight[i];
      out.utilSeg[s * 3 + u] += w * p;
      out.utilWind[u] += w * pWind;
      out.utilStruct[u] += w * ps * n;
      out.utilSpans[u] += w * spans;
      const c = sg.county[i];
      if (c >= 0) out.countySeg[c] += w * p;
    }
    for (let i = 0; i < N; i++) {
      out.sumGust[i] += peak[i] * gf;
      out.sumTs[i] += tsH[i];
    }
  }
  out.millis = now() - t0;
  return out;
}

/** Merge member blocks into the final result. */
export function combinePartials(network: LiteNetwork, parts: PartialResult[], millis?: number): SimulateResult {
  const S = parts.reduce((a, p) => a + p.members, 0);
  const nSeg = network.segments.lon.length;
  const nCty = network.counties.fips.length;
  const segmentRisk = new Float32Array(nSeg);
  const pWind = new Float32Array(nSeg);
  const pTree = new Float32Array(nSeg);
  const gustMph = new Float32Array(nSeg);
  const gustAll = new Float64Array(nSeg + nCty);
  const tsAll = new Float64Array(nSeg + nCty);
  const utilWind = new Float64Array(3);
  const utilStruct = new Float64Array(3);
  const utilSpans = new Float64Array(3);
  const countySeg = new Float64Array(nCty);
  const perMember = [new Float64Array(S), new Float64Array(S), new Float64Array(S)];
  let m = 0;
  for (const p of parts) {
    for (let i = 0; i < nSeg; i++) {
      segmentRisk[i] += p.sumP[i] / S;
      pWind[i] += p.sumWind[i] / S;
      pTree[i] += p.sumTree[i] / S;
    }
    for (let i = 0; i < nSeg + nCty; i++) {
      gustAll[i] += p.sumGust[i];
      tsAll[i] += p.sumTs[i];
    }
    for (let u = 0; u < 3; u++) {
      utilWind[u] += p.utilWind[u];
      utilStruct[u] += p.utilStruct[u];
      utilSpans[u] += p.utilSpans[u];
      for (let s = 0; s < p.members; s++) perMember[u][m + s] = p.utilSeg[s * 3 + u];
    }
    for (let c = 0; c < nCty; c++) countySeg[c] += p.countySeg[c];
    m += p.members;
  }
  for (let i = 0; i < nSeg; i++) gustMph[i] = (gustAll[i] / S) * MS_TO_MPH;
  const perUtility = {} as Record<LiteUtility, UtilityDamage>;
  network.utilities.forEach((u, j) => {
    const v = Float64Array.from(perMember[j]).sort();
    perUtility[u] = {
      expectedFailedSegments: v.reduce((a, b) => a + b, 0) / S,
      p05: percentile(v, 0.05),
      p95: percentile(v, 0.95),
      expectedWindFailedSegments: utilWind[j] / S,
      expectedFailedStructures: utilStruct[j] / S,
      expectedTreeSpans: utilSpans[j] / S,
    };
  });
  const perCounty: CountyDamage[] = network.counties.fips.map((fips, c) => ({
    fips,
    name: network.counties.name[c],
    expectedFailedSegments: countySeg[c] / S,
    gustMph: (gustAll[nSeg + c] / S) * MS_TO_MPH,
    tsHours: tsAll[nSeg + c] / S,
  }));
  return {
    segmentRisk, pWind, pTree, gustMph, perUtility, perCounty,
    members: S,
    steps: parts[0]?.steps ?? 0,
    millis: millis ?? parts.reduce((a, p) => Math.max(a, p.millis), 0),
  };
}

/** Run the whole ensemble on this thread. */
export function simulateTrack(track: StormTrackPoint[], opts: SimulateOptions): SimulateResult {
  const t0 = now();
  const part = simulateMembers(track, opts, 0, opts.members ?? 50);
  return combinePartials(opts.network, [part], now() - t0);
}

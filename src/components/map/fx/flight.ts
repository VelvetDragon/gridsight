/**
 * Corridor fly-through: a cinematic camera flight over a matched pair of
 * projects. It starts high over the pair, drops to drone altitude, follows
 * the Dominion Energy line into the closest point, sweeps along the
 * connector to the Georgia Power line, follows it out, circles the staging
 * yard and pulls back to a wide shot.
 *
 * The camera is a Catmull-Rom spline through camera positions and look-at
 * points, driven by requestAnimationFrame through
 * map.calculateCameraOptionsFromTo, so the bearing always follows the path.
 * Captions are data (a FlightScript) so narration audio can be attached:
 * pass `audioUrl` and it plays in sync, pausing and seeking with the flight.
 */
import * as maplibregl from "maplibre-gl";
import { distanceMeters, offsetMeters } from "@/lib/fx/geometry";
import { fmtKm, fmtMinutes, fmtMonthYear, fmtUsd } from "@/lib/format";
import type { Overlap, Position, Project } from "@/lib/types";
import { disableTerrain, enableTerrain } from "./terrain";

export interface FlightCaption {
  atMs: number;
  durMs: number;
  /** Small line above the text, e.g. the company. */
  kicker?: string;
  text: string;
  /** Accent colour for the kicker. */
  tone?: "desc" | "gpc" | "ink";
}

interface CameraKey {
  atMs: number;
  /** Camera position and altitude (metres above sea level). */
  cam: [number, number, number];
  look: Position;
}

export interface FlightScript {
  durationMs: number;
  captions: FlightCaption[];
  keys: CameraKey[];
  audioUrl?: string;
}

export interface FlightOptions {
  /** Narration to play in sync with the flight (optional). */
  audioUrl?: string;
  /** Savings range for the closing caption, if known. */
  savings?: number | null;
  /** Skip straight to the end frame, stepping through the captions without motion. */
  reducedMotion?: boolean;
}

export interface FlightState {
  playing: boolean;
  progress: number;
  caption: FlightCaption | null;
  script: FlightScript;
}

export interface FlightHandle {
  readonly script: FlightScript;
  pause(): void;
  resume(): void;
  /** Jump to the next caption. */
  skip(): void;
  /** End the flight now (the camera stays where it is). */
  stop(): void;
  /** Resolves when the flight ends, finished or stopped. */
  done: Promise<void>;
  subscribe(fn: (s: FlightState) => void): () => void;
}

/* ---------------- geometry helpers ---------------- */

function moveMeters(p: Position, east: number, north: number): Position {
  return [p[0] + east / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 110540];
}

function unit(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Points along a path, `lengthM` long, ending at the path point nearest `end`. */
function approach(path: Position[], end: Position, lengthM: number, steps: number): Position[] {
  if (path.length < 2) return [end];
  // Orient the path so it runs towards `end`.
  const p = distanceMeters(path[0], end) < distanceMeters(path[path.length - 1], end) ? [...path].reverse() : path;
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + distanceMeters(p[i - 1], p[i]));
  const total = cum[cum.length - 1];
  const at = (d: number): Position => {
    const x = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < p.length - 1 && cum[i] < x) i++;
    const k = (x - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k];
  };
  const start = Math.max(0, total - lengthM);
  return Array.from({ length: steps }, (_, s) => at(start + ((total - start) * s) / (steps - 1)));
}

/** A chase camera: behind the look point along the travel direction, a little to the side, at `alt`. */
function chase(look: Position, dir: [number, number], back: number, side: number, alt: number): [number, number, number] {
  const c = moveMeters(look, -dir[0] * back + dir[1] * side, -dir[1] * back - dir[0] * side);
  return [c[0], c[1], alt];
}

function geometryPath(p: Project | undefined, fallback: Position): Position[] {
  if (!p) return [fallback];
  return p.geometry.type === "LineString" ? p.geometry.coordinates : [p.geometry.coordinates];
}

/* ---------------- script ---------------- */

const CRUISE_ALT = 520;

/** Builds the camera path and caption track for a match. */
export function buildFlightScript(o: Overlap, desc: Project | undefined, gpc: Project | undefined, opts: FlightOptions = {}): FlightScript {
  const [c0, c1] = o.closestPoints;
  const mid: Position = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2];
  const yard = o.stagingYard?.position ?? mid;
  const keys: CameraKey[] = [];
  const add = (atMs: number, cam: [number, number, number], look: Position) => keys.push({ atMs, cam, look });

  // 1. High establishing shot over the pair.
  const high = moveMeters(mid, 0, -26000);
  add(0, [high[0], high[1], 16000], mid);

  // 2. Down to drone height and along the Dominion line into the closest point.
  const dPath = approach(geometryPath(desc, c0), c0, 5200, 4);
  const dDir = unit(offsetMeters(dPath[0], dPath[dPath.length - 1]));
  add(4200, chase(dPath[0], dDir, 2600, 900, 1500), dPath[1] ?? dPath[0]);
  dPath.slice(1).forEach((p, i) => add(6200 + i * 1700, chase(p, dDir, 1500, 450, CRUISE_ALT), moveMeters(p, dDir[0] * 900, dDir[1] * 900)));

  // 3. Sweep along the connector to the Georgia Power line.
  const cDir = distanceMeters(c0, c1) > 50 ? unit(offsetMeters(c0, c1)) : dDir;
  add(12500, chase(c1, cDir, 1600, -350, CRUISE_ALT + 80), moveMeters(c1, cDir[0] * 600, cDir[1] * 600));

  // 4. Out along the Georgia Power line.
  const gPath = approach(geometryPath(gpc, c1), c1, 4800, 3).reverse();
  const gDir = gPath.length > 1 ? unit(offsetMeters(gPath[0], gPath[gPath.length - 1])) : cDir;
  gPath.slice(1).forEach((p, i) => add(15000 + i * 1900, chase(p, gDir, 1500, -450, CRUISE_ALT), moveMeters(p, gDir[0] * 900, gDir[1] * 900)));

  // 5. Circle the staging yard.
  const orbitStart = 19500;
  for (let i = 0; i <= 4; i++) {
    const a = Math.PI * (1.25 - 0.3 * i);
    const c = moveMeters(yard, Math.cos(a) * 2300, Math.sin(a) * 2300);
    add(orbitStart + i * 1300, [c[0], c[1], 850], yard);
  }

  // 6. Pull back to a wide shot.
  const wide = moveMeters(mid, 0, -14000);
  add(28500, [wide[0], wide[1], 9500], mid);

  const descName = desc?.name ?? o.descId;
  const gpcName = gpc?.name ?? o.gpcId;
  const captions: FlightCaption[] = [
    { atMs: 600, durMs: 3400, kicker: "MrGridy corridor flight", text: `${descName} meets ${gpcName}`, tone: "ink" },
    {
      atMs: 4400,
      durMs: 5600,
      kicker: "Dominion Energy",
      text: `${descName}${desc?.inService ? ` · in service ${fmtMonthYear(desc.inService)}` : ""}`,
      tone: "desc",
    },
    {
      atMs: 10400,
      durMs: 4200,
      kicker: o.tier === "crossing" ? "They cross" : "Closest point",
      text:
        o.tier === "crossing"
          ? "0 km apart: the lines cross, so outages must be coordinated"
          : `${fmtKm(o.distanceKm)} apart: close enough to share ${o.tier === "row" ? "land and permits" : o.tier === "logistics" ? "yards and deliveries" : "crews and equipment"}`,
      tone: "ink",
    },
    {
      atMs: 14800,
      durMs: 4400,
      kicker: "Georgia Power",
      text: `${gpcName}${gpc?.inService ? ` · in service ${fmtMonthYear(gpc.inService)}` : ""}`,
      tone: "gpc",
    },
  ];
  if (o.stagingYard) {
    const mins = Math.max(o.stagingYard.driveMinutesDesc, o.stagingYard.driveMinutesGpc);
    const text = mins >= 1 ? `One shared yard: ${fmtMinutes(mins)} drive for both crews` : "One shared yard right where the lines meet, for both crews";
    captions.push({ atMs: 19600, durMs: 5000, kicker: "Staging yard", text, tone: "ink" });
  }
  if (opts.savings && opts.savings > 0) {
    const text = `Estimated savings: ${fmtUsd(opts.savings, { compact: true })}`;
    captions.push({ atMs: 25000, durMs: 5000, kicker: "Working together", text, tone: "ink" });
  }
  return { durationMs: 30500, captions, keys, audioUrl: opts.audioUrl };
}

/* ---------------- interpolation ---------------- */

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function sample(keys: CameraKey[], ms: number): { cam: [number, number, number]; look: Position } {
  if (ms <= keys[0].atMs) return keys[0];
  const last = keys[keys.length - 1];
  if (ms >= last.atMs) return last;
  let i = 1;
  while (i < keys.length - 1 && keys[i].atMs < ms) i++;
  const k0 = keys[Math.max(0, i - 2)];
  const k1 = keys[i - 1];
  const k2 = keys[i];
  const k3 = keys[Math.min(keys.length - 1, i + 1)];
  let t = (ms - k1.atMs) / (k2.atMs - k1.atMs || 1);
  // Ease in at the start and out at the end of the flight.
  if (i === 1) t = t * t * (3 - 2 * t) * 0.5 + t * 0.5;
  if (i === keys.length - 1) t = 1 - (1 - t) * (1 - t);
  const cam = [0, 1, 2].map((j) => catmull(k0.cam[j], k1.cam[j], k2.cam[j], k3.cam[j], t)) as [number, number, number];
  const look = [0, 1].map((j) => catmull(k0.look[j], k1.look[j], k2.look[j], k3.look[j], t)) as Position;
  return { cam, look };
}

/* ---------------- runner ---------------- */

let current: { stop: () => void } | null = null;

/**
 * Flies the camera along the corridor of a match. Returns a handle to pause,
 * resume, skip and stop; `done` resolves when the flight ends. Only one
 * flight runs at a time; starting another stops the previous one.
 */
export function startCorridorFlight(
  map: maplibregl.Map,
  match: Overlap,
  projects: Map<string, Project> | Project[],
  opts: FlightOptions = {},
): FlightHandle {
  current?.stop();
  const byId = projects instanceof Map ? projects : new Map(projects.map((p) => [p.id, p]));
  const script = buildFlightScript(match, byId.get(match.descId), byId.get(match.gpcId), opts);
  const listeners = new Set<(s: FlightState) => void>();
  const prev = { maxZoom: map.getMaxZoom(), maxPitch: map.getMaxPitch() };
  map.setMaxZoom(18);
  map.setMaxPitch(78);
  enableTerrain(map);

  const audio = opts.audioUrl ? new Audio(opts.audioUrl) : null;
  let elapsed = 0;
  let last = performance.now();
  let playing = true;
  let finished = false;
  let raf = 0;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));

  // A caption stays up until the next one replaces it, so the card never goes blank mid-flight.
  const captionAt = (ms: number) => {
    let hit: FlightCaption | null = null;
    for (const c of script.captions) if (ms >= c.atMs) hit = c;
    return hit;
  };
  const emit = () => {
    const s: FlightState = { playing, progress: Math.min(1, elapsed / script.durationMs), caption: captionAt(elapsed), script };
    listeners.forEach((fn) => fn(s));
  };
  const place = (ms: number) => {
    const { cam, look } = sample(script.keys, ms);
    try {
      const o = map.calculateCameraOptionsFromTo(new maplibregl.LngLat(cam[0], cam[1]), cam[2], new maplibregl.LngLat(look[0], look[1]), 0);
      map.jumpTo(o);
    } catch {
      // Degenerate step (camera straight above the target); keep the last frame.
    }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(raf);
    audio?.pause();
    map.setMaxPitch(prev.maxPitch);
    map.setMaxZoom(prev.maxZoom);
    disableTerrain(map);
    playing = false;
    listeners.forEach((fn) => fn({ playing: false, progress: 1, caption: null, script }));
    listeners.clear();
    if (current === handle) current = null;
    resolveDone();
  };

  const frame = () => {
    const now = performance.now();
    if (playing) elapsed += now - last;
    last = now;
    if (elapsed >= script.durationMs) {
      place(script.durationMs);
      finish();
      return;
    }
    if (!opts.reducedMotion) place(elapsed);
    emit();
    raf = requestAnimationFrame(frame);
  };

  const handle: FlightHandle = {
    script,
    pause() {
      playing = false;
      audio?.pause();
      emit();
    },
    resume() {
      if (finished) return;
      playing = true;
      last = performance.now();
      audio?.play().catch(() => {});
      emit();
    },
    skip() {
      const next = script.captions.find((c) => c.atMs > elapsed + 50);
      elapsed = next ? next.atMs : script.durationMs;
      if (audio) audio.currentTime = elapsed / 1000;
    },
    stop: finish,
    done,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  current = handle;
  if (opts.reducedMotion) place(script.durationMs);
  audio?.play().catch(() => {});
  raf = requestAnimationFrame(frame);
  return handle;
}

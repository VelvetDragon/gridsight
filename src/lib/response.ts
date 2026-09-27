/** Storm replay helpers for Response mode. */
import { fmtPct, fmtInt } from "./format";
import { haversineKm, lerpPosition } from "./geo";
import type { CountyOutage, Position, RepairZone, Storm } from "./types";

export const REPLAY_STEP_MS = 15 * 60 * 1000;

/** The storm counts as "here" once its center is this close to the damage. */
const NEAR_KM = 150;
/** Longest stretch kept while it is here; slow stalling storms get cut to this. */
const MAX_NEAR_MS = 30 * 3600e3;
/** Replay lead-in before the storm arrives, and tail after it leaves. */
const LEAD_MS = 6 * 3600e3;
const TAIL_MS = 3 * 3600e3;

export interface StormFrame {
  position: Position;
  windKt: number;
  pressureMb: number | null;
  rmwKm: number | null;
}

export function trackTimes(storm: Storm): number[] {
  return storm.track.map((p) => Date.parse(p.time));
}

/** Storm state at `ms`, linearly interpolated between best-track points. */
export function stormAt(storm: Storm, times: number[], ms: number): StormFrame | null {
  const t = storm.track;
  if (!t.length) return null;
  if (ms <= times[0]) return { ...t[0] };
  for (let i = 1; i < t.length; i++) {
    if (ms <= times[i]) {
      const k = (ms - times[i - 1]) / (times[i] - times[i - 1] || 1);
      const a = t[i - 1];
      const b = t[i];
      return {
        position: lerpPosition(a.position, b.position, k),
        windKt: a.windKt + (b.windKt - a.windKt) * k,
        pressureMb: a.pressureMb != null && b.pressureMb != null ? a.pressureMb + (b.pressureMb - a.pressureMb) * k : a.pressureMb ?? b.pressureMb,
        rmwKm: a.rmwKm != null && b.rmwKm != null ? a.rmwKm + (b.rmwKm - a.rmwKm) * k : a.rmwKm ?? b.rmwKm,
      };
    }
  }
  return { ...t[t.length - 1] };
}

/**
 * Cut the best track down to the part that matters for the service area: from
 * `LEAD_MS` before the center first comes within `NEAR_KM` of any anchor (repair
 * zones, likely-damaged lines) to `TAIL_MS` after it last is. If it lingers
 * longer than `MAX_NEAR_MS`, keep that much around its peak impact (wind × the
 * number of anchors in reach). Without this, some replays start days out in the
 * Atlantic and end over New England. The cut ends are interpolated so the track
 * still begins and ends exactly on the window.
 */
export function trimTrack(storm: Storm, anchors: Position[]): Storm {
  const times = trackTimes(storm);
  if (times.length < 2 || !anchors.length) return storm;
  let first = NaN;
  let last = NaN;
  let best = Infinity;
  let closest = times[0];
  let peak = -1;
  let peakAt = times[0];
  for (let ms = times[0]; ms <= times[times.length - 1]; ms += REPLAY_STEP_MS) {
    const f = stormAt(storm, times, ms);
    if (!f) continue;
    let d = Infinity;
    let inReach = 0;
    for (const a of anchors) {
      const km = haversineKm(f.position, a);
      d = Math.min(d, km);
      if (km <= NEAR_KM) inReach++;
    }
    if (d < best) {
      best = d;
      closest = ms;
    }
    if (inReach * f.windKt > peak) {
      peak = inReach * f.windKt;
      peakAt = ms;
    }
    if (d <= NEAR_KM) {
      if (Number.isNaN(first)) first = ms;
      last = ms;
    }
  }
  // Never gets close: center the window on its nearest pass instead.
  if (Number.isNaN(first)) first = last = closest;
  if (last - first > MAX_NEAR_MS) {
    first = Math.min(Math.max(first, peakAt - MAX_NEAR_MS / 2), last - MAX_NEAR_MS);
    last = first + MAX_NEAR_MS;
  }
  const from = Math.max(times[0], first - LEAD_MS);
  const to = Math.min(times[times.length - 1], last + TAIL_MS);
  const at = (ms: number) => {
    const f = stormAt(storm, times, ms)!;
    return { ...f, time: new Date(ms).toISOString() };
  };
  const inner = storm.track.filter((_, i) => times[i] > from && times[i] < to);
  return { ...storm, track: [at(from), ...inner, at(to)] };
}

/**
 * Approximate radius of damaging (tropical-storm-force) wind, km. Best-track
 * files rarely carry wind radii, so this is a display estimate from intensity:
 * about 3.5 × the radius of maximum wind when known, else 60 km + 2.2 km per knot.
 */
export function approxWindRadiusKm(frame: StormFrame): number {
  const fromRmw = frame.rmwKm != null ? frame.rmwKm * 3.5 : 0;
  const fromWind = 60 + 2.2 * frame.windKt;
  return Math.min(380, Math.max(fromRmw, fromWind));
}

/**
 * For each point, the replay time when the storm center passed closest. Used to
 * reveal damage and outages only once the storm has gone by.
 */
export function closestApproachTimes(points: Position[], storm: Storm, times: number[]): Float64Array {
  const out = new Float64Array(points.length);
  if (!times.length) return out;
  const samples: { ms: number; pos: Position }[] = [];
  for (let ms = times[0]; ms <= times[times.length - 1]; ms += REPLAY_STEP_MS) {
    const f = stormAt(storm, times, ms);
    if (f) samples.push({ ms, pos: f.position });
  }
  points.forEach((p, i) => {
    let best = Infinity;
    let when = times[0];
    for (const s of samples) {
      const d = haversineKm(p, s.pos);
      if (d < best) {
        best = d;
        when = s.ms;
      }
    }
    out[i] = when;
  });
  return out;
}

/** Nearest county name, used to label repair zones ("near Richmond Co., GA"). */
export function zoneLabel(zone: RepairZone, counties: CountyOutage[]): string {
  let best: CountyOutage | null = null;
  let bestD = Infinity;
  for (const c of counties) {
    const d = haversineKm(zone.centroid, c.centroid);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best ? `${best.name} Co., ${best.state}` : zone.id;
}

/**
 * County outage error. Values up to 1 are read as a share of customers
 * (0.058 → "5.8%"); larger values as a customer count.
 */
export function fmtMae(v: number | null | undefined): string {
  if (v == null) return "–";
  return v <= 1 ? fmtPct(v, 1) : fmtInt(v);
}

export function stormKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Storm replay helpers for Response mode. */
import { fmtPct, fmtInt } from "./format";
import { haversineKm, lerpPosition } from "./geo";
import type { CountyOutage, Position, RepairZone, Storm } from "./types";

export const REPLAY_STEP_MS = 15 * 60 * 1000;

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

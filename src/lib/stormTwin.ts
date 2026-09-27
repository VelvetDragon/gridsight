/**
 * Storm Twin: which of MrGridy's replayed storms is most like a live storm right now.
 *
 * Every point of every replayed storm's track (NHC best track, storm.json) is scored
 * against the live storm's position, heading and strength:
 *
 *   score = distance / 200 km + |wind difference| / 20 kt + |heading difference| / 45 deg
 *
 * (1 point = 200 km off, or 20 kt weaker/stronger, or 45 degrees off course). A storm's
 * match is its best point; the twin is the storm with the lowest score. From that point
 * we also read how many hours the past storm took to make its closest pass to the
 * Georgia / South Carolina border: an early-warning lead time taken from history.
 * No simulation runs; it is a lookup over the storms already simulated.
 */
import type { Position, Storm } from "./types";

export interface LiveStormLike {
  name: string;
  position: Position;
  windKt: number;
  headingDeg: number | null;
}

export interface StormTwin {
  stormId: string;
  name: string;
  year: number;
  score: number;
  /** "close", "similar" or "loose" match. */
  match: "close" | "similar" | "loose";
  distanceKm: number;
  windDiffKt: number;
  headingDiffDeg: number | null;
  /** When the past storm was at the matching point. */
  at: string;
  /** Hours from the matching point to the past storm's closest pass to the GA / SC border (null if already past). */
  hoursToBorder: number | null;
}

const BORDER: Position = [-81.5, 32.8];
const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function km(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a: Position, b: Position): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Best-matching point of one past storm, or null for an empty track. */
function bestPoint(live: LiveStormLike, storm: Storm) {
  const t = storm.track;
  if (t.length < 2) return null;
  // The past storm's closest pass to the border, for the lead time.
  let closest = 0;
  t.forEach((p, i) => {
    if (km(p.position, BORDER) < km(t[closest].position, BORDER)) closest = i;
  });
  let best: { i: number; score: number; d: number; dw: number; dh: number | null } | null = null;
  for (let i = 0; i < t.length - 1; i++) {
    const d = km(live.position, t[i].position);
    const dw = t[i].windKt - live.windKt;
    const dh = live.headingDeg == null ? null : angle(live.headingDeg, bearing(t[i].position, t[i + 1].position));
    const score = d / 200 + Math.abs(dw) / 20 + (dh ?? 45) / 45;
    if (!best || score < best.score) best = { i, score, d, dw, dh };
  }
  if (!best) return null;
  const hours = (Date.parse(t[closest].time) - Date.parse(t[best.i].time)) / 3600e3;
  return { ...best, at: t[best.i].time, hoursToBorder: hours > 0 ? Math.round(hours) : null };
}

/** Past storms ranked by how much they resemble the live one (best first). */
export function stormTwins(live: LiveStormLike, storms: Storm[], ids: string[]): StormTwin[] {
  const out: StormTwin[] = [];
  storms.forEach((s, k) => {
    const b = bestPoint(live, s);
    if (!b) return;
    out.push({
      stormId: ids[k],
      name: s.name,
      year: s.year,
      score: Math.round(b.score * 100) / 100,
      match: b.score < 1.5 ? "close" : b.score < 3 ? "similar" : "loose",
      distanceKm: Math.round(b.d),
      windDiffKt: Math.round(b.dw),
      headingDiffDeg: b.dh == null ? null : Math.round(b.dh),
      at: b.at,
      hoursToBorder: b.hoursToBorder,
    });
  });
  return out.sort((a, b) => a.score - b.score);
}

/** A labelled sample storm for demos when nothing threatens the Southeast: a hurricane near the Bahamas heading north-northwest. */
export const SAMPLE_STORM: LiveStormLike & { sample: true } = {
  name: "Sample hurricane near the Bahamas",
  position: [-77.2, 25.3],
  windKt: 110,
  headingDeg: 330,
  sample: true,
};

const trackCache = new Map<string, Storm | null>();

/** storm.json for every replayed storm (cached). */
export async function loadTracks(ids: string[]): Promise<{ storms: Storm[]; ids: string[] }> {
  const got = await Promise.all(
    ids.map(async (id) => {
      if (!trackCache.has(id)) {
        try {
          const res = await fetch(`/data/response/${encodeURIComponent(id)}/storm.json`);
          trackCache.set(id, res.ok ? ((await res.json()) as Storm) : null);
        } catch {
          trackCache.set(id, null);
        }
      }
      return [id, trackCache.get(id) ?? null] as const;
    }),
  );
  const ok = got.filter((g): g is readonly [string, Storm] => !!g[1]);
  return { storms: ok.map((g) => g[1]), ids: ok.map((g) => g[0]) };
}

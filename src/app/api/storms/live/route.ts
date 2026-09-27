/**
 * GET /api/storms/live
 *
 * Live tropical cyclones from the National Hurricane Center (CurrentStorms.json),
 * reduced to what Stormline needs: Atlantic storms, where they are, how strong,
 * and how far they are from the Dominion Energy / Georgia Power border area
 * (Savannah River). Cached for 10 minutes.
 */

const NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";
/** Midpoint of the Savannah River border region (between Augusta and Savannah). */
const BORDER: [number, number] = [-81.5, 32.8];
/** Storms closer than this are flagged for both utilities. */
const WATCH_KM = 1200;

interface NhcStorm {
  id: string;
  name: string;
  classification: string;
  intensity: string;
  pressure: string;
  latitudeNumeric: number;
  longitudeNumeric: number;
  movementDir: number | null;
  movementSpeed: number | null;
  lastUpdate: string;
}

export interface LiveStorm {
  id: string;
  name: string;
  kind: string;
  windKt: number;
  position: [number, number];
  distanceKm: number;
  moving: string | null;
  /** Direction of motion, degrees clockwise from north (NHC movementDir), when known. */
  headingDeg: number | null;
  updated: string;
  watch: boolean;
}

const KIND: Record<string, string> = {
  HU: "Hurricane",
  TS: "Tropical storm",
  TD: "Tropical depression",
  STS: "Subtropical storm",
  STD: "Subtropical depression",
  PTC: "Potential tropical cyclone",
  PC: "Post-tropical cyclone",
};

function haversineKm([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): number {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function compass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

let cache: { at: number; body: { storms: LiveStorm[]; checkedAt: string } } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return Response.json(cache.body);
  try {
    const res = await fetch(NHC_URL, { headers: { "User-Agent": "MrGridy (ShellHacks 2026)" }, cache: "no-store" });
    if (!res.ok) throw new Error(`NHC ${res.status}`);
    const data = (await res.json()) as { activeStorms?: NhcStorm[] };
    const storms: LiveStorm[] = (data.activeStorms ?? [])
      .filter((s) => s.id?.toLowerCase().startsWith("al"))
      .map((s) => {
        const position: [number, number] = [s.longitudeNumeric, s.latitudeNumeric];
        const distanceKm = Math.round(haversineKm(position, BORDER));
        return {
          id: s.id,
          name: s.name,
          kind: KIND[s.classification] ?? s.classification,
          windKt: Number(s.intensity) || 0,
          position,
          distanceKm,
          moving:
            s.movementDir != null && s.movementSpeed != null ? `${compass(s.movementDir)} at ${s.movementSpeed} mph` : null,
          headingDeg: s.movementDir ?? null,
          updated: s.lastUpdate,
          watch: distanceKm <= WATCH_KM,
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const body = { storms, checkedAt: new Date().toISOString() };
    cache = { at: Date.now(), body };
    return Response.json(body);
  } catch {
    return Response.json({ storms: null, checkedAt: new Date().toISOString() }, { status: 200 });
  }
}

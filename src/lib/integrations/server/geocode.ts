/**
 * Tiny server-side geocoder for place names in a utility's filing
 * (OpenStreetMap Nominatim, 1 request per second, polite User-Agent, cached
 * on disk). A hit must fall inside the requested state. Used only by the
 * Gemini utility finder.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Position } from "@/lib/types";

const CACHE_FILE = path.join(os.tmpdir(), "mrgridy-geocode-v3.json");

export interface Geocoded {
  position: Position;
  /** Two-letter state the hit is in. */
  state: string;
}
const UA = "MrGridy/0.1 (ShellHacks 2026 hackathon; https://github.com/VelvetDragon/gridsight)";
const GENERIC = new Set(["customer", "new", "existing", "tbd", "various", "area", "system", "load", "tap", "delivery", "point"]);
let cache: Record<string, Geocoded | null> | null = null;
let lastCall = 0;

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(STATES));

/** "North Carolina" / "nc" / "N.C." -> "NC"; null if unknown. */
export function stateCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase().replace(/\./g, "");
  if (STATES[v]) return STATES[v];
  const up = v.toUpperCase();
  return CODES.has(up) ? up : null;
}

async function load(): Promise<Record<string, Geocoded | null>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(CACHE_FILE, "utf8")) as Record<string, Geocoded | null>;
  } catch {
    cache = {};
  }
  return cache;
}

async function save() {
  try {
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache));
  } catch {
    /* read-only filesystem */
  }
}

/** Strip equipment words: "Lyle Creek Switching Station" -> "Lyle Creek". */
export function placeName(place: string): string {
  return place
    .replace(/\b(switching station|substation|steam station|station|sub|ss|tie|tap|junction|jct|plant|switchyard|\d+\s*kv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** [lon, lat] and state for a place inside one of `states` (two-letter codes), or null. */
export async function geocode(place: string, states: string[]): Promise<Geocoded | null> {
  const clean = placeName(place);
  if (!clean || clean.length < 3 || GENERIC.has(clean.toLowerCase())) return null;
  const key = `${clean.toLowerCase()}|${states.join(",")}`;
  const store = await load();
  if (key in store) return store[key];

  let found: Geocoded | null = null;
  for (const st of states) {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const q = new URLSearchParams({ q: `${clean}, ${st}`, format: "jsonv2", limit: "3", countrycodes: "us", addressdetails: "1" });
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
        headers: { "User-Agent": UA, "Accept-Language": "en" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const rows = (await res.json()) as { lon: string; lat: string; address?: Record<string, string> }[];
      const inState = rows.find((r) => r.address?.["ISO3166-2-lvl4"] === `US-${st}`);
      if (inState) {
        found = { position: [Number(Number(inState.lon).toFixed(5)), Number(Number(inState.lat).toFixed(5))], state: st };
        break;
      }
    } catch {
      /* network hiccup: try the next state, then give up */
    }
  }
  store[key] = found;
  await save();
  return found;
}

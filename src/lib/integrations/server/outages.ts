/**
 * Hourly outage curves for GET /api/outages.
 *
 * 1. Tiger Data (TIGER_DATABASE_URL): the outages_hourly continuous aggregate
 *    loaded by pipeline/gridsight/integrations/tiger_load.py.
 * 2. Static: public/data/outages/<storm>.json (EAGLE-I export).
 * 3. Static estimate: a rise-and-restore shape scaled to each county's peak in
 *    public/data/response/<storm>/counties.json, timed by the storm track.
 */
import type { Pool } from "pg";
import type { CountyOutage, Position, Storm, StormIndexEntry } from "@/lib/types";
import type { OutageCurve, OutagePoint } from "@/lib/integrations/outages";
import { readDataFile, serverEnv } from "./dataFiles";

const HOUR = 3_600_000;
const STATE_NAME = { GA: "Georgia", SC: "South Carolina" } as const;

export class BadRequestError extends Error {}

export interface OutageQuery {
  storm: string;
  fips: string | null;
  state: "GA" | "SC" | null;
}

export async function parseQuery(params: URLSearchParams): Promise<OutageQuery> {
  let storm = (params.get("storm") ?? "").trim().toLowerCase();
  const fips = (params.get("fips") ?? "").trim() || null;
  const stateRaw = (params.get("state") ?? "").trim().toUpperCase() || null;
  if (storm && !/^[a-z0-9-]{1,40}$/.test(storm)) throw new BadRequestError("storm must be a storm id like 'helene'");
  if (fips && !/^\d{5}$/.test(fips)) throw new BadRequestError("fips must be a 5-digit county FIPS code");
  if (stateRaw && stateRaw !== "GA" && stateRaw !== "SC") throw new BadRequestError("state must be GA or SC");
  if (!storm) {
    const index = await readDataFile<StormIndexEntry[]>("response/storms.json");
    const list = Array.isArray(index?.data) ? index.data : [];
    storm = (list.find((s) => s.featured) ?? list[0])?.id ?? "helene";
  }
  return { storm, fips, state: (stateRaw as "GA" | "SC" | null) ?? null };
}

/* ---------------------------------------------------------------- labels */

async function countyInfo(storm: string, fips: string): Promise<CountyOutage | null> {
  const counties = await readDataFile<CountyOutage[]>(`response/${storm}/counties.json`);
  return Array.isArray(counties?.data) ? counties.data.find((c) => c.fips === fips) ?? null : null;
}

async function describe(q: OutageQuery) {
  if (q.fips) {
    const c = await countyInfo(q.storm, q.fips);
    const state = c?.state ?? (q.fips.startsWith("13") ? "GA" : q.fips.startsWith("45") ? "SC" : null);
    return {
      label: c ? `${c.name} County, ${c.state}` : `County ${q.fips}`,
      state,
      customers: c?.customers ?? null,
      predictedPeakOut: c?.predictedPeakOut ?? null,
    };
  }
  const counties = await readDataFile<CountyOutage[]>(`response/${q.storm}/counties.json`);
  const rows = (Array.isArray(counties?.data) ? counties.data : []).filter((c) => !q.state || c.state === q.state);
  return {
    label: q.state ? STATE_NAME[q.state] : "Georgia and South Carolina",
    state: q.state,
    customers: rows.length ? rows.reduce((s, c) => s + (c.customers || 0), 0) : null,
    predictedPeakOut: rows.length ? rows.reduce((s, c) => s + (c.predictedPeakOut || 0), 0) : null,
  };
}

function finish(q: OutageQuery, meta: Awaited<ReturnType<typeof describe>>, points: OutagePoint[],
  source: OutageCurve["source"], basis: OutageCurve["basis"]): OutageCurve {
  const peak = points.reduce<OutagePoint | null>((best, p) => (!best || p.out > best.out ? p : best), null);
  return {
    storm: q.storm,
    fips: q.fips,
    label: meta.label,
    state: meta.state as OutageCurve["state"],
    customers: meta.customers,
    source,
    basis,
    stepMinutes: 60,
    points,
    peak: peak && peak.out > 0 ? peak : null,
    predictedPeakOut: meta.predictedPeakOut,
  };
}

/* ---------------------------------------------------------------- Tiger Data */

const globalForPg = globalThis as unknown as { __mrgridyPool?: Pool; __mrgridyPgDownUntil?: number };

async function pool(url: string): Promise<Pool> {
  if (!globalForPg.__mrgridyPool) {
    const { Pool } = await import("pg");
    globalForPg.__mrgridyPool = new Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 4000,
      idleTimeoutMillis: 30_000,
      query_timeout: 8000,
      application_name: "mrgridy-web",
    });
    globalForPg.__mrgridyPool.on("error", () => {
      /* idle client dropped; the next query reconnects */
    });
  }
  return globalForPg.__mrgridyPool;
}

async function fromTiger(q: OutageQuery): Promise<OutagePoint[] | null> {
  const url = serverEnv("TIGER_DATABASE_URL");
  if (!url) return null;
  // After a failed connection, skip the database for a minute instead of slowing every request.
  if ((globalForPg.__mrgridyPgDownUntil ?? 0) > Date.now()) return null;
  try {
    const db = await pool(url);
    const { rows } = q.fips
      ? await db.query<{ bucket: Date; out: string }>(
          // Every hour with any report from the county's state; a county absent from it had no outage.
          `WITH hours AS (SELECT DISTINCT bucket FROM outages_hourly WHERE storm = $1 AND left(fips, 2) = left($2, 2))
           SELECT h.bucket, COALESCE(o.customers_out_max, 0) AS out
           FROM hours h
           LEFT JOIN outages_hourly o ON o.storm = $1 AND o.fips = $2 AND o.bucket = h.bucket
           ORDER BY h.bucket`,
          [q.storm, q.fips],
        )
      : await db.query<{ bucket: Date; out: string }>(
          `SELECT bucket, sum(customers_out_max) AS out FROM outages_hourly
           WHERE storm = $1 AND ($2::text IS NULL OR state = $2)
           GROUP BY bucket ORDER BY bucket`,
          [q.storm, q.state],
        );
    if (!rows.length) return null;
    return fillHours(rows.map((r) => ({ t: new Date(r.bucket).toISOString(), out: Number(r.out) || 0 })));
  } catch (err) {
    globalForPg.__mrgridyPgDownUntil = Date.now() + 60_000;
    console.warn(`[outages] Tiger Data query failed, using static data: ${(err as Error).message}`);
    return null;
  }
}

/** Continuous hourly axis; hours with no report at all are collection gaps, so carry the last value. */
function fillHours(points: OutagePoint[]): OutagePoint[] {
  if (points.length < 2) return points;
  const byTime = new Map(points.map((p) => [Date.parse(p.t), p.out]));
  const start = Date.parse(points[0].t);
  const end = Date.parse(points[points.length - 1].t);
  const out: OutagePoint[] = [];
  let last = 0;
  for (let t = start; t <= end; t += HOUR) {
    last = byTime.get(t) ?? last;
    out.push({ t: new Date(t).toISOString(), out: last });
  }
  return out;
}

/* ---------------------------------------------------------------- static */

interface StaticFile {
  start: string;
  stepMinutes: number;
  hours: number;
  totals: Partial<Record<"GA" | "SC", number[]>>;
  counties: Record<string, number[]>;
}

async function fromStaticFile(q: OutageQuery): Promise<OutagePoint[] | null> {
  const file = await readDataFile<StaticFile>(`outages/${q.storm}.json`, { fixtures: false });
  const f = file?.data;
  if (!f || typeof f.start !== "string" || !f.hours) return null;
  let values: number[];
  if (q.fips) {
    values = f.counties?.[q.fips] ?? new Array(f.hours).fill(0);
  } else {
    const states = q.state ? [q.state] : (["GA", "SC"] as const);
    values = new Array(f.hours).fill(0);
    for (const s of states) (f.totals?.[s] ?? []).forEach((v, i) => (values[i] += v));
  }
  const start = Date.parse(f.start);
  const step = (f.stepMinutes || 60) * 60_000;
  return values.map((out, i) => ({ t: new Date(start + i * step).toISOString(), out }));
}

function km(a: Position, b: Position) {
  const lat = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  return Math.hypot((a[0] - b[0]) * 111.32 * Math.cos(lat), (a[1] - b[1]) * 110.57);
}

/** Rise over ~6 h before the storm's closest approach, then restore with a ~30 h half-life. */
async function fromEstimate(q: OutageQuery): Promise<OutagePoint[] | null> {
  const [counties, storm] = await Promise.all([
    readDataFile<CountyOutage[]>(`response/${q.storm}/counties.json`),
    readDataFile<Storm>(`response/${q.storm}/storm.json`),
  ]);
  const track = storm?.data?.track ?? [];
  if (!Array.isArray(counties?.data) || !track.length) return null;
  const rows = counties.data.filter((c) => (q.fips ? c.fips === q.fips : !q.state || c.state === q.state));
  if (!rows.length) return null;

  const arrival = (c: CountyOutage) => {
    let best = track[0];
    for (const p of track) if (km(p.position, c.centroid) < km(best.position, c.centroid)) best = p;
    return Math.floor(Date.parse(best.time) / HOUR) * HOUR;
  };
  const arrivals = rows.map(arrival);
  const start = Math.min(...arrivals) - 24 * HOUR;
  const end = Math.max(...arrivals) + 96 * HOUR;
  const points: OutagePoint[] = [];
  for (let t = start; t <= end; t += HOUR) {
    let out = 0;
    rows.forEach((c, i) => {
      const h = (t - arrivals[i]) / HOUR;
      const shape = h < 0 ? 1 / (1 + Math.exp(-(h + 3) / 1.2)) : Math.pow(0.5, h / 30);
      out += (c.predictedPeakOut || 0) * shape;
    });
    points.push({ t: new Date(t).toISOString(), out: Math.round(out) });
  }
  return points;
}

/* ---------------------------------------------------------------- entry */

export async function outageCurve(q: OutageQuery): Promise<OutageCurve | null> {
  const meta = await describe(q);
  const live = await fromTiger(q);
  if (live) return finish(q, meta, live, "tiger", "eaglei");
  const stat = await fromStaticFile(q);
  if (stat) return finish(q, meta, stat, "static", "eaglei");
  const est = await fromEstimate(q);
  if (est) return finish(q, meta, est, "static", "estimate");
  return null;
}

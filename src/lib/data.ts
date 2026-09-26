/**
 * Typed loader for the files the pipeline writes into public/data/.
 *
 * Every file is fetched from /data/<path>. If that request fails (404, network,
 * bad JSON or wrong shape) the loader falls back to /data/fixtures/<path>, a
 * hand-built sample with the same type, and records that it did so. The UI
 * uses those records to show an honest "Sample data" indicator.
 */
import { isWetlandNoteList, type WetlandNote } from "./opportunities";
import { isMutualAid, type MutualAid } from "./savings";
import { isTeamUp, type TeamUp } from "./teamup";
import type {
  CountyOutage,
  JointYard,
  LineSegmentRisk,
  Overlap,
  PlanMeta,
  Position,
  Project,
  RepairZone,
  ResponseMeta,
  Storm,
  StormIndexEntry,
  VulnerableArea,
} from "./types";

export type DataOrigin = "pipeline" | "sample";

export interface FileStatus {
  path: string;
  origin: DataOrigin;
}

export interface Loaded<T> extends FileStatus {
  data: T;
}

/** Minimal GeoJSON typing for the context layers. */
export interface LineFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Position[] } | { type: "MultiLineString"; coordinates: Position[][] };
  properties: {
    voltage?: number | string | null;
    operator?: string | null;
    utility?: string | null;
    [key: string]: unknown;
  } | null;
}

export interface LineCollection {
  type: "FeatureCollection";
  features: LineFeature[];
}

type Shape = "array" | "object" | "featureCollection";

function hasShape(value: unknown, shape: Shape): boolean {
  if (shape === "array") return Array.isArray(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (shape === "featureCollection") {
    return Array.isArray((value as { features?: unknown }).features);
  }
  return true;
}

async function fetchJson(url: string, shape: Shape, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  const body: unknown = await res.json();
  if (!hasShape(body, shape)) throw new Error(`${url} has an unexpected shape`);
  return body;
}

export class DataLoadError extends Error {
  constructor(
    public readonly path: string,
    cause: unknown,
  ) {
    super(`Could not load ${path} (pipeline output or sample)`);
    this.cause = cause;
  }
}

export async function loadDataFile<T>(path: string, shape: Shape, signal?: AbortSignal): Promise<Loaded<T>> {
  try {
    const data = (await fetchJson(`/data/${path}`, shape, signal)) as T;
    return { path, origin: "pipeline", data };
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  try {
    const data = (await fetchJson(`/data/fixtures/${path}`, shape, signal)) as T;
    return { path, origin: "sample", data };
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new DataLoadError(path, err);
  }
}

const EMPTY_LINES: LineCollection = { type: "FeatureCollection", features: [] };

/** Like loadDataFile, but an optional context layer never fails the whole mode. */
async function loadOptionalLines(path: string, signal?: AbortSignal): Promise<Loaded<LineCollection>> {
  try {
    return await loadDataFile<LineCollection>(path, "featureCollection", signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return { path, origin: "sample", data: EMPTY_LINES };
  }
}

/**
 * Optional extra files (cost ranges, mutual-aid scenarios). Missing is normal:
 * the UI then hides or simplifies the feature. The bundled sample is used only
 * when the mode itself runs on samples, so sample numbers never get mixed into
 * real pipeline output.
 */
async function loadOptional<T>(
  path: string,
  allowSample: boolean,
  valid: (v: unknown) => v is T,
  signal?: AbortSignal,
): Promise<Loaded<T> | null> {
  const urls: [string, DataOrigin][] = [[`/data/${path}`, "pipeline"]];
  if (allowSample) urls.push([`/data/fixtures/${path}`, "sample"]);
  for (const [url, origin] of urls) {
    try {
      const res = await fetch(url, { cache: "no-store", signal });
      if (!res.ok) continue;
      const body: unknown = await res.json();
      if (valid(body)) return { path, origin, data: body };
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  return null;
}

export const PLAN_FILES = {
  meta: "plan/meta.json",
  projects: "plan/projects.json",
  overlaps: "plan/overlaps.json",
  lines: "context/transmission-lines.geojson",
  wetlands: "plan/insights/wetlands.json",
  river: "context/savannah-river.geojson",
} as const;

export const STORM_INDEX_FILE = "response/storms.json";

/** Per-storm files live in /data/response/<id>/ (Helene: /data/response/helene/). */
export function responseFiles(stormId: string) {
  const dir = `response/${encodeURIComponent(stormId)}`;
  return {
    meta: `${dir}/meta.json`,
    storm: `${dir}/storm.json`,
    segments: `${dir}/segments.json`,
    counties: `${dir}/counties.json`,
    zones: `${dir}/zones.json`,
    yards: `${dir}/yards.json`,
    vulnerable: `${dir}/vulnerable.json`,
    mutualAid: `${dir}/mutual-aid.json`,
    teamUp: `${dir}/teamup.json`,
  } as const;
}

export interface PlanData {
  meta: PlanMeta;
  projects: Project[];
  overlaps: Overlap[];
  lines: LineCollection;
  river: LineCollection;
  /** Wetland screening of shared corridors, when the pipeline provides it. */
  wetlands: WetlandNote[] | null;
}

export interface ResponseData {
  meta: ResponseMeta;
  storm: Storm;
  segments: LineSegmentRisk[];
  counties: CountyOutage[];
  zones: RepairZone[];
  yards: JointYard[];
  vulnerable: VulnerableArea[];
  river: LineCollection;
  /** Separate vs coordinated restoration scenarios, when available. */
  mutualAid: MutualAid | null;
  /** Every transmission owner in the path and who should team up, when available. */
  teamUp: TeamUp | null;
}

export interface Bundle<T> {
  data: T;
  files: FileStatus[];
}

function strip({ path, origin }: FileStatus): FileStatus {
  return { path, origin };
}

export async function loadPlan(signal?: AbortSignal): Promise<Bundle<PlanData>> {
  const [meta, projects, overlaps, lines, river] = await Promise.all([
    loadDataFile<PlanMeta>(PLAN_FILES.meta, "object", signal),
    loadDataFile<Project[]>(PLAN_FILES.projects, "array", signal),
    loadDataFile<Overlap[]>(PLAN_FILES.overlaps, "array", signal),
    loadOptionalLines(PLAN_FILES.lines, signal),
    loadOptionalLines(PLAN_FILES.river, signal),
  ]);
  const sample = overlaps.origin === "sample";
  const wetlands = await loadOptional(PLAN_FILES.wetlands, sample, isWetlandNoteList, signal);
  return {
    data: {
      meta: meta.data,
      projects: projects.data,
      overlaps: overlaps.data,
      lines: lines.data,
      river: river.data,
      wetlands: wetlands?.data ?? null,
    },
    files: [meta, projects, overlaps, lines, river, ...(wetlands ? [wetlands] : [])].map(
      strip,
    ),
  };
}

export async function loadStormIndex(signal?: AbortSignal): Promise<Bundle<StormIndexEntry[]>> {
  const index = await loadDataFile<StormIndexEntry[]>(STORM_INDEX_FILE, "array", signal);
  return { data: index.data, files: [strip(index)] };
}

export async function loadResponse(stormId: string, signal?: AbortSignal): Promise<Bundle<ResponseData>> {
  const f = responseFiles(stormId);
  const [meta, storm, segments, counties, zones, yards, vulnerable, river] = await Promise.all([
    loadDataFile<ResponseMeta>(f.meta, "object", signal),
    loadDataFile<Storm>(f.storm, "object", signal),
    loadDataFile<LineSegmentRisk[]>(f.segments, "array", signal),
    loadDataFile<CountyOutage[]>(f.counties, "array", signal),
    loadDataFile<RepairZone[]>(f.zones, "array", signal),
    loadDataFile<JointYard[]>(f.yards, "array", signal),
    loadDataFile<VulnerableArea[]>(f.vulnerable, "array", signal),
    loadOptionalLines(PLAN_FILES.river, signal),
  ]);
  const [mutualAid, teamUp] = await Promise.all([
    loadOptional(f.mutualAid, meta.origin === "sample", isMutualAid, signal),
    loadOptional(f.teamUp, false, isTeamUp, signal),
  ]);
  return {
    data: {
      meta: meta.data,
      storm: storm.data,
      segments: segments.data,
      counties: counties.data,
      zones: zones.data,
      yards: yards.data,
      vulnerable: vulnerable.data,
      river: river.data,
      mutualAid: mutualAid?.data ?? null,
      teamUp: teamUp?.data ?? null,
    },
    // The river is shared context, reported under Plan mode's status.
    files: [meta, storm, segments, counties, zones, yards, vulnerable, ...(mutualAid ? [mutualAid] : []), ...(teamUp ? [teamUp] : [])].map(strip),
  };
}

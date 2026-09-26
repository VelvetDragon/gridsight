/**
 * Typed loader for the files the pipeline writes into public/data/.
 *
 * Every file is fetched from /data/<path>. If that request fails (404, network,
 * bad JSON or wrong shape) the loader falls back to /data/fixtures/<path>, a
 * hand-built sample with the same type, and records that it did so. The UI
 * uses those records to show an honest "Sample data" indicator.
 */
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
  geometry:
    | { type: "LineString"; coordinates: Position[] }
    | { type: "MultiLineString"; coordinates: Position[][] };
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
  constructor(public readonly path: string, cause: unknown) {
    super(`Could not load ${path} (pipeline output or sample)`);
    this.cause = cause;
  }
}

export async function loadDataFile<T>(
  path: string,
  shape: Shape,
  signal?: AbortSignal,
): Promise<Loaded<T>> {
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

export const PLAN_FILES = {
  meta: "plan/meta.json",
  projects: "plan/projects.json",
  overlaps: "plan/overlaps.json",
  lines: "context/transmission-lines.geojson",
  river: "context/savannah-river.geojson",
} as const;

export const RESPONSE_FILES = {
  meta: "response/helene/meta.json",
  storm: "response/helene/storm.json",
  segments: "response/helene/segments.json",
  counties: "response/helene/counties.json",
  zones: "response/helene/zones.json",
  yards: "response/helene/yards.json",
  vulnerable: "response/helene/vulnerable.json",
} as const;

export interface PlanData {
  meta: PlanMeta;
  projects: Project[];
  overlaps: Overlap[];
  lines: LineCollection;
  river: LineCollection;
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
}

export interface Bundle<T> {
  data: T;
  files: FileStatus[];
}

function strip<T>({ path, origin }: Loaded<T>): FileStatus {
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
  return {
    data: {
      meta: meta.data,
      projects: projects.data,
      overlaps: overlaps.data,
      lines: lines.data,
      river: river.data,
    },
    files: [meta, projects, overlaps, lines, river].map(strip),
  };
}

export async function loadResponse(signal?: AbortSignal): Promise<Bundle<ResponseData>> {
  const [meta, storm, segments, counties, zones, yards, vulnerable, river] = await Promise.all([
    loadDataFile<ResponseMeta>(RESPONSE_FILES.meta, "object", signal),
    loadDataFile<Storm>(RESPONSE_FILES.storm, "object", signal),
    loadDataFile<LineSegmentRisk[]>(RESPONSE_FILES.segments, "array", signal),
    loadDataFile<CountyOutage[]>(RESPONSE_FILES.counties, "array", signal),
    loadDataFile<RepairZone[]>(RESPONSE_FILES.zones, "array", signal),
    loadDataFile<JointYard[]>(RESPONSE_FILES.yards, "array", signal),
    loadDataFile<VulnerableArea[]>(RESPONSE_FILES.vulnerable, "array", signal),
    loadOptionalLines(PLAN_FILES.river, signal),
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
    },
    // The river is shared context, reported under Plan mode's status.
    files: [meta, storm, segments, counties, zones, yards, vulnerable].map(strip),
  };
}

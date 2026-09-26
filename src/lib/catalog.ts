/**
 * Utility catalog for Crosswire: pick any two utilities and compare their plans.
 *
 *   /data/catalog/utilities.json          CatalogUtility[]
 *   /data/catalog/projects/<id>.json      CatalogProject[]
 *   /data/catalog/pairs/<a>__<b>.json     PairFile (ids sorted), optional
 *
 * Without a pair file the overlaps are computed in a Web Worker with the same
 * rules. Without a catalog at all, the original DESC / Georgia Power plan files
 * are used. Internally the chosen pair is mapped onto two "slots": slot "DESC"
 * is always *your* utility and slot "GPC" the *neighbour*, so every map layer
 * and panel keeps working unchanged; names come from the catalog.
 */
import { loadPlan, loadDataFile, PLAN_FILES, type FileStatus, type LineCollection, type PlanData } from "./data";
import { computeOverlaps, type ComputedOverlap, type ProjectLite } from "./overlaps";
import { isCostRangeList, type CostRange } from "./savings";
import type {
  CatalogProject,
  CatalogUtility,
  Overlap,
  PairFile,
  PairOverlap,
  PlanMeta,
  Project,
  StagingYard,
  UtilityId,
} from "./types";

export const CATALOG_FILE = "catalog/utilities.json";

export interface Catalog {
  utilities: CatalogUtility[];
  /** "catalog" when utilities.json exists; "plan" when derived from the DESC / GPC plan files. */
  origin: "catalog" | "plan";
}

export interface PairBundle {
  you: CatalogUtility;
  neighbor: CatalogUtility;
  plan: PlanData;
  files: FileStatus[];
  /** How the overlaps were obtained. */
  source: "pair-file" | "computed" | "plan-files";
}

/** Ids used for the DESC / Georgia Power fallback catalog. */
export const FALLBACK_IDS = { DESC: "desc", GPC: "georgia-power" } as const;

function fallbackCatalog(meta: PlanMeta): CatalogUtility[] {
  const count = meta.projectCount;
  return [
    {
      id: FALLBACK_IDS.DESC,
      name: "Dominion Energy South Carolina",
      shortName: "Dominion Energy",
      parent: "Dominion Energy",
      states: ["SC"],
      color: "#0E7C7B",
      planSources: meta.sources.filter((s) => /dominion|desc|scrtp/i.test(`${s.document} ${s.url}`)),
      projectCount: count.DESC,
      locatedCount: count.DESC,
      origin: "catalog",
      neighbors: [FALLBACK_IDS.GPC],
    },
    {
      id: FALLBACK_IDS.GPC,
      name: "Georgia Power",
      shortName: "Georgia Power",
      parent: "Southern Company",
      states: ["GA"],
      color: "#C2410C",
      planSources: meta.sources.filter((s) => /georgia|sertp|southern/i.test(`${s.document} ${s.url}`)),
      projectCount: count.GPC,
      locatedCount: count.GPC,
      origin: "catalog",
      neighbors: [FALLBACK_IDS.DESC],
    },
  ];
}

async function tryJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

export async function loadCatalog(signal?: AbortSignal): Promise<{ data: Catalog; files: FileStatus[] }> {
  const list = await tryJson<CatalogUtility[]>(`/data/${CATALOG_FILE}`, signal);
  if (Array.isArray(list) && list.length >= 2) {
    return { data: { utilities: list, origin: "catalog" }, files: [{ path: CATALOG_FILE, origin: "pipeline" }] };
  }
  const meta = await loadDataFile<PlanMeta>(PLAN_FILES.meta, "object", signal);
  return { data: { utilities: fallbackCatalog(meta.data), origin: "plan" }, files: [] };
}

/* ---------------- Slot mapping ---------------- */

function swapYard(y: StagingYard | null): StagingYard | null {
  return y ? { ...y, driveMinutesDesc: y.driveMinutesGpc, driveMinutesGpc: y.driveMinutesDesc } : null;
}

/** Swap the two slots (used when "your utility" is Georgia Power in the fallback data). */
function swapSlots(plan: PlanData): PlanData {
  const flip = (u: UtilityId): UtilityId => (u === "DESC" ? "GPC" : "DESC");
  return {
    ...plan,
    meta: {
      ...plan.meta,
      projectCount: { DESC: plan.meta.projectCount.GPC, GPC: plan.meta.projectCount.DESC },
    },
    projects: plan.projects.map((p) => ({ ...p, utility: flip(p.utility) })),
    overlaps: plan.overlaps.map((o) => ({
      ...o,
      descId: o.gpcId,
      gpcId: o.descId,
      closestPoints: [o.closestPoints[1], o.closestPoints[0]],
      stagingYard: swapYard(o.stagingYard),
    })),
  };
}

function toSlotProject(p: CatalogProject, slot: UtilityId): Project {
  return { ...p, utility: slot } as Project;
}

function fromPairOverlap(o: PairOverlap, youIsA: boolean): Overlap {
  const { aId, bId, ...rest } = o;
  return {
    ...rest,
    descId: youIsA ? aId : bId,
    gpcId: youIsA ? bId : aId,
    closestPoints: youIsA ? o.closestPoints : [o.closestPoints[1], o.closestPoints[0]],
    stagingYard: youIsA ? o.stagingYard : swapYard(o.stagingYard),
  };
}

function fromComputed(o: ComputedOverlap, youIsA: boolean): Overlap {
  return {
    id: `cw-${o.aId}--${o.bId}`,
    descId: youIsA ? o.aId : o.bId,
    gpcId: youIsA ? o.bId : o.aId,
    distanceKm: o.distanceKm,
    tier: o.tier,
    closestPoints: youIsA ? o.closestPoints : [o.closestPoints[1], o.closestPoints[0]],
    roadKm: null,
    roadVerified: null,
    stagingYard: null,
    timelineOverlapMonths: o.timelineOverlapMonths,
    robustness: o.robustness,
    shareable: o.shareable,
    score: o.score,
    rank: o.rank,
    cost: null,
    summary: o.summary,
  };
}

let worker: Worker | null = null;
let seq = 0;

/** Compute overlaps in a Web Worker (falls back to the main thread if workers are unavailable). */
function computeInWorker(a: ProjectLite[], b: ProjectLite[]): Promise<ReturnType<typeof computeOverlaps>> {
  if (typeof Worker === "undefined") return Promise.resolve(computeOverlaps(a, b));
  if (!worker) worker = new Worker(new URL("./overlap.worker.ts", import.meta.url), { type: "module" });
  const id = ++seq;
  const w = worker;
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent<{ id: number } & ReturnType<typeof computeOverlaps>>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      resolve(e.data);
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ id, a, b });
  });
}

const lite = (p: CatalogProject): ProjectLite => ({
  id: p.id,
  geometry: p.geometry,
  buildWindow: p.buildWindow,
  locationConfidence: p.locationConfidence,
  name: p.name,
});

async function loadContext(signal?: AbortSignal): Promise<{ lines: LineCollection; river: LineCollection }> {
  const empty: LineCollection = { type: "FeatureCollection", features: [] };
  const [lines, river] = await Promise.all([
    tryJson<LineCollection>(`/data/${PLAN_FILES.lines}`, signal),
    tryJson<LineCollection>(`/data/${PLAN_FILES.river}`, signal),
  ]);
  return { lines: lines?.features ? lines : empty, river: river?.features ? river : empty };
}

export async function loadPair(
  catalog: Catalog,
  youId: string,
  neighborId: string,
  signal?: AbortSignal,
): Promise<PairBundle> {
  const you = catalog.utilities.find((u) => u.id === youId);
  const neighbor = catalog.utilities.find((u) => u.id === neighborId);
  if (!you || !neighbor) throw new Error("Unknown utility");

  const fallbackIds: string[] = [FALLBACK_IDS.DESC, FALLBACK_IDS.GPC];
  if (catalog.origin === "plan" && fallbackIds.includes(youId) && fallbackIds.includes(neighborId)) {
    const bundle = await loadPlan(signal);
    const plan = youId === FALLBACK_IDS.GPC ? swapSlots(bundle.data) : bundle.data;
    return { you, neighbor, plan, files: bundle.files, source: "plan-files" };
  }

  const [a, b] = [you.id, neighbor.id].sort();
  const youIsA = a === you.id;
  const projectsOf = async (id: string): Promise<CatalogProject[] | null> => {
    const extra = found.get(id);
    if (extra) return extra;
    if (catalog.origin === "plan" && fallbackIds.includes(id)) {
      const slot: UtilityId = id === FALLBACK_IDS.DESC ? "DESC" : "GPC";
      const bundle = await loadPlan(signal);
      return bundle.data.projects.filter((p) => p.utility === slot).map((p) => ({ ...p, utility: id }));
    }
    return tryJson<CatalogProject[]>(`/data/catalog/projects/${encodeURIComponent(id)}.json`, signal);
  };
  const [projA, projB, pair, ctx, ranges] = await Promise.all([
    projectsOf(a),
    projectsOf(b),
    tryJson<PairFile>(`/data/catalog/pairs/${encodeURIComponent(a)}__${encodeURIComponent(b)}.json`, signal),
    loadContext(signal),
    tryJson<CostRange[]>(
      `/data/catalog/pairs/${encodeURIComponent(a)}__${encodeURIComponent(b)}.cost-ranges.json`,
      signal,
    ),
  ]);
  if (!projA || !projB) throw new Error(`Project list missing for ${!projA ? a : b}`);
  const slotA: UtilityId = youIsA ? "DESC" : "GPC";
  const slotB: UtilityId = youIsA ? "GPC" : "DESC";
  const projects = [...projA.map((p) => toSlotProject(p, slotA)), ...projB.map((p) => toSlotProject(p, slotB))];

  let overlaps: Overlap[];
  let pairsCompared: number;
  let source: PairBundle["source"];
  if (pair && Array.isArray(pair.overlaps)) {
    overlaps = pair.overlaps.map((o) => fromPairOverlap(o, youIsA));
    pairsCompared = pair.pairsCompared;
    source = "pair-file";
  } else {
    const result = await computeInWorker(projA.map(lite), projB.map(lite));
    overlaps = result.overlaps.map((o) => fromComputed(o, youIsA));
    pairsCompared = result.pairsCompared;
    source = "computed";
  }

  const meta: PlanMeta = {
    generatedAt: pair?.generatedAt ?? new Date().toISOString(),
    utilities: [
      { id: "DESC", name: you.name, state: (you.states[0] ?? "SC") as "SC", color: you.color },
      { id: "GPC", name: neighbor.name, state: (neighbor.states[0] ?? "GA") as "GA", color: neighbor.color },
    ],
    projectCount: {
      DESC: projects.filter((p) => p.utility === "DESC").length,
      GPC: projects.filter((p) => p.utility === "GPC").length,
    },
    pairsCompared,
    overlapsFound: overlaps.length,
    knownMatches: [],
    sources: [...you.planSources, ...neighbor.planSources],
  };
  const files: FileStatus[] = [
    { path: `catalog/projects/${a}.json`, origin: "pipeline" },
    { path: `catalog/projects/${b}.json`, origin: "pipeline" },
    ...(pair ? [{ path: `catalog/pairs/${a}__${b}.json`, origin: "pipeline" as const }] : []),
  ];
  return {
    you,
    neighbor,
    plan: {
      meta,
      projects,
      overlaps,
      lines: ctx.lines,
      river: ctx.river,
      costRanges: isCostRangeList(ranges) ? ranges : null,
    },
    files,
    source,
  };
}

/* ---------------- "Find another utility" ---------------- */

/** Utilities found on demand this session, with their extracted projects. */
const found = new Map<string, CatalogProject[]>();

export function registerFoundUtility(utility: CatalogUtility, projects: CatalogProject[]) {
  found.set(utility.id, projects);
}

export const FIND_ENDPOINT = "/api/utilities/find";

/** true when the integrations endpoint is deployed (404 means it is not). */
export async function findEndpointAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(FIND_ENDPOINT, { method: "HEAD", signal });
    return res.status !== 404;
  } catch {
    return false;
  }
}

/**
 * Ask the integrations endpoint to find and extract a utility's public plan.
 * Expected response: { utility: CatalogUtility, projects: CatalogProject[] }.
 */
export async function findUtility(
  query: string,
  signal?: AbortSignal,
): Promise<{ utility: CatalogUtility; projects: CatalogProject[] }> {
  const res = await fetch(FIND_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return (await res.json()) as { utility: CatalogUtility; projects: CatalogProject[] };
}

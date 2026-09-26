"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/auth";
import {
  findEndpointAvailable,
  findUtility,
  loadCatalog,
  loadPair,
  registerFoundUtility,
  type Catalog,
  type PairBundle,
} from "@/lib/catalog";
import { boundsOf, geometryPoints, haversineKm, type Bounds } from "@/lib/geo";
import { tierFor } from "@/lib/overlaps";
import { DEFAULT_WEIGHTS, rankOverlaps, type RankWeights } from "@/lib/ranking";
import { rememberComparison } from "@/lib/recent";
import { savingsByYear, summarizeSavings } from "@/lib/savings";
import { setSlotNames, TIERS } from "@/lib/theme";
import { RADAR_MONTHS } from "@/lib/timeline";
import type { CatalogUtility, Overlap, OverlapTier, Position, Project } from "@/lib/types";
import { useDataset } from "@/lib/useDataset";
import { usePlayback } from "@/lib/usePlayback";
import { setUrlParams, useUrlParam } from "@/lib/useUrlState";
import type { ViewRequest } from "../map/MapCanvas";
import { pointAlong } from "../map/mapLabels";
import type { ReachCollection } from "../map/planScene";

export type Measure = "closest" | "center";

/** The middle of a project: a station itself, or halfway along a line. */
export function centerOf(p: Project): Position {
  return p.geometry.type === "Point"
    ? p.geometry.coordinates
    : pointAlong(p.geometry.coordinates, p.geometry.coordinates[0], 0.5);
}

/** Re-measure a pair between the two projects' centres instead of their closest points. */
function centerMeasured(o: Overlap, byId: Map<string, Project>): Overlap | null {
  const a = byId.get(o.descId);
  const b = byId.get(o.gpcId);
  if (!a || !b) return null;
  const ca = centerOf(a);
  const cb = centerOf(b);
  const km = Math.round(haversineKm(ca, cb) * 100) / 100;
  const tier = tierFor(km);
  if (!tier) return null;
  return { ...o, closestPoints: [ca, cb], distanceKm: tier === "crossing" ? 0 : km, tier };
}

/** Camera bounds for a pair: both projects and the gap between them. */
export function pairBounds(o: Overlap, byId: Map<string, Project>): Bounds | null {
  const pts: Position[] = [...o.closestPoints];
  for (const id of [o.descId, o.gpcId]) {
    const p = byId.get(id);
    if (p) pts.push(...geometryPoints(p.geometry));
  }
  if (o.stagingYard) pts.push(o.stagingYard.position);
  const b = boundsOf(pts);
  if (!b) return null;
  // Keep a little air around very small pairs.
  const pad = 0.03;
  return [
    [b[0][0] - pad, b[0][1] - pad],
    [b[1][0] + pad, b[1][1] + pad],
  ];
}

function defaultPair(utilities: CatalogUtility[], org: string | null): [string, string] | null {
  if (utilities.length < 2) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const mine =
    (org && utilities.find((u) => norm(u.name) === norm(org) || norm(u.shortName) === norm(org))) || utilities[0];
  const neighbour =
    utilities.find((u) => u.id !== mine.id && mine.neighbors.includes(u.id)) ?? utilities.find((u) => u.id !== mine.id)!;
  return [mine.id, neighbour.id];
}

export function useCrosswire() {
  const session = useSession();
  const org = session.status === "authenticated" ? session.session.user.organization : null;

  const [catState, retryCatalog] = useDataset(loadCatalog);
  const [found, setFound] = useState<CatalogUtility[]>([]);
  const catalog = useMemo<Catalog | null>(
    () =>
      catState.status === "ready"
        ? {
            ...catState.data,
            utilities: [...catState.data.utilities.filter((u) => !found.some((f) => f.id === u.id)), ...found],
          }
        : null,
    [catState, found],
  );

  const youParam = useUrlParam("you");
  const neighborParam = useUrlParam("neighbor");
  const matchParam = useUrlParam("match");
  const selParam = useUrlParam("sel");
  const measure: Measure = useUrlParam("measure") === "center" ? "center" : "closest";

  const pairIds = useMemo<[string, string] | null>(() => {
    if (!catalog) return null;
    const ids = new Set(catalog.utilities.map((u) => u.id));
    if (youParam && neighborParam && youParam !== neighborParam && ids.has(youParam) && ids.has(neighborParam)) {
      return [youParam, neighborParam];
    }
    return defaultPair(catalog.utilities, org);
  }, [catalog, youParam, neighborParam, org]);

  const loader = useMemo(() => {
    if (!catalog || !pairIds) return null;
    const [you, neighbor] = pairIds;
    return async (signal: AbortSignal) => {
      const b = await loadPair(catalog, you, neighbor, signal);
      setSlotNames({ DESC: b.you.shortName, GPC: b.neighbor.shortName });
      return { data: b, files: b.files };
    };
  }, [catalog, pairIds]);
  const [pairState, retryPair] = useDataset<PairBundle>(loader);
  const bundle = pairState.status === "ready" ? pairState.data : null;
  const plan = bundle?.plan ?? null;

  const projectsById = useMemo(() => new Map((plan?.projects ?? []).map((p) => [p.id, p])), [plan]);

  // Measured pairs (closest points are official; centre points on request).
  const measured = useMemo(() => {
    if (!plan) return [];
    if (measure === "closest") return plan.overlaps;
    return plan.overlaps.map((o) => centerMeasured(o, projectsById)).filter((o): o is Overlap => !!o);
  }, [plan, measure, projectsById]);

  // "Your lines": the panel then shows only what collides with them.
  const selectedProjects = useMemo(
    () => new Set((selParam ?? "").split(",").filter((id) => id && projectsById.has(id))),
    [selParam, projectsById],
  );
  const relevant = useMemo(
    () =>
      selectedProjects.size
        ? measured.filter((o) => selectedProjects.has(o.descId) || selectedProjects.has(o.gpcId))
        : measured,
    [measured, selectedProjects],
  );

  const [tiers, setTiers] = useState<Set<OverlapTier>>(() => new Set(TIERS));
  const [weights, setWeights] = useState<RankWeights>(DEFAULT_WEIGHTS);
  const ranked = useMemo(() => rankOverlaps(relevant, weights, tiers), [relevant, weights, tiers]);
  const selected = ranked.find((r) => r.overlap.id === matchParam) ?? null;

  const costRanges = useMemo(
    () => (plan?.costRanges ? new Map(plan.costRanges.map((r) => [r.overlapId, r])) : null),
    [plan],
  );
  const shown = useMemo(() => ranked.map((r) => r.overlap), [ranked]);
  const savings = useMemo(() => summarizeSavings(shown, costRanges), [shown, costRanges]);
  const savingsYears = useMemo(() => savingsByYear(shown, projectsById, costRanges), [shown, projectsById, costRanges]);
  const savingsAssumptions = useMemo(() => {
    const seen = new Set<string>();
    for (const o of shown) for (const a of o.cost?.assumptions ?? []) seen.add(a);
    return [...seen].slice(0, 6);
  }, [shown]);

  // Remember what was opened, for Switchboard's "Recent comparisons".
  useEffect(() => {
    if (!bundle) return;
    rememberComparison({
      you: bundle.you.id,
      neighbor: bundle.neighbor.id,
      label: `${bundle.you.shortName} and ${bundle.neighbor.shortName}`,
      overlaps: bundle.plan.overlaps.length,
    });
  }, [bundle]);

  // Drive-time shapes for the selected pair, when the data teammate provides them.
  const [reach, setReach] = useState<{ id: string; data: ReachCollection | null } | null>(null);
  useEffect(() => {
    if (!selected) return;
    const id = selected.overlap.id;
    const ctrl = new AbortController();
    fetch(`/data/plan/insights/reach/${encodeURIComponent(id)}.geojson`, { signal: ctrl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ReachCollection>) : null))
      .then((d) => setReach({ id, data: d && Array.isArray(d.features) ? d : null }))
      .catch(() => {});
    return () => ctrl.abort();
  }, [selected]);
  const reachFor = selected && reach?.id === selected.overlap.id ? reach.data : null;

  /* ---------- Camera ---------- */
  const [view, setView] = useState<ViewRequest | null>(null);
  const pairKey = bundle ? `${bundle.you.id}:${bundle.neighbor.id}` : "";
  const effectiveView = useMemo<ViewRequest | null>(() => {
    if (view && view.key.startsWith(pairKey)) return view;
    if (selected) {
      const b = pairBounds(selected.overlap, projectsById);
      return b ? { key: `${pairKey}:init-${selected.overlap.id}`, kind: "bounds", bounds: b, maxZoom: 12.5 } : null;
    }
    const all = boundsOf((plan?.projects ?? []).flatMap((p) => geometryPoints(p.geometry)));
    return all ? { key: `${pairKey}:all`, kind: "bounds", bounds: all, maxZoom: 9 } : null;
  }, [view, pairKey, selected, projectsById, plan]);

  /* ---------- Actions (all through the URL, so Back works) ---------- */
  const setPair = useCallback((you: string, neighbor: string) => {
    setUrlParams({ you, neighbor, match: null, sel: null }, true);
  }, []);

  const selectOverlap = useCallback(
    (id: string) => {
      const o = measured.find((x) => x.id === id);
      if (!o) return;
      setTiers((prev) => (prev.has(o.tier) ? prev : new Set([...prev, o.tier])));
      setUrlParams({ match: id }, true);
      const b = pairBounds(o, projectsById);
      if (b) setView({ key: `${pairKey}:sel-${id}-${Date.now()}`, kind: "bounds", bounds: b, maxZoom: 12.5 });
    },
    [measured, projectsById, pairKey],
  );

  const clearMatch = useCallback(() => {
    setUrlParams({ match: null }, true);
    const all = boundsOf((plan?.projects ?? []).flatMap((p) => geometryPoints(p.geometry)));
    if (all) setView({ key: `${pairKey}:back-${Date.now()}`, kind: "bounds", bounds: all, maxZoom: 9 });
  }, [plan, pairKey]);

  const toggleProject = useCallback(
    (id: string, additive: boolean) => {
      let next: Set<string>;
      if (additive) {
        next = new Set(selectedProjects);
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else {
        // A plain click picks just this one; clicking the only pick again clears it.
        next = selectedProjects.has(id) && selectedProjects.size === 1 ? new Set() : new Set([id]);
      }
      setUrlParams({ sel: [...next].join(",") || null, match: null }, true);
    },
    [selectedProjects],
  );

  const clearSelection = useCallback(() => setUrlParams({ sel: null }, true), []);
  const setMeasure = useCallback((m: Measure) => setUrlParams({ measure: m === "center" ? "center" : null }), []);

  const toggleTier = useCallback((t: OverlapTier) => {
    setTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  /* ---------- "Find another utility" ---------- */
  const [findAvailable, setFindAvailable] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    findEndpointAvailable(ctrl.signal).then((ok) => !ctrl.signal.aborted && setFindAvailable(ok));
    return () => ctrl.abort();
  }, []);
  const [finding, setFinding] = useState<{ query: string; status: "working" | "failed"; error?: string } | null>(null);
  const find = useCallback(
    async (query: string) => {
      setFinding({ query, status: "working" });
      try {
        const { utility, projects } = await findUtility(query);
        registerFoundUtility(utility, projects);
        setFound((prev) => [...prev.filter((u) => u.id !== utility.id), utility]);
        setFinding(null);
        if (pairIds) setUrlParams({ you: pairIds[0], neighbor: utility.id, match: null, sel: null }, true);
      } catch (err) {
        setFinding({ query, status: "failed", error: err instanceof Error ? err.message : String(err) });
      }
    },
    [pairIds],
  );

  /* ---------- Construction radar ---------- */
  const [radarOn, setRadarOn] = useState(false);
  const radar = usePlayback({ min: 0, max: RADAR_MONTHS - 1, step: 1, intervalMs: 160, initial: 0 });
  const radarMonth = radarOn ? radar.value : null;

  return {
    catalog,
    catalogError: catState.status === "error" ? catState.error : null,
    retryCatalog,
    pairIds,
    bundle,
    pairLoading: pairState.status === "loading",
    pairError: pairState.status === "error" ? pairState.error : null,
    retryPair,
    plan,
    projectsById,
    measure,
    setMeasure,
    selectedProjects,
    toggleProject,
    clearSelection,
    tiers,
    toggleTier,
    weights,
    setWeights,
    ranked,
    selected,
    selectOverlap,
    clearMatch,
    setPair,
    costRanges,
    savings,
    savingsYears,
    savingsAssumptions,
    reach: reachFor,
    view: effectiveView,
    findAvailable,
    finding,
    find,
    cancelFind: () => setFinding(null),
    radarOn,
    setRadarOn,
    radar,
    radarMonth,
  };
}

export type CrosswireState = ReturnType<typeof useCrosswire>;

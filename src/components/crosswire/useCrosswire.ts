"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { fundingOpportunity, isMatch, screenPair, UTILITY_OWNERSHIP, type FundingMatch, type ProgramScreen } from "@/lib/grants";
import type { AgentProject, AgentRequest } from "@/lib/integrations/savingsAgent";
import { pairOpportunities } from "@/lib/opportunities";
import { DEFAULT_WEIGHTS, rankOverlaps, type PairSignals, type RankWeights } from "@/lib/ranking";
import { rememberComparison } from "@/lib/recent";
import { matchSavings, savingsByYear, summarizeSavings } from "@/lib/savings";
import { setSlotNames, TIERS } from "@/lib/theme";
import { RADAR_MONTHS } from "@/lib/timeline";
import type { CatalogUtility, Overlap, OverlapTier, Position, Project } from "@/lib/types";
import { useDataset } from "@/lib/useDataset";
import { usePlayback } from "@/lib/usePlayback";
import { setUrlParams, useUrlParam } from "@/lib/useUrlState";
import type { ViewRequest } from "../map/MapCanvas";
import { pointAlong } from "../map/mapLabels";
import type { ReachCollection } from "../map/planScene";
import { useSavingsAgent } from "./useSavingsAgent";

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

/** The first catalog utility and its nearest listed neighbour. */
function defaultPair(utilities: CatalogUtility[]): [string, string] | null {
  if (utilities.length < 2) return null;
  const mine = utilities[0];
  const neighbour =
    utilities.find((u) => u.id !== mine.id && mine.neighbors.includes(u.id)) ?? utilities.find((u) => u.id !== mine.id)!;
  return [mine.id, neighbour.id];
}

export function useCrosswire() {

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
    return defaultPair(catalog.utilities);
  }, [catalog, youParam, neighborParam]);

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
  // Ways to work together and the estimated saving of every pair (the agent's "prices" step).
  const baseSignals = useMemo(() => {
    const out = new Map<string, PairSignals>();
    if (!plan) return out;
    for (const o of measured) {
      const a = projectsById.get(o.descId);
      const b = projectsById.get(o.gpcId);
      if (!a || !b) continue;
      const wetland = plan.wetlands?.find((w) => w.overlapId === o.id) ?? null;
      const opportunities = pairOpportunities(o, a, b, wetland, plan.lines);
      out.set(o.id, { opportunities, savedUsd: matchSavings(o, a, b, opportunities)?.total ?? 0 });
    }
    return out;
  }, [plan, measured, projectsById]);

  /* ---------- Savings agent: grants, requirement checks, AI verification, notes ---------- */
  const agentRequest = useMemo<AgentRequest>(() => {
    if (!bundle) return { projects: [], pairs: [] };
    const projects = new Map<string, AgentProject>();
    const project = (p: Project): string => {
      const u = p.utility === "DESC" ? bundle.you : bundle.neighbor;
      projects.set(p.id, {
        id: p.id,
        name: p.name,
        description: p.description,
        kind: p.kind,
        action: p.action,
        voltageKv: p.voltageKv,
        state: p.state,
        inService: p.inService,
        utility: u.shortName,
        ownership: UTILITY_OWNERSHIP[u.id] ?? null,
        miles: p.miles,
      });
      return p.id;
    };
    const pairs = measured.flatMap((o) => {
      const a = projectsById.get(o.descId);
      const b = projectsById.get(o.gpcId);
      const s = baseSignals.get(o.id);
      if (!a || !b || !s) return [];
      return [
        {
          id: o.id,
          a: project(a),
          b: project(b),
          shared: s.opportunities.map((op) => ({ kind: op.kind, title: op.title })),
          savedUsd: s.savedUsd,
        },
      ];
    });
    return { projects: [...projects.values()], pairs };
  }, [bundle, measured, projectsById, baseSignals]);
  const agent = useSavingsAgent(bundle ? `${bundle.you.id}:${bundle.neighbor.id}:${measure}` : "", agentRequest);
  // Every program's checklist for every pair: the rules, with Gemini's re-reads once they arrive.
  // Before the agent answers (or if it can't be reached) the verified list is checked by rule alone.
  const grantScreens = useMemo(() => {
    const byId = new Map(agentRequest.projects.map((p) => [p.id, p]));
    const out: Record<string, ProgramScreen[]> = {};
    for (const p of agentRequest.pairs) {
      const a = byId.get(p.a);
      const b = byId.get(p.b);
      if (a && b) out[p.id] = screenPair(a, b, p.shared, agent.programs, agent.overrides);
    }
    return out;
  }, [agentRequest, agent.programs, agent.overrides]);
  const funding = useMemo(() => {
    const out: Record<string, FundingMatch[]> = {};
    for (const [id, screens] of Object.entries(grantScreens)) {
      const m = screens.filter(isMatch);
      if (m.length) out[id] = m;
    }
    return out;
  }, [grantScreens]);
  // A joint grant fit is one more way to work together, so it shows and ranks with the others.
  const signals = useMemo(() => {
    const out = new Map<string, PairSignals>();
    for (const [id, s] of baseSignals) {
      const op = fundingOpportunity(funding[id] ?? [], agent.programs);
      out.set(id, op ? { ...s, opportunities: [...s.opportunities, op] } : s);
    }
    return out;
  }, [baseSignals, funding, agent.programs]);

  const ranked = useMemo(
    () => rankOverlaps(relevant, weights, tiers, (o) => signals.get(o.id) ?? null),
    [relevant, weights, tiers, signals],
  );
  const selected = ranked.find((r) => r.overlap.id === matchParam) ?? null;

  const shown = useMemo(() => ranked.map((r) => r.overlap), [ranked]);
  const savings = useMemo(() => summarizeSavings(shown, projectsById), [shown, projectsById]);
  const savingsYears = useMemo(() => savingsByYear(shown, projectsById), [shown, projectsById]);

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
    /** Pairs before the kind filter, for counting each kind. */
    candidates: relevant,
    tiers,
    toggleTier,
    weights,
    signals,
    agent,
    funding,
    grantScreens,
    setWeights,
    ranked,
    selected,
    selectOverlap,
    clearMatch,
    setPair,
    savings,
    savingsYears,
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

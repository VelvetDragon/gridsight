"use client";

import dynamic from "next/dynamic";
import { PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadPlan } from "@/lib/data";
import { boundsOf, circleBounds, geometryPoints, midpoint, type Bounds } from "@/lib/geo";
import { DEFAULT_WEIGHTS, rankOverlaps, type RankWeights } from "@/lib/ranking";
import { TIERS } from "@/lib/theme";
import { RADAR_MONTHS } from "@/lib/timeline";
import type { Overlap, OverlapTier, Position, Project } from "@/lib/types";
import { useDataset } from "@/lib/useDataset";
import { usePlayback } from "@/lib/usePlayback";
import type { MapPadding, MapPopup, ViewRequest } from "./map/MapCanvas";
import type { Mode } from "./map/MapStage";
import type { PlanSceneProps } from "./map/planScene";
import { MatchDrawer } from "./plan/MatchDrawer";
import { OpportunityList } from "./plan/OpportunityList";
import { ProjectPopover } from "./plan/ProjectPopover";
import { RadarBar } from "./plan/RadarBar";
import { TopBar } from "./TopBar";
import { ErrorCard } from "./ui/states";

const MapStage = dynamic(() => import("./map/MapStage"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" />,
});

const GUTTER = 16;
const TOP_BAR = 48;
const LEFT_W = 360;
const DRAWER_W = 408;
const BOTTOM_BAR = 76;
/** Space kept clear under bottom-anchored panels so map attribution stays visible. */
const ATTRIBUTION_CLEARANCE = 36;

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Camera bounds for a match: both projects, the staging yard and the inner tier rings. */
function overlapBounds(o: Overlap, projectsById: Map<string, Project>): Bounds | null {
  const mid = midpoint(o.closestPoints[0], o.closestPoints[1]);
  const pts: Position[] = [...o.closestPoints];
  for (const pid of [o.descId, o.gpcId]) {
    const p = projectsById.get(pid);
    if (p) pts.push(...geometryPoints(p.geometry));
  }
  if (o.stagingYard) pts.push(o.stagingYard.position);
  const ring = circleBounds(mid, Math.max(9, o.distanceKm * 0.75));
  return boundsOf([...pts, ring[0], ring[1]]);
}

export default function App() {
  const [mode, setMode] = useState<Mode>("plan");
  const [planState, retryPlan] = useDataset(loadPlan);
  const plan = planState.status === "ready" ? planState.data : null;

  // ---------- Plan state ----------
  const [tiers, setTiers] = useState<Set<OverlapTier>>(() => new Set(TIERS));
  const [weights, setWeights] = useState<RankWeights>(DEFAULT_WEIGHTS);
  // ?match=<overlap id> opens a match directly (handy for demos and shared links).
  const [selectedId, setSelectedId] = useState<string | null>(() => readParam("match"));
  const [leftOpen, setLeftOpen] = useState(true);
  const [popup, setPopup] = useState<{ project: Project; at: Position } | null>(null);
  const [view, setView] = useState<ViewRequest | null>(null);
  const [radarOn, setRadarOn] = useState(false);
  const radar = usePlayback({ min: 0, max: RADAR_MONTHS - 1, step: 1, intervalMs: 160, initial: 0 });

  const projectsById = useMemo(() => new Map((plan?.projects ?? []).map((p) => [p.id, p])), [plan]);
  const ranked = useMemo(() => (plan ? rankOverlaps(plan.overlaps, weights, tiers) : []), [plan, weights, tiers]);
  const selected = ranked.find((r) => r.overlap.id === selectedId) ?? null;

  const selectOverlap = useCallback(
    (id: string) => {
      const o = plan?.overlaps.find((x) => x.id === id);
      if (!o) return;
      setSelectedId(id);
      setPopup(null);
      // Tier filters should never hide what the user just picked.
      setTiers((prev) => (prev.has(o.tier) ? prev : new Set([...prev, o.tier])));
      const b = overlapBounds(o, projectsById);
      if (b) setView({ key: `sel-${id}-${Date.now()}`, kind: "bounds", bounds: b, maxZoom: 11.5 });
    },
    [plan, projectsById],
  );

  // A match opened from the URL gets the same camera move once its data arrives.
  const effectiveView = useMemo<ViewRequest | null>(() => {
    if (view || !selected) return view;
    const b = overlapBounds(selected.overlap, projectsById);
    return b ? { key: `init-${selected.overlap.id}`, kind: "bounds", bounds: b, maxZoom: 11.5 } : null;
  }, [view, selected, projectsById]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setPopup(null);
  }, []);

  const toggleTier = useCallback((t: OverlapTier) => {
    setTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (popup) setPopup(null);
      else if (selectedId) setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popup, selectedId]);

  const radarMonth = radarOn ? radar.value : null;

  const planScene = useMemo<PlanSceneProps | null>(
    () =>
      plan
        ? {
            data: plan,
            ranked,
            projectsById,
            selectedId: selected ? selectedId : null,
            radarMonth,
            onSelectOverlap: selectOverlap,
            onProjectClick: (project, at) => setPopup({ project, at }),
            onEmptyClick: () => setPopup(null),
          }
        : null,
    [plan, ranked, projectsById, selected, selectedId, radarMonth, selectOverlap],
  );

  const mapPopup = useMemo<MapPopup | null>(
    () =>
      mode === "plan" && popup
        ? {
            key: popup.project.id,
            position: popup.at,
            onClose: () => setPopup(null),
            content: <ProjectPopover project={popup.project} onClose={() => setPopup(null)} />,
          }
        : null,
    [mode, popup],
  );

  const drawerOpen = mode === "plan" && !!selected;
  const padding = useMemo<MapPadding>(
    () => ({
      top: GUTTER + TOP_BAR + 32,
      bottom: BOTTOM_BAR + ATTRIBUTION_CLEARANCE + 32,
      left: leftOpen ? GUTTER + LEFT_W + 32 : 48,
      right: drawerOpen ? GUTTER + DRAWER_W + 32 : 48,
    }),
    [leftOpen, drawerOpen],
  );

  const status = {
    loading: planState.status === "loading",
    files: planState.status === "ready" ? planState.files : null,
    generatedAt: plan?.meta.generatedAt ?? null,
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-paper">
      <MapStage mode={mode} plan={planScene} popup={mapPopup} view={effectiveView} padding={padding} />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute" style={{ top: GUTTER, left: GUTTER, right: GUTTER }}>
          <TopBar mode={mode} onMode={setMode} status={status} />
        </div>

        {mode === "plan" ? (
          <>
            {leftOpen ? (
              <div
                className="gs-in-left pointer-events-auto absolute"
                style={{ top: GUTTER * 2 + TOP_BAR, left: GUTTER, bottom: GUTTER }}
              >
                <OpportunityList
                  data={plan}
                  ranked={ranked}
                  projectsById={projectsById}
                  tiers={tiers}
                  onToggleTier={toggleTier}
                  weights={weights}
                  onWeights={setWeights}
                  selectedId={selectedId}
                  onSelect={selectOverlap}
                  onCollapse={() => setLeftOpen(false)}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLeftOpen(true)}
                className="glass gs-fade pointer-events-auto absolute flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-ink"
                style={{ top: GUTTER * 2 + TOP_BAR, left: GUTTER }}
              >
                <PanelLeftOpen size={16} aria-hidden className="text-ink-2" />
                Opportunities
                <span className="num text-ink-3">{ranked.length}</span>
              </button>
            )}

            {selected ? (
              <div
                key={selected.overlap.id}
                className="gs-in-right pointer-events-auto absolute"
                style={{ top: GUTTER * 2 + TOP_BAR, right: GUTTER, bottom: ATTRIBUTION_CLEARANCE }}
              >
                <MatchDrawer
                  item={selected}
                  desc={projectsById.get(selected.overlap.descId)}
                  gpc={projectsById.get(selected.overlap.gpcId)}
                  radarMonth={radarMonth}
                  onClose={clearSelection}
                />
              </div>
            ) : null}

            {plan ? (
              <div
                className="pointer-events-auto absolute"
                style={{
                  left: leftOpen ? GUTTER * 2 + LEFT_W : GUTTER,
                  right: drawerOpen ? GUTTER * 2 + DRAWER_W : GUTTER,
                  bottom: ATTRIBUTION_CLEARANCE,
                  transition: "left 220ms ease, right 220ms ease",
                }}
              >
                <div className="mx-auto max-w-[880px]">
                  <RadarBar
                    projects={plan.projects}
                    ranked={ranked}
                    projectsById={projectsById}
                    enabled={radarOn}
                    month={radar.value}
                    playing={radar.playing}
                    onSeek={radar.seek}
                    onToggle={radar.toggle}
                    onEnabled={(on) => {
                      setRadarOn(on);
                      if (!on) radar.pause();
                    }}
                  />
                </div>
              </div>
            ) : null}

            {planState.status === "error" ? <ErrorCard message={planState.error} onRetry={retryPlan} /> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

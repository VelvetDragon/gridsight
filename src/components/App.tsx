"use client";

import dynamic from "next/dynamic";
import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadPlan } from "@/lib/data";
import { boundsOf, circleBounds, geometryPoints, midpoint, type Bounds } from "@/lib/geo";
import { DEFAULT_WEIGHTS, rankOverlaps, type RankWeights } from "@/lib/ranking";
import { TIERS } from "@/lib/theme";
import { savingsByYear, summarizeSavings } from "@/lib/savings";
import { RADAR_MONTHS, RADAR_START_YEAR } from "@/lib/timeline";
import type { Overlap, OverlapTier, Position, Project } from "@/lib/types";
import { useDataset } from "@/lib/useDataset";
import { usePlayback } from "@/lib/usePlayback";
import type { MapPadding, MapPopup, ViewRequest } from "./map/MapCanvas";
import type { Mode } from "./map/MapStage";
import type { PlanSceneProps } from "./map/planScene";
import { MatchDrawer } from "./plan/MatchDrawer";
import { OpportunityList } from "./plan/OpportunityList";
import { SavingsCard } from "./plan/Savings";
import { ProjectPopover } from "./plan/ProjectPopover";
import { RadarBar } from "./plan/RadarBar";
import { LayersPanel } from "./response/LayersPanel";
import { ResponsePanel } from "./response/ResponsePanel";
import { StormScrubber } from "./response/StormScrubber";
import { useResponseMode } from "./response/useResponseMode";
import { HowToCard, useHowTo } from "./HowToCard";
import { MapKey, PLAN_KEY } from "./MapKey";
import { TopBar } from "./TopBar";
import { ErrorCard } from "./ui/states";

const MapStage = dynamic(() => import("./map/MapStage"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" />,
});

const GUTTER = 16;
const TOP_BAR = 56;
const LEFT_W = 380;
const DRAWER_W = 408;
const BOTTOM_BAR = 72;
/** Space kept clear under bottom-anchored panels so map attribution stays visible. */
const ATTRIBUTION_CLEARANCE = 36;
const LAYERS_W = 320;
const KEY_W = 320;
const RESPONSE_W = 372;

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

const noSubscribe = () => () => {};

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
  // ?mode=response opens Response mode. Read hydration-safely (server renders Plan).
  const urlMode = useSyncExternalStore(
    noSubscribe,
    () => readParam("mode"),
    () => null,
  );
  const [modeChoice, setMode] = useState<Mode | null>(null);
  const mode: Mode = modeChoice ?? (urlMode === "response" ? "response" : "plan");
  const [planState, retryPlan] = useDataset(loadPlan);
  const plan = planState.status === "ready" ? planState.data : null;

  // ---------- Plan state ----------
  const [tiers, setTiers] = useState<Set<OverlapTier>>(() => new Set(TIERS));
  const [weights, setWeights] = useState<RankWeights>(DEFAULT_WEIGHTS);
  // ?match=<overlap id> opens a match directly (handy for demos and shared links).
  const [selectedId, setSelectedId] = useState<string | null>(() => readParam("match"));
  const [leftOpen, setLeftOpen] = useState(true);
  // Open by default; folded when a pair is open, since the pair drawer then takes the right side.
  const [keyOpen, setKeyOpen] = useState(() => !readParam("match"));
  const howTo = useHowTo();
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
      // The pair drawer takes the right side; fold the key so it stays out of the way.
      setKeyOpen(false);
      // Tier filters should never hide what the user just picked.
      setTiers((prev) => (prev.has(o.tier) ? prev : new Set([...prev, o.tier])));
      const b = overlapBounds(o, projectsById);
      if (b) setView({ key: `sel-${id}-${Date.now()}`, kind: "bounds", bounds: b, maxZoom: 11.5 });
    },
    [plan, projectsById],
  );

  // A match opened from the URL gets the same camera move once its data arrives.
  const effectiveView = useMemo<ViewRequest | null>(() => {
    if (view) return view;
    if (selected) {
      const b = overlapBounds(selected.overlap, projectsById);
      return b ? { key: `init-${selected.overlap.id}`, kind: "bounds", bounds: b, maxZoom: 11.5 } : null;
    }
    // First view: every planned project, so the work fills the space between the panels.
    const all = boundsOf((plan?.projects ?? []).flatMap((p) => geometryPoints(p.geometry)));
    return all ? { key: "plan-all", kind: "bounds", bounds: all, maxZoom: 9 } : null;
  }, [view, selected, projectsById, plan]);

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

  // ---------- Response state ----------
  const response = useResponseMode(readParam("storm"), readParam("t"));
  const [layersOpen, setLayersOpen] = useState(true);
  const [respPanelOpen, setRespPanelOpen] = useState(true);
  const { clearZone } = response;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (mode === "response") clearZone();
      else if (popup) setPopup(null);
      else if (selectedId) setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, popup, selectedId, clearZone]);

  const radarMonth = radarOn ? radar.value : null;

  // Savings follow exactly the matches shown in the list (tier filters apply).
  const shownOverlaps = useMemo(() => ranked.map((r) => r.overlap), [ranked]);
  const costRanges = useMemo(
    () => (plan?.costRanges ? new Map(plan.costRanges.map((r) => [r.overlapId, r])) : null),
    [plan],
  );
  const savings = useMemo(() => summarizeSavings(shownOverlaps, costRanges), [shownOverlaps, costRanges]);
  const savingsYears = useMemo(
    () => savingsByYear(shownOverlaps, projectsById, costRanges),
    [shownOverlaps, projectsById, costRanges],
  );
  const savingsAssumptions = useMemo(() => {
    const seen = new Set<string>();
    for (const o of shownOverlaps) for (const a of o.cost?.assumptions ?? []) seen.add(a);
    return [...seen].slice(0, 6);
  }, [shownOverlaps]);

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
  const padding = useMemo<MapPadding>(() => {
    const base = { top: GUTTER + TOP_BAR + 32, bottom: BOTTOM_BAR + ATTRIBUTION_CLEARANCE + 32 };
    if (mode === "response") {
      return {
        ...base,
        left: layersOpen ? GUTTER + LAYERS_W + 32 : 48,
        right: respPanelOpen ? GUTTER + RESPONSE_W + 32 : 48,
      };
    }
    return {
      ...base,
      left: leftOpen ? GUTTER + LEFT_W + 32 : 48,
      right: drawerOpen ? GUTTER + DRAWER_W + 32 : keyOpen ? GUTTER + KEY_W + 32 : 48,
    };
  }, [mode, leftOpen, drawerOpen, keyOpen, layersOpen, respPanelOpen]);

  const status =
    mode === "plan"
      ? {
          loading: planState.status === "loading",
          files: planState.status === "ready" ? planState.files : null,
          generatedAt: plan?.meta.generatedAt ?? null,
        }
      : {
          loading: !response.files && !response.error,
          files: response.files,
          generatedAt: response.data?.meta.generatedAt ?? null,
        };

  const subtitle =
    mode === "plan"
      ? "Where Dominion Energy and Georgia Power plan to build near each other"
      : response.data
        ? `Hurricane ${response.data.storm.name} (${response.data.storm.year}) crossing both service areas`
        : "Storm replay";

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-paper">
      <MapStage
        mode={mode}
        plan={planScene}
        response={response.scene}
        popup={mapPopup}
        view={mode === "plan" ? effectiveView : response.view}
        padding={padding}
      />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute" style={{ top: GUTTER, left: GUTTER, right: GUTTER }}>
          <TopBar mode={mode} onMode={setMode} status={status} subtitle={subtitle} onHelp={howTo.open} />
        </div>

        {howTo.visible ? (
          <div
            className="pointer-events-auto absolute left-1/2 z-40 -translate-x-1/2"
            style={{ top: GUTTER * 2 + TOP_BAR + 24 }}
          >
            <HowToCard mode={mode} onDismiss={howTo.dismiss} />
          </div>
        ) : null}

        {mode === "plan" ? (
          <>
            {leftOpen ? (
              <div
                className="gs-in-left pointer-events-auto absolute flex flex-col gap-3"
                style={{ top: GUTTER * 2 + TOP_BAR, left: GUTTER, bottom: GUTTER, width: LEFT_W }}
              >
                <div className="min-h-0 flex-1">
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
                    ranges={costRanges}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLeftOpen(true)}
                className="glass gs-fade pointer-events-auto absolute flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-ink"
                style={{ top: GUTTER * 2 + TOP_BAR, left: GUTTER }}
              >
                <PanelLeftOpen size={16} aria-hidden className="text-ink-2" />
                Where their work collides
                <span className="num text-ink-3">{ranked.length}</span>
              </button>
            )}

            <div
              className="pointer-events-none absolute flex flex-col gap-3"
              style={{
                top: GUTTER * 2 + TOP_BAR,
                right: drawerOpen ? GUTTER * 2 + DRAWER_W : GUTTER,
                bottom: ATTRIBUTION_CLEARANCE + BOTTOM_BAR + 12,
                width: KEY_W,
              }}
            >
              {/* The pair drawer shows its own savings; the overall card returns when it closes. */}
              {plan && !drawerOpen ? (
                <div className="pointer-events-auto shrink-0">
                  <SavingsCard
                    summary={savings}
                    byYear={savingsYears}
                    radarYear={radarMonth == null ? null : RADAR_START_YEAR + Math.floor(radarMonth / 12)}
                    assumptions={savingsAssumptions}
                  />
                </div>
              ) : null}
              {/* Mounted with the data so its URL-dependent open state never differs from the server render. */}
              {plan ? (
                <MapKey
                  open={keyOpen}
                  onToggle={() => setKeyOpen((v) => !v)}
                  rows={PLAN_KEY}
                  subtitle="Every colour and line style on the map, in plain words."
                />
              ) : null}
            </div>

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
                  ranges={costRanges}
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
        ) : (
          <>
            {layersOpen ? (
              <div
                className="gs-in-left pointer-events-auto absolute flex flex-col"
                style={{ top: GUTTER * 2 + TOP_BAR, left: GUTTER, bottom: GUTTER + 140 }}
              >
                <LayersPanel
                  visible={response.visible}
                  onToggle={response.toggleLayer}
                  onCollapse={() => setLayersOpen(false)}
                  hasActuals={!!response.data?.counties.some((c) => c.actualPeakOut != null)}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLayersOpen(true)}
                className="glass gs-fade pointer-events-auto absolute flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-ink"
                style={{ top: GUTTER * 2 + TOP_BAR, left: GUTTER }}
              >
                <PanelLeftOpen size={16} aria-hidden className="text-ink-2" />
                What you&apos;re seeing
              </button>
            )}

            {respPanelOpen ? (
              <div
                className="gs-in-right pointer-events-auto absolute"
                style={{ top: GUTTER * 2 + TOP_BAR, right: GUTTER, bottom: ATTRIBUTION_CLEARANCE }}
              >
                <ResponsePanel
                  storms={response.storms}
                  stormId={response.stormId}
                  onStorm={response.pickStorm}
                  data={response.data}
                  loading={response.loading}
                  selectedZoneId={response.selectedZoneId}
                  onZone={response.selectZone}
                  onYard={response.flyToYard}
                  onCollapse={() => setRespPanelOpen(false)}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRespPanelOpen(true)}
                className="glass gs-fade pointer-events-auto absolute flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-ink"
                style={{ top: GUTTER * 2 + TOP_BAR, right: GUTTER }}
              >
                <PanelRightOpen size={16} aria-hidden className="text-ink-2" />
                Storm details
              </button>
            )}

            {response.data && response.times.length > 1 ? (
              <div
                className="pointer-events-auto absolute"
                style={{
                  left: layersOpen ? GUTTER * 2 + LAYERS_W : GUTTER,
                  right: respPanelOpen ? GUTTER * 2 + RESPONSE_W : GUTTER,
                  bottom: ATTRIBUTION_CLEARANCE,
                  transition: "left 220ms ease, right 220ms ease",
                }}
              >
                <div className="mx-auto max-w-[880px]">
                  <StormScrubber
                    storm={response.data.storm}
                    times={response.times}
                    value={response.replay.value}
                    playing={response.replay.playing}
                    onSeek={response.replay.seek}
                    onToggle={response.replay.toggle}
                  />
                </div>
              </div>
            ) : null}

            {response.error ? <ErrorCard message={response.error.message} onRetry={response.error.retry} /> : null}
          </>
        )}
      </div>
    </main>
  );
}

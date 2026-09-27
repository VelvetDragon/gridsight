"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { FALLBACK_IDS } from "@/lib/catalog";
import { UTILITY_NAME } from "@/lib/theme";
import { setUrlParams, useUrlParam } from "@/lib/useUrlState";
import { FindUtility } from "../crosswire/FindUtility";
import { useCrosswire } from "../crosswire/useCrosswire";
import { CrosswireAgent } from "../crosswire/CrosswireAgent";
import type { MapPadding } from "../map/MapCanvas";
import type { PlanSceneProps } from "../map/planScene";
import { MapKey, planKeyRows } from "../MapKey";
import { AppShell, NAV_H, NAV_TOP } from "../shell/AppShell";
import { cx, Panel, SegmentedControl } from "../ui/primitives";
import { ErrorCard } from "../ui/states";
import { BoardHeader } from "./BoardHeader";
import { Inspector } from "./Inspector";
import { PairTimeline } from "./PairTimeline";

const MapStage = dynamic(() => import("../map/MapStage"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" />,
});

type Split = "map" | "even" | "list";

/**
 * How the middle column shares its height. "map" folds the table to its toolbar
 * (which keeps this switch and the timeline controls), "list" hides the map.
 */
const SPLIT: Record<Split, { map: string; list: string }> = {
  map: { map: "lg:flex-1", list: "lg:shrink-0" },
  // 63:37, so the table gets 37% of the column.
  even: { map: "lg:flex-[63_1_0%]", list: "lg:min-h-[160px] lg:flex-[37_1_0%]" },
  list: { map: "lg:hidden", list: "lg:flex-1" },
};

/** The board tucks in close under the nav. */
const BOARD_TOP = NAV_TOP + NAV_H + 4;

const PADDING: MapPadding = { top: 40, right: 32, bottom: 32, left: 32 };

/** The key sits under MapStage's 3D button (top: PADDING.top - 16, 32px tall) and above the attribution. */
const KEY_TOP = PADDING.top - 16 + 32 + 8;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/**
 * Crosswire as a board: the pair of utilities and the four kinds of pair across
 * the top; where (map) above when (a pairs table drawn on a calendar) in the
 * middle; and a reading column on the right that always has the full height.
 */
export function CrossBoard() {
  const cw = useCrosswire();
  const [split, setSplit] = useState<Split>("even");
  const [finderOpen, setFinderOpen] = useState(false);
  // ?find=1 (linked from the Switchboard) opens "Find another utility" straight away.
  const findLinked = useUrlParam("find") === "1" && cw.findAvailable;
  const [keyOpen, setKeyOpen] = useState(false);
  const { clearMatch, selectOverlap, selected, ranked } = cw;

  // Esc closes the pair; J and K step down and up the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === "Escape" && selected) clearMatch();
      if (e.key !== "j" && e.key !== "k") return;
      if (!ranked.length) return;
      const i = selected ? ranked.findIndex((r) => r.overlap.id === selected.overlap.id) : -1;
      const next = e.key === "j" ? Math.min(ranked.length - 1, i + 1) : Math.max(0, i - 1);
      if (next !== i) selectOverlap(ranked[next].overlap.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearMatch, selectOverlap, selected, ranked]);

  const isDefaultPair =
    !!cw.bundle &&
    [cw.bundle.you.id, cw.bundle.neighbor.id].sort().join() === [FALLBACK_IDS.DESC, FALLBACK_IDS.GPC].sort().join();

  const planScene = useMemo<PlanSceneProps | null>(
    () =>
      cw.plan
        ? {
            data: cw.plan,
            ranked: cw.ranked,
            projectsById: cw.projectsById,
            selectedId: cw.selected?.overlap.id ?? null,
            radarMonth: cw.radarMonth,
            selectedProjects: cw.selectedProjects,
            reach: cw.reach,
            showStateLabels: isDefaultPair,
            onSelectOverlap: cw.selectOverlap,
            onProjectClick: (p, _at, additive) => cw.toggleProject(p.id, additive),
            onEmptyClick: () => {},
          }
        : null,
    // cw.* callbacks are stable; the data pieces drive rebuilds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cw.plan, cw.ranked, cw.projectsById, cw.selected, cw.radarMonth, cw.selectedProjects, cw.reach, isDefaultPair],
  );

  return (
    <AppShell>
      <main
        className="relative flex min-h-dvh w-full flex-col gap-2 bg-paper px-3 pb-3 lg:h-dvh lg:overflow-hidden"
        style={{ paddingTop: BOARD_TOP }}
      >
        <h1 className="sr-only">Crosswire</h1>
        <Panel className="edge-shine relative z-30 shrink-0 px-3 py-2" aria-label="Which utilities">
          <BoardHeader cw={cw} onFind={cw.findAvailable ? () => setFinderOpen(true) : null} />
          {finderOpen || findLinked || cw.finding ? (
            <div className="mt-2 max-w-[520px]">
              <FindUtility
                cw={cw}
                onClose={() => {
                  setFinderOpen(false);
                  setUrlParams({ find: null });
                  cw.cancelFind();
                }}
              />
            </div>
          ) : null}
        </Panel>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="flex min-h-0 flex-col gap-2">
            <section
              aria-label="Map of both plans"
              className={cx(
                "relative h-[55vh] shrink-0 overflow-hidden rounded-[16px] border border-hairline shadow-[var(--shadow-panel)] lg:h-auto lg:min-h-[180px]",
                SPLIT[split].map,
              )}
            >
              <MapStage
                mode="plan"
                plan={planScene}
                response={null}
                popup={null}
                view={cw.view}
                padding={PADDING}
                keepFramedOnResize
              />
              {cw.plan ? (
                <div
                  className="pointer-events-none absolute right-2 bottom-9 z-20 flex max-w-[calc(100%-16px)] flex-col items-end"
                  style={{ top: KEY_TOP }}
                >
                  <MapKey
                    open={keyOpen}
                    onToggle={() => setKeyOpen((v) => !v)}
                    rows={planKeyRows({ you: UTILITY_NAME.DESC, neighbor: UTILITY_NAME.GPC }, isDefaultPair)}
                  />
                </div>
              ) : null}
              <CrosswireAgent cw={cw} />
              <p className="pointer-events-none absolute bottom-2.5 left-3 z-10 rounded-full bg-white/85 px-2.5 py-1 text-[12px] text-ink-2">
                Click a line to pick it; shift-click to pick several
              </p>
            </section>
            <Panel className={cx("min-h-[260px] overflow-hidden lg:min-h-0", SPLIT[split].list)}>
              <PairTimeline
                cw={cw}
                collapsed={split === "map"}
                toolbar={
                  <div className="hidden items-center gap-2 lg:flex">
                    <span className="text-[12px] text-ink-3">
                      <kbd className="rounded-[4px] border border-hairline px-1 text-[10px]">J</kbd>{" "}
                      <kbd className="rounded-[4px] border border-hairline px-1 text-[10px]">K</kbd> to step
                    </span>
                    <SegmentedControl<Split>
                      label="Show the map, the table or both"
                      value={split}
                      onChange={setSplit}
                      options={[
                        { value: "map", label: "Map", hint: "Map only; the table folds to this bar" },
                        { value: "even", label: "Both", hint: "Map above, table below" },
                        { value: "list", label: "List", hint: "Table only; hide the map" },
                      ]}
                    />
                  </div>
                }
              />
            </Panel>
          </div>

          <Panel className="min-h-[420px] overflow-hidden lg:min-h-0" aria-label="Details">
            <Inspector cw={cw} />
          </Panel>
        </div>

        {cw.catalogError ? <ErrorCard message={cw.catalogError} onRetry={cw.retryCatalog} /> : null}
        {cw.pairError ? <ErrorCard message={cw.pairError} onRetry={cw.retryPair} /> : null}
      </main>
    </AppShell>
  );
}

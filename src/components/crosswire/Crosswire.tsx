"use client";

import dynamic from "next/dynamic";
import { Layers, ListOrdered } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FALLBACK_IDS } from "@/lib/catalog";
import { UTILITY_NAME } from "@/lib/theme";
import type { MapPadding } from "../map/MapCanvas";
import type { PlanSceneProps } from "../map/planScene";
import { KeyList, planKeyRows } from "../MapKey";
import { RadarBar } from "../plan/RadarBar";
import { AppShell, NAV_CLEARANCE } from "../shell/AppShell";
import { NAV } from "../shell/nav";
import { Rail, railInset, RAIL_GUTTER, type RailSection } from "../shell/Rail";
import { ErrorCard } from "../ui/states";
import { PairDetail } from "./PairDetail";
import { PairsSection } from "./PairsSection";
import { useCrosswire } from "./useCrosswire";
import { UtilityPicker } from "./UtilityPicker";

const MapStage = dynamic(() => import("../map/MapStage"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" />,
});

const RADAR_H = 72;

function FindUtility({ cw, onClose }: { cw: ReturnType<typeof useCrosswire>; onClose: () => void }) {
  const [q, setQ] = useState(cw.finding?.query ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) cw.find(q.trim());
  };
  if (cw.finding?.status === "working") {
    return (
      <div className="rounded-[12px] border border-hairline bg-white/60 p-3" role="status" aria-live="polite">
        <p className="text-[14px] text-ink">Looking for {cw.finding.query}&apos;s public plan…</p>
        <p className="mt-1 text-[12px] text-ink-3">
          Reading filings and placing each project on the map. This can take a minute.
        </p>
        <div className="gs-skeleton mt-3 h-1.5 w-full" />
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="rounded-[12px] border border-hairline bg-white/60 p-3">
      <label className="text-[13px] font-medium text-ink" htmlFor="find-utility">
        Which utility should we look up?
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="find-utility"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Entergy Mississippi"
          className="h-9 min-w-0 flex-1 rounded-[8px] border border-hairline-strong bg-white px-2.5 text-[14px] outline-none focus:border-ink-2"
        />
        <button type="submit" className="h-9 rounded-[8px] bg-ink px-3 text-[13px] font-medium text-white">
          Find
        </button>
      </div>
      {cw.finding?.status === "failed" ? <p className="mt-2 text-[12px] text-alert">{cw.finding.error}</p> : null}
      <button type="button" onClick={onClose} className="mt-2 text-[12px] text-ink-3 underline underline-offset-2">
        Never mind
      </button>
    </form>
  );
}

/** Crosswire: where two utilities' plans cross, on the map and on the calendar. */
export function Crosswire() {
  const cw = useCrosswire();
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState("pairs");
  const [finderOpen, setFinderOpen] = useState(false);
  const { clearMatch, selected } = cw;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selected) clearMatch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearMatch, selected]);

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

  const padding = useMemo<MapPadding>(
    () => ({ top: NAV_CLEARANCE + 24, bottom: RADAR_H + 56, left: railInset(open), right: 48 }),
    [open],
  );

  const you = cw.catalog?.utilities.find((u) => u.id === cw.pairIds?.[0]) ?? null;
  const neighbor = cw.catalog?.utilities.find((u) => u.id === cw.pairIds?.[1]) ?? null;

  const header = cw.catalog ? (
    <div className="flex flex-col gap-3">
      <UtilityPicker
        utilities={cw.catalog.utilities}
        you={you}
        neighbor={neighbor}
        onChange={cw.setPair}
        onFind={cw.findAvailable ? () => setFinderOpen(true) : null}
      />
      {finderOpen || cw.finding ? (
        <FindUtility
          cw={cw}
          onClose={() => {
            setFinderOpen(false);
            cw.cancelFind();
          }}
        />
      ) : null}
      {cw.plan ? (
        <p className="text-[13px] leading-[19px] text-ink-2">
          {cw.plan.meta.projectCount.DESC} {UTILITY_NAME.DESC} projects and {cw.plan.meta.projectCount.GPC}{" "}
          {UTILITY_NAME.GPC} projects; <span className="font-medium text-ink">{cw.plan.overlaps.length} pairs</span>{" "}
          come within 40 km.{" "}
          <Link
            href={`/data?tab=overlaps&you=${cw.bundle?.you.id ?? ""}&neighbor=${cw.bundle?.neighbor.id ?? ""}`}
            className="underline underline-offset-2 hover:text-ink"
          >
            See them in The Ledger
          </Link>
        </p>
      ) : (
        <div className="gs-skeleton h-4 w-3/4" />
      )}
    </div>
  ) : (
    <div className="gs-skeleton h-24" />
  );

  const sections: RailSection[] = [
    {
      id: "pairs",
      label: cw.selected ? "Pair" : "Pairs",
      icon: <ListOrdered size={15} aria-hidden />,
      content: cw.selected ? <PairDetail cw={cw} /> : <PairsSection cw={cw} />,
    },
    {
      id: "key",
      label: "Map key",
      icon: <Layers size={15} aria-hidden />,
      content: (
        <div className="px-5 py-4">
          <KeyList rows={planKeyRows({ you: UTILITY_NAME.DESC, neighbor: UTILITY_NAME.GPC }, isDefaultPair)} />
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <main className="relative h-dvh w-full overflow-hidden bg-paper">
        <MapStage mode="plan" plan={planScene} response={null} popup={null} view={cw.view} padding={padding} />
        <Rail
          title={NAV[1].name}
          tagline={NAV[1].tagline}
          sections={sections}
          active={cw.selected ? "pairs" : active}
          onActive={setActive}
          open={open}
          onOpen={setOpen}
          header={header}
        />
        {cw.plan ? (
          <div
            className="fixed z-20"
            style={{ left: railInset(open) - 12, right: RAIL_GUTTER + 4, bottom: 34, transition: "left 220ms ease" }}
          >
            <div className="mx-auto max-w-[820px]">
              <RadarBar
                projects={cw.plan.projects}
                ranked={cw.ranked}
                projectsById={cw.projectsById}
                enabled={cw.radarOn}
                month={cw.radar.value}
                playing={cw.radar.playing}
                onSeek={cw.radar.seek}
                onToggle={cw.radar.toggle}
                onEnabled={(on) => {
                  cw.setRadarOn(on);
                  if (!on) cw.radar.pause();
                }}
              />
            </div>
          </div>
        ) : null}
        {cw.catalogError ? <ErrorCard message={cw.catalogError} onRetry={cw.retryCatalog} /> : null}
        {cw.pairError ? <ErrorCard message={cw.pairError} onRetry={cw.retryPair} /> : null}
      </main>
    </AppShell>
  );
}

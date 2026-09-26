"use client";

import { ArrowDown, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { fmtKm, shortProjectName } from "@/lib/format";
import type { RankedOverlap } from "@/lib/ranking";
import { matchSavings } from "@/lib/savings";
import { TIER_LABEL, UTILITY_HEX } from "@/lib/theme";
import { monthIndex, monthLabel, phaseAt, RADAR_END_YEAR, RADAR_MONTHS, RADAR_START_YEAR, windowOverlap } from "@/lib/timeline";
import type { Project } from "@/lib/types";
import type { CrosswireState } from "../crosswire/useCrosswire";
import { fmtMoney } from "../plan/Savings";
import { cx, TierSwatch } from "../ui/primitives";
import { EmptyState, SkeletonRows } from "../ui/states";

type SortKey = "rank" | "savings" | "distance";

const SORTS: { key: SortKey; label: string; hint: string }[] = [
  { key: "rank", label: "Rank", hint: "Best first, by the ranking in the side panel" },
  { key: "distance", label: "Apart", hint: "Closest first" },
  { key: "savings", label: "Could save", hint: "Biggest likely saving first" },
];

/** Shared by the header and every row so the columns line up. */
const GRID =
  "grid grid-cols-[40px_minmax(0,1fr)_64px_84px] md:grid-cols-[40px_minmax(200px,1fr)_64px_84px_minmax(240px,1.35fr)]";

const YEARS: number[] = [];
for (let y = RADAR_START_YEAR; y <= RADAR_END_YEAR; y++) YEARS.push(y);

const pct = (month: number) => `${(Math.min(RADAR_MONTHS, Math.max(0, month)) / RADAR_MONTHS) * 100}%`;

function windowSpan(w: [string, string] | null): [number, number] | null {
  if (!w) return null;
  const s = Math.max(0, monthIndex(w[0]));
  const e = Math.min(RADAR_MONTHS, monthIndex(w[1]));
  return e > s ? [s, e] : null;
}

/** The ruler above the timeline column: click or drag to move the construction radar. */
function Ruler({ cw }: { cw: CrosswireState }) {
  const ref = useRef<HTMLDivElement>(null);
  const month = cw.radarMonth;
  const seekAt = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const m = Math.round(((clientX - r.left) / r.width) * (RADAR_MONTHS - 1));
    if (!cw.radarOn) cw.setRadarOn(true);
    cw.radar.seek(Math.min(RADAR_MONTHS - 1, Math.max(0, m)));
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, PageDown: -12, PageUp: 12 }[e.key];
    if (step == null) return;
    e.preventDefault();
    if (!cw.radarOn) cw.setRadarOn(true);
    cw.radar.seek(Math.min(RADAR_MONTHS - 1, Math.max(0, (month ?? 0) + step)));
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Month on the timeline"
      aria-valuemin={0}
      aria-valuemax={RADAR_MONTHS - 1}
      aria-valuenow={month ?? 0}
      aria-valuetext={month == null ? "All years" : monthLabel(month)}
      title="Click or drag to see what is being built in a given month"
      onKeyDown={onKey}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        cw.radar.pause();
        seekAt(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e.clientX);
      }}
      className="relative h-full cursor-ew-resize touch-none select-none"
    >
      {YEARS.map((y) => (
        <span
          key={y}
          className="num absolute top-1/2 -translate-y-1/2 border-l border-hairline-strong pl-1 text-[11px] leading-4 text-ink-3"
          style={{ left: pct((y - RADAR_START_YEAR) * 12) }}
        >
          {(y - RADAR_START_YEAR) % 2 === 0 ? y : `’${String(y).slice(2)}`}
        </span>
      ))}
      {month != null ? (
        <span
          aria-hidden
          className="num absolute top-0 bottom-0 z-10 flex -translate-x-1/2 items-center rounded-[6px] bg-ink px-1.5 text-[11px] font-medium text-white"
          style={{ left: pct(month + 0.5) }}
        >
          {monthLabel(month)}
        </span>
      ) : null}
    </div>
  );
}

function Bars({ desc, gpc, month }: { desc: Project | undefined; gpc: Project | undefined; month: number | null }) {
  const a = windowSpan(desc?.buildWindow ?? null);
  const b = windowSpan(gpc?.buildWindow ?? null);
  const shared = windowSpan(windowOverlap(desc?.buildWindow ?? null, gpc?.buildWindow ?? null));
  if (!a && !b) return <span className="text-[12px] text-ink-3">Build dates not published</span>;
  return (
    <div className="relative h-full w-full" aria-hidden>
      {YEARS.map((y) => (
        <span
          key={y}
          className="absolute top-0 bottom-0 w-px bg-hairline"
          style={{ left: pct((y - RADAR_START_YEAR) * 12) }}
        />
      ))}
      {shared ? (
        <span
          className="absolute top-[7px] bottom-[7px] rounded-[4px] border border-dashed border-hairline-strong bg-wash-2"
          style={{ left: pct(shared[0]), width: pct(shared[1] - shared[0]) }}
        />
      ) : null}
      {a ? (
        <span
          className="absolute top-[14px] h-[6px] rounded-full"
          style={{ left: pct(a[0]), width: pct(a[1] - a[0]), minWidth: 3, background: UTILITY_HEX.DESC }}
        />
      ) : null}
      {b ? (
        <span
          className="absolute bottom-[14px] h-[6px] rounded-full"
          style={{ left: pct(b[0]), width: pct(b[1] - b[0]), minWidth: 3, background: UTILITY_HEX.GPC }}
        />
      ) : null}
      {month != null ? (
        <span className="absolute top-0 bottom-0 w-[1.5px] bg-ink" style={{ left: pct(month + 0.5) }} />
      ) : null}
    </div>
  );
}

function Row({ cw, r, onDeck }: { cw: CrosswireState; r: RankedOverlap; onDeck: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const o = r.overlap;
  const desc = cw.projectsById.get(o.descId);
  const gpc = cw.projectsById.get(o.gpcId);
  const saved = matchSavings(o, cw.costRanges);
  const selected = cw.selected?.overlap.id === o.id;
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={() => (selected ? cw.clearMatch() : cw.selectOverlap(o.id))}
        aria-current={selected ? "true" : undefined}
        className={cx(
          GRID,
          "min-h-[56px] w-full items-center gap-x-3 border-b border-hairline px-4 text-left transition-colors",
          selected ? "bg-white shadow-[inset_3px_0_0_var(--ink)]" : "hover:bg-white/60",
        )}
      >
        <span className="flex flex-col items-start gap-1">
          <span className="display text-[15px] leading-5 font-medium text-ink">{r.rank}</span>
          <span title={TIER_LABEL[o.tier]}>
            <TierSwatch tier={o.tier} size={8} />
          </span>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 py-2">
          {[
            { p: desc, id: o.descId, u: "DESC" as const },
            { p: gpc, id: o.gpcId, u: "GPC" as const },
          ].map(({ p, id, u }) => (
            <span key={u} className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="h-3 w-[3px] shrink-0 rounded-full" style={{ background: UTILITY_HEX[u] }} />
              <span className="truncate text-[13px] leading-[18px] text-ink" title={p?.name ?? id}>
                {p ? shortProjectName(p.name) : id}
              </span>
            </span>
          ))}
          {onDeck ? (
            <span className="mt-0.5 w-fit rounded-full bg-ink px-2 text-[11px] leading-[18px] font-medium text-white">
              Both building now
            </span>
          ) : null}
        </span>
        <span className="num text-right text-[13px] text-ink-2">{o.distanceKm <= 0 ? "Touch" : fmtKm(o.distanceKm)}</span>
        <span className="num text-right text-[13px] font-medium text-ink">
          {saved && saved.central > 0 ? fmtMoney(saved.central) : <span className="font-normal text-ink-3">–</span>}
        </span>
        <span className="hidden h-[56px] md:block">
          <Bars desc={desc} gpc={gpc} month={cw.radarMonth} />
        </span>
      </button>
    </li>
  );
}

/**
 * Every pair as one row of a table, with its two build windows drawn on a
 * shared 2026–2035 calendar. The list and the calendar are the same thing,
 * so "where" (the map above) and "when" (here) never drift apart.
 */
export function PairTimeline({
  cw,
  toolbar,
  collapsed = false,
}: {
  cw: CrosswireState;
  toolbar?: ReactNode;
  /** Only the toolbar: the rows and their ruler are folded away. */
  collapsed?: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("rank");
  const rows = useMemo(() => {
    const list = [...cw.ranked];
    const saved = (r: RankedOverlap) => matchSavings(r.overlap, cw.costRanges)?.central ?? 0;
    if (sort === "distance") list.sort((a, b) => a.overlap.distanceKm - b.overlap.distanceKm || a.rank - b.rank);
    if (sort === "savings") list.sort((a, b) => saved(b) - saved(a) || a.rank - b.rank);
    return list;
  }, [cw.ranked, cw.costRanges, sort]);

  const month = cw.radarMonth;
  const both = (r: RankedOverlap) => {
    if (month == null) return false;
    const a = cw.projectsById.get(r.overlap.descId);
    const b = cw.projectsById.get(r.overlap.gpcId);
    return !!a && !!b && phaseAt(a, month) === "building" && phaseAt(b, month) === "building";
  };
  const buildingNow = month == null ? 0 : rows.filter(both).length;

  return (
    <section aria-label="Pairs and when they are built" className="flex h-full min-h-0 flex-col">
      <div
        className={cx(
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5",
          !collapsed && "border-b border-hairline",
        )}
      >
        <h2 className="text-[14px] font-semibold text-ink">
          {cw.ranked.length} {cw.ranked.length === 1 ? "pair" : "pairs"}
        </h2>
        <button
          type="button"
          onClick={() => {
            if (!cw.radarOn) cw.setRadarOn(true);
            cw.radar.toggle();
          }}
          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-hairline-strong bg-white/80 px-2.5 text-[12px] font-medium text-ink hover:bg-white"
        >
          {cw.radar.playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
          {cw.radar.playing ? "Pause" : "Play 2026–2035"}
        </button>
        <p className="text-[12px] leading-4 text-ink-3" aria-live="polite">
          {month == null ? (
            "Drag along the years to see what is built when."
          ) : (
            <>
              <span className="font-medium text-ink">{monthLabel(month)}</span>:{" "}
              <span className="num">{buildingNow}</span> {buildingNow === 1 ? "pair" : "pairs"} building at the same
              time.{" "}
              <button
                type="button"
                onClick={() => {
                  cw.radar.pause();
                  cw.setRadarOn(false);
                }}
                className="underline underline-offset-2 hover:text-ink"
              >
                Show all years
              </button>
            </>
          )}
        </p>
        <div className="ml-auto">{toolbar}</div>
      </div>

      {collapsed ? null : (
        <>
          <div className={cx(GRID, "h-9 shrink-0 items-center gap-x-3 border-b border-hairline px-4")}>
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={sort === s.key}
                onClick={() => setSort(s.key)}
                title={`Sort by ${s.label.toLowerCase()}: ${s.hint.toLowerCase()}`}
                className={cx(
                  "flex items-center gap-1 text-[12px] font-medium whitespace-nowrap transition-colors",
                  s.key === "rank" && "col-start-1",
                  s.key === "distance" && "col-start-3 justify-end",
                  s.key === "savings" && "col-start-4 justify-end",
                  sort === s.key ? "text-ink" : "text-ink-3 hover:text-ink",
                )}
              >
                {s.label}
                {sort === s.key ? <ArrowDown size={11} aria-hidden /> : null}
              </button>
            ))}
            <span className="col-start-2 row-start-1 text-[12px] font-medium text-ink-3">Projects</span>
            <div className="col-start-5 row-start-1 hidden h-full md:block">
              <Ruler cw={cw} />
            </div>
          </div>

          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
            {!cw.plan ? (
              <div className="p-4">
                <SkeletonRows rows={6} />
              </div>
            ) : !rows.length ? (
              <EmptyState
                title={cw.selectedProjects.size ? "Nothing collides with your picks" : "No pairs of this kind"}
                body={
                  cw.selectedProjects.size
                    ? "None of the other utility's planned work comes within 40 km of what you picked."
                    : "Turn a kind back on at the top to see those pairs."
                }
              />
            ) : (
              <ol>
                {rows.map((r) => (
                  <Row key={r.overlap.id} cw={cw} r={r} onDeck={both(r)} />
                ))}
              </ol>
            )}
          </div>
        </>
      )}
    </section>
  );
}

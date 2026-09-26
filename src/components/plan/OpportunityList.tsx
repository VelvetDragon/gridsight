"use client";

import { Check, ChevronDown, PanelLeftClose, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PlanData } from "@/lib/data";
import { fmtKm, fmtMonths, fmtUsd } from "@/lib/format";
import { isRightSizingCandidate } from "@/lib/plan";
import { DEFAULT_WEIGHTS, type RankedOverlap, type RankWeights } from "@/lib/ranking";
import { TIER_LABEL, TIER_RANGE, TIERS } from "@/lib/theme";
import type { OverlapTier, Project } from "@/lib/types";
import { EmptyState, SkeletonRows } from "../ui/states";
import { cx, Eyebrow, IconButton, Panel, Slider, TierChip, TierSwatch, UtilityDot } from "../ui/primitives";
import { RightSizingChip } from "./RightSizing";

export interface OpportunityListProps {
  data: PlanData | null;
  ranked: RankedOverlap[];
  projectsById: Map<string, Project>;
  tiers: Set<OverlapTier>;
  onToggleTier: (t: OverlapTier) => void;
  weights: RankWeights;
  onWeights: (w: RankWeights) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCollapse: () => void;
}

export function OpportunityList(props: OpportunityListProps) {
  const { data, ranked, tiers, onToggleTier, weights, onWeights, selectedId, onSelect, onCollapse } = props;
  const [showWeights, setShowWeights] = useState(false);

  const tierCounts = new Map<OverlapTier, number>();
  for (const o of data?.overlaps ?? []) tierCounts.set(o.tier, (tierCounts.get(o.tier) ?? 0) + 1);

  return (
    <Panel className="flex h-full w-[360px] flex-col overflow-hidden" aria-label="Coordination opportunities">
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3">
        <div>
          <Eyebrow>Coordination opportunities</Eyebrow>
          {data ? (
            <p className="mt-1 text-[13px] leading-5 text-ink-2">
              <span className="num text-ink">{data.overlaps.length}</span> project pairs within 40 km, from{" "}
              <span className="num">{data.meta.pairsCompared}</span> compared
            </p>
          ) : (
            <div className="gs-skeleton mt-2 h-3.5 w-52" />
          )}
        </div>
        <IconButton label="Collapse panel" onClick={onCollapse} className="-mt-1 -mr-1.5">
          <PanelLeftClose size={16} />
        </IconButton>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pb-3" role="group" aria-label="Filter by tier">
        {TIERS.map((t) => {
          const on = tiers.has(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => onToggleTier(t)}
              title={`${TIER_LABEL[t]}: ${TIER_RANGE[t]}`}
              className={cx(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
                on
                  ? "border-hairline-strong bg-white text-ink shadow-[0_1px_1px_rgba(20,22,28,0.05)]"
                  : "border-transparent bg-wash text-ink-3 hover:text-ink-2",
              )}
            >
              <span className={cx("transition-opacity", !on && "opacity-40")}>
                <TierSwatch tier={t} size={8} />
              </span>
              {TIER_LABEL[t]}
              <span className="num text-[11px] text-ink-3">{tierCounts.get(t) ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="border-y border-hairline">
        <button
          type="button"
          aria-expanded={showWeights}
          onClick={() => setShowWeights((v) => !v)}
          className="flex h-9 w-full items-center gap-2 px-4 text-left text-[13px] text-ink-2 transition-colors hover:bg-wash"
        >
          <SlidersHorizontal size={14} aria-hidden className="text-ink-3" />
          Ranking weights
          <span className="num ml-auto text-[12px] text-ink-3">
            {weights.distance}/{weights.timeline}
          </span>
          <ChevronDown
            size={14}
            aria-hidden
            className={cx("text-ink-3 transition-transform duration-200", showWeights && "rotate-180")}
          />
        </button>
        {showWeights ? (
          <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
            <Slider
              label="Distance"
              value={weights.distance}
              onChange={(v) => onWeights({ ...weights, distance: v })}
            />
            <Slider
              label="Timeline overlap"
              value={weights.timeline}
              onChange={(v) => onWeights({ ...weights, timeline: v })}
            />
            <div className="flex items-center justify-between">
              <p className="text-[12px] leading-4 text-ink-3">Closer and more simultaneous pairs rank higher.</p>
              <button
                type="button"
                onClick={() => onWeights(DEFAULT_WEIGHTS)}
                className="shrink-0 rounded-[6px] px-1.5 text-[12px] font-medium text-ink-2 hover:bg-wash-2"
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {!data ? (
          <SkeletonRows rows={6} />
        ) : ranked.length === 0 ? (
          <EmptyState
            title={data.overlaps.length ? "No pairs in the selected tiers" : "No overlaps found"}
            body={
              data.overlaps.length
                ? "Turn a tier back on to see its coordination opportunities."
                : "None of the planned projects come within 40 km of the other utility's work."
            }
          />
        ) : (
          <ol className="flex flex-col py-1.5">
            {ranked.map((r) => (
              <OpportunityItem
                key={r.overlap.id}
                item={r}
                desc={props.projectsById.get(r.overlap.descId)}
                gpc={props.projectsById.get(r.overlap.gpcId)}
                selected={r.overlap.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </ol>
        )}
      </div>

      {data ? <PanelFooter data={data} onSelect={onSelect} /> : null}
    </Panel>
  );
}

function OpportunityItem({
  item,
  desc,
  gpc,
  selected,
  onSelect,
}: {
  item: RankedOverlap;
  desc: Project | undefined;
  gpc: Project | undefined;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const o = item.overlap;
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <li ref={ref} className="px-2">
      <button
        type="button"
        onClick={() => onSelect(o.id)}
        aria-current={selected ? "true" : undefined}
        className={cx(
          "group relative flex w-full gap-3 rounded-[10px] px-2.5 py-2.5 text-left transition-colors duration-150",
          selected ? "bg-white shadow-[0_0_0_1px_rgba(20,22,28,0.1),0_2px_6px_-2px_rgba(20,22,28,0.12)]" : "hover:bg-wash",
        )}
      >
        <span className={cx("num w-5 shrink-0 pt-px text-[12px]", selected ? "text-ink" : "text-ink-3")}>
          {String(item.rank).padStart(2, "0")}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-col gap-0.5">
            <ProjectName utility="DESC" name={desc?.name ?? o.descId} />
            <ProjectName utility="GPC" name={gpc?.name ?? o.gpcId} />
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <TierChip tier={o.tier} />
            {isRightSizingCandidate(desc, gpc) ? <RightSizingChip compact /> : null}
          </span>
          <span className="grid grid-cols-3 gap-2 pt-0.5">
            <Metric label="Closest" value={fmtKm(o.distanceKm)} />
            <Metric label="Overlap" value={fmtMonths(o.timelineOverlapMonths)} />
            <Metric label="Savings" value={o.cost ? fmtUsd(o.cost.totalUsd) : "–"} />
          </span>
        </span>
      </button>
    </li>
  );
}

function ProjectName({ utility, name }: { utility: "DESC" | "GPC"; name: string }) {
  return (
    <span className="flex items-baseline gap-2" title={name}>
      <span className="translate-y-[-1px]">
        <UtilityDot utility={utility} size={7} />
      </span>
      <span className="line-clamp-1 text-[13px] leading-[18px] text-ink">{name}</span>
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-[11px] leading-4 text-ink-3">{label}</span>
      <span className="num text-[13px] leading-[18px] text-ink">{value}</span>
    </span>
  );
}

function PanelFooter({ data, onSelect }: { data: PlanData; onSelect: (id: string) => void }) {
  return (
    <div className="border-t border-hairline px-4 pt-3 pb-3.5">
      <div className="flex items-center gap-4 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <UtilityDot utility="DESC" />
          DESC <span className="num text-ink-3">{data.meta.projectCount.DESC}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <UtilityDot utility="GPC" />
          Georgia Power <span className="num text-ink-3">{data.meta.projectCount.GPC}</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-ink-3">
          <svg width="18" height="4" aria-hidden>
            <line x1="0" y1="2" x2="18" y2="2" stroke="#5A6070" strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          approx. route
        </span>
      </div>
      {data.meta.knownMatches.length ? (
        <div className="mt-3">
          <Eyebrow className="mb-1">Named overlaps</Eyebrow>
          <ul className="flex flex-col">
            {data.meta.knownMatches.map((k) => (
              <li key={k.label}>
                <button
                  type="button"
                  disabled={!k.overlapId}
                  onClick={() => k.overlapId && onSelect(k.overlapId)}
                  className="flex w-full items-center gap-2 rounded-[6px] py-1 text-left text-[12px] leading-4 text-ink-2 enabled:hover:text-ink"
                >
                  <span
                    className={cx(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                      k.found ? "bg-ink text-white" : "border border-hairline-strong text-ink-3",
                    )}
                    aria-label={k.found ? "found" : "not found"}
                  >
                    {k.found ? <Check size={10} strokeWidth={3} /> : null}
                  </span>
                  <span className="line-clamp-1">{k.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

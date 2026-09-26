"use client";

import { ChevronDown, PanelLeftClose } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PlanData } from "@/lib/data";
import { fmtKm, fmtUsd } from "@/lib/format";
import { isRightSizingCandidate } from "@/lib/plan";
import { DEFAULT_WEIGHTS, type RankedOverlap, type RankWeights } from "@/lib/ranking";
import { TIER_LABEL, TIER_RANGE, TIERS } from "@/lib/theme";
import type { OverlapTier, Project } from "@/lib/types";
import { EmptyState, SkeletonRows } from "../ui/states";
import { CompanyBlock, cx, IconButton, Panel, PanelHeader, Slider, TierChip, TierSwatch } from "../ui/primitives";
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
    <Panel className="flex h-full min-h-0 w-full flex-col overflow-hidden" aria-label="Where their work collides">
      <PanelHeader
        title="Where their work collides"
        subtitle={
          data ? (
            <>
              <span className="num text-ink-2">{data.overlaps.length}</span> pairs of planned projects sit within 40 km
              of each other. Best first; pick one to see it on the map.
            </>
          ) : (
            "Pairs of planned projects that sit close together."
          )
        }
        actions={
          <IconButton label="Collapse panel" onClick={onCollapse}>
            <PanelLeftClose size={16} />
          </IconButton>
        }
      />

      <div className="px-5 pb-3" role="group" aria-label="Show pairs that">
        <div className="mb-2 text-[12px] text-ink-3">Show pairs that</div>
        <div className="grid grid-cols-2 gap-1.5">
          {TIERS.map((t) => {
            const on = tiers.has(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleTier(t)}
                className={cx(
                  "flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-left transition-colors duration-150",
                  on
                    ? "border-hairline-strong bg-white/75 text-ink"
                    : "border-transparent bg-wash text-ink-3 hover:text-ink-2",
                )}
              >
                <span className={cx("transition-opacity", !on && "opacity-35")}>
                  <TierSwatch tier={t} size={9} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-[18px] font-medium">{TIER_LABEL[t]}</span>
                  <span className="block text-[11px] leading-[14px] text-ink-3">{TIER_RANGE[t]}</span>
                </span>
                <span className="num text-[12px] text-ink-3">{tierCounts.get(t) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-y border-hairline">
        <button
          type="button"
          aria-expanded={showWeights}
          onClick={() => setShowWeights((v) => !v)}
          className="flex h-10 w-full items-center gap-2 px-5 text-left text-[13px] text-ink-2 transition-colors hover:bg-wash"
        >
          How the list is ranked
          <span className="ml-auto text-[12px] text-ink-3">
            distance <span className="num">{weights.distance}</span> · timing{" "}
            <span className="num">{weights.timeline}</span>
          </span>
          <ChevronDown
            size={14}
            aria-hidden
            className={cx("text-ink-3 transition-transform duration-200", showWeights && "rotate-180")}
          />
        </button>
        {showWeights ? (
          <div className="flex flex-col gap-3 px-5 pt-1 pb-4">
            <Slider
              label="How close they are"
              value={weights.distance}
              onChange={(v) => onWeights({ ...weights, distance: v })}
            />
            <Slider
              label="How long they build at the same time"
              value={weights.timeline}
              onChange={(v) => onWeights({ ...weights, timeline: v })}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] leading-4 text-ink-3">Closer pairs that build together rank higher.</p>
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
          <SkeletonRows rows={5} />
        ) : ranked.length === 0 ? (
          <EmptyState
            title={data.overlaps.length ? "No pairs of this kind" : "No overlaps found"}
            body={
              data.overlaps.length
                ? "Turn one of the filters above back on to see those pairs."
                : "None of the planned projects come within 40 km of the other company's work."
            }
          />
        ) : (
          <ol className="flex flex-col gap-1 px-3 py-3">
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
        {data?.meta.knownMatches.length ? <KnownMatches data={data} onSelect={onSelect} /> : null}
      </div>
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
    <li ref={ref}>
      <button
        type="button"
        onClick={() => onSelect(o.id)}
        aria-current={selected ? "true" : undefined}
        className={cx(
          "flex w-full flex-col gap-2.5 rounded-[12px] px-3 py-3 text-left transition-colors duration-150",
          selected
            ? "bg-white/85 shadow-[0_0_0_1px_rgba(20,24,30,0.12),0_4px_12px_-4px_rgba(20,24,30,0.14)]"
            : "hover:bg-white/45",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="display text-[15px] font-medium text-ink">#{item.rank}</span>
          <TierChip tier={o.tier} />
          {isRightSizingCandidate(desc, gpc) ? <RightSizingChip compact /> : null}
        </span>
        <span className="flex flex-col gap-2">
          <CompanyBlock utility="DESC" size="sm">
            {desc?.name ?? o.descId}
          </CompanyBlock>
          <CompanyBlock utility="GPC" size="sm">
            {gpc?.name ?? o.gpcId}
          </CompanyBlock>
        </span>
        <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] leading-[17px] text-ink-3">
          <span>
            Distance apart <span className="num text-ink">{fmtKm(o.distanceKm)}</span>
          </span>
          <span>
            Both building{" "}
            <span className={cx(o.timelineOverlapMonths > 0 ? "text-ink" : "text-ink-3")}>
              {o.timelineOverlapMonths > 0 ? (
                <>
                  <span className="num">{Math.round(o.timelineOverlapMonths)}</span> months
                </>
              ) : (
                "not at once"
              )}
            </span>
          </span>
          {o.cost ? (
            <span>
              Could save <span className="num text-ink">{fmtUsd(o.cost.totalUsd)}</span>
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** Overlaps named in the challenge brief, and whether the pipeline found them. */
function KnownMatches({ data, onSelect }: { data: PlanData; onSelect: (id: string) => void }) {
  return (
    <div className="mx-5 mb-4 border-t border-hairline pt-3">
      <div className="mb-1.5 text-[12px] text-ink-3">Overlaps named in the challenge</div>
      <ul className="flex flex-col gap-1">
        {data.meta.knownMatches.map((k) => (
          <li key={k.label}>
            <button
              type="button"
              disabled={!k.overlapId}
              onClick={() => k.overlapId && onSelect(k.overlapId)}
              className="flex w-full items-baseline gap-2 text-left text-[13px] leading-[18px] text-ink-2 enabled:hover:text-ink"
            >
              <span className={cx("shrink-0 text-[12px] font-medium", k.found ? "text-desc" : "text-alert")}>
                {k.found ? "Found" : "Not found"}
              </span>
              <span>{k.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

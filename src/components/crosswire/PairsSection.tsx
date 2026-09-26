"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { fmtKm } from "@/lib/format";
import { isRightSizingCandidate } from "@/lib/plan";
import { DEFAULT_WEIGHTS } from "@/lib/ranking";
import { matchSavings } from "@/lib/savings";
import { TIER_LABEL, TIER_RANGE, TIERS, UTILITY_HEX, UTILITY_NAME } from "@/lib/theme";
import type { Project } from "@/lib/types";
import {
  fmtMoney,
  fmtRange,
  HONEST_NOTE,
  HowCalculated,
  rangeSourceLine,
  SavingsBar,
  SavingsHeadline,
} from "../plan/Savings";
import { RightSizingChip } from "../plan/RightSizing";
import { More } from "../stormline/StormSections";
import { CompanyBlock, cx, Slider, TierSwatch } from "../ui/primitives";
import { EmptyState, SkeletonRows } from "../ui/states";
import { MeasureToggle } from "./MeasureToggle";
import type { CrosswireState } from "./useCrosswire";

/** The list of pairs, led by one sentence about the money at stake. */
export function PairsSection({ cw }: { cw: CrosswireState }) {
  const { plan, ranked, savings } = cw;
  if (!plan) return <SkeletonRows rows={5} />;

  const picked = [...cw.selectedProjects].map((id) => cw.projectsById.get(id)).filter((p): p is Project => !!p);
  const tierCounts = new Map<string, number>();
  for (const r of ranked) tierCounts.set(r.overlap.tier, (tierCounts.get(r.overlap.tier) ?? 0) + 1);

  return (
    <div>
      {picked.length ? (
        <div className="border-b border-hairline px-5 py-4">
          <p className="text-[14px] leading-[21px] text-ink">
            Showing only what collides with your {picked.length === 1 ? "pick" : `${picked.length} picks`}:
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {picked.map((p) => (
              <li key={p.id} className="flex items-start gap-2">
                <span
                  aria-hidden
                  className="mt-1 h-3.5 w-[3px] shrink-0 rounded-full"
                  style={{ background: UTILITY_HEX[p.utility] }}
                />
                <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">{p.name}</span>
                <button
                  type="button"
                  onClick={() => cw.toggleProject(p.id, true)}
                  aria-label={`Unpick ${p.name}`}
                  className="-mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-white/70 hover:text-ink"
                >
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={cw.clearSelection}
            className="mt-2 text-[13px] font-medium text-ink-2 underline underline-offset-2 hover:text-ink"
          >
            Show every pair again
          </button>
        </div>
      ) : (
        <p className="border-b border-hairline px-5 py-3 text-[13px] leading-[19px] text-ink-3">
          Click a line or station on the map to pick it; shift-click to pick several.
        </p>
      )}

      <div className="border-b border-hairline px-5 py-3">
        <span className="mb-1.5 block text-[12px] text-ink-3">Measure the distance between</span>
        <MeasureToggle value={cw.measure} onChange={cw.setMeasure} />
      </div>

      {savings.count > 0 && savings.total > 0 ? (
        <div className="border-b border-hairline px-5 py-5">
          <SavingsHeadline summary={savings} caption={false} />
          <p className="mt-1.5 text-[14px] leading-[21px] text-ink-2">
            could be saved if {UTILITY_NAME.DESC} and {UTILITY_NAME.GPC} work together on these {savings.count} pairs
            {savings.rangedCount > 0 && Math.round(savings.low) !== Math.round(savings.high)
              ? `; most likely about ${fmtMoney(savings.total)}`
              : ""}
            .
          </p>
          <More label="Where the savings come from">
            <SavingsBar land={savings.land} yard={savings.yard} crew={savings.crew} />
            {savings.acres > 0 ? (
              <p className="mt-2 text-[13px] text-ink-2">
                They would share about {savings.acres.toFixed(1)} acres of land.
              </p>
            ) : null}
            <p className="mt-2 text-[12px] leading-4 text-ink-3">{HONEST_NOTE}</p>
            <div className="mt-1.5">
              <HowCalculated
                lines={[
                  rangeSourceLine({ ...savings, ranged: savings.rangedCount > 0 }),
                  HONEST_NOTE,
                  ...cw.savingsAssumptions,
                ]}
              />
            </div>
          </More>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5 px-5 pt-4" role="group" aria-label="Show pairs that">
        {TIERS.map((t) => {
          const on = cw.tiers.has(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => cw.toggleTier(t)}
              title={TIER_RANGE[t]}
              className={cx(
                "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
                on ? "border-hairline-strong bg-white/80 text-ink" : "border-transparent bg-wash text-ink-3",
              )}
            >
              <span className={cx(!on && "opacity-35")}>
                <TierSwatch tier={t} size={8} />
              </span>
              {TIER_LABEL[t]}
            </button>
          );
        })}
      </div>

      {!ranked.length ? (
        <EmptyState
          title={cw.selectedProjects.size ? "Nothing collides with your picks" : "No pairs of this kind"}
          body={
            cw.selectedProjects.size
              ? "None of the other utility's planned work comes within 40 km of what you picked."
              : "Turn a filter above back on to see those pairs."
          }
        />
      ) : (
        <ol className="flex flex-col gap-0.5 px-3 py-3">
          {ranked.map((r) => (
            <PairRow key={r.overlap.id} cw={cw} rank={r.rank} id={r.overlap.id} />
          ))}
        </ol>
      )}

      <div className="px-5 pb-5">
        <More label="How the list is ranked">
          <div className="flex flex-col gap-3">
            <Slider
              label="How close they are"
              value={cw.weights.distance}
              onChange={(v) => cw.setWeights({ ...cw.weights, distance: v })}
            />
            <Slider
              label="How long they build at the same time"
              value={cw.weights.timeline}
              onChange={(v) => cw.setWeights({ ...cw.weights, timeline: v })}
            />
            <button
              type="button"
              onClick={() => cw.setWeights(DEFAULT_WEIGHTS)}
              className="w-fit text-[12px] font-medium text-ink-2 underline underline-offset-2"
            >
              Reset
            </button>
          </div>
        </More>
      </div>
    </div>
  );
}

function PairRow({ cw, rank, id }: { cw: CrosswireState; rank: number; id: string }) {
  const ref = useRef<HTMLLIElement>(null);
  const r = cw.ranked.find((x) => x.overlap.id === id)!;
  const o = r.overlap;
  const desc = cw.projectsById.get(o.descId);
  const gpc = cw.projectsById.get(o.gpcId);
  const saved = matchSavings(o, cw.costRanges);
  const selected = cw.selected?.overlap.id === id;
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const bits = [
    o.distanceKm <= 0 ? "They touch" : `${fmtKm(o.distanceKm)} apart`,
    o.timelineOverlapMonths > 0
      ? `both building ${Math.round(o.timelineOverlapMonths)} months`
      : "built at different times",
    saved && saved.central > 0
      ? `could save ${saved.ranged ? fmtRange(saved.low, saved.high) : fmtMoney(saved.central)}`
      : null,
  ].filter(Boolean);

  return (
    <li ref={ref}>
      <button
        type="button"
        onClick={() => cw.selectOverlap(id)}
        aria-current={selected ? "true" : undefined}
        className={cx(
          "flex w-full flex-col gap-2 rounded-[12px] px-3 py-3 text-left transition-colors",
          selected ? "bg-white/85 shadow-[0_0_0_1px_rgba(20,24,30,0.12)]" : "hover:bg-white/45",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="display text-[15px] font-medium text-ink">#{rank}</span>
          <span className="text-[12px] font-medium text-ink-2">{TIER_LABEL[o.tier]}</span>
          {isRightSizingCandidate(desc, gpc) ? <RightSizingChip compact /> : null}
        </span>
        <CompanyBlock utility="DESC" size="sm">
          {desc?.name ?? o.descId}
        </CompanyBlock>
        <CompanyBlock utility="GPC" size="sm">
          {gpc?.name ?? o.gpcId}
        </CompanyBlock>
        <span className="text-[12px] leading-[17px] text-ink-3">{bits.join(", ")}.</span>
      </button>
    </li>
  );
}

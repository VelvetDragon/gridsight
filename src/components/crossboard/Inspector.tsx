"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { fmtKm, shortProjectName } from "@/lib/format";
import { TIER_LABEL, UTILITY_HEX, UTILITY_NAME } from "@/lib/theme";
import { MeasureToggle } from "../crosswire/MeasureToggle";
import { PairDetail } from "../crosswire/PairDetail";
import { PairPanelHeader } from "../crosswire/PairPanel";
import { PickedProjects, RankingControls } from "../crosswire/PairsSection";
import { SavingsAgentPanel } from "../crosswire/SavingsAgentPanel";
import type { CrosswireState } from "../crosswire/useCrosswire";
import { fmtMoney } from "../plan/Savings";
import { More } from "../stormline/StormSections";
import { TierSwatch } from "../ui/primitives";
import { SkeletonRows } from "../ui/states";

/** The three pairs to open first, as cards that say why in a few words. */
function StartHere({ cw }: { cw: CrosswireState }) {
  const top = cw.ranked.slice(0, 3);
  if (!top.length) return null;
  return (
    <div className="border-b border-hairline px-5 py-5">
      <h3 className="eyebrow mb-3">Open these first</h3>
      <ol className="flex flex-col gap-2">
        {top.map((r) => {
          const o = r.overlap;
          const desc = cw.projectsById.get(o.descId);
          const gpc = cw.projectsById.get(o.gpcId);
          const saved = cw.signals.get(o.id)?.savedUsd ?? 0;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => cw.selectOverlap(o.id)}
                className="group flex w-full items-start gap-3 rounded-[12px] border border-hairline bg-white/70 px-3 py-2.5 text-left transition-colors hover:border-hairline-strong hover:bg-white"
              >
                <span className="display pt-0.5 text-[18px] leading-5 font-medium text-ink">{r.rank}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12px] leading-4 font-medium text-ink-2">
                    <TierSwatch tier={o.tier} size={7} />
                    {TIER_LABEL[o.tier]}
                    <span className="font-normal text-ink-3">
                      · {o.distanceKm <= 0 ? "they touch" : `${fmtKm(o.distanceKm)} apart`}
                      {saved > 0 ? ` · ${fmtMoney(saved)} est.` : ""}
                    </span>
                  </span>
                  {[
                    { p: desc, u: "DESC" as const },
                    { p: gpc, u: "GPC" as const },
                  ].map(({ p, u }) => (
                    <span key={u} className="mt-1 flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden
                        className="h-3 w-[3px] shrink-0 rounded-full"
                        style={{ background: UTILITY_HEX[u] }}
                      />
                      <span className="truncate text-[13px] leading-[18px] text-ink">
                        {p ? shortProjectName(p.name) : "–"}
                      </span>
                    </span>
                  ))}
                </span>
                <ArrowRight
                  size={15}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Overview({ cw }: { cw: CrosswireState }) {
  if (!cw.plan) return <SkeletonRows rows={6} />;
  const ledger = `/data?tab=overlaps&you=${cw.bundle?.you.id ?? ""}&neighbor=${cw.bundle?.neighbor.id ?? ""}`;
  return (
    <div>
      <div className="border-b border-hairline px-5 pt-5 pb-4">
        <h2 className="display text-[20px] leading-7 font-medium text-ink">What to look at</h2>
        <p className="mt-1 text-[14px] leading-[21px] text-ink-2">
          {cw.plan.meta.projectCount.DESC} {UTILITY_NAME.DESC} and {cw.plan.meta.projectCount.GPC} {UTILITY_NAME.GPC}{" "}
          projects; <span className="font-medium text-ink">{cw.plan.overlaps.length} pairs</span> come within 40 km and are built no more than a year apart.
          Pick a row, a card or a spot on the map to read a pair in full.
        </p>
      </div>
      <StartHere cw={cw} />
      <PickedProjects cw={cw} />
      <SavingsAgentPanel cw={cw} />
      <div className="border-b border-hairline px-5 py-4">
        <h3 className="eyebrow mb-2.5">How pairs are measured</h3>
        <MeasureToggle value={cw.measure} onChange={cw.setMeasure} />
        <More label="How the list is ranked">
          <RankingControls cw={cw} />
        </More>
      </div>
      <div className="px-5 py-4 text-[13px] text-ink-2">
        <Link href={ledger} className="w-fit underline underline-offset-2 hover:text-ink">
          Every pair in The Ledger, with export
        </Link>
      </div>
    </div>
  );
}

/** Right column: an overview until a pair is chosen, then that pair's full story. */
export function Inspector({ cw }: { cw: CrosswireState }) {
  if (cw.selected) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PairPanelHeader cw={cw} />
        <div key={cw.selected.overlap.id} className="scroll-quiet gs-fade min-h-0 flex-1 overflow-y-auto">
          <PairDetail cw={cw} />
        </div>
      </div>
    );
  }
  return (
    <div className="scroll-quiet h-full min-h-0 overflow-y-auto">
      <Overview cw={cw} />
    </div>
  );
}

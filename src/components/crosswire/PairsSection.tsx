"use client";

import { X } from "lucide-react";
import { DEFAULT_WEIGHTS } from "@/lib/ranking";
import { UTILITY_HEX, UTILITY_NAME } from "@/lib/theme";
import type { Project } from "@/lib/types";
import { SAVINGS_METHOD } from "@/lib/savings";
import { DocumentLink, HONEST_NOTE, HowCalculated, SavingsBar, SavingsHeadline } from "../plan/Savings";
import { More } from "../stormline/StormSections";
import { Slider } from "../ui/primitives";
import type { CrosswireState } from "./useCrosswire";

/** The projects picked on the map, which narrow the list to what collides with them. */
export function PickedProjects({ cw }: { cw: CrosswireState }) {
  const picked = [...cw.selectedProjects].map((id) => cw.projectsById.get(id)).filter((p): p is Project => !!p);
  if (!picked.length) {
    return (
      <p className="border-b border-hairline px-5 py-3 text-[13px] leading-[19px] text-ink-3">
        Click a line or station on the map to pick it; shift-click to pick several.
      </p>
    );
  }
  return (
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
  );
}

/** One sentence about the money at stake across the pairs shown. */
export function PairsSavings({ cw }: { cw: CrosswireState }) {
  const { savings } = cw;
  if (savings.count <= 0) return null;
  return (
    <div className="border-b border-hairline px-5 py-5">
      <SavingsHeadline summary={savings} />
      <p className="mt-1.5 text-[14px] leading-[21px] text-ink-2">
        could be saved if {UTILITY_NAME.DESC} and {UTILITY_NAME.GPC} work together on{" "}
        {savings.count === 1 ? "one of these pairs" : `${savings.count} of these pairs`}.
      </p>
      <More label="Where the savings come from">
        <SavingsBar land={savings.land} crew={savings.crew} />
        {savings.acres > 0 ? (
          <p className="mt-2 text-[13px] text-ink-2">
            They would share about {savings.acres.toFixed(1)} acres of land.
          </p>
        ) : null}
        <p className="mt-2 text-[12px] leading-4 text-ink-3">{HONEST_NOTE}</p>
        <div className="mt-1.5">
          <HowCalculated
            lines={[
              ...SAVINGS_METHOD,
              ...(savings.repeats
                ? [
                    `${savings.repeats} pair${savings.repeats === 1 ? " shares a job" : "s share jobs"} with other pairs, so ${savings.repeats === 1 ? "its" : "their"} crew setup is counted once.`,
                  ]
                : []),
            ]}
            linked
          />
        </div>
        {savings.sources.length ? (
          <>
            <h4 className="mt-4 mb-2 text-[12px] font-semibold text-ink-2">Where this comes from</h4>
            <ul className="flex flex-col gap-3">
              {savings.sources.map((s) => (
                <DocumentLink key={`${s.url}#${s.page}`} source={s} />
              ))}
            </ul>
          </>
        ) : null}
      </More>
    </div>
  );
}

/** Sliders for how the list is ranked. */
export function RankingControls({ cw }: { cw: CrosswireState }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-4 text-ink-3">
        Pairs with a way to work together always come first. Within that, the sliders set how much each part counts.
      </p>
      <Slider
        label="Ways to work together"
        value={cw.weights.sharing}
        onChange={(v) => cw.setWeights({ ...cw.weights, sharing: v })}
      />
      <Slider
        label="Estimated savings"
        value={cw.weights.savings}
        onChange={(v) => cw.setWeights({ ...cw.weights, savings: v })}
      />
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
  );
}

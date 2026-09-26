"use client";

import { ArrowLeft, Plane } from "lucide-react";
import { ACTION_LABEL, fmtKv, fmtMonthYear } from "@/lib/format";
import { isRightSizingCandidate } from "@/lib/plan";
import { matchSavings } from "@/lib/savings";
import { pairSentence, shareSentence } from "@/lib/sentences";
import { TIER_LABEL } from "@/lib/theme";
import type { Project } from "@/lib/types";
import { CopyMemo, DistanceBlock, SourceLink, YardBlock } from "../plan/MatchDrawer";
import { MiniGantt } from "../plan/MiniGantt";
import { RightSizingChip } from "../plan/RightSizing";
import { fmtMoney, fmtRange, HONEST_NOTE, HowCalculated, rangeSourceLine, SavingsBar } from "../plan/Savings";
import { CoordinationCallSlot, ExplainMatchSlot } from "../slots";
import { More } from "../stormline/StormSections";
import { CompanyBlock } from "../ui/primitives";
import type { CrosswireState } from "./useCrosswire";

function detail(p: Project | undefined) {
  if (!p) return null;
  return (
    <>
      {ACTION_LABEL[p.action]} · <span className="num">{fmtKv(p.voltageKv)}</span>
      {p.miles != null ? (
        <>
          {" · "}
          <span className="num">{p.miles} mi</span>
        </>
      ) : null}
      {" · ready "}
      {fmtMonthYear(p.inService)}
    </>
  );
}

/** One pair, essential first: who, one sentence, the money; details on request. */
export function PairDetail({ cw }: { cw: CrosswireState }) {
  const item = cw.selected;
  if (!item || !cw.bundle) return null;
  const o = item.overlap;
  const desc = cw.projectsById.get(o.descId);
  const gpc = cw.projectsById.get(o.gpcId);
  const saved = matchSavings(o, cw.costRanges);
  const ranged = saved?.ranged && Math.round(saved.low) !== Math.round(saved.high);
  const slotProps =
    desc && gpc ? { overlap: o, yours: desc, theirs: gpc, you: cw.bundle.you, neighbor: cw.bundle.neighbor } : null;

  return (
    <div>
      <div className="px-5 pt-4">
        <button
          type="button"
          onClick={cw.clearMatch}
          className="-ml-1.5 flex items-center gap-1 rounded-[8px] px-1.5 py-1 text-[13px] font-medium text-ink-2 hover:bg-white/60 hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden />
          All pairs
        </button>
        <h2 className="display mt-2 text-[22px] leading-7 font-medium text-ink">
          Pair #{item.rank}: {TIER_LABEL[o.tier].toLowerCase()}
        </h2>
      </div>

      <div className="flex flex-col gap-3 px-5 pt-3 pb-4">
        <CompanyBlock utility="DESC" size="lg" detail={detail(desc)}>
          {desc?.name ?? o.descId}
        </CompanyBlock>
        <CompanyBlock utility="GPC" size="lg" detail={detail(gpc)}>
          {gpc?.name ?? o.gpcId}
        </CompanyBlock>
        {isRightSizingCandidate(desc, gpc) ? (
          <div>
            <RightSizingChip />
          </div>
        ) : null}
      </div>

      <div className="border-t border-hairline px-5 py-5">
        <p className="text-[16px] leading-[25px] text-ink">{pairSentence(o, desc, gpc)}</p>
        {o.shareable.length ? (
          <p className="mt-2 text-[14px] leading-[22px] text-ink-2">{shareSentence(o.shareable)}</p>
        ) : null}
        {o.robustness === "uncertain" ? (
          <p className="mt-2 text-[13px] leading-5 text-ink-3">
            At least one route is approximate, so the distance could change once exact routes are public.
          </p>
        ) : null}
      </div>

      {saved && saved.central > 0 ? (
        <div className="border-t border-hairline px-5 py-5">
          <p className="display text-[30px] leading-9 font-medium text-ink">
            {ranged ? fmtRange(saved.low, saved.high) : fmtMoney(saved.central)}
          </p>
          <p className="mt-1 text-[14px] leading-[21px] text-ink-2">
            could be saved by doing this work together{ranged ? `, most likely about ${fmtMoney(saved.central)}` : ""}.
          </p>
          <More label="Where it comes from">
            <SavingsBar land={saved.land} yard={saved.yard} crew={saved.crew} />
            <div className="mt-2">
              <HowCalculated
                lines={[
                  rangeSourceLine({ low: saved.low, high: saved.high, total: saved.central, ranged: saved.ranged }),
                  HONEST_NOTE,
                  ...(o.cost?.assumptions ?? []),
                ]}
              />
            </div>
          </More>
        </div>
      ) : null}

      <div className="border-t border-hairline px-5 pt-5">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("mrgridy:fly"))}
          className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-hairline bg-white text-[14px] font-medium text-ink hover:bg-wash-2"
        >
          <Plane size={16} aria-hidden />
          Fly the corridor
        </button>
      </div>

      {slotProps && (ExplainMatchSlot || CoordinationCallSlot) ? (
        <div className="flex flex-col gap-3 border-t border-hairline px-5 py-5">
          {ExplainMatchSlot ? <ExplainMatchSlot {...slotProps} /> : null}
          {CoordinationCallSlot ? <CoordinationCallSlot {...slotProps} /> : null}
        </div>
      ) : null}

      <div className="border-t border-hairline px-5 py-4">
        {desc && gpc ? (
          <More label="When each one is built">
            <MiniGantt desc={desc} gpc={gpc} cursorMonth={cw.radarMonth} />
          </More>
        ) : null}
        <More label="How far apart, by road">
          <DistanceBlock overlap={o} />
        </More>
        {o.stagingYard ? (
          <More label="A shared staging yard">
            <YardBlock overlap={o} />
          </More>
        ) : null}
        <More label="Where this comes from">
          <ul className="flex flex-col gap-3">
            {[desc, gpc].map((p) => (p ? <SourceLink key={p.id} project={p} /> : null))}
          </ul>
        </More>
      </div>

      {desc && gpc ? (
        <div className="border-t border-hairline px-5 py-4">
          <CopyMemo overlap={o} desc={desc} gpc={gpc} rank={item.rank} />
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { ACTION_LABEL, fmtKv, fmtMonthYear } from "@/lib/format";
import { grantSource } from "@/lib/grants";
import { pairOpportunities } from "@/lib/opportunities";
import { matchSavings } from "@/lib/savings";
import { pairSentence } from "@/lib/sentences";
import type { Project } from "@/lib/types";
import { CopyMemo, DistanceBlock, SourceLink, YardBlock } from "../plan/MatchDrawer";
import { MiniGantt } from "../plan/MiniGantt";
import { DocumentLink, EstimatedTag, fmtMoney, HONEST_NOTE, HowCalculated, SavingsBar } from "../plan/Savings";
// Call script and voice preview are switched off for now.
// import { CoordinationCallSlot, ExplainMatchSlot } from "../slots";
import { ExplainMatchSlot } from "../slots";
import { More } from "../stormline/StormSections";
import { CompanyBlock } from "../ui/primitives";
import { FundingMatchBlock } from "./FundingMatchBlock";
import { PairOpportunities } from "./PairOpportunities";
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

/**
 * One pair, essential first: who, one sentence, the money; details on request.
 * The title, stepping and close live in the panel around it (PairPanelHeader).
 */
export function PairDetail({ cw }: { cw: CrosswireState }) {
  const item = cw.selected;
  if (!item || !cw.bundle) return null;
  const o = item.overlap;
  const desc = cw.projectsById.get(o.descId);
  const gpc = cw.projectsById.get(o.gpcId);
  const wetland = cw.bundle.plan.wetlands?.find((w) => w.overlapId === o.id) ?? null;
  // The agent's signals include a joint grant fit; the rules alone otherwise.
  const opportunities =
    desc && gpc
      ? (cw.signals.get(o.id)?.opportunities ?? pairOpportunities(o, desc, gpc, wetland, cw.bundle.plan.lines))
      : null;
  const screens = cw.grantScreens[o.id] ?? [];
  const funding = cw.funding[o.id] ?? [];
  const grants = cw.agent.programs.filter((g) => funding.some((m) => m.grantId === g.id));
  const saved = matchSavings(o, desc, gpc, opportunities ?? undefined);
  const slotProps =
    desc && gpc ? { overlap: o, yours: desc, theirs: gpc, you: cw.bundle.you, neighbor: cw.bundle.neighbor } : null;

  return (
    <div>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-4">
        <CompanyBlock utility="DESC" size="lg" detail={detail(desc)}>
          {desc?.name ?? o.descId}
        </CompanyBlock>
        <CompanyBlock utility="GPC" size="lg" detail={detail(gpc)}>
          {gpc?.name ?? o.gpcId}
        </CompanyBlock>
      </div>

      <div className="border-t border-hairline px-5 py-5">
        <p className="text-[16px] leading-[25px] text-ink">{pairSentence(o, desc, gpc)}</p>
        {o.robustness === "uncertain" ? (
          <p className="mt-2 text-[13px] leading-5 text-ink-3">
            At least one route is approximate, so the distance could change once exact routes are public.
          </p>
        ) : null}
      </div>

      {opportunities ? <PairOpportunities opportunities={opportunities} /> : null}

      {saved && saved.total > 0 ? (
        <div className="border-t border-hairline px-5 py-5">
          <p className="display text-[30px] leading-9 font-medium text-ink">
            {fmtMoney(saved.total)}
            <EstimatedTag />
          </p>
          <p className="mt-1 text-[14px] leading-[21px] text-ink-2">could be saved by doing this work together.</p>
          <More label="Where it comes from">
            <SavingsBar land={saved.land} crew={saved.crew} />
            <p className="mt-2 text-[12px] leading-4 text-ink-3">{HONEST_NOTE}</p>
            <div className="mt-1.5">
              <HowCalculated lines={saved.lines} unpriced={saved.unpriced} linked />
            </div>
          </More>
        </div>
      ) : saved?.unpriced.length ? (
        <div className="border-t border-hairline px-5 py-5">
          <p className="display text-[22px] leading-7 font-medium text-ink">Savings, but no dollar figure</p>
          <p className="mt-1 text-[14px] leading-[21px] text-ink-2">
            Working together here saves money, but no public source puts a price on it, so it is left out of the
            totals rather than guessed:
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-5 text-ink-2">
            {saved.unpriced.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {desc && gpc && screens.length ? (
        <FundingMatchBlock
          screens={screens}
          programs={cw.agent.programs}
          projects={[desc, gpc]}
          utilities={[cw.bundle.you.shortName, cw.bundle.neighbor.shortName]}
        />
      ) : null}

      {slotProps && ExplainMatchSlot ? (
        <div className="flex flex-col gap-3 border-t border-hairline px-5 py-5">
          <ExplainMatchSlot {...slotProps} />
          {/* {CoordinationCallSlot ? <CoordinationCallSlot {...slotProps} /> : null} */}
        </div>
      ) : null}

      {desc && gpc ? (
        <div className="border-t border-hairline px-5 py-5">
          <h3 className="eyebrow mb-3">When each one is built</h3>
          <MiniGantt desc={desc} gpc={gpc} cursorMonth={cw.radarMonth} />
        </div>
      ) : null}

      <div className="border-t border-hairline px-5 py-4">
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
          {saved?.sources.length ? (
            <>
              <h4 className="mt-4 mb-2 text-[12px] font-semibold text-ink-2">Unit costs behind the estimate</h4>
              <ul className="flex flex-col gap-3">
                {saved.sources.map((s) => (
                  <DocumentLink key={`${s.url}#${s.page}`} source={s} />
                ))}
              </ul>
            </>
          ) : null}
          {grants.length ? (
            <>
              <h4 className="mt-4 mb-2 text-[12px] font-semibold text-ink-2">Grant programs</h4>
              <ul className="flex flex-col gap-3">
                {grants.map((g) => (
                  <DocumentLink key={g.id} source={grantSource(g)} note={`program page, checked ${g.checked}`} />
                ))}
              </ul>
            </>
          ) : null}
        </More>
      </div>

      {desc && gpc ? (
        <div className="border-t border-hairline px-5 py-4">
          <CopyMemo overlap={o} desc={desc} gpc={gpc} rank={item.rank} opportunities={opportunities ?? undefined} />
        </div>
      ) : null}
    </div>
  );
}

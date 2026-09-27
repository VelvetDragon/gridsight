"use client";

import { Check, CircleDashed, LoaderCircle, RotateCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { shortProjectName } from "@/lib/format";
import { firstFailure, grantSource, type Verdict } from "@/lib/grants";
import type { AgentStep } from "@/lib/integrations/savingsAgent";
import { DocumentLink, fmtMoney } from "../plan/Savings";
import { More } from "../stormline/StormSections";
import { cx } from "../ui/primitives";
import { roundText } from "./FundingMatchBlock";
import { PairsSavings } from "./PairsSection";
import type { CrosswireState } from "./useCrosswire";
import type { StepState } from "./useSavingsAgent";

const STEP_TITLE: Record<AgentStep, string> = {
  grants: "Find grant programs and read their requirements",
  prices: "Price the shared work",
  rules: "Check every project against every requirement",
  verify: "Verify the work requirements with AI",
  notes: "Write a funding note per pair",
};

function StepIcon({ state }: { state: StepState }) {
  const cls = "mt-0.5 size-3.5 shrink-0";
  if (state === "working") return <LoaderCircle aria-hidden className={cx(cls, "animate-spin text-ink-2")} />;
  if (state === "done") return <Check aria-hidden className={cx(cls, "text-ink")} />;
  if (state === "failed") return <TriangleAlert aria-hidden className={cx(cls, "text-ink-2")} />;
  return <CircleDashed aria-hidden className={cx(cls, "text-ink-3")} />;
}

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <StepIcon state={state} />
      <div className="min-w-0 flex-1">
        <p className={cx("text-[13px] leading-[18px]", state === "waiting" || state === "skipped" ? "text-ink-3" : "text-ink")}>
          {title}
        </p>
        {children ? <div className="mt-0.5 text-[12px] leading-4 text-ink-3">{children}</div> : null}
      </div>
    </li>
  );
}

/**
 * The savings agent in the Overview: what it did, step by step, then the
 * savings it priced and the pairs that fit a grant program.
 */
export function SavingsAgentPanel({ cw }: { cw: CrosswireState }) {
  const { agent, funding, grantScreens, savings, projectsById } = cw;
  const pairIds = Object.keys(funding);
  const joint = pairIds.filter((id) => funding[id].some((m) => m.fit === "joint"));
  const programName = (id: string) => agent.programs.find((g) => g.id === id)?.short ?? id;
  const notesWritten = agent.notesSource === "gemini";
  const overlapsById = new Map((cw.plan?.overlaps ?? []).map((o) => [o.id, o]));
  const grantsState: StepState = agent.steps.grants.state === "waiting" && !agent.running ? "waiting" : agent.steps.grants.state;
  const screenedPairs = Object.keys(grantScreens).length;

  // Each program's verdict per project (a project appears in several pairs, with the same checklist).
  const perProgram = new Map<string, Map<string, { verdict: Verdict; why: string | null }>>();
  for (const screens of Object.values(grantScreens))
    for (const s of screens)
      for (const c of s.checks) {
        const m = perProgram.get(s.grantId) ?? new Map();
        m.set(c.projectId, { verdict: c.verdict, why: firstFailure(c)?.why ?? null });
        perProgram.set(s.grantId, m);
      }
  const tally = (id: string) => {
    const m = [...(perProgram.get(id)?.values() ?? [])];
    const count = (v: Verdict) => m.filter((x) => x.verdict === v).length;
    const reasons = new Map<string, number>();
    for (const x of m) if (x.why) reasons.set(x.why, (reasons.get(x.why) ?? 0) + 1);
    const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { fits: count("fits"), unclear: count("unclear"), out: count("ruledOut"), total: m.length, top };
  };
  const src = agent.sources;
  const stepList = Object.values(agent.steps);
  const doneSteps = stepList.filter((x) => x.state === "done" || x.state === "skipped").length;
  const stepsLabel = agent.running
    ? `Agent steps · working (${doneSteps} of ${stepList.length} done)`
    : stepList.some((x) => x.state === "failed")
      ? "Agent steps · one didn't finish"
      : "Agent steps";
  const s = (n: number) => (n === 1 ? "" : "s");

  return (
    <>
      <div className="border-b border-hairline px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="eyebrow">Savings agent</h3>
          <button
            type="button"
            onClick={agent.rerun}
            disabled={agent.running}
            className="flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12px] text-ink-2 transition-colors hover:bg-wash hover:text-ink disabled:opacity-50"
          >
            <RotateCw aria-hidden className={cx("size-3", agent.running && "animate-spin")} />
            {agent.running ? "Working" : "Run again"}
          </button>
        </div>
        <p className="mt-1.5 text-[13px] leading-[19px] text-ink-2">
          It finds grant programs and reads each one&apos;s requirements, prices what each pair could share, checks
          every project against every requirement, then has AI re-read the filings to verify the work qualifies.
        </p>
        <More label={stepsLabel}>
          <ol className="flex flex-col gap-2.5">
            <Step state={grantsState} title={STEP_TITLE.grants}>
              {agent.steps.grants.state === "done"
                ? `${agent.programs.length} programs${
                    src
                      ? ` (${src.catalog} verified${src.grantsGov ? `, ${src.grantsGov.kept} from Grants.gov` : ""}${src.web ? `, ${src.web} from the web` : ""})`
                      : ""
                  }. ${agent.grantsNote ?? ""}`
                : agent.steps.grants.state === "failed"
                  ? `The agent could not be reached, so the ${agent.programs.length} verified programs are checked by rule only.`
                  : agent.steps.grants.message}
            </Step>
            <Step state="done" title={STEP_TITLE.prices}>
              {savings.count > 0
                ? `About ${fmtMoney(savings.total)} across ${savings.count} pair${s(savings.count)}, from published unit costs.`
                : "No pair shares work that can be priced yet."}
            </Step>
            <Step
              state={agent.steps.rules.state === "done" || agent.error ? "done" : agent.steps.rules.state}
              title={STEP_TITLE.rules}
            >
              {agent.steps.rules.state === "done" || agent.error
                ? `${agent.rules ? `${agent.rules.checks.toLocaleString("en-US")} checks. ` : ""}${
                    pairIds.length
                      ? `${pairIds.length} of ${screenedPairs} pairs have a program one of their projects fully meets`
                      : `None of the ${screenedPairs} pairs fully meets any program`
                  }${joint.length ? `; ${joint.length} could apply together` : ""}.`
                : agent.steps.rules.message}
            </Step>
            <Step state={agent.steps.verify.state} title={STEP_TITLE.verify}>
              {agent.verified
                ? `${agent.verified.note}${agent.verified.model ? ` (${agent.verified.model})` : ""}`
                : agent.steps.verify.message}
            </Step>
            <Step state={agent.steps.notes.state} title={STEP_TITLE.notes}>
              {agent.steps.notes.state === "done"
                ? notesWritten
                  ? `Gemini${agent.notesModel ? ` (${agent.notesModel})` : ""} wrote them from the checked facts.`
                  : "Written from a template (Gemini was not available)."
                : agent.steps.notes.state === "skipped"
                  ? "No pair to write for."
                  : agent.steps.notes.message}
            </Step>
          </ol>
        </More>
        {agent.error ? <p className="mt-3 text-[12px] leading-4 text-ink-3">{agent.error}</p> : null}
      </div>

      <PairsSavings cw={cw} />

      {screenedPairs ? (
        <div className="border-b border-hairline px-5 py-5">
          <h3 className="eyebrow mb-2">Funding check</h3>
          <p className="text-[13px] leading-[19px] text-ink-2">
            A project fits a program only when it meets every requirement public filings can show. Cost match, spending
            history and who leads the application stay for the utility to confirm. Grants are competitive, so they are
            not added to the savings above.
          </p>
          {joint.length ? (
            <ul className="mt-3 flex flex-col gap-1">
              {joint.slice(0, 6).map((id) => {
                const o = overlapsById.get(id);
                const a = o && projectsById.get(o.descId);
                const b = o && projectsById.get(o.gpcId);
                if (!a || !b) return null;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => cw.selectOverlap(id)}
                      className="-mx-1.5 w-[calc(100%+12px)] rounded-[8px] px-1.5 py-1 text-left transition-colors hover:bg-wash"
                    >
                      <span className="block text-[13px] leading-[18px] text-ink">
                        {shortProjectName(a.name)} and {shortProjectName(b.name)}
                      </span>
                      <span className="block text-[12px] text-ink-3">
                        Apply together:{" "}
                        {funding[id]
                          .filter((m) => m.fit === "joint")
                          .map((m) => programName(m.grantId))
                          .join(", ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] leading-[19px] text-ink-2">
              No pair qualifies for a joint application: that needs both projects to meet every requirement, in two
              states, with work on the ground they share.
            </p>
          )}
          <ul className="mt-3 flex flex-col gap-2.5">
            {agent.programs.map((g) => {
              const t = tally(g.id);
              return (
                <li key={g.id} className="text-[12px] leading-4">
                  <p className="text-ink">
                    {g.short} <span className="text-ink-3">· {roundText(g)}</span>
                  </p>
                  <p className="mt-0.5 text-ink-2">
                    {!g.requirements.length
                      ? "Found, but its requirements couldn't be quoted from the listing, so it isn't counted."
                      : t.total
                        ? `${t.fits} of ${t.total} project${s(t.total)} meet every public requirement${t.unclear ? `; ${t.unclear} missing a fact` : ""}.${
                            !t.fits && t.top ? ` Most often: ${t.top}` : ""
                          }`
                        : "No project to check."}
                  </p>
                </li>
              );
            })}
          </ul>
          <More label="Program sources">
            <ul className="flex flex-col gap-3">
              {agent.programs.map((g) => (
                <DocumentLink
                  key={g.id}
                  source={grantSource(g)}
                  note={`${g.via === "grants.gov" ? "Grants.gov listing" : g.via === "search" ? "found by web search" : "verified list"}, checked ${g.checked}`}
                />
              ))}
            </ul>
          </More>
        </div>
      ) : null}
    </>
  );
}

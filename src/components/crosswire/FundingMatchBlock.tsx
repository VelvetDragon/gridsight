"use client";

import { Check, CircleHelp, UserCheck, X } from "lucide-react";
import { type GrantProgram, type ProgramScreen, type ProjectCheck, type ReqResult, type ReqStatus, type Verdict } from "@/lib/grants";
import { shortProjectName } from "@/lib/format";
import type { Project } from "@/lib/types";
import { More } from "../stormline/StormSections";
import { cx } from "../ui/primitives";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const STATUS_LABEL: Record<ReqStatus, string> = {
  met: "Met",
  notMet: "Not met",
  unknown: "Can't tell from the filing",
  confirm: "Utility confirms",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  fits: "Meets every public requirement",
  unclear: "Missing a fact to decide",
  ruledOut: "Ruled out",
};

function StatusIcon({ status }: { status: ReqStatus }) {
  const cls = "mt-0.5 size-3.5 shrink-0";
  if (status === "met") return <Check aria-hidden className={cx(cls, "text-ink")} />;
  if (status === "notMet") return <X aria-hidden className={cx(cls, "text-ink-2")} />;
  if (status === "confirm") return <UserCheck aria-hidden className={cx(cls, "text-ink-3")} />;
  return <CircleHelp aria-hidden className={cx(cls, "text-ink-3")} />;
}

/** One requirement's result, with the filing's words when there are some. */
function ResultRow({ r }: { r: ReqResult }) {
  return (
    <li className="flex gap-2">
      <StatusIcon status={r.status} />
      <div className="min-w-0 flex-1 text-[12px] leading-4">
        <p className="text-ink">
          {r.text}
          <span className="ml-1.5 text-[11px] text-ink-3">
            {STATUS_LABEL[r.status]}
            {r.by === "ai" ? " · AI verified" : ""}
          </span>
        </p>
        <p className="mt-0.5 text-ink-2">{r.why}</p>
        {r.evidence && r.evidence.length > 12 ? <p className="mt-0.5 text-ink-3">Filing: “{r.evidence}”</p> : null}
      </div>
    </li>
  );
}

export function roundText(g: GrantProgram): string {
  if (g.open === true) return "Round open";
  if (g.open === false) return "No round open now";
  return "Round status not stated";
}

/**
 * The grant programs this pair fits: one row each, with every requirement and
 * its evidence one click away.
 */
export function FundingMatchBlock({
  screens,
  programs,
  projects,
  utilities,
}: {
  screens: ProgramScreen[];
  programs: GrantProgram[];
  projects: Project[];
  /** Both utilities' short names, to pick out their past awards. */
  utilities: string[];
}) {
  const nameOf = (id: string) => shortProjectName(projects.find((p) => p.id === id)?.name ?? id);
  const program = (id: string) => programs.find((g) => g.id === id);
  const fits = screens
    .map((s) => ({ s, g: program(s.grantId) }))
    .filter((r): r is { s: ProgramScreen; g: GrantProgram } => !!r.g && r.g.requirements.length > 0 && r.s.fit !== "none")
    .sort((x, y) => Number(y.s.fit === "joint") - Number(x.s.fit === "joint"));
  // Past awards to either utility, listed once even when several programs share them.
  const awards = [
    ...new Map(
      fits
        .flatMap((r) => r.g.awards ?? [])
        .filter((a) => utilities.some((u) => norm(a.recipient).includes(norm(u)) || norm(u).includes(norm(a.recipient))))
        .map((a) => [`${a.recipient}|${a.when}`, a]),
    ).values(),
  ];
  if (!fits.length) return null;
  const joint = fits.filter((r) => r.s.fit === "joint").map((r) => r.g.short);
  const anyOpen = fits.some((r) => r.g.open !== false);
  // Only the projects that meet every requirement; a ruled-out one isn't shown under a program it can't use.
  const eligible = (s: ProgramScreen) => s.checks.filter((c) => c.verdict === "fits");

  const checklist = (c: ProjectCheck) => (
    <div key={c.projectId} className="mt-2.5">
      <p className="text-[12px] leading-4 font-medium text-ink">
        {nameOf(c.projectId)} <span className="font-normal text-ink-3">· {VERDICT_LABEL[c.verdict]}</span>
      </p>
      <ul className="mt-1.5 flex flex-col gap-2">
        {c.results.map((r) => (
          <ResultRow key={r.id} r={r} />
        ))}
      </ul>
    </div>
  );

  return (
    <div className="border-t border-hairline px-5 py-5">
      <h3 className="eyebrow mb-2">Funding check</h3>
      <p className="text-[13px] leading-5 text-ink-2">
        {joint.length
          ? `Could apply together for ${joint.join(" and ")}.`
          : `${fits.length} program${fits.length === 1 ? "" : "s"} fit${fits.length === 1 ? "s" : ""} one of these projects.`}
        {anyOpen ? "" : " No round is open now."}
      </p>

      <ul className="mt-3 flex flex-col divide-y divide-hairline">
        {fits.map(({ s, g }) => (
          <li key={g.id} className="py-2 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={g.url}
                target="_blank"
                rel="noreferrer"
                title={g.agency}
                className="text-[13px] leading-[18px] font-medium text-ink underline decoration-hairline-strong underline-offset-2"
              >
                {g.short}
              </a>
              <span className="shrink-0 text-[11px] text-ink-3">
                {s.fit === "joint" ? "Together" : "On its own"}
                {anyOpen ? ` · ${roundText(g)}` : ""}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-4 text-ink-2">
              {eligible(s).map((c) => nameOf(c.projectId)).join(" and ")}
            </p>
            <More label={`${g.requirements.length + s.pair.length} requirements`}>
              {s.pair.length ? (
                <ul className="flex flex-col gap-2">
                  {s.pair.map((r) => (
                    <ResultRow key={r.id} r={r} />
                  ))}
                </ul>
              ) : null}
              {eligible(s).map(checklist)}
              <p className="mt-3 text-[12px] leading-4 text-ink-2">
                {g.agency}. {g.funds} {g.costShare ? `Cost share: ${g.costShare}` : ""}
              </p>
              <p className="mt-1 text-[12px] leading-4 text-ink-3">{g.status}</p>
            </More>
          </li>
        ))}
      </ul>

      {awards.length ? (
        <p className="mt-2 text-[12px] leading-4 text-ink-2">
          Past awards:{" "}
          {awards.map((a, i) => (
            <span key={`${a.recipient}${a.when}`}>
              {i ? "; " : ""}
              <a href={a.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
                {a.recipient}, {a.amount}
              </a>
            </span>
          ))}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] leading-4 text-ink-3">
        Based on public filings; the utility confirms cost match. Not added to savings.
      </p>
    </div>
  );
}

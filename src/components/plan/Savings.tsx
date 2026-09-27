"use client";

import { useState } from "react";
import { COMBINED_CUSTOMERS, DESC_CUSTOMERS, GPC_CUSTOMERS } from "@/lib/customers";
import { fmtInt } from "@/lib/format";
import { sourceHref } from "@/lib/plan";
import { perCustomer, SAVINGS_METHOD, type MatchSavings, type SavingsSummary, type YearPoint } from "@/lib/savings";
import type { SourceRef } from "@/lib/types";
import { useCountUp } from "@/lib/useCountUp";
import { cx, Panel, Tooltip } from "../ui/primitives";

/** Two natural tones for the savings parts (kept apart from the company colours). */
export const PART_COLOR = {
  land: "#6E8B5E",
  crew: "#56708F",
} as const;

export const PART_LABEL = {
  land: "Land & permits",
  crew: "Crew setup",
} as const;

export const HONEST_NOTE =
  "An estimate from published unit costs, in 2026 dollars. Georgia Power does not publish project costs, and yards, surveys and bulk buying are not priced, so real savings could be higher.";

/** "$4.2M", "$369k". */
export function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "–";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

/** Small "estimated" tag set beside a savings figure. */
export function EstimatedTag({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "ml-2 inline-flex h-5 items-center rounded-full border border-dashed border-hairline-strong px-2 align-middle font-sans text-[11px] font-medium tracking-normal text-ink-2",
        className,
      )}
    >
      estimated
    </span>
  );
}

/** Thin stacked bar with a legend: land & permits, crew setup. */
export function SavingsBar({ land, crew }: { land: number; crew: number }) {
  const total = land + crew || 1;
  const parts = (["land", "crew"] as const).map((k) => ({ k, v: k === "land" ? land : crew }));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-wash-2" role="img" aria-label="Savings breakdown">
        {parts.map((p) =>
          p.v > 0 ? (
            <span
              key={p.k}
              className="h-full transition-[width] duration-500"
              style={{ width: `${(p.v / total) * 100}%`, background: PART_COLOR[p.k] }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-4 text-ink-2">
        {parts
          .filter((p) => p.v > 0)
          .map((p) => (
            <li key={p.k} className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: PART_COLOR[p.k] }} />
              {PART_LABEL[p.k]} <span className="num text-ink">{fmtMoney(p.v)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** "estimated · how we calculated this": opens the working in place. */
export function HowCalculated({
  lines,
  unpriced = [],
  linked = false,
}: {
  lines: string[];
  unpriced?: string[];
  /** Point to the "Where this comes from" links. */
  linked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-[12px] text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink-2"
      >
        estimated · how we calculated this
      </button>
      {open ? (
        <div className="mt-2 rounded-[10px] bg-white/55 py-2.5 pr-3 pl-7 text-[12px] leading-[17px] text-ink-2">
          <ul className="flex list-disc flex-col gap-1">
            {lines.map((l, i) => (
              <li key={l} className={i === 0 ? "font-medium text-ink" : undefined}>
                {l}
              </li>
            ))}
          </ul>
          {unpriced.length ? (
            <>
              <p className="mt-2 -ml-4 font-medium text-ink">Not counted, no published price:</p>
              <ul className="mt-1 flex list-disc flex-col gap-1">
                {unpriced.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          ) : null}
          {linked ? (
            <p className="mt-2 -ml-4 text-ink-3">Links to every document are under &ldquo;Where this comes from&rdquo;.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A published document behind a figure, linked to its page. */
export function DocumentLink({ source, note }: { source: SourceRef; note?: string }) {
  const href = sourceHref({ source });
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="-m-1.5 flex items-start gap-2.5 rounded-[8px] p-1.5 transition-colors hover:bg-wash"
      >
        <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded-full bg-hairline-strong" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-[18px] text-ink underline decoration-hairline-strong underline-offset-2">
            {source.document}
          </span>
          <span className="block text-[12px] text-ink-3">
            {source.page != null ? (
              <>
                page <span className="num">{source.page}</span>
              </>
            ) : (
              (note ?? "fact sheet")
            )}
          </span>
        </span>
      </a>
    </li>
  );
}

/** Tiny cumulative-by-year area chart with a cursor on the radar year. */
function YearSpark({ points, year }: { points: YearPoint[]; year: number | null }) {
  const W = 132;
  const H = 30;
  const max = Math.max(1, ...points.map((p) => p.cumulative));
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(" ");
  const cursorIdx = year == null ? -1 : points.findIndex((p) => p.year === year);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0 overflow-visible">
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="rgba(110,139,94,0.16)" />
      <path d={line} fill="none" stroke="#6E8B5E" strokeWidth="1.5" />
      {cursorIdx >= 0 ? (
        <>
          <line x1={x(cursorIdx)} x2={x(cursorIdx)} y1={0} y2={H} stroke="#15181E" strokeWidth="1" />
          <circle cx={x(cursorIdx)} cy={y(points[cursorIdx].cumulative)} r="2.6" fill="#15181E" />
        </>
      ) : null}
    </svg>
  );
}

/** Headline figure with its "estimated" tag. */
export function SavingsHeadline({ summary, size = "md" }: { summary: SavingsSummary; size?: "md" | "xl" }) {
  const total = useCountUp(summary.total);
  const big = size === "xl" ? "text-[44px] leading-[52px]" : "text-[26px] leading-8";
  return (
    <p className={cx("display font-medium text-ink", big)}>
      <span className="tabular-nums">{fmtMoney(total)}</span>
      <EstimatedTag />
    </p>
  );
}

/** Plan-mode card: what the matches shown could save, and when. */
export function SavingsCard({
  summary,
  byYear,
  radarYear,
  assumptions,
}: {
  summary: SavingsSummary;
  byYear: YearPoint[];
  /** Year under the construction radar, or null when the radar is off. */
  radarYear: number | null;
  assumptions: string[];
}) {
  const per = perCustomer(summary.total);
  const shownYear = radarYear ?? byYear.at(-1)?.year ?? null;
  const byThen = byYear.find((p) => p.year === shownYear)?.cumulative ?? summary.total;
  const animatedByThen = useCountUp(byThen, 400);
  const lines = [
    ...SAVINGS_METHOD,
    ...assumptions,
    `Per customer: estimate ÷ ${fmtInt(COMBINED_CUSTOMERS)} customers (${fmtInt(DESC_CUSTOMERS)} Dominion Energy SC + ${fmtInt(GPC_CUSTOMERS)} Georgia Power); one-time and illustrative.`,
  ];

  return (
    <Panel className="shrink-0 px-5 pt-4 pb-4" aria-label="Money saved by working together">
      <div className="text-[13px] font-semibold text-ink">Money saved by working together</div>
      <div className="mt-1.5">
        <SavingsHeadline summary={summary} />
      </div>
      <p className="mt-1 text-[12px] leading-4 text-ink-3">
        <span className="num text-ink-2">{summary.count}</span> matches ·{" "}
        <span className="num text-ink-2">{summary.acres.toFixed(1)}</span> acres of land shared
      </p>
      <div className="mt-3">
        <SavingsBar land={summary.land} crew={summary.crew} />
      </div>
      <div className="mt-3 flex items-center gap-3 border-t border-hairline pt-3">
        <YearSpark points={byYear} year={radarYear} />
        <div className="min-w-0 text-[12px] leading-4 text-ink-3">
          <span className="block">
            By <span className="num text-ink-2">{shownYear ?? "–"}</span>:{" "}
            <span className="num font-medium text-ink">{fmtMoney(animatedByThen)}</span>
            {radarYear == null ? <span className="text-ink-3"> · play the timeline</span> : null}
          </span>
          <Tooltip
            width={290}
            side="bottom"
            content={
              <>
                Estimate ÷ both companies&apos; customers ({fmtInt(DESC_CUSTOMERS)} Dominion Energy SC +{" "}
                {fmtInt(GPC_CUSTOMERS)} Georgia Power). One-time and illustrative: project savings are recovered through
                rates over many years, not refunded.
              </>
            }
          >
            <span className="cursor-help underline decoration-dotted underline-offset-2">
              ≈ <span className="num">${per.toFixed(2)}</span> per customer, one-time (illustrative)
            </span>
          </Tooltip>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-4 text-ink-3">{HONEST_NOTE}</p>
      <div className="mt-1">
        <HowCalculated lines={lines} />
      </div>
    </Panel>
  );
}

/** Per-match savings block for the pair drawer. */
export function MatchSavingsBlock({ savings }: { savings: MatchSavings }) {
  const total = useCountUp(savings.total, 500);
  return (
    <div className="rounded-[12px] border border-hairline bg-white/50 px-4 py-3.5">
      <div className="text-[12px] text-ink-3">Could save by working together</div>
      <p className="display mt-0.5 text-[28px] leading-9 font-medium text-ink">
        <span className="tabular-nums">{fmtMoney(total)}</span>
        <EstimatedTag />
      </p>
      <div className="mt-3">
        <SavingsBar land={savings.land} crew={savings.crew} />
      </div>
      <div className="mt-2.5">
        <HowCalculated lines={savings.lines} unpriced={savings.unpriced} linked />
      </div>
    </div>
  );
}

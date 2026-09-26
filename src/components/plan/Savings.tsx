"use client";

import { useState } from "react";
import { COMBINED_CUSTOMERS, DESC_CUSTOMERS, GPC_CUSTOMERS } from "@/lib/customers";
import { fmtInt } from "@/lib/format";
import { perCustomer, type MatchSavings, type SavingsSummary, type YearPoint } from "@/lib/savings";
import { useCountUp } from "@/lib/useCountUp";
import { cx, Panel, Tooltip } from "../ui/primitives";

/** Three natural tones for the savings parts (kept apart from the company colours). */
export const PART_COLOR = {
  land: "#6E8B5E",
  yard: "#C49A48",
  crew: "#56708F",
} as const;

export const PART_LABEL = {
  land: "Land & permits",
  yard: "Shared yards",
  crew: "Crew setup",
} as const;

export const HONEST_NOTE =
  "Counts only Dominion's disclosed costs; Georgia Power's costs are redacted, so real savings could be higher.";

/** "$4.2M", "$369k". */
export function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

/** "$2.4M–$7.7M", or a single value when low and high agree. */
export function fmtRange(low: number, high: number): string {
  return Math.round(low) === Math.round(high) ? fmtMoney(low) : `${fmtMoney(low)}–${fmtMoney(high)}`;
}

/** First line of every assumptions list: the range and where it comes from. */
export function rangeSourceLine(s: { low: number; high: number; total: number; ranged: boolean }): string {
  return s.ranged
    ? `Range ${fmtRange(s.low, s.high)} (central ${fmtMoney(s.total)}): low, central and high scenarios from the pipeline's cost-range model (plan/insights/cost-ranges.json).`
    : `${fmtMoney(s.total)}: single estimate from the pipeline's cost model (overlap cost in plan/overlaps.json); no range published yet.`;
}

/** Thin stacked bar with a legend: land & permits, shared yards, crew setup. */
export function SavingsBar({ land, yard, crew }: { land: number; yard: number; crew: number }) {
  const total = land + yard + crew || 1;
  const parts = (["land", "yard", "crew"] as const).map((k) => ({
    k,
    v: k === "land" ? land : k === "yard" ? yard : crew,
  }));
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
        {parts.filter((p) => p.v > 0).map((p) => (
          <li key={p.k} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: PART_COLOR[p.k] }} />
            {PART_LABEL[p.k]} <span className="num text-ink">{fmtMoney(p.v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "estimate · how we calculated this": opens the assumptions list in place. */
export function HowCalculated({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-[12px] text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink-2"
      >
        estimate · how we calculated this
      </button>
      {open ? (
        <ul className="mt-2 flex list-disc flex-col gap-1 rounded-[10px] bg-white/55 py-2.5 pr-3 pl-7 text-[12px] leading-[17px] text-ink-2">
          {lines.map((l, i) => (
            <li key={l} className={i === 0 ? "font-medium text-ink" : undefined}>
              {l}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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

/** Headline figure: a range with the central value highlighted, or a single "up to" value. */
export function SavingsHeadline({ summary, size = "md" }: { summary: SavingsSummary; size?: "md" | "xl" }) {
  const central = useCountUp(summary.total);
  const low = useCountUp(summary.low);
  const high = useCountUp(summary.high);
  const ranged = summary.rangedCount > 0 && Math.round(summary.low) !== Math.round(summary.high);
  const big = size === "xl" ? "text-[44px] leading-[52px]" : "text-[26px] leading-8";
  if (!ranged) {
    return (
      <p className={cx("display font-medium text-ink", big)}>
        Up to <span className="tabular-nums">{fmtMoney(central)}</span> could be saved
      </p>
    );
  }
  return (
    <div>
      <p className={cx("display font-medium text-ink", big)}>
        <span className="tabular-nums">
          {fmtMoney(low)}–{fmtMoney(high)}
        </span>
      </p>
      <p className="mt-0.5 text-[13px] text-ink-2">
        estimated savings, most likely about{" "}
        <span className="rounded-[5px] bg-[rgba(110,139,94,0.16)] px-1.5 py-px font-semibold text-ink tabular-nums">
          {fmtMoney(central)}
        </span>
      </p>
    </div>
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
    rangeSourceLine({ ...summary, ranged: summary.rangedCount > 0 }),
    HONEST_NOTE,
    ...assumptions,
    `Per customer: central estimate ÷ ${fmtInt(COMBINED_CUSTOMERS)} customers (${fmtInt(DESC_CUSTOMERS)} Dominion Energy SC + ${fmtInt(GPC_CUSTOMERS)} Georgia Power); one-time and illustrative.`,
  ];

  return (
    <Panel className="shrink-0 px-5 pt-4 pb-4" aria-label="Money saved by working together">
      <div className="text-[13px] font-semibold text-ink">Money saved by working together</div>
      <div className="mt-1.5">
        <SavingsHeadline summary={summary} />
      </div>
      <p className="mt-1 text-[12px] leading-4 text-ink-3">
        <span className="num text-ink-2">{summary.count}</span> matches
        {summary.acres >= 0.1 && (
          <>
            {" "}· <span className="num text-ink-2">{summary.acres.toFixed(1)}</span> acres of land shared
          </>
        )}
      </p>
      <div className="mt-3">
        <SavingsBar land={summary.land} yard={summary.yard} crew={summary.crew} />
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
                Central estimate ÷ both companies&apos; customers ({fmtInt(DESC_CUSTOMERS)} Dominion Energy SC +{" "}
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
export function MatchSavingsBlock({ savings, assumptions }: { savings: MatchSavings; assumptions: string[] }) {
  const central = useCountUp(savings.central, 500);
  const ranged = savings.ranged && Math.round(savings.low) !== Math.round(savings.high);
  const lines = [
    rangeSourceLine({ low: savings.low, high: savings.high, total: savings.central, ranged: savings.ranged }),
    HONEST_NOTE,
    ...assumptions,
  ];
  return (
    <div className="rounded-[12px] border border-hairline bg-white/50 px-4 py-3.5">
      <div className="text-[12px] text-ink-3">Could save by working together</div>
      <p className="display mt-0.5 text-[28px] leading-9 font-medium text-ink">
        {ranged ? (
          <span className="tabular-nums">{fmtRange(savings.low, savings.high)}</span>
        ) : (
          <span className="tabular-nums">{fmtMoney(central)}</span>
        )}
      </p>
      {ranged ? (
        <p className="text-[12px] text-ink-2">
          central <span className="font-semibold text-ink tabular-nums">{fmtMoney(savings.central)}</span>
        </p>
      ) : null}
      <div className="mt-3">
        <SavingsBar land={savings.land} yard={savings.yard} crew={savings.crew} />
      </div>
      <div className="mt-2.5">
        <HowCalculated lines={lines} />
      </div>
    </div>
  );
}

"use client";

import { Check, CircleHelp, X } from "lucide-react";
import {
  STRENGTH_LABEL,
  type Opportunity,
  type OpportunityCheck,
  type OpportunityStrength,
} from "@/lib/opportunities";
import { cx } from "../ui/primitives";

function StrengthTag({ strength }: { strength: OpportunityStrength }) {
  return (
    <span
      className={cx(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
        strength === "required" && "bg-ink text-white",
        strength === "strong" && "border border-hairline-strong bg-white/70 text-ink",
        strength === "possible" && "border border-dashed border-hairline-strong text-ink-2",
      )}
    >
      {STRENGTH_LABEL[strength]}
    </span>
  );
}

/** What was checked before making the suggestion, and what public data cannot show. */
function Checks({ checks }: { checks: OpportunityCheck[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1.5 rounded-[10px] border border-hairline bg-white/60 px-3 py-2.5">
      {checks.map((c) => {
        const Icon = c.ok === true ? Check : c.ok === false ? X : CircleHelp;
        return (
          <li key={c.label} className="flex gap-2 text-[12px] leading-[18px]">
            <Icon
              aria-label={c.ok === true ? "Checked" : c.ok === false ? "Not met" : "Cannot check"}
              className={cx("mt-px size-3.5 shrink-0", c.ok === true ? "text-ink" : "text-ink-3")}
              strokeWidth={2.25}
            />
            <span className="text-ink-2">
              <span className="font-medium text-ink">{c.label}.</span> {c.note}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The specific ways this pair could work together, each with a one-line reason. */
export function PairOpportunities({ opportunities }: { opportunities: Opportunity[] }) {
  return (
    <div className="border-t border-hairline px-5 py-5">
      <h3 className="eyebrow mb-3">Ways to work together</h3>
      {opportunities.length ? (
        <ul className="flex flex-col gap-4">
          {opportunities.map((op) => (
            <li key={`${op.kind}-${op.title}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14px] leading-5 font-semibold text-ink">{op.title}</span>
                <StrengthTag strength={op.strength} />
              </div>
              <p className="mt-1 text-[13px] leading-5 text-ink-2">{op.reason}</p>
              {op.checks?.length ? <Checks checks={op.checks} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] leading-[22px] text-ink-2">
          Nothing specific yet. They are nearby, but do not share a station, route, timing or materials.
        </p>
      )}
    </div>
  );
}

"use client";

import { cx } from "../ui/primitives";
import type { Measure } from "./useCrosswire";

/** How a pair's distance is measured: closest points (the official rule) or centre points. */
export function MeasureToggle({ value, onChange }: { value: Measure; onChange: (m: Measure) => void }) {
  const opts: { v: Measure; label: string; hint: string }[] = [
    {
      v: "closest",
      label: "Closest points",
      hint: "Official rule: measured between the nearest points of the two projects.",
    },
    { v: "center", label: "Centers", hint: "Measured between the middle of each project." },
  ];
  return (
    <div role="radiogroup" aria-label="Measure distance between" className="flex rounded-[10px] bg-wash-2 p-[3px]">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          title={o.hint}
          onClick={() => onChange(o.v)}
          className={cx(
            "h-7 flex-1 whitespace-nowrap rounded-[8px] px-2 text-[12px] font-medium transition-colors",
            value === o.v ? "bg-white text-ink shadow-[0_0_0_1px_rgba(20,24,30,0.08)]" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

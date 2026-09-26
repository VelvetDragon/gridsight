"use client";

import { RIGHT_SIZING_TIP } from "@/lib/plan";
import { cx, Tooltip } from "../ui/primitives";

/** Subtle marker for FERC Order 1920-A right-sizing candidates (a rebuild on either side). */
export function RightSizingChip({ compact = false }: { compact?: boolean }) {
  return (
    <Tooltip content={RIGHT_SIZING_TIP} width={260} focusable={!compact}>
      <span
        className={cx(
          "inline-flex h-[22px] items-center rounded-full border border-dashed border-hairline-strong px-2 text-[12px] font-medium whitespace-nowrap text-ink-2",
          compact ? "bg-transparent" : "bg-white/50",
        )}
      >
        Right-sizing candidate
      </span>
    </Tooltip>
  );
}

"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { ReactNode } from "react";
import { TIER_LABEL } from "@/lib/theme";
import { cx } from "../ui/primitives";
import type { CrosswireState } from "./useCrosswire";

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-white/70 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Title row for an open pair: its rank and kind, step to the neighbouring pairs, close. */
export function PairPanelHeader({ cw, className }: { cw: CrosswireState; className?: string }) {
  const item = cw.selected;
  if (!item) return null;
  const i = cw.ranked.findIndex((r) => r.overlap.id === item.overlap.id);
  const prev = i > 0 ? cw.ranked[i - 1] : null;
  const next = i >= 0 && i < cw.ranked.length - 1 ? cw.ranked[i + 1] : null;
  return (
    <header className={cx("flex items-center gap-1 border-b border-hairline px-5 py-3", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-4 text-ink-3">
          Pair {item.rank} of {cw.ranked.length}
        </p>
        <h2 className="display truncate text-[20px] leading-7 font-medium text-ink">{TIER_LABEL[item.overlap.tier]}</h2>
      </div>
      <StepButton label="Previous pair" disabled={!prev} onClick={() => prev && cw.selectOverlap(prev.overlap.id)}>
        <ChevronUp size={16} aria-hidden />
      </StepButton>
      <StepButton label="Next pair" disabled={!next} onClick={() => next && cw.selectOverlap(next.overlap.id)}>
        <ChevronDown size={16} aria-hidden />
      </StepButton>
      <button
        type="button"
        onClick={cw.clearMatch}
        aria-label="Close this pair (Esc)"
        title="Close (Esc)"
        className="-mr-2 flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-2 hover:bg-white/70 hover:text-ink"
      >
        <X size={16} aria-hidden />
      </button>
    </header>
  );
}

"use client";

import { Pause, Play } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./primitives";

export interface ScrubberTick {
  value: number;
  label: string;
  /** Minor ticks hide when the track is narrow. */
  minor?: boolean;
}

/**
 * Timeline scrubber: play/pause, a current-value label, and a range track with
 * labelled ticks. `histogram` (0..1 heights, evenly spaced) draws a quiet
 * activity profile behind the track.
 */
export function Scrubber({
  label,
  min,
  max,
  step,
  value,
  onChange,
  playing,
  onToggle,
  ticks,
  current,
  histogram,
  dimmed = false,
  trailing,
  valueText,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  playing: boolean;
  onToggle: () => void;
  ticks: ScrubberTick[];
  current: ReactNode;
  histogram?: number[];
  dimmed?: boolean;
  trailing?: ReactNode;
  valueText?: string;
}) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="flex h-full items-center gap-4 px-3">
      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? "Pause" : "Play"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-transform duration-150 hover:scale-[1.04] active:scale-95"
      >
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-[1px]" />}
      </button>
      <div className="w-[156px] shrink-0">{current}</div>
      <div className="@container relative min-w-0 flex-1 pt-1">
        <div className="relative h-7">
          {histogram && histogram.length ? (
            <svg
              className="pointer-events-none absolute inset-x-[7px] top-0 h-[14px] w-[calc(100%-14px)]"
              viewBox={`0 0 ${histogram.length} 1`}
              preserveAspectRatio="none"
              aria-hidden
            >
              {histogram.map((h, i) => (
                <rect key={i} x={i + 0.12} width={0.76} y={1 - h} height={h} fill="rgba(20,22,28,0.16)" />
              ))}
            </svg>
          ) : null}
          <input
            type="range"
            aria-label={label}
            aria-valuetext={valueText}
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className={cx("range absolute inset-x-0 bottom-0", dimmed && "opacity-50")}
            style={{ ["--fill" as string]: `${pct}%` }}
          />
        </div>
        <div className="relative mx-[7px] h-4">
          {ticks.map((t) => {
            const left = ((t.value - min) / (max - min || 1)) * 100;
            return (
              <span
                key={`${t.value}-${t.label}`}
                className={cx(
                  "num absolute top-0 text-[11px] whitespace-nowrap text-ink-3",
                  left > 94 ? "-translate-x-full" : left < 4 ? "" : "-translate-x-1/2",
                  t.minor && "hidden @[520px]:inline",
                )}
                style={{ left: `${left}%` }}
              >
                {t.label}
              </span>
            );
          })}
        </div>
      </div>
      {trailing}
    </div>
  );
}

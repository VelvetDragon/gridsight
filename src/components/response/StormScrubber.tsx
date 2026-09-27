"use client";

import { fmtUtc, stormCategoryShort } from "@/lib/format";
import { REPLAY_STEP_MS, stormAt } from "@/lib/response";
import type { Storm } from "@/lib/types";
import { Panel } from "../ui/primitives";
import { Scrubber, type ScrubberTick } from "../ui/Scrubber";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR = 3600 * 1000;

/** Bottom replay control: scrub the storm over its best-track times. */
export function StormScrubber({
  storm,
  times,
  value,
  playing,
  onSeek,
  onToggle,
}: {
  storm: Storm;
  times: number[];
  value: number;
  playing: boolean;
  onSeek: (ms: number) => void;
  onToggle: () => void;
}) {
  const min = times[0];
  const max = times[times.length - 1];
  const frame = stormAt(storm, times, value);

  // Day labels at 00 UTC, 12 UTC as minor ticks.
  const ticks: ScrubberTick[] = [];
  // Long replays label every other day, and never right at the end, so dates don't collide.
  const every = (max - min) / (24 * HOUR) > 8 ? 2 : 1;
  const first = Math.ceil(min / (12 * HOUR)) * 12 * HOUR;
  for (let t = first; t <= max; t += 12 * HOUR) {
    const d = new Date(t);
    const day = Math.round(t / (24 * HOUR));
    const labelled = d.getUTCHours() === 0 && day % every === 0 && max - t > 12 * HOUR;
    ticks.push({
      value: t,
      label: labelled ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : "",
      minor: !labelled,
    });
  }

  // Track intensity as a quiet profile behind the scrubber.
  const peak = Math.max(1, ...storm.track.map((p) => p.windKt));
  const steps = Math.max(1, Math.round((max - min) / REPLAY_STEP_MS));
  const bins = Math.min(steps, 96);
  const histogram = Array.from({ length: bins }, (_, i) => {
    const f = stormAt(storm, times, min + ((max - min) * (i + 0.5)) / bins);
    return f ? f.windKt / peak : 0;
  });

  return (
    <Panel className="h-[72px]" aria-label="Storm replay">
      <Scrubber
        label="Replay time"
        min={min}
        max={max}
        step={REPLAY_STEP_MS}
        value={value}
        valueText={fmtUtc(value)}
        onChange={onSeek}
        playing={playing}
        onToggle={onToggle}
        ticks={ticks}
        histogram={histogram}
        current={
          <div className="flex min-w-0 flex-col">
            <span className="display truncate text-[16px] leading-5 font-medium text-ink">
              {storm.name}, <span className="tabular-nums">{fmtUtc(value)}</span>
            </span>
            <span className="truncate text-[12px] leading-4 text-ink-3">
              {frame ? (
                <>
                  {stormCategoryShort(frame.windKt)} · <span className="num">{Math.round(frame.windKt)} kt</span>
                  {frame.pressureMb != null ? (
                    <>
                      {" "}
                      · <span className="num">{Math.round(frame.pressureMb)} mb</span>
                    </>
                  ) : null}
                </>
              ) : (
                "no track"
              )}
            </span>
          </div>
        }
      />
    </Panel>
  );
}

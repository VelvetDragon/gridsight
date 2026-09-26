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
  const first = Math.ceil(min / (12 * HOUR)) * 12 * HOUR;
  for (let t = first; t <= max; t += 12 * HOUR) {
    const d = new Date(t);
    const midnight = d.getUTCHours() === 0;
    ticks.push({
      value: t,
      label: midnight ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}` : "12Z",
      minor: !midnight,
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
    <Panel className="h-[76px]" aria-label="Storm replay">
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
          <div className="flex flex-col">
            <span className="eyebrow">
              {storm.name} {storm.year}
            </span>
            <span className="num text-[14px] leading-5 font-medium text-ink">{fmtUtc(value)}</span>
            <span className="text-[12px] leading-4 text-ink-3">
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

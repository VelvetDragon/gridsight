"use client";

import { useMemo } from "react";
import type { RankedOverlap } from "@/lib/ranking";
import { monthLabel, phaseAt, RADAR_END_YEAR, RADAR_MONTHS, RADAR_START_YEAR } from "@/lib/timeline";
import type { Project } from "@/lib/types";
import { Panel } from "../ui/primitives";
import { Scrubber } from "../ui/Scrubber";

export interface RadarBarProps {
  projects: Project[];
  ranked: RankedOverlap[];
  projectsById: Map<string, Project>;
  enabled: boolean;
  month: number;
  playing: boolean;
  onSeek: (m: number) => void;
  onToggle: () => void;
  onEnabled: (on: boolean) => void;
}

/** Bottom "construction radar": scrub 2026–2035 and watch work come and go. */
export function RadarBar(props: RadarBarProps) {
  const { projects, ranked, projectsById, enabled, month, playing } = props;

  const histogram = useMemo(() => {
    const counts = Array.from({ length: RADAR_MONTHS }, (_, m) =>
      projects.reduce((n, p) => n + (phaseAt(p, m + 0.5) === "building" ? 1 : 0), 0),
    );
    const peak = Math.max(1, ...counts);
    return counts.map((c) => c / peak);
  }, [projects]);

  const building = enabled ? projects.filter((p) => phaseAt(p, month) === "building").length : 0;
  const activePairs = enabled
    ? ranked.filter((r) => {
        const a = projectsById.get(r.overlap.descId);
        const b = projectsById.get(r.overlap.gpcId);
        return a && b && phaseAt(a, month) === "building" && phaseAt(b, month) === "building";
      }).length
    : 0;

  const ticks = [];
  for (let y = RADAR_START_YEAR; y <= RADAR_END_YEAR; y++) {
    ticks.push({ value: (y - RADAR_START_YEAR) * 12, label: String(y), minor: (y - RADAR_START_YEAR) % 2 === 1 });
  }

  return (
    <Panel className="h-[72px]" aria-label="When they build">
      <Scrubber
        label="Construction radar month"
        min={0}
        max={RADAR_MONTHS - 1}
        step={1}
        value={month}
        valueText={enabled ? monthLabel(month) : "All years"}
        onChange={(m) => {
          if (!enabled) props.onEnabled(true);
          props.onSeek(m);
        }}
        playing={playing}
        onToggle={() => {
          if (!enabled) props.onEnabled(true);
          props.onToggle();
        }}
        ticks={ticks}
        histogram={histogram}
        dimmed={!enabled}
        current={
          <div className="flex flex-col">
            <span className="display text-[16px] leading-5 font-medium text-ink">
              {enabled ? monthLabel(month) : "When they build"}
            </span>
            <span className="text-[12px] leading-4 text-ink-3">
              {enabled ? (
                <>
                  <span className="num">{building}</span> projects under way
                  {activePairs > 0 ? (
                    <>
                      {", "}
                      <span className="font-medium text-ink">
                        <span className="num">{activePairs}</span> pairs at once
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                "Press play to watch 2026–2035"
              )}
            </span>
          </div>
        }
        trailing={
          enabled ? (
            <button
              type="button"
              onClick={() => props.onEnabled(false)}
              className="h-7 shrink-0 rounded-full border border-hairline-strong bg-white px-2.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              Show all years
            </button>
          ) : null
        }
      />
    </Panel>
  );
}

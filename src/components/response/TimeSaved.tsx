"use client";

import { fmtHours, timeSaved, type MutualAid, type RestorationScenario } from "@/lib/savings";
import { useCountUp } from "@/lib/useCountUp";
import { HowCalculated } from "../plan/Savings";

const SEPARATE = "#8A93A3";
const COORDINATED = "#0E6B5C";

/** Two restoration curves (% of customers with power back vs hours). */
export function RestorationChart({
  separate,
  coordinated,
  width = 320,
  height = 120,
}: {
  separate: RestorationScenario;
  coordinated: RestorationScenario;
  width?: number;
  height?: number;
}) {
  const pad = { l: 30, r: 8, t: 8, b: 20 };
  const maxH = Math.max(
    ...separate.restorationCurve.map((p) => p.hour),
    ...coordinated.restorationCurve.map((p) => p.hour),
    1,
  );
  const x = (h: number) => pad.l + (h / maxH) * (width - pad.l - pad.r);
  const y = (pct: number) => pad.t + (1 - pct / 100) * (height - pad.t - pad.b);
  const path = (s: RestorationScenario) =>
    s.restorationCurve
      .map((p, i) => `${i ? "L" : "M"}${x(p.hour).toFixed(1)},${y(p.pctRestored).toFixed(1)}`)
      .join(" ");
  const ticks = [0, 24, 48, 72, 96, 120, 144, 168, 192].filter((t) => t <= maxH);
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label="Share of customers with power back over time, separate versus working together"
      >
        {[0, 50, 90, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(20,24,30,0.08)" />
            <text x={pad.l - 6} y={y(v) + 3} fontSize="9.5" textAnchor="end" fill="#555C6B" className="tabular-nums">
              {v}%
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={height - 6}
            fontSize="9.5"
            textAnchor="middle"
            fill="#555C6B"
            className="tabular-nums"
          >
            {t === 0 ? "0 h" : `${t}`}
          </text>
        ))}
        <path d={path(separate)} fill="none" stroke={SEPARATE} strokeWidth="2" strokeDasharray="4 3" />
        <path d={path(coordinated)} fill="none" stroke={COORDINATED} strokeWidth="2.4" />
        <line
          x1={x(coordinated.hoursTo90pct)}
          x2={x(separate.hoursTo90pct)}
          y1={y(90)}
          y2={y(90)}
          stroke="#15181E"
          strokeWidth="1.2"
          markerEnd="none"
        />
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke={COORDINATED} strokeWidth="2.4" />
          </svg>
          Working together
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke={SEPARATE} strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Each on its own
        </span>
        <span className="text-ink-3">hours after landfall</span>
      </figcaption>
    </figure>
  );
}

/** "Time saved by working together" headline card (Response mode). */
export function TimeSavedCard({ aid }: { aid: MutualAid }) {
  const saved = timeSaved(aid);
  const hours = useCountUp(saved.to90);
  const { separate, coordinated } = aid.scenarios;
  const lines = [
    `Hours until 90% of customers have power: ${separate.hoursTo90pct} h each on its own, ${coordinated.hoursTo90pct} h working together (mutual-aid scenarios from the pipeline, mutual-aid.json).`,
    ...aid.assumptions,
  ];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="display text-[26px] leading-8 font-medium text-ink">
          Power back <span className="tabular-nums">{Math.round(hours)}</span> hours sooner
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          when 90% of homes are restored, if both companies share crews and yards.
        </p>
      </div>
      <p className="rounded-[10px] bg-white/55 px-3 py-2 text-[13px] leading-5 text-ink">
        Vulnerable residents get power back{" "}
        <span className="font-semibold">{fmtHours(saved.vulnerableTo90)} sooner</span>.
      </p>
      <RestorationChart separate={separate} coordinated={coordinated} />
      <HowCalculated lines={lines} />
    </div>
  );
}

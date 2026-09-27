"use client";

import { fmtInt, fmtUsd } from "@/lib/format";
import { outageCostLines, restorationValue, type OutageCost } from "@/lib/outageCost";
import { fmtHours, fmtHoursNumber, timeSaved, type MutualAid, type RestorationScenario } from "@/lib/savings";
import type { CountyOutage } from "@/lib/types";
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
        aria-label="Share of damaged transmission line sections repaired over time, separate versus working together"
      >
        {[0, 50, 100].map((v) => (
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
        <span className="text-ink-3">% of damaged lines repaired, hours after repairs start</span>
      </figcaption>
    </figure>
  );
}

/** "Time and money saved by working together" headline card (Response mode). */
export function TimeSavedCard({
  aid,
  counties,
  outageCost,
}: {
  aid: MutualAid;
  counties: CountyOutage[];
  outageCost: OutageCost | null;
}) {
  const saved = timeSaved(aid);
  const hours = useCountUp(saved.to90);
  const { separate, coordinated } = aid.scenarios;
  const value = outageCost ? restorationValue(aid, counties, outageCost) : null;
  const lines = [
    `Hours until 90% of the damaged transmission lines are repaired: ${separate.hoursTo90pct} h each on its own, ${coordinated.hoursTo90pct} h working together (mutual-aid scenarios from the pipeline, mutual-aid.json).`,
    ...(value && outageCost
      ? [
          `Outage cost avoided: ${fmtInt(value.customers)} customers out x ${value.avgHoursSooner.toFixed(1)} hours sooner on average (area between the two curves) x the utility's cost per customer-hour = ${fmtUsd(value.usd, { compact: false })}.`,
          ...outageCostLines(outageCost),
        ]
      : []),
    ...aid.assumptions,
  ];
  if (saved.to90 < 0.5 && saved.vulnerableTo90 < 0.5) {
    return (
      <div className="flex flex-col gap-2">
        <p className="display text-[22px] leading-7 font-medium text-ink">Each company can handle this one alone</p>
        <p className="text-[13px] leading-5 text-ink-2">
          The damage is light or far apart, so sharing crews does not bring power back sooner for this storm. Sharing a staging
          yard where the damage is close still saves driving and set-up (see Team up on the right).
        </p>
        <HowCalculated lines={lines} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="display text-[26px] leading-8 font-medium text-ink">
          Power back <span className="tabular-nums">{fmtHoursNumber(hours)}</span> hours sooner
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          to repair 90% of the damaged transmission lines, if both companies share crews and yards.
        </p>
      </div>
      {value && value.usd >= 1 ? (
        <p className="rounded-[10px] bg-white/55 px-3 py-2 text-[13px] leading-5 text-ink">
          Up to <span className="font-semibold">{fmtUsd(value.usd)}</span> in outage costs avoided:{" "}
          {fmtInt(value.customers)} customers back about {fmtHours(value.avgHoursSooner)} sooner on average, at $
          {Math.round(value.byUtility[0].usdPerCustomerHour)} (SC) and ${Math.round(value.byUtility[1].usdPerCustomerHour)}{" "}
          (GA) per customer-hour.
        </p>
      ) : null}
      {saved.vulnerableTo90 >= 0.5 ? (
        <p className="rounded-[10px] bg-white/55 px-3 py-2 text-[13px] leading-5 text-ink">
          Vulnerable residents get power back{" "}
          <span className="font-semibold">{fmtHours(saved.vulnerableTo90)} sooner</span>.
        </p>
      ) : null}
      <RestorationChart separate={separate} coordinated={coordinated} />
      <HowCalculated lines={lines} />
    </div>
  );
}

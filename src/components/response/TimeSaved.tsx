"use client";

import { fmtInt, fmtUsd } from "@/lib/format";
import { outageCostLines, restorationValue, type OutageCost } from "@/lib/outageCost";
import { fmtHours, fmtHoursNumber, timeSaved, workSplit, type MutualAid, type RestorationScenario } from "@/lib/savings";
import { useCountUp } from "@/lib/useCountUp";
import type { CountyOutage } from "@/lib/types";
import { HowCalculated } from "../plan/Savings";

const SEPARATE = "#8A93A3";
const COORDINATED = "#0E6B5C";

/** Two simulated repair curves (% of damaged transmission line sections repaired vs hours). */
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
          Sharing crews
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" y1="3" x2="18" y2="3" stroke={SEPARATE} strokeWidth="2" strokeDasharray="4 3" />
          </svg>
          Each on its own
        </span>
        <span className="text-ink-3">% of simulated damaged transmission lines repaired, hours after repairs start</span>
      </figcaption>
    </figure>
  );
}

/**
 * Rough outage cost avoided by the crew-sharing what-if (see outageCost.ts). Shown for every
 * storm; `hidden` replaces it with the reason when the model's outages run well above the
 * published ones.
 */
export function OutageCostLine({
  aid,
  counties,
  outageCost,
  hidden,
}: {
  aid: MutualAid;
  counties: CountyOutage[];
  outageCost: OutageCost | null;
  hidden?: string;
}) {
  if (!outageCost) return null;
  const value = restorationValue(aid, counties, outageCost);
  return (
    <div className="rounded-[10px] bg-white/55 px-3 py-2">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">Outage costs avoided · rough estimate</p>
      {hidden ? (
        <p className="text-[13px] leading-5 text-ink-2">Not shown for this storm. {hidden}</p>
      ) : (
        <>
          <p className="text-[13px] leading-5 text-ink">
            About <span className="font-semibold tabular-nums">{fmtUsd(value.usd, { compact: true })}</span> for homes and
            businesses
          </p>
          <p className="text-[12px] leading-5 text-ink-3">
            {fmtInt(value.customers)} customers out because of transmission damage (about 10% of outages) x{" "}
            {value.avgHoursSooner.toFixed(1)} h sooner on average x about $
            {Math.round(value.customerHours ? value.usd / value.customerHours : value.byUtility[0]?.usdPerCustomerHour ?? 0)} per
            customer-hour (LBNL outage-cost survey).
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The crew-sharing what-if (Response mode). A simulation of transmission repairs only,
 * against a baseline where neither company gets outside help, so it is labeled as a
 * what-if and never as "power back sooner". The dollar figure is a rough estimate:
 * the hours sooner priced at LBNL ICE 2.0 outage costs (see outageCost.ts).
 */
export function TimeSavedCard({
  aid,
  counties,
  outageCost,
  outageCostHidden,
}: {
  aid: MutualAid;
  counties: CountyOutage[];
  outageCost: OutageCost | null;
  outageCostHidden?: string;
}) {
  const saved = timeSaved(aid);
  const hours = useCountUp(saved.to90);
  const { separate, coordinated } = aid.scenarios;
  const split = workSplit(aid);
  const total = split ? split.desc + split.gpc : 0;
  const minor = split && total > 0 ? (split.desc < split.gpc ? { name: "Dominion Energy SC", share: split.desc / total, helper: "Georgia Power" } : { name: "Georgia Power", share: split.gpc / total, helper: "Dominion Energy SC" }) : null;
  const lopsided = minor && minor.share < 0.1 ? minor : null;
  const lines = [
    `Hours until 90% of the simulated damaged transmission line sections are repaired: ${separate.hoursTo90pct} h each on its own, ${coordinated.hoursTo90pct} h sharing crews (mutual-aid.json).`,
    "This is transmission only. Most customer outages in hurricanes come from damage to local distribution lines, which is not modeled here, so these hours are not the time until customers get power back.",
    "The \"each on its own\" baseline assumes no outside help. In reality both companies bring in contractors and crews from other utilities through regional mutual-assistance groups, so the real difference would be smaller.",
    "The crew numbers are not published figures. They are Helene storm totals (Dominion: more than 4,000 crew members from 14 states; Georgia Power: 20,000+ personnel including 35+ outside companies), which already include outside mutual-aid crews, times an assumed 5% on transmission. For comparison, Dominion listed 57 transmission linemen for Helene, while the model gives it 40 crews of 5 (200 people).",
    ...aid.assumptions,
  ];
  const value = outageCost ? restorationValue(aid, counties, outageCost) : null;
  if (value && outageCost && !outageCostHidden) {
    lines.push(
      `Outage cost estimate: ${fmtInt(value.customers)} customers out because of transmission damage x ${value.avgHoursSooner.toFixed(1)} hours sooner on average (the gap between the two repair curves) x the cost of an outage hour.`,
      ...outageCostLines(outageCost),
    );
  }
  const cost = <OutageCostLine aid={aid} counties={counties} outageCost={outageCost} hidden={outageCostHidden} />;
  const caveat = (
    <p className="text-[12px] leading-5 text-ink-3">
      Simulation, transmission lines only. Most outages come from local distribution lines, and both companies already
      bring in outside crews through mutual assistance, so this is not a forecast of when customers get power back.
    </p>
  );
  if (saved.to90 < 0.5 && saved.vulnerableTo90 < 0.5) {
    return (
      <div className="flex flex-col gap-2">
        <p className="display text-[22px] leading-7 font-medium text-ink">Sharing crews barely changes this one</p>
        <p className="text-[13px] leading-5 text-ink-2">
          In the simulation, 90% of the damaged transmission lines are repaired in about {fmtHours(separate.hoursTo90pct)}{" "}
          either way. The damage is light or each company has enough crews for its own share.
        </p>
        {cost}
        {caveat}
        <HowCalculated lines={lines} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase">What-if simulation</p>
        <p className="display text-[26px] leading-8 font-medium text-ink">
          Transmission repairs <span className="tabular-nums">{fmtHoursNumber(hours)}</span> hours sooner
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          90% of the simulated damaged transmission lines fixed in {fmtHours(coordinated.hoursTo90pct)} instead of{" "}
          {fmtHours(separate.hoursTo90pct)}, if each company&apos;s crews also took the other&apos;s jobs.
        </p>
      </div>
      {lopsided ? (
        <p className="rounded-[10px] bg-white/55 px-3 py-2 text-[13px] leading-5 text-ink">
          {lopsided.name} has only {Math.round(lopsided.share * 100)}% of the simulated damage, so almost all of this gain is{" "}
          {lopsided.helper}&apos;s crews helping {lopsided.name === "Georgia Power" ? "Dominion Energy SC" : "Georgia Power"}.
        </p>
      ) : null}
      {saved.vulnerableTo90 >= 0.5 ? (
        <p className="rounded-[10px] bg-white/55 px-3 py-2 text-[13px] leading-5 text-ink">
          Repairs near people on powered medical equipment{" "}
          <span className="font-semibold">{fmtHours(saved.vulnerableTo90)} sooner</span> in the same simulation.
        </p>
      ) : null}
      {cost}
      <RestorationChart separate={separate} coordinated={coordinated} />
      {caveat}
      <HowCalculated lines={lines} />
    </div>
  );
}

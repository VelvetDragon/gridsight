"use client";

import { ArrowRight, Handshake, PanelRightClose, PanelRightOpen, Tent, Truck, Users } from "lucide-react";
import type { ResponseData } from "@/lib/data";
import { fmtInt, fmtUsd } from "@/lib/format";
import { andList, AVERAGE_GAIN, moveKey, teamUpImpact, type LendMove, type TeamUp, type TeamUpMove, type TeamUpOwner } from "@/lib/teamup";
import { timeSaved } from "@/lib/savings";
import { NAV_CLEARANCE } from "../shell/AppShell";
import { RAIL_GUTTER } from "../shell/Rail";
import type { Position } from "@/lib/types";
import { cx } from "../ui/primitives";
import { Block, More } from "./StormSections";

const ROLE_STYLE: Record<TeamUpOwner["role"], string> = {
  "needs help": "bg-alert/10 text-alert",
  "can help": "bg-[#3F8F5B]/10 text-[#2F6F45]",
  busy: "bg-wash-2 text-ink-2",
  "little on this map": "bg-wash text-ink-3",
};

function hours(h: number): string {
  if (h < 1) return "under an hour";
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/** One plain sentence: who is hit, who can help, and whether neighbours are enough. */
function lead(t: TeamUp, storm: string): string {
  const name = new Map(t.owners.map((o) => [o.id, o.name]));
  const need = t.owners.filter((o) => o.role === "needs help");
  const lends = t.moves.filter((m) => m.kind === "lend");
  if (!need.length) {
    return `${storm} damages lines on ${t.owners.filter((o) => o.damagedSections >= 1).length} systems, but every utility can finish its own repairs within a day. Sharing yards still saves driving.`;
  }
  const needNames = andList(need.slice(0, 3).map((o) => o.name));
  if (!lends.length) {
    return `${needNames} would each need more than a day of repairs on their own, and the neighbours with spare crews are too few or too far to make a real difference. Call national mutual aid early.`;
  }
  const giverList = [...new Set(lends.map((m) => name.get(m.from) ?? m.from))].slice(0, 3);
  const many = giverList.length > 1;
  return `${needNames} would need more than a day of repairs on their own. ${andList(giverList)} ${many ? "have" : "has"} crews to spare and ${many ? "are" : "is"} close enough to help.`;
}

function usd(n: number): string {
  return fmtUsd(n, { compact: n >= 100000 });
}

/** The full working for a lend move, step by step, with the numbers the pipeline used. */
function LendExplain({ m, n }: { m: LendMove; n: (id: string) => string }) {
  const c = m.cost;
  if (!c || m.hoursBefore == null || m.hoursAfter == null) return null;
  const eff = Math.round((m.efficiency ?? 0.85) * 100);
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-hairline pt-3 text-[12.5px] leading-[18px] text-ink-2">
      <div>
        <div className="font-medium text-ink">1. How much sooner</div>
        <p className="mt-0.5">
          {n(m.to)} has about {fmtInt(m.receiverWorkHours ?? 0)} crew-hours of repairs and {fmtInt(m.receiverCrews ?? 0)} crews
          of its own: <b className="text-ink">{hours(m.hoursBefore)}</b> of work alone. {n(m.from)} adds {fmtInt(m.crews)} crews,
          working at {eff}% on unfamiliar equipment, so the work takes <b className="text-ink">{hours(m.hoursAfter)}</b>. Minus{" "}
          {hours(m.driveHours)} to drive there: power back about <b className="text-ink">{hours(m.hoursSooner)} sooner</b>.
        </p>
      </div>
      <div>
        <div className="font-medium text-ink">2. What it costs</div>
        <table className="mt-1 w-full tabular-nums">
          <tbody>
            <tr>
              <td className="py-0.5">Line workers</td>
              <td className="py-0.5 text-right">
                {fmtInt(c.crews)} crews x {c.workersPerCrew} = <b className="text-ink">{fmtInt(c.workers)}</b>
              </td>
            </tr>
            <tr>
              <td className="py-0.5">Paid hours each</td>
              <td className="py-0.5 text-right">
                {c.workHours} work + {c.driveHoursBothWays} drive = <b className="text-ink">{c.paidHours} h</b>
              </td>
            </tr>
            <tr>
              <td className="py-0.5">Storm wage</td>
              <td className="py-0.5 text-right">
                ${c.wageUsdH.toFixed(2)} x {c.overtime} = <b className="text-ink">${c.stormWageUsdH.toFixed(2)}/h</b>
              </td>
            </tr>
            <tr>
              <td className="py-0.5">Labor</td>
              <td className="py-0.5 text-right">
                {fmtInt(c.workers)} x {c.paidHours} h x ${c.stormWageUsdH.toFixed(2)} = <b className="text-ink">{usd(c.laborUsd)}</b>
              </td>
            </tr>
            <tr>
              <td className="py-0.5">Meals and lodging</td>
              <td className="py-0.5 text-right">
                {fmtInt(c.workers)} x {c.days} days x ${c.perDiemUsd} = <b className="text-ink">{usd(c.perDiemTotalUsd)}</b>
              </td>
            </tr>
            <tr className="border-t border-hairline">
              <td className="pt-1 font-medium text-ink">Total</td>
              <td className="pt-1 text-right font-medium text-ink">{usd(c.totalUsd)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-1 text-[11.5px] text-ink-3">
          Wage: US median for power-line workers (BLS, May 2024), paid at time and a half in storms. Trucks, fuel and
          equipment are not included. Days count 16-hour storm shifts.
        </p>
      </div>
    </div>
  );
}

function MoveRow({
  m,
  names,
  selected,
  onPick,
}: {
  m: TeamUpMove;
  names: Map<string, string>;
  selected: boolean;
  onPick: (m: TeamUpMove) => void;
}) {
  const n = (id: string) => names.get(id) ?? id;
  const card = cx(
    "w-full rounded-[10px] border px-3.5 py-3 text-left transition-colors",
    selected ? "border-[#2F6F45]/50 bg-white shadow-[0_0_0_3px_rgba(47,111,69,0.12)]" : "border-hairline bg-white/60 hover:bg-white",
  );
  if (m.kind === "lend") {
    return (
      <li className={card}>
        <button type="button" onClick={() => onPick(m)} aria-expanded={selected} className="w-full text-left">
          <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
            <Truck size={14} aria-hidden className="text-[#2F6F45]" />
            {n(m.from)} <ArrowRight size={13} aria-hidden className="text-ink-3" /> {n(m.to)}
          </span>
          <span className="mt-1 block text-[13px] leading-[19px] text-ink-2">
            Lend <b className="text-ink">{fmtInt(m.crews)} crews</b> ({fmtInt(m.cost?.workers ?? m.crews * 5)} line workers),{" "}
            {hours(m.driveHours)} drive. {n(m.to)} gets power back about <b className="text-ink">{hours(m.hoursSooner)} sooner</b>{" "}
            for about {usd(m.costUsd)} in crew time.
          </span>
          {!selected ? <span className="mt-1 block text-[12px] text-ink-3">Tap to see how this is worked out</span> : null}
        </button>
        {selected ? <LendExplain m={m} n={n} /> : null}
      </li>
    );
  }
  const Icon = m.kind === "yard" ? Tent : Users;
  return (
    <li className={card}>
      <button type="button" onClick={() => onPick(m)} aria-expanded={selected} className="w-full text-left">
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
          <Icon size={14} aria-hidden className="text-[#2F6F45]" />
          {n(m.a)} + {n(m.b)}: {m.kind === "yard" ? "share a staging yard" : "share crews in the field"}
        </span>
        <span className="mt-1 block text-[13px] leading-[19px] text-ink-2">
          {m.why} {fmtInt(m.sectionsNearby)} damaged sections nearby.
        </span>
      </button>
      {selected ? (
        <p className="mt-3 border-t border-hairline pt-3 text-[12.5px] leading-[18px] text-ink-2">
          {m.kind === "yard"
            ? `A staging yard is where crews, trucks, poles and wire gather before heading out. Here both utilities' damage is ${m.distanceKm} km apart, so one yard can serve both: one site to set up, secure and supply instead of two, and crews start closer to the work.`
            : `The two systems' damage is ${Math.round(m.distanceKm)} km apart, within a crew's morning drive. A crew that finishes one utility's repairs can move straight to the other's instead of waiting or driving home.`}
        </p>
      ) : null}
    </li>
  );
}

export const PANEL_W = 372;

/** Width the map should keep clear on the right for the team-up panel. */
export function panelInset(open: boolean): number {
  if (typeof window !== "undefined" && window.innerWidth < 768) return 24; // phones: the panel is a sheet over the map
  return open ? RAIL_GUTTER + PANEL_W + 24 : 40;
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div className="rounded-[12px] border border-hairline bg-white/60 px-3 py-2.5">
      <div className="display text-[22px] leading-7 font-medium text-ink tabular-nums">{big}</div>
      <div className="mt-0.5 text-[12px] leading-[16px] text-ink-2">{label}</div>
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return fmtInt(n);
}

/** What teaming up changes for this storm, in four numbers and a sentence. */
function Impact({ data, t }: { data: ResponseData; t: TeamUp }) {
  const imp = teamUpImpact(t, data.counties, data.outageCost);
  const aid = data.mutualAid ? timeSaved(data.mutualAid) : null;
  const top = imp.sooner[0];
  const perCh = imp.customerHours > 0 ? imp.costCountedUsd / imp.customerHours : null;
  const ratio = imp.usd != null && imp.costCountedUsd > 0 ? imp.usd / imp.costCountedUsd : null;
  return (
    <Block>
      <h3 className="display text-[19px] font-medium text-ink">What teaming up changes</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {top ? <Stat big={hours(top.hours)} label={`sooner power for ${top.name}`} /> : null}
        {imp.customerHours > 0 ? (
          <Stat big={`up to ${compact(imp.customerHours)}`} label="fewer customer-hours in the dark" />
        ) : null}
        {imp.usd != null && imp.usd >= 1 ? (
          <Stat big={`up to ${fmtUsd(imp.usd, { compact: true })}`} label="outage costs avoided for customers" />
        ) : null}
        {imp.costUsd > 0 ? <Stat big={fmtUsd(imp.costUsd, { compact: true })} label="crew time for the help" /> : null}
        {imp.sharedYards ? (
          <Stat big={`${imp.sharedYards}`} label={`staging yard${imp.sharedYards > 1 ? "s" : ""} shared instead of ${imp.sharedYards * 2}`} />
        ) : null}
        {aid && aid.vulnerableTo90 > 0 ? (
          <Stat big={hours(aid.vulnerableTo90)} label="sooner for people on medical equipment" />
        ) : null}
      </div>
      <p className="mt-3 text-[13px] leading-[19px] text-ink-2">
        {ratio != null && ratio >= 1
          ? `Every $1 of borrowed crew time saves customers up to about $${fmtInt(ratio)} in outage costs.`
          : perCh != null
          ? `Every dollar of borrowed crew time buys back power: about ${perCh < 1 ? `${Math.round(perCh * 100)}¢` : fmtUsd(perCh)} per customer-hour of outage avoided.`
          : top
            ? "Borrowed crews shorten the outage for the utility that needs them most."
            : "No utility needs outside crews for this storm; shared yards still cut driving and set-up."}{" "}
        {imp.sharedCrewAreas ? `${imp.sharedCrewAreas} more place${imp.sharedCrewAreas > 1 ? "s" : ""} where crews can work both systems.` : ""}
      </p>
    </Block>
  );
}

/** Stormline, right side: every utility in the storm's path, and who should team up with whom. */
export function TeamUpPanel({
  data,
  onFly,
  open,
  onOpen,
  selected,
  onSelect,
}: {
  data: ResponseData | null;
  onFly: (pts: Position[], key: string) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpen(true)}
        className="glass fixed z-30 flex h-10 items-center gap-2 rounded-[12px] px-3.5 text-[13px] font-medium text-ink"
        style={{ top: NAV_CLEARANCE, right: RAIL_GUTTER }}
      >
        <Handshake size={15} aria-hidden className="text-ink-3" />
        <span className="sm:hidden">Team up</span>
        <span className="hidden sm:inline">Who should team up</span>
        <PanelRightOpen size={15} aria-hidden className="text-ink-3" />
      </button>
    );
  }
  const t = data?.teamUp ?? null;
  return (
    <aside
      aria-label="Who should team up"
      className="glass fixed z-30 flex flex-col overflow-hidden rounded-[16px]"
      style={{ top: NAV_CLEARANCE, right: RAIL_GUTTER, bottom: RAIL_GUTTER, width: `min(${PANEL_W}px, calc(100vw - ${RAIL_GUTTER * 2}px))` }}
    >
      <header className="flex items-start gap-3 border-b border-hairline px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="display text-[22px] leading-7 font-medium text-ink">Team up</h2>
          <p className="mt-0.5 text-[13px] leading-[19px] text-ink-3">Who should help whom when this storm hits</p>
        </div>
        <button
          type="button"
          onClick={() => onOpen(false)}
          aria-label="Collapse the team-up panel"
          title="Collapse the team-up panel"
          className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-white/60 hover:text-ink"
        >
          <PanelRightClose size={16} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!data ? (
          <div className="p-5">
            <div className="gs-skeleton h-24" />
          </div>
        ) : !t ? (
          <Block>
            <p className="text-[14px] text-ink-2">The team-up plan for this storm is still being computed.</p>
          </Block>
        ) : (
          <>
            <Impact data={data} t={t} />
            <TeamUpBody data={data} t={t} onFly={onFly} selected={selected} onSelect={onSelect} />
          </>
        )}
      </div>
    </aside>
  );
}

/** County nearest to a point, for plain-language places ("around Chatham County"). */
function nearestCounty(p: Position, counties: ResponseData["counties"]): string | null {
  let best: ResponseData["counties"][number] | null = null;
  let d = Infinity;
  for (const c of counties) {
    const dd = (c.centroid[0] - p[0]) ** 2 + (c.centroid[1] - p[1]) ** 2;
    if (dd < d) [best, d] = [c, dd];
  }
  return best ? `${best.name} County, ${best.state}` : null;
}

/** What one utility faces in this storm, and what its label means, in plain words. */
function OwnerExplain({ o, t, data, names }: { o: TeamUpOwner; t: TeamUp; data: ResponseData; names: Map<string, string> }) {
  const where = nearestCounty(o.damageCenter, data.counties);
  const gives = t.moves.filter((m): m is LendMove => m.kind === "lend" && m.from === o.id);
  const gets = t.moves.filter((m): m is LendMove => m.kind === "lend" && m.to === o.id);
  const spare = Math.max(0, Math.floor(Math.min(o.crews * 0.5, o.crews - o.workHours / 24)));
  const n = (id: string) => names.get(id) ?? id;
  let meaning: string;
  if (o.role === "little on this map") {
    meaning = `Only ${fmtInt(o.lineKm)} km of its lines are on this map, too little to judge its crews, so MrGridy does not plan loans to or from it.`;
  } else if (o.role === "needs help") {
    meaning = `Its ${fmtInt(o.crews)} crews would need ${hours(o.hoursAlone)} for about ${fmtInt(o.workHours)} crew-hours of repairs: more than a day, so it needs outside crews.`;
  } else if (o.role === "can help") {
    meaning = `Its ${fmtInt(o.crews)} crews would finish about ${fmtInt(o.workHours)} crew-hours of repairs in ${hours(o.hoursAlone)}, within a day, so it could lend up to ${fmtInt(spare)} crews and still keep half at home.`;
  } else {
    meaning = `Its ${fmtInt(o.crews)} crews would need ${hours(o.hoursAlone)}: close to a day, with little to spare.`;
  }
  const outcome = gives.length
    ? `In the plan it lends ${gives.map((m) => `${fmtInt(m.crews)} crews to ${n(m.to)}`).join(" and ")}.`
    : gets.length
      ? `In the plan it gets ${gets.map((m) => `${fmtInt(m.crews)} crews from ${n(m.from)}`).join(" and ")}.`
      : o.role === "can help"
        ? "No one nearby needs its crews in this storm, so they stay home or join national mutual aid."
        : o.role === "needs help"
          ? "No neighbour on the map has enough spare crews close by; this is when to call national mutual aid early."
          : "";
  return (
    <div className="mt-2 flex flex-col gap-1.5 border-t border-hairline pt-2 text-[12.5px] leading-[18px] text-ink-2">
      <p>
        About {fmtInt(o.damagedSections)} of its line sections are likely to fail
        {where ? `; the middle of that damage is around ${where}` : ""}
        {o.strongWindShare > 0 ? `; ${Math.round(o.strongWindShare * 100)}% of its lines here see gusts of 58 mph or more` : ""}.
      </p>
      <p>{meaning}</p>
      {outcome ? <p className="text-ink">{outcome}</p> : null}
    </div>
  );
}

function TeamUpBody({
  data,
  t,
  onFly,
  selected,
  onSelect,
}: {
  data: ResponseData;
  t: TeamUp;
  onFly: (pts: Position[], key: string) => void;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const names = new Map(t.owners.map((o) => [o.id, o.name]));
  const pick = (m: TeamUpMove) => {
    const key = moveKey(m);
    if (key === selected) return onSelect(null);
    onSelect(key);
    onFly(m.kind === "lend" ? m.path : [m.at], key);
  };
  const shown = t.owners.filter((o) => o.damagedSections >= 1).slice(0, 8);
  const max = Math.max(1, ...shown.map((o) => o.damagedSections));
  const lends = t.moves.filter((m) => m.kind === "lend");
  const shared = t.moves.filter((m) => m.kind !== "lend");

  return (
    <>
      <Block>
        <p className="text-[15px] leading-[23px] text-ink">{lead(t, data.storm.name)}</p>
      </Block>

      {lends.length || shared.length ? (
        <p className="px-5 pt-4 text-[12px] text-ink-3">Tap a move to draw it on the map.</p>
      ) : null}

      {lends.length ? (
        <Block>
          <h4 className="text-[13px] font-medium text-ink-3">Lend crews</h4>
          <ul className="mt-3 flex flex-col gap-2">
            {lends.slice(0, 5).map((m, i) => (
              <MoveRow key={i} m={m} names={names} selected={moveKey(m) === selected} onPick={pick} />
            ))}
          </ul>
        </Block>
      ) : null}

      {shared.length ? (
        <Block>
          <h4 className="text-[13px] font-medium text-ink-3">Work side by side</h4>
          <ul className="mt-3 flex flex-col gap-2">
            {shared.slice(0, 5).map((m, i) => (
              <MoveRow key={i} m={m} names={names} selected={moveKey(m) === selected} onPick={pick} />
            ))}
          </ul>
        </Block>
      ) : null}

      <Block>
        <h4 className="text-[13px] font-medium text-ink-3">Every utility in the path</h4>
        <ul className="mt-3 flex flex-col gap-2.5">
          {shown.map((o) => {
            const key = `owner-${o.id}`;
            const on = selected === key;
            return (
              <li
                key={o.id}
                className={cx(
                  "-mx-2 rounded-[10px] px-2 py-1.5 transition-colors",
                  on ? "bg-white shadow-[0_0_0_1px_rgba(47,111,69,0.35)]" : "hover:bg-white/50",
                )}
              >
                <button
                  type="button"
                  aria-expanded={on}
                  onClick={() => {
                    if (on) return onSelect(null);
                    onSelect(key);
                    onFly([o.damageCenter], key);
                  }}
                  className="w-full text-left"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] text-ink">{o.name}</span>
                    <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", ROLE_STYLE[o.role])}>{o.role}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-wash-2">
                    <span
                      className={cx("block h-full rounded-full", o.role === "needs help" ? "bg-alert/70" : "bg-ink/35")}
                      style={{ width: `${Math.max(3, (o.damagedSections / max) * 100)}%` }}
                    />
                  </span>
                  <span className="mt-1 block text-[12px] text-ink-3">
                    about {fmtInt(o.damagedSections)} damaged line sections
                    {o.role === "little on this map" ? "" : ` · ${hours(o.hoursAlone)} of work for its own crews`}
                  </span>
                </button>
                {on ? <OwnerExplain o={o} t={t} data={data} names={names} /> : null}
              </li>
            );
          })}
        </ul>
      </Block>

      <Block>
        <More label="How this is worked out">
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[12px] leading-[18px] text-ink-2">
            <li>
              Damage comes from the same storm simulation as the map, added up for every transmission owner, not just the
              two utilities in Crosswire.
            </li>
            <li>
              Customer-hours: customers predicted out in the state (South Carolina for Dominion, Georgia for Georgia Power)
              {data.outageCost ? " x the utility's share of the state's customers (EIA-861)" : ""} x hours sooner x{" "}
              {AVERAGE_GAIN}, because restoration is spread over the outage. It is an upper bound: the crew math covers
              transmission lines, and many homes also wait on local distribution repairs.
            </li>
            {data.outageCost ? (
              <li>
                Outage costs: customer-hours x ${data.outageCost.utilities.DESC.usdPerCustomerHour.toFixed(0)} per
                customer-hour for Dominion (SC) and ${data.outageCost.utilities.GPC.usdPerCustomerHour.toFixed(0)} for
                Georgia Power (GA): LBNL ICE 2.0 interruption costs ({data.outageCost.dollarYear} dollars) weighted by each
                utility&apos;s homes and businesses and their electricity use (EIA-861).
              </li>
            ) : null}
            {t.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </More>
      </Block>
    </>
  );
}

"use client";

import { ArrowRight, Handshake, PanelRightClose, PanelRightOpen, Tent, Truck, Users } from "lucide-react";
import type { ResponseData } from "@/lib/data";
import { fmtInt, fmtUsd } from "@/lib/format";
import { andList, AVERAGE_GAIN, teamUpImpact, type TeamUp, type TeamUpMove, type TeamUpOwner } from "@/lib/teamup";
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

function MoveRow({ m, names, onFly }: { m: TeamUpMove; names: Map<string, string>; onFly: (pts: Position[], key: string) => void }) {
  const n = (id: string) => names.get(id) ?? id;
  if (m.kind === "lend") {
    return (
      <li>
        <button
          type="button"
          onClick={() => onFly(m.path, `lend-${m.from}-${m.to}`)}
          className="w-full rounded-[10px] border border-hairline bg-white/60 px-3.5 py-3 text-left transition-colors hover:bg-white"
        >
          <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
            <Truck size={14} aria-hidden className="text-ink-3" />
            {n(m.from)} <ArrowRight size={13} aria-hidden className="text-ink-3" /> {n(m.to)}
          </span>
          <span className="mt-1 block text-[13px] leading-[19px] text-ink-2">
            Lend <b className="text-ink">{fmtInt(m.crews)} crews</b>, {hours(m.driveHours)} drive. {n(m.to)} gets power back about{" "}
            <b className="text-ink">{hours(m.hoursSooner)} sooner</b> for roughly {fmtUsd(m.costUsd, { compact: true })} in crew time.
          </span>
          <span className="mt-1 block text-[12px] leading-[17px] text-ink-3">{m.why}</span>
        </button>
      </li>
    );
  }
  const Icon = m.kind === "yard" ? Tent : Users;
  return (
    <li>
      <button
        type="button"
        onClick={() => onFly([m.at], `${m.kind}-${m.a}-${m.b}`)}
        className="w-full rounded-[10px] border border-hairline bg-white/60 px-3.5 py-3 text-left transition-colors hover:bg-white"
      >
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
          <Icon size={14} aria-hidden className="text-ink-3" />
          {n(m.a)} + {n(m.b)}: {m.kind === "yard" ? "share a staging yard" : "share crews in the field"}
        </span>
        <span className="mt-1 block text-[13px] leading-[19px] text-ink-2">
          {m.why} {fmtInt(m.sectionsNearby)} damaged sections nearby.
        </span>
      </button>
    </li>
  );
}

export const PANEL_W = 372;

/** Width the map should keep clear on the right for the team-up panel. */
export function panelInset(open: boolean): number {
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
  const imp = teamUpImpact(t, data.counties);
  const aid = data.mutualAid ? timeSaved(data.mutualAid) : null;
  const top = imp.sooner[0];
  const perCh = imp.customerHours > 0 ? imp.costCountedUsd / imp.customerHours : null;
  return (
    <Block>
      <h3 className="display text-[19px] font-medium text-ink">What teaming up changes</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {top ? <Stat big={hours(top.hours)} label={`sooner power for ${top.name}`} /> : null}
        {imp.customerHours > 0 ? (
          <Stat big={compact(imp.customerHours)} label="fewer customer-hours in the dark" />
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
        {perCh != null
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
}: {
  data: ResponseData | null;
  onFly: (pts: Position[], key: string) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
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
        Who should team up
        <PanelRightOpen size={15} aria-hidden className="text-ink-3" />
      </button>
    );
  }
  const t = data?.teamUp ?? null;
  return (
    <aside
      aria-label="Who should team up"
      className="glass fixed z-30 flex flex-col overflow-hidden rounded-[16px]"
      style={{ top: NAV_CLEARANCE, right: RAIL_GUTTER, bottom: RAIL_GUTTER, width: PANEL_W }}
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
            <TeamUpBody data={data} t={t} onFly={onFly} />
          </>
        )}
      </div>
    </aside>
  );
}

function TeamUpBody({ data, t, onFly }: { data: ResponseData; t: TeamUp; onFly: (pts: Position[], key: string) => void }) {
  const names = new Map(t.owners.map((o) => [o.id, o.name]));
  const shown = t.owners.filter((o) => o.damagedSections >= 1).slice(0, 8);
  const max = Math.max(1, ...shown.map((o) => o.damagedSections));
  const lends = t.moves.filter((m) => m.kind === "lend");
  const shared = t.moves.filter((m) => m.kind !== "lend");

  return (
    <>
      <Block>
        <p className="text-[15px] leading-[23px] text-ink">{lead(t, data.storm.name)}</p>
      </Block>

      {lends.length ? (
        <Block>
          <h4 className="text-[13px] font-medium text-ink-3">Lend crews</h4>
          <ul className="mt-3 flex flex-col gap-2">
            {lends.slice(0, 5).map((m, i) => (
              <MoveRow key={i} m={m} names={names} onFly={onFly} />
            ))}
          </ul>
        </Block>
      ) : null}

      {shared.length ? (
        <Block>
          <h4 className="text-[13px] font-medium text-ink-3">Work side by side</h4>
          <ul className="mt-3 flex flex-col gap-2">
            {shared.slice(0, 5).map((m, i) => (
              <MoveRow key={i} m={m} names={names} onFly={onFly} />
            ))}
          </ul>
        </Block>
      ) : null}

      <Block>
        <h4 className="text-[13px] font-medium text-ink-3">Every utility in the path</h4>
        <ul className="mt-3 flex flex-col gap-2.5">
          {shown.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onFly([o.damageCenter], `owner-${o.id}`)}
                className="w-full text-left"
                title="Show where this utility's damage is"
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
            </li>
          ))}
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
              Customer-hours: customers predicted out in the state (South Carolina for Dominion, Georgia for Georgia Power) x
              hours sooner x {AVERAGE_GAIN}, because restoration is spread over the outage.
            </li>
            {t.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </More>
      </Block>
    </>
  );
}

"use client";

import { ArrowRight, Tent, Truck, Users } from "lucide-react";
import type { ResponseData } from "@/lib/data";
import { fmtInt, fmtUsd } from "@/lib/format";
import type { TeamUp, TeamUpMove, TeamUpOwner } from "@/lib/teamup";
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
  const help = t.owners.filter((o) => o.role === "can help" && o.lineKm >= 300);
  const lends = t.moves.filter((m) => m.kind === "lend");
  if (!need.length) {
    return `${storm} damages lines on ${t.owners.filter((o) => o.damagedSections >= 1).length} systems, but every utility can finish its own repairs within a day. Sharing yards still saves driving.`;
  }
  const needNames = need.slice(0, 3).map((o) => o.name).join(", ");
  if (!lends.length) {
    return `${needNames} would each need more than a day of repairs on their own, and the neighbours with spare crews are too few or too far to make a real difference. Call national mutual aid early.`;
  }
  const givers = [...new Set(lends.map((m) => name.get(m.from) ?? m.from))].slice(0, 3).join(", ");
  return `${needNames} would need more than a day of repairs on their own. ${givers} ${givers.includes(",") ? "have" : "has"} crews to spare and ${help.length > 1 ? "are" : "is"} close enough to help.`;
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

/** Stormline: every utility in the storm's path, and who should team up with whom. */
export function TeamUpSection({
  data,
  onFly,
}: {
  data: ResponseData;
  onFly: (pts: Position[], key: string) => void;
}) {
  const t = data.teamUp;
  if (!t) {
    return (
      <Block>
        <p className="text-[14px] text-ink-2">The team-up plan for this storm is still being computed.</p>
      </Block>
    );
  }
  const names = new Map(t.owners.map((o) => [o.id, o.name]));
  const shown = t.owners.filter((o) => o.damagedSections >= 1).slice(0, 8);
  const max = Math.max(1, ...shown.map((o) => o.damagedSections));
  const lends = t.moves.filter((m) => m.kind === "lend");
  const shared = t.moves.filter((m) => m.kind !== "lend");

  return (
    <>
      <Block>
        <h3 className="display text-[19px] font-medium text-ink">Who should team up</h3>
        <p className="mt-2 text-[15px] leading-[23px] text-ink">{lead(t, data.storm.name)}</p>
      </Block>

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
        <More label="How this is worked out">
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[12px] leading-[18px] text-ink-2">
            <li>
              Damage comes from the same 10,000-storm simulation as the map, added up for every transmission owner, not just
              the two utilities in Crosswire.
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

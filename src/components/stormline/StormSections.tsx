"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ResponseData } from "@/lib/data";
import { fmtInt, fmtMinutes } from "@/lib/format";
import { fmtMae, stormKey, zoneLabel } from "@/lib/response";
import { DEFAULT_UTILITY_NAME as UTILITY_NAME } from "@/lib/theme";
import type { RepairZone, StormIndexEntry } from "@/lib/types";
import { TimeSavedCard } from "../response/TimeSaved";
import { cx, UtilityDot } from "../ui/primitives";

/** A short heading line followed by content; details stay folded until asked for. */
export function Block({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("border-b border-hairline px-5 py-5 last:border-b-0", className)}>{children}</section>;
}

export function More({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[13px] font-medium text-ink-2 hover:text-ink"
      >
        {label}
        <ChevronDown size={14} aria-hidden className={cx("transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

export function StormPicker({
  storms,
  stormId,
  onStorm,
}: {
  storms: StormIndexEntry[] | null;
  stormId: string | null;
  onStorm: (id: string) => void;
}) {
  if (!storms) {
    return (
      <div className="flex flex-col gap-2">
        <div className="gs-skeleton h-9" />
        <div className="gs-skeleton h-9" />
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label="Choose a storm" className="-mx-2 flex flex-col gap-0.5">
      {storms.map((s) => {
        const on = s.id === stormId;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onStorm(s.id)}
            className={cx(
              "flex items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors duration-150",
              on ? "bg-white/85 shadow-[0_0_0_1px_rgba(20,24,30,0.1)]" : "hover:bg-white/45",
            )}
          >
            <span
              aria-hidden
              className={cx(
                "h-3.5 w-3.5 shrink-0 rounded-full border transition-all",
                on ? "border-[4px] border-ink bg-white" : "border-hairline-strong bg-white/60",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5">
                <span className="display text-[17px] font-medium text-ink">{s.name}</span>
                <span className="text-[12px] text-ink-3 tabular-nums">{s.year}</span>
              </span>
              {on ? <span className="block text-[12px] leading-4 text-ink-3">{s.headline}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One sentence on whether the storm's damage reaches both grids. */
export function BothGridsLine({ data }: { data: ResponseData }) {
  const risky = { DESC: 0, GPC: 0 };
  for (const s of data.segments) {
    if (s.failureProbability < 0.1) continue;
    if (s.utility === "DESC") risky.DESC += 1;
    else if (s.utility === "GPC") risky.GPC += 1;
  }
  const name = data.storm.name;
  if (risky.DESC > 0 && risky.GPC > 0) {
    return (
      <p className="text-[15px] leading-[23px] text-ink">
        {name}&apos;s damaging winds reach both grids: <span className="font-semibold">{fmtInt(risky.GPC)}</span>{" "}
        {UTILITY_NAME.GPC} line sections and <span className="font-semibold">{fmtInt(risky.DESC)}</span>{" "}
        {UTILITY_NAME.DESC} line sections have at least a 1-in-10 chance of breaking.
      </p>
    );
  }
  const only = risky.GPC > 0 ? "GPC" : risky.DESC > 0 ? "DESC" : null;
  return (
    <p className="text-[15px] leading-[23px] text-ink">
      {only
        ? `${name} mostly hits ${UTILITY_NAME[only]}: ${fmtInt(risky[only])} line sections have at least a 1-in-10 chance of breaking, and the other grid is largely spared.`
        : `${name} stays below the damage threshold on both grids.`}
    </p>
  );
}

export function TimeSavedBlock({ data }: { data: ResponseData }) {
  if (!data.mutualAid) return null;
  return <TimeSavedCard aid={data.mutualAid} />;
}

export function ModelCheck({ data, stormId }: { data: ResponseData; stormId: string | null }) {
  const v = data.meta.validation;
  const device = data.meta.device === "cuda" ? "on a GPU" : "on a regular computer";
  return (
    <>
      <p className="text-[14px] leading-[22px] text-ink-2">
        The storm was simulated <span className="font-medium text-ink">{fmtInt(data.meta.simulations)}</span> times
        {` ${device}`}.
        {v.countyMaePredicted != null && v.countyMaeBaseline != null ? (
          <>
            {" "}
            Per county, the predicted share of homes without power was off by{" "}
            <span className="font-medium text-ink">{fmtMae(v.countyMaePredicted)}</span> on average; a wind-only model
            was off by <span className="font-medium text-ink">{fmtMae(v.countyMaeBaseline)}</span>.
          </>
        ) : (
          " There are no outage records for this storm, so the county predictions are not checked."
        )}
        {v.reportedDescTransmissionPoles != null ? (
          <>
            {" "}
            {UTILITY_NAME.DESC} reported{" "}
            <span className="font-medium text-ink">{fmtInt(v.reportedDescTransmissionPoles)}</span> transmission poles
            down
            {v.predictedDescTransmissionFailures != null ? (
              <>
                ; the model expected about{" "}
                <span className="font-medium text-ink">{fmtInt(v.predictedDescTransmissionFailures)}</span>
              </>
            ) : null}
            .
          </>
        ) : null}
      </p>
      {data.meta.crossValidation?.length ? (
        <More label="Tested on storms it never saw">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3">
                <th className="pb-1 font-medium">Storm</th>
                <th className="pb-1 text-right font-medium">Model off by</th>
                <th className="pb-1 text-right font-medium">Wind-only off by</th>
              </tr>
            </thead>
            <tbody>
              {data.meta.crossValidation.map((row) => {
                const current =
                  stormKey(row.storm) === stormKey(stormId ?? "") || stormKey(row.storm) === stormKey(data.storm.name);
                return (
                  <tr key={row.storm} className={cx("border-t border-hairline", current && "font-medium")}>
                    <td className="py-1.5 capitalize">{row.storm}</td>
                    <td className="num py-1.5 text-right">{fmtMae(row.maePredicted)}</td>
                    <td className="num py-1.5 text-right text-ink-3">{fmtMae(row.maeBaseline)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] leading-4 text-ink-3">
            For each storm the model learned from the others only, then was scored on this one.
          </p>
        </More>
      ) : null}
    </>
  );
}

export function CrewsSection({
  data,
  selectedZoneId,
  onZone,
  onYard,
}: {
  data: ResponseData;
  selectedZoneId: string | null;
  onZone: (id: string) => void;
  onYard: (id: string) => void;
}) {
  const zones = [...data.zones].sort((a, b) => a.priority - b.priority);
  const top = zones.slice(0, 5);
  const shared = zones.filter((z) => z.utilities.length > 1).length;
  const zoneById = new Map(data.zones.map((z) => [z.id, z]));
  return (
    <>
      <Block>
        <p className="text-[15px] leading-[23px] text-ink">
          {zones.length
            ? `There are ${zones.length} repair zones, numbered by priority; ${shared} of them need both companies.`
            : "No repair zones pass the damage threshold for this storm."}
        </p>
        {top.length ? (
          <ol className="-mx-2 mt-3 flex flex-col">
            {top.map((z) => (
              <ZoneRow key={z.id} zone={z} data={data} selected={z.id === selectedZoneId} onZone={onZone} />
            ))}
          </ol>
        ) : null}
        {zones.length > top.length ? (
          <More label={`The other ${zones.length - top.length} zones`}>
            <ol className="-mx-2 flex flex-col">
              {zones.slice(top.length).map((z) => (
                <ZoneRow key={z.id} zone={z} data={data} selected={z.id === selectedZoneId} onZone={onZone} />
              ))}
            </ol>
          </More>
        ) : null}
      </Block>
      <Block>
        <p className="text-[15px] leading-[23px] text-ink">
          {data.yards.length
            ? `${data.yards.length === 1 ? "One staging yard" : `${data.yards.length} staging yards`} can serve both companies' crews.`
            : "No staging yard serves both companies for this storm."}
        </p>
        <ul className="-mx-2 mt-2 flex flex-col">
          {data.yards.map((y) => (
            <li key={y.id}>
              <button
                type="button"
                onClick={() => onYard(y.id)}
                className="flex w-full flex-col rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-white/50"
              >
                <span className="text-[14px] text-ink">{y.label}</span>
                <span className="text-[12px] text-ink-3">
                  Serves{" "}
                  {y.serves
                    .map((id) => zoneById.get(id))
                    .filter((z): z is RepairZone => !!z)
                    .map((z) => `P${z.priority}`)
                    .join(", ") || `${y.serves.length} zones`}
                  , up to {fmtMinutes(y.maxDriveMinutes)} away.
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}

function ZoneRow({
  zone: z,
  data,
  selected,
  onZone,
}: {
  zone: RepairZone;
  data: ResponseData;
  selected: boolean;
  onZone: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onZone(z.id)}
        aria-current={selected ? "true" : undefined}
        className={cx(
          "flex w-full items-baseline gap-3 rounded-[8px] px-2 py-1.5 text-left transition-colors",
          selected ? "bg-white/85 shadow-[0_0_0_1px_rgba(20,24,30,0.1)]" : "hover:bg-white/50",
        )}
      >
        <span className="display w-7 shrink-0 text-[14px] font-medium text-ink">P{z.priority}</span>
        <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">
          Near {zoneLabel(z, data.counties)}
          <span className="block text-[12px] text-ink-3">
            About {z.expectedDamagedSegments.toFixed(0)} line sections down, {fmtInt(z.vulnerablePeople)} people on
            medical equipment nearby.
          </span>
        </span>
        <span
          className="flex shrink-0 items-center gap-1"
          title={z.utilities.map((u) => UTILITY_NAME[u]).join(" and ")}
        >
          {z.utilities.map((u) => (
            <UtilityDot key={u} utility={u} size={7} />
          ))}
        </span>
      </button>
    </li>
  );
}

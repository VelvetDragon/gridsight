"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ResponseData } from "@/lib/data";
import { fmtInt, fmtMinutes } from "@/lib/format";
import { fmtMae, stormKey, zoneLabel } from "@/lib/response";
import { DEFAULT_UTILITY_NAME as UTILITY_NAME } from "@/lib/theme";
import type { RepairZone, StormIndexEntry } from "@/lib/types";
import { zoneCrewPlan, type ZoneCrews } from "@/lib/teamup";
import { TimeSavedCard } from "../response/TimeSaved";
import { OutageChart } from "../integrations/OutageChart";
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

const SHORT_LIST = 5;

export function StormPicker({
  storms,
  stormId,
  onStorm,
}: {
  storms: StormIndexEntry[] | null;
  stormId: string | null;
  onStorm: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  if (!storms) {
    return (
      <div className="flex flex-col gap-2">
        <div className="gs-skeleton h-9" />
        <div className="gs-skeleton h-9" />
      </div>
    );
  }
  const list = [...storms].sort((a, b) => Number(b.featured) - Number(a.featured) || b.year - a.year);
  const shown = all || list.length <= SHORT_LIST ? list : list.filter((s, i) => i < SHORT_LIST || s.id === stormId);
  return (
    <div role="radiogroup" aria-label="Choose a storm" className="-mx-2 flex flex-col gap-0.5">
      {shown.map((s) => {
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
      {list.length > SHORT_LIST ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mx-3 mt-1 flex items-center gap-1 self-start text-[13px] font-medium text-ink-2 hover:text-ink"
        >
          {all ? "Show fewer storms" : `Show all ${list.length} storms`}
          <ChevronDown size={14} aria-hidden className={cx("transition-transform duration-200", all && "rotate-180")} />
        </button>
      ) : null}
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

/** What actually happened to each utility in this storm, from published sources (actual-restoration.json). */
export function ActualRestoration({ data }: { data: ResponseData }) {
  const a = data.actual;
  const order = ["GPC", "DESC"] as const;
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink-3">What actually happened</h3>
      {a ? (
        <div className="mt-2 flex flex-col gap-3">
          {order.map((u) => {
            const facts = a.utilities[u] ?? [];
            return (
              <div key={u}>
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                  <UtilityDot utility={u} />
                  {UTILITY_NAME[u]}
                </div>
                {facts.length ? (
                  <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-[12.5px] leading-[18px] text-ink-2">
                    {facts.map((f) => (
                      <li key={f.text}>
                        {f.text}{" "}
                        <a href={f.url} target="_blank" rel="noreferrer" className="text-ink-3 underline underline-offset-2">
                          {f.source}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[12.5px] leading-[18px] text-ink-3">No published figures found for this storm.</p>
                )}
              </div>
            );
          })}
          {a.notes?.length ? (
            <ul className="flex flex-col gap-1 text-[12px] leading-[17px] text-ink-3">
              {a.notes.map((f) => (
                <li key={f.text}>
                  {f.text}{" "}
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                      {f.source}
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="mt-1 text-[12.5px] leading-[18px] text-ink-3">No published restoration figures collected for this storm.</p>
      )}
    </div>
  );
}

export function TimeSavedBlock({ data }: { data: ResponseData }) {
  if (!data.mutualAid) return null;
  return <TimeSavedCard
      aid={data.mutualAid}
      counties={data.counties}
      outageCost={data.outageCost}
      outageCostHidden={data.actual?.outageCostHidden}
    />;
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
            Tested on this storm without training on it, the predicted share of each county&apos;s customers without
            power was off by <span className="font-medium text-ink">{fmtMae(v.countyMaePredicted)}</span> (percentage
            points) on average; a wind-only model was off by{" "}
            <span className="font-medium text-ink">{fmtMae(v.countyMaeBaseline)}</span>
            {v.countyMaePredicted > v.countyMaeBaseline
              ? ", so for this storm the full model did worse than the simpler one."
              : "."}
          </>
        ) : (
          " There are no outage records for this storm, so the county predictions are not checked."
        )}
        {v.predictedDescDamagedSections != null ? (
          <>
            {" "}
            The model expects about{" "}
            <span className="font-medium text-ink">{fmtInt(v.predictedDescDamagedSections)}</span> damaged{" "}
            {UTILITY_NAME.DESC} transmission line sections (wind or falling trees)
            {v.reportedDescDamagedSpans != null ? (
              <>
                ; {UTILITY_NAME.DESC} reported{" "}
                <span className="font-medium text-ink">{fmtInt(v.reportedDescDamagedSpans)}</span> damaged spans. The
                tree-fall part was tuned to that report, so it is a consistency check, not a test
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
  const crews = zoneCrewPlan(data.teamUp, data.zones, data.yards);
  const helped = [...crews.values()].filter((c) => c.helpers.length).length;
  return (
    <>
      <Block>
        <p className="text-[15px] leading-[23px] text-ink">
          {zones.length
            ? `There are ${zones.length} repair zones, numbered by priority; ${shared} of them need both companies.${
                helped ? ` Borrowed crews from the Team up plan go to ${helped} of them, most-urgent first.` : ""
              }`
            : "No repair zones pass the damage threshold for this storm."}
        </p>
        {top.length ? (
          <ol className="-mx-2 mt-3 flex flex-col">
            {top.map((z) => (
              <ZoneRow key={z.id} zone={z} data={data} crews={crews.get(z.id)} selected={z.id === selectedZoneId} onZone={onZone} />
            ))}
          </ol>
        ) : null}
        {zones.length > top.length ? (
          <More label={`The other ${zones.length - top.length} zones`}>
            <ol className="-mx-2 flex flex-col">
              {zones.slice(top.length).map((z) => (
                <ZoneRow key={z.id} zone={z} data={data} crews={crews.get(z.id)} selected={z.id === selectedZoneId} onZone={onZone} />
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
  crews,
  selected,
  onZone,
}: {
  zone: RepairZone;
  data: ResponseData;
  crews?: ZoneCrews;
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
          <span className="mt-0.5 block text-[12px] text-ink-2">
            {z.utilities.map((u) => UTILITY_NAME[u]).join(" and ")} crews
            {crews?.helpers.length
              ? crews.helpers.map((h) => ` + ${fmtInt(h.crews)} ${h.name} crew${h.crews === 1 ? "" : "s"}`).join("")
              : z.utilities.length > 1
                ? ", side by side"
                : ""}
            {crews?.yard ? ` · stage at ${crews.yard}` : ""}
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

/** Real customers out, hour by hour (EAGLE-I, served from Tiger Data), for the open storm. */
export function RealOutages({ stormId }: { stormId: string }) {
  const [state, setState] = useState<"GA" | "SC" | undefined>(undefined);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink-3">Real outages, hour by hour</h3>
        <div role="group" aria-label="Which state" className="inline-flex h-7 items-center rounded-[8px] border border-hairline p-0.5">
          {([undefined, "GA", "SC"] as const).map((s) => (
            <button
              key={s ?? "all"}
              type="button"
              aria-pressed={state === s}
              onClick={() => setState(s)}
              className={cx(
                "h-full rounded-[6px] px-2 text-[11px] font-medium",
                state === s ? "bg-ink text-white" : "text-ink-2 hover:bg-wash-2",
              )}
            >
              {s ?? "All"}
            </button>
          ))}
        </div>
      </div>
      <OutageChart storm={stormId} state={state} height={130} className="mt-2" />
      <p className="mt-1.5 text-[12px] leading-[17px] text-ink-3">
        What actually happened: customers without power, from the Department of Energy&apos;s EAGLE-I records, every 15
        minutes, stored as a time series in Tiger Data.
      </p>
    </div>
  );
}

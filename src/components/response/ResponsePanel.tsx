"use client";

import { BadgeCheck, PanelRightClose } from "lucide-react";
import type { ReactNode } from "react";
import type { ResponseData } from "@/lib/data";
import { fmtInt, fmtMinutes } from "@/lib/format";
import { fmtMae, stormKey, zoneLabel } from "@/lib/response";
import type { RepairZone, StormIndexEntry } from "@/lib/types";
import { SkeletonRows } from "../ui/states";
import { cx, Divider, Eyebrow, IconButton, Panel, Tooltip, UtilityDot } from "../ui/primitives";

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 px-4 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <Eyebrow>{title}</Eyebrow>
        {aside}
      </div>
      {children}
    </section>
  );
}

export interface ResponsePanelProps {
  storms: StormIndexEntry[] | null;
  stormId: string | null;
  onStorm: (id: string) => void;
  data: ResponseData | null;
  loading: boolean;
  selectedZoneId: string | null;
  onZone: (id: string) => void;
  onYard: (id: string) => void;
  onCollapse: () => void;
}

export function ResponsePanel(props: ResponsePanelProps) {
  const { storms, stormId, onStorm, data, loading } = props;
  return (
    <Panel className="flex h-full w-[372px] flex-col overflow-hidden" aria-label="Storm response">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <Eyebrow>Storm</Eyebrow>
        <IconButton label="Collapse panel" onClick={props.onCollapse} className="-mr-1.5">
          <PanelRightClose size={16} />
        </IconButton>
      </div>
      <StormPicker storms={storms} stormId={stormId} onStorm={onStorm} />
      <Divider className="mt-2" />
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {loading || !data ? (
          <SkeletonRows rows={6} />
        ) : (
          <ResponseDetails {...props} data={data} />
        )}
      </div>
    </Panel>
  );
}

function StormPicker({
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
      <div className="flex flex-col gap-2 px-4 py-2">
        <div className="gs-skeleton h-9" />
        <div className="gs-skeleton h-9" />
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label="Choose a storm" className="flex flex-col px-2">
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
              "flex items-center gap-3 rounded-[9px] px-2.5 py-2 text-left transition-colors duration-150",
              on ? "bg-white shadow-[0_0_0_1px_rgba(20,22,28,0.1),0_2px_6px_-2px_rgba(20,22,28,0.12)]" : "hover:bg-wash",
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
                <span className="text-[14px] font-medium text-ink">{s.name}</span>
                <span className="num text-[12px] text-ink-3">{s.year}</span>
                {s.validated ? (
                  <span
                    className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-ink-2"
                    title="Model output checked against DOE EAGLE-I actual outages"
                  >
                    <BadgeCheck size={13} aria-hidden className="text-ink-2" />
                    Validated
                  </span>
                ) : null}
              </span>
              <span className="line-clamp-1 text-[12px] text-ink-3">{s.headline}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ResponseDetails({
  data,
  stormId,
  selectedZoneId,
  onZone,
  onYard,
}: ResponsePanelProps & { data: ResponseData }) {
  const v = data.meta.validation;
  const topZones = [...data.zones].sort((a, b) => a.priority - b.priority).slice(0, 5);
  const zoneById = new Map(data.zones.map((z) => [z.id, z]));

  return (
    <>
      <Section title="Simulation">
        <div className="grid grid-cols-2 gap-3 rounded-[10px] border border-hairline bg-white/55 px-3.5 py-3">
          <div>
            <div className="text-[12px] text-ink-3">Monte Carlo runs</div>
            <div className="num text-[18px] leading-6 font-medium">{fmtInt(data.meta.simulations)}</div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">Computed on</div>
            <div className="text-[15px] leading-6 font-medium">
              {data.meta.device === "cuda" ? "GPU (CUDA)" : "CPU"}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Outage model check"
        aside={
          <Tooltip content="Mean absolute error of each county's peak share of customers out. Baseline predicts the same share everywhere.">
            <span className="text-[11px] text-ink-3 underline decoration-dotted underline-offset-2">what is this</span>
          </Tooltip>
        }
      >
        {v.countyMaePredicted != null && v.countyMaeBaseline != null ? (
          <MaeCompare model={v.countyMaePredicted} baseline={v.countyMaeBaseline} />
        ) : (
          <p className="text-[13px] leading-5 text-ink-3">
            No actual outage data for this storm, so the county predictions are not validated.
          </p>
        )}
        <div className="mt-1 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[12px] text-ink-3">DESC transmission, reported</div>
            <div className="num text-[15px] font-medium">{fmtInt(v.reportedDescTransmissionPoles)} poles</div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">Predicted failures</div>
            <div className="num text-[15px] font-medium">
              {v.predictedDescTransmissionFailures != null ? fmtInt(v.predictedDescTransmissionFailures) : "–"}
            </div>
          </div>
        </div>
      </Section>

      {data.meta.crossValidation?.length ? (
        <>
          <Divider className="mx-4" />
          <Section title="Tested on storms it never saw">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] text-ink-3">
                  <th className="pb-1 font-medium">Storm</th>
                  <th className="pb-1 text-right font-medium">Model error</th>
                  <th className="pb-1 text-right font-medium">Baseline</th>
                </tr>
              </thead>
              <tbody>
                {data.meta.crossValidation.map((row) => {
                  const current =
                    stormKey(row.storm) === stormKey(stormId ?? "") || stormKey(row.storm) === stormKey(data.storm.name);
                  const better = row.maePredicted < row.maeBaseline;
                  return (
                    <tr
                      key={row.storm}
                      className={cx("border-t border-hairline", current && "bg-white/80 font-medium")}
                      aria-current={current ? "true" : undefined}
                    >
                      <td className="py-1.5 pl-1">
                        <span className="capitalize">{row.storm}</span>
                        {current ? <span className="ml-1.5 text-[11px] font-normal text-ink-3">this storm</span> : null}
                      </td>
                      <td className={cx("num py-1.5 text-right", better ? "text-ink" : "text-alert")}>
                        {fmtMae(row.maePredicted)}
                      </td>
                      <td className="num py-1.5 pr-1 text-right text-ink-3">{fmtMae(row.maeBaseline)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[12px] leading-4 text-ink-3">
              Each row: model trained on every other storm, scored on this one.
            </p>
          </Section>
        </>
      ) : null}

      <Divider className="mx-4" />

      <Section title="Top repair zones" aside={<span className="num text-[12px] text-ink-3">{data.zones.length}</span>}>
        {topZones.length ? (
          <ol className="-mx-2 flex flex-col">
            {topZones.map((z) => (
              <li key={z.id}>
                <button
                  type="button"
                  onClick={() => onZone(z.id)}
                  aria-current={z.id === selectedZoneId ? "true" : undefined}
                  className={cx(
                    "flex w-full items-start gap-3 rounded-[8px] px-2 py-2 text-left transition-colors",
                    z.id === selectedZoneId ? "bg-white shadow-[0_0_0_1px_rgba(20,22,28,0.1)]" : "hover:bg-wash",
                  )}
                >
                  <span className="num mt-px w-6 shrink-0 text-[12px] font-medium text-ink-2">P{z.priority}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13px] text-ink">
                      near {zoneLabel(z, data.counties)}
                      <span className="flex items-center gap-1">
                        {z.utilities.map((u) => (
                          <UtilityDot key={u} utility={u} size={7} />
                        ))}
                      </span>
                    </span>
                    <span className="num block text-[12px] text-ink-3">
                      {z.expectedDamagedSegments.toFixed(1)} segments · {fmtInt(z.vulnerablePeople)} vulnerable
                    </span>
                  </span>
                  {z.utilities.length > 1 ? (
                    <span className="mt-px shrink-0 rounded-full bg-wash-2 px-1.5 text-[11px] leading-[18px] text-ink-2">
                      shared
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-ink-3">No repair zones above the damage threshold.</p>
        )}
      </Section>

      <Divider className="mx-4" />

      <Section title="Joint staging yards" aside={<span className="num text-[12px] text-ink-3">{data.yards.length}</span>}>
        {data.yards.length ? (
          <ul className="-mx-2 flex flex-col">
            {data.yards.map((y) => (
              <li key={y.id}>
                <button
                  type="button"
                  onClick={() => onYard(y.id)}
                  className="flex w-full flex-col gap-0.5 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-wash"
                >
                  <span className="text-[13px] text-ink">{y.label}</span>
                  <span className="text-[12px] text-ink-3">
                    serves{" "}
                    {y.serves
                      .map((id) => zoneById.get(id))
                      .filter((z): z is RepairZone => !!z)
                      .map((z) => `P${z.priority}`)
                      .join(", ") || y.serves.join(", ")}{" "}
                    · <span className="num">≤ {fmtMinutes(y.maxDriveMinutes)}</span> drive
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">No yard serves both utilities for this storm.</p>
        )}
      </Section>
    </>
  );
}

function MaeCompare({ model, baseline }: { model: number; baseline: number }) {
  const max = Math.max(model, baseline) || 1;
  const rows: [string, number, boolean][] = [
    ["GridSight model", model, true],
    ["Baseline", baseline, false],
  ];
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([label, val, strong]) => (
        <div key={label} className="flex items-center gap-3 text-[13px]">
          <span className={cx("w-[112px] shrink-0", strong ? "text-ink" : "text-ink-2")}>{label}</span>
          <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-wash-2">
            <span
              className={cx("absolute inset-y-0 left-0 rounded-full", strong ? "bg-ink-2" : "bg-ink-3/50")}
              style={{ width: `${(val / max) * 100}%` }}
            />
          </span>
          <span className="num w-[52px] text-right text-ink">{fmtMae(val)}</span>
        </div>
      ))}
      {model < baseline ? (
        <p className="text-[12px] text-ink-3">
          County error is <span className="num text-ink-2">{Math.round((1 - model / baseline) * 100)}%</span> lower than
          the baseline.
        </p>
      ) : null}
    </div>
  );
}

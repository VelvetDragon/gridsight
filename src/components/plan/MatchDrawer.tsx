"use client";

import { ArrowUpRight, Check, ClipboardCopy, MapPin, Scale, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ACTION_LABEL, fmtInt, fmtKm, fmtKv, fmtMinutes, fmtMonthYear, fmtMonths, fmtUsd } from "@/lib/format";
import { buildMemo, isRightSizingCandidate, isRightSizingItem, RIGHT_SIZING_TIP, roadNote, sourceHref } from "@/lib/plan";
import type { RankedOverlap } from "@/lib/ranking";
import { TIER_LABEL, TIER_RANGE, TIER_SHARES, TIERS, UTILITY_HEX } from "@/lib/theme";
import type { Overlap, Project } from "@/lib/types";
import { Button, Chip, cx, Divider, Eyebrow, IconButton, Panel, Stat, TierChip, TierSwatch, Tooltip, UtilityDot } from "../ui/primitives";
import { MiniGantt } from "./MiniGantt";
import { RightSizingChip } from "./RightSizing";

export interface MatchDrawerProps {
  item: RankedOverlap;
  desc: Project | undefined;
  gpc: Project | undefined;
  radarMonth: number | null;
  onClose: () => void;
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 px-5 py-4">
      <div className="flex items-center justify-between">
        <Eyebrow>{title}</Eyebrow>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function MatchDrawer({ item, desc, gpc, radarMonth, onClose }: MatchDrawerProps) {
  const o = item.overlap;
  const rightSizing = isRightSizingCandidate(desc, gpc);

  return (
    <Panel className="flex h-full w-[408px] flex-col overflow-hidden" aria-label="Selected coordination opportunity">
      <header className="px-5 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <Eyebrow>
            Opportunity <span className="num text-ink-2">#{item.rank}</span>
          </Eyebrow>
          <IconButton label="Close details" onClick={onClose} className="-mr-2">
            <X size={16} />
          </IconButton>
        </div>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <PairName utility="DESC" project={desc} fallback={o.descId} />
          <PairName utility="GPC" project={gpc} fallback={o.gpcId} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <TierChip tier={o.tier} />
          {rightSizing ? <RightSizingChip /> : null}
          {o.robustness === "uncertain" ? (
            <Tooltip content="At least one project's location is approximate. The tier could change once exact routes are known.">
              <Chip tone="quiet">Location uncertain</Chip>
            </Tooltip>
          ) : null}
        </div>
      </header>

      <Divider />

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-1">
          <p className="text-[14px] leading-[21px] text-ink">{o.summary}</p>
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-[10px] border border-hairline bg-white/55 px-3.5 py-3">
            <Stat label="Closest" value={fmtKm(o.distanceKm)} />
            <Stat label="Both building" value={fmtMonths(o.timelineOverlapMonths)} />
            <Stat label="Est. savings" value={o.cost ? fmtUsd(o.cost.totalUsd) : "–"} />
          </div>
        </div>

        <Section title="What they can share">
          <ShareLadder overlap={o} />
        </Section>

        <Divider className="mx-5" />

        <Section title="Build windows">
          {desc && gpc ? <MiniGantt desc={desc} gpc={gpc} cursorMonth={radarMonth} /> : null}
        </Section>

        <Divider className="mx-5" />

        <Section title="Distance">
          <DistanceBlock overlap={o} />
        </Section>

        {o.stagingYard ? (
          <>
            <Divider className="mx-5" />
            <Section title="Staging yard">
              <YardBlock overlap={o} />
            </Section>
          </>
        ) : null}

        <Divider className="mx-5" />

        <Section title="Cost estimate">
          <CostBlock overlap={o} />
        </Section>

        <Divider className="mx-5" />

        <Section title="Sources">
          <ul className="flex flex-col gap-2">
            {[desc, gpc].map((p) => (p ? <SourceLink key={p.id} project={p} /> : null))}
          </ul>
        </Section>
      </div>

      <footer className="border-t border-hairline px-5 py-3">
        {desc && gpc ? <CopyMemo overlap={o} desc={desc} gpc={gpc} rank={item.rank} /> : null}
      </footer>
    </Panel>
  );
}

function PairName({ utility, project, fallback }: { utility: "DESC" | "GPC"; project?: Project; fallback: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="pt-[7px]">
        <UtilityDot utility={utility} size={9} />
      </span>
      <div className="min-w-0">
        <div className="text-[15px] leading-[21px] font-medium tracking-[-0.01em] text-ink">{project?.name ?? fallback}</div>
        <div className="text-[12px] text-ink-3">
          <span style={{ color: UTILITY_HEX[utility] }} className="font-medium">
            {utility === "DESC" ? "DESC" : "Georgia Power"}
          </span>
          {project ? (
            <>
              {" · "}
              {ACTION_LABEL[project.action]} · <span className="num">{fmtKv(project.voltageKv)}</span>
              {project.miles != null ? (
                <>
                  {" · "}
                  <span className="num">{project.miles} mi</span>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ShareLadder({ overlap }: { overlap: Overlap }) {
  const at = TIERS.indexOf(overlap.tier);
  const extras = overlap.shareable;
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col">
        {TIERS.map((t, i) => {
          const on = i >= at;
          return (
            <li key={t} className={cx("flex gap-3 py-1.5", !on && "opacity-45")}>
              <span className="flex w-[18px] justify-center pt-[3px]">
                {on ? (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink text-white">
                    <Check size={10} strokeWidth={3} aria-hidden />
                  </span>
                ) : (
                  <span className="h-4 w-4 rounded-full border border-hairline-strong" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  {TIER_SHARES[t].title}
                  <span className="flex items-center gap-1 text-[11px] font-normal text-ink-3">
                    <TierSwatch tier={t} size={6} />
                    {TIER_LABEL[t]} · <span className={t === "crossing" ? undefined : "num"}>{TIER_RANGE[t]}</span>
                  </span>
                </span>
                <span className="text-[12px] leading-[17px] text-ink-3">{TIER_SHARES[t].items.join(", ")}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {extras.length ? (
        <div>
          <div className="mb-1.5 text-[12px] text-ink-3">Listed for this pair</div>
          <ul className="flex flex-wrap gap-1.5">
            {extras.map((s) =>
              isRightSizingItem(s) ? (
                <li key={s}>
                  <Tooltip content={RIGHT_SIZING_TIP} width={260}>
                    <Chip className="border-dashed">
                      <Scale size={12} aria-hidden className="text-ink-3" />
                      {s}
                    </Chip>
                  </Tooltip>
                </li>
              ) : (
                <li key={s}>
                  <Chip>{s}</Chip>
                </li>
              ),
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DistanceBlock({ overlap }: { overlap: Overlap }) {
  const note = roadNote(overlap);
  const max = Math.max(overlap.distanceKm, overlap.roadKm ?? 0, 1);
  const bar = (km: number, strong: boolean) => (
    <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-wash-2">
      <span
        className={cx("absolute inset-y-0 left-0 rounded-full", strong ? "bg-ink-2" : "bg-ink-3/60")}
        style={{ width: `${Math.max(2, (km / max) * 100)}%` }}
      />
    </span>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="w-[86px] text-ink-2">Straight line</span>
        {bar(overlap.distanceKm, true)}
        <span className="num w-[58px] text-right text-ink">{fmtKm(overlap.distanceKm)}</span>
      </div>
      <div className="flex items-center gap-3 text-[13px]">
        <span className="w-[86px] text-ink-2">By road</span>
        {overlap.roadKm != null ? bar(overlap.roadKm, false) : <span className="flex-1 text-[12px] text-ink-3">not computed</span>}
        <span className="num w-[58px] text-right text-ink">{fmtKm(overlap.roadKm)}</span>
      </div>
      {note.kind !== "unknown" ? (
        <div className="mt-0.5">
          <Chip tone={note.kind === "far" ? "alert" : note.kind === "detour" ? "quiet" : "neutral"}>
            {note.kind === "verified" ? <Check size={12} aria-hidden /> : null}
            {note.text}
          </Chip>
        </div>
      ) : null}
    </div>
  );
}

function YardBlock({ overlap }: { overlap: Overlap }) {
  const y = overlap.stagingYard!;
  const max = Math.max(60, y.driveMinutesDesc, y.driveMinutesGpc);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2 text-[13px] text-ink">
        <MapPin size={16} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
        <span>
          {y.label}
          <span className="num block text-[12px] text-ink-3">
            {y.position[1].toFixed(4)}, {y.position[0].toFixed(4)}
          </span>
        </span>
      </div>
      {(["DESC", "GPC"] as const).map((u) => {
        const min = u === "DESC" ? y.driveMinutesDesc : y.driveMinutesGpc;
        return (
          <div key={u} className="flex items-center gap-3 text-[13px]">
            <span className="flex w-[86px] items-center gap-1.5 text-ink-2">
              <UtilityDot utility={u} size={7} />
              {u === "DESC" ? "DESC" : "Georgia Pwr"}
            </span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-wash-2">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(min / max) * 100}%`, background: UTILITY_HEX[u] }}
              />
            </span>
            <span className="num w-[58px] text-right text-ink">{fmtMinutes(min)}</span>
          </div>
        );
      })}
      <p className="text-[12px] text-ink-3">Drive time from the yard to each project&apos;s closest point.</p>
    </div>
  );
}

function CostBlock({ overlap }: { overlap: Overlap }) {
  const c = overlap.cost;
  if (!c) return <p className="text-[13px] text-ink-3">No cost estimate for this pair.</p>;
  const rows: [string, number, string?][] = [
    ["Land and right-of-way", c.landSavingsUsd, c.sharedAcres ? `${c.sharedAcres} acres × ${fmtUsd(c.landValuePerAcreUsd)}/acre` : undefined],
    ["Crew mobilization", c.mobilizationSavingsUsd],
    ["Shared laydown yard", c.yardSavingsUsd],
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col text-[13px]">
        {rows.map(([label, v, sub]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-hairline py-1.5">
            <dt className="text-ink-2">
              {label}
              {sub ? <span className="num block text-[11px] text-ink-3">{sub}</span> : null}
            </dt>
            <dd className="num text-ink">{fmtUsd(v, { compact: false })}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 pt-2">
          <dt className="font-medium text-ink">Estimated total</dt>
          <dd className="num text-[15px] font-medium text-ink">{fmtUsd(c.totalUsd, { compact: false })}</dd>
        </div>
      </dl>
      {c.sharedCorridorKm > 0 ? (
        <p className="text-[12px] text-ink-3">
          Shared corridor <span className="num text-ink-2">{fmtKm(c.sharedCorridorKm)}</span> ·{" "}
          <span className="num text-ink-2">{fmtInt(c.sharedAcres)}</span> acres
        </p>
      ) : null}
      {c.assumptions.length ? (
        <details className="group rounded-[8px] bg-wash px-3 py-2">
          <summary className="cursor-pointer list-none text-[12px] font-medium text-ink-2 marker:hidden">
            <span className="inline-block transition-transform duration-150 group-open:rotate-90">›</span> Assumptions (
            <span className="num">{c.assumptions.length}</span>)
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-[17px] text-ink-2">
            {c.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SourceLink({ project }: { project: Project }) {
  const href = sourceHref(project);
  const body = (
    <>
      <UtilityDot utility={project.utility} size={7} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-[18px] text-ink">{project.source.document}</span>
        <span className="num block text-[12px] text-ink-3">
          {project.source.page != null ? `page ${project.source.page}` : "page not recorded"} · in service{" "}
          {fmtMonthYear(project.inService)}
        </span>
      </span>
      {href ? <ArrowUpRight size={16} aria-hidden className="shrink-0 text-ink-3" /> : null}
    </>
  );
  return (
    <li>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-2.5 rounded-[8px] p-1.5 -m-1.5 transition-colors hover:bg-wash"
        >
          {body}
        </a>
      ) : (
        <div className="flex items-start gap-2.5">{body}</div>
      )}
    </li>
  );
}

function CopyMemo({ overlap, desc, gpc, rank }: { overlap: Overlap; desc: Project; gpc: Project; rank: number }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(t);
  }, [state]);

  async function copy() {
    const memo = buildMemo(overlap, desc, gpc, rank);
    try {
      await navigator.clipboard.writeText(memo);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="primary" onClick={copy} className="flex-1">
        {state === "copied" ? <Check size={14} aria-hidden /> : <ClipboardCopy size={14} aria-hidden />}
        {state === "copied" ? "Memo copied" : "Copy coordination memo"}
      </Button>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Coordination memo copied to clipboard" : state === "failed" ? "Copy failed" : ""}
      </span>
      {state === "failed" ? <span className="text-[12px] text-alert">Clipboard blocked</span> : null}
    </div>
  );
}

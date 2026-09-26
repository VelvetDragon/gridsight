"use client";

import { Check, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ACTION_LABEL, fmtKm, fmtKv, fmtMinutes, fmtMonthYear } from "@/lib/format";
import {
  buildMemo,
  isRightSizingCandidate,
  isRightSizingItem,
  RIGHT_SIZING_TIP,
  roadNote,
  sourceHref,
} from "@/lib/plan";
import type { Opportunity } from "@/lib/opportunities";
import type { RankedOverlap } from "@/lib/ranking";
import { TIER_LABEL, TIER_RANGE, TIER_SHARES, TIERS, UTILITY_HEX, UTILITY_NAME } from "@/lib/theme";
import type { Overlap, Project } from "@/lib/types";
import {
  Button,
  Chip,
  CompanyBlock,
  cx,
  Divider,
  IconButton,
  Panel,
  PanelHeader,
  SectionTitle,
  TierSwatch,
  Tooltip,
  UtilityDot,
} from "../ui/primitives";
import { matchSavings } from "@/lib/savings";
import { MiniGantt } from "./MiniGantt";
import { DocumentLink, MatchSavingsBlock } from "./Savings";
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
    <section className="flex flex-col gap-3 px-5 py-5">
      <SectionTitle aside={aside}>{title}</SectionTitle>
      {children}
    </section>
  );
}

export function MatchDrawer({ item, desc, gpc, radarMonth, onClose }: MatchDrawerProps) {
  const o = item.overlap;
  const savings = matchSavings(o, desc, gpc);
  const rightSizing = isRightSizingCandidate(o, desc, gpc);

  return (
    <Panel className="flex h-full w-[408px] flex-col overflow-hidden" aria-label="Selected pair">
      <PanelHeader
        title={
          <>
            Pair #{item.rank}: {TIER_LABEL[o.tier].toLowerCase()}
          </>
        }
        subtitle="What these two projects have in common, and what the two companies could do together."
        actions={
          <IconButton label="Close details" onClick={onClose}>
            <X size={16} />
          </IconButton>
        }
      />
      <div className="flex flex-col gap-3 px-5 pb-4">
        <PairName utility="DESC" project={desc} fallback={o.descId} />
        <PairName utility="GPC" project={gpc} fallback={o.gpcId} />
        {rightSizing || o.robustness === "uncertain" ? (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {rightSizing ? <RightSizingChip /> : null}
            {o.robustness === "uncertain" ? (
              <Tooltip content="At least one project's location is approximate. The distance could change once exact routes are known.">
                <Chip tone="quiet">Location approximate</Chip>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>

      <Divider />

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-5 pb-1">
          {savings ? <MatchSavingsBlock savings={savings} /> : null}
          <p className={cx("text-[14px] leading-[22px] text-ink", savings && "mt-4")}>{o.summary}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-[12px] border border-hairline bg-white/50 px-4 py-3">
            <BigStat label="Distance apart" value={fmtKm(o.distanceKm)} />
            <BigStat
              label="Both building"
              value={o.timelineOverlapMonths > 0 ? `${Math.round(o.timelineOverlapMonths)} months` : "–"}
              note={o.timelineOverlapMonths > 0 ? undefined : "not at the same time"}
            />
          </dl>
        </div>

        <Section title="What they can share">
          <ShareLadder overlap={o} />
        </Section>

        <Divider className="mx-5" />

        <Section title="When each one is built">
          {desc && gpc ? <MiniGantt desc={desc} gpc={gpc} cursorMonth={radarMonth} /> : null}
        </Section>

        <Divider className="mx-5" />

        <Section title="How far apart">
          <DistanceBlock overlap={o} />
        </Section>

        {o.stagingYard ? (
          <>
            <Divider className="mx-5" />
            <Section title="Suggested shared staging yard">
              <YardBlock overlap={o} />
            </Section>
          </>
        ) : null}

        <Divider className="mx-5" />

        <Section title="Where this comes from">
          <ul className="flex flex-col gap-2">
            {[desc, gpc].map((p) => (p ? <SourceLink key={p.id} project={p} /> : null))}
            {savings?.sources.map((s) => <DocumentLink key={`${s.url}#${s.page}`} source={s} />)}
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
    <CompanyBlock
      utility={utility}
      size="lg"
      detail={
        project ? (
          <>
            {ACTION_LABEL[project.action]} · <span className="num">{fmtKv(project.voltageKv)}</span>
            {project.miles != null ? (
              <>
                {" · "}
                <span className="num">{project.miles} mi</span>
              </>
            ) : null}
            {" · ready "}
            {fmtMonthYear(project.inService)}
          </>
        ) : null
      }
    >
      {project?.name ?? fallback}
    </CompanyBlock>
  );
}

function BigStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className="display text-[22px] leading-7 font-medium text-ink">{value}</dd>
      {note ? <dd className="text-[11px] text-ink-3">{note}</dd> : null}
    </div>
  );
}

export function ShareLadder({ overlap }: { overlap: Overlap }) {
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
                <span className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink">
                  {TIER_SHARES[t].title}
                  <span className="flex items-center gap-1 text-[12px] font-normal text-ink-3">
                    <TierSwatch tier={t} size={6} />
                    {TIER_RANGE[t]}
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
          <div className="mb-1 text-[12px] text-ink-3">Specifically for this pair</div>
          <p className="text-[13px] leading-5 text-ink-2">
            {extras.map((item, i) => (
              <span key={item}>
                {i > 0 ? ", " : null}
                {isRightSizingItem(item) ? (
                  <Tooltip content={RIGHT_SIZING_TIP} width={260}>
                    <span className="underline decoration-dotted underline-offset-2">{item}</span>
                  </Tooltip>
                ) : (
                  item
                )}
              </span>
            ))}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function DistanceBlock({ overlap }: { overlap: Overlap }) {
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
        <span className="w-[118px] text-ink-2">Straight line</span>
        {bar(overlap.distanceKm, true)}
        <span className="num w-[58px] text-right text-ink">{fmtKm(overlap.distanceKm)}</span>
      </div>
      <div className="flex items-center gap-3 text-[13px]">
        <span className="w-[118px] text-ink-2">By road</span>
        {overlap.roadKm != null ? (
          bar(overlap.roadKm, false)
        ) : (
          <span className="flex-1 text-[12px] text-ink-3">not computed</span>
        )}
        <span className="num w-[58px] text-right text-ink">{fmtKm(overlap.roadKm)}</span>
      </div>
      {note.kind !== "unknown" ? (
        <div className="mt-0.5">
          <p className={cx("text-[13px]", note.kind === "far" ? "text-alert" : "text-ink-2")}>
            {note.kind === "verified"
              ? "Drive-verified: the road trip is short enough to share crews."
              : note.kind === "detour"
                ? `${note.text}: crews have to drive around to a bridge.`
                : note.text}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function YardBlock({ overlap }: { overlap: Overlap }) {
  const y = overlap.stagingYard!;
  const max = Math.max(60, y.driveMinutesDesc, y.driveMinutesGpc);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[14px] text-ink">
        {y.label}
        <span className="num block text-[12px] text-ink-3">
          {y.position[1].toFixed(4)}, {y.position[0].toFixed(4)}
        </span>
      </div>
      {(["DESC", "GPC"] as const).map((u) => {
        const min = u === "DESC" ? y.driveMinutesDesc : y.driveMinutesGpc;
        return (
          <div key={u} className="flex items-center gap-3 text-[13px]">
            <span className="flex w-[118px] items-center gap-1.5 text-ink-2">
              <UtilityDot utility={u} size={7} />
              {UTILITY_NAME[u]}
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
      <p className="text-[12px] text-ink-3">
        Drive time from the yard to each project. Marked on the map as a small square.
      </p>
    </div>
  );
}

export function SourceLink({ project }: { project: Project }) {
  const href = sourceHref(project);
  const body = (
    <>
      <span
        aria-hidden
        className="w-[3px] shrink-0 self-stretch rounded-full"
        style={{ background: UTILITY_HEX[project.utility] }}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold" style={{ color: UTILITY_HEX[project.utility] }}>
          {UTILITY_NAME[project.utility]}
        </span>
        <span
          className={cx(
            "block text-[13px] leading-[18px] text-ink",
            href && "underline decoration-hairline-strong underline-offset-2",
          )}
        >
          {project.source.document}
        </span>
        <span className="block text-[12px] text-ink-3">
          {project.source.page != null ? (
            <>
              page <span className="num">{project.source.page}</span>
            </>
          ) : (
            "page not recorded"
          )}
        </span>
      </span>
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

export function CopyMemo({
  overlap,
  desc,
  gpc,
  rank,
  opportunities,
}: {
  overlap: Overlap;
  desc: Project;
  gpc: Project;
  rank: number;
  opportunities?: Opportunity[];
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(t);
  }, [state]);

  async function copy() {
    const memo = buildMemo(overlap, desc, gpc, rank, opportunities);
    try {
      await navigator.clipboard.writeText(memo);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="primary" onClick={copy} className="h-9 flex-1">
        {state === "copied" ? "Memo copied" : "Copy coordination memo"}
      </Button>
      <a
        href={`mailto:?subject=${encodeURIComponent(
          `Coordination opportunity: ${desc.name} and ${gpc.name}`,
        )}&body=${encodeURIComponent(buildMemo(overlap, desc, gpc, rank, opportunities))}`}
        className="inline-flex h-9 items-center rounded-[10px] border border-hairline px-3 text-[13px] font-medium text-ink hover:bg-wash-2"
        title="Opens your email app with the memo ready to send to the other utility's planner"
      >
        Email memo
      </a>
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Coordination memo copied to clipboard" : state === "failed" ? "Copy failed" : ""}
      </span>
      {state === "failed" ? <span className="text-[12px] text-alert">Clipboard blocked</span> : null}
    </div>
  );
}

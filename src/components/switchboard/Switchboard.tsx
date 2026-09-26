"use client";

import { ArrowRight, ArrowUpRight, CloudLightning } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/lib/auth";
import { useRecentComparisons } from "@/lib/recent";
import { useCountUp } from "@/lib/useCountUp";
import { UTILITY_HEX } from "@/lib/theme";
import { AppShell, NAV_CLEARANCE } from "../shell/AppShell";
import { NAV } from "../shell/nav";
import { HeroMap, useHeroData, useLiveStormLine, type HeroData } from "./HeroMap";
import { CrosswireArt, LedgerArt, StormlineArt } from "./Illustrations";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function today(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** The headline numbers, counted from the pipeline's own files. */
function factsFrom(data: HeroData | null) {
  if (!data) return null;
  const desc = data.projects.filter((p) => p.utility === "DESC").length;
  const gpc = data.projects.filter((p) => p.utility === "GPC").length;
  const crossings = data.overlaps.filter((o) => o.tier === "crossing").length;
  const savings = data.overlaps.reduce((sum, o) => sum + (o.cost?.totalUsd ?? 0), 0);
  return { desc, gpc, projects: desc + gpc, overlaps: data.overlaps.length, crossings, savings, storms: data.storms };
}

/** Switchboard: the first page after signing in. */
export function Switchboard() {
  const session = useSession();
  const recent = useRecentComparisons();
  const data = useHeroData();
  const live = useLiveStormLine();
  const facts = factsFrom(data);
  const first = session.status === "authenticated" ? session.session.user.name.split(" ")[0] : null;

  return (
    <AppShell>
      <main className="h-dvh overflow-y-auto bg-paper">
        {/* Hero */}
        <section
          className="relative mx-auto grid max-w-[1360px] items-center gap-10 px-6 pb-10 lg:min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12 lg:px-10"
          style={{ paddingTop: NAV_CLEARANCE + 24 }}
        >
          <div className="max-w-[560px]">
            <p className="sb-rise text-[14px] text-ink-3" style={{ animationDelay: "0.05s" }} suppressHydrationWarning>
              {today()}
              {first ? (
                <>
                  <span className="mx-2 text-hairline-strong">/</span>
                  {greeting()}, {first}.
                </>
              ) : null}
            </p>

            <h1
              className="display sb-rise mt-4 text-[44px] leading-[1.04] font-medium tracking-[-0.02em] text-ink sm:text-[58px]"
              style={{ animationDelay: "0.12s" }}
            >
              Two utilities share a border.{" "}
              <span className="relative inline-block whitespace-nowrap">
                Their plans meet
                <Squiggle />
              </span>{" "}
              in <Counted value={facts?.overlaps} /> places.
            </h1>

            <p className="sb-rise mt-6 text-[17px] leading-[27px] text-ink-2" style={{ animationDelay: "0.22s" }}>
              <Utility id="DESC">Dominion Energy South Carolina</Utility> and <Utility id="GPC">Georgia Power</Utility>{" "}
              plan <Counted value={facts?.projects} /> transmission projects along the Savannah River. MrGridy finds where
              they could share land, staging yards or crews, and replays past hurricanes to show how much sooner the
              lights come back when they work together.
            </p>

            <div className="sb-rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "0.32s" }}>
              <Link
                href="/compare"
                className="group inline-flex h-12 items-center gap-2 rounded-full bg-ink pr-5 pl-6 text-[15px] font-medium text-paper shadow-[0_10px_30px_-10px_rgba(20,24,30,0.55)] transition hover:bg-ink-2"
              >
                See where they meet
                <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <Link
                href="/storm?storm=helene"
                className="glass group inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium text-ink transition hover:bg-white/80"
              >
                <CloudLightning size={17} className="text-slate" aria-hidden />
                Replay Hurricane Helene
              </Link>
            </div>

            <dl className="sb-rise mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-hairline pt-6 sm:grid-cols-4" style={{ animationDelay: "0.42s" }}>
              <Fact value={facts?.projects} label="planned projects" note={facts ? `${facts.desc} SC · ${facts.gpc} GA` : ""} />
              <Fact value={facts?.overlaps} label="places they meet" note={facts ? `${facts.crossings} actually cross` : ""} />
              <Fact
                value={facts ? Math.round(facts.savings / 100_000) / 10 : undefined}
                decimals={1}
                prefix="$"
                suffix="M"
                label="could be saved"
                note="central estimate"
              />
              <Fact value={facts?.storms} label="hurricanes" note="replayed 10,000 times each" />
            </dl>
          </div>

          <div className="sb-rise relative" style={{ animationDelay: "0.1s" }}>
            <div className="relative aspect-[5/4] w-full overflow-hidden rounded-[28px] border border-hairline bg-[#F7F4EE] shadow-[0_40px_80px_-40px_rgba(20,24,30,0.35),inset_0_1px_0_rgba(255,255,255,0.8)]">
              {data ? (
                <HeroMap
                  projects={data.projects}
                  overlaps={data.overlaps}
                  states={data.states}
                  river={data.river}
                  liveLine={live}
                />
              ) : (
                <div className="grid h-full place-items-center text-[14px] text-ink-3">Drawing both grids…</div>
              )}
            </div>
            <p className="mt-3 px-2 text-[12.5px] text-ink-3">
              Every line is a planned project from the utilities&apos; public plans. Hover a marker to read it, click to open it.
            </p>
          </div>
        </section>

        {/* Ways in */}
        <section className="mx-auto max-w-[1360px] px-6 pt-6 pb-10 lg:px-10" aria-labelledby="ways-h">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="ways-h" className="display text-[28px] font-medium text-ink">
              Three ways in
            </h2>
            <span className="hidden text-[13px] text-ink-3 sm:inline">
              Press <Kbd>2</Kbd> <Kbd>3</Kbd> <Kbd>4</Kbd> from anywhere
            </span>
          </div>
          <ul className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
            <Door
              nav={NAV[1]}
              k="2"
              art={<CrosswireArt />}
              line={facts ? `${facts.overlaps} places, ranked by distance and timing` : "Ranked by distance and timing"}
            />
            <Door
              nav={NAV[2]}
              k="3"
              art={<StormlineArt />}
              line={facts ? `${facts.storms} past hurricanes and a live storm watch` : "Past hurricanes and a live storm watch"}
            />
            <Door
              nav={NAV[3]}
              k="4"
              art={<LedgerArt />}
              line={facts ? `${facts.projects} projects, every source, one click to Excel` : "Every source, one click to Excel"}
            />
          </ul>
        </section>

        {/* Recent */}
        <section className="mx-auto max-w-[1360px] px-6 pb-20 lg:px-10" aria-labelledby="recent-h">
          <h2 id="recent-h" className="display text-[22px] font-medium text-ink">
            Recent comparisons
          </h2>
          {recent.length ? (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((r) => (
                <li key={`${r.you}-${r.neighbor}`}>
                  <Link
                    href={`/compare?you=${encodeURIComponent(r.you)}&neighbor=${encodeURIComponent(r.neighbor)}`}
                    className="group flex items-center gap-3 rounded-[14px] border border-hairline bg-white/55 px-4 py-3.5 transition hover:-translate-y-0.5 hover:bg-white/85"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] text-ink">{r.label}</div>
                      <div className="text-[12.5px] text-ink-3" suppressHydrationWarning>
                        {r.overlaps != null ? `${r.overlaps} places · ` : ""}
                        {ago(r.at)}
                      </div>
                    </div>
                    <ArrowUpRight size={16} className="text-ink-3 transition group-hover:text-ink" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[15px] text-ink-2">
              Nothing yet. Pairs you open in{" "}
              <Link href="/compare" className="font-medium text-ink underline underline-offset-2">
                Crosswire
              </Link>{" "}
              will be waiting here.
            </p>
          )}
        </section>
      </main>
    </AppShell>
  );
}

/* ---------------------------------------------------------------- pieces */

function Counted({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
}: {
  value: number | undefined;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  const n = useCountUp(value ?? 0, 1400);
  if (value === undefined) return <span className="text-ink-3">…</span>;
  return (
    <span className="tabular-nums">
      {prefix}
      {n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

function Fact({
  value,
  label,
  note,
  decimals,
  prefix,
  suffix,
}: {
  value: number | undefined;
  label: string;
  note: string;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div>
      <dd className="num text-[28px] leading-8 font-medium text-ink">
        <Counted value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
      </dd>
      <dt className="mt-1 text-[13px] leading-[18px] text-ink-2">{label}</dt>
      <div className="text-[12px] text-ink-3">{note}</div>
    </div>
  );
}

function Utility({ id, children }: { id: "DESC" | "GPC"; children: ReactNode }) {
  return (
    <span className="font-medium whitespace-nowrap text-ink">
      <span className="mr-1.5 inline-block h-[3px] w-3.5 -translate-y-[3px] rounded-full" style={{ background: UTILITY_HEX[id] }} />
      {children}
    </span>
  );
}

/** A hand-drawn underline: Dominion teal meeting Georgia Power orange. */
function Squiggle() {
  return (
    <svg className="absolute -bottom-2 left-0 h-3 w-full overflow-visible" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="sb-squiggle" x1="0" x2="1">
          <stop offset="0" stopColor={UTILITY_HEX.DESC} />
          <stop offset="1" stopColor={UTILITY_HEX.GPC} />
        </linearGradient>
      </defs>
      <path
        d="M2 8 C40 2 70 11 110 6 S190 2 230 7 S280 9 298 4"
        fill="none"
        stroke="url(#sb-squiggle)"
        strokeWidth="3.2"
        strokeLinecap="round"
        pathLength={1}
        className="sb-underline"
      />
    </svg>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded-[5px] border border-hairline-strong bg-white/60 px-1.5 py-px font-mono text-[11px] text-ink-2">
      {children}
    </kbd>
  );
}

function Door({ nav, k, art, line }: { nav: (typeof NAV)[number]; k: string; art: ReactNode; line: string }) {
  return (
    <li>
      <Link
        href={nav.href}
        className="sb-door group flex h-full flex-col overflow-hidden rounded-[20px] border border-hairline bg-white/55 shadow-[0_1px_2px_rgba(20,24,30,0.05)] transition-all duration-300 hover:-translate-y-1 hover:bg-white/85 hover:shadow-[0_24px_48px_-24px_rgba(20,24,30,0.3)]"
      >
        <div className="relative h-[170px] overflow-hidden border-b border-hairline bg-[#F2EEE6]">
          <div className="h-full transition-transform duration-500 ease-out group-hover:scale-[1.06]">{art}</div>
          <span className="absolute top-3 right-3 rounded-[6px] border border-hairline-strong bg-white/70 px-1.5 font-mono text-[11px] text-ink-3">
            {k}
          </span>
        </div>
        <div className="flex flex-1 flex-col px-6 pt-5 pb-5">
          <span className="display text-[26px] leading-8 font-medium text-ink">{nav.name}</span>
          <span className="mt-1.5 text-[15px] leading-[23px] text-ink-2">{nav.tagline}</span>
          <span className="mt-3 text-[13px] text-ink-3">{line}</span>
          <span className="mt-auto flex items-center gap-1.5 pt-5 text-[14px] font-medium text-ink">
            Open {nav.name}
            <ArrowRight size={15} aria-hidden className="transition-transform duration-200 group-hover:translate-x-1" />
          </span>
        </div>
      </Link>
    </li>
  );
}

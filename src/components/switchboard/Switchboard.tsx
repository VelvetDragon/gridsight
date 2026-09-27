"use client";

import { ArrowRight, ArrowUpRight, CloudLightning, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/lib/auth";
import { loadCatalog } from "@/lib/catalog";
import { useRecentComparisons } from "@/lib/recent";
import { UTILITY_HEX } from "@/lib/theme";
import type { CatalogUtility } from "@/lib/types";
import { useCountUp } from "@/lib/useCountUp";
import { AppShell, NAV_CLEARANCE } from "../shell/AppShell";
import { NAV } from "../shell/nav";
import { HeroMap, useHeroData, useLiveStormLine, useStormUtilities, type HeroData } from "./HeroMap";
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

/** Numbers for the featured pair, counted from the pipeline's own files. */
function pairFacts(data: HeroData | null) {
  if (!data) return null;
  const crossings = data.overlaps.filter((o) => o.tier === "crossing").length;
  return { projects: data.projects.length, overlaps: data.overlaps.length, crossings };
}

/** Every utility that can be compared right now: the catalog plus any found with "Find another utility". */
function useUtilities(): CatalogUtility[] | null {
  const [list, setList] = useState<CatalogUtility[] | null>(null);
  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then(({ data }) => alive && setList(data.utilities))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

/** Switchboard: the first page after signing in. */
export function Switchboard() {
  const session = useSession();
  const recent = useRecentComparisons();
  const data = useHeroData();
  const live = useLiveStormLine();
  const stormUtilities = useStormUtilities(data?.storms);
  const utilities = useUtilities();
  const pair = pairFacts(data);
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
              className="display sb-rise mt-4 text-[44px] leading-[1.04] font-medium tracking-[-0.02em] text-ink sm:text-[56px]"
              style={{ animationDelay: "0.12s" }}
            >
              Neighbouring utilities plan alone. See where{" "}
              <span className="relative inline-block whitespace-nowrap">
                their plans meet.
                <Squiggle />
              </span>
            </h1>

            <p className="sb-rise mt-6 text-[17px] leading-[27px] text-ink-2" style={{ animationDelay: "0.22s" }}>
              Pick any two utilities. MrGridy reads their public transmission plans and finds where they could share
              land, staging yards or crews. Then it replays past hurricanes over every grid in the region to show how
              much sooner the lights come back when neighbours share crews.
            </p>

            <div className="sb-rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "0.32s" }}>
              <Link
                href="/compare"
                className="group inline-flex h-12 items-center gap-2 rounded-full bg-ink pr-5 pl-6 text-[15px] font-medium text-paper shadow-[0_10px_30px_-10px_rgba(20,24,30,0.55)] transition hover:bg-ink-2"
              >
                Compare two utilities
                <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
              <Link
                href="/storm"
                className="glass group inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-medium text-ink transition hover:bg-white/80"
              >
                <CloudLightning size={17} className="text-slate" aria-hidden />
                Replay a hurricane
              </Link>
            </div>

            <dl
              className="sb-rise mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-hairline pt-6 sm:grid-cols-4"
              style={{ animationDelay: "0.42s" }}
            >
              <Fact value={data?.storms.length} label="hurricanes" note="replayed 10,000 times each" />
              <Fact value={stormUtilities?.length} label="utilities" note="in the storm model" />
              <Fact value={pair?.overlaps} label="places" note="where the featured pair meets" />
              <Fact value={pair?.crossings} label="lines cross" note="and must be coordinated" />
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
                  title={
                    <>
                      <span className="text-ink-3">Featured pair</span>
                      <Dot color={UTILITY_HEX.DESC} />
                      Dominion Energy SC
                      <span className="text-ink-3">×</span>
                      <Dot color={UTILITY_HEX.GPC} />
                      Georgia Power
                    </>
                  }
                />
              ) : (
                <div className="grid h-full place-items-center text-[14px] text-ink-3">Drawing both grids…</div>
              )}
            </div>
            <p className="mt-3 px-2 text-[12.5px] text-ink-3">
              {pair ? `${pair.projects} planned projects from their public plans. ` : ""}Hover a marker to read it, click
              to open it.{" "}
              <Link href="/compare" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
                Compare a different pair
              </Link>
            </p>
          </div>
        </section>

        {/* Beyond the featured pair */}
        <section className="mx-auto max-w-[1360px] px-6 pt-4 pb-6 lg:px-10" aria-labelledby="range-h">
          <h2 id="range-h" className="display text-[28px] font-medium text-ink">
            Not just these two
          </h2>
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Panel
              kicker="Crosswire"
              title="Any two utilities"
              body="Type a utility's name. Gemini finds its public transmission plan, reads it and places every project. Anything marked CEII is refused."
            >
              <ul className="mt-4 flex flex-wrap gap-2">
                {(utilities ?? []).map((u) => (
                  <li key={u.id}>
                    <span className="inline-flex h-9 items-center gap-2 rounded-full border border-hairline bg-white/70 pr-3.5 pl-3 text-[13.5px] text-ink">
                      <Dot color={u.color} />
                      {u.name}
                      {u.projectCount ? <span className="num text-ink-3">{u.projectCount}</span> : null}
                      {u.origin === "gemini" ? <Sparkles size={12} className="text-ink-3" aria-label="added with Gemini" /> : null}
                    </span>
                  </li>
                ))}
                <li>
                  <Link
                    href="/compare?find=1"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-hairline-strong px-3.5 text-[13.5px] font-medium text-ink-2 transition hover:border-ink hover:bg-white/70 hover:text-ink"
                  >
                    <Plus size={14} aria-hidden />
                    Add a utility
                  </Link>
                </li>
              </ul>
              <ol className="mt-auto grid gap-3 border-t border-hairline pt-5 sm:grid-cols-3">
                {[
                  ["Type a name", "Any utility with a public transmission plan."],
                  ["Gemini reads it", "Projects, dates and places, in one fixed format."],
                  ["See where you meet", "Ranked by distance and timing, on the map."],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-2.5">
                    <span className="num grid size-5 shrink-0 place-items-center rounded-full border border-hairline-strong text-[11px] text-ink-2">
                      {i + 1}
                    </span>
                    <span>
                      <span className="block text-[13.5px] font-medium text-ink">{t}</span>
                      <span className="block text-[12.5px] leading-[17px] text-ink-3">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>

            <Panel
              kicker="Stormline"
              title={
                data && stormUtilities
                  ? `${data.storms.length} hurricanes over ${stormUtilities.length} utilities`
                  : "Past hurricanes over the whole region"
              }
              body={
                stormUtilities
                  ? `Replayed over ${listNames(stormUtilities)}. Pick one to watch it cross the grids.`
                  : "Pick one to watch it cross the grids."
              }
            >
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
                {(data?.storms ?? []).map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/storm?storm=${encodeURIComponent(s.id)}`}
                      title={s.headline}
                      className="group flex items-center justify-between gap-2 rounded-[12px] border border-hairline bg-white/60 px-3 py-2 transition hover:-translate-y-0.5 hover:border-hairline-strong hover:bg-white"
                    >
                      <span>
                        <span className="block text-[14px] font-medium text-ink">{s.name}</span>
                        <span className="num block text-[11.5px] whitespace-nowrap text-ink-3">
                          {s.year} · {s.focus}
                        </span>
                      </span>
                      <ArrowUpRight size={14} className="shrink-0 text-ink-3 transition group-hover:text-ink" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </section>

        {/* Ways in */}
        <section className="mx-auto max-w-[1360px] px-6 pt-10 pb-10 lg:px-10" aria-labelledby="ways-h">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id="ways-h" className="display text-[28px] font-medium text-ink">
              Three ways in
            </h2>
            <span className="hidden text-[13px] text-ink-3 sm:inline">
              Press <Kbd>2</Kbd> <Kbd>3</Kbd> <Kbd>4</Kbd> from anywhere
            </span>
          </div>
          <ul className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
            <Door nav={NAV[1]} k="2" art={<CrosswireArt />} line="Any two utilities, ranked by distance and timing" />
            <Door
              nav={NAV[2]}
              k="3"
              art={<StormlineArt />}
              line={data ? `${data.storms.length} past hurricanes and a live storm watch` : "Past hurricanes and a live storm watch"}
            />
            <Door nav={NAV[3]} k="4" art={<LedgerArt />} line="Every project and source, one click to Excel" />
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

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function Counted({ value }: { value: number | undefined }) {
  const n = useCountUp(value ?? 0, 1400);
  if (value === undefined) return <span className="text-ink-3">…</span>;
  return <span className="tabular-nums">{Math.round(n).toLocaleString("en-US")}</span>;
}

function Fact({ value, label, note }: { value: number | undefined; label: string; note: string }) {
  return (
    <div>
      <dd className="num text-[28px] leading-8 font-medium text-ink">
        <Counted value={value} />
      </dd>
      <dt className="mt-1 text-[13px] leading-[18px] text-ink-2">{label}</dt>
      <div className="text-[12px] leading-[16px] text-ink-3">{note}</div>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

function Panel({
  kicker,
  title,
  body,
  children,
}: {
  kicker: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-[20px] border border-hairline bg-white/45 p-6">
      <div className="text-[12px] font-medium tracking-[0.08em] text-ink-3 uppercase">{kicker}</div>
      <h3 className="display mt-1 text-[22px] leading-7 font-medium text-ink">{title}</h3>
      <p className="mt-2 text-[14.5px] leading-[22px] text-ink-2">{body}</p>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
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
        className="group flex h-full flex-col overflow-hidden rounded-[20px] border border-hairline bg-white/55 shadow-[0_1px_2px_rgba(20,24,30,0.05)] transition-all duration-300 hover:-translate-y-1 hover:bg-white/85 hover:shadow-[0_24px_48px_-24px_rgba(20,24,30,0.3)]"
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

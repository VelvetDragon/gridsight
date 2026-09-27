"use client";

import { ArrowRight, ArrowUpRight, ChevronDown, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { loadCatalog } from "@/lib/catalog";
import { useRecentComparisons } from "@/lib/recent";
import { UTILITY_HEX } from "@/lib/theme";
import type { CatalogUtility } from "@/lib/types";
import { AppShell, NAV_CLEARANCE } from "../shell/AppShell";
import { NAV } from "../shell/nav";
import { HeroMap, useHeroData, useLiveStormLine, useStormUtilities, type HeroData } from "./HeroMap";
import { CrosswireArt, LedgerArt, StormlineArt } from "./Illustrations";

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
  const recent = useRecentComparisons();
  const data = useHeroData();
  const live = useLiveStormLine();
  const stormUtilities = useStormUtilities(data?.storms);
  const utilities = useUtilities();
  const pair = pairFacts(data);

  return (
    <AppShell>
      <main className="h-dvh overflow-y-auto bg-paper">
        {/* Hero: the pitch, the map and the three screens, all above the fold */}
        <section
          className="relative mx-auto flex max-w-[1360px] flex-col px-6 pb-8 lg:min-h-dvh lg:justify-center lg:pb-16 lg:px-10"
          style={{ paddingTop: NAV_CLEARANCE + 16 }}
        >
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
            <div className="max-w-[560px]">
              <h1
                className="display sb-rise text-[42px] leading-[1.05] font-medium tracking-[-0.02em] text-ink sm:text-[clamp(40px,6.2dvh,50px)]"
                style={{ animationDelay: "0.12s" }}
              >
                Build together in blue skies.
                <br />
                Recover{" "}
                <span className="relative inline-block whitespace-nowrap">
                  together
                  <Squiggle />
                </span>{" "}
                in gray skies.
              </h1>

              <p className="sb-rise mt-5 text-[17px] leading-[27px] text-ink-2" style={{ animationDelay: "0.22s" }}>
                MrGridy maps where neighbouring power companies meet, using only public data, so they can share the work{" "}
                <span className="font-medium text-ink">when they build</span> new lines and share crews{" "}
                <span className="font-medium text-ink">when a hurricane hits</span>.
              </p>

            </div>

            <div className="sb-rise relative" style={{ animationDelay: "0.1s" }}>
              <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[26px] border border-hairline bg-[#F7F4EE] shadow-[0_40px_80px_-40px_rgba(20,24,30,0.35),inset_0_1px_0_rgba(255,255,255,0.8)] lg:aspect-auto lg:h-[min(56dvh,480px)]">
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
              <p className="mt-2.5 px-2 text-[12.5px] text-ink-3">
                {pair ? `${pair.projects} planned projects from their public plans. ` : ""}Hover a marker to read it,
                click to open it.{" "}
                <Link href="/compare" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink">
                  Compare a different pair
                </Link>
              </p>
            </div>
          </div>

          {/* The three screens */}
          <ul className="sb-rise mt-6 grid grid-cols-1 gap-4 md:grid-cols-3" style={{ animationDelay: "0.45s" }} aria-label="Open a screen">
            <Door
              nav={NAV[1]}
              k="2"
              art={<CrosswireArt />}
              tint={UTILITY_HEX.DESC}
              when="When they build"
              line="Where two utilities' plans meet, and what sharing saves"
            />
            <Door
              nav={NAV[2]}
              k="3"
              art={<StormlineArt />}
              tint="#334155"
              when="Before a hurricane"
              line="Who loses power, who needs workers, who can send them"
            />
            <Door
              nav={NAV[3]}
              k="4"
              art={<LedgerArt />}
              tint={UTILITY_HEX.GPC}
              when="Every number behind them"
              line="Every project, match and source, one click to Excel"
            />
          </ul>

          <button
            type="button"
            onClick={() => document.getElementById("range-h")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="sb-rise absolute bottom-4 left-1/2 hidden -translate-x-1/2 items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] text-ink-3 transition hover:text-ink lg:flex"
            style={{ animationDelay: "1.2s" }}
          >
            Try it yourself
            <ChevronDown size={14} className="sb-nudge" aria-hidden />
          </button>
        </section>

        {/* Beyond the featured pair */}
        <section className="mx-auto max-w-[1360px] scroll-mt-24 px-6 pt-10 pb-6 lg:px-10" aria-labelledby="range-h">
          <h2 id="range-h" className="display scroll-mt-24 text-[28px] font-medium text-ink">
            Try it yourself
          </h2>
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Panel
              kicker="Crosswire"
              title="Compare any two utilities"
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

function Door({
  nav,
  k,
  art,
  tint,
  when,
  line,
}: {
  nav: (typeof NAV)[number];
  k: string;
  art: ReactNode;
  /** The illustration panel's own soft colour, so it never blends into the page. */
  tint: string;
  when: string;
  line: string;
}) {
  return (
    <li>
      <Link
        href={nav.href}
        className="group relative flex h-full items-stretch overflow-hidden rounded-[18px] border border-hairline bg-white/80 shadow-[0_1px_2px_rgba(20,24,30,0.05)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-[0_24px_48px_-24px_rgba(20,24,30,0.32)]"
      >
        <div
          className="m-1.5 mr-0 w-[124px] shrink-0 overflow-hidden rounded-[13px]"
          style={{
            background: `linear-gradient(150deg, ${tint}1f, ${tint}0a 70%), #FBFAF7`,
            boxShadow: `inset 0 0 0 1px ${tint}26`,
          }}
        >
          <div className="flex h-full items-center transition-transform duration-500 ease-out group-hover:scale-[1.12]">{art}</div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col px-4 py-3.5">
          <span className="text-[11.5px] font-medium tracking-[0.07em] text-ink-3 uppercase">{when}</span>
          <span className="display mt-0.5 flex items-center gap-1.5 text-[22px] leading-7 font-medium text-ink">
            {nav.name}
            <ArrowRight size={16} aria-hidden className="text-ink-3 transition-all duration-200 group-hover:translate-x-1 group-hover:text-ink" />
          </span>
          <span className="mt-1 text-[13.5px] leading-[19px] text-ink-2">{line}</span>
        </div>
        <span className="absolute top-2.5 right-2.5 rounded-[5px] border border-hairline-strong bg-white/70 px-1.5 font-mono text-[10.5px] text-ink-3">
          {k}
        </span>
      </Link>
    </li>
  );
}

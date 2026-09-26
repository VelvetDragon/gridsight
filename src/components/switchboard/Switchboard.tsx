"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/lib/auth";
import { useRecentComparisons } from "@/lib/recent";
import { AppShell } from "../shell/AppShell";
import { NAV } from "../shell/nav";
import { CrosswireArt, LedgerArt, StormlineArt } from "./Illustrations";

const CHOICES: { nav: (typeof NAV)[number]; key: string; doing: string; art: ReactNode }[] = [
  { nav: NAV[1], key: "2", doing: "Compare two utilities' plans", art: <CrosswireArt /> },
  { nav: NAV[2], key: "3", doing: "Watch a storm cross both grids", art: <StormlineArt /> },
  { nav: NAV[3], key: "4", doing: "Look up and export the data", art: <LedgerArt /> },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Switchboard: "What do you want to do?" */
export function Switchboard() {
  const session = useSession();
  const recent = useRecentComparisons();
  const first = session.status === "authenticated" ? session.session.user.name.split(" ")[0] : null;

  return (
    <AppShell>
      <main className="min-h-dvh bg-paper px-6 pt-[120px] pb-16">
        <div className="mx-auto max-w-[1120px]">
          <p className="text-[15px] text-ink-3" suppressHydrationWarning>
            {first ? `${greeting()}, ${first}.` : " "}
          </p>
          <h1 className="display mt-1 text-[44px] leading-[52px] font-medium text-ink">What do you want to do?</h1>

          <ul className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-3">
            {CHOICES.map((c) => (
              <li key={c.nav.href}>
                <Link
                  href={c.nav.href}
                  className="group flex h-full flex-col overflow-hidden rounded-[18px] border border-hairline bg-white/55 shadow-[0_1px_2px_rgba(20,24,30,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/80 hover:shadow-[0_12px_32px_-12px_rgba(20,24,30,0.18)]"
                >
                  <div className="h-[180px] border-b border-hairline bg-[#F2EEE6]">{c.art}</div>
                  <div className="flex flex-1 flex-col px-6 pt-5 pb-6">
                    <span className="text-[13px] text-ink-3">{c.doing}</span>
                    <span className="display mt-1 text-[26px] leading-8 font-medium text-ink">{c.nav.name}</span>
                    <span className="mt-2 text-[15px] leading-[23px] text-ink-2">{c.nav.tagline}</span>
                    <span className="mt-auto flex items-center gap-1.5 pt-5 text-[14px] font-medium text-ink">
                      Open {c.nav.name}
                      <ArrowRight
                        size={15}
                        aria-hidden
                        className="transition-transform duration-200 group-hover:translate-x-0.5"
                      />
                      <kbd className="ml-auto rounded-[5px] border border-hairline px-1.5 text-[11px] font-normal text-ink-3">
                        {c.key}
                      </kbd>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          <section className="mt-14" aria-labelledby="recent-h">
            <h2 id="recent-h" className="display text-[22px] font-medium text-ink">
              Recent comparisons
            </h2>
            {recent.length ? (
              <ul className="mt-3 divide-y divide-hairline rounded-[14px] border border-hairline bg-white/50">
                {recent.map((r) => (
                  <li key={`${r.you}-${r.neighbor}`}>
                    <Link
                      href={`/compare?you=${encodeURIComponent(r.you)}&neighbor=${encodeURIComponent(r.neighbor)}`}
                      className="flex items-baseline gap-4 px-5 py-3.5 transition-colors hover:bg-white/70"
                    >
                      <span className="text-[15px] text-ink">{r.label}</span>
                      <span className="text-[13px] text-ink-3">
                        {r.overlaps != null ? `${r.overlaps} places where the plans meet` : null}
                      </span>
                      <span className="ml-auto text-[13px] text-ink-3" suppressHydrationWarning>
                        {ago(r.at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[15px] text-ink-2">
                Nothing yet. Open{" "}
                <Link href="/compare" className="font-medium text-ink underline underline-offset-2">
                  Crosswire
                </Link>{" "}
                and the pairs you compare will show up here.
              </p>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

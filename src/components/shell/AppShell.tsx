"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { cx } from "../ui/primitives";
import { Wordmark } from "../Wordmark";
import { NAV } from "./nav";

export const NAV_TOP = 12;
export const NAV_H = 52;
/** Space the map should keep clear at the top for the floating nav. */
export const NAV_CLEARANCE = NAV_TOP + NAV_H + 12;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return (
    !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
  );
}

/**
 * The app chrome: an always-visible top nav (Switchboard · Crosswire ·
 * Stormline · The Ledger) and keys 1–4 to jump between them. No sign-in: the
 * platform is open.
 */
export function AppShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i >= 0) router.push(NAV[i].href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <>
      {children}
      <nav
        aria-label="Main"
        className="glass fixed z-50 flex items-center gap-2 rounded-[16px] pr-2 pl-4"
        style={{ top: NAV_TOP, left: NAV_TOP, right: NAV_TOP, height: NAV_H }}
      >
        <Link href="/home" className="mr-3 rounded-[8px]" aria-label="MrGridy, Switchboard">
          <Wordmark size={20} />
        </Link>
        <ul className="flex items-center gap-1">
          {NAV.map((item, i) => {
            const active = pathname === item.href;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={`${item.tagline} (press ${i + 1})`}
                  className={cx(
                    "flex h-9 items-center gap-2 rounded-[10px] px-3 text-[14px] font-medium transition-colors duration-150",
                    active
                      ? "bg-white/85 text-ink shadow-[0_0_0_1px_rgba(20,24,30,0.08)]"
                      : "text-ink-2 hover:bg-white/50 hover:text-ink",
                  )}
                >
                  {item.name}
                  <kbd className="hidden rounded-[4px] border border-hairline px-1 text-[10px] leading-4 font-normal text-ink-3 xl:inline">
                    {i + 1}
                  </kbd>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          {aside}
        </div>
      </nav>
    </>
  );
}

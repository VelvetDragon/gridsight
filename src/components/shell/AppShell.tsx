"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut, useSession } from "@/lib/auth";
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
 * Signed-in chrome: an always-visible top nav (Switchboard · Crosswire ·
 * Stormline · The Ledger), keys 1–4 to jump between them, and the user menu.
 * Sends signed-out visitors to /login and brings them back afterwards.
 */
export function AppShell({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();

  useEffect(() => {
    if (session.status !== "unauthenticated") return;
    const next = window.location.pathname + window.location.search;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [session.status, router]);

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
          <UserMenu />
        </div>
      </nav>
    </>
  );
}

function UserMenu() {
  const session = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  if (session.status !== "authenticated") return <span className="h-9 w-9" />;
  const { user } = session.session;
  const initials =
    user.name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Account: ${user.name}`}
        className="display flex h-9 w-9 items-center justify-center rounded-full border border-hairline-strong bg-white/70 text-[14px] font-medium text-ink hover:bg-white"
      >
        {initials}
      </button>
      {open ? (
        <div className="absolute top-11 right-0 w-64 rounded-[14px] border border-hairline bg-[#FCFBF8] p-2 shadow-[var(--shadow-float)]">
          <div className="px-3 py-2">
            <div className="text-[14px] font-medium text-ink">{user.name}</div>
            <div className="text-[12px] text-ink-3">{user.email}</div>
            {session.session.demo ? (
              <div className="mt-1 text-[12px] text-ink-3">Demo account on this device</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
            className="w-full rounded-[10px] px-3 py-2 text-left text-[14px] text-ink-2 hover:bg-wash-2 hover:text-ink"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

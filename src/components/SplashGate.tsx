"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useSession } from "@/lib/auth";
import { Splash } from "./Splash";

const SEEN_KEY = "mrgridy.splash.seen";
const noSubscribe = () => () => {};

function seenThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** "/": the intro once per browser session, then Switchboard (or sign-in). */
export function SplashGate() {
  const router = useRouter();
  const session = useSession();
  // Server and first client render: no splash decided yet (null).
  const seen = useSyncExternalStore(noSubscribe, seenThisSession, () => null);

  const go = useCallback(() => {
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    router.replace(session.status === "authenticated" ? "/home" : "/login");
  }, [router, session.status]);

  useEffect(() => {
    if (seen === true && session.status !== "loading") go();
  }, [seen, session.status, go]);

  if (seen !== false) return <div className="fixed inset-0 bg-paper" />;
  return <Splash onDone={go} />;
}

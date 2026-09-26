"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useSession } from "@/lib/auth";
import { Splash } from "./Splash";

/** "/": the MrGridy intro, then Switchboard (signed in) or sign-in. Login sends people here so they see it. */
export function SplashGate() {
  const router = useRouter();
  const session = useSession();

  const go = useCallback(() => {
    router.replace(session.status === "authenticated" ? "/home" : "/login");
  }, [router, session.status]);

  return <Splash onDone={go} />;
}

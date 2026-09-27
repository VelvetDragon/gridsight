"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Splash } from "./Splash";

/** "/": the MrGridy intro, then the Switchboard. */
export function SplashGate() {
  const router = useRouter();
  const go = useCallback(() => router.replace("/home"), [router]);

  return <Splash onDone={go} />;
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { Splash } from "./Splash";

/** "/": the Mr.Gridy intro, then the Switchboard. */
export function SplashGate() {
  const router = useRouter();
  const go = useCallback(() => router.replace("/home"), [router]);

  return <Splash onDone={go} />;
}

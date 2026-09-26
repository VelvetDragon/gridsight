"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from its previous value to `target` (ease-out, ~700 ms).
 * Jumps straight to the target when the user prefers reduced motion.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = from.current;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = reduce ? 1 : Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = start + (target - start) * eased;
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return shown;
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanData, ResponseData } from "@/lib/data";
import type { RankedOverlap } from "@/lib/ranking";
import { REPLAY_STEP_MS, trackTimes } from "@/lib/response";
import { usePlayback } from "@/lib/usePlayback";
import type { ViewRequest } from "../map/MapCanvas";
import { CHAPTER_COUNT, chapterBounds } from "./chapters";

/** Length of each chapter's own animation (time-lapse, pulses), ms. */
const CHAPTER_ANIM_MS = [0, 3600, 2600, 0, 0, 0, 0];
/** Let the camera settle before the time-lapse starts. */
const ANIM_DELAY_MS = 900;

/**
 * Story state: the current chapter, its animation progress, a story-only storm
 * replay clock, and the camera request for the chapter.
 */
export function useStory({
  initialChapter,
  plan,
  ranked,
  response,
}: {
  initialChapter: number;
  plan: PlanData | null;
  ranked: RankedOverlap[];
  response: ResponseData | null;
}) {
  // `initialChapter` comes from the URL after hydration; the user's own choice wins once made.
  const [chosen, setChosen] = useState<number | null>(null);
  const clamp = (n: number) => Math.max(0, Math.min(CHAPTER_COUNT - 1, n));
  const chapter = chosen ?? clamp(initialChapter);
  const go = useCallback((n: number) => setChosen(clamp(n)), []);
  const next = useCallback(() => setChosen(clamp(chapter + 1)), [chapter]);
  const back = useCallback(() => setChosen(clamp(chapter - 1)), [chapter]);

  // Progress 0..1 of the chapter's own animation, tagged with its chapter so a
  // new chapter always starts from 0.
  const [anim, setAnim] = useState<{ chapter: number; value: number }>({ chapter: -1, value: 0 });
  useEffect(() => {
    const total = CHAPTER_ANIM_MS[chapter] ?? 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const elapsed = now - t0 - ANIM_DELAY_MS;
      const value = total === 0 || reduce ? 1 : Math.max(0, Math.min(1, elapsed / total));
      setAnim({ chapter, value });
      if (value < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chapter]);
  const progress = anim.chapter === chapter ? anim.value : 0;

  // Story-only storm clock: chapter 6 plays the replay, chapter 7 shows the end.
  const times = useMemo(() => (response ? trackTimes(response.storm) : []), [response]);
  const tMin = times[0] ?? 0;
  const tMax = times[times.length - 1] ?? 0;
  const start = response ? Date.parse(response.storm.replayStart) : NaN;
  const opening = Number.isFinite(start) ? Math.min(tMax, Math.max(tMin, start)) : tMin;
  const replay = usePlayback({
    min: tMin,
    max: tMax,
    step: REPLAY_STEP_MS,
    intervalMs: 70,
    initial: chapter === 6 ? tMax : opening,
    resetKey: `${chapter}:${response?.storm.id ?? "none"}`,
    autoPlay: chapter === 5,
  });

  const view = useMemo<ViewRequest | null>(() => {
    const c = chapterBounds(chapter, plan, ranked, response);
    if (!c) return null;
    return {
      key: `story-${chapter}-${plan ? "p" : ""}${response ? "r" : ""}`,
      kind: "bounds",
      bounds: c.bounds,
      maxZoom: c.maxZoom,
      pitch: c.pitch,
      durationMs: 1700,
    };
  }, [chapter, plan, ranked, response]);

  return { chapter, go, next, back, progress, replayTime: replay.value, times, view };
}

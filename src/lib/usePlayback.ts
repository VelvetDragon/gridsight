"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A value that can auto-advance from `min` to `max` (inclusive) in fixed steps.
 * Playback stops by itself at `max`; pressing play at the end restarts from `min`.
 */
export function usePlayback({
  min,
  max,
  step,
  intervalMs,
  initial,
}: {
  min: number;
  max: number;
  step: number;
  intervalMs: number;
  initial: number;
}) {
  const [value, setValue] = useState(initial);
  const [wantsPlay, setWantsPlay] = useState(false);
  const atEnd = value >= max;
  const playing = wantsPlay && !atEnd;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setValue((v) => Math.min(max, v + step));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [playing, max, step, intervalMs]);

  const play = useCallback(() => {
    if (atEnd) setValue(min);
    setWantsPlay(true);
  }, [atEnd, min]);

  const pause = useCallback(() => setWantsPlay(false), []);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const seek = useCallback(
    (v: number) => {
      setValue(Math.max(min, Math.min(max, v)));
    },
    [min, max],
  );

  return { value, playing, play, pause, toggle, seek };
}

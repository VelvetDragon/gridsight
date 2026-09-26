"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A value that can auto-advance from `min` to `max` (inclusive) in fixed steps.
 * Playback stops by itself at `max`; pressing play at the end restarts from `min`.
 * Changing `resetKey` (for example a new storm) resets to `initial` and pauses.
 */
export function usePlayback({
  min,
  max,
  step,
  intervalMs,
  initial,
  resetKey = "",
}: {
  min: number;
  max: number;
  step: number;
  intervalMs: number;
  initial: number;
  resetKey?: string;
}) {
  const [state, setState] = useState({ key: resetKey, value: initial, wantsPlay: false });
  const fresh = state.key === resetKey;
  const value = fresh ? state.value : initial;
  const wantsPlay = fresh && state.wantsPlay;
  const atEnd = value >= max;
  const playing = wantsPlay && !atEnd;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setState((s) => ({ ...s, value: Math.min(max, s.value + step) }));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [playing, max, step, intervalMs]);

  const play = useCallback(() => {
    setState({ key: resetKey, value: atEnd ? min : value, wantsPlay: true });
  }, [resetKey, atEnd, min, value]);

  const pause = useCallback(() => {
    setState({ key: resetKey, value, wantsPlay: false });
  }, [resetKey, value]);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const seek = useCallback(
    (v: number) => {
      setState((s) => ({
        key: resetKey,
        value: Math.max(min, Math.min(max, v)),
        wantsPlay: s.key === resetKey && s.wantsPlay,
      }));
    },
    [resetKey, min, max],
  );

  return { value, playing, play, pause, toggle, seek };
}

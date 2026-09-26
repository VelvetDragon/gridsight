"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A value that can auto-advance from `min` to `max` (inclusive) in fixed steps.
 * Playback stops by itself at `max`; pressing play at the end restarts from `min`.
 * Changing `resetKey` (for example a new storm or story chapter) resets to
 * `initial`, and starts playing right away when `autoPlay` is set.
 */
export function usePlayback({
  min,
  max,
  step,
  intervalMs,
  initial,
  resetKey = "",
  autoPlay = false,
}: {
  min: number;
  max: number;
  step: number;
  intervalMs: number;
  initial: number;
  resetKey?: string;
  autoPlay?: boolean;
}) {
  const [state, setState] = useState({ key: resetKey, value: initial, wantsPlay: autoPlay });
  const fresh = state.key === resetKey;
  const value = fresh ? state.value : initial;
  const wantsPlay = fresh ? state.wantsPlay : autoPlay;
  const atEnd = value >= max;
  const playing = wantsPlay && !atEnd;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setState((s) => {
        const base = s.key === resetKey ? s.value : initial;
        return { key: resetKey, value: Math.min(max, base + step), wantsPlay: true };
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [playing, max, step, intervalMs, resetKey, initial]);

  const play = useCallback(() => {
    setState({ key: resetKey, value: atEnd ? min : value, wantsPlay: true });
  }, [resetKey, atEnd, min, value]);

  /** Jump to `v` and start playing. */
  const playFrom = useCallback(
    (v: number) => setState({ key: resetKey, value: Math.max(min, Math.min(max, v)), wantsPlay: true }),
    [resetKey, min, max],
  );

  const pause = useCallback(() => {
    setState({ key: resetKey, value, wantsPlay: false });
  }, [resetKey, value]);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);

  const seek = useCallback(
    (v: number) => {
      setState((s) => ({
        key: resetKey,
        value: Math.max(min, Math.min(max, v)),
        wantsPlay: s.key === resetKey ? s.wantsPlay : autoPlay,
      }));
    },
    [resetKey, min, max, autoPlay],
  );

  return { value, playing, play, playFrom, pause, toggle, seek };
}

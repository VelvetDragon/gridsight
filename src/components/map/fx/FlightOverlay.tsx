"use client";

import { Pause, Play, Plane, SkipForward, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { matchSavings } from "@/lib/savings";
import type { PlanSceneProps } from "../planScene";
import { startCorridorFlight, type FlightHandle, type FlightState } from "./flight";
import type { FxHandle } from "./useFx";

const TONE: Record<string, string> = { desc: "var(--desc)", gpc: "var(--gpc)", ink: "var(--ink-3)" };

/**
 * "Fly the corridor" for the selected match: a small button, then a
 * lower-third caption with pause, skip and exit (Space, Right arrow, Esc).
 * Pass `audioUrl` to play narration in sync.
 */

const NARRATED_PAIR = "ov-desc-41-okatie-mcintosh-115kv-tie-add-series-rea--gpc-gen-mcintosh-expansion";
export function FlightOverlay({
  fx,
  plan,
  buttonStyle,
  audioUrl,
}: {
  fx: FxHandle;
  plan: PlanSceneProps | null;
  buttonStyle?: CSSProperties;
  audioUrl?: string;
}) {
  const [state, setState] = useState<FlightState | null>(null);
  const flight = useRef<FlightHandle | null>(null);
  const selected = plan?.ranked.find((r) => r.overlap.id === plan.selectedId)?.overlap ?? null;

  const start = useCallback(() => {
    const map = fx.controller.getMap();
    if (!map || !plan || !selected) return;
    const ranges = plan.data.costRanges ? new Map(plan.data.costRanges.map((r) => [r.overlapId, r])) : null;
    const s = matchSavings(selected, ranges);
    // The pre-voiced ElevenLabs narration (public/audio/flight-1.mp3) describes the top Dominion / Georgia Power pair.
    const narration = audioUrl ?? (selected.id === NARRATED_PAIR ? "/audio/flight-1.mp3" : undefined);
    const handle = startCorridorFlight(map, selected, plan.projectsById, {
      audioUrl: narration,
      reducedMotion: fx.reducedMotion,
      savings: s ? { low: s.low, high: s.high } : null,
    });
    flight.current = handle;
    handle.subscribe(setState);
    handle.done.then(() => {
      if (flight.current === handle) {
        flight.current = null;
        setState(null);
      }
    });
  }, [fx, plan, selected, audioUrl]);

  // A different selection ends a running flight.
  const selectedId = selected?.id ?? null;
  useEffect(() => () => flight.current?.stop(), [selectedId]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      const f = flight.current;
      if (!f) return;
      if (e.key === "Escape") f.stop();
      else if (e.key === " " && state.playing) f.pause();
      else if (e.key === " ") f.resume();
      else if (e.key === "ArrowRight") f.skip();
      else return;
      // Keep the page's own shortcuts (Esc clears the match) out of the way.
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [state]);

  if (!selected) return null;

  if (!state) {
    return (
      <button
        type="button"
        onClick={start}
        title="A short camera flight along both lines, with captions"
        className="glass pointer-events-auto absolute z-20 flex h-8 cursor-pointer items-center gap-1.5 rounded-[10px] px-3 text-[12px] font-semibold text-ink-3 transition-colors hover:text-ink"
        style={buttonStyle}
      >
        <Plane size={14} aria-hidden />
        Fly the corridor
      </button>
    );
  }

  const c = state.caption;
  const f = flight.current;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[132px] z-30 flex justify-center px-4">
      <div className="glass-strong pointer-events-auto w-[min(640px,100%)] rounded-[14px] px-5 pt-3.5 pb-3 shadow-[var(--shadow-float)]">
        <div className="min-h-[52px]" aria-live="polite">
          {c ? (
            <div key={c.atMs} className="gs-fade">
              {c.kicker ? (
                <div className="eyebrow mb-1" style={{ color: TONE[c.tone ?? "ink"] }}>
                  {c.kicker}
                </div>
              ) : null}
              <div className="text-[17px] leading-[24px] font-medium text-ink">{c.text}</div>
            </div>
          ) : null}
        </div>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-wash-2">
            <div className="h-full rounded-full bg-ink/70" style={{ width: `${state.progress * 100}%` }} />
          </div>
          <button
            type="button"
            aria-label={state.playing ? "Pause flight" : "Resume flight"}
            onClick={() => (state.playing ? f?.pause() : f?.resume())}
            className="cursor-pointer rounded-md p-1 text-ink-2 hover:bg-wash"
          >
            {state.playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button type="button" aria-label="Next caption" onClick={() => f?.skip()} className="cursor-pointer rounded-md p-1 text-ink-2 hover:bg-wash">
            <SkipForward size={15} />
          </button>
          <button type="button" aria-label="Exit flight" onClick={() => f?.stop()} className="cursor-pointer rounded-md p-1 text-ink-2 hover:bg-wash">
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

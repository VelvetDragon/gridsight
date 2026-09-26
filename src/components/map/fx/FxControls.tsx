"use client";

import type { CSSProperties } from "react";
import type { FxHandle } from "./useFx";

/**
 * One self-contained view control: "3D" tilts the camera and raises the
 * terrain, the river surface and (when zoomed in on a pair) the towers.
 */
export function FxControls({ fx, style, className = "" }: { fx: FxHandle; style?: CSSProperties; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={fx.depth}
      title={fx.depth ? "Back to a flat map" : "Tilt the map and show terrain in 3D"}
      onClick={fx.toggleDepth}
      className={`glass pointer-events-auto flex h-8 cursor-pointer items-center gap-1.5 rounded-[10px] px-3 text-[12px] font-semibold tracking-[0.02em] transition-colors ${
        fx.depth ? "text-ink" : "text-ink-3 hover:text-ink"
      } ${className}`}
      style={style}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M1.5 12.5 5.5 6l3 4 2-2.5 4 5z" strokeLinejoin="round" />
      </svg>
      3D
    </button>
  );
}

"use client";

import type { CSSProperties } from "react";
import type { FxHandle } from "./useFx";

/**
 * Self-contained view controls: Realistic / Clean map style and a 3D tilt.
 * Place it anywhere over the map; it only needs the handle from useFx.
 */
export function FxControls({ fx, style, className = "" }: { fx: FxHandle; style?: CSSProperties; className?: string }) {
  const options = [
    { id: "realistic", label: "Realistic", on: fx.realistic },
    { id: "clean", label: "Clean", on: !fx.realistic },
  ] as const;
  return (
    <div className={`pointer-events-auto flex items-center gap-1.5 ${className}`} style={style}>
      <div role="radiogroup" aria-label="Map style" className="glass flex h-8 items-center rounded-[10px] p-[3px]">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.on}
            onClick={() => fx.setRealistic(o.id === "realistic")}
            className={`h-[26px] cursor-pointer rounded-[7px] px-2.5 text-[12px] font-medium transition-colors ${
              o.on ? "bg-white text-ink shadow-[0_1px_2px_rgba(20,22,28,0.12)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-pressed={fx.tilted}
        title={fx.tilted ? "Back to a flat map" : "Tilt the map to see the storm and towers in 3D"}
        onClick={fx.toggleTilt}
        className={`glass h-8 cursor-pointer rounded-[10px] px-2.5 text-[12px] font-semibold tracking-[0.02em] transition-colors ${
          fx.tilted ? "text-ink" : "text-ink-3 hover:text-ink"
        }`}
      >
        {fx.tilted ? "2D" : "3D"}
      </button>
    </div>
  );
}

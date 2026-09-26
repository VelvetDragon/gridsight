"use client";

import { haversineKm } from "@/lib/geo";
import { UTILITY_HEX, UTILITY_NAME } from "@/lib/theme";
import type { Position, Project, UtilityId } from "@/lib/types";
import type { MapMarker } from "./MapCanvas";

/** Large, quiet state labels placed inside each state, clear of the river. */
const STATE_LABELS: { id: string; position: Position; state: string; company: string; utility: UtilityId }[] = [
  { id: "ga", position: [-82.55, 32.35], state: "Georgia", company: "Georgia Power", utility: "GPC" },
  { id: "sc", position: [-80.95, 33.22], state: "South Carolina", company: "Dominion Energy", utility: "DESC" },
];

export function stateLabelMarkers(): MapMarker[] {
  return STATE_LABELS.map((s) => ({
    id: `state-${s.id}`,
    position: s.position,
    node: (
      <div className="gs-passive text-center whitespace-nowrap select-none">
        <div
          className="display text-[26px] leading-8 font-medium tracking-[0.14em] uppercase opacity-45"
          style={{ color: UTILITY_HEX[s.utility] }}
        >
          {s.state}
        </div>
        <div className="text-[13px] font-medium opacity-80" style={{ color: UTILITY_HEX[s.utility] }}>
          {s.company} territory
        </div>
      </div>
    ),
  }));
}

/** Neighbouring states Stormline also covers (counties inside the line network). */
const NEIGHBOUR_LABELS: { id: string; state: string; position: Position }[] = [
  { id: "nc", state: "North Carolina", position: [-80.6, 35.55] },
  { id: "tn", state: "Tennessee", position: [-85.3, 35.45] },
  { id: "al", state: "Alabama", position: [-86.2, 32.7] },
  { id: "fl", state: "Florida", position: [-82.6, 29.9] },
];

export function neighbourStateMarkers(): MapMarker[] {
  return NEIGHBOUR_LABELS.map((s) => ({
    id: `state-${s.id}`,
    position: s.position,
    node: (
      <div className="gs-passive display text-[18px] font-medium tracking-[0.14em] whitespace-nowrap text-ink uppercase opacity-30 select-none">
        {s.state}
      </div>
    ),
  }));
}

/** The name before the colon: "Jasper – Okatie 230 kV #2: Construct" → "Jasper – Okatie 230 kV #2". */
export function shortName(name: string): string {
  return name.split(":")[0].trim();
}

/** A point `share` of the way along a path, starting from the end nearest `from`. */
export function pointAlong(path: Position[], from: Position, share = 0.55): Position {
  if (path.length === 1) return path[0];
  const pts = haversineKm(path[0], from) <= haversineKm(path[path.length - 1], from) ? path : [...path].reverse();
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineKm(pts[i - 1], pts[i]);
    lens.push(d);
    total += d;
  }
  let target = total * share;
  for (let i = 1; i < pts.length; i++) {
    if (target <= lens[i - 1] || i === pts.length - 1) {
      const k = lens[i - 1] ? Math.min(1, target / lens[i - 1]) : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    target -= lens[i - 1];
  }
  return pts[pts.length - 1];
}

/** On-map label for one side of the selected pair. */
export function projectLabel(
  id: string,
  position: Position,
  utility: UtilityId,
  name: string,
  placement: "above" | "below",
): MapMarker {
  return {
    id,
    position,
    node: (
      <div
        className="gs-passive"
        style={{ transform: placement === "above" ? "translateY(calc(-50% - 16px))" : "translateY(calc(50% + 16px))" }}
      >
        <div className="flex max-w-[260px] items-stretch gap-2 rounded-[10px] border border-white bg-white/95 py-1.5 pr-2.5 pl-2 text-[12px] leading-4 shadow-[var(--shadow-float)]">
          <span aria-hidden className="w-[3px] shrink-0 rounded-full" style={{ background: UTILITY_HEX[utility] }} />
          <span className="min-w-0">
            <span className="font-semibold" style={{ color: UTILITY_HEX[utility] }}>
              {UTILITY_NAME[utility]}:
            </span>{" "}
            <span className="text-ink">{shortName(name)}</span>
          </span>
        </div>
      </div>
    ),
  };
}

export function distanceLabel(id: string, position: Position, km: number, touching: boolean): MapMarker {
  const text = touching ? "0 km – they touch" : km < 10 ? `${km.toFixed(1)} km apart` : `${Math.round(km)} km apart`;
  return {
    id,
    position,
    node: (
      <div className="gs-passive" style={{ transform: "translateX(calc(50% + 12px))" }}>
        <span className="rounded-full bg-ink px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-[var(--shadow-float)]">
          {text}
        </span>
      </div>
    ),
  };
}

/** Typography-led label for a line or station the user picked. */
export function selectionLabel(id: string, position: Position, p: Project): MapMarker {
  return {
    id,
    position,
    node: (
      <div className="gs-passive" style={{ transform: "translateY(calc(-50% - 14px))" }}>
        <div className="max-w-[240px] rounded-[8px] border border-white bg-white/95 px-2 py-1 text-[12px] leading-4 shadow-[var(--shadow-float)]">
          <span
            className="block text-[10px] font-semibold tracking-[0.06em] uppercase"
            style={{ color: UTILITY_HEX[p.utility] }}
          >
            Your pick · {UTILITY_NAME[p.utility]}
          </span>
          <span className="text-ink">{shortName(p.name)}</span>
        </div>
      </div>
    ),
  };
}

/** Shared staging yard marker, same symbol as in the map key. */
export function yardMarker(id: string, position: Position, label: string | null, title?: string): MapMarker {
  return {
    id,
    position,
    node: (
      <div
        className="gs-passive flex items-center gap-1.5"
        title={title}
        style={{ transform: "translateX(calc(50% - 9px))" }}
      >
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] bg-ink shadow-[var(--shadow-float)]">
          <span className="h-[7px] w-[7px] rounded-[2px] bg-white" />
        </span>
        {label ? (
          <span className="rounded-[6px] bg-white/95 px-1.5 py-0.5 text-[12px] font-medium whitespace-nowrap text-ink shadow-[0_1px_2px_rgba(20,24,30,0.08)]">
            {label}
          </span>
        ) : null}
      </div>
    ),
  };
}

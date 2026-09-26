import type { OverlapTier, UtilityId } from "./types";

/** RGB triplets for deck.gl, mirrored from the CSS tokens in globals.css. */
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

export const INK: RGB = [22, 24, 29];
export const PAPER: RGB = [250, 248, 244];
export const SLATE: RGB = [51, 65, 85];
export const ALERT: RGB = [180, 35, 24];
export const RIVER: RGB = [59, 130, 196];

export const UTILITY_HEX: Record<UtilityId, string> = {
  DESC: "#0E7C7B",
  GPC: "#C2410C",
};

export const UTILITY_RGB: Record<UtilityId, RGB> = {
  DESC: [14, 124, 123],
  GPC: [194, 65, 12],
};

export const UTILITY_SHORT: Record<UtilityId, string> = {
  DESC: "DESC",
  GPC: "Georgia Power",
};

/** Ordered tiers, strongest first. */
export const TIERS: OverlapTier[] = ["crossing", "row", "logistics", "crew"];

export const TIER_LABEL: Record<OverlapTier, string> = {
  crossing: "Crossing",
  row: "Right-of-way",
  logistics: "Logistics",
  crew: "Crews",
};

export const TIER_RANGE: Record<OverlapTier, string> = {
  crossing: "lines cross",
  row: "< 1.6 km",
  logistics: "< 8 km",
  crew: "< 40 km",
};

/** Single ordered scale: crossing darkest, crew lightest. */
export const TIER_HEX: Record<OverlapTier, string> = {
  crossing: "#1D2533",
  row: "#3F4B60",
  logistics: "#7B8699",
  crew: "#B3BAC6",
};

export const TIER_RGB: Record<OverlapTier, RGB> = {
  crossing: [29, 37, 51],
  row: [63, 75, 96],
  logistics: [123, 134, 153],
  crew: [179, 186, 198],
};

/** What each tier unlocks (cumulative: a crossing can share everything below it). */
export const TIER_SHARES: Record<OverlapTier, { title: string; items: string[] }> = {
  crossing: {
    title: "Must coordinate",
    items: ["Crossing design and clearances", "Joint outage scheduling"],
  },
  row: {
    title: "Share land",
    items: ["Right-of-way and easements", "Land acquisition", "Permits and environmental surveys"],
  },
  logistics: {
    title: "Share logistics",
    items: ["Laydown yards", "Material deliveries"],
  },
  crew: {
    title: "Share people",
    items: ["Line crews", "Heavy equipment"],
  },
};

/**
 * Sequential failure-probability scale for Response mode:
 * pale sand (unlikely) through ochre and brick to deep oxblood (likely).
 */
const FAILURE_STOPS: { t: number; c: RGB }[] = [
  { t: 0, c: [226, 220, 204] },
  { t: 0.1, c: [232, 196, 120] },
  { t: 0.25, c: [214, 140, 52] },
  { t: 0.5, c: [178, 64, 30] },
  { t: 1, c: [96, 18, 18] },
];

export const FAILURE_LEGEND = FAILURE_STOPS;

export function failureColor(p: number): RGB {
  const x = Math.max(0, Math.min(1, p));
  for (let i = 1; i < FAILURE_STOPS.length; i++) {
    const a = FAILURE_STOPS[i - 1];
    const b = FAILURE_STOPS[i];
    if (x <= b.t) {
      const k = (x - a.t) / (b.t - a.t || 1);
      return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * k),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * k),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * k),
      ];
    }
  }
  return FAILURE_STOPS[FAILURE_STOPS.length - 1].c;
}

export function rgbCss(c: RGB, alpha = 1): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

export const VULNERABLE_RGB: RGB = [36, 59, 107];

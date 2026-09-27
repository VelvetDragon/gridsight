/**
 * Basemaps.
 *   natural:   OpenFreeMap's Positron style (no key), re-coloured at runtime so it
 *              reads like paper with soft water and faint green, and stays quieter
 *              than the GridSight overlays (Crosswire).
 *   plain:     the same paper map without state / county lines or state tints, so a
 *              storm crossing several states reads as one area (Stormline).
 */
import type { StyleSpecification } from "maplibre-gl";

export const BASEMAP_URL = "https://tiles.openfreemap.org/styles/positron";

/**
 * Georgia and South Carolina outlines, committed with the app (not pipeline output).
 * Source: U.S. Census Bureau, 2018 Cartographic Boundary File, States, 1:20,000,000
 * (cb_2018_us_state_20m), public domain; simplified to about 0.006° and rounded.
 */
export const STATES_URL = "/data/context/states.geojson";

export type BasemapKind = "natural" | "plain";

const PAPER = "#F2EEE6";
const WATER = "#BCD7EA";
const SAGE = "#E1E7D6";
const LABEL = "#3F4550";
const LABEL_HALO = "rgba(242, 238, 230, 0.92)";

type Paint = Record<string, unknown>;

/** Layer id → paint overrides. */
const PAINT: Record<string, Paint> = {
  background: { "background-color": PAPER },
  park: { "fill-color": SAGE, "fill-opacity": 0.75 },
  landcover_wood: { "fill-color": SAGE, "fill-opacity": 0.6 },
  water: { "fill-color": WATER },
  waterway: { "line-color": "#A9CBE3" },
  landuse_residential: { "fill-color": "#ECE7DE" },
  building: { "fill-color": "#E7E1D7", "fill-outline-color": "#DCD5CA" },
  road_area_pier: { "fill-color": PAPER },
  road_pier: { "line-color": PAPER },
  highway_path: { "line-color": "#E6E0D6" },
  highway_minor: { "line-color": "#E4DED3" },
  highway_major_casing: { "line-color": "#DDD6CB" },
  highway_major_inner: { "line-color": "#FAF8F4" },
  highway_major_subtle: { "line-color": "rgba(205, 197, 185, 0.55)" },
  highway_motorway_casing: { "line-color": "#D8D0C3" },
  highway_motorway_inner: {
    "line-color": ["interpolate", ["linear"], ["zoom"], 5.8, "rgba(205, 197, 185, 0.5)", 6, "#FAF8F4"],
  },
  highway_motorway_subtle: { "line-color": "rgba(205, 197, 185, 0.5)" },
  highway_motorway_bridge_casing: { "line-color": "#D8D0C3" },
  highway_motorway_bridge_inner: {
    "line-color": ["interpolate", ["linear"], ["zoom"], 5.8, "rgba(205, 197, 185, 0.5)", 6, "#FAF8F4"],
  },
  railway: { "line-color": "#DDD6CB" },
  railway_transit: { "line-color": "#DDD6CB" },
  railway_service: { "line-color": "#DDD6CB" },
  boundary_2: { "line-color": "#B8AFA2" },
  boundary_3: { "line-color": "#C9C1B5" },
  water_name_point_label: { "text-color": "#4F6F8F", "text-halo-color": LABEL_HALO },
  water_name_line_label: { "text-color": "#4F6F8F", "text-halo-color": LABEL_HALO },
  waterway_line_label: { "text-color": "#6A88A3", "text-halo-color": LABEL_HALO },
  "highway-name-minor": { "text-color": "#7A7F88" },
  "highway-name-major": { "text-color": "#7A7F88" },
  airport: { "text-color": "#6B707A", "text-halo-color": LABEL_HALO },
  label_other: { "text-color": "#5A6070", "text-halo-color": LABEL_HALO },
  label_village: { "text-color": LABEL, "text-halo-color": LABEL_HALO },
  label_town: { "text-color": LABEL, "text-halo-color": LABEL_HALO },
  label_city: { "text-color": LABEL, "text-halo-color": LABEL_HALO },
  label_city_capital: { "text-color": LABEL, "text-halo-color": LABEL_HALO },
  label_country_1: { "text-color": LABEL, "text-halo-color": LABEL_HALO },
  label_country_2: { "text-color": LABEL, "text-halo-color": LABEL_HALO },
  label_country_3: { "text-color": LABEL, "text-halo-color": LABEL_HALO },
};

/** Layers hidden to keep the map quiet (GridSight draws its own state labels). */
const HIDDEN = new Set(["label_state", "highway-shield-non-us", "highway-shield-us-interstate", "road_shield_us"]);
/** Also hidden on the plain map: state and county lines (admin levels 3-6). */
const HIDDEN_PLAIN = new Set([...HIDDEN, "boundary_3"]);

/**
 * Soft state tints drawn inside the basemap (under roads and labels): Georgia a
 * faint warm orange, South Carolina a faint teal, matching each company's colour.
 */
function withStateTints(style: StyleSpecification, states: unknown): StyleSpecification {
  if (!states) return style;
  const at = style.layers.findIndex((l) => l.id === "landcover_wood");
  const insertAt = at >= 0 ? at + 1 : 1;
  const tint = {
    id: "gs-state-tint",
    type: "fill",
    source: "gs-states",
    paint: {
      "fill-color": ["match", ["get", "state"], "GA", "#C2410C", "#0E7C7B"],
      "fill-opacity": ["match", ["get", "state"], "GA", 0.07, 0.085],
    },
  } as StyleSpecification["layers"][number];
  return {
    ...style,
    sources: { ...style.sources, "gs-states": { type: "geojson", data: states as never } },
    layers: [...style.layers.slice(0, insertAt), tint, ...style.layers.slice(insertAt)],
  };
}

export function naturalizeStyle(
  style: StyleSpecification,
  states: unknown = null,
  kind: BasemapKind = "natural",
): StyleSpecification {
  const tinted = kind === "plain" ? style : withStateTints(style, states);
  const hidden = kind === "plain" ? HIDDEN_PLAIN : HIDDEN;
  return {
    ...tinted,
    layers: tinted.layers.map((layer) => {
      if (hidden.has(layer.id)) return { ...layer, layout: { ...layer.layout, visibility: "none" } } as typeof layer;
      const paint = PAINT[layer.id];
      if (!paint) return layer;
      return { ...layer, paint: { ...(layer as { paint?: Paint }).paint, ...paint } } as typeof layer;
    }),
  };
}

async function loadStates(signal?: AbortSignal): Promise<unknown> {
  try {
    const res = await fetch(STATES_URL, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { features?: unknown };
    return Array.isArray(body.features) ? body : null;
  } catch {
    return null;
  }
}

/** Fetch and re-colour the basemap; falls back to the stock style URL on failure. */
export async function loadBasemapStyle(
  kind: BasemapKind = "natural",
  signal?: AbortSignal,
): Promise<StyleSpecification | string> {
  try {
    const [res, states] = await Promise.all([
      fetch(BASEMAP_URL, { signal }),
      kind === "plain" ? null : loadStates(signal),
    ]);
    if (!res.ok) return BASEMAP_URL;
    const style = (await res.json()) as StyleSpecification;
    if (!Array.isArray(style.layers)) return BASEMAP_URL;
    return naturalizeStyle(style, states, kind);
  } catch {
    return BASEMAP_URL;
  }
}

/**
 * Relief for the tilted view: a soft hillshade from the public AWS Terrain
 * Tiles (terrarium encoding) under the labels, and a pale sky with haze so
 * the horizon reads naturally.
 *
 * Raised terrain (map.setTerrain) is available through `raise`, but it is off
 * by default: the deck.gl overlay draws on its own canvas at sea level and
 * cannot follow a raised surface, so the data would drift from the ground.
 */
import type * as maplibregl from "maplibre-gl";

const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Terrain: Mapzen, AWS Open Data</a>';
const TERRAIN_SRC = "fx-dem";
const SHADE_SRC = "fx-dem-shade";
const SHADE_LAYER = "fx-hillshade";

/** Gentle: the coastal plain is flat, the Fall Line near Augusta gets a little lift. */
export const TERRAIN_EXAGGERATION = 1.5;

function demSource(): maplibregl.RasterDEMSourceSpecification {
  return { type: "raster-dem", tiles: [DEM_URL], tileSize: 256, encoding: "terrarium", maxzoom: 15, attribution: ATTRIBUTION };
}

export function enableTerrain(map: maplibregl.Map, { raise = false, exaggeration = TERRAIN_EXAGGERATION } = {}) {
  try {
    if (raise && !map.getSource(TERRAIN_SRC)) map.addSource(TERRAIN_SRC, demSource());
    if (!map.getSource(SHADE_SRC)) map.addSource(SHADE_SRC, demSource());
    if (!map.getLayer(SHADE_LAYER)) {
      // Under the first label layer, and above land and water fills.
      const layers = map.getStyle()?.layers ?? [];
      const before = layers.find((l) => l.type === "symbol")?.id;
      map.addLayer(
        {
          id: SHADE_LAYER,
          type: "hillshade",
          source: SHADE_SRC,
          paint: {
            "hillshade-exaggeration": 0.35,
            "hillshade-shadow-color": "rgba(60, 64, 58, 0.55)",
            "hillshade-highlight-color": "rgba(255, 255, 250, 0.35)",
            "hillshade-accent-color": "rgba(80, 84, 76, 0.2)",
          },
        },
        before,
      );
    }
    if (raise) map.setTerrain({ source: TERRAIN_SRC, exaggeration });
    map.setSky({
      "sky-color": "#c9dcec",
      "horizon-color": "#eef2f3",
      "fog-color": "#eef1ef",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.85,
      "atmosphere-blend": 0,
    });
  } catch {
    // Style still loading; the caller can retry.
  }
}

export function disableTerrain(map: maplibregl.Map) {
  try {
    if (map.getTerrain()) map.setTerrain(null);
    map.setSky({ "atmosphere-blend": 0, "fog-ground-blend": 1, "horizon-fog-blend": 1 });
    if (map.getLayer(SHADE_LAYER)) map.removeLayer(SHADE_LAYER);
    if (map.getSource(SHADE_SRC)) map.removeSource(SHADE_SRC);
    if (map.getSource(TERRAIN_SRC)) map.removeSource(TERRAIN_SRC);
  } catch {
    // Map torn down.
  }
}

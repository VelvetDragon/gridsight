/**
 * Wind streaks around the storm: short comet-like particles spiralling
 * counter-clockwise into the core, denser near the eyewall. The arcs are
 * static geometry in metre offsets from the storm centre; only the origin,
 * a scale matrix and the time uniform change per frame.
 */
import { COORDINATE_SYSTEM, type Layer } from "@deck.gl/core";
import { windArcs, type WindArc } from "@/lib/fx/geometry";
import type { Position } from "@/lib/types";
import { FlowPathLayer } from "./shaderLayers";

/** Arcs are generated for a 100 km storm and scaled to the real radius. */
const REF_RADIUS_M = 100_000;

interface ArcRow {
  path: [number, number][];
  along: number[];
  seed: number;
  color: [number, number, number, number];
}

let arcs: ArcRow[] | null = null;

function arcRows(): ArcRow[] {
  if (!arcs) {
    arcs = windArcs(200).map((a: WindArc) => ({
      path: a.path.map(([x, y]) => [x * REF_RADIUS_M, y * REF_RADIUS_M] as [number, number]),
      along: a.along,
      seed: a.seed,
      color: [255, 255, 255, Math.round(28 + 72 * a.strength)],
    }));
  }
  return arcs;
}

const getPath = (d: ArcRow) => d.path;
const getDistances = (d: ArcRow) => d.along;
const getSeed = (d: ArcRow) => d.seed;
const getColor = (d: ArcRow) => d.color;

export function windStreakLayer(center: Position, radiusM: number, time: number): Layer {
  const k = radiusM / REF_RADIUS_M;
  return new FlowPathLayer<ArcRow>({
    id: "fx-wind-streaks",
    data: arcRows(),
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [center[0], center[1], 0],
    modelMatrix: [k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    getPath,
    getDistances,
    getSeed,
    getColor,
    getWidth: 1,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    time,
    flowMode: "comet",
    flowSpeed: 0.32,
    flowDashLength: 0.38,
  });
}

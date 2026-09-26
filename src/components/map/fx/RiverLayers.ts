/**
 * The Savannah River as moving water: a soft wash, a water body that is
 * deeper in the channel and lighter at the banks, and flow streaks drifting
 * downstream from Augusta towards the Atlantic.
 */
import type { Layer } from "@deck.gl/core";
import { PathLayer } from "@deck.gl/layers";
import type { LineCollection } from "@/lib/data";
import { cumulativeMeters, orientDownstream } from "@/lib/fx/geometry";
import type { Position } from "@/lib/types";
import { FlowPathLayer } from "./shaderLayers";

interface RiverPath {
  path: Position[];
  distances: number[];
}

const cache = new WeakMap<LineCollection, RiverPath[]>();

/** Downstream-ordered river paths with metres along each vertex (memoised per collection). */
export function riverPaths(river: LineCollection): RiverPath[] {
  const hit = cache.get(river);
  if (hit) return hit;
  const pieces: Position[][] = [];
  for (const f of river.features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === "LineString") pieces.push(g.coordinates);
    else if (g.type === "MultiLineString") pieces.push(...g.coordinates);
  }
  const out = orientDownstream(pieces).map((path) => ({ path, distances: cumulativeMeters(path) }));
  cache.set(river, out);
  return out;
}

const getPath = (d: RiverPath) => d.path;
const getDistances = (d: RiverPath) => d.distances;

/** #5E9CC7 channel, #7FB3D5 banks. */
const DEEP: [number, number, number] = [94, 156, 199];
const LIGHT: [number, number, number, number] = [127, 179, 213, 255];
const WASH: [number, number, number, number] = [127, 179, 213, 70];
const BODY: [number, number, number, number] = [...DEEP, 235];

export interface RiverFxOptions {
  id: string;
  time: number;
  zoom: number;
}

export function riverFxLayers(river: LineCollection, { id, time, zoom }: RiverFxOptions): Layer[] {
  const data = riverPaths(river);
  if (!data.length) return [];
  // Width grows with zoom but stays a quiet background element.
  const bodyPx = Math.min(22, Math.max(6, 6 * 1.45 ** (zoom - 7)));
  return [
    new PathLayer<RiverPath>({
      id: `${id}-fx-wash`,
      data,
      getPath,
      getColor: WASH,
      getWidth: 1,
      widthScale: bodyPx * 2.6 + 4,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
    }),
    new FlowPathLayer<RiverPath>({
      id: `${id}-fx-water`,
      data,
      getPath,
      getDistances,
      getColor: BODY,
      getWidth: 1,
      widthScale: bodyPx,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      time,
      flowMode: "water",
      flowSpeed: 16,
      flowSpacing: 46,
      flowDashLength: 0,
      flowAccent: LIGHT,
    }),
  ];
}

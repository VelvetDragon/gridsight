/**
 * Storm damage that follows the storm. Each line segment warms from neutral
 * through yellow to its failure colour as the storm approaches; likely
 * failures (p >= 0.5) flicker briefly once it passes, then go dark.
 *
 * Colour and flicker are computed in the shader from two uniforms (replay
 * time and wall time), so a playing replay never rebuilds attributes.
 */
import type { Layer } from "@deck.gl/core";
import type { ResponseData } from "@/lib/data";
import type { LineSegmentRisk } from "@/lib/types";
import { DamagePathLayer } from "./shaderLayers";

/** Same shape as the base scene's rows, so its tooltip keeps working. */
export type DamageRow = LineSegmentRisk & { i: number; revealH: number };

const LEAD_HOURS = 3;
const FLICKER_HOURS = 1.5;

interface RowSet {
  data: ResponseData;
  reveal: Float64Array;
  rows: DamageRow[];
}

let memo: RowSet | null = null;

function rowsFor(data: ResponseData, reveal: Float64Array, epochMs: number): RowSet {
  if (memo && memo.data === data && memo.reveal === reveal) return memo;
  const rows = data.segments
    .map((s, i) => ({ ...s, i, revealH: ((reveal[i] ?? epochMs) - epochMs) / 3.6e6 }))
    .sort((a, b) => a.failureProbability - b.failureProbability);
  memo = { data, reveal, rows };
  return memo;
}

const getPath = (s: DamageRow) => s.coordinates;
const getRevealHours = (s: DamageRow) => s.revealH;
const getProbability = (s: DamageRow) => s.failureProbability;
const getWidth = (s: DamageRow) => 1.6 + 4 * Math.min(1, s.failureProbability * 2);

export interface DamageFxOptions {
  data: ResponseData;
  reveal: Float64Array;
  epochMs: number;
  nowMs: number;
  wallTime: number;
}

/** Replaces the base "r-segments" layer (same id, same picking rows). */
export function damageSegmentsLayer({ data, reveal, epochMs, nowMs, wallTime }: DamageFxOptions): Layer {
  const { rows } = rowsFor(data, reveal, epochMs);
  return new DamagePathLayer<DamageRow>({
    id: "r-segments",
    data: rows,
    getPath,
    getRevealHours,
    getProbability,
    getWidth,
    widthUnits: "pixels",
    capRounded: true,
    pickable: true,
    nowHours: (nowMs - epochMs) / 3.6e6,
    wallTime,
    leadHours: LEAD_HOURS,
    flickerHours: FLICKER_HOURS,
  });
}

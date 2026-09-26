import type { Overlap, OverlapTier } from "./types";
import { TIER_LIMIT_KM } from "./types";

export interface RankWeights {
  /** 0..100: how much physical closeness matters. */
  distance: number;
  /** 0..100: how much simultaneous construction matters. */
  timeline: number;
}

export const DEFAULT_WEIGHTS: RankWeights = { distance: 70, timeline: 30 };

/** Build-window overlap at which the timeline signal saturates. */
export const TIMELINE_SATURATION_MONTHS = 24;

export interface RankedOverlap {
  overlap: Overlap;
  rank: number;
  score: number;
}

/**
 * Client-side re-ranking.
 *
 *   proximity = 1 - min(distanceKm, 40) / 40          (1 = crossing, 0 = 40 km apart)
 *   timeline  = min(timelineOverlapMonths, 24) / 24   (1 = two years or more of simultaneous work)
 *   score     = (wD * proximity + wT * timeline) / (wD + wT)
 *
 * wD and wT are the two slider values (0..100). If both are zero the score falls
 * back to proximity alone. Ties break on distance, then on estimated savings.
 */
export function scoreOverlap(o: Overlap, w: RankWeights): number {
  const maxKm = TIER_LIMIT_KM.crew;
  const proximity = 1 - Math.min(Math.max(o.distanceKm, 0), maxKm) / maxKm;
  const timeline = Math.min(Math.max(o.timelineOverlapMonths, 0), TIMELINE_SATURATION_MONTHS) / TIMELINE_SATURATION_MONTHS;
  const total = w.distance + w.timeline;
  if (total <= 0) return proximity;
  return (w.distance * proximity + w.timeline * timeline) / total;
}

export function rankOverlaps(
  overlaps: Overlap[],
  weights: RankWeights,
  tiers: Set<OverlapTier>,
): RankedOverlap[] {
  return overlaps
    .filter((o) => tiers.has(o.tier))
    .map((overlap) => ({ overlap, score: scoreOverlap(overlap, weights), rank: 0 }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.overlap.distanceKm - b.overlap.distanceKm ||
        (b.overlap.cost?.totalUsd ?? 0) - (a.overlap.cost?.totalUsd ?? 0),
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

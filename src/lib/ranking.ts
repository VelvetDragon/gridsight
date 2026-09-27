import type { Opportunity, OpportunityStrength } from "./opportunities";
import type { Overlap, OverlapTier } from "./types";
import { TIER_LIMIT_KM } from "./types";

export interface RankWeights {
  /** 0..100: how much the ways to work together matter. */
  sharing: number;
  /** 0..100: how much the estimated saving matters. */
  savings: number;
  /** 0..100: how much physical closeness matters. */
  distance: number;
  /** 0..100: how much simultaneous construction matters. */
  timeline: number;
}

export const DEFAULT_WEIGHTS: RankWeights = { sharing: 40, savings: 30, distance: 20, timeline: 10 };

/** Build-window overlap at which the timeline signal saturates. */
export const TIMELINE_SATURATION_MONTHS = 24;

/** What each way to work together is worth to the sharing signal. */
const STRENGTH_POINTS: Record<OpportunityStrength, number> = { required: 1, strong: 0.6, possible: 0.25 };
/** Sharing points at which the signal saturates: one must-do plus a strong fit, say. */
const SHARING_SATURATION = 1.6;

/** What the pair offers besides distance and timing. */
export interface PairSignals {
  opportunities: Opportunity[];
  /** Estimated saving in USD, before de-duplication across pairs. */
  savedUsd: number;
}

export interface RankedOverlap {
  overlap: Overlap;
  rank: number;
  score: number;
}

export interface ScoreParts {
  sharing: number;
  savings: number;
  proximity: number;
  timeline: number;
}

/**
 * Each part is 0..1:
 *
 *   sharing   = min(Σ strength points, 1.6) / 1.6     (must do 1, strong fit 0.6, possible 0.25)
 *   savings   = log(1 + usd) / log(1 + biggest usd)   (log, so one huge pair does not flatten the rest)
 *   proximity = 1 - min(distanceKm, 40) / 40
 *   timeline  = min(timelineOverlapMonths, 24) / 24
 */
export function scoreParts(o: Overlap, s: PairSignals | null, maxUsd: number): ScoreParts {
  const maxKm = TIER_LIMIT_KM.crew;
  const points = (s?.opportunities ?? []).reduce((t, op) => t + STRENGTH_POINTS[op.strength], 0);
  const usd = Math.max(s?.savedUsd ?? 0, 0);
  return {
    sharing: Math.min(points, SHARING_SATURATION) / SHARING_SATURATION,
    savings: maxUsd > 0 ? Math.log1p(usd) / Math.log1p(maxUsd) : 0,
    proximity: 1 - Math.min(Math.max(o.distanceKm, 0), maxKm) / maxKm,
    timeline: Math.min(Math.max(o.timelineOverlapMonths, 0), TIMELINE_SATURATION_MONTHS) / TIMELINE_SATURATION_MONTHS,
  };
}

/** Weighted mean of the parts; proximity alone if every slider is at zero. */
export function scoreOverlap(p: ScoreParts, w: RankWeights): number {
  const total = w.sharing + w.savings + w.distance + w.timeline;
  if (total <= 0) return p.proximity;
  return (w.sharing * p.sharing + w.savings * p.savings + w.distance * p.proximity + w.timeline * p.timeline) / total;
}

/**
 * Pairs with at least one way to work together always come before pairs with
 * none; within each group, by score. Ties break on estimated saving, then distance.
 */
export function rankOverlaps(
  overlaps: Overlap[],
  weights: RankWeights,
  tiers: Set<OverlapTier>,
  signals: (o: Overlap) => PairSignals | null = () => null,
): RankedOverlap[] {
  const rows = overlaps.filter((o) => tiers.has(o.tier)).map((overlap) => ({ overlap, s: signals(overlap) }));
  const maxUsd = Math.max(0, ...rows.map((r) => r.s?.savedUsd ?? 0));
  return rows
    .map((r) => ({
      ...r,
      useful: !!r.s?.opportunities.length,
      score: scoreOverlap(scoreParts(r.overlap, r.s, maxUsd), weights),
    }))
    .sort(
      (a, b) =>
        Number(b.useful) - Number(a.useful) ||
        b.score - a.score ||
        (b.s?.savedUsd ?? 0) - (a.s?.savedUsd ?? 0) ||
        a.overlap.distanceKm - b.overlap.distanceKm,
    )
    .map((r, i) => ({ overlap: r.overlap, score: r.score, rank: i + 1 }));
}

/**
 * The seven chapters of the guided story. Every number is computed from the
 * loaded data files; nothing here is hard-coded except the wording.
 */
import type { PlanData, ResponseData } from "@/lib/data";
import { boundsOf, circleBounds, geometryPoints, midpoint, type Bounds } from "@/lib/geo";
import type { RankedOverlap } from "@/lib/ranking";
import { closestApproachTimes, trackTimes } from "@/lib/response";
import { fmtHoursNumber, timeSaved } from "@/lib/savings";
import type { Position } from "@/lib/types";
import { shortName } from "../map/mapLabels";
import { topZones } from "../map/storyScene";

export const CHAPTER_COUNT = 7;

export const CHAPTER_TITLES = [
  "Two neighbors",
  "Their plans",
  "Where they collide",
  "The best match",
  "What it saves",
  "When a storm comes",
  "Fix it together",
] as const;

export interface ChapterText {
  headline: string;
  support: string;
}

function roundKm(km: number): string {
  if (km === 0) return "0";
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

export function chapterText(
  index: number,
  plan: PlanData | null,
  ranked: RankedOverlap[],
  response: ResponseData | null,
): ChapterText {
  const nDesc = plan ? plan.projects.filter((p) => p.utility === "DESC").length : 0;
  const nGpc = plan ? plan.projects.filter((p) => p.utility === "GPC").length : 0;
  switch (index) {
    case 0:
      return {
        headline: "Two power companies share a river, but plan their work without seeing each other.",
        support:
          "The Savannah River is the border. Georgia Power builds on the Georgia side, Dominion Energy on the South Carolina side.",
      };
    case 1:
      return {
        headline: `Dominion plans ${nDesc} jobs. Georgia Power plans ${nGpc}. Nobody lines them up.`,
        support:
          "Each line or dot is a planned project from their public filings, appearing in the order it gets built.",
      };
    case 2:
      return {
        headline: `Of ${plan?.meta.pairsCompared ?? 0} possible pairs, only ${plan?.overlaps.length ?? 0} are within a crew's morning drive (40 km).`,
        support:
          "Some cross outright; some are close enough to share land (under 1.6 km), a yard (under 8 km) or crews (under 40 km).",
      };
    case 3: {
      const top = ranked[0]?.overlap;
      if (!top || !plan) return { headline: "The best match.", support: "" };
      const desc = plan.projects.find((p) => p.id === top.descId);
      const gpc = plan.projects.find((p) => p.id === top.gpcId);
      const km = roundKm(top.distanceKm);
      const headline =
        top.tier === "crossing"
          ? "These two jobs touch. One crew, one yard, one permit instead of two."
          : top.tier === "row"
            ? `These two jobs run ${km} km apart. They could share land and permits.`
            : top.tier === "logistics"
              ? `These two jobs are ${km} km apart. They could share a yard and deliveries.`
              : `These two jobs are ${km} km apart. They could share crews and equipment.`;
      const months = Math.round(top.timelineOverlapMonths);
      return {
        headline,
        support: `Dominion: ${shortName(desc?.name ?? top.descId)}. Georgia Power: ${shortName(gpc?.name ?? top.gpcId)}.${
          months > 0 ? ` Both are under construction at the same time for about ${months} months.` : ""
        }`,
      };
    }
    case 4:
      return {
        headline: "What working together could save.",
        support: "Estimate. Counts only Dominion's disclosed costs.",
      };
    case 5: {
      if (!response) return { headline: "When a storm comes.", support: "" };
      const s = response.storm;
      const lead = hoursOfWarning(response);
      const device = response.meta.device === "cuda" ? "on a GPU" : "on a regular computer";
      return {
        headline: `${lead != null ? `About ${lead} hours before` : "Before"} Hurricane ${s.name} arrived, MrGridy predicted where lines would break for both companies, and compared it with what happened.`,
        support: `Simulated ${response.meta.simulations.toLocaleString("en-US")} times with physics (runs ${device}).`,
      };
    }
    default: {
      if (response?.mutualAid) {
        const h = fmtHoursNumber(timeSaved(response.mutualAid).to90);
        return {
          headline: `Working together, power comes back about ${h} hours sooner.`,
          support: "Shared staging yards and crews go to the nearest repair zone first, whichever company owns it.",
        };
      }
      return {
        headline: "Shared staging yards both crews can reach.",
        support:
          "Numbered repair zones show where crews should go first; the squares are yards both companies can use.",
      };
    }
  }
}

/**
 * Hours between the replay's opening moment and the storm's closest pass to
 * the top-priority repair zone: how much warning the prediction gives.
 */
export function hoursOfWarning(response: ResponseData): number | null {
  const times = trackTimes(response.storm);
  const start = Date.parse(response.storm.replayStart);
  const top = [...response.zones].sort((a, b) => a.priority - b.priority)[0];
  if (!top || !Number.isFinite(start) || times.length < 2) return null;
  const [when] = closestApproachTimes([top.centroid], response.storm, times);
  const h = Math.round((when - start) / 3_600_000);
  return h > 0 ? h : null;
}

/* ---------------- Camera per chapter ---------------- */

function riverBounds(plan: PlanData): Bounds | null {
  const pts: Position[] = [];
  for (const f of plan.river.features) {
    if (!f?.geometry) continue;
    if (f.geometry.type === "LineString") pts.push(...f.geometry.coordinates);
    else for (const l of f.geometry.coordinates) pts.push(...l);
  }
  // Focus on the stretch between Augusta and the coast.
  return boundsOf(pts.filter((p) => p[1] < 33.9 && p[1] > 31.9));
}

export function projectsBounds(plan: PlanData): Bounds | null {
  return boundsOf(plan.projects.flatMap((p) => geometryPoints(p.geometry)));
}

export function overlapsBounds(ranked: RankedOverlap[]): Bounds | null {
  return boundsOf(ranked.flatMap((r) => r.overlap.closestPoints));
}

export function topMatchBounds(ranked: RankedOverlap[], plan: PlanData): Bounds | null {
  const o = ranked[0]?.overlap;
  if (!o) return null;
  const pts: Position[] = [...o.closestPoints];
  for (const id of [o.descId, o.gpcId]) {
    const p = plan.projects.find((x) => x.id === id);
    if (p) pts.push(...geometryPoints(p.geometry));
  }
  const ring = circleBounds(midpoint(o.closestPoints[0], o.closestPoints[1]), 9);
  return boundsOf([...pts, ring[0], ring[1]]);
}

export function stormBounds(response: ResponseData): Bounds | null {
  const zones = topZones(response.zones).map((z) => z.centroid);
  const b = boundsOf(zones);
  if (!b) return boundsOf(response.storm.track.map((p) => p.position));
  // Frame the damage area with room around it, so the storm is seen crossing it.
  const c: Position = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  const pad = circleBounds(c, 140);
  return boundsOf([...zones, pad[0], pad[1]]);
}

export function repairBounds(response: ResponseData): Bounds | null {
  const zones = topZones(response.zones);
  const ids = new Set(zones.map((z) => z.id));
  const yards = response.yards.filter((y) => y.serves.some((id) => ids.has(id)));
  const pts = [...zones.map((z) => z.centroid), ...yards.map((y) => y.position)];
  const b = boundsOf(pts);
  if (!b) return null;
  const c: Position = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  const pad = circleBounds(c, 30);
  return boundsOf([...pts, pad[0], pad[1]]);
}

export function chapterBounds(
  index: number,
  plan: PlanData | null,
  ranked: RankedOverlap[],
  response: ResponseData | null,
): { bounds: Bounds; pitch?: number; maxZoom?: number } | null {
  if (index <= 4) {
    if (!plan) return null;
    const b =
      index === 0
        ? riverBounds(plan)
        : index === 2
          ? overlapsBounds(ranked)
          : index === 3
            ? topMatchBounds(ranked, plan)
            : projectsBounds(plan);
    if (!b) return null;
    return index === 3 ? { bounds: b, pitch: 45, maxZoom: 11 } : { bounds: b, maxZoom: 9 };
  }
  if (!response) return null;
  const b = index === 5 ? stormBounds(response) : repairBounds(response);
  return b ? { bounds: b, maxZoom: 9.5 } : null;
}

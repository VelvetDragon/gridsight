/** Plain sentences built from the data, so panels read like a person talking. */
import { windowOverlap } from "./timeline";
import type { Overlap, Project } from "./types";

export function kmPhrase(km: number): string {
  if (km <= 0) return "0 km";
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function years(w: [string, string] | null): string | null {
  if (!w) return null;
  const a = w[0].slice(0, 4);
  const b = w[1].slice(0, 4);
  return a === b ? a : `${a}–${b}`;
}

/** "These two jobs are 4.9 km apart and both build in 2026." */
export function pairSentence(o: Overlap, a: Project | undefined, b: Project | undefined): string {
  const where = o.distanceKm <= 0 ? "These two jobs touch" : `These two jobs are ${kmPhrase(o.distanceKm)} apart`;
  const shared = windowOverlap(a?.buildWindow ?? null, b?.buildWindow ?? null);
  if (shared) {
    const y = years(shared);
    const m = Math.round(o.timelineOverlapMonths);
    return m >= 12 || y?.includes("–")
      ? `${where}, and both are under construction for about ${m} months (${y}).`
      : `${where} and both build in ${y}.`;
  }
  const ya = years(a?.buildWindow ?? null);
  const yb = years(b?.buildWindow ?? null);
  if (ya && yb) return `${where}, but they are built at different times (${ya} and ${yb}).`;
  return `${where}.`;
}

/** "They could share right-of-way, permits, a laydown yard and crews." */
export function shareSentence(items: string[]): string {
  const clean = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
  if (!clean.length) return "";
  const list = clean.length === 1 ? clean[0] : `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
  return `They could share ${list}.`;
}

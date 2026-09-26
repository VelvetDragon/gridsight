import type { Project } from "./types";

/** Construction radar covers January 2026 through December 2035. */
export const RADAR_START_YEAR = 2026;
export const RADAR_END_YEAR = 2035;
export const RADAR_MONTHS = (RADAR_END_YEAR - RADAR_START_YEAR + 1) * 12;

/** Months since Jan 2026 (fractional by day). "2026-01-01" → 0. */
export function monthIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return (y - RADAR_START_YEAR) * 12 + (m - 1) + ((d || 1) - 1) / 30.44;
}

export function monthLabel(index: number): string {
  const i = Math.floor(index);
  const y = RADAR_START_YEAR + Math.floor(i / 12);
  const m = ((i % 12) + 12) % 12;
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]} ${y}`;
}

export type BuildPhase = "planned" | "building" | "built" | "unknown";

export function phaseAt(p: Project, month: number): BuildPhase {
  if (!p.buildWindow) return "unknown";
  const s = monthIndex(p.buildWindow[0]);
  const e = monthIndex(p.buildWindow[1]);
  if (month < s) return "planned";
  if (month > e) return "built";
  return "building";
}

/** Shared months of two ISO windows, or null when they do not overlap. */
export function windowOverlap(
  a: [string, string] | null,
  b: [string, string] | null,
): [string, string] | null {
  if (!a || !b) return null;
  const s = a[0] > b[0] ? a[0] : b[0];
  const e = a[1] < b[1] ? a[1] : b[1];
  return s < e ? [s, e] : null;
}

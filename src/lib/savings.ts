/**
 * Money and time saved, computed only from the data files.
 *
 * Money (Plan mode)
 *   Each overlap carries the pipeline's order-of-magnitude cost estimate
 *   (overlap.cost): land & permits (landSavingsUsd), shared yards
 *   (yardSavingsUsd) and crew setup (mobilizationSavingsUsd), totalUsd being
 *   their sum. When plan/insights/cost-ranges.json is present, a match uses its
 *   low / central / high range and components instead (land + permits, yard,
 *   mobilization); otherwise low = central = high = cost.totalUsd.
 *   The headline sums low, central and high over the matches currently shown,
 *   so filters and tiers change it. Nothing is discounted or annualised.
 *   Costs come from Dominion's public filings only (Georgia Power's are
 *   redacted), so real savings could be higher.
 *
 *   Per customer = headline ÷ combined customers of both companies
 *   (lib/customers.ts). One-time and illustrative: savings reduce project
 *   costs that are recovered from customers over many years, not a bill credit.
 *
 *   By year: a match's savings are counted in the year its shared work ends,
 *   i.e. the end of the overlapping build window, or when the later of the two
 *   projects goes into service if their windows do not overlap.
 *
 * Time (Response mode)
 *   From mutual-aid.json: hours until 50/90/100% of customers (and 90% of
 *   vulnerable residents) have power back, with each company restoring alone
 *   ("separate") versus sharing crews and yards ("coordinated"). Hours saved =
 *   separate − coordinated, unless the file states them.
 */
import { COMBINED_CUSTOMERS } from "./customers";
import { RADAR_END_YEAR, RADAR_START_YEAR, windowOverlap } from "./timeline";
import type { Overlap, Project } from "./types";

/** One entry of plan/insights/cost-ranges.json (optional file, not part of types.ts). */
export interface CostRange {
  overlapId: string;
  lowUsd: number;
  centralUsd: number;
  highUsd: number;
  components?: { land?: number; mobilization?: number; yard?: number; permits?: number };
}

export function isCostRangeList(v: unknown): v is CostRange[] {
  return Array.isArray(v) && v.every((r) => r && typeof (r as CostRange).overlapId === "string");
}

export type CostRanges = Map<string, CostRange>;

export interface MatchSavings {
  low: number;
  central: number;
  high: number;
  /** Land and permits. */
  land: number;
  yard: number;
  /** Crew setup (mobilization). */
  crew: number;
  /** true when the numbers come from cost-ranges.json. */
  ranged: boolean;
}

export function matchSavings(o: Overlap, ranges: CostRanges | null): MatchSavings | null {
  const r = ranges?.get(o.id);
  if (r) {
    const c = r.components ?? {};
    const hasParts = c.land != null || c.permits != null || c.yard != null || c.mobilization != null;
    return {
      low: r.lowUsd,
      central: r.centralUsd,
      high: r.highUsd,
      land: hasParts ? (c.land ?? 0) + (c.permits ?? 0) : (o.cost?.landSavingsUsd ?? 0),
      yard: hasParts ? (c.yard ?? 0) : (o.cost?.yardSavingsUsd ?? 0),
      crew: hasParts ? (c.mobilization ?? 0) : (o.cost?.mobilizationSavingsUsd ?? 0),
      ranged: true,
    };
  }
  const c = o.cost;
  if (!c) return null;
  return {
    low: c.totalUsd,
    central: c.totalUsd,
    high: c.totalUsd,
    land: c.landSavingsUsd,
    yard: c.yardSavingsUsd,
    crew: c.mobilizationSavingsUsd,
    ranged: false,
  };
}

export interface SavingsSummary {
  /** Central estimate. */
  total: number;
  low: number;
  high: number;
  land: number;
  yard: number;
  crew: number;
  /** Matches that have a cost estimate. */
  count: number;
  /** Of those, how many have a low–high range. */
  rangedCount: number;
  acres: number;
}

export function summarizeSavings(overlaps: Overlap[], ranges: CostRanges | null = null): SavingsSummary {
  const s: SavingsSummary = {
    total: 0,
    low: 0,
    high: 0,
    land: 0,
    yard: 0,
    crew: 0,
    count: 0,
    rangedCount: 0,
    acres: 0,
  };
  for (const o of overlaps) {
    const m = matchSavings(o, ranges);
    if (!m) continue;
    s.total += m.central;
    s.low += m.low;
    s.high += m.high;
    s.land += m.land;
    s.yard += m.yard;
    s.crew += m.crew;
    s.acres += o.cost?.sharedAcres ?? 0;
    s.count += 1;
    if (m.ranged) s.rangedCount += 1;
  }
  return s;
}

/** Illustrative one-time saving per customer of both companies combined. */
export function perCustomer(totalUsd: number): number {
  return COMBINED_CUSTOMERS > 0 ? totalUsd / COMBINED_CUSTOMERS : 0;
}

/** The year a match's savings land (see the header comment). */
export function savingsYear(o: Overlap, desc: Project | undefined, gpc: Project | undefined): number | null {
  const shared = windowOverlap(desc?.buildWindow ?? null, gpc?.buildWindow ?? null);
  const iso =
    shared?.[1] ??
    [desc?.inService, gpc?.inService]
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ??
    null;
  if (!iso) return null;
  return Number(iso.slice(0, 4)) || null;
}

export interface YearPoint {
  year: number;
  /** Savings landing in this year. */
  added: number;
  /** Running total up to and including this year. */
  cumulative: number;
}

/** Cumulative savings by year across the radar range (2026–2035). */
export function savingsByYear(
  overlaps: Overlap[],
  projectsById: Map<string, Project>,
  ranges: CostRanges | null = null,
): YearPoint[] {
  const added = new Map<number, number>();
  for (const o of overlaps) {
    const m = matchSavings(o, ranges);
    if (!m) continue;
    const y = savingsYear(o, projectsById.get(o.descId), projectsById.get(o.gpcId));
    if (y == null) continue;
    const year = Math.min(RADAR_END_YEAR, Math.max(RADAR_START_YEAR, y));
    added.set(year, (added.get(year) ?? 0) + m.central);
  }
  const out: YearPoint[] = [];
  let run = 0;
  for (let y = RADAR_START_YEAR; y <= RADAR_END_YEAR; y++) {
    const a = added.get(y) ?? 0;
    run += a;
    out.push({ year: y, added: a, cumulative: run });
  }
  return out;
}

/* ---------------- Time saved (Response mode) ---------------- */

export interface RestorationScenario {
  hoursTo50pct: number;
  hoursTo90pct: number;
  hoursTo100pct: number;
  vulnerableHoursTo90pct: number;
  restorationCurve: { hour: number; pctRestored: number }[];
}

/** Shape of /data/response/<id>/mutual-aid.json (optional file, not part of types.ts). */
export interface MutualAid {
  scenarios: { separate: RestorationScenario; coordinated: RestorationScenario };
  /** Pipeline keys are to50pct / to90pct / to100pct / vulnerableTo90pct. */
  savedHours?: Partial<Record<"to50pct" | "to90pct" | "to100pct" | "vulnerableTo90pct", number>>;
  assumptions: string[];
}

export function isMutualAid(v: unknown): v is MutualAid {
  const s = (v as MutualAid | null)?.scenarios;
  return !!s && !!s.separate && !!s.coordinated && Array.isArray(s.separate.restorationCurve);
}

export interface TimeSaved {
  to90: number;
  vulnerableTo90: number;
  to50: number;
  to100: number;
}

export function timeSaved(m: MutualAid): TimeSaved {
  const { separate: a, coordinated: b } = m.scenarios;
  const given = m.savedHours ?? {};
  return {
    to50: given.to50pct ?? a.hoursTo50pct - b.hoursTo50pct,
    to90: given.to90pct ?? a.hoursTo90pct - b.hoursTo90pct,
    to100: given.to100pct ?? a.hoursTo100pct - b.hoursTo100pct,
    vulnerableTo90: given.vulnerableTo90pct ?? a.vulnerableHoursTo90pct - b.vulnerableHoursTo90pct,
  };
}

/** Hours with one decimal under 10 ("9.7"), whole hours above ("22"). */
export function fmtHoursNumber(h: number): string {
  return Math.abs(h) < 10 ? h.toFixed(1) : String(Math.round(h));
}

/** "9.7 hours", "22 hours" or "2 days 6 h". */
export function fmtHours(h: number): string {
  if (Math.abs(h) < 10) return `${h.toFixed(1)} hours`;
  const r = Math.round(h);
  if (Math.abs(r) < 48) return `${r} hour${Math.abs(r) === 1 ? "" : "s"}`;
  const d = Math.floor(r / 24);
  const rest = r % 24;
  return rest ? `${d} days ${rest} h` : `${d} days`;
}

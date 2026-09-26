/**
 * Money and time saved, computed only from the data files and published unit costs.
 *
 * Money (Plan mode)
 *   A pair saves money only for the ways to work together it actually has
 *   (lib/opportunities.ts), and only where a published source puts a price on it:
 *
 *   crew setup   "Share line/substation crews" or "Hand off the crew": each job
 *                still sets up on its own site; what one contractor avoids is one
 *                trip of crew and equipment between its base and the area (e.g. the
 *                first job's return trip and the second job's trip out, replaced by
 *                one short move). MISO prices mobilization and demobilization as one
 *                figure, so half of the smaller job's is counted. MISO unit costs (MTEP 2018 guide: lines by voltage,
 *                sec. 4.1.1.3, p. 16; substations new/existing site, sec. 4.2.1.2,
 *                p. 39) escalated to 2026 dollars with MISO's own yearly rates
 *                (2.5% 2018–22, 5% 2022–24, 4% 2024–26: × 1.316). Where the filing
 *                gives the project's cost, the figure is capped at 5.5% of it (MISO:
 *                project management including mobilization is 5.5% of a project).
 *   land         "Share a route" with a measured shared corridor: shared acres
 *                (pipeline, Georgia Transmission easement widths) × (USDA NASS 2025
 *                land value + MISO MTEP24 acquisition $14,247/acre) plus MISO
 *                permitting $2,968/acre, MISO figures escalated 2024→2026 at 4%/yr.
 *   not priced   Shared yards (MISO folds laydown yards into material delivery and
 *                no public unit cost exists), wetland surveys, bulk buying, outage
 *                planning and right-sizing are listed, not given a dollar figure.
 *
 *   Across pairs, a job's setup can only be avoided once: pairs are taken from the
 *   largest saving down, and a pair whose smaller job was already counted uses its
 *   other job instead, or adds nothing for crews if both were.
 *
 *   Per customer = headline ÷ combined customers of both companies
 *   (lib/customers.ts). One-time and illustrative.
 *
 *   By year: a pair's savings land in the year its shared work ends, i.e. the end
 *   of the overlapping build window, or when the later project goes into service.
 *
 * Time (Response mode)
 *   From mutual-aid.json: hours until 50/90/100% of customers (and 90% of
 *   vulnerable residents) have power back, with each company restoring alone
 *   ("separate") versus sharing crews and yards ("coordinated"). Hours saved =
 *   separate − coordinated, unless the file states them.
 */
import { COMBINED_CUSTOMERS } from "./customers";
import { fmtUsd } from "./format";
import { pairOpportunities, type Opportunity, type OpportunityKind } from "./opportunities";
import { RADAR_END_YEAR, RADAR_START_YEAR, windowOverlap } from "./timeline";
import type { Overlap, Project, SourceRef } from "./types";

/* ---------------- Sources ---------------- */

export const SAVINGS_SOURCES = {
  miso18: {
    document: "MISO Transmission Cost Estimation Guide for MTEP 2018",
    url: "https://cdn.misoenergy.org/Transmission-and-Substation-Project-Cost-Estimation-Guide-for-MTEP-2018144804.pdf",
    page: 16,
  },
  miso18Sub: {
    document: "MISO Transmission Cost Estimation Guide for MTEP 2018 (substations)",
    url: "https://cdn.misoenergy.org/Transmission-and-Substation-Project-Cost-Estimation-Guide-for-MTEP-2018144804.pdf",
    page: 39,
  },
  miso19: {
    document: "MISO Transmission Cost Estimation Guide for MTEP19",
    url: "https://nocapx2020.info/wp-content/uploads/2019/07/Transmission-Cost-Estimation-Guide-for-MTEP-2019337433.pdf",
    page: 31,
  },
  miso20: {
    document: "MISO Transmission Cost Estimation Guide for MTEP20",
    url: "https://legalectric.org/f/2021/07/20200414-PSC-Item-07-Transmission-Cost-Estimation-Guide-for-MTEP-2020_DRAFT_April_clean441565.pdf",
    page: 2,
  },
  miso23: {
    document: "MISO Transmission Cost Estimation Guide for MTEP23 (presentation)",
    url: "https://cdn.misoenergy.org/20230315%20PSC%20Item%2005e%20Transmission%20Cost%20Estimation%20Guide%20for%20MTEP23628218.pdf",
    page: 3,
  },
  miso24: {
    document: "MISO Transmission Cost Estimation Guide for MTEP24",
    url: "https://cdn.misoenergy.org/20240501%20PSC%20Item%2004%20MISO%20Transmission%20Cost%20Estimation%20Guide%20for%20MTEP24632680.pdf",
    page: 7,
  },
  miso24Land: {
    document: "MISO Transmission Cost Estimation Guide for MTEP24, Table 2.1",
    url: "https://cdn.misoenergy.org/20240501%20PSC%20Item%2004%20MISO%20Transmission%20Cost%20Estimation%20Guide%20for%20MTEP24632680.pdf",
    page: 8,
  },
  miso25: {
    document: "MISO Transmission Cost Estimation Guide for MTEP25 (presentation)",
    url: "https://cdn.misoenergy.org/20250306%20PSC%20Item%2004d%20Transmission%20Cost%20Estimation%20Guide%20for%20MTEP25_Presentation682744.pdf",
    page: 4,
  },
  miso26: {
    document: "MISO Transmission Cost Estimation Guide for MTEP26 (presentation)",
    url: "https://cdn.misoenergy.org/20260311%20PSC%20Item%2004%20Transmission%20Cost%20Estimation%20Guide%20for%20MTEP26_Presentation744889.pdf",
    page: 4,
  },
  nass: {
    document: "USDA NASS Land Values 2025 Summary",
    url: "https://www.nass.usda.gov/Publications/Todays_Reports/reports/land0825.pdf",
    page: 9,
  },
  gtc: {
    document: "Georgia Transmission Corp. pole heights and easement widths fact sheet",
    url: "https://www.gatransmission.com/wp-content/uploads/2017/09/GTC_PoleHeightsFactSheet.pdf",
    page: null,
  },
} satisfies Record<string, SourceRef>;

type SourceKey = keyof typeof SAVINGS_SOURCES;

/** Sources behind the escalation of 2018 dollars to 2026 dollars. */
const ESCALATION_SOURCES: SourceKey[] = ["miso19", "miso20", "miso23", "miso24", "miso25", "miso26"];

/* ---------------- Unit costs ---------------- */

/**
 * MISO's yearly escalation rates, 2018 → 2026: 2.5% a year to 2022 (MTEP19 p. 2,
 * MTEP20 p. 2, MTEP23 p. 3), 5% for 2023 and 2024 (MTEP23, MTEP24 p. 2), 4% for
 * 2025 and 2026 (MTEP25 p. 4, MTEP26 p. 4).
 */
export const ESCALATION_2018_TO_2026 = 1.025 ** 4 * 1.05 ** 2 * 1.04 ** 2;
/** MTEP24 figures are 2024 dollars; MTEP25 and MTEP26 escalate land and permitting 4% a year. */
const ESCALATION_2024_TO_2026 = 1.04 ** 2;

/** Line mobilization and demobilization by voltage, 2018 dollars (MTEP 2018 sec. 4.1.1.3). */
const LINE_MOB_2018: [kv: number, usd: number][] = [
  [500, 300_000],
  [345, 250_000],
  [230, 200_000],
  [138, 150_000],
  [0, 100_000],
];
/** Substation mobilization and demobilization, 2018 dollars (MTEP 2018 sec. 4.2.1.2). */
const SUB_MOB_NEW_2018 = 262_660;
const SUB_MOB_EXISTING_2018 = 157_590;
/** MISO: project management, including mobilization and demobilization, is 5.5% of a project. */
const PM_SHARE = 0.055;
/** Share of a job's mobilization and demobilization that one avoided trip stands for (one leg of two). */
const TRIP_SHARE = 0.5;

/** Right-of-way acquisition and permitting per acre, 2024 dollars (MTEP24 Table 2.1). */
const ACQUISITION_PER_ACRE = 14_247;
const PERMITTING_PER_ACRE = 2_968;
/** Farm real estate value per acre, 2025 (USDA NASS). */
const LAND_VALUE: Record<Project["state"], number> = { GA: 4_720, SC: 4_740 };

const CREW_KINDS: OpportunityKind[] = ["lineCrew", "substationCrew", "handoff"];

const UNPRICED: Partial<Record<OpportunityKind, string>> = {
  yard: "Shared storage yard: no public unit cost (MISO counts laydown yards inside material delivery)",
  permits: "Shared wetland survey: consultant fees are not published",
  materials: "Buying together: bulk discounts are not published",
  outage: "Planning outages together: saves outage time, not a line item",
  rightSizing: "Bigger rebuild: needs the utilities' load studies",
  corridor: "Shared route: the length that could be shared has not been measured",
  funding: "Grant funding: awards are competitive, so no amount is assumed",
};

const maxKv = (p: Project) => (p.voltageKv.length ? Math.max(...p.voltageKv) : 0);

/** One job's setup cost in 2026 dollars, and how it was worked out. */
export interface CrewSetup {
  projectId: string;
  usd: number;
  note: string;
}

export function crewSetup(p: Project): CrewSetup {
  const line = p.kind === "line";
  const base = line
    ? LINE_MOB_2018.find(([kv]) => maxKv(p) >= kv)![1]
    : p.action === "new"
      ? SUB_MOB_NEW_2018
      : SUB_MOB_EXISTING_2018;
  const unit = base * ESCALATION_2018_TO_2026;
  const what = line
    ? `a ${maxKv(p) || "low-voltage"}${maxKv(p) ? " kV" : ""} line`
    : `a substation on a ${p.action === "new" ? "new" : "existing"} site`;
  const cap = p.costUsd != null && p.costUsd > 0 ? p.costUsd * PM_SHARE : null;
  if (cap != null && cap < unit) {
    return {
      projectId: p.id,
      usd: cap,
      note: `${p.name}: 5.5% of its filed cost of ${fmtUsd(p.costUsd!)} = ${fmtUsd(cap)}, below MISO's ${fmtUsd(unit)} (2026 dollars) for ${what}.`,
    };
  }
  return {
    projectId: p.id,
    usd: unit,
    note: `${p.name}: MISO's ${fmtUsd(base, { compact: false })} (2018) for ${what} × ${ESCALATION_2018_TO_2026.toFixed(3)} = ${fmtUsd(unit)} in 2026 dollars.`,
  };
}

/* ---------------- One pair ---------------- */

export interface MatchSavings {
  /** Estimated saving in 2026 dollars for this pair on its own. */
  total: number;
  /** Land and permits. */
  land: number;
  /** Crew setup (mobilization). */
  crew: number;
  acres: number;
  /** The two jobs' setup costs, cheaper first: the first is the one avoided. */
  crewOptions: CrewSetup[];
  /** How each figure was worked out, in plain sentences. */
  lines: string[];
  sources: SourceRef[];
  /** Ways to work together that have no published price. */
  unpriced: string[];
}

export function matchSavings(
  o: Overlap,
  desc: Project | undefined,
  gpc: Project | undefined,
  opportunities?: Opportunity[],
): MatchSavings | null {
  if (!desc || !gpc) return null;
  const ops = opportunities ?? pairOpportunities(o, desc, gpc);
  const kinds = new Set(ops.map((op) => op.kind));
  const lines: string[] = [];
  const used = new Set<SourceKey>();
  const unpriced: string[] = [];

  let crew = 0;
  let crewOptions: CrewSetup[] = [];
  if (CREW_KINDS.some((k) => kinds.has(k))) {
    crewOptions = [crewSetup(desc), crewSetup(gpc)].sort((x, y) => x.usd - y.usd);
    crew = crewOptions[0].usd * TRIP_SHARE;
    const how = kinds.has("handoff") && !kinds.has("lineCrew") && !kinds.has("substationCrew") ? "handing off" : "sharing";
    lines.push(
      `Crew setup, ${fmtUsd(crew)}: by ${how} one crew, one trip between the contractor's base and the area is not made. ` +
        "Both jobs still set up on their own sites, so this is half of the smaller job's mobilization and demobilization, which MISO prices as one figure.",
      ...crewOptions.map((c) => c.note),
    );
    used.add(desc.kind === "line" || gpc.kind === "line" ? "miso18" : "miso18Sub");
    if (desc.kind === "substation" || gpc.kind === "substation") used.add("miso18Sub");
    ESCALATION_SOURCES.forEach((k) => used.add(k));
  }

  let land = 0;
  let acres = 0;
  const newLine = [desc, gpc].find((p) => p.kind === "line" && p.action === "new");
  if (kinds.has("corridor") && newLine && (o.cost?.sharedAcres ?? 0) > 0) {
    acres = o.cost!.sharedAcres;
    const value = LAND_VALUE[newLine.state];
    const acquire = ACQUISITION_PER_ACRE * ESCALATION_2024_TO_2026;
    const permit = PERMITTING_PER_ACRE * ESCALATION_2024_TO_2026;
    land = acres * (value + acquire + permit);
    lines.push(
      `Land and permits, ${fmtUsd(land)}: about ${acres.toFixed(1)} acres (${o.cost!.sharedCorridorKm} km of shared route × a Georgia Transmission easement width) ` +
        `that the new line does not need to buy, at ${fmtUsd(value, { compact: false })}/acre land value (USDA NASS 2025, ${newLine.state}) + ` +
        `${fmtUsd(acquire, { compact: false })}/acre to acquire it + ${fmtUsd(permit, { compact: false })}/acre to permit it (MISO MTEP24 Table 2.1, in 2026 dollars).`,
    );
    for (const k of ["gtc", "nass", "miso24Land", "miso25", "miso26"] as SourceKey[]) used.add(k);
  }

  for (const k of kinds) {
    const why = UNPRICED[k];
    if (why && !(k === "corridor" && land > 0)) unpriced.push(why);
  }
  if (crew + land <= 0 && !unpriced.length) return null;

  return {
    total: crew + land,
    land,
    crew,
    acres,
    crewOptions,
    lines,
    sources: [...used].map((k) => SAVINGS_SOURCES[k]),
    unpriced,
  };
}

/* ---------------- Many pairs ---------------- */

export interface SavingsSummary {
  /** Estimated saving in 2026 dollars, each job's setup counted once. */
  total: number;
  land: number;
  crew: number;
  /** Pairs that add to the total. */
  count: number;
  /** Pairs whose crew saving was already counted through another pair. */
  repeats: number;
  acres: number;
  sources: SourceRef[];
}

/** What each pair adds to a total once no job's setup is avoided twice (see the header comment). */
export function countedSavings(overlaps: Overlap[], projectsById: Map<string, Project>): Map<string, MatchSavings & { counted: number }> {
  const all = overlaps
    .map((o) => ({ o, m: matchSavings(o, projectsById.get(o.descId), projectsById.get(o.gpcId)) }))
    .filter((x): x is { o: Overlap; m: MatchSavings } => !!x.m)
    .sort((x, y) => y.m.total - x.m.total || x.o.id.localeCompare(y.o.id));
  const avoided = new Set<string>();
  const out = new Map<string, MatchSavings & { counted: number }>();
  for (const { o, m } of all) {
    const pick = m.crewOptions.find((c) => !avoided.has(c.projectId));
    if (pick) avoided.add(pick.projectId);
    out.set(o.id, { ...m, counted: m.land + (pick ? pick.usd * TRIP_SHARE : 0) });
  }
  return out;
}

export function summarizeSavings(overlaps: Overlap[], projectsById: Map<string, Project>): SavingsSummary {
  const s: SavingsSummary = { total: 0, land: 0, crew: 0, count: 0, repeats: 0, acres: 0, sources: [] };
  const seen = new Map<string, SourceRef>();
  for (const m of countedSavings(overlaps, projectsById).values()) {
    if (m.counted <= 0) {
      if (m.crew > 0) s.repeats += 1;
      continue;
    }
    s.total += m.counted;
    s.land += m.land;
    s.crew += m.counted - m.land;
    s.acres += m.acres;
    s.count += 1;
    m.sources.forEach((r) => seen.set(`${r.url}#${r.page}`, r));
  }
  s.sources = [...seen.values()];
  return s;
}

/** The fixed explanation behind every total, one sentence each. */
export const SAVINGS_METHOD: string[] = [
  "Only ways to work together that a published source prices are counted: crew setup (MISO unit costs) and land on a shared route (USDA and MISO).",
  "Sharing or handing off a crew saves one trip to and from the contractor's base, not the whole setup: each job still sets up on its own site, so half of the smaller job's mobilization and demobilization is counted.",
  `MISO's 2018 unit costs are raised to 2026 dollars with MISO's own yearly rates: 2.5% to 2022, 5% in 2023–24, 4% in 2025–26 (× ${ESCALATION_2018_TO_2026.toFixed(3)}).`,
  "Where a filing gives a project's cost, its crew setup is capped at 5.5% of it, MISO's share for project management including mobilization.",
  "A job's setup is only saved once: when one project pairs with several others, only one of those pairs counts it.",
  "Storage yards, wetland surveys, bulk buying and outage planning have no published price, so they are left out rather than guessed.",
  "Projects without a published cost (Georgia Power publishes none) use MISO's typical figures without the cap.",
];

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
export function savingsByYear(overlaps: Overlap[], projectsById: Map<string, Project>): YearPoint[] {
  const added = new Map<number, number>();
  const counted = countedSavings(overlaps, projectsById);
  for (const o of overlaps) {
    const m = counted.get(o.id);
    if (!m || m.counted <= 0) continue;
    const y = savingsYear(o, projectsById.get(o.descId), projectsById.get(o.gpcId));
    if (y == null) continue;
    const year = Math.min(RADAR_END_YEAR, Math.max(RADAR_START_YEAR, y));
    added.set(year, (added.get(year) ?? 0) + m.counted);
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

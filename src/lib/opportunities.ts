/**
 * What two nearby projects could actually do together, pair by pair.
 *
 * No public data describes crews, contractors or yards, so every opportunity is
 * inferred by a rule from filed facts (kind, action, voltage, conductor, places,
 * build window) plus distances, and carries the reason in plain words:
 *
 *   outage          touch or cross, or both filings name the same substation   required
 *   corridor        a new line runs within 1.6 km of the other line             strong / possible
 *   permits         mapped wetlands in the shared corridor (wetlands.json)      strong
 *   storage yard    same months, ≤ 15 km by road                                strong / possible
 *   line crew       both line work, same voltage band, same months, ≤ 60 km     strong / possible
 *   substation crew both substation work, same months, ≤ 60 km                 strong / possible
 *   handoff         same kind of work, one starts ≤ 12 months after the other
 *                   ends, ≤ 80 km                                               possible
 *   materials       same conductor, or both add ≥ 230 kV substation equipment,
 *                   starting within 24 months                                   possible
 *   right-sizing    a line rebuild ≤ 25 km from new work of equal or higher
 *                   voltage, built within 24 months of each other               possible
 *
 * Each reason is one plain sentence. Build windows are estimates (in-service
 * date minus a typical build length).
 */
import { UTILITY_NAME } from "./theme";
import type { Overlap, Project } from "./types";

export type OpportunityKind =
  | "outage"
  | "corridor"
  | "permits"
  | "yard"
  | "lineCrew"
  | "substationCrew"
  | "handoff"
  | "materials"
  | "rightSizing";

export type OpportunityStrength = "required" | "strong" | "possible";

export interface Opportunity {
  kind: OpportunityKind;
  strength: OpportunityStrength;
  title: string;
  /** Why this pair qualifies, with its numbers. */
  reason: string;
  /** First thing the two planners would do about it. */
  nextStep: string;
}

/** One entry of plan/insights/wetlands.json (optional file). */
export interface WetlandNote {
  overlapId: string;
  corridorAcres: number;
  wetlandAcresInCorridor: number;
  wetlandTypes: string[];
  sharedPermitNote: string;
}

export function isWetlandNoteList(v: unknown): v is WetlandNote[] {
  return (
    Array.isArray(v) &&
    v.every((r) => r && typeof (r as WetlandNote).overlapId === "string" && typeof r.wetlandAcresInCorridor === "number")
  );
}

const YARD_KM = 15;
const CREW_KM = 60;
const HANDOFF_KM = 80;
const HANDOFF_MONTHS = 12;
const RIGHT_SIZING_KM = 25;
const RIGHT_SIZING_MONTHS = 24;
const MATERIALS_MONTHS = 24;
/** Typical road-to-straight-line ratio in this data, used when no road distance is known. */
const ROAD_FACTOR = 1.4;
const MONTH_MS = 1000 * 3600 * 24 * 30.44;

export const STRENGTH_LABEL: Record<OpportunityStrength, string> = {
  required: "Must do",
  strong: "Strong fit",
  possible: "Worth a look",
};

const STRENGTH_ORDER: Record<OpportunityStrength, number> = { required: 0, strong: 1, possible: 2 };

const maxKv = (p: Project) => (p.voltageKv.length ? Math.max(...p.voltageKv) : 0);
const kvText = (kv: number) => `${kv} kV`;

/** Crews and equipment differ by voltage class: ≥ 345 kV, 161–230 kV, lower. */
function voltageBand(p: Project): number {
  const v = maxKv(p);
  return v >= 345 ? 2 : v >= 161 ? 1 : 0;
}

const who = (p: Project) => UTILITY_NAME[p.utility];

function kmText(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** Road distance when known, otherwise an estimate from the straight line. */
function drive(o: Overlap): { km: number; text: string } {
  if (o.distanceKm <= 0) return { km: 0, text: "next to each other" };
  if (o.roadKm != null) return { km: o.roadKm, text: `${kmText(o.roadKm)} apart by road` };
  return { km: o.distanceKm * ROAD_FACTOR, text: `about ${kmText(o.distanceKm)} apart` };
}

/** Months between the windows: negative when they overlap, positive for a gap. */
function gapMonths(a: Project, b: Project): number | null {
  if (!a.buildWindow || !b.buildWindow) return null;
  const s = Math.max(Date.parse(a.buildWindow[0]), Date.parse(b.buildWindow[0]));
  const e = Math.min(Date.parse(a.buildWindow[1]), Date.parse(b.buildWindow[1]));
  return (s - e) / MONTH_MS;
}

function startGapMonths(a: Project, b: Project): number | null {
  if (!a.buildWindow || !b.buildWindow) return null;
  return Math.abs(Date.parse(a.buildWindow[0]) - Date.parse(b.buildWindow[0])) / MONTH_MS;
}

const place = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(primary|substation|sub|plant|switching station|county|tie)\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

/** A place (usually a substation) named in both filings, in the first filing's spelling. */
function sharedPlace(a: Project, b: Project): string | null {
  const other = new Set(b.places.map(place).filter(Boolean));
  return a.places.find((p) => other.has(place(p))) ?? null;
}

/** Conductors a filing installs, e.g. "1272 ACSR"; for "from X to Y", only what follows "to". */
function conductors(p: Project): string[] {
  const text = p.description.split(/\bto\b/i).pop() ?? "";
  return [...text.matchAll(/(\d{3,4})\s*(?:kcmil\s*)?(ACSR|ACSS|AAC|ACCC)\b/gi)].map(
    (m) => `${m[1]} ${m[2].toUpperCase()}`,
  );
}

/**
 * The line rebuild in the pair, when the other side adds new equipment at the same or a
 * higher voltage nearby and around the same time.
 */
function rightSizingSides(o: Overlap, a: Project, b: Project): { rebuild: Project; driver: Project } | null {
  if (o.distanceKm > RIGHT_SIZING_KM) return null;
  const gap = gapMonths(a, b);
  if (gap == null || gap > RIGHT_SIZING_MONTHS) return null;
  for (const [r, n] of [
    [a, b],
    [b, a],
  ] as const) {
    if (r.kind === "line" && r.action === "rebuild" && n.action === "new" && maxKv(n) >= maxKv(r)) {
      return { rebuild: r, driver: n };
    }
  }
  return null;
}

/** A line rebuild near new, same-or-higher-voltage work: worth a FERC 1920-A right-sizing look. */
export function isRightSizingCandidate(o: Overlap, a: Project | undefined, b: Project | undefined): boolean {
  return !!a && !!b && !!rightSizingSides(o, a, b);
}

export function pairOpportunities(
  o: Overlap,
  a: Project,
  b: Project,
  wetland: WetlandNote | null = null,
): Opportunity[] {
  const found: Opportunity[] = [];
  const road = drive(o);
  const gap = gapMonths(a, b);
  const concurrent = gap != null && gap < 0;
  const bothLines = a.kind === "line" && b.kind === "line";
  const bothSubs = a.kind === "substation" && b.kind === "substation";

  // Outage coordination: physically unavoidable when they touch or share a substation.
  const shared = sharedPlace(a, b);
  if (shared || o.tier === "crossing") {
    found.push({
      kind: "outage",
      strength: "required",
      title: "Plan outages together",
      reason: shared
        ? `Both projects connect at ${shared}, so their shutdowns have to be scheduled together.`
        : "The two projects cross, so their shutdowns have to be scheduled together.",
      nextStep: "Put both outage requests on one calendar and agree switching steps.",
    });
  }

  // Shared corridor: only a new line gains anything; rebuilds already own their right-of-way.
  const newLine = [a, b].find((p) => p.kind === "line" && p.action === "new");
  const corridorKm = o.cost?.sharedCorridorKm ?? 0;
  const close = o.tier === "crossing" || o.tier === "row";
  if (bothLines && newLine && (corridorKm > 0 || (o.cost == null && close))) {
    const other = newLine === a ? b : a;
    const traced = a.geometryQuality === "traced" && b.geometryQuality === "traced";
    found.push({
      kind: "corridor",
      strength: traced ? "strong" : "possible",
      title: "Share a route",
      reason:
        `${who(newLine)}'s new line could run next to ${who(other)}'s line` +
        `${corridorKm > 0 ? ` for about ${kmText(corridorKm)}` : ""}, so less new land to buy.`,
      nextStep: "Overlay both routes and look for stretches that could share or abut the easement.",
    });
  }

  // Environmental permits, from the wetland screening.
  if (wetland && wetland.wetlandAcresInCorridor > 0) {
    found.push({
      kind: "permits",
      strength: "strong",
      title: "One wetland permit",
      reason:
        `About ${Math.round(wetland.wetlandAcresInCorridor).toLocaleString("en-US")} acres of wetland sit where the projects overlap. ` +
        `One survey and one permit filing could cover both.`,
      nextStep: "Commission one wetland delineation for the shared corridor.",
    });
  }

  // Storage yard: same months and a short drive.
  if (concurrent && road.km <= YARD_KM) {
    found.push({
      kind: "yard",
      strength: o.roadKm != null ? "strong" : "possible",
      title: "Share a storage yard",
      reason: `They are ${road.text} and build at the same time, so one yard could store materials for both.`,
      nextStep: "Pick one yard site and split its lease and security.",
    });
  }

  // Crews at the same time, then back to back.
  const sameBand = voltageBand(a) === voltageBand(b);
  if (concurrent && (bothLines || bothSubs) && road.km <= CREW_KM && (bothSubs || sameBand)) {
    const sameWork = a.action === b.action && maxKv(a) === maxKv(b);
    const what = bothLines ? "line" : "substation";
    found.push({
      kind: bothLines ? "lineCrew" : "substationCrew",
      strength: sameWork ? "strong" : "possible",
      title: `Share ${what} crews`,
      reason: `Both are ${what} jobs ${road.text}, built at the same time. One contractor could do both.`,
      nextStep: bothLines
        ? "Compare contractor lists and see if one bid can cover both jobs."
        : "Line up the two commissioning schedules and share one testing crew.",
    });
  }

  if (gap != null && gap > 0 && a.kind === b.kind && sameBand && gap <= HANDOFF_MONTHS && road.km <= HANDOFF_KM) {
    const [first, second] = Date.parse(a.buildWindow![1]) <= Date.parse(b.buildWindow![1]) ? [a, b] : [b, a];
    const months = Math.max(1, Math.round(gap));
    found.push({
      kind: "handoff",
      strength: "possible",
      title: "Hand off the crew",
      reason:
        `${who(second)}'s job starts about ${months} month${months === 1 ? "" : "s"} after ${who(first)}'s ends, ` +
        `${road.text}. The same crew could move straight over.`,
      nextStep: "Offer the second job to the first job's contractor as a follow-on.",
    });
  }

  // Materials: same conductor, or both adding high-voltage substation equipment.
  const starts = startGapMonths(a, b);
  if (starts != null && starts <= MATERIALS_MONTHS) {
    const common = bothLines ? conductors(a).find((c) => conductors(b).includes(c)) : undefined;
    const hvKv = bothSubs ? a.voltageKv.filter((v) => v >= 230 && b.voltageKv.includes(v)) : [];
    if (common) {
      found.push({
        kind: "materials",
        strength: "possible",
        title: "Buy wire together",
        reason: `Both use ${common} wire and start around the same time. One bigger order could cost less.`,
        nextStep: "Compare conductor specs and order dates with both purchasing teams.",
      });
    } else if (hvKv.length && a.action !== "rebuild" && b.action !== "rebuild") {
      found.push({
        kind: "materials",
        strength: "possible",
        title: "Buy equipment together",
        reason:
          `Both add ${hvKv.map(kvText).join("/")} substation equipment around the same time. ` +
          `Transformers take a long time to arrive, so ordering together helps.`,
        nextStep: "Compare transformer and breaker specs before either order is placed.",
      });
    }
  }

  const rs = rightSizingSides(o, a, b);
  if (rs) {
    found.push({
      kind: "rightSizing",
      strength: "possible",
      title: "Consider a bigger rebuild",
      reason:
        `${who(rs.rebuild)} is rebuilding a ${kvText(maxKv(rs.rebuild))} line near ${who(rs.driver)}'s new ` +
        `${kvText(maxKv(rs.driver))} ${rs.driver.kind}. Worth checking if the rebuild should carry more.`,
      nextStep: "Check whether the rebuild should be sized up for the new load nearby.",
    });
  }

  found.sort((x, y) => STRENGTH_ORDER[x.strength] - STRENGTH_ORDER[y.strength]);
  return found;
}

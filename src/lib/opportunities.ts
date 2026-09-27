/**
 * What two nearby projects could actually do together, pair by pair.
 *
 * No public data describes crews, contractors or yards, so every opportunity is
 * inferred by a rule from filed facts (kind, action, voltage, conductor, places,
 * build window) plus distances, and carries the reason in plain words:
 *
 *   outage          touch or cross, or both filings name the same substation   required
 *   corridor        a new line runs within 1.6 km of the other line             strong / possible
 *   permits         mapped wetlands where the routes run ≤ 1.6 km apart, both in
 *                   one state (one Corps district, one state water agency),
 *                   starting within 24 months: one delineation, and one joint
 *                   application through one agent (33 CFR 325.1(d)(8))         strong / possible
 *                   A Corps authorization covers one owner's "single and
 *                   complete project" (33 CFR 330.2(i)), so there is never one
 *                   permit for two utilities, and NWP 57's ½-acre limit still
 *                   applies to each project on its own.
 *   storage yard    same months, ≤ 15 km by road                                strong / possible
 *   line crew       both line work, same voltage band or a shared voltage,
 *                   same months, ≤ 60 km                                        strong / possible
 *   substation crew both substation work, same months, ≤ 60 km                 strong / possible
 *   handoff         same kind of work, one starts ≤ 3 months after the other
 *                   ends, ≤ 80 km                                               possible
 *   materials       same conductor, or both add ≥ 230 kV substation equipment,
 *                   starting within 24 months                                   possible
 *   right-sizing    a ≥ 115 kV line rebuilt for age or hardening (so nobody
 *                   has sized it for new load), with room left to carry more,
 *                   that ends at the new work's substation (same name, or
 *                   endpoints ≤ 1 km apart), at most one voltage class below
 *                   it, built within 24 months of each other                    possible
 *                   Whether the grid needs the extra capacity takes load-flow
 *                   studies (grid models are not public), so the card says so.
 *
 * Each reason is one plain sentence. Build windows are estimates (in-service
 * date minus a typical build length).
 */
import type { LineCollection } from "./data";
import { closestBetween } from "./overlaps";
import { UTILITY_NAME } from "./theme";
import type { Overlap, Position, Project } from "./types";

export type OpportunityKind =
  | "outage"
  | "corridor"
  | "permits"
  | "yard"
  | "lineCrew"
  | "substationCrew"
  | "handoff"
  | "materials"
  | "rightSizing"
  /** Added by the savings agent (lib/grants.ts), not by the rules below. */
  | "funding";

export type OpportunityStrength = "required" | "strong" | "possible";

export interface Opportunity {
  kind: OpportunityKind;
  strength: OpportunityStrength;
  title: string;
  /** Why this pair qualifies, with its numbers. */
  reason: string;
  /** First thing the two planners would do about it. */
  nextStep: string;
  /** What was checked before suggesting it: passed, failed or cannot be checked from public data. */
  checks?: OpportunityCheck[];
}

export interface OpportunityCheck {
  label: string;
  ok: boolean | null;
  note: string;
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
/** A contractor books its next job within weeks; after a season's gap the crew has moved on elsewhere. */
const HANDOFF_MONTHS = 3;
/** Below this a line is local sub-transmission; nothing new on the bulk grid makes it carry more. */
const RIGHT_SIZING_MIN_KV = 115;
/** Endpoints this close are taken to be the same substation. */
const SAME_STATION_KM = 1;
/** Below this location confidence a mapped endpoint is too rough to call the same station. */
const MIN_LOCATION_CONFIDENCE = 0.7;
const RIGHT_SIZING_MONTHS = 24;
const MATERIALS_MONTHS = 24;
/** Wetland fieldwork is only shared when both permit applications are prepared at about the same time. */
const PERMIT_MONTHS = 24;
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

/** The filing's own statement of why the project is needed. */
function statedNeed(p: Project): string | null {
  const m = /(?:Need|Supporting statement):\s*([^(]+?)(?:\s*\(|\.\s|\.$|$)/i.exec(p.description);
  return m ? m[1].trim().replace(/\.$/, "") : null;
}

/** Rebuilt because of load, so the owner's load studies already sized it. */
const CAPACITY_NEED = /overload|contingency|\bTPL\b|system performance|load growth|\bgrowth\b/i;
/** Rebuilt because of age or condition: a like-for-like replacement unless someone asks. */
const CONDITION_NEED = /end of life|hardening|maintenance|aging|rotten|wood pol|widening|relocat|move .*line/i;
/** Already built with room to grow: high-temperature wire, or towers designed for more. */
const ALREADY_SIZED = /\bACSS\b|\bACCC\b|designed\s+(?:spdc|for)|future circuit|\d+\s*kV insulation|SPDC\s*\d+\s*\/\s*\d+/i;

function endpoints(p: Project): Position[] {
  const g = p.geometry;
  return g.type === "Point" ? [g.coordinates] : [g.coordinates[0], g.coordinates[g.coordinates.length - 1]];
}

function kmBetween(a: Position, b: Position): number {
  return closestBetween({ type: "Point", coordinates: a }, { type: "Point", coordinates: b }).d;
}

/** Whether a mapped line of at least `kv` passes within `km` of the point. */
function gridNear(grid: LineCollection, at: Position, kv: number, km: number): boolean {
  for (const f of grid.features) {
    if (Number(f.properties?.voltage ?? 0) < kv) continue;
    const parts = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const part of parts) for (const c of part) if (kmBetween(at, c) <= km) return true;
  }
  return false;
}

interface RightSizing {
  rebuild: Project;
  driver: Project;
  /** Where the rebuild meets the new work, e.g. "Okatie" or "0.4 km apart". */
  meets: string;
  /** Mapped lines at the new work's voltage reach both ends of the rebuild; null when unknown. */
  higherAtBothEnds: boolean | null;
}

/**
 * The line rebuild in the pair when making it bigger is worth a planner's look: it is being
 * replaced for age (nobody has sized it for new load yet), it has room to carry more, and it
 * ends at the substation where the other side's new work comes in at its voltage or one class
 * above. Being nearby is not enough: power only flows through lines that connect.
 */
function rightSizingSides(a: Project, b: Project, grid: LineCollection | null): RightSizing | null {
  const gap = gapMonths(a, b);
  if (gap == null || gap > RIGHT_SIZING_MONTHS) return null;
  for (const [r, n] of [
    [a, b],
    [b, a],
  ] as const) {
    if (r.kind !== "line" || r.action !== "rebuild" || n.action !== "new") continue;
    const kv = maxKv(r);
    if (kv < RIGHT_SIZING_MIN_KV || maxKv(n) < kv || voltageBand(n) - voltageBand(r) > 1) continue;
    if (CAPACITY_NEED.test(r.description) || !CONDITION_NEED.test(r.description)) continue;
    if (ALREADY_SIZED.test(r.description)) continue;

    const station = sharedPlace(r, n);
    let meets: string | null = station;
    if (!meets && r.locationConfidence >= MIN_LOCATION_CONFIDENCE && n.locationConfidence >= MIN_LOCATION_CONFIDENCE) {
      const km = Math.min(...endpoints(r).flatMap((e) => endpoints(n).map((f) => kmBetween(e, f))));
      if (km <= SAME_STATION_KM) meets = `${kmText(km)} apart`;
    }
    if (!meets) continue;

    const higher = maxKv(n) > kv;
    const higherAtBothEnds =
      !higher || !grid?.features.length
        ? null
        : endpoints(r).every((e) => gridNear(grid, e, maxKv(n), SAME_STATION_KM));
    return { rebuild: r, driver: n, meets: station ? `both connect at ${station}` : `their ends are ${meets}`, higherAtBothEnds };
  }
  return null;
}

/** A line rebuild tied into new work nearby: worth a FERC 1920-A right-sizing look. */
export function isRightSizingCandidate(
  _o: Overlap,
  a: Project | undefined,
  b: Project | undefined,
  grid: LineCollection | null = null,
): boolean {
  return !!a && !!b && !!rightSizingSides(a, b, grid);
}

export function pairOpportunities(
  o: Overlap,
  a: Project,
  b: Project,
  wetland: WetlandNote | null = null,
  grid: LineCollection | null = null,
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

  // Wetland permits. Each utility needs its own Corps authorization for its own project; what two
  // projects can share is the fieldwork on common ground and, within one district, a joint application.
  const starts = startGapMonths(a, b);
  const sameState = !!a.state && a.state === b.state;
  const sameGround = o.tier === "crossing" || o.tier === "row";
  if (wetland && wetland.wetlandAcresInCorridor > 0 && sameState && sameGround && starts != null && starts <= PERMIT_MONTHS) {
    const traced = a.geometryQuality === "traced" && b.geometryQuality === "traced";
    const acres = Math.round(wetland.wetlandAcresInCorridor).toLocaleString("en-US");
    // A joint application needs work of a similar character (33 CFR 325.1(d)(8)).
    const joint = a.kind === b.kind;
    found.push({
      kind: "permits",
      strength: traced ? "strong" : "possible",
      title: "Share the wetland survey",
      reason:
        `Their routes run ${o.tier === "crossing" ? "into each other" : `${kmText(o.distanceKm)} apart`} in ${a.state}, ` +
        `with about ${acres} acres of mapped wetland around them. One consultant could delineate that ground for both` +
        `${joint ? ", and one agent can file a joint application for both owners" : ""}. ` +
        `Each utility still needs its own authorization.`,
      nextStep: joint
        ? "Hire one wetland consultant for the shared ground and ask the Corps district about a joint application before either files."
        : "Hire one wetland consultant for the shared ground before either utility files.",
      checks: [
        {
          label: "Same state",
          ok: true,
          note: `Both are in ${a.state}: one state water-quality office, and usually one Corps district.`,
        },
        {
          label: "Same ground",
          ok: true,
          note: "Close enough that one delineation covers land both projects work on. A delineation only covers the land surveyed.",
        },
        {
          label: "Permits prepared together",
          ok: true,
          note: `They start within ${Math.max(1, Math.round(starts))} months of each other, inside the five years a Corps wetland determination stays valid.`,
        },
        {
          label: "Joint application allowed",
          ok: joint,
          note: joint
            ? "One application may cover more than one owner doing similar work in the same area, through one agent (33 CFR 325.1(d)(8))."
            : `A ${a.kind} and a ${b.kind} are not similar work, so each utility files its own application.`,
        },
        {
          label: "Wetland actually affected",
          ok: null,
          note: "The acreage is from the National Wetlands Inventory, a screening map. Only a field delineation shows what each route touches.",
        },
      ],
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
  // A 230/115 kV job includes 115 kV work, so it matches a 115 kV job too.
  const sameBand = voltageBand(a) === voltageBand(b) || a.voltageKv.some((v) => b.voltageKv.includes(v));
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

  const rs = rightSizingSides(a, b, grid);
  if (rs) {
    const { rebuild, driver, meets, higherAtBothEnds } = rs;
    const kv = maxKv(rebuild);
    const newKv = maxKv(driver);
    const miles = rebuild.miles ? `${Math.round(rebuild.miles * 10) / 10} mi ` : "";
    const wire = conductors(rebuild)[0];
    const need = statedNeed(rebuild);
    const option =
      higherAtBothEnds === true
        ? `heavier wire, or towers ready for ${kvText(newKv)} (${kvText(newKv)} already reaches both ends)`
        : "heavier wire";
    found.push({
      kind: "rightSizing",
      strength: "possible",
      title: "Consider a bigger rebuild",
      reason:
        `${who(rebuild)} is replacing a ${miles}${kvText(kv)} line (${rebuild.name}) as it is; ` +
        `${who(driver)}'s new ${kvText(newKv)} ${driver.kind} comes in where it ends (${meets}). ` +
        `If the new work sends more power down this line, fitting ${option} during the rebuild ` +
        `costs far less than rebuilding it again later.`,
      nextStep:
        `Before ${who(rebuild)} designs the rebuild, ask both planning teams to run the line in their load studies ` +
        `with the new ${driver.kind} in service.`,
      checks: [
        {
          label: "Replaced for age, not load",
          ok: true,
          note: `The filing's reason: "${need ?? "condition"}". So it has not been sized for new load.`,
        },
        {
          label: "Room to carry more",
          ok: true,
          note: wire
            ? `Planned with ${wire}; a high-temperature or larger conductor would carry more.`
            : "No high-temperature wire or oversized towers in the filing.",
        },
        {
          label: "Connects to the new work",
          ok: true,
          note: `${meets[0].toUpperCase()}${meets.slice(1)}, so power from the new ${driver.kind} can flow down this line.`,
        },
        ...(newKv > kv
          ? [
              {
                label: `${kvText(newKv)} at both ends`,
                ok: higherAtBothEnds,
                note:
                  higherAtBothEnds === true
                    ? `Mapped ${kvText(newKv)} lines reach both ends, so the line could later step up in voltage.`
                    : higherAtBothEnds === false
                      ? `Not at both ends, so stepping up in voltage would also need new transformers. Heavier wire only.`
                      : "Could not check the mapped grid.",
              },
            ]
          : []),
        {
          label: "Grid needs the extra capacity",
          ok: null,
          note: "Only load-flow studies can show this, and the grid models behind them are not public.",
        },
      ],
    });
  }

  found.sort((x, y) => STRENGTH_ORDER[x.strength] - STRENGTH_ORDER[y.strength]);
  return found;
}

/** Derived facts about an overlap, shared by the list, drawer and memo. */
import { fmtKm, fmtMinutes, fmtMonthYear, fmtMonths, fmtUsd, ACTION_LABEL, fmtKv } from "./format";
import { tierFull } from "./theme";
import { windowOverlap } from "./timeline";
import type { Overlap, Project } from "./types";

export const RIGHT_SIZING_TIP =
  "FERC Order 1920-A: when a line is being replaced anyway, consider building it bigger for future needs.";

/** Either side is a rebuild, so FERC 1920-A right-sizing is worth a look. */
export function isRightSizingCandidate(desc: Project | undefined, gpc: Project | undefined): boolean {
  return desc?.action === "rebuild" || gpc?.action === "rebuild";
}

export function isRightSizingItem(item: string): boolean {
  return /right[- ]?siz/i.test(item);
}

export interface RoadNote {
  kind: "verified" | "detour" | "far" | "unknown";
  text: string;
  extraKm: number | null;
}

/**
 * Straight-line vs road distance. A detour of more than 5 km (or 40% extra) on a
 * cross-river pair is attributed to the Savannah River crossing.
 */
export function roadNote(o: Overlap): RoadNote {
  if (o.roadKm == null) return { kind: "unknown", text: "Road distance not computed", extraKm: null };
  const extra = Math.max(0, o.roadKm - o.distanceKm);
  const bigDetour = extra > 5 && o.roadKm > o.distanceKm * 1.4;
  if (o.roadVerified === false) {
    return {
      kind: "far",
      text: `Over 40 km by road (${fmtKm(o.roadKm)}): river adds ${fmtKm(extra)}`,
      extraKm: extra,
    };
  }
  if (bigDetour) return { kind: "detour", text: `River adds ${fmtKm(extra)}`, extraKm: extra };
  return { kind: "verified", text: "Drive-verified", extraKm: extra };
}

export function projectLine(p: Project): string {
  const bits = [ACTION_LABEL[p.action], fmtKv(p.voltageKv)];
  if (p.miles != null) bits.push(`${p.miles} mi`);
  return bits.join(" · ");
}

function sourceLine(p: Project): string {
  const page = p.source.page != null ? `, p. ${p.source.page}` : "";
  const url = p.source.url ? ` (${sourceHref(p)})` : "";
  return `${p.source.document}${page}${url}`;
}

export function sourceHref(p: Pick<Project, "source">): string {
  const { url, page } = p.source;
  if (!url) return "";
  return page != null && /\.pdf($|\?)/i.test(url) ? `${url}#page=${page}` : url;
}

/** Plain-text coordination memo assembled from the data (no free text generation). */
export function buildMemo(o: Overlap, desc: Project, gpc: Project, rank: number): string {
  const shared = windowOverlap(desc.buildWindow, gpc.buildWindow);
  const road = roadNote(o);
  const lines: string[] = [];
  lines.push(`COORDINATION MEMO: ${desc.name} / ${gpc.name}`);
  lines.push(`Prepared with MrGridy. Opportunity #${rank} of the current ranking.`);
  lines.push("");
  lines.push("WHAT");
  lines.push(`- Dominion Energy (DESC): ${desc.name} (${projectLine(desc)}), in service ${fmtMonthYear(desc.inService)}.`);
  lines.push(`- Georgia Power: ${gpc.name} (${projectLine(gpc)}), in service ${fmtMonthYear(gpc.inService)}.`);
  lines.push("");
  lines.push("WHY COORDINATE");
  lines.push(`- ${tierFull(o.tier)}. Distance apart ${fmtKm(o.distanceKm)} in a straight line.`);
  if (o.roadKm != null) lines.push(`- Road distance ${fmtKm(o.roadKm)}. ${road.text}.`);
  lines.push(
    shared
      ? `- Build windows overlap ${fmtMonths(o.timelineOverlapMonths)} (${fmtMonthYear(shared[0])} to ${fmtMonthYear(shared[1])}).`
      : "- Build windows do not overlap; sharing means sequencing the work.",
  );
  if (o.robustness === "uncertain") lines.push("- Location confidence is limited for at least one project; confirm routes before committing.");
  lines.push("");
  lines.push("WHAT THEY CAN SHARE");
  for (const s of o.shareable) lines.push(`- ${s}`);
  if (isRightSizingCandidate(desc, gpc) && !o.shareable.some(isRightSizingItem)) {
    lines.push("- Right-sizing review (FERC Order 1920-A)");
  }
  if (o.stagingYard) {
    const y = o.stagingYard;
    lines.push("");
    lines.push("SUGGESTED STAGING YARD");
    lines.push(`- ${y.label} (${y.position[1].toFixed(4)}, ${y.position[0].toFixed(4)})`);
    lines.push(`- Drive: Dominion Energy ${fmtMinutes(y.driveMinutesDesc)}, Georgia Power ${fmtMinutes(y.driveMinutesGpc)}.`);
  }
  if (o.cost) {
    lines.push("");
    lines.push(`ESTIMATED SAVINGS: ${fmtUsd(o.cost.totalUsd)} (order of magnitude)`);
    lines.push(`- Land ${fmtUsd(o.cost.landSavingsUsd)}, mobilization ${fmtUsd(o.cost.mobilizationSavingsUsd)}, yard ${fmtUsd(o.cost.yardSavingsUsd)}.`);
  }
  lines.push("");
  lines.push("SUGGESTED NEXT STEP");
  lines.push(
    o.tier === "crossing"
      ? "- Schedule a joint engineering review of the crossing and align outage windows."
      : o.tier === "row"
        ? "- Compare routes and open a joint right-of-way and permitting conversation."
        : o.tier === "logistics"
          ? "- Agree on a shared laydown yard and combine material deliveries."
          : "- Share crew and equipment schedules for the overlapping months.",
  );
  lines.push("");
  lines.push("SOURCES");
  lines.push(`- ${sourceLine(desc)}`);
  lines.push(`- ${sourceLine(gpc)}`);
  return lines.join("\n");
}

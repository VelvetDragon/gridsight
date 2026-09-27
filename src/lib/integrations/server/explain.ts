/**
 * "Explain this match": a planner-ready summary, memo and talking points for
 * one overlap, written by the Gemini API from the overlap's own data.
 *
 * Without GEMINI_API_KEY (or if the call fails) the same shape is produced by
 * a deterministic template, flagged source: "template".
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isWetlandNoteList,
  pairOpportunities,
  STRENGTH_LABEL,
  type Opportunity,
  type WetlandNote,
} from "@/lib/opportunities";
import { fundingMatches, fundingOpportunity, GRANT_CATALOG, UTILITY_OWNERSHIP, type FundingMatch } from "@/lib/grants";
import { matchSavings, type MatchSavings } from "@/lib/savings";
import type { Overlap, Project } from "@/lib/types";
import type { ExplainMemo, ExplainResult } from "@/lib/integrations/explain";
import { readDataFile, type DataOrigin } from "./dataFiles";
import { geminiJson, geminiKey, geminiModels } from "./gemini";

const PRODUCT = "Mr.Gridy";
const SIGN_OFF = `Prepared with ${PRODUCT} from public filings.`;

const TIER_TEXT: Record<Overlap["tier"], string> = {
  crossing: "the projects touch or cross",
  row: "the projects run within 1.6 km (one mile) of each other, close enough to share right-of-way",
  logistics: "the projects come within 8 km of each other, close enough to share laydown yards and deliveries",
  crew: "the projects come within 40 km of each other, a crew's morning drive",
};
export const TIER_WHY: Record<Overlap["tier"], string> = {
  crossing: "their outages and crossing design have to be planned together",
  row: "they could share right-of-way, access roads and permits",
  logistics: "they could share laydown yards and material deliveries",
  crew: "they are within a crew's morning drive, so they could share crews and equipment",
};
const TIER_LABEL: Record<Overlap["tier"], string> = {
  crossing: "crossing",
  row: "right-of-way",
  logistics: "logistics",
  crew: "crews",
};

/** A utility on one side of the match. */
export interface Party {
  name: string;
  /** Short name used in sentences, e.g. "DESC", "Georgia Power". */
  short: string;
}

export interface MatchData {
  overlap: Overlap;
  /** Your utility's project (map slot "DESC"). */
  desc: Project;
  /** The neighbour's project (map slot "GPC"). */
  gpc: Project;
  /** Estimated saving from published unit costs (lib/savings). */
  saved: MatchSavings | null;
  /** The pair's specific ways to work together (lib/opportunities), strongest first. */
  opportunities: Opportunity[];
  /** Grant programs the pair meets every public requirement of (lib/grants, verified list, by rule). */
  funding: FundingMatch[];
  origin: DataOrigin;
  names: { a: Party; b: Party };
}

export const CORE_NAMES: MatchData["names"] = {
  a: { name: "Dominion Energy South Carolina", short: "DESC" },
  b: { name: "Georgia Power", short: "Georgia Power" },
};

export class UnknownOverlapError extends Error {}

/** A match sent by the browser for any two catalog utilities (the Crosswire slot props). */
export interface MatchInput {
  overlap: Overlap;
  yours: Project;
  theirs: Project;
  you?: { name?: string; shortName?: string } | null;
  neighbor?: { name?: string; shortName?: string } | null;
}

function isProjectLike(v: unknown): v is Project {
  const p = v as Project;
  return !!p && typeof p === "object" && typeof p.id === "string" && typeof p.name === "string" &&
    typeof p.kind === "string" && typeof p.action === "string" && Array.isArray(p.voltageKv) && !!p.source;
}

export function isMatchInput(v: unknown): v is MatchInput {
  const m = v as MatchInput;
  return !!m && typeof m === "object" && !!m.overlap && typeof m.overlap.id === "string" &&
    typeof m.overlap.tier === "string" && typeof m.overlap.distanceKm === "number" &&
    Array.isArray(m.overlap.shareable) && isProjectLike(m.yours) && isProjectLike(m.theirs);
}

function party(u: MatchInput["you"], fallback: Party): Party {
  const name = typeof u?.name === "string" && u.name.trim() ? u.name.trim().slice(0, 80) : fallback.name;
  const short = typeof u?.shortName === "string" && u.shortName.trim() ? u.shortName.trim().slice(0, 40) : name;
  return { name, short };
}

/** Resolve an overlap id (DESC / Georgia Power plan) or a full match sent by the browser. */
export async function resolveMatch(input: string | MatchInput): Promise<MatchData> {
  if (typeof input === "string") return loadMatch(input);
  // A pair the server already knows keeps its pipeline data.
  const known = await loadMatch(input.overlap.id).catch(() => null);
  if (known && known.desc.id === input.yours.id && known.gpc.id === input.theirs.id) return known;
  return {
    overlap: input.overlap,
    desc: input.yours,
    gpc: input.theirs,
    ...withSavings(input.overlap, input.yours, input.theirs, pairOpportunities(input.overlap, input.yours, input.theirs)),
    origin: "pipeline",
    names: { a: party(input.you, { name: "Your utility", short: "your utility" }), b: party(input.neighbor, { name: "The neighbor", short: "the neighbor" }) },
  };
}

/* ---------------------------------------------------------------- data */

export async function loadMatch(overlapId: string): Promise<MatchData> {
  const overlaps = await readDataFile<Overlap[]>("plan/overlaps.json");
  const projects = await readDataFile<Project[]>("plan/projects.json");
  if (!overlaps || !projects || !Array.isArray(overlaps.data) || !Array.isArray(projects.data)) {
    throw new UnknownOverlapError("Plan data is not available");
  }
  const overlap = overlaps.data.find((o) => o.id === overlapId);
  if (!overlap) throw new UnknownOverlapError(`No overlap with id "${overlapId}"`);
  const desc = projects.data.find((p) => p.id === overlap.descId);
  const gpc = projects.data.find((p) => p.id === overlap.gpcId);
  if (!desc || !gpc) throw new UnknownOverlapError(`Projects for overlap "${overlapId}" are missing`);
  const wetlands = await readDataFile<WetlandNote[]>("plan/insights/wetlands.json", { fixtures: false });
  const wetland = isWetlandNoteList(wetlands?.data) ? wetlands.data.find((w) => w.overlapId === overlapId) ?? null : null;
  const opportunities = pairOpportunities(overlap, desc, gpc, wetland);
  const origin: DataOrigin = overlaps.origin === "pipeline" && projects.origin === "pipeline" ? "pipeline" : "sample";
  return { overlap, desc, gpc, ...withSavings(overlap, desc, gpc, opportunities), origin, names: CORE_NAMES };
}

function withSavings(o: Overlap, desc: Project, gpc: Project, base: Opportunity[]) {
  const owned = (p: Project) => ({ ...p, ownership: UTILITY_OWNERSHIP[p.utility === "DESC" ? "desc" : "georgia-power"] ?? null });
  const funding = fundingMatches(owned(desc), owned(gpc), base);
  const joint = fundingOpportunity(funding, GRANT_CATALOG);
  const opportunities = joint ? [...base, joint] : base;
  return { opportunities, funding, saved: matchSavings(o, desc, gpc, opportunities) };
}

/* ---------------------------------------------------------------- formatting */

export function usd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function monthYear(iso: string | null | undefined): string {
  if (!iso) return "date not published";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function list(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export function place(summary: string): string | null {
  const m = /\bnear ([A-Z][A-Za-z .'-]+, (?:GA|SC))/.exec(summary ?? "");
  return m ? m[1] : null;
}

function describe(p: Project): string {
  const kv = p.voltageKv.length ? `${p.voltageKv.join("/")} kV ` : "";
  const what = `${p.action} ${kv}${p.kind}`.trim();
  const miles = p.miles ? `, ${p.miles} mi` : "";
  return `${what}${miles}, in service ${monthYear(p.inService)}`;
}

/** "SAV: Goshen - McIntosh 115 kV: Rebuild" -> "Goshen - McIntosh 115 kV". */
export function shortName(p: Project): string {
  return p.name.replace(/^[A-Z]{2,6}:\s*/, "").split(":")[0].trim() || p.name;
}

function sourceLine(p: Project): string {
  return `${p.source.document}${p.source.page ? `, p. ${p.source.page}` : ""}`;
}

export function distanceText(o: Overlap): string {
  if (o.tier === "crossing" || o.distanceKm <= 0.05) return "They touch or cross";
  const road = o.roadKm != null ? ` (${o.roadKm.toFixed(1)} km by road)` : "";
  return `They come within ${o.distanceKm.toFixed(1)} km of each other${road}`;
}

export function savings(saved: MatchSavings | null): string | null {
  return saved && saved.total > 0 ? `about ${usd(Math.round(saved.total / 1000) * 1000)} (estimated)` : null;
}

/* ---------------------------------------------------------------- template */

export function templateExplanation(m: MatchData): Omit<ExplainResult, "cached" | "generatedAt"> {
  const { overlap: o, desc, gpc, saved } = m;
  const { a, b } = m.names;
  const where = place(o.summary);
  const months = Math.round(o.timelineOverlapMonths);
  const timing =
    months > 0
      ? `Their estimated build windows overlap by about ${months} months (${a.short} ${monthYear(desc.buildWindow?.[0])} to ${monthYear(desc.buildWindow?.[1])}, ${b.short} ${monthYear(gpc.buildWindow?.[0])} to ${monthYear(gpc.buildWindow?.[1])}).`
      : "Their estimated build windows do not overlap, but they sit close enough to plan together.";
  const ops = m.opportunities;
  const ways = ops.length
    ? ops.map((op) => `${op.title} (${STRENGTH_LABEL[op.strength].toLowerCase()}): ${op.reason}`).join("\n")
    : "Nothing specific beyond being close to each other.";
  const nextStep = ops[0]?.nextStep ?? "A short call between the two project leads to compare routes and build dates.";
  const save = savings(saved);
  const hasYard = m.opportunities.some((op) => op.kind === "yard");
  const yard = hasYard && o.stagingYard && o.stagingYard.driveMinutesDesc > 0
    ? `One staging yard at ${o.stagingYard.position[1].toFixed(4)}, ${o.stagingYard.position[0].toFixed(4)} is about ${Math.round(o.stagingYard.driveMinutesDesc)} min from the ${a.short} job and ${Math.round(o.stagingYard.driveMinutesGpc)} min from the ${b.short} job.`
    : null;
  const caveat =
    o.robustness === "uncertain"
      ? "The exact routes are not public, so the distance tier could change once they are."
      : "The match holds across the plausible route positions we tested.";

  const summary =
    o.summary?.trim() ||
    `${a.short}'s ${shortName(desc)} and ${b.short}'s ${shortName(gpc)} ${where ? `meet near ${where}` : "are close"}: ${TIER_TEXT[o.tier]}. ${timing}`;

  const subject = `Coordination opportunity: ${shortName(desc)} and ${shortName(gpc)}${where ? ` near ${where}` : ""}`;
  const to = `Transmission Planning, ${a.name}; Transmission Planning, ${b.name}`;
  const body = [
    "Hello both teams,",
    `${PRODUCT} compared the two utilities' public transmission plans and flagged a ${TIER_LABEL[o.tier]}-tier match${where ? ` near ${where}` : ""} (rank ${o.rank}).`,
    `${a.short}: ${desc.name} (${describe(desc)}). Source: ${sourceLine(desc)}.\n${b.short}: ${gpc.name} (${describe(gpc)}). Source: ${sourceLine(gpc)}.`,
    `Why it matters: ${distanceText(o)}, so ${TIER_WHY[o.tier]}. ${timing}`,
    `Ways to work together:\n${ways}${yard ? `\n${yard}` : ""}`,
    save
      ? `Estimated savings: ${save}, from ${list([saved!.crew > 0 ? "one crew setup not paid twice" : "", saved!.land > 0 ? "land and permits on a shared route" : ""])}. Priced with MISO's published transmission unit costs in 2026 dollars, not utility budgets.`
      : "Estimated savings: nothing this pair could share has a published price.",
    `Caveat: ${caveat}`,
    `Suggested next step: ${nextStep}`,
    SIGN_OFF,
  ].join("\n\n");

  const talkingPoints = [
    `${distanceText(o)}${where ? ` near ${where}` : ""}.`,
    months > 0 ? `Build windows overlap by about ${months} months.` : "Build windows are close but do not overlap.",
    ...(ops.length ? ops.slice(0, 3).map((op) => op.reason) : ["No specific shared work found beyond being close."]),
    save ? `Estimated savings: ${save}.` : null,
    caveat,
  ].filter((x): x is string => Boolean(x));

  return {
    overlapId: o.id,
    source: "template",
    model: null,
    summary,
    memo: { subject, to, body },
    talkingPoints,
    dataOrigin: m.origin,
  };
}

/* ---------------------------------------------------------------- Gemini */

export function facts(m: MatchData) {
  const { overlap: o, desc, gpc } = m;
  const project = (p: Project, who: Party) => ({
    utility: who.name === who.short ? who.name : `${who.name} (${who.short})`,
    name: p.name,
    kind: p.kind,
    action: p.action,
    voltageKv: p.voltageKv,
    miles: p.miles,
    places: p.places,
    description: p.description.slice(0, 600),
    inService: p.inService,
    buildWindow: p.buildWindow,
    status: p.status,
    geometryQuality: p.geometryQuality,
    source: sourceLine(p),
  });
  return {
    overlap: {
      rank: o.rank,
      tier: o.tier,
      tierMeaning: TIER_TEXT[o.tier],
      nearestTown: place(o.summary),
      distanceKm: o.distanceKm,
      roadKm: o.roadKm,
      timelineOverlapMonths: o.timelineOverlapMonths,
      robustness: o.robustness,
      waysToWorkTogether: m.opportunities.map((op) => ({
        title: op.title,
        strength: STRENGTH_LABEL[op.strength],
        reason: op.reason,
        nextStep: op.nextStep,
      })),
      stagingYard: m.opportunities.some((op) => op.kind === "yard") ? o.stagingYard : null,
      estimatedSavingsUsd: m.saved && m.saved.total > 0 ? Math.round(m.saved.total) : null,
      howSavingsWereEstimated: m.saved?.lines ?? [],
      notPriced: m.saved?.unpriced ?? [],
      grantPrograms: m.funding.map((f) => {
        const g = GRANT_CATALOG.find((x) => x.id === f.grantId);
        return {
          program: g?.name ?? f.grantId,
          fit: f.fit === "joint" ? "one joint application for both projects" : "each utility could apply for its own project",
          projectsThatMeetEveryPublicRequirement: f.checks.filter((c) => c.verdict === "fits").map((c) => c.projectId),
          utilityMustStillConfirm: [
            ...new Set(f.checks.flatMap((c) => c.results.filter((r) => r.status === "confirm").map((r) => r.text))),
          ],
          roundOpenNow: g?.open ?? null,
          latestRound: g?.status ?? null,
        };
      }),
      existingSummary: o.summary,
    },
    utilityA: project(desc, m.names.a),
    utilityB: project(gpc, m.names.b),
  };
}

const systemPrompt = (names: MatchData["names"]) => `You write short, factual coordination notes for electric transmission planners.
Audience: the transmission planning teams at ${names.a.name} and ${names.b.name}.
Rules:
- Use only the facts in the JSON you are given. Never invent numbers, dates, names, costs or commitments.
- Round numbers the way a planner would say them. Use km for distance.
- Be plain and calm. No hype, no emojis, no markdown headings or bullet symbols in the memo body.
- What the two teams could do together comes only from overlap.waysToWorkTogether, strongest first. Name each one plainly.
  If that list is empty, say nothing specific links them beyond being close; do not suggest sharing anything.
- Suggest the first item's nextStep as the next step when there is one.
- If the routes are uncertain (robustness "uncertain"), say so once.
- Savings are planning-level estimates from public unit costs, not utility budgets; say that if you cite them.
- If overlap.grantPrograms is not empty, you may name those programs in one sentence. Grants are competitive: never
  promise an award or give an amount, say if no round is open (roundOpenNow false), and note that the utility must
  still confirm the items in utilityMustStillConfirm.
- The memo body is 150 to 250 words, addressed to both teams, and ends with the exact line: "${SIGN_OFF}"`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", description: "Two or three plain-language sentences for a non-expert." },
    memo: {
      type: "OBJECT",
      properties: {
        subject: { type: "STRING" },
        to: { type: "STRING" },
        body: { type: "STRING" },
      },
      required: ["subject", "to", "body"],
    },
    talkingPoints: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Three to five points, each under 20 words.",
    },
  },
  required: ["summary", "memo", "talkingPoints"],
};

interface GeminiOut {
  summary: string;
  memo: ExplainMemo;
  talkingPoints: string[];
}

function isGeminiOut(v: unknown): v is GeminiOut {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const memo = o.memo as Record<string, unknown> | undefined;
  return (
    typeof o.summary === "string" &&
    o.summary.length > 0 &&
    !!memo &&
    typeof memo.subject === "string" &&
    typeof memo.to === "string" &&
    typeof memo.body === "string" &&
    Array.isArray(o.talkingPoints) &&
    o.talkingPoints.every((t) => typeof t === "string")
  );
}

function tidy(out: GeminiOut): GeminiOut {
  let body = out.memo.body.trim();
  if (!body.includes(SIGN_OFF)) body = `${body}\n\n${SIGN_OFF}`;
  return {
    summary: out.summary.trim(),
    memo: { subject: out.memo.subject.trim(), to: out.memo.to.trim(), body },
    talkingPoints: out.talkingPoints.map((t) => t.trim()).filter(Boolean).slice(0, 6),
  };
}

/* ---------------------------------------------------------------- cache */

const memoryCache = new Map<string, ExplainResult>();
const CACHE_DIR = path.join(os.tmpdir(), "mrgridy-explain");

async function diskGet(key: string): Promise<ExplainResult | null> {
  try {
    return JSON.parse(await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8")) as ExplainResult;
  } catch {
    return null;
  }
}

async function diskPut(key: string, value: ExplainResult) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
  } catch {
    /* read-only filesystem: memory cache only */
  }
}

/* ---------------------------------------------------------------- entry */

export async function explainOverlap(input: string | MatchInput): Promise<ExplainResult> {
  const match = await resolveMatch(input);
  const overlapId = match.overlap.id;
  const template = templateExplanation(match);
  if (!geminiKey()) {
    return { ...template, generatedAt: new Date().toISOString(), cached: false };
  }

  const f = facts(match);
  const key = createHash("sha1").update(JSON.stringify({ f, models: geminiModels(), v: 5 })).digest("hex");
  const hit = memoryCache.get(key) ?? (await diskGet(key));
  if (hit) {
    memoryCache.set(key, hit);
    return { ...hit, cached: true };
  }

  const prompt = `Explain this coordination match between two neighbouring utilities' planned transmission projects.
Return JSON with: summary (2-3 sentences), memo {subject, to, body}, talkingPoints (3-5).
Address the memo "to" both utilities' transmission planning teams.

FACTS:
${JSON.stringify(f, null, 1)}`;

  try {
    const { data, model } = await geminiJson(
      { parts: [{ text: prompt }], system: systemPrompt(match.names), schema: RESPONSE_SCHEMA, timeoutMs: 25_000 },
      isGeminiOut,
    );
    const result: ExplainResult = {
      overlapId,
      source: "gemini",
      model,
      ...tidy(data),
      generatedAt: new Date().toISOString(),
      cached: false,
      dataOrigin: match.origin,
    };
    memoryCache.set(key, result);
    await diskPut(key, result);
    return result;
  } catch (err) {
    console.warn(`[explain] Gemini unavailable, using the template: ${(err as Error).message}`);
    return { ...template, generatedAt: new Date().toISOString(), cached: false };
  }
}

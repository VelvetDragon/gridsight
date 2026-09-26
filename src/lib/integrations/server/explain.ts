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
import type { Overlap, Project } from "@/lib/types";
import type { ExplainMemo, ExplainResult } from "@/lib/integrations/explain";
import { readDataFile, serverEnv, type DataOrigin } from "./dataFiles";

const PRODUCT = "MrGridy";
const SIGN_OFF = `Prepared with ${PRODUCT} from public filings.`;
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** Current Flash models (ai.google.dev/gemini-api/docs/models); override with GEMINI_MODEL. */
const DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];
const TIMEOUT_MS = 25_000;

const TIER_TEXT: Record<Overlap["tier"], string> = {
  crossing: "the projects touch or cross",
  row: "the projects run within 1.6 km (one mile) of each other, close enough to share right-of-way",
  logistics: "the projects come within 8 km of each other, close enough to share laydown yards and deliveries",
  crew: "the projects come within 40 km of each other, a crew's morning drive",
};
const TIER_LABEL: Record<Overlap["tier"], string> = {
  crossing: "crossing",
  row: "right-of-way",
  logistics: "logistics",
  crew: "crews",
};

interface CostRange {
  overlapId: string;
  lowUsd: number;
  centralUsd: number;
  highUsd: number;
}

interface MatchData {
  overlap: Overlap;
  desc: Project;
  gpc: Project;
  range: CostRange | null;
  origin: DataOrigin;
}

export class UnknownOverlapError extends Error {}

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
  const ranges = await readDataFile<CostRange[]>("plan/insights/cost-ranges.json", { fixtures: false });
  const range = Array.isArray(ranges?.data) ? ranges.data.find((r) => r.overlapId === overlapId) ?? null : null;
  const origin: DataOrigin = overlaps.origin === "pipeline" && projects.origin === "pipeline" ? "pipeline" : "sample";
  return { overlap, desc, gpc, range, origin };
}

/* ---------------------------------------------------------------- formatting */

function usd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function monthYear(iso: string | null | undefined): string {
  if (!iso) return "date not published";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function list(items: string[]): string {
  const xs = items.filter(Boolean);
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

function place(summary: string): string | null {
  const m = /\bnear ([A-Z][A-Za-z .'-]+, (?:GA|SC))/.exec(summary ?? "");
  return m ? m[1] : null;
}

function describe(p: Project): string {
  const kv = p.voltageKv.length ? `${p.voltageKv.join("/")} kV ` : "";
  const what = `${p.action} ${kv}${p.kind}`.trim();
  const miles = p.miles ? `, ${p.miles} mi` : "";
  return `${what}${miles}, in service ${monthYear(p.inService)}`;
}

function sourceLine(p: Project): string {
  return `${p.source.document}${p.source.page ? `, p. ${p.source.page}` : ""}`;
}

function distanceText(o: Overlap): string {
  if (o.tier === "crossing" || o.distanceKm <= 0.05) return "They touch or cross";
  const road = o.roadKm != null ? ` (${o.roadKm.toFixed(1)} km by road)` : "";
  return `They come within ${o.distanceKm.toFixed(1)} km of each other${road}`;
}

function savings(o: Overlap, range: CostRange | null): string | null {
  const central = range?.centralUsd ?? o.cost?.totalUsd ?? 0;
  if (!central) return null;
  const spread = range && range.highUsd > range.lowUsd ? ` (range ${usd(range.lowUsd)} to ${usd(range.highUsd)})` : "";
  return `${usd(central)} central estimate${spread}`;
}

/* ---------------------------------------------------------------- template */

export function templateExplanation(m: MatchData): Omit<ExplainResult, "cached" | "generatedAt"> {
  const { overlap: o, desc, gpc, range } = m;
  const where = place(o.summary);
  const months = Math.round(o.timelineOverlapMonths);
  const timing =
    months > 0
      ? `Their estimated build windows overlap by about ${months} months (DESC ${monthYear(desc.buildWindow?.[0])} to ${monthYear(desc.buildWindow?.[1])}, Georgia Power ${monthYear(gpc.buildWindow?.[0])} to ${monthYear(gpc.buildWindow?.[1])}).`
      : "Their estimated build windows do not overlap, but they sit close enough to plan together.";
  const share = o.shareable.length ? list(o.shareable) : "crews and equipment";
  const save = savings(o, range);
  const yard = o.stagingYard
    ? `One staging yard at ${o.stagingYard.position[1].toFixed(4)}, ${o.stagingYard.position[0].toFixed(4)} is about ${Math.round(o.stagingYard.driveMinutesDesc)} min from the DESC job and ${Math.round(o.stagingYard.driveMinutesGpc)} min from the Georgia Power job.`
    : null;
  const caveat =
    o.robustness === "uncertain"
      ? "The exact routes are not public, so the distance tier could change once they are."
      : "The match holds across the plausible route positions we tested.";

  const summary =
    o.summary?.trim() ||
    `DESC's ${desc.name} and Georgia Power's ${gpc.name} ${where ? `meet near ${where}` : "are close"}: ${TIER_TEXT[o.tier]}. ${timing}`;

  const subject = `Coordination opportunity: ${desc.name} and ${gpc.name}${where ? ` near ${where}` : ""}`;
  const to = "Transmission Planning, Dominion Energy South Carolina; Transmission Planning, Georgia Power";
  const body = [
    "Hello both teams,",
    `${PRODUCT} compared the two utilities' public transmission plans and flagged a ${TIER_LABEL[o.tier]}-tier match${where ? ` near ${where}` : ""} (rank ${o.rank}).`,
    `DESC: ${desc.name} (${describe(desc)}). Source: ${sourceLine(desc)}.\nGeorgia Power: ${gpc.name} (${describe(gpc)}). Source: ${sourceLine(gpc)}.`,
    `Why it matters: ${distanceText(o)}, so ${TIER_TEXT[o.tier].replace(/^the projects /, "they ")}. ${timing}`,
    `What we could share: ${share}.${yard ? ` ${yard}` : ""}`,
    save
      ? `Rough savings: ${save}, from shared mobilization, yards and land. These are planning-level figures from public unit costs, not utility budgets.`
      : "Rough savings: not estimated for this pair.",
    `Caveat: ${caveat}`,
    "Suggested next step: a 30-minute call between the two project leads to compare routes, outage windows and yard needs.",
    SIGN_OFF,
  ].join("\n\n");

  const talkingPoints = [
    `${distanceText(o)}${where ? ` near ${where}` : ""}.`,
    months > 0 ? `Build windows overlap by about ${months} months.` : "Build windows are close but do not overlap.",
    `Shareable: ${share}.`,
    save ? `Rough savings: ${save}.` : null,
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

function facts(m: MatchData) {
  const { overlap: o, desc, gpc, range } = m;
  const project = (p: Project) => ({
    utility: p.utility === "DESC" ? "Dominion Energy South Carolina (DESC)" : "Georgia Power",
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
      shareable: o.shareable,
      stagingYard: o.stagingYard,
      savingsUsd: range
        ? { low: range.lowUsd, central: range.centralUsd, high: range.highUsd }
        : o.cost
          ? { central: o.cost.totalUsd }
          : null,
      costAssumptions: o.cost?.assumptions?.slice(0, 4) ?? [],
      existingSummary: o.summary,
    },
    desc: project(desc),
    georgiaPower: project(gpc),
  };
}

const SYSTEM_PROMPT = `You write short, factual coordination notes for electric transmission planners.
Audience: the transmission planning teams at Dominion Energy South Carolina (DESC) and Georgia Power.
Rules:
- Use only the facts in the JSON you are given. Never invent numbers, dates, names, costs or commitments.
- Round numbers the way a planner would say them. Use km for distance.
- Be plain and calm. No hype, no emojis, no markdown headings or bullet symbols in the memo body.
- If the routes are uncertain (robustness "uncertain"), say so once.
- Savings are planning-level estimates from public unit costs, not utility budgets; say that if you cite them.
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

async function callGemini(model: string, apiKey: string, prompt: string): Promise<GeminiOut> {
  const res = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new GeminiHttpError(res.status, detail);
  }
  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  const parsed: unknown = JSON.parse(text);
  if (!isGeminiOut(parsed)) throw new Error("Gemini returned an unexpected shape");
  return parsed;
}

class GeminiHttpError extends Error {
  constructor(
    public status: number,
    detail: string,
  ) {
    super(`Gemini responded ${status}: ${detail}`);
  }
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

export async function explainOverlap(overlapId: string): Promise<ExplainResult> {
  const match = await loadMatch(overlapId);
  const apiKey = serverEnv("GEMINI_API_KEY");
  const template = templateExplanation(match);
  if (!apiKey) {
    return { ...template, generatedAt: new Date().toISOString(), cached: false };
  }

  const models = [serverEnv("GEMINI_MODEL"), ...DEFAULT_MODELS].filter(
    (m, i, all): m is string => Boolean(m) && all.indexOf(m) === i,
  );
  const f = facts(match);
  const key = createHash("sha1").update(JSON.stringify({ f, models, v: 1 })).digest("hex");
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

  for (const model of models) {
    try {
      const out = tidy(await callGemini(model, apiKey, prompt));
      const result: ExplainResult = {
        overlapId,
        source: "gemini",
        model,
        ...out,
        generatedAt: new Date().toISOString(),
        cached: false,
        dataOrigin: match.origin,
      };
      memoryCache.set(key, result);
      await diskPut(key, result);
      return result;
    } catch (err) {
      const status = err instanceof GeminiHttpError ? err.status : 0;
      // Bad key or quota: no point trying another model.
      if (status === 401 || status === 403 || status === 429) break;
      console.warn(`[explain] ${model} failed: ${(err as Error).message}`);
    }
  }
  return { ...template, generatedAt: new Date().toISOString(), cached: false };
}

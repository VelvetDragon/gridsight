/**
 * Gemini utility finder: name -> public transmission plan -> projects on the map.
 *
 * 1. Find the document: Gemini with Grounding with Google Search looks for the
 *    utility's latest public transmission plan PDF (falls back to Gemini's own
 *    knowledge, verified by download). A PDF link can also be supplied.
 * 2. Download it server-side (https only, public hosts only, size-capped) and
 *    refuse anything marked CEII.
 * 3. Gemini reads the PDF (document understanding + JSON schema) and returns
 *    the projects in CatalogProject shape.
 * 4. Place names are geocoded (OSM Nominatim) into points or straight lines.
 * Results are cached on disk and, when Tiger Data is configured, stored there.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { CatalogProject, CatalogUtility, Position, ProjectAction, ProjectKind } from "@/lib/types";
import type { FinderEvent } from "@/lib/integrations/finder";
import { gemini, GeminiHttpError, geminiJson, geminiKey, stripFence } from "./gemini";
import { geocode, stateCode, type Geocoded } from "./geocode";
import { saveCatalogToTiger } from "./tiger";

const MAX_PDF_BYTES = 20 * 1024 * 1024; // inline PDF request limit
const MAX_PROJECTS = 60;
const MAX_GEOCODES = 45;
const CACHE_DIR = path.join(os.tmpdir(), "mrgridy-finder-v2");
const COLORS = ["#6D28D9", "#1D4ED8", "#B45309", "#047857", "#BE185D", "#4D7C0F", "#0369A1", "#9D174D"];
const UA = "Mozilla/5.0 (compatible; MrGridy/0.1; ShellHacks 2026)";

export class FinderError extends Error {
  constructor(
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
}

type Emit = (e: FinderEvent) => void;

export function slugify(name: string): string {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function colorFor(slug: string): string {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/* ---------------------------------------------------------------- 1. find */

interface Candidate {
  url: string;
  title: string;
  publisher?: string;
  year?: number;
  ceii?: boolean;
}

const SEARCH_PROMPT = (name: string) => `Find the most recent PUBLIC transmission plan document for the electric utility "${name}":
a PDF that lists its planned transmission projects (for example a regional transmission plan, a local transmission
plan, a 10-year expansion plan or an integrated resource plan appendix with a project list).
Only public documents: never anything marked CEII (Critical Energy/Electric Infrastructure Information) unless it
is explicitly the "Non-CEII" public version. Prefer a direct link ending in .pdf.
Reply with JSON only, no prose:
{"candidates":[{"url":"https://...pdf","title":"...","publisher":"...","year":2026,"ceii":false}],
 "utility":{"name":"official name","shortName":"short name","parent":"parent company or null","states":["two-letter codes"]}}`;

interface SearchOut {
  candidates: Candidate[];
  utility?: { name?: string; shortName?: string; parent?: string | null; states?: string[] };
}

function parseSearch(text: string): SearchOut | null {
  try {
    const v = JSON.parse(stripFence(text)) as SearchOut;
    if (!v || !Array.isArray(v.candidates)) return null;
    v.candidates = v.candidates.filter((c) => c && typeof c.url === "string" && /^https?:\/\//.test(c.url));
    return v;
  } catch {
    const urls = [...text.matchAll(/https?:\/\/[^\s"')\]]+\.pdf/gi)].map((m) => m[0]);
    return urls.length ? { candidates: urls.map((url) => ({ url, title: url.split("/").pop() ?? url })) } : null;
  }
}

async function findDocument(name: string, emit: Emit): Promise<{ out: SearchOut; via: "search" | "knowledge" }> {
  emit({ type: "status", step: "search", message: `Searching the web for ${name}'s public transmission plan…` });
  try {
    const reply = await gemini({ parts: [{ text: SEARCH_PROMPT(name) }], tools: [{ google_search: {} }], timeoutMs: 45_000 });
    const out = parseSearch(reply.text);
    // Grounding sources are also candidates (their links redirect to the real page).
    for (const c of reply.grounding.chunks) {
      if (/\.pdf\b/i.test(c.title) || /\.pdf\b/i.test(c.uri)) (out?.candidates ?? []).push({ url: c.uri, title: c.title });
    }
    if (out?.candidates.length) return { out, via: "search" };
  } catch (err) {
    const why =
      err instanceof GeminiHttpError
        ? err.status === 429
          ? "quota reached for this key"
          : `HTTP ${err.status}`
        : "no answer";
    emit({
      type: "status",
      step: "search",
      message: `Web search grounding is unavailable (${why}); asking Gemini directly.`,
    });
  }
  const reply = await gemini({ parts: [{ text: SEARCH_PROMPT(name) }], timeoutMs: 30_000 });
  const out = parseSearch(reply.text);
  if (!out?.candidates.length) {
    throw new FinderError(`Gemini could not name a public plan for ${name}.`, "Paste a link to the PDF and try again.");
  }
  return { out, via: "knowledge" };
}

/* ---------------------------------------------------------------- 2. download */

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FinderError("That is not a valid link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FinderError("Only http(s) links can be read.");
  if (url.username || url.password) throw new FinderError("Links with credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FinderError("Only public web addresses can be read.");
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new FinderError("Only public web addresses can be read.");
  return url;
}

function fileTitle(url: string): string {
  const last = url.split(/[?#]/)[0].split("/").pop() || url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function markedCeii(text: string): boolean {
  return /\bCEII\b/i.test(text) && !/non[-\s_]?CEII|CEII[-\s_]?(redacted|removed)|public version/i.test(text);
}

async function downloadPdf(raw: string): Promise<{ bytes: Buffer; finalUrl: string }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(45_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok || !res.body) throw new FinderError(`The document link answered ${res.status}.`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_PDF_BYTES) throw new FinderError("The document is larger than 20 MB.");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new FinderError("The document is larger than 20 MB.");
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new FinderError("The link is not a PDF.");
    return { bytes, finalUrl: url.toString() };
  }
  throw new FinderError("Too many redirects.");
}

/* ---------------------------------------------------------------- 3. extract */

const EXTRACT_SYSTEM = `You extract planned electric transmission projects from a utility's public planning document.
Use only what the document says. Never guess costs, dates or places that are not written in it.
kind: "line" for a transmission line; "substation" for a substation, switching station, plant or other site.
action: "new" = construct something new; "rebuild" = rebuild, reconductor or replace along the same path;
"upgrade" = equipment only (transformers, breakers, reactors, capacitors, terminal equipment).
places: the endpoint or site names as written (two names for a line between two substations, one for a site).
inService: YYYY-MM-DD, YYYY-MM or YYYY as written; null if not stated. costUsd: dollars as a number; null if not stated.
page: the 1-based PDF page where the project is listed. state: two-letter code of the project, if known.
Report ceiiMarked = true only if the document itself is marked CEII and is not a public / non-CEII version.`;

const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    ceiiMarked: { type: "BOOLEAN" },
    document: {
      type: "OBJECT",
      properties: { title: { type: "STRING" }, year: { type: "INTEGER", nullable: true } },
      required: ["title"],
    },
    utility: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        shortName: { type: "STRING" },
        parent: { type: "STRING", nullable: true },
        states: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["name", "shortName", "states"],
    },
    projects: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          kind: { type: "STRING", enum: ["line", "substation"] },
          action: { type: "STRING", enum: ["new", "rebuild", "upgrade"] },
          description: { type: "STRING" },
          voltageKv: { type: "ARRAY", items: { type: "NUMBER" } },
          miles: { type: "NUMBER", nullable: true },
          places: { type: "ARRAY", items: { type: "STRING" } },
          inService: { type: "STRING", nullable: true },
          costUsd: { type: "NUMBER", nullable: true },
          status: { type: "STRING", nullable: true },
          state: { type: "STRING", nullable: true },
          page: { type: "INTEGER", nullable: true },
        },
        required: ["name", "kind", "action", "places"],
      },
    },
  },
  required: ["ceiiMarked", "document", "utility", "projects"],
};

interface Extracted {
  ceiiMarked: boolean;
  document: { title: string; year?: number | null };
  utility: { name: string; shortName: string; parent?: string | null; states: string[] };
  projects: {
    name: string;
    kind: ProjectKind;
    action: ProjectAction;
    description?: string;
    voltageKv?: number[];
    miles?: number | null;
    places: string[];
    inService?: string | null;
    costUsd?: number | null;
    status?: string | null;
    state?: string | null;
    page?: number | null;
  }[];
}

function isExtracted(v: unknown): v is Extracted {
  const o = v as Extracted;
  return !!o && typeof o === "object" && Array.isArray(o.projects) && !!o.utility && typeof o.utility.name === "string";
}

function isoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(s.trim());
  if (!m) return null;
  // A year alone is read as the end of that year; a month alone as its first day.
  return `${m[1]}-${m[2] ?? "12"}-${m[3] ?? "01"}`;
}

function minusYear(iso: string): string {
  return `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
}

/* ---------------------------------------------------------------- entry */

/** A cached entry, or null. Entries without projects (older failed runs) count as a miss. */
async function cacheGet(key: string) {
  try {
    const v = JSON.parse(await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8")) as {
      utility: CatalogUtility;
      projects: CatalogProject[];
    };
    return Array.isArray(v?.projects) && v.projects.length ? v : null;
  } catch {
    return null;
  }
}

async function cachePut(key: string, value: { utility: CatalogUtility; projects: CatalogProject[] }) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value));
  } catch {
    /* read-only filesystem */
  }
}

/**
 * Public, non-CEII plan documents for utilities we already know where to find.
 * Used when no link is given, so a name alone works even without web search.
 * The SERTP report groups projects by balancing authority area, not by owner,
 * so each entry names the section (and states) the utility's projects are in.
 */
const SERTP_2026 =
  "https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_Preliminary_Expansion_Plan_Report_(Non-CEII).pdf";
interface KnownPlan {
  test: RegExp;
  url: string;
  section: string;
  states: string[];
}
const KNOWN_PLANS: KnownPlan[] = [
  { test: /mississippi power/i, url: SERTP_2026, section: "SOUTHERN Balancing Authority Area", states: ["MS"] },
  { test: /alabama power/i, url: SERTP_2026, section: "SOUTHERN Balancing Authority Area", states: ["AL"] },
  { test: /powersouth/i, url: SERTP_2026, section: "SOUTHERN Balancing Authority Area", states: ["AL", "FL"] },
  { test: /georgia power|georgia transmission|\bgtc\b|\bmeag\b/i, url: SERTP_2026, section: "SOUTHERN Balancing Authority Area", states: ["GA"] },
  { test: /southern company|\bsoco\b/i, url: SERTP_2026, section: "SOUTHERN Balancing Authority Area", states: ["AL", "GA", "MS"] },
  { test: /duke (energy )?progress|progress energy/i, url: SERTP_2026, section: "DUKE PROGRESS EAST and DUKE PROGRESS WEST Balancing Authority Areas", states: ["NC", "SC"] },
  { test: /duke (energy )?carolinas|^duke( energy)?$/i, url: SERTP_2026, section: "DUKE CAROLINAS Balancing Authority Area", states: ["NC", "SC"] },
  { test: /tennessee valley|\btva\b/i, url: SERTP_2026, section: "TVA Balancing Authority Area", states: ["TN", "AL", "MS", "KY", "GA", "NC", "VA"] },
  { test: /lg&e|louisville gas|kentucky utilities/i, url: SERTP_2026, section: "KU Balancing Authority Area", states: ["KY", "VA"] },
  { test: /associated electric|\baeci\b/i, url: SERTP_2026, section: "AECI Balancing Authority Area", states: ["MO", "OK", "IA"] },
];

function knownPlan(name: string): KnownPlan | null {
  return KNOWN_PLANS.find((k) => k.test.test(name)) ?? null;
}

export async function findUtilityPlan(input: { name: string; url?: string | null }, emit: Emit): Promise<void> {
  const name = input.name.trim();
  if (!geminiKey()) {
    throw new FinderError("The utility finder needs GEMINI_API_KEY on the server.");
  }
  const slug = slugify(name);
  const cacheKey = input.url ? `${slug}--${slugify(input.url).slice(-40)}` : slug;
  const hit = await cacheGet(cacheKey);
  if (hit) {
    emit({ type: "document", source: { ...hit.utility.planSources[0], title: hit.utility.planSources[0]?.document ?? "" }, via: "cache" });
    emit({ type: "status", step: "done", message: `${hit.projects.length} projects (cached).`, progress: 1 });
    emit({ type: "result", utility: hit.utility, projects: hit.projects, cached: true });
    return;
  }

  // 1-2. Find and download.
  let candidates: Candidate[];
  let via: "search" | "knowledge" | "provided";
  let hinted: SearchOut["utility"];
  const known = input.url ? null : knownPlan(name);
  if (input.url || known) {
    const url = input.url ?? known!.url;
    candidates = [{ url, title: fileTitle(url) }];
    via = "provided";
  } else {
    const found = await findDocument(name, emit);
    candidates = found.out.candidates;
    hinted = found.out.utility;
    via = found.via;
  }
  let pdf: { bytes: Buffer; finalUrl: string } | null = null;
  let chosen: Candidate | null = null;
  const problems: string[] = [];
  for (const c of candidates.slice(0, 5)) {
    if (c.ceii || markedCeii(`${c.title} ${c.url}`)) {
      problems.push(`skipped a CEII document (${c.title})`);
      continue;
    }
    emit({ type: "status", step: "download", message: `Downloading ${c.title || c.url}…` });
    try {
      pdf = await downloadPdf(c.url);
      chosen = c;
      break;
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  if (!pdf || !chosen) {
    throw new FinderError(
      `Could not download a public plan for ${name}${problems.length ? ` (${problems.slice(0, 2).join("; ")})` : ""}.`,
      "Paste a link to the PDF and try again.",
    );
  }
  emit({
    type: "document",
    source: { document: chosen.title, title: chosen.title, url: pdf.finalUrl, page: null },
    via,
  });

  // 3. Read it.
  const mb = (pdf.bytes.length / 1024 / 1024).toFixed(1);
  emit({ type: "status", step: "read", message: `Gemini is reading the ${mb} MB document…`, progress: 0.35 });
  // The extraction is cached by document hash and utility name, so re-runs skip Gemini.
  const extractKey = `extract-${createHash("sha1").update(pdf.bytes).update(slug).digest("hex")}`;
  const scope = known
    ? ` The document groups projects by balancing authority area, not by owner: use the ${known.section} section` +
      ` and include only projects located in ${known.states.join(", ")} (judge from the place names).` +
      " This is the public Non-CEII version; a \"(CEII)\" page template header does not make it CEII."
    : "";
  let data = (await cacheGet(extractKey)) as unknown as Extracted | null;
  if (!data || !isExtracted(data) || !data.projects.length) {
    data = (
      await geminiJson(
        {
          parts: [
            { inline_data: { mime_type: "application/pdf", data: pdf.bytes.toString("base64") } },
            {
              text: `Extract up to ${MAX_PROJECTS} planned transmission projects that belong to "${name}" from this document.${scope}`,
            },
          ],
          system: EXTRACT_SYSTEM,
          schema: EXTRACT_SCHEMA,
          temperature: 0,
          timeoutMs: 180_000,
        },
        isExtracted,
      )
    ).data;
    // An empty extraction is not cached, so the next try asks Gemini again.
    if (data.projects.length) await cachePut(extractKey, data as never);
  }
  if (data.ceiiMarked && !/non[-\s_]?CEII/i.test(`${data.document.title} ${chosen.title} ${pdf.finalUrl}`)) {
    throw new FinderError("That document is marked CEII, so MrGridy will not use it.", "Look for the public (non-CEII) version.");
  }
  const rows = data.projects.slice(0, MAX_PROJECTS);
  if (!rows.length) {
    throw new FinderError(`No planned projects for ${name} were found in ${chosen.title || "the document"}.`, "Paste a link to the utility's own plan PDF and try again.");
  }
  emit({ type: "status", step: "extract", message: `${rows.length} projects extracted.`, progress: 0.6 });

  // 4. Place them (each place is looked up inside the project's own state).
  const states = [
    ...new Set(
      [...(known?.states ?? []), ...(data.utility.states ?? []), ...(hinted?.states ?? [])].map((x) => stateCode(x)).filter((x): x is string => Boolean(x)),
    ),
  ];
  const projectStates = (r: Extracted["projects"][number]) => {
    const own = stateCode(r.state);
    return own ? [own] : states;
  };
  const keyOf = (place: string, sts: string[]) => `${place}|${sts.join(",")}`;
  const jobs = new Map<string, { place: string; states: string[] }>();
  for (const r of rows) {
    for (const place of r.places.slice(0, 2)) {
      if (place && jobs.size < MAX_GEOCODES) jobs.set(keyOf(place, projectStates(r)), { place, states: projectStates(r) });
    }
  }
  const where = new Map<string, Geocoded | null>();
  let done = 0;
  for (const [key, job] of jobs) {
    where.set(key, job.states.length ? await geocode(job.place, job.states) : null);
    done++;
    if (done % 5 === 0 || done === jobs.size) {
      emit({
        type: "status",
        step: "geocode",
        message: `Placing on the map: ${done} of ${jobs.size} places`,
        progress: 0.6 + (0.35 * done) / jobs.size,
      });
    }
  }

  const id = slug;
  const docTitle = data.document.title || chosen.title;
  const projects: CatalogProject[] = [];
  rows.forEach((r, i) => {
    const sts = projectStates(r);
    const hits = r.places
      .slice(0, 2)
      .map((p) => where.get(keyOf(p, sts)))
      .filter((h): h is Geocoded => Boolean(h));
    const pts: Position[] = hits.map((h) => h.position);
    if (!pts.length) return;
    const line = r.kind === "line" && pts.length === 2;
    const inService = isoDate(r.inService);
    projects.push({
      id: `${id}-g${String(i + 1).padStart(2, "0")}`,
      utility: id,
      owner: data.utility.shortName || name,
      name: r.name,
      kind: r.kind,
      action: r.action,
      description: (r.description ?? "").slice(0, 600),
      voltageKv: (r.voltageKv ?? []).filter((v) => Number.isFinite(v) && v > 0),
      miles: r.miles ?? null,
      places: r.places,
      inService,
      buildWindow: inService ? [minusYear(inService), inService] : null,
      costUsd: r.costUsd ?? null,
      status: r.status ?? null,
      // The contract types state as the original two states; other utilities carry their own code.
      state: (hits[0]?.state ?? sts[0] ?? "") as CatalogProject["state"],
      geometry: line ? { type: "LineString", coordinates: pts } : { type: "Point", coordinates: pts[0] },
      geometryQuality: line ? "straight" : "point",
      locationConfidence: line ? 0.4 : 0.3,
      source: { document: docTitle, url: pdf!.finalUrl, page: r.page ?? null },
    });
  });

  const utility: CatalogUtility = {
    id,
    name: data.utility.name || name,
    shortName: data.utility.shortName || hinted?.shortName || name,
    parent: data.utility.parent ?? hinted?.parent ?? null,
    states,
    color: colorFor(id),
    planSources: [{ document: docTitle, url: pdf.finalUrl, page: null }],
    projectCount: rows.length,
    locatedCount: projects.length,
    origin: "gemini",
    neighbors: [],
  };
  if (!projects.length) {
    throw new FinderError(`${rows.length} projects were found for ${name}, but none of their places could be put on the map.`);
  }
  await cachePut(cacheKey, { utility, projects });
  void saveCatalogToTiger(utility, projects);
  emit({
    type: "status",
    step: "done",
    message: `${projects.length} of ${rows.length} projects placed on the map.`,
    progress: 1,
  });
  emit({ type: "result", utility, projects, cached: false });
}

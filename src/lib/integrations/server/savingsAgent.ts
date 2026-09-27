/**
 * The savings agent's server steps (see lib/integrations/savingsAgent.ts).
 *
 * grants  1. Re-checks each GRANT_CATALOG page is live.
 *         2. Searches Grants.gov (public API, no key) for open and forecast
 *            listings, keeps the energy and utility ones, and reads each one.
 *         3. With Grounding with Google Search (when the key has quota), looks
 *            for more programs on .gov pages and reads those pages.
 *         Gemini turns each listing into requirements from a fixed vocabulary;
 *         a requirement is kept only when its quote is really in the listing.
 *         A program with no verified applicant or work requirement is listed
 *         as found but fits nothing. Cached for a day (an hour when a search
 *         could not run).
 * rules   lib/grants.ts, the same checklist the browser and the memo use.
 * verify  For every project the rules leave in play, Gemini re-reads the
 *         filing against the work each program funds. "Met" needs a quote the
 *         server finds in the filing; "not met" and "unclear" need a reason.
 * notes   One Gemini call for the pairs that fit (at most MAX_NOTES), JSON
 *         schema, facts only; a template otherwise.
 */
import { createHash } from "node:crypto";
import {
  checkKey,
  filingText,
  GRANT_CATALOG,
  isMatch,
  isOwnership,
  ruleResult,
  screenPair,
  AHEAD_MONTHS,
  type CheckOverrides,
  type FundingMatch,
  type GrantProgram,
  type Ownership,
  type Requirement,
  type ReqResult,
} from "@/lib/grants";
import type { AgentEvent, AgentPair, AgentProject, AgentRequest, GrantSources } from "@/lib/integrations/savingsAgent";
import { gemini, GeminiHttpError, geminiJson, geminiKey, stripFence } from "./gemini";

type Emit = (e: AgentEvent) => void;

const UA = "Mozilla/5.0 (compatible; Mr.Gridy/0.1)";
const HOUR = 3600_000;
const MAX_LISTINGS = 8;
const MAX_WEB = 4;
const MAX_NOTES = 12;
const VERIFY_BATCH = 30;

/* ---------------------------------------------------------------- helpers */

function isGovUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && /(^|\.)[a-z0-9-]+\.gov$/i.test(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

/** Retry once after a failure, since .gov sites drop the odd request. */
async function withRetry<T>(run: () => Promise<T | null>): Promise<T | null> {
  const first = await run();
  if (first !== null) return first;
  await new Promise((r) => setTimeout(r, 1500));
  return run();
}

/** A .gov page's HTML, following at most three .gov redirects; null when it doesn't answer 200. */
function fetchGov(raw: string, read: boolean): Promise<string | null> {
  return withRetry(() => fetchGovOnce(raw, read));
}

async function fetchGovOnce(raw: string, read: boolean): Promise<string | null> {
  let url = isGovUrl(raw);
  for (let hop = 0; url && hop < 4; hop++) {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      const next = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && next) {
        await res.body?.cancel().catch(() => {});
        url = isGovUrl(new URL(next, url).toString());
        continue;
      }
      if (!res.ok || !read) {
        await res.body?.cancel().catch(() => {});
        return res.ok ? "" : null;
      }
      return (await res.text()).slice(0, 600_000);
    } catch {
      return null;
    }
  }
  return null;
}

const pageLive = async (url: string) => (await fetchGov(url, false)) !== null;

const today = () => new Date().toISOString().slice(0, 10);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const str = (v: unknown, max = 400) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const sha = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex");

const ENTITIES: Record<string, string> = { amp: "&", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", quot: '"', apos: "'", lt: "<", gt: ">" };
/** HTML to plain text. */
function plain(html: string): string {
  return html
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) =>
      e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Loose match for quotes: case, spacing, quote marks and dashes don't matter. */
const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9'"%$.,;:()/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** The quote is really in the text (and long enough to mean something). */
const quoted = (quote: string, text: string) => squash(quote).length >= 8 && squash(text).includes(squash(quote));

/** Names that are already in the catalog. */
const KNOWN = [
  "grip",
  "grid resilience and innovation",
  "grid innovation program",
  "grid resilience utility",
  "grid resilience state",
  "smart grid grant",
  "transmission facilitation",
  "spark",
].map(norm);
const isKnown = (name: string, url: string) =>
  KNOWN.some((k) => norm(name).includes(k)) ||
  GRANT_CATALOG.some((g) => g.url.replace(/\/$/, "").toLowerCase() === url.replace(/\/$/, "").toLowerCase());

/* ---------------------------------------------------------------- 1. listings */

/** One program's listing, read in full, before its requirements are extracted. */
interface Listing {
  key: string;
  title: string;
  agency: string;
  url: string;
  via: "grants.gov" | "search";
  open: boolean | null;
  status: string;
  /** Everything the requirements may quote. */
  text: string;
  costSharing: boolean | null;
}

const GG = "https://api.grants.gov/v1/api";
/** Grants.gov searches: the energy category, then the words a transmission program would use. */
const GG_QUERIES = [
  { fundingCategories: "EN" },
  { keyword: "electric transmission" },
  { keyword: "grid resilience" },
  { keyword: "transmission line" },
  { keyword: "electric grid" },
  { keyword: "electric utility" },
];
const GG_AGENCY = /^(DOE|USDA-RUS|DHS-FEMA|DOC-EDA|DOI-BIA)/;
const GG_TOPIC = /electric|grid|transmission|power|utilit|energy (program|infrastructure)|resilien/i;
const GG_NOT_FUNDING = /request for information|\bRFI\b|\bNOI\b|notice of intent|sequestration|scholarship|fellowship|training|universit|education|workforce|nuclear/i;

interface GGHit {
  id: string;
  number: string;
  title: string;
  agencyCode: string;
  oppStatus: string;
  closeDate: string;
}

function ggPost<T>(path: string, body: object): Promise<T | null> {
  return withRetry(() => ggPostOnce<T>(path, body));
}

async function ggPostOnce<T>(path: string, body: object): Promise<T | null> {
  try {
    const res = await fetch(`${GG}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data?: T }).data ?? null;
  } catch {
    return null;
  }
}

interface GGDetail {
  opportunityNumber?: string;
  opportunityTitle?: string;
  owningAgencyCode?: string;
  agencyDetails?: { agencyName?: string };
  synopsis?: GGSynopsis;
  forecast?: GGSynopsis & { estSynopsisPostingDate?: string; forecastDesc?: string };
}
interface GGSynopsis {
  applicantEligibilityDesc?: string;
  applicantTypes?: { description?: string }[];
  synopsisDesc?: string;
  forecastDesc?: string;
  responseDate?: string;
  costSharing?: boolean;
  awardCeiling?: string | number;
  fundingDescLinkUrl?: string;
  estSynopsisPostingDate?: string;
}

const dateText = (s: string | undefined) => (s ? s.replace(/\s+\d{1,2}:\d{2}:\d{2}.*$/, "") : null);

async function searchGrantsGov(): Promise<{ listings: Listing[]; read: number } | null> {
  const results = await Promise.all(
    GG_QUERIES.map((q) => ggPost<{ oppHits?: GGHit[] }>("search2", { ...q, oppStatuses: "forecasted|posted", rows: 100 })),
  );
  if (results.every((r) => r === null)) return null;
  const hits = new Map<string, GGHit>();
  for (const r of results)
    for (const h of r?.oppHits ?? [])
      if (GG_AGENCY.test(h.agencyCode) && GG_TOPIC.test(h.title) && !GG_NOT_FUNDING.test(h.title) && !isKnown(h.title, ""))
        hits.set(h.id, h);
  const picked = [...hits.values()].slice(0, MAX_LISTINGS);
  const details = await Promise.all(picked.map((h) => ggPost<GGDetail>("fetchOpportunity", { opportunityId: Number(h.id) })));
  const listings: Listing[] = [];
  picked.forEach((h, i) => {
    const d = details[i];
    const s = d?.synopsis ?? d?.forecast;
    if (!d || !s) return;
    const forecast = !d.synopsis;
    const closes = dateText(s.responseDate);
    const posts = dateText(s.estSynopsisPostingDate);
    const open = forecast ? false : closes ? new Date(closes) > new Date() : true;
    const title = plain(d.opportunityTitle ?? h.title);
    listings.push({
      key: `gg-${norm(h.number).replace(/ /g, "-")}`,
      title,
      agency: d.agencyDetails?.agencyName ?? h.agencyCode,
      url: `https://www.grants.gov/search-results-detail/${h.id}`,
      via: "grants.gov",
      open,
      status: forecast
        ? `Forecast on Grants.gov (${h.number})${posts ? `; the notice is expected around ${posts}` : ""}.`
        : `Posted on Grants.gov (${h.number})${closes ? `; applications close ${closes}` : ""}.`,
      costSharing: typeof s.costSharing === "boolean" ? s.costSharing : null,
      text: [
        `Title: ${title}`,
        `Eligible applicants: ${plain(s.applicantEligibilityDesc ?? "")}`,
        `Applicant types: ${(s.applicantTypes ?? []).map((t) => t.description).join("; ")}`,
        `Description: ${plain(s.synopsisDesc ?? s.forecastDesc ?? "")}`,
        s.awardCeiling ? `Award ceiling: $${s.awardCeiling}` : "",
        s.fundingDescLinkUrl ? `Program page: ${s.fundingDescLinkUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 9000),
    });
  });
  return { listings, read: picked.length };
}

const SEARCH_PROMPT = (states: string[]) => `Search the web for U.S. federal or state funding programs (grants, cost-shared awards, loans) that electric utilities can use for transmission line or substation projects${states.length ? ` in ${states.join(" and ")}` : ""}, as of ${today()}.
Only list programs with an official page on a .gov website. Leave out: ${["GRIP", "Grid Resilience Utility and Industry Grants", "Smart Grid Grants", "Grid Innovation Program", "Transmission Facilitation Program", "state Grid Resilience formula grants (40101(d))"].join(", ")}.
Reply with JSON only: {"programs":[{"name":"...","url":"https://....gov/..."}]}`;

async function searchWeb(states: string[]): Promise<Listing[]> {
  const reply = await gemini({ parts: [{ text: SEARCH_PROMPT(states) }], tools: [{ google_search: {} }], timeoutMs: 45_000 });
  let list: { name?: unknown; url?: unknown }[] = [];
  try {
    const v = JSON.parse(stripFence(reply.text)) as { programs?: typeof list };
    list = Array.isArray(v.programs) ? v.programs : [];
  } catch {
    list = [];
  }
  const found = list
    .map((f) => ({ name: str(f.name, 160), url: str(f.url, 500) }))
    .filter((f): f is { name: string; url: string } => !!f.name && !!f.url && !!isGovUrl(f.url) && !isKnown(f.name, f.url))
    .filter((f, i, all) => all.findIndex((x) => x.url === f.url) === i)
    .slice(0, MAX_WEB);
  const pages = await Promise.all(found.map((f) => fetchGov(f.url, true)));
  return found.flatMap((f, i) => {
    const html = pages[i];
    if (!html) return [];
    return [
      {
        key: `web-${sha(f.url).slice(0, 10)}`,
        title: f.name,
        agency: new URL(f.url).hostname,
        url: f.url,
        via: "search" as const,
        open: null,
        status: "Round status: see the program page.",
        costSharing: null,
        text: `Title: ${f.name}\n${plain(html)}`.slice(0, 9000),
      },
    ];
  });
}

/* ---------------------------------------------------------------- 2. requirements */

const EXTRACT_SYSTEM = `You read funding program listings for an electric transmission planning tool and list each program's requirements.
Rules:
- Use only the listing text. Every requirement needs "quote": words copied exactly from the listing (8 to 200 characters) that state it. Requirements without an exact quote are discarded.
- relevant = true only if an electric utility could receive this money for electric infrastructure (lines, substations, generation, storage). Research, education, planning studies, workforce and non-energy programs are not relevant.
- type "applicant": who may apply, as "allowed" from: investor-owned, cooperative, municipal, public-power. For-profit companies include investor-owned utilities. Only list what the text allows.
- type "generationOnly": the program pays only for generation or storage, not transmission.
- type "stateLed": only a state, tribe, local government or commission may apply.
- type "states": the program covers only some states ("states" as two-letter codes).
- type "existing": only work on existing lines or facilities.
- type "measure": the work must be of one sort; "measure" is "capacity" (raises transmission capacity or efficiency: reconductoring, advanced conductors, advanced transmission technology), "smartGrid" (monitoring, control, automation) or "resilience" (hardening against weather, fire and other hazards).
- type "confirm": anything else an applicant must show that project filings can't (cost share, emissions reductions, rural service area, letters of interest).
- "text" is the requirement in plain words, one short sentence.`;

const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    programs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          key: { type: "STRING" },
          relevant: { type: "BOOLEAN" },
          reason: { type: "STRING" },
          short: { type: "STRING" },
          funds: { type: "STRING" },
          applicants: { type: "STRING" },
          costShare: { type: "STRING", nullable: true },
          requirements: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                type: {
                  type: "STRING",
                  enum: ["applicant", "generationOnly", "stateLed", "states", "existing", "measure", "confirm"],
                },
                text: { type: "STRING" },
                quote: { type: "STRING" },
                allowed: { type: "ARRAY", items: { type: "STRING" } },
                states: { type: "ARRAY", items: { type: "STRING" } },
                measure: { type: "STRING", enum: ["capacity", "smartGrid", "resilience"] },
              },
              required: ["type", "text", "quote"],
            },
          },
        },
        required: ["key", "relevant", "reason", "short", "funds", "applicants", "requirements"],
      },
    },
  },
  required: ["programs"],
};

interface Extracted {
  key: string;
  relevant: boolean;
  reason: string;
  short: string;
  funds: string;
  applicants: string;
  costShare?: string | null;
  requirements: {
    type: string;
    text: string;
    quote: string;
    allowed?: string[];
    states?: string[];
    measure?: string;
  }[];
}

const isExtracted = (v: unknown): v is { programs: Extracted[] } =>
  Array.isArray((v as { programs?: unknown })?.programs) &&
  (v as { programs: Extracted[] }).programs.every((p) => p && typeof p.key === "string" && Array.isArray(p.requirements));

/** The measure words, shared with the catalog through a program that uses each. */
function measureCheck(kind: string | undefined): Requirement["check"] | null {
  const from = (id: string) => GRANT_CATALOG.find((g) => g.id === id)?.requirements.find((r) => r.id === "measure")?.check ?? null;
  if (kind === "capacity") return from("grip-resilience");
  if (kind === "smartGrid") return from("grip-smart-grid");
  if (kind === "resilience") return from("formula-ga");
  return null;
}

/** Turn one extraction into requirements, keeping only those whose quote is in the listing. */
function toRequirements(e: Extracted, l: Listing): { reqs: Requirement[]; dropped: number } {
  const reqs: Requirement[] = [];
  let dropped = 0;
  e.requirements.forEach((r, i) => {
    const quote = str(r.quote, 240);
    const text = str(r.text, 240);
    if (!quote || !text || !quoted(quote, l.text)) {
      dropped++;
      return;
    }
    const id = `${r.type}-${i}`;
    let check: Requirement["check"] | null = null;
    if (r.type === "applicant") {
      const allowed = (r.allowed ?? []).filter(isOwnership) as Ownership[];
      check = allowed.length ? { type: "applicant", allowed } : null;
    } else if (r.type === "generationOnly") check = { type: "kind", kinds: [] };
    else if (r.type === "stateLed") check = { type: "stateLed" };
    else if (r.type === "states") {
      const states = (r.states ?? []).filter((s) => /^[A-Z]{2}$/.test(s));
      check = states.length ? { type: "state", states } : null;
    } else if (r.type === "existing") check = { type: "existing" };
    else if (r.type === "measure") check = measureCheck(r.measure);
    else if (r.type === "confirm") check = { type: "confirm" };
    if (!check) {
      dropped++;
      return;
    }
    reqs.push({ id, text, check, quote });
  });
  // Listings name each eligible applicant on its own line; any one of them may apply, so they are one requirement.
  const who = reqs.filter((r) => r.check.type === "applicant");
  if (who.length > 1) {
    const allowed = [...new Set(who.flatMap((r) => (r.check.type === "applicant" ? r.check.allowed : [])))];
    const merged: Requirement = {
      id: who[0].id,
      text: `Any of these may apply: ${who.map((r) => r.text.replace(/\s*may apply\.?$/i, "").replace(/\.$/, "")).join("; ")}.`,
      check: { type: "applicant", allowed },
      quote: who.map((r) => r.quote).join(" … "),
    };
    return { reqs: [merged, ...reqs.filter((r) => r.check.type !== "applicant")], dropped };
  }
  return { reqs, dropped };
}

/** Read each listing into a program. Without Gemini, the listings are found but not screened. */
async function readListings(listings: Listing[]): Promise<{ programs: GrantProgram[]; irrelevant: number; dropped: number; read: boolean }> {
  const bare = (l: Listing, extra?: Partial<GrantProgram>): GrantProgram => ({
    id: l.key,
    name: l.title,
    short: l.title.length > 44 ? `${l.title.slice(0, 42)}…` : l.title,
    agency: l.agency,
    url: l.url,
    funds: "See the listing.",
    applicants: "See the listing.",
    costShare: null,
    open: l.open,
    status: l.status,
    checked: today(),
    via: l.via,
    requirements: [],
    ...extra,
  });
  if (!listings.length) return { programs: [], irrelevant: 0, dropped: 0, read: false };
  if (!geminiKey()) return { programs: listings.map((l) => bare(l)), irrelevant: 0, dropped: 0, read: false };

  let data: { programs: Extracted[] };
  try {
    ({ data } = await geminiJson(
      {
        parts: [
          {
            text: `List each program's requirements. Return JSON {programs:[...]}, one entry per listing, with its key.\n\n${listings
              .map((l) => `=== LISTING key=${l.key}\n${l.text}`)
              .join("\n\n")}`,
          },
        ],
        system: EXTRACT_SYSTEM,
        schema: EXTRACT_SCHEMA,
        temperature: 0,
        timeoutMs: 45_000,
      },
      isExtracted,
    ));
  } catch (err) {
    console.warn(`[savings-agent] could not read the listings: ${(err as Error).message}`);
    return { programs: listings.map((l) => bare(l)), irrelevant: 0, dropped: 0, read: false };
  }

  let irrelevant = 0;
  let dropped = 0;
  const programs: GrantProgram[] = [];
  for (const l of listings) {
    const e = data.programs.find((p) => p.key === l.key);
    if (!e) {
      programs.push(bare(l));
      continue;
    }
    if (!e.relevant) {
      irrelevant++;
      continue;
    }
    const got = toRequirements(e, l);
    dropped += got.dropped;
    const has = (t: string) => got.reqs.some((r) => r.check.type === t);
    // Screened only with a verified applicant rule and a verified rule on the work.
    const screened = has("applicant") || has("stateLed") ? has("kind") || has("measure") || has("existing") : false;
    const requirements = screened
      ? [
          ...got.reqs,
          ...(l.costSharing && !got.reqs.some((r) => /cost|match/i.test(r.text))
            ? [{ id: "match", text: "The utility provides the cost share the listing requires.", check: { type: "confirm" } } as Requirement]
            : []),
          {
            id: "ahead",
            text: `Construction is still ahead when an award could be made (about ${AHEAD_MONTHS} months after applying).`,
            check: { type: "ahead", months: AHEAD_MONTHS },
          } as Requirement,
        ]
      : [];
    programs.push(
      bare(l, {
        short: str(e.short, 44) ?? bare(l).short,
        funds: str(e.funds) ?? "See the listing.",
        applicants: str(e.applicants) ?? "See the listing.",
        costShare: str(e.costShare, 200),
        requirements,
      }),
    );
  }
  return { programs, irrelevant, dropped, read: true };
}

/* ---------------------------------------------------------------- research */

interface Research {
  programs: GrantProgram[];
  sources: GrantSources;
  note: string;
  complete: boolean;
  /** Nothing answered: not cached, so the next run tries again. */
  offline: boolean;
}

let research: { key: string; at: number; ttl: number; value: Research } | null = null;
let researching: { key: string; p: Promise<Research> } | null = null;

async function doResearch(states: string[], emit: Emit): Promise<Research> {
  emit({ type: "status", step: "grants", message: "Checking the verified programs' official pages and searching Grants.gov…" });
  const [live, gg] = await Promise.all([Promise.all(GRANT_CATALOG.map((g) => pageLive(g.url))), searchGrantsGov()]);
  const catalog = GRANT_CATALOG.map((g, i) => (live[i] ? { ...g, checked: today() } : g));
  const down = live.filter((x) => !x).length;

  let web: Listing[] = [];
  let webWhy: string | null = null;
  if (geminiKey()) {
    emit({ type: "status", step: "grants", message: "Searching the web for other programs (.gov pages only)…" });
    try {
      web = await searchWeb(states);
    } catch (err) {
      webWhy =
        err instanceof GeminiHttpError && err.status === 429
          ? "this Gemini key has no quota for Google Search grounding"
          : "the web search did not answer";
    }
  } else webWhy = "no Gemini key is set";

  const listings = [...(gg?.listings ?? []), ...web];
  if (listings.length) emit({ type: "status", step: "grants", message: `Reading the requirements of ${listings.length} programs found…` });
  const read = await readListings(listings);

  const found = read.programs;
  const screened = found.filter((g) => g.requirements.length);
  const offline = down === catalog.length && !gg;
  const parts = [
    offline
      ? `The program pages and Grants.gov couldn't be reached just now, so the ${catalog.length} verified programs are checked as last read. Run again to search for more.`
      : down
        ? `${catalog.length - down} of ${catalog.length} verified program pages answered today; the others are as last read.`
        : `All ${catalog.length} verified program pages answered today.`,
    offline
      ? ""
      : gg
        ? `Grants.gov: ${gg.read} open or forecast energy listing${gg.read === 1 ? "" : "s"} read${read.irrelevant ? `, ${read.irrelevant} not for utility work` : ""}.`
        : "Grants.gov couldn't be reached just now.",
    webWhy ? `No web search (${webWhy}).` : `Web search: ${web.length} more .gov program page${web.length === 1 ? "" : "s"}.`,
    found.length
      ? read.read
        ? `${screened.length} of ${found.length} found program${found.length === 1 ? "" : "s"} have requirements quoted from the listing${read.dropped ? ` (${read.dropped} requirement${read.dropped === 1 ? "" : "s"} dropped: the quote wasn't in the listing)` : ""}.`
        : "Gemini could not read the found listings, so they are listed but not checked."
      : "",
  ];
  return {
    programs: [...catalog, ...found],
    sources: { catalog: catalog.length, grantsGov: gg ? { read: gg.read, kept: found.filter((g) => g.via === "grants.gov").length } : null, web: webWhy ? null : web.length },
    note: parts.filter(Boolean).join(" "),
    complete: !!gg && !webWhy && (read.read || !listings.length),
    offline,
  };
}

async function findGrants(states: string[], emit: Emit): Promise<Research> {
  const key = states.slice().sort().join(",");
  if (research && research.key === key && Date.now() - research.at < research.ttl) {
    emit({ type: "status", step: "grants", message: "Using this session's grant research." });
    return research.value;
  }
  if (researching?.key === key) return researching.p;
  const p = doResearch(states, emit)
    .then((value) => {
      // A run that reached nothing isn't kept, so the next one tries again.
      if (!value.offline) research = { key, at: Date.now(), ttl: value.complete ? 24 * HOUR : HOUR, value };
      return value;
    })
    .finally(() => {
      researching = null;
    });
  researching = { key, p };
  return p;
}

/* ---------------------------------------------------------------- 3. verify */

const VERIFY_SYSTEM = `You check whether planned transmission projects qualify for one requirement of a funding program. You are strict: the filing must describe the work plainly.
For each project answer:
- "met": the filing clearly describes work of this sort. "quote" must be words copied exactly from that project's filing (5 to 160 characters) that show it.
- "notMet": the filing describes other work (e.g. replacing aging wood poles is not a capacity increase; a new substation is not reconductoring; installing a breaker is not monitoring technology).
- "unclear": the filing is too short to tell.
"reason" is one plain sentence. Never assume work the filing doesn't state.`;

const VERIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    results: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          projectId: { type: "STRING" },
          verdict: { type: "STRING", enum: ["met", "notMet", "unclear"] },
          quote: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["projectId", "verdict", "reason"],
      },
    },
  },
  required: ["results"],
};

interface Judged {
  projectId: string;
  verdict: "met" | "notMet" | "unclear";
  quote?: string;
  reason: string;
}
const isJudged = (v: unknown): v is { results: Judged[] } =>
  Array.isArray((v as { results?: unknown })?.results) &&
  (v as { results: Judged[] }).results.every((r) => r && typeof r.projectId === "string" && typeof r.verdict === "string");

const verifyCache = new Map<string, { results: Judged[]; model: string }>();

interface Task {
  program: GrantProgram;
  req: Requirement;
  projects: AgentProject[];
}

/** Which project × requirement checks Gemini should re-read: the work requirements of projects nothing else rules out. */
function verifyTasks(programs: GrantProgram[], projects: AgentProject[]): Task[] {
  const tasks: Task[] = [];
  const now = new Date();
  for (const g of programs) {
    for (const req of g.requirements.filter((r) => r.check.type === "measure")) {
      const inPlay = projects.filter((p) =>
        g.requirements.every((r) => r === req || ruleResult(r, p, now).status !== "notMet"),
      );
      for (let i = 0; i < inPlay.length; i += VERIFY_BATCH)
        tasks.push({ program: g, req, projects: inPlay.slice(i, i + VERIFY_BATCH) });
    }
  }
  return tasks;
}

async function verify(
  tasks: Task[],
): Promise<{ overrides: CheckOverrides; checked: number; changed: number; unquoted: number; model: string | null; failed: number }> {
  const overrides: CheckOverrides = {};
  let checked = 0;
  let changed = 0;
  let unquoted = 0;
  let failed = 0;
  let model: string | null = null;
  const now = new Date();

  const answers = await Promise.all(
    tasks.map(async (t) => {
      const facts = {
        program: t.program.name,
        funds: t.program.funds,
        requirement: t.req.text,
        ...(t.req.check.type === "measure" ? { workThatQualifies: t.req.check.what } : {}),
        programWords: t.req.quote ?? null,
        projects: t.projects.map((p) => ({ projectId: p.id, filing: filingText(p).slice(0, 900) })),
      };
      const key = sha(facts);
      const hit = verifyCache.get(key);
      if (hit) return hit;
      try {
        const { data, model: m } = await geminiJson(
          {
            parts: [{ text: `Judge every project against the requirement. Return JSON {results:[...]}.\n\n${JSON.stringify(facts)}` }],
            system: VERIFY_SYSTEM,
            schema: VERIFY_SCHEMA,
            temperature: 0,
            timeoutMs: 45_000,
          },
          isJudged,
        );
        const value = { results: data.results, model: m };
        verifyCache.set(key, value);
        return value;
      } catch (err) {
        console.warn(`[savings-agent] verify failed for ${t.program.id}: ${(err as Error).message}`);
        failed++;
        return null;
      }
    }),
  );

  tasks.forEach((t, i) => {
    const a = answers[i];
    if (!a) return;
    model ??= a.model;
    for (const p of t.projects) {
      const j = a.results.find((r) => r.projectId === p.id);
      if (!j) continue;
      checked++;
      const rule = ruleResult(t.req, p, now);
      const reason = str(j.reason, 300) ?? "";
      let next: ReqResult | null = null;
      if (j.verdict === "met") {
        const q = str(j.quote, 200);
        if (q && quoted(q, filingText(p))) next = { ...rule, status: "met", by: "ai", why: reason || rule.why, evidence: q };
        else unquoted++; // no proof from the filing: the rule's answer stands
      } else if (j.verdict === "notMet") next = { ...rule, status: "notMet", by: "ai", why: reason || rule.why, evidence: undefined };
      else next = { ...rule, status: "unknown", by: "ai", why: reason || "The filing is too short to tell.", evidence: undefined };
      if (!next) continue;
      if (next.status !== rule.status) changed++;
      overrides[checkKey(t.program.id, p.id, t.req.id)] = next;
    }
  });
  return { overrides, checked, changed, unquoted, model, failed };
}

/* ---------------------------------------------------------------- 4. notes */

const kvText = (kv: number[]) => (kv.length ? `${Math.max(...kv)} kV` : "");

function templateNote(pair: Resolved, matches: FundingMatch[], programs: GrantProgram[]): string {
  const g = (id: string) => programs.find((x) => x.id === id);
  const joint = matches.filter((m) => m.fit === "joint");
  const each = matches.filter((m) => m.fit === "each");
  const parts: string[] = [];
  if (joint.length) {
    parts.push(
      `Both projects meet every public requirement of ${joint.map((m) => g(m.grantId)?.short ?? m.grantId).join(" and ")}, so ${pair.a.state} and ${pair.b.state} could lead one joint application.`,
    );
  }
  if (each.length) {
    const who = [pair.a, pair.b].filter((p) =>
      each.some((m) => m.checks.find((c) => c.projectId === p.id)?.verdict === "fits"),
    );
    parts.push(
      `${who.map((p) => p.utility).join(" and ")} could apply for ${each.map((m) => g(m.grantId)?.short ?? m.grantId).join(" or ")} for ${who.length === 1 ? "its" : "their"} own work.`,
    );
  }
  const closed = matches.every((m) => g(m.grantId)?.open === false);
  parts.push(closed ? "No round is open now; the utility still has to confirm the cost match." : "The utility still has to confirm the cost match.");
  return parts.join(" ");
}

const NOTES_SCHEMA = {
  type: "OBJECT",
  properties: {
    notes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { pairId: { type: "STRING" }, note: { type: "STRING" } },
        required: ["pairId", "note"],
      },
    },
  },
  required: ["notes"],
};

const NOTES_SYSTEM = `You write one short funding note per pair of planned transmission projects, for utility planners.
Rules:
- Use only the facts given. Name programs exactly as given. Never invent dollar amounts, dates, deadlines or odds.
- "joint" means one application could cover both projects; "each" means a utility could apply for its own project.
- The projects meet every requirement public filings can show; name what the utility must still confirm ("toConfirm").
- Say "could apply", never "can" or "will". Say plainly if no round is open. Never promise an award.
- At most two sentences and 50 words per note. Plain words, no markdown.`;

function isNotes(v: unknown): v is { notes: { pairId: string; note: string }[] } {
  const n = (v as { notes?: unknown })?.notes;
  return Array.isArray(n) && n.every((x) => x && typeof x.pairId === "string" && typeof x.note === "string");
}

const notesCache = new Map<string, { notes: Record<string, string>; model: string }>();

interface Resolved {
  id: string;
  a: AgentProject;
  b: AgentProject;
  shared: AgentPair["shared"];
  savedUsd: number;
}

async function writeNotes(
  pairs: Resolved[],
  matches: Record<string, FundingMatch[]>,
  programs: GrantProgram[],
): Promise<{ notes: Record<string, string>; source: "gemini" | "template"; model: string | null }> {
  const matched = pairs.filter((p) => matches[p.id]?.length);
  const notes: Record<string, string> = {};
  for (const p of matched) notes[p.id] = templateNote(p, matches[p.id], programs);
  if (!geminiKey() || !matched.length) return { notes, source: "template", model: null };

  const top = matched
    .slice()
    .sort(
      (x, y) =>
        Number(matches[y.id].some((m) => m.fit === "joint")) - Number(matches[x.id].some((m) => m.fit === "joint")) ||
        y.savedUsd - x.savedUsd,
    )
    .slice(0, MAX_NOTES);
  const used = new Set(top.flatMap((p) => matches[p.id].map((m) => m.grantId)));
  const facts = {
    programs: programs
      .filter((g) => used.has(g.id))
      .map((g) => ({ id: g.id, name: g.short, funds: g.funds, roundOpen: g.open, latestRound: g.status })),
    pairs: top.map((p) => ({
      pairId: p.id,
      projects: [p.a, p.b].map((x) => ({
        id: x.id,
        utility: x.utility,
        state: x.state,
        name: x.name,
        work: `${x.action} ${kvText(x.voltageKv)} ${x.kind}`.replace(/\s+/g, " "),
        inService: x.inService,
      })),
      fits: matches[p.id].map((m) => ({
        program: m.grantId,
        fit: m.fit,
        projectsThatFit: m.checks.filter((c) => c.verdict === "fits").map((c) => c.projectId),
        toConfirm: [...new Set(m.checks.flatMap((c) => c.results.filter((r) => r.status === "confirm").map((r) => r.text)))],
      })),
    })),
  };
  const key = sha(facts);
  const hit = notesCache.get(key);
  if (hit) return { notes: { ...notes, ...hit.notes }, source: "gemini", model: hit.model };
  try {
    const { data, model } = await geminiJson(
      {
        parts: [{ text: `Write one funding note per pair. Return JSON {notes:[{pairId, note}]}.\n\nFACTS:\n${JSON.stringify(facts)}` }],
        system: NOTES_SYSTEM,
        schema: NOTES_SCHEMA,
        timeoutMs: 30_000,
      },
      isNotes,
    );
    const ids = new Set(top.map((p) => p.id));
    const written: Record<string, string> = {};
    for (const n of data.notes) if (ids.has(n.pairId) && n.note.trim()) written[n.pairId] = n.note.trim().slice(0, 420);
    notesCache.set(key, { notes: written, model });
    return { notes: { ...notes, ...written }, source: "gemini", model };
  } catch (err) {
    console.warn(`[savings-agent] Gemini notes unavailable, using the template: ${(err as Error).message}`);
    return { notes, source: "template", model: null };
  }
}

/* ---------------------------------------------------------------- entry */

export async function runAgent(req: AgentRequest, emit: Emit): Promise<void> {
  const byId = new Map(req.projects.map((p) => [p.id, p]));
  const pairs: Resolved[] = req.pairs.flatMap((p) => {
    const a = byId.get(p.a);
    const b = byId.get(p.b);
    return a && b ? [{ ...p, a, b }] : [];
  });
  const inPairs = [...new Map(pairs.flatMap((p) => [p.a, p.b]).map((p) => [p.id, p])).values()];
  const states = [...new Set(inPairs.map((p) => p.state))];

  const { programs, sources, note } = await findGrants(states, emit);
  emit({ type: "grants", programs, sources, note });

  const screenable = programs.filter((g) => g.requirements.length);
  const checks = screenable.reduce((n, g) => n + g.requirements.length, 0) * inPairs.length;
  const tasks = verifyTasks(screenable, inPairs);
  const toVerify = tasks.reduce((n, t) => n + t.projects.length, 0);
  emit({ type: "rules", checks, toVerify });

  let overrides: CheckOverrides = {};
  if (!toVerify) {
    emit({ type: "verified", overrides, checked: 0, changed: 0, model: null, note: "No project passed the rules far enough to need a closer read." });
  } else if (!geminiKey()) {
    emit({ type: "verified", overrides, checked: 0, changed: 0, model: null, note: "No Gemini key is set, so the rules' answers stand unverified." });
  } else {
    emit({
      type: "status",
      step: "verify",
      message: `Gemini is re-reading ${toVerify} project filing${toVerify === 1 ? "" : "s"} against each program's work requirement…`,
    });
    const v = await verify(tasks);
    overrides = v.overrides;
    const noteParts = [
      `Re-read ${v.checked} project × requirement check${v.checked === 1 ? "" : "s"}; ${v.changed} answer${v.changed === 1 ? "" : "s"} changed.`,
      v.unquoted ? `${v.unquoted} "met" answer${v.unquoted === 1 ? "" : "s"} had no quote from the filing and were not accepted.` : "",
      v.failed ? `${v.failed} batch${v.failed === 1 ? "" : "es"} failed; those keep the rules' answers.` : "",
    ];
    emit({ type: "verified", overrides, checked: v.checked, changed: v.changed, model: v.model, note: noteParts.filter(Boolean).join(" ") });
  }

  const matches: Record<string, FundingMatch[]> = {};
  for (const p of pairs) {
    const m = screenPair(p.a, p.b, p.shared, programs, overrides).filter(isMatch);
    if (m.length) matches[p.id] = m;
  }
  if (Object.keys(matches).length) {
    emit({ type: "status", step: "notes", message: "Writing a funding note for each pair that fits…" });
    emit({ type: "notes", ...(await writeNotes(pairs, matches, programs)) });
  }
  emit({ type: "done" });
}

/* ---------------------------------------------------------------- request */

const isStr = (v: unknown, max = 300) => typeof v === "string" && v.length > 0 && v.length <= max;

function isAgentProject(v: unknown): v is AgentProject {
  const p = v as Record<string, unknown>;
  return (
    !!p &&
    isStr(p.id) &&
    isStr(p.name, 400) &&
    typeof p.description === "string" &&
    p.description.length <= 6000 &&
    isStr(p.utility, 120) &&
    (p.kind === "line" || p.kind === "substation") &&
    (p.action === "new" || p.action === "rebuild" || p.action === "upgrade") &&
    Array.isArray(p.voltageKv) &&
    p.voltageKv.every((k) => typeof k === "number") &&
    (p.state === "SC" || p.state === "GA") &&
    (p.inService === null || isStr(p.inService, 40)) &&
    (p.ownership === null || isOwnership(p.ownership)) &&
    (p.miles === null || typeof p.miles === "number")
  );
}

export function isAgentRequest(v: unknown): v is AgentRequest {
  const r = v as AgentRequest;
  if (!r || !Array.isArray(r.projects) || !Array.isArray(r.pairs)) return false;
  if (r.projects.length > 400 || r.pairs.length > 400 || !r.projects.every(isAgentProject)) return false;
  const ids = new Set(r.projects.map((p) => p.id));
  return r.pairs.every(
    (p) =>
      p &&
      isStr(p.id) &&
      ids.has(p.a) &&
      ids.has(p.b) &&
      Array.isArray(p.shared) &&
      p.shared.every((s) => s && isStr(s.kind, 40) && isStr(s.title, 200)) &&
      typeof p.savedUsd === "number",
  );
}

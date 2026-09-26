/**
 * Funding programs for transmission work, each with the requirements its
 * official page states, and the checklist that tests a project against every
 * one of them.
 *
 * GRANT_CATALOG was read from each program's page on the date in `checked`.
 * The savings agent (lib/integrations/server/savingsAgent.ts) re-checks those
 * pages, searches Grants.gov for more programs, turns each listing into the
 * same requirement list (every requirement must quote the listing word for
 * word) and has Gemini re-read each project's filing against the requirements
 * the rules can't settle. Gemini may only mark a requirement met by quoting
 * the filing word for word; it can always be stricter than the rules.
 *
 * A program "fits" a project only when no requirement fails and every
 * requirement public filings can show is met. What only the utility can show
 * (cost match, spending history, a state agreeing to lead) stays listed for
 * the utility to confirm. Awards are competitive, so no dollar figure is added
 * to the savings.
 */
import type { Opportunity, OpportunityKind } from "./opportunities";
import type { Project, ProjectKind, SourceRef } from "./types";

/** Who owns the utility: decides which programs it may apply to. */
export type Ownership = "investor-owned" | "cooperative" | "municipal" | "public-power";

/** Ownership of the catalog utilities, from their public filings. */
export const UTILITY_OWNERSHIP: Record<string, Ownership> = {
  desc: "investor-owned", // Dominion Energy South Carolina, a Dominion Energy subsidiary
  "georgia-power": "investor-owned", // Georgia Power, a Southern Company subsidiary
};

export const OWNERSHIP_TEXT: Record<Ownership, string> = {
  "investor-owned": "an investor-owned (for-profit) utility",
  cooperative: "an electric cooperative",
  municipal: "a municipal utility",
  "public-power": "a public power agency",
};

const OWNERSHIPS = Object.keys(OWNERSHIP_TEXT) as Ownership[];
export const isOwnership = (v: unknown): v is Ownership => OWNERSHIPS.includes(v as Ownership);

/** The filed facts the checklist reads. */
export type GrantProject = Pick<
  Project,
  "id" | "name" | "kind" | "action" | "voltageKv" | "state" | "description" | "inService"
> & { ownership: Ownership | null };

/**
 * One requirement's test, from filed facts only:
 *   applicant     the utility's ownership is on the program's list
 *   stateLed      a state, tribe, local government or commission must apply
 *   kind          a line or a substation the program funds (empty: it funds neither)
 *   existing      work on an existing line or substation
 *   measure       the filing describes an eligible measure (`any`), and none of `none`
 *   noGeneration  not a generating plant, generators or a battery plant
 *   state         the project is in one of `states`
 *   minKv         stands in for a MW threshold the filings don't state
 *   ahead         construction is still ahead when an award could be made
 *   confirm       public filings can't show it; the utility confirms
 */
export type ReqCheck =
  | { type: "applicant"; allowed: Ownership[] }
  | { type: "stateLed" }
  | { type: "kind"; kinds: ProjectKind[] }
  | { type: "existing" }
  | { type: "measure"; what: string; any: string[]; none?: string[]; /** Suggestive only: a match is "unknown", for the AI to settle. */ weak?: string[] }
  | { type: "noGeneration" }
  | { type: "state"; states: string[] }
  | { type: "minKv"; kv: number; why: string }
  | { type: "ahead"; months: number }
  | { type: "confirm" };

export interface Requirement {
  id: string;
  /** The requirement in plain words. */
  text: string;
  check: ReqCheck;
  /** Words from the program's page or listing that state it. */
  quote?: string;
}

export interface GrantProgram {
  id: string;
  name: string;
  /** Short label for chips and lists. */
  short: string;
  agency: string;
  url: string;
  /** What the program funds, from its page. */
  funds: string;
  /** Who applies, from its page. */
  applicants: string;
  /** Cost share, only when the page states it. */
  costShare: string | null;
  /** A round is open now: true, false, or null when the page doesn't say. */
  open: boolean | null;
  /** The latest round, from its page. */
  status: string;
  /** YYYY-MM-DD the page was read. */
  checked: string;
  /** "catalog": read when the catalog was written; "grants.gov": the agent's Grants.gov search; "search": its web search. */
  via: "catalog" | "grants.gov" | "search";
  /** Takes one application covering projects in several states. */
  joint?: boolean;
  /** Empty for a program the agent found but could not read requirements for: it fits nothing. */
  requirements: Requirement[];
  /** Past awards to utilities that may appear in a pair, with the page that lists them. */
  awards?: { recipient: string; amount: string; when: string; url: string }[];
}

/* ------------------------------------------------------------------ words */

// Regex sources, matched case-insensitively against the project's name and filing.
const CAPACITY = [
  "reconductor",
  "\\bacss\\b",
  "\\baccc\\b",
  "\\baccr\\b",
  "advanced conductor",
  "high(er)?[- ]temperature",
  "\\d{3}\\s*°\\s*c",
  "uprat",
  "higher[- ]rat",
  "increase[sd]? (the )?(line('s)? )?(capacity|rating)",
  "limiting element",
  "thermal (limit|rating)",
  "series reactor",
  "\\breactor\\b",
  "power[- ]flow control",
  "dynamic line rating",
];
const SMART_GRID = [
  "fiber",
  "\\brelay",
  "protection scheme",
  "monitoring",
  "sensor",
  "dynamic line rating",
  "power[- ]flow control",
  "series reactor",
  "\\breactor\\b",
  "statcom",
  "\\bsvc\\b",
  "scada",
  "automation",
];
const RESILIENCE = [
  "wood pole",
  "\\bpoles?\\b",
  "reconductor",
  "conductor",
  "harden",
  "underground",
  "wildfire",
  "fire[- ](resistant|wrap|mitigation)",
  "\\brelay",
  "protection",
  "monitoring",
];
/** Words that suggest a resilience measure without naming one: a rebuild may or may not replace poles and conductor. */
const RESILIENCE_WEAK = ["relocat", "rebuild", "end of life", "storm", "hurricane", "weather"];
const NOT_RESILIENCE = ["cyber", "battery", "\\bbess\\b", "generator"];
const GENERATION = [
  "combined[- ]cycle",
  "generating (plant|facility|unit)",
  "\\bbess\\b",
  "battery",
  "\\bplant \\w+ expansion",
];

/* ------------------------------------------------------------------ catalog */

const GRIP_ROUND =
  "Latest round: SPARK (FY26, DE-FOA-0003580): applications were due May 5, 2026, and DOE announced 31 selections in " +
  "September 2026. GRIP was funded for FY22–26, so no later round is announced.";

const GRIP_AWARDS_URL = "https://www.energy.gov/gdo/grid-resilience-and-innovation-partnerships-grip-program-projects";
const GRIP_AWARDS = [
  { recipient: "Georgia Power", amount: "up to $160 million", when: "October 2024 (GRIP round 2)", url: GRIP_AWARDS_URL },
  { recipient: "Georgia Transmission", amount: "up to $97 million", when: "October 2024 (GRIP round 2)", url: GRIP_AWARDS_URL },
];

/** Grants don't pay for work finished before the award; a competitive award takes about a year. */
export const AHEAD_MONTHS = 12;
const ahead = (months = AHEAD_MONTHS): Requirement => ({
  id: "ahead",
  text: `Construction is still ahead when an award could be made (about ${months} months after applying).`,
  check: { type: "ahead", months },
  quote: "Costs incurred before the award are allowable only with the awarding agency's approval (2 CFR 200.458).",
});

const ALL: Ownership[] = OWNERSHIPS;

const formula = (state: "GA" | "SC"): GrantProgram => {
  const ga = state === "GA";
  return {
    id: ga ? "formula-ga" : "formula-sc",
    name: ga
      ? "Georgia Grid Resilience Grant Program (IIJA §40101(d), run by GEFA)"
      : "South Carolina Grid Resilience Grant Program (IIJA §40101(d), run by Santee Cooper)",
    short: ga ? "Georgia Grid Resilience" : "South Carolina Grid Resilience",
    agency: ga
      ? "Georgia Environmental Finance Authority, with U.S. DOE formula funds"
      : "Santee Cooper for the State of South Carolina, with U.S. DOE formula funds",
    url: ga
      ? "https://gefa.georgia.gov/energy-programs/grid-resilience-grant-program"
      : "https://www.santeecooper.com/community/grid-resilience/",
    funds:
      "Resilience measures on the existing grid: hardening lines and substations, utility pole management, replacing old overhead conductors, reconductoring, undergrounding, monitoring and protection.",
    applicants:
      "Grid operators, storage operators, generators, transmission owners or operators, distribution providers and fuel suppliers in the state.",
    costShare:
      "The utility matches 100% of the subgrant (one third for small utilities selling no more than 4 million MWh a year).",
    open: ga ? false : null,
    status: ga
      ? "GEFA's page says the application period is now closed."
      : "Two rounds funded (FY22–23: $10.4 million, 17 projects; FY24: $5.5 million, 14 projects). The page lists no open call.",
    checked: "2026-09-26",
    via: "catalog",
    requirements: [
      {
        id: "state",
        text: `The project is in ${ga ? "Georgia" : "South Carolina"}; the state gives out its own share.`,
        check: { type: "state", states: [state] },
      },
      {
        id: "applicant",
        text: "The utility owns or operates transmission.",
        check: { type: "applicant", allowed: ALL },
        quote: "Transmission owners or operators",
      },
      {
        id: "measure",
        text: "The work is one of the listed resilience measures.",
        check: {
          type: "measure",
          what: "a listed resilience measure (hardening, pole or conductor replacement, reconductoring, protection)",
          any: RESILIENCE,
          weak: RESILIENCE_WEAK,
          none: NOT_RESILIENCE,
        },
        quote: "Hardening of power lines, facilities, substations, of other systems",
      },
      {
        id: "noGeneration",
        text: "Not a new generating plant, generators, a large battery plant or cybersecurity.",
        check: { type: "noGeneration" },
        quote: "Construction of a new electric generating facility",
      },
      ahead(6),
      {
        id: "match",
        text: "The utility commits the cost match (100%, or one third for a small utility).",
        check: { type: "confirm" },
      },
    ],
  };
};

export const GRANT_CATALOG: GrantProgram[] = [
  formula("GA"),
  formula("SC"),
  {
    id: "grip-resilience",
    name: "Grid Resilience Utility and Industry Grants (GRIP, IIJA §40101(c))",
    short: "GRIP Grid Resilience",
    agency: "U.S. Department of Energy, Office of Electricity",
    url: "https://www.energy.gov/gdo/grid-resilience-utility-and-industry-grants",
    funds:
      "Modernising the grid against extreme weather. The latest round (SPARK topic 1) asked for reconductoring and other advanced transmission technologies that expand the transfer capacity of existing lines.",
    applicants:
      "Grid operators, storage operators, generators, transmission owners or operators, distribution providers and fuel suppliers.",
    costShare: "100% cost match, and the grant is capped at what the utility spent on hardening in the previous three years.",
    open: false,
    status: GRIP_ROUND,
    checked: "2026-09-26",
    via: "catalog",
    requirements: [
      {
        id: "applicant",
        text: "The utility owns or operates transmission.",
        check: { type: "applicant", allowed: ALL },
        quote: "transmission owners/operators",
      },
      {
        id: "existing",
        text: "The work is on an existing line or substation.",
        check: { type: "existing" },
        quote: "must expand the transfer capacity of existing transmission or sub-transmission",
      },
      {
        id: "measure",
        text: "The work expands transfer capacity (reconductoring or another advanced transmission technology), as the latest round required.",
        check: {
          type: "measure",
          what: "work that raises the line's capacity (reconductoring, a higher-rated conductor, a reactor, removing a limiting element)",
          any: CAPACITY,
        },
        quote: "reconductoring and deploying other ATTs",
      },
      { id: "noGeneration", text: "Transmission work, not a generating plant.", check: { type: "noGeneration" } },
      ahead(),
      {
        id: "match",
        text: "The utility provides a 100% cost match.",
        check: { type: "confirm" },
        quote: "100% cost match",
      },
      {
        id: "cap",
        text: "The utility spent at least the grant amount on hardening in the previous three years.",
        check: { type: "confirm" },
        quote: "capped at the amount the eligible entity has spent in the previous three years on hardening",
      },
    ],
    awards: GRIP_AWARDS,
  },
  {
    id: "grip-smart-grid",
    name: "Smart Grid Grants (GRIP, IIJA §40107)",
    short: "GRIP Smart Grid",
    agency: "U.S. Department of Energy, Office of Electricity",
    url: "https://www.energy.gov/gdo/smart-grid-grants",
    funds: "Smart grid technology that enables real-time monitoring, control and optimization of grid assets.",
    applicants: "Universities, for-profit and non-profit companies, state and local governments and tribes.",
    costShare: null,
    open: false,
    status: GRIP_ROUND,
    checked: "2026-09-26",
    via: "catalog",
    requirements: [
      {
        id: "applicant",
        text: "The utility is a for-profit, non-profit or government entity.",
        check: { type: "applicant", allowed: ALL },
        quote: "for-profit entities",
      },
      {
        id: "measure",
        text: "The work deploys smart grid technology (monitoring, protection and control, power-flow control), not only new wire or steel.",
        check: {
          type: "measure",
          what: "smart grid technology (monitoring, protection and control, power-flow control)",
          any: SMART_GRID,
        },
        quote: "real-time monitoring, control, and optimization of grid assets",
      },
      { id: "noGeneration", text: "Grid work, not a generating plant.", check: { type: "noGeneration" } },
      ahead(),
      {
        id: "market",
        text: "The technology shows a pathway to wider market adoption.",
        check: { type: "confirm" },
        quote: "pathway to wider market adoption",
      },
      { id: "match", text: "The utility provides the cost share set in the round's funding notice.", check: { type: "confirm" } },
    ],
    awards: GRIP_AWARDS,
  },
  {
    id: "grip-innovation",
    name: "Grid Innovation Program (GRIP, IIJA §40103(b))",
    short: "GRIP Grid Innovation",
    agency: "U.S. Department of Energy, Office of Electricity",
    url: "https://www.energy.gov/gdo/grid-innovation-program",
    funds:
      "Innovative approaches to transmission, including interregional projects. The latest round prioritised large, multi-jurisdictional projects that expand transfer capability between planning regions.",
    applicants:
      "States (one or several together), tribes, local governments and public utility commissions, working with the utilities that own the lines.",
    costShare: null,
    open: false,
    status: GRIP_ROUND,
    checked: "2026-09-26",
    via: "catalog",
    joint: true,
    requirements: [
      {
        id: "stateLed",
        text: "A state energy office, utility commission, tribe or local government applies, with the utility as partner.",
        check: { type: "stateLed" },
        quote: "States, combinations of States, Indian Tribes, units of local government, and public utility commissions",
      },
      {
        id: "measure",
        text: "The work expands transfer capability (reconductoring, power-flow control or another advanced transmission technology).",
        check: {
          type: "measure",
          what: "work that raises transfer capability (reconductoring, a higher-rated conductor, power-flow control)",
          any: CAPACITY,
        },
        quote: "expanding transfer capability between transmission planning regions",
      },
      { id: "noGeneration", text: "Transmission work, not a generating plant.", check: { type: "noGeneration" } },
      ahead(),
      { id: "match", text: "The partners provide the cost share set in the round's funding notice.", check: { type: "confirm" } },
    ],
    awards: GRIP_AWARDS,
  },
  {
    id: "tfp",
    name: "Transmission Facilitation Program",
    short: "Transmission Facilitation",
    agency: "U.S. Department of Energy, Grid Deployment Office",
    url: "https://www.energy.gov/gdo/transmission-facilitation-program",
    funds:
      "Capacity contracts (DOE buys up to 50% of a line's rating), public-private partnerships and loans for lines of at least 1,000 MW, or 500 MW when upgrading or building in an existing corridor.",
    applicants: "Transmission developers.",
    costShare: null,
    open: false,
    status:
      "The $2.5 billion revolving fund is nearly fully obligated; new rounds open only as money comes back. Round 2 selections were announced October 3, 2024.",
    checked: "2026-09-26",
    via: "catalog",
    requirements: [
      {
        id: "kind",
        text: "The project is a transmission line.",
        check: { type: "kind", kinds: ["line"] },
        quote: "electric power transmission line",
      },
      {
        id: "capacity",
        text: "The line carries at least 1,000 MW, or 500 MW for an upgrade or a line in an existing corridor.",
        check: { type: "minKv", kv: 230, why: "Lines below 230 kV carry a few hundred MW at most, under the 500 MW floor." },
        quote: "not less than 1,000 megawatts",
      },
      {
        id: "market",
        text: "The added capacity is offered to the market for transmission service.",
        check: { type: "confirm" },
        quote: "made available to the market",
      },
      ahead(),
    ],
  },
];

/* ------------------------------------------------------------------ checks */

export type ReqStatus = "met" | "notMet" | "unknown" | "confirm";

export interface ReqResult {
  id: string;
  text: string;
  status: ReqStatus;
  /** Why, in one plain sentence. */
  why: string;
  /** "rule": the filed facts; "ai": Gemini re-read the filing. */
  by: "rule" | "ai";
  /** Words from the filing that show it (verbatim). */
  evidence?: string;
}

/** fits: nothing fails and everything public data can show is met. */
export type Verdict = "fits" | "unclear" | "ruledOut";

export interface ProjectCheck {
  projectId: string;
  verdict: Verdict;
  results: ReqResult[];
}

/** Gemini's re-reads, keyed by checkKey(). */
export type CheckOverrides = Record<string, ReqResult>;
export const checkKey = (grantId: string, projectId: string, reqId: string) => `${grantId}|${projectId}|${reqId}`;

/** The text a requirement is checked against, and that AI evidence must be quoted from. */
export const filingText = (p: Pick<GrantProject, "name" | "description">) => `${p.name}. ${p.description}`;

const find = (pats: string[], s: string) => {
  for (const src of pats) {
    const m = new RegExp(src, "i").exec(s);
    if (m) return m[0];
  }
  return null;
};
const maxKv = (p: GrantProject) => (p.voltageKv.length ? Math.max(...p.voltageKv) : 0);
const STATE_NAME: Record<string, string> = { GA: "Georgia", SC: "South Carolina" };

function monthsFrom(iso: string, from: Date) {
  const d = new Date(iso);
  return (d.getUTCFullYear() - from.getUTCFullYear()) * 12 + (d.getUTCMonth() - from.getUTCMonth());
}

function runCheck(req: Requirement, p: GrantProject, today: Date): Pick<ReqResult, "status" | "why" | "evidence"> {
  const c = req.check;
  switch (c.type) {
    case "applicant":
      if (!p.ownership) return { status: "unknown", why: "The utility's ownership isn't on file." };
      return c.allowed.includes(p.ownership)
        ? { status: "met", why: `The utility is ${OWNERSHIP_TEXT[p.ownership]}, which may apply.` }
        : {
            status: "notMet",
            why: `The utility is ${OWNERSHIP_TEXT[p.ownership]}; only ${c.allowed.map((o) => OWNERSHIP_TEXT[o].replace(/^an? /, "")).join(" or ")}s may apply.`,
          };
    case "stateLed":
      return {
        status: "confirm",
        why: `The utility can't apply on its own: ${STATE_NAME[p.state] ?? p.state}'s energy office or utility commission would have to lead.`,
      };
    case "kind":
      if (!c.kinds.length) return { status: "notMet", why: "The program doesn't fund transmission lines or substations." };
      return c.kinds.includes(p.kind)
        ? { status: "met", why: `It is a ${p.kind}.` }
        : { status: "notMet", why: `It is a ${p.kind}; the program funds ${c.kinds.join(" and ")}s only.` };
    case "existing":
      return p.action === "new"
        ? { status: "notMet", why: "The filing lists new construction, not work on an existing line or substation." }
        : { status: "met", why: `The filing lists ${p.action === "rebuild" ? "a rebuild" : "an upgrade"} of existing equipment.` };
    case "measure": {
      const bad = c.none ? find(c.none, filingText(p)) : null;
      if (bad) return { status: "notMet", why: `The filing mentions “${bad}”, which the program excludes.` };
      const hit = find(c.any, filingText(p));
      if (hit) return { status: "met", why: `The filing describes ${c.what}.`, evidence: hit };
      const weak = c.weak ? find(c.weak, filingText(p)) : null;
      return weak
        ? { status: "unknown", why: `The filing says “${weak}” but doesn't name ${c.what}.`, evidence: weak }
        : { status: "notMet", why: `The filing doesn't describe ${c.what}.` };
    }
    case "noGeneration": {
      const hit = find(GENERATION, filingText(p));
      return hit
        ? { status: "notMet", why: `The filing describes generation or storage (“${hit}”), which the program doesn't fund.` }
        : { status: "met", why: "It is transmission work." };
    }
    case "state":
      return c.states.includes(p.state)
        ? { status: "met", why: `It is in ${STATE_NAME[p.state] ?? p.state}.` }
        : { status: "notMet", why: `It is in ${STATE_NAME[p.state] ?? p.state}; the program covers ${c.states.map((s) => STATE_NAME[s] ?? s).join(", ")} only.` };
    case "minKv":
      return maxKv(p) >= c.kv
        ? { status: "unknown", why: `At ${maxKv(p)} kV it could reach the threshold, but the filing gives no MW rating.` }
        : { status: "notMet", why: `${maxKv(p) ? `At ${maxKv(p)} kV: ` : ""}${c.why}` };
    case "ahead": {
      if (!p.inService) return { status: "unknown", why: "The filing gives no in-service date." };
      const m = monthsFrom(p.inService, today);
      const when = p.inService.slice(0, 7);
      if (m >= c.months) return { status: "met", why: `It goes into service ${when}, so the work is still ahead.` };
      return {
        status: "notMet",
        why: m < 0 ? `It went into service ${when}; finished work can't be funded.` : `It goes into service ${when}, before an award could be made.`,
      };
    }
    case "confirm":
      return { status: "confirm", why: "Public filings can't show this; the utility has to confirm it." };
  }
}

export function verdictOf(results: Pick<ReqResult, "status">[]): Verdict {
  if (results.some((r) => r.status === "notMet")) return "ruledOut";
  if (results.some((r) => r.status === "unknown")) return "unclear";
  return "fits";
}

/** The rules' answer to one requirement for one project. */
export function ruleResult(req: Requirement, p: GrantProject, today = new Date()): ReqResult {
  return { id: req.id, text: req.text, by: "rule", ...runCheck(req, p, today) };
}

/** Every requirement of one program, checked for one project. Gemini's re-read replaces the rule's answer. */
export function checkProject(g: GrantProgram, p: GrantProject, overrides: CheckOverrides = {}, today = new Date()): ProjectCheck {
  const results = g.requirements.map((req) => overrides[checkKey(g.id, p.id, req.id)] ?? ruleResult(req, p, today));
  return { projectId: p.id, verdict: g.requirements.length ? verdictOf(results) : "unclear", results };
}

/* ------------------------------------------------------------------ pairs */

/**
 * Shared work that makes one project out of two: the lines meet, share land,
 * a yard or permits, or are sized together. Sharing a crew or an order is
 * procurement, not a project a joint application could describe.
 */
const JOINT_WORK: OpportunityKind[] = ["outage", "corridor", "permits", "yard", "rightSizing"];

/** One program checked for one pair. */
export interface ProgramScreen {
  grantId: string;
  /** "joint": one application for both; "each": at least one project fits on its own; "none": neither does. */
  fit: "joint" | "each" | "none";
  /** Both projects' checklists. */
  checks: ProjectCheck[];
  /** Joint programs: the pair-level requirements. */
  pair: ReqResult[];
}

/** A program the pair could apply to. */
export type FundingMatch = ProgramScreen & { fit: "joint" | "each" };

/** Every program checked for this pair, with every requirement. */
export function screenPair(
  a: GrantProject,
  b: GrantProject,
  shared: Pick<Opportunity, "kind" | "title">[],
  grants: GrantProgram[] = GRANT_CATALOG,
  overrides: CheckOverrides = {},
  today = new Date(),
): ProgramScreen[] {
  const together = shared.filter((op) => JOINT_WORK.includes(op.kind));
  return grants.map((g) => {
    const checks = [checkProject(g, a, overrides, today), checkProject(g, b, overrides, today)];
    const passing = checks.filter((c) => c.verdict === "fits").length;
    let pair: ReqResult[] = [];
    if (g.joint && passing === 2) {
      pair = [
        {
          id: "states",
          text: "The projects are in two states.",
          status: a.state !== b.state ? "met" : "notMet",
          why: a.state !== b.state ? `${STATE_NAME[a.state] ?? a.state} and ${STATE_NAME[b.state] ?? b.state}.` : `Both are in ${STATE_NAME[a.state] ?? a.state}.`,
          by: "rule",
        },
        {
          id: "joint",
          text: "The two projects form one joint project.",
          status: together.length ? "met" : "notMet",
          why: together.length
            ? `They share work on the ground: ${together.map((op) => op.title.toLowerCase()).join(", ")}.`
            : "They share no work on the ground (an outage, land, a yard or permits).",
          by: "rule",
        },
      ];
      if (pair.every((r) => r.status === "met")) return { grantId: g.id, fit: "joint", checks, pair };
    }
    return { grantId: g.id, fit: passing ? "each" : "none", checks, pair };
  });
}

export const isMatch = (s: ProgramScreen): s is FundingMatch => s.fit !== "none";

/** The programs this pair could apply to. */
export function fundingMatches(...args: Parameters<typeof screenPair>): FundingMatch[] {
  return screenPair(...args).filter(isMatch);
}

/** The joint matches as a way to work together, so they show and rank with the others. */
export function fundingOpportunity(matches: FundingMatch[], grants: GrantProgram[]): Opportunity | null {
  const joint = matches.filter((m) => m.fit === "joint");
  if (!joint.length) return null;
  const names = joint.map((m) => grants.find((g) => g.id === m.grantId)?.short ?? m.grantId);
  return {
    kind: "funding",
    strength: "possible",
    title: "Apply for funding together",
    reason: `Both projects meet every requirement public filings can show for ${names.join(" and ")}, which takes one application for projects across states.`,
    nextStep: "Ask both state energy offices or utility commissions whether they would lead a joint application in the next round.",
  };
}

/** The first requirement that rules a project out, for a short "why not". */
export const firstFailure = (c: ProjectCheck) => c.results.find((r) => r.status === "notMet") ?? null;

export function grantSource(g: GrantProgram): SourceRef {
  return { document: `${g.name}, ${g.agency}`, url: g.url, page: null };
}

export function isGrantProgramList(v: unknown): v is GrantProgram[] {
  return (
    Array.isArray(v) &&
    v.every(
      (g) =>
        g &&
        typeof (g as GrantProgram).id === "string" &&
        typeof (g as GrantProgram).url === "string" &&
        typeof (g as GrantProgram).name === "string" &&
        Array.isArray((g as GrantProgram).requirements),
    )
  );
}

/**
 * The architecture page builds MrGridy one part at a time, like a slideshow:
 * a blank station appears, its card explains it, the card merges into the
 * station, and lines branch out to the next blanks. Positions are world
 * coordinates; the camera frames whatever has been built so far.
 * Facts come from the code (route headers, .do/app.yaml, tiger_load.py).
 */
import type { LucideIcon } from "lucide-react";
import {
  AudioLines,
  Boxes,
  CloudLightning,
  Cpu,
  Database,
  FileJson,
  FileText,
  HandCoins,
  Landmark,
  Map,
  MapPin,
  Mic,
  Monitor,
  Route,
  Server,
  Sparkles,
  Volume2,
  Wind,
} from "lucide-react";

export const W = 1600;
export const H = 900;

export type Tone = "cyan" | "violet" | "emerald" | "amber";

export const TONE: Record<Tone, string> = {
  cyan: "#22D3EE",
  violet: "#A78BFA",
  emerald: "#34D399",
  amber: "#FBBF24",
};

export type RegionId = "offline" | "data" | "browser" | "server" | "outside";

export interface Region {
  id: RegionId;
  name: string;
  /** One plain line, shown under the name in the full-system view. */
  summary: string;
  tone: Tone;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const REGIONS: Region[] = [
  { id: "offline", name: "Before the demo", summary: "Turns public records into results, once", tone: "emerald", x: -120, y: 40, w: 470, h: 550 },
  { id: "data", name: "Our data", summary: "Files and one database", tone: "cyan", x: 420, y: -10, w: 200, h: 740 },
  { id: "browser", name: "In the browser", summary: "What planners see and use", tone: "cyan", x: 668, y: -20, w: 336, h: 660 },
  { id: "server", name: "Our server", summary: "Only where a secret key is needed", tone: "violet", x: 1016, y: 70, w: 404, h: 630 },
  { id: "outside", name: "Outside services", summary: "AI, voices, storms, maps, grants", tone: "amber", x: 1446, y: -20, w: 208, h: 900 },
];

export interface Part {
  id: string;
  region: RegionId;
  x: number;
  y: number;
  name: string;
  /** Plain words: what it does. */
  does: string;
  /** How it connects to the parts explained before it. */
  via: string;
  icon: LucideIcon;
  tone: Tone;
  stat: { value: string; label: string };
  points: string[];
  tech: string[];
}

export const PARTS: Part[] = [
  {
    id: "sources",
    region: "offline",
    x: 0,
    y: 330,
    name: "Public records",
    does: "Where every number starts",
    via: "Where the whole story starts",
    icon: FileText,
    tone: "amber",
    stat: { value: "0", label: "CEII documents used" },
    points: [
      "Dominion Energy SC's plan and the SERTP Non-CEII report",
      "50 years of hurricane tracks and county outage history",
      "Cost guides and farmland values for the estimates",
    ],
    tech: ["PDF", "HURDAT2", "EAGLE-I", "MISO", "USDA"],
  },
  {
    id: "pipeline",
    region: "offline",
    x: 230,
    y: 180,
    name: "Plan pipeline",
    does: "Reads both plans and finds where they meet",
    via: "Reads the public records",
    icon: Route,
    tone: "emerald",
    stat: { value: "114", label: "planned projects placed on the map" },
    points: [
      "Pulls 54 Dominion and 60 Georgia Power projects out of the PDFs",
      "Measures the closest point between every pair of lines",
      "Under 40 km apart is a match, priced with public cost data",
    ],
    tech: ["Python", "PyMuPDF", "Shapely", "pyproj"],
  },
  {
    id: "gpu",
    region: "offline",
    x: 230,
    y: 480,
    name: "Storm model",
    does: "Replays every past hurricane over both grids",
    via: "Also reads the public records",
    icon: Wind,
    tone: "emerald",
    stat: { value: "10,000", label: "runs per storm, on a GPU" },
    points: [
      "Rebuilds each storm's wind field hour by hour",
      "Asks which poles, towers and roadside trees fail, ten thousand times",
      "Plans crews with and without sharing, and prices every customer-hour out",
    ],
    tech: ["PyTorch", "CUDA", "NLCD tree canopy"],
  },
  {
    id: "static",
    region: "data",
    x: 520,
    y: 380,
    name: "Ready-made results",
    does: "Everything the pipeline found, saved as files",
    via: "Written by the plan pipeline",
    icon: FileJson,
    tone: "cyan",
    stat: { value: "14", label: "hurricanes replayed, ready before anyone asks" },
    points: [
      "50 places the plans meet, 29 of them close in time too",
      "Shipped with the site, so the map opens instantly",
      "Still works if every other service is down",
    ],
    tech: ["JSON", "~20 MB"],
  },
  {
    id: "tiger",
    region: "data",
    x: 520,
    y: 620,
    name: "Tiger Data",
    does: "Outage history, hour by hour",
    via: "Filled by the storm model",
    icon: Database,
    tone: "violet",
    stat: { value: "8", label: "tables, plus an hourly roll-up" },
    points: [
      "County outages stored as a time series",
      "An hourly roll-up answers charts without scanning raw rows",
      "If it stops answering, the app skips it for 60 seconds",
    ],
    tech: ["Postgres", "TimescaleDB", "Tiger Cloud"],
  },
  {
    id: "audio",
    region: "data",
    x: 520,
    y: 120,
    name: "Voice clips",
    does: "Storm briefings, recorded ahead of time",
    via: "Recorded ahead of time with ElevenLabs",
    icon: Volume2,
    tone: "cyan",
    stat: { value: "EN + ES", label: "briefings in two languages" },
    points: [
      "Written from the storm results, voiced once",
      "Play instantly during the demo",
      "Cost nothing per view",
    ],
    tech: ["MP3", "ElevenLabs"],
  },
  {
    id: "app",
    region: "browser",
    x: 840,
    y: 320,
    name: "Web app",
    does: "What the planner sees and clicks",
    via: "Opens the ready-made results",
    icon: Monitor,
    tone: "cyan",
    stat: { value: "4", label: "screens: Switchboard, Crosswire, Stormline, Ledger" },
    points: [
      "Loads the ready-made files and draws everything itself",
      "Only calls our server when a secret key is involved",
      "Built and deployed on every push to main",
    ],
    tech: ["Next.js 16", "React 19", "Tailwind 4"],
  },
  {
    id: "map",
    region: "browser",
    x: 760,
    y: 110,
    name: "Map",
    does: "Draws both plans and every storm",
    via: "Draws what the web app loads",
    icon: Map,
    tone: "cyan",
    stat: { value: "4", label: "match tiers: cross, 1.6 km, 8 km, 40 km" },
    points: [
      "Both utilities' planned lines, colour by company",
      "Storm tracks, wind fields and crew moves, animated",
      "Runs on the GPU, so thousands of lines stay smooth",
    ],
    tech: ["MapLibre", "deck.gl", "three.js"],
  },
  {
    id: "worker",
    region: "browser",
    x: 930,
    y: 110,
    name: "Match finder",
    does: "Ranks matches on the planner's own laptop",
    via: "Runs inside the web app",
    icon: Cpu,
    tone: "cyan",
    stat: { value: "3,240", label: "pairs of lines compared" },
    points: [
      "Every line of one utility against every line of the other",
      "Same rules as the pipeline, so rankings agree",
      "Runs in the background, the map never freezes",
    ],
    tech: ["Web Worker", "TypeScript"],
  },
  {
    id: "find",
    region: "server",
    x: 1100,
    y: 200,
    name: "Add a utility",
    does: "Finds and reads a plan we have never seen",
    via: "The web app sends it a utility's name",
    icon: Server,
    tone: "violet",
    stat: { value: "5", label: "steps streamed live: search, download, read, extract, place" },
    points: [
      "The planner types any utility's name",
      "Our server finds its public plan and has Gemini read it",
      "Progress streams back as it happens, no spinner",
    ],
    tech: ["Route handler", "NDJSON stream"],
  },
  {
    id: "explain",
    region: "server",
    x: 1100,
    y: 390,
    name: "Memo writer",
    does: "Turns a match into a memo and a phone call",
    via: "The web app asks it for a memo",
    icon: Server,
    tone: "violet",
    stat: { value: "~50 s", label: "call between the two planners" },
    points: [
      "A coordination memo for every match",
      "A short call script, voiced with two voices",
      "Falls back to a template if the AI is unavailable",
    ],
    tech: ["Route handler", "Node"],
  },
  {
    id: "storm",
    region: "server",
    x: 1100,
    y: 590,
    name: "Storm feed",
    does: "Outage charts and live storms",
    via: "The web app asks, Tiger Data answers",
    icon: Server,
    tone: "violet",
    stat: { value: "10 min", label: "live storm answers are kept" },
    points: [
      "Hourly outage charts for past storms",
      "Live Atlantic storms, measured to the SC–GA border",
      "Uses the ready-made files if the database is down",
    ],
    tech: ["Route handler", "Node"],
  },
  {
    id: "cache",
    region: "server",
    x: 1320,
    y: 300,
    name: "Answer cache",
    does: "Remembers every answer so we never pay twice",
    via: "Add a utility checks here first",
    icon: Boxes,
    tone: "emerald",
    stat: { value: "0", label: "AI calls for a question asked before" },
    points: [
      "Keeps every memo, call and place lookup",
      "Checks memory, then disk, then the AI",
      "Saves our small AI quota for new questions",
    ],
    tech: ["Memory", "Disk"],
  },
  {
    id: "nhc",
    region: "outside",
    x: 1550,
    y: 600,
    name: "Hurricane Center",
    does: "Where the live storms come from",
    via: "The storm feed checks it every 10 minutes",
    icon: CloudLightning,
    tone: "amber",
    stat: { value: "LIVE", label: "" },
    points: [
      "The National Hurricane Center's public feed",
      "Every storm measured to the border between the grids",
      "Within 1,200 km, both utilities are flagged",
    ],
    tech: ["NHC", "noaa.gov"],
  },
  {
    id: "gemini",
    region: "outside",
    x: 1550,
    y: 120,
    name: "Gemini",
    does: "Reads long PDFs and writes plain text",
    via: "The cache calls it when it has no answer",
    icon: Sparkles,
    tone: "amber",
    stat: { value: "1", label: "fixed format for every plan it reads" },
    points: [
      "Reads a utility's public plan into projects, the same shape every time",
      "Checks grant requirements against filings, quoting both word for word",
      "Refuses anything marked CEII",
    ],
    tech: ["Google AI", "Flash-Lite"],
  },
  {
    id: "elevenlabs",
    region: "outside",
    x: 1550,
    y: 280,
    name: "ElevenLabs",
    does: "Gives MrGridy a voice, and a way to listen",
    via: "Voices the memo writer's call scripts",
    icon: AudioLines,
    tone: "amber",
    stat: { value: "2", label: "voice agents, plus two voices per call" },
    points: [
      "Runs the Ask MrGridy agents on Stormline and Crosswire",
      "Voices the call between the two planners",
      "Records the storm briefings ahead of time",
    ],
    tech: ["Agents", "Text to Dialogue"],
  },
  {
    id: "osm",
    region: "outside",
    x: 1550,
    y: 440,
    name: "OpenStreetMap",
    does: "Turns place names into points on the map",
    via: "The cache calls it to place each project",
    icon: MapPin,
    tone: "amber",
    stat: { value: "1 / s", label: "polite, cached lookups" },
    points: [
      "Substation and town names become coordinates",
      "Road distances to staging yards",
      "Open data, no key needed",
    ],
    tech: ["Nominatim", "OSRM", "Overpass"],
  },
  {
    id: "savings",
    region: "server",
    x: 1320,
    y: 520,
    name: "Savings agent",
    does: "Finds grants each shared project could apply for",
    via: "Crosswire runs it on the matched pairs",
    icon: HandCoins,
    tone: "violet",
    stat: { value: "4", label: "steps, streamed live: grants, rules, verify, notes" },
    points: [
      "Searches Grants.gov and official .gov pages for programs that fund transmission",
      "Checks every project against each program's stated requirements",
      "Gemini marks a requirement met only by quoting the filing word for word",
    ],
    tech: ["Route handler", "NDJSON stream", "Gemini"],
  },
  {
    id: "grants",
    region: "outside",
    x: 1550,
    y: 760,
    name: "Grants.gov",
    does: "Open federal funding listings",
    via: "The savings agent searches it",
    icon: Landmark,
    tone: "amber",
    stat: { value: "0", label: "keys needed, it is a public API" },
    points: [
      "Open and forecast federal funding listings",
      "Energy and utility programs are kept and read in full",
      "Searched at most once a day, then cached",
    ],
    tech: ["Grants.gov API", "Search grounding"],
  },
  {
    id: "voice",
    region: "browser",
    x: 740,
    y: 565,
    name: "Ask MrGridy",
    does: "Answers planners out loud, from the data on screen",
    via: "Built into Stormline and Crosswire",
    icon: Mic,
    tone: "cyan",
    stat: { value: "28", label: "tools: 19 on Stormline, 9 on Crosswire" },
    points: [
      "Planners ask by voice: open Helene, who should help whom, what can we share",
      "Its tools run in the page, so every number it says comes from MrGridy's files",
      "Our server hands it a short-lived signed link; the key never reaches the browser",
    ],
    tech: ["ElevenLabs Agents", "Client tools"],
  },
];

export const PART: Record<string, Part> = Object.fromEntries(PARTS.map((p) => [p.id, p]));

export const EDGES: { a: string; b: string; backup?: boolean }[] = [
  { a: "sources", b: "pipeline" },
  { a: "sources", b: "gpu" },
  { a: "pipeline", b: "static" },
  { a: "gpu", b: "static" },
  { a: "gpu", b: "tiger" },
  { a: "static", b: "audio" },
  { a: "static", b: "app" },
  { a: "audio", b: "app" },
  { a: "app", b: "map" },
  { a: "app", b: "worker" },
  { a: "app", b: "find" },
  { a: "app", b: "explain" },
  { a: "app", b: "storm" },
  { a: "storm", b: "tiger" },
  { a: "storm", b: "static", backup: true },
  { a: "find", b: "cache" },
  { a: "explain", b: "cache" },
  { a: "storm", b: "nhc" },
  { a: "cache", b: "gemini" },
  { a: "cache", b: "elevenlabs" },
  { a: "cache", b: "osm" },
  { a: "app", b: "savings" },
  { a: "savings", b: "gemini" },
  { a: "savings", b: "grants" },
  { a: "app", b: "voice" },
  { a: "voice", b: "elevenlabs" },
];

/**
 * One chapter per part, in story order: each part is explained right after the
 * part it talks to. `spawn` are the blanks that grow out when a chapter starts.
 */
export const CHAPTERS: { fill: string; spawn: string[] }[] = [
  // Where two plans meet
  { fill: "sources", spawn: ["sources"] },
  { fill: "pipeline", spawn: ["pipeline"] },
  { fill: "static", spawn: ["static"] },
  { fill: "app", spawn: ["app"] },
  { fill: "map", spawn: ["map", "worker"] },
  { fill: "worker", spawn: [] },
  // When a hurricane hits
  { fill: "gpu", spawn: ["gpu"] },
  { fill: "tiger", spawn: ["tiger"] },
  { fill: "storm", spawn: ["storm"] },
  { fill: "nhc", spawn: ["nhc"] },
  // Reading new plans and briefing planners
  { fill: "find", spawn: ["find"] },
  { fill: "cache", spawn: ["cache"] },
  { fill: "gemini", spawn: ["gemini", "osm"] },
  { fill: "osm", spawn: [] },
  { fill: "explain", spawn: ["explain"] },
  { fill: "elevenlabs", spawn: ["elevenlabs"] },
  { fill: "audio", spawn: ["audio"] },
  // Agents that do the legwork
  { fill: "savings", spawn: ["savings"] },
  { fill: "grants", spawn: ["grants"] },
  { fill: "voice", spawn: ["voice"] },
];

/** The three stories the chapters are grouped into, by first chapter. */
export const ACTS: { from: number; title: string }[] = [
  { from: 0, title: "Where two plans meet" },
  { from: 6, title: "When a hurricane hits" },
  { from: 10, title: "Reading new plans and briefing planners" },
  { from: 17, title: "Agents that do the legwork" },
];

export interface Flow {
  title: string;
  caption: string;
  steps: { a: string; b: string; fail?: boolean }[][];
  storm?: boolean;
}

/** After the build: three real requests run through the finished system. */
export const FLOWS: Flow[] = [
  {
    title: "Opening the map",
    caption: "One file, drawn in the browser. No server, no database.",
    steps: [[{ a: "app", b: "static" }], [{ a: "static", b: "app" }], [{ a: "app", b: "map" }, { a: "app", b: "worker" }]],
  },
  {
    title: "Adding a new utility",
    caption: "Gemini reads its plan, OpenStreetMap places it, the cache keeps it.",
    steps: [
      [{ a: "app", b: "find" }],
      [{ a: "find", b: "cache" }],
      [{ a: "cache", b: "gemini" }],
      [{ a: "gemini", b: "cache" }],
      [{ a: "cache", b: "osm" }],
      [{ a: "osm", b: "cache" }],
      [{ a: "cache", b: "find" }],
      [{ a: "find", b: "app" }],
    ],
  },
  {
    title: "Asking MrGridy out loud",
    caption: "The agent calls tools that read the page, so every number it says comes from MrGridy's files.",
    steps: [
      [{ a: "app", b: "voice" }],
      [{ a: "voice", b: "elevenlabs" }],
      [{ a: "elevenlabs", b: "voice" }],
      [{ a: "voice", b: "app" }],
      [{ a: "app", b: "map" }],
    ],
  },
  {
    title: "When a storm takes the database down",
    caption: "The feed switches to the ready-made files. The chart still loads.",
    storm: true,
    steps: [
      [{ a: "app", b: "storm" }],
      [{ a: "storm", b: "tiger", fail: true }],
      [{ a: "storm", b: "static" }],
      [{ a: "static", b: "storm" }],
      [{ a: "storm", b: "app" }],
    ],
  },
];

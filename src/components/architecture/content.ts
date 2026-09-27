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
  Map,
  MapPin,
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
  tone: Tone;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const REGIONS: Region[] = [
  { id: "offline", name: "Before the demo", tone: "emerald", x: -120, y: 70, w: 470, h: 520 },
  { id: "data", name: "Our data", tone: "cyan", x: 420, y: 30, w: 200, h: 700 },
  { id: "browser", name: "In the browser", tone: "cyan", x: 668, y: 20, w: 336, h: 400 },
  { id: "server", name: "Our server", tone: "violet", x: 1016, y: 110, w: 404, h: 590 },
  { id: "outside", name: "Outside services", tone: "amber", x: 1446, y: 50, w: 208, h: 730 },
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
      "Asks which poles and towers fail, ten thousand times",
      "Plans crews with and without the two utilities sharing",
    ],
    tech: ["PyTorch", "CUDA", "RunPod"],
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
    stat: { value: "50", label: "overlaps ready before anyone asks" },
    points: [
      "Shipped with the site, so the map opens instantly",
      "No database needed to show the main screens",
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
    y: 680,
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
    y: 140,
    name: "Gemini",
    does: "Reads long PDFs and writes plain text",
    via: "The cache calls it when it has no answer",
    icon: Sparkles,
    tone: "amber",
    stat: { value: "1", label: "fixed format for every plan it reads" },
    points: [
      "Finds a utility's public plan on the web",
      "Reads the PDF into projects, in the same shape every time",
      "Refuses anything marked CEII",
    ],
    tech: ["Google AI", "Flash-Lite"],
  },
  {
    id: "elevenlabs",
    region: "outside",
    x: 1550,
    y: 320,
    name: "ElevenLabs",
    does: "Gives the call two real voices",
    via: "Voices the memo writer's call scripts",
    icon: AudioLines,
    tone: "amber",
    stat: { value: "2", label: "voices, one per utility" },
    points: [
      "Voices the call between the two planners",
      "Records the storm briefings",
      "A 50-second call says more than a paragraph",
    ],
    tech: ["Text to Dialogue"],
  },
  {
    id: "osm",
    region: "outside",
    x: 1550,
    y: 500,
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
];

/** The three stories the chapters are grouped into, by first chapter. */
export const ACTS: { from: number; title: string }[] = [
  { from: 0, title: "Where two plans meet" },
  { from: 6, title: "When a hurricane hits" },
  { from: 10, title: "Reading new plans and briefing planners" },
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

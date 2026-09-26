/**
 * GridSight data contract.
 *
 * The Python pipeline (pipeline/gridsight) writes JSON files into public/data/
 * that match these types exactly; the web app only reads them. Change a type
 * here and in pipeline/gridsight/contract.py together.
 *
 * Coordinates are always [longitude, latitude] (WGS84, GeoJSON order).
 * Distances are kilometres, dates are ISO strings ("2026-12-01").
 */

export type UtilityId = "DESC" | "GPC";

export interface Utility {
  id: UtilityId;
  name: string;
  state: "SC" | "GA";
  /** Hex colour used everywhere this utility appears. */
  color: string;
}

export type ProjectKind = "line" | "substation";

/** new = construct, rebuild = replace on same path, upgrade = equipment only */
export type ProjectAction = "new" | "rebuild" | "upgrade";

/**
 * How the map geometry was produced.
 * traced   = followed an existing line between two known substations
 * straight = straight line between endpoints (true route not public)
 * point    = substation location
 */
export type GeometryQuality = "traced" | "straight" | "point";

export type Position = [number, number];

export type ProjectGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] };

export interface SourceRef {
  /** Human title, e.g. "DESC Planned Transmission Projects 2026-2030". */
  document: string;
  url: string;
  /** 1-based page (or slide) number in the source document. */
  page: number | null;
}

export interface Project {
  id: string;
  utility: UtilityId;
  /** Owner tag from the filing, e.g. "DESC", "SOCO". */
  owner: string;
  name: string;
  kind: ProjectKind;
  action: ProjectAction;
  description: string;
  voltageKv: number[];
  miles: number | null;
  /** Endpoint / site names as written in the filing, e.g. ["Jasper", "Okatie"]. */
  places: string[];
  inService: string | null;
  /** Estimated build window [start, end]; end = inService. */
  buildWindow: [string, string] | null;
  costUsd: number | null;
  status: string | null;
  state: "SC" | "GA";
  geometry: ProjectGeometry;
  geometryQuality: GeometryQuality;
  /** 0..1 confidence that the geometry is in the right place. */
  locationConfidence: number;
  source: SourceRef;
}

/** Sperry tiers by closest-point distance. */
export type OverlapTier = "crossing" | "row" | "logistics" | "crew";

export const TIER_LIMIT_KM: Record<OverlapTier, number> = {
  crossing: 0,
  row: 1.6,
  logistics: 8,
  crew: 40,
};

export interface StagingYard {
  position: Position;
  label: string;
  driveMinutesDesc: number;
  driveMinutesGpc: number;
}

export interface CostEstimate {
  sharedCorridorKm: number;
  sharedAcres: number;
  landValuePerAcreUsd: number;
  landSavingsUsd: number;
  mobilizationSavingsUsd: number;
  yardSavingsUsd: number;
  totalUsd: number;
  assumptions: string[];
}

export interface Overlap {
  id: string;
  /** DESC project id. */
  descId: string;
  /** Georgia Power project id. */
  gpcId: string;
  distanceKm: number;
  tier: OverlapTier;
  /** Closest point on each project: [onDesc, onGpc]. */
  closestPoints: [Position, Position];
  /** Road distance between the closest points; null if not computed. */
  roadKm: number | null;
  /** true when the road distance is also within 40 km. */
  roadVerified: boolean | null;
  stagingYard: StagingYard | null;
  timelineOverlapMonths: number;
  robustness: "robust" | "uncertain";
  /** What the two projects could share, e.g. ["crews", "laydown yard"]. */
  shareable: string[];
  score: number;
  rank: number;
  cost: CostEstimate | null;
  /** One-paragraph plain-language summary. */
  summary: string;
}

export interface PlanMeta {
  generatedAt: string;
  utilities: Utility[];
  projectCount: Record<UtilityId, number>;
  pairsCompared: number;
  overlapsFound: number;
  /** Sperry's named overlaps and whether we found them. */
  knownMatches: { label: string; found: boolean; overlapId: string | null }[];
  sources: SourceRef[];
}

/* ---------------- Response mode ---------------- */

/**
 * One replayable storm. Files for a storm live in /data/response/<id>/
 * (storm.json, segments.json, counties.json, zones.json, yards.json,
 * vulnerable.json, meta.json). The list of storms is /data/response/storms.json.
 */
export interface StormIndexEntry {
  /** Folder name, e.g. "helene", "matthew". */
  id: string;
  name: string;
  year: number;
  /** One line shown in the picker, e.g. "Inland: Augusta and Aiken". */
  headline: string;
  focus: "inland" | "coastal";
  /** true when EAGLE-I actual outages are available to compare against. */
  validated: boolean;
  /** The storm opened by default. */
  featured: boolean;
}

export interface StormTrackPoint {
  time: string;
  position: Position;
  windKt: number;
  pressureMb: number | null;
  /** Radius of maximum wind, km (if known). */
  rmwKm: number | null;
}

export interface Storm {
  id: string;
  name: string;
  year: number;
  track: StormTrackPoint[];
  /** Replay "now" used for the before-landfall view. */
  replayStart: string;
}

/** A short section of transmission line with its simulated failure probability. */
export interface LineSegmentRisk {
  utility: UtilityId | "OTHER";
  coordinates: [Position, Position];
  peakWindMph: number;
  failureProbability: number;
}

export interface CountyOutage {
  fips: string;
  name: string;
  state: "SC" | "GA";
  customers: number;
  predictedPeakOut: number;
  actualPeakOut: number | null;
  centroid: Position;
}

export interface RepairZone {
  id: string;
  centroid: Position;
  utilities: UtilityId[];
  expectedDamagedSegments: number;
  vulnerablePeople: number;
  priority: number;
}

export interface JointYard {
  id: string;
  position: Position;
  label: string;
  serves: string[];
  maxDriveMinutes: number;
}

export interface VulnerableArea {
  zip: string;
  position: Position;
  electricityDependent: number;
}

export interface ResponseMeta {
  generatedAt: string;
  simulations: number;
  device: "cuda" | "cpu";
  validation: {
    countyMaePredicted: number | null;
    countyMaeBaseline: number | null;
    /** Public DESC figure for this storm, or null when none was published. */
    reportedDescTransmissionPoles: number | null;
    predictedDescTransmissionFailures: number | null;
  };
  /**
   * Leave-one-storm-out test: the outage model is trained on every other storm
   * and scored on this one. Optional; omitted when outage data is unavailable.
   */
  crossValidation?: {
    storm: string;
    maePredicted: number;
    maeBaseline: number;
  }[];
}

/* ---------------- Utility catalog (compare any two utilities) ---------------- */

/**
 * One utility MrGridy knows about. Its planned projects live in
 * /data/catalog/projects/<id>.json (CatalogProject[]); the list of utilities is
 * /data/catalog/utilities.json (CatalogUtility[]).
 */
export interface CatalogUtility {
  /** Stable slug, e.g. "desc", "georgia-power", "duke-carolinas", "tva". */
  id: string;
  name: string;
  shortName: string;
  /** Parent company, e.g. "Southern Company", "Duke Energy". */
  parent: string | null;
  states: string[];
  color: string;
  /** Where its public plan comes from. */
  planSources: SourceRef[];
  projectCount: number;
  locatedCount: number;
  /** "catalog" = parsed by the pipeline; "gemini" = found and extracted on demand. */
  origin: "catalog" | "gemini";
  /** Utilities it shares a border or region with (ids). */
  neighbors: string[];
}

/** A Project that belongs to any catalog utility (utility is the catalog id). */
export type CatalogProject = Omit<Project, "utility"> & { utility: string };

/** An overlap between two catalog utilities (a < b alphabetically by id). */
export type PairOverlap = Omit<Overlap, "descId" | "gpcId"> & {
  aId: string;
  bId: string;
};

/**
 * Precomputed comparison for one pair: /data/catalog/pairs/<a>__<b>.json
 * (ids sorted alphabetically). Pairs not precomputed can be computed in the
 * browser from the two project files with the same rules.
 */
export interface PairFile {
  a: string;
  b: string;
  generatedAt: string;
  pairsCompared: number;
  overlaps: PairOverlap[];
}

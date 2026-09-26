/**
 * Transmission lines as they look on the ground once zoomed in: towers at
 * every bend and along each span, with conductors sagging between them.
 * Existing lines are neutral steel; planned lines use the company colour;
 * projects being built at the current timeline month get a slow marching
 * dash (flat map) or an energising pulse along the 3D wires.
 *
 * Tower positions come from /data/context/structures.geojson when the
 * pipeline provides it, else they are placed along each line at realistic
 * spacing (adapted to zoom so the map never turns into a fence).
 *
 * Flat camera: crisp 2D tower icons with sagging wires (deck.gl).
 * Tilted camera: true 3D towers and wires (three.js, see three/Grid3D.ts).
 */
import type { Layer } from "@deck.gl/core";
import { IconLayer } from "@deck.gl/layers";
import type { LineCollection, PlanData } from "@/lib/data";
import {
  catenarySag,
  cumulativeMeters,
  dedupe,
  distanceMeters,
  metersPerPixel,
  offsetMeters,
  placeTowers,
  type Bbox,
  type Tower,
} from "@/lib/fx/geometry";
import { pointSegmentKm } from "@/lib/geo";
import { monthIndex, phaseAt } from "@/lib/timeline";
import type { Position, Project } from "@/lib/types";
import { FlowPathLayer, WirePathLayer } from "./shaderLayers";
import type { GridData3D } from "./three/Grid3D";
import { EARTH_WIRES, PHASES, TOWER_ICON_MAPPING, TOWER_STYLES } from "./towerIcon";

/** Flat tower icons appear from this zoom. */
export const TOWER_ZOOM = 9.5;
/** 3D towers appear from this zoom. */
export const TOWER_3D_ZOOM = 10.5;
/** Typical suspension-tower spacing for 115-230 kV lines, metres. */
const REAL_SPACING_M = 320;
/** Never closer than this on screen. */
const MIN_SPACING_PX = 64;
const MAX_TOWERS = 4000;
const WIRE_STEPS = 12;

type LineProject = Project & { geometry: { type: "LineString"; coordinates: Position[] } };

/** Real structure locations (optional pipeline output). */
export interface StructureFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Position };
  properties: { type?: string | null; lineId?: string | number | null; utility?: string | null } | null;
}
export interface StructureCollection {
  type: "FeatureCollection";
  features: StructureFeature[];
}

export interface PowerFxInput {
  plan: PlanData;
  radarMonth: number | null;
  focus: Set<string> | null;
  structures: StructureCollection | null;
}

export interface PowerFxFrame {
  zoom: number;
  bounds: Bbox;
}

export interface TowerRow extends Tower {
  pole: boolean;
  alpha: number;
}

export interface SpanRow {
  a: TowerRow;
  b: TowerRow;
  meters: number;
  style: number;
  alpha: number;
  building: boolean;
  along: number;
}

export interface TowerSet extends GridData3D {
  key: string;
  bbox: Bbox;
  towers: TowerRow[];
  spans: SpanRow[];
}

interface Source {
  path: Position[];
  style: number;
  project: LineProject | null;
}

const sourceCache = new WeakMap<object, Source[]>();

function contextPaths(fc: LineCollection): Position[][] {
  const out: Position[][] = [];
  for (const f of fc.features) {
    const g = f?.geometry;
    if (!g) continue;
    if (g.type === "LineString") out.push(g.coordinates);
    else if (g.type === "MultiLineString") out.push(...g.coordinates);
  }
  return out;
}

/** True when a context line runs along a project line (it would get a second row of towers). */
function followsProject(path: Position[], projects: LineProject[]): boolean {
  const probes = [path[0], path[Math.floor(path.length / 2)], path[path.length - 1]];
  return projects.some((p) => {
    const c = p.geometry.coordinates;
    return probes.every((q) => {
      for (let i = 1; i < c.length; i++) if (pointSegmentKm(q, c[i - 1], c[i]) < 0.15) return true;
      return false;
    });
  });
}

function sources(plan: PlanData, withContext: boolean): Source[] {
  const cacheKey = withContext ? plan : plan.projects;
  const hit = sourceCache.get(cacheKey);
  if (hit) return hit;
  // Approximate (straight) routes keep their dashed look: towers would suggest a surveyed route.
  const traced = plan.projects.filter(
    (p): p is LineProject => p.geometry.type === "LineString" && p.geometryQuality !== "straight",
  );
  const out: Source[] = [];
  if (withContext) {
    for (const path of contextPaths(plan.lines)) {
      const clean = dedupe(path);
      if (clean.length > 1 && !followsProject(clean, traced)) out.push({ path: clean, style: 0, project: null });
    }
  }
  for (const p of traced) out.push({ path: dedupe(p.geometry.coordinates), style: p.utility === "DESC" ? 1 : 2, project: p });
  sourceCache.set(cacheKey, out);
  return out;
}

function projectOpacity(p: Project, radarMonth: number | null, focus: Set<string> | null): number {
  let a = 1;
  if (radarMonth != null) {
    const phase = phaseAt(p, radarMonth);
    a = phase === "building" ? 1 : phase === "built" ? 0.6 : phase === "planned" ? 0.22 : 0.5;
  }
  if (focus && !focus.has(p.id)) a = Math.min(a, 0.35);
  return a;
}

/** Timeline month used for "under construction": the radar month, or today when the radar is off. */
export function constructionMonth(radarMonth: number | null): number {
  if (radarMonth != null) return radarMonth;
  return monthIndex(new Date().toISOString());
}

function inBbox(p: Position, b: Bbox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

/** Orders a line's structures end to end (nearest neighbour from one extreme). */
function chain(points: TowerRow[]): TowerRow[] {
  if (points.length < 3) return points;
  const cx = points.reduce((s, p) => s + p.position[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p.position[1], 0) / points.length;
  let start = 0;
  let far = -1;
  points.forEach((p, i) => {
    const d = (p.position[0] - cx) ** 2 + (p.position[1] - cy) ** 2;
    if (d > far) {
      far = d;
      start = i;
    }
  });
  const left = points.slice();
  const out = [left.splice(start, 1)[0]];
  while (left.length) {
    const last = out[out.length - 1].position;
    let best = 0;
    let bd = Infinity;
    left.forEach((p, i) => {
      const d = (p.position[0] - last[0]) ** 2 + (p.position[1] - last[1]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}

function unit(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

function structureTowers(fc: StructureCollection, bbox: Bbox, keep: number): { towers: TowerRow[]; spans: SpanRow[] } {
  const byLine = new Map<string, TowerRow[]>();
  for (const f of fc.features) {
    const c = f?.geometry?.coordinates;
    if (!c || !inBbox(c, bbox)) continue;
    const key = String(f.properties?.lineId ?? "?");
    let list = byLine.get(key);
    if (!list) byLine.set(key, (list = []));
    list.push({ position: c, arm: [1, 0], style: 0, pole: f.properties?.type === "pole", alpha: 0.95 });
  }
  const towers: TowerRow[] = [];
  const spans: SpanRow[] = [];
  const stride = Math.max(1, Math.ceil([...byLine.values()].reduce((s, l) => s + l.length, 0) / keep));
  for (const list of byLine.values()) {
    const ordered = chain(list).filter((_, i, arr) => i % stride === 0 || i === arr.length - 1);
    let along = 0;
    ordered.forEach((t, i) => {
      const prev = ordered[Math.max(0, i - 1)].position;
      const next = ordered[Math.min(ordered.length - 1, i + 1)].position;
      const d = unit(offsetMeters(prev, next));
      t.arm = [-d[1], d[0]];
      towers.push(t);
      if (i > 0) {
        const a = ordered[i - 1];
        const meters = distanceMeters(a.position, t.position);
        // Gaps in the survey are not wired across.
        if (meters < 1500 * stride) spans.push({ a, b: t, meters, style: 0, alpha: 0.95, building: false, along });
        along += meters;
      }
    });
  }
  return { towers, spans };
}

/**
 * Towers and spans for the current view. Regenerated only when the zoom
 * bucket, the timeline month or the selection changes, or when the camera
 * leaves the padded area generated last time.
 */
export class TowerField {
  private set: TowerSet | null = null;

  get(input: PowerFxInput, frame: PowerFxFrame, dataKey: string): TowerSet {
    const bucket = Math.floor(frame.zoom * 2) / 2;
    const [w, s, e, n] = frame.bounds;
    const key = `${dataKey}|${bucket}`;
    const cur = this.set;
    if (cur && cur.key === key && w >= cur.bbox[0] && s >= cur.bbox[1] && e <= cur.bbox[2] && n <= cur.bbox[3]) return cur;
    const padX = (e - w) * 0.6;
    const padY = (n - s) * 0.6;
    const bbox: Bbox = [w - padX, s - padY, e + padX, n + padY];
    const month = constructionMonth(input.radarMonth);
    let spacing = Math.max(REAL_SPACING_M, MIN_SPACING_PX * metersPerPixel(bucket, (s + n) / 2));
    let towers: TowerRow[] = [];
    let spans: SpanRow[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      towers = [];
      spans = [];
      if (input.structures) {
        const real = structureTowers(input.structures, bbox, MAX_TOWERS / 2);
        towers.push(...real.towers);
        spans.push(...real.spans);
      }
      for (const src of sources(input.plan, !input.structures)) {
        const alpha = src.project ? projectOpacity(src.project, input.radarMonth, input.focus) : 0.9;
        const building = !!src.project && phaseAt(src.project, month) === "building";
        const placed = placeTowers(src.path, spacing, src.style, bbox);
        const rows = new Map<Tower, TowerRow>();
        for (const t of placed.towers) {
          const row: TowerRow = { ...t, pole: false, alpha };
          rows.set(t, row);
          towers.push(row);
        }
        let along = 0;
        for (const sp of placed.spans) {
          spans.push({ a: rows.get(sp.a)!, b: rows.get(sp.b)!, meters: sp.meters, style: sp.style, alpha, building, along });
          along += sp.meters;
        }
      }
      if (towers.length <= MAX_TOWERS) break;
      spacing *= 1.6;
    }
    // Context towers first, company towers on top.
    towers.sort((a, b) => a.style - b.style || b.position[1] - a.position[1]);
    this.set = { key, bbox, towers, spans };
    return this.set;
  }
}

/* ---------------- flat (2D) rendering ---------------- */

interface Wire {
  path: Position[];
  attach: number[];
  span: number;
  earth: boolean;
  alpha: number;
}

const wireCache = new WeakMap<TowerSet, Wire[]>();

function attachAt(t: Tower, [x, y]: [number, number]): [number, number] {
  // Screen-aligned offset of a cross-arm point; the along-north part reads as depth.
  return [x * t.arm[0], y + x * t.arm[1] * 0.35];
}

/** Two wires per span keep the flat view light: the conductor bundle and the earth wire. */
function flatWires(set: TowerSet): Wire[] {
  const hit = wireCache.get(set);
  if (hit) return hit;
  const out: Wire[] = [];
  const pick: [[number, number], boolean][] = [
    [PHASES[1], false],
    [EARTH_WIRES[0], true],
  ];
  for (const sp of set.spans) {
    for (const [pt, earth] of pick) {
      const a = attachAt(sp.a, [earth ? 0 : pt[0], pt[1]]);
      const b = attachAt(sp.b, [earth ? 0 : pt[0], pt[1]]);
      const path: Position[] = [];
      const attach: number[] = [];
      for (let k = 0; k <= WIRE_STEPS; k++) {
        const u = k / WIRE_STEPS;
        path.push([
          sp.a.position[0] + (sp.b.position[0] - sp.a.position[0]) * u,
          sp.a.position[1] + (sp.b.position[1] - sp.a.position[1]) * u,
        ]);
        attach.push(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, catenarySag(u));
      }
      out.push({ path, attach, span: sp.meters, earth, alpha: sp.alpha });
    }
  }
  wireCache.set(set, out);
  return out;
}

const getTowerPosition = (t: TowerRow) => t.position;
const getTowerIcon = (t: TowerRow) => `${TOWER_STYLES[t.style]}-${Math.abs(t.arm[0]) >= 0.5 ? "face" : "side"}`;
const getTowerColor = (t: TowerRow): [number, number, number, number] => [255, 255, 255, Math.round(255 * t.alpha)];
const getWirePath = (w: Wire) => w.path;
const getWireAttach = (w: Wire) => w.attach;
const getWireSpan = (w: Wire) => w.span;
const getWireColor = (w: Wire): [number, number, number, number] =>
  w.earth ? [90, 96, 108, Math.round(110 * w.alpha)] : [38, 42, 50, Math.round(185 * w.alpha)];
const getWireWidth = (w: Wire) => (w.earth ? 0.6 : 1);

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 0..1 fade for flat towers around TOWER_ZOOM. */
export function towerFade(zoom: number): number {
  return smoothstep(TOWER_ZOOM - 0.2, TOWER_ZOOM + 0.25, zoom);
}

/** 0..1 blend from flat icons to 3D towers as the camera tilts. */
export function tiltBlend(pitch: number): number {
  return smoothstep(10, 30, pitch);
}

export function towerPx(zoom: number): number {
  return Math.max(18, Math.min(38, 20 + (zoom - TOWER_ZOOM) * 5));
}

export function flatTowerLayers(set: TowerSet, atlas: HTMLCanvasElement | null, zoom: number, opacity: number): Layer[] {
  if (opacity <= 0.01) return [];
  const px = towerPx(zoom);
  const layers: Layer[] = [
    new WirePathLayer<Wire>({
      id: "fx-wires",
      data: flatWires(set),
      getPath: getWirePath,
      getAttach: getWireAttach,
      getSpan: getWireSpan,
      getColor: getWireColor,
      getWidth: getWireWidth,
      widthUnits: "pixels",
      opacity,
      towerPx: px,
      sagRatio: 0.07,
      maxSag: 0.3,
    }),
  ];
  if (atlas) {
    layers.push(
      new IconLayer<TowerRow>({
        id: "fx-towers",
        data: set.towers,
        iconAtlas: atlas as unknown as string,
        iconMapping: TOWER_ICON_MAPPING,
        getIcon: getTowerIcon,
        getPosition: getTowerPosition,
        getColor: getTowerColor,
        getSize: 1,
        sizeScale: px,
        sizeUnits: "pixels",
        opacity,
        alphaCutoff: 0.02,
      }),
    );
  }
  return layers;
}

/* ---------------- construction (flat) ---------------- */

interface BuildRow {
  path: Position[];
  distances: number[];
}

const buildCache = new WeakMap<PlanData, Map<string, BuildRow>>();

function buildRow(plan: PlanData, p: LineProject): BuildRow {
  let m = buildCache.get(plan);
  if (!m) {
    m = new Map();
    buildCache.set(plan, m);
  }
  let row = m.get(p.id);
  if (!row) {
    const path = dedupe(p.geometry.coordinates);
    row = { path, distances: cumulativeMeters(path) };
    m.set(p.id, row);
  }
  return row;
}

const buildGetPath = (d: BuildRow) => d.path;
const buildGetDistances = (d: BuildRow) => d.distances;
const BUILD_COLOR: [number, number, number, number] = [255, 252, 244, 235];

let buildMemo: { plan: PlanData; key: string; rows: BuildRow[] } | null = null;

function buildingRows(input: PowerFxInput): BuildRow[] {
  const month = Math.floor(constructionMonth(input.radarMonth));
  const key = `${month}|${input.focus ? [...input.focus].join(",") : ""}`;
  if (buildMemo && buildMemo.plan === input.plan && buildMemo.key === key) return buildMemo.rows;
  const rows = input.plan.projects
    .filter((p): p is LineProject => p.geometry.type === "LineString" && phaseAt(p, month) === "building")
    .filter((p) => !input.focus || input.focus.has(p.id))
    .map((p) => buildRow(input.plan, p));
  buildMemo = { plan: input.plan, key, rows };
  return rows;
}

export function constructionLayer(input: PowerFxInput, time: number, opacity = 1): Layer | null {
  const rows = buildingRows(input);
  if (!rows.length || opacity <= 0.01) return null;
  return new FlowPathLayer<BuildRow>({
    id: "fx-construction",
    data: rows,
    getPath: buildGetPath,
    getDistances: buildGetDistances,
    getColor: BUILD_COLOR,
    getWidth: 1.7,
    widthUnits: "pixels",
    capRounded: true,
    opacity,
    time,
    flowMode: "march",
    flowSpeed: 9,
    flowSpacing: 13,
    flowDashLength: 0.5,
  });
}

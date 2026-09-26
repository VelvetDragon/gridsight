/**
 * Towers and spans for the selected pair of planned lines, rendered in 3D by
 * three/Grid3D.ts. Only the two projects of the selected match get towers,
 * and only when zoomed in, so the overview map stays calm.
 *
 * Tower positions come from /data/context/structures.geojson when the
 * pipeline provides points on these lines, else they are placed along each
 * line at realistic spacing (adapted to zoom so they never crowd).
 */
import type { PlanData } from "@/lib/data";
import { dedupe, distanceMeters, metersPerPixel, offsetMeters, placeTowers, type Bbox, type Tower } from "@/lib/fx/geometry";
import type { Position, Project } from "@/lib/types";
import type { GridData3D } from "./three/Grid3D";

/** Towers appear from this zoom. */
export const TOWER_ZOOM = 12;
/** Typical suspension-tower spacing for 115-230 kV lines, metres. */
const REAL_SPACING_M = 320;
/** Never closer than this on screen. */
const MIN_SPACING_PX = 56;
const MAX_TOWERS = 3000;
/** Structure points further than this from a selected line belong to another line. */
const STRUCTURE_SNAP_KM = 0.08;

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
  /** Ids of the projects that get towers (the selected match), or null for none. */
  towerIds: Set<string> | null;
  structures: StructureCollection | null;
}

export interface PowerFxFrame {
  zoom: number;
  bounds: Bbox;
}

export interface TowerRow extends Tower {
  pole: boolean;
}

export interface SpanRow {
  a: TowerRow;
  b: TowerRow;
  meters: number;
  style: number;
  building: boolean;
  along: number;
}

export interface TowerSet extends GridData3D {
  key: string;
  bbox: Bbox;
  towers: TowerRow[];
  spans: SpanRow[];
}

function unit(v: [number, number]): [number, number] {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Distance (km) from p to a polyline and how far along it (m) the nearest point is. */
function nearLine(p: Position, line: Position[]): { d: number; along: number } {
  let best = Infinity;
  let along = 0;
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const ab = offsetMeters(line[i - 1], line[i]);
    const ap = offsetMeters(line[i - 1], p);
    const len2 = ab[0] ** 2 + ab[1] ** 2 || 1;
    const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / len2));
    const d = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t);
    const seg = Math.sqrt(len2);
    if (d < best) {
      best = d;
      along = acc + seg * t;
    }
    acc += seg;
  }
  return { d: best / 1000, along };
}

/** Real structures that sit on a line, ordered along it. */
function structuresOn(fc: StructureCollection, line: Position[], style: number): TowerRow[] {
  const hits: { t: TowerRow; along: number }[] = [];
  for (const f of fc.features) {
    const c = f?.geometry?.coordinates;
    if (!c) continue;
    const { d, along } = nearLine(c, line);
    if (d <= STRUCTURE_SNAP_KM) hits.push({ t: { position: c, arm: [1, 0], style, pole: f.properties?.type === "pole" }, along });
  }
  hits.sort((a, b) => a.along - b.along);
  const out = hits.map((h) => h.t);
  out.forEach((t, i) => {
    const d = unit(offsetMeters(out[Math.max(0, i - 1)].position, out[Math.min(out.length - 1, i + 1)].position));
    t.arm = [-d[1], d[0]];
  });
  return out;
}

/**
 * Towers and spans for the current view. Regenerated only when the zoom
 * bucket or selection changes, or when the camera leaves the padded area
 * generated last time.
 */
export class TowerField {
  private set: TowerSet | null = null;

  get(input: PowerFxInput, frame: PowerFxFrame, dataKey: string): TowerSet | null {
    const ids = input.towerIds;
    if (!ids?.size) return null;
    const bucket = Math.floor(frame.zoom * 2) / 2;
    const [w, s, e, n] = frame.bounds;
    const key = `${dataKey}|${bucket}`;
    const cur = this.set;
    if (cur && cur.key === key && w >= cur.bbox[0] && s >= cur.bbox[1] && e <= cur.bbox[2] && n <= cur.bbox[3]) return cur;
    const padX = (e - w) * 0.6;
    const padY = (n - s) * 0.6;
    const bbox: Bbox = [w - padX, s - padY, e + padX, n + padY];
    const spacing = Math.max(REAL_SPACING_M, MIN_SPACING_PX * metersPerPixel(bucket, (s + n) / 2));
    const towers: TowerRow[] = [];
    const spans: SpanRow[] = [];
    // Approximate (straight) routes keep their dashed look: towers would suggest a surveyed route.
    const lines = input.plan.projects.filter(
      (p): p is LineProject => p.geometry.type === "LineString" && p.geometryQuality !== "straight" && ids.has(p.id),
    );
    for (const p of lines) {
      const path = dedupe(p.geometry.coordinates);
      if (path.length < 2) continue;
      const style = p.utility === "DESC" ? 1 : 2;
      const kv = Math.max(0, ...p.voltageKv);
      const real = input.structures ? structuresOn(input.structures, path, style) : [];
      if (real.length < 2) {
        const placed = placeTowers(path, spacing, style, bbox);
        const rowOf = new Map<Tower, TowerRow>();
        for (const t of placed.towers) {
          const row = { ...t, pole: kv > 0 && kv < 100 };
          rowOf.set(t, row);
          towers.push(row);
        }
        let along = 0;
        for (const sp of placed.spans) {
          spans.push({ a: rowOf.get(sp.a)!, b: rowOf.get(sp.b)!, meters: sp.meters, style, building: false, along });
          along += sp.meters;
        }
        continue;
      }
      const rows = real;
      let along = 0;
      rows.forEach((t, i) => {
        towers.push(t);
        if (i === 0) return;
        const a = rows[i - 1];
        const meters = distanceMeters(a.position, t.position);
        spans.push({ a, b: t, meters, style, building: false, along });
        along += meters;
      });
      if (towers.length > MAX_TOWERS) break;
    }
    this.set = { key, bbox, towers, spans };
    return this.set;
  }
}

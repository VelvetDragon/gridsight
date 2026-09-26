"use client";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { IconLayer, PathLayer } from "@deck.gl/layers";
import type { ReactNode } from "react";
import { corridorHalfWidth, hatchedCorridor } from "@/lib/corridor";
import type { LineCollection, PlanData } from "@/lib/data";
import { fmtKm } from "@/lib/format";
import { midpoint } from "@/lib/geo";
import { ICON_CHEVRON, ICON_STATION, ICON_STATION_HALO, ICON_STATION_HOLLOW } from "@/lib/glyphs";
import type { RankedOverlap } from "@/lib/ranking";
import { INK, RIVER, TIER_HEX, TIER_RGB, tierFull, UTILITY_HEX, UTILITY_NAME, UTILITY_RGB } from "@/lib/theme";
import { phaseAt } from "@/lib/timeline";
import type { Overlap, Position, Project } from "@/lib/types";
import { isShiftClick, type MapClickEvent, type MapMarker } from "./MapCanvas";
import {
  distanceLabel,
  pointAlong,
  projectLabel,
  selectionLabel,
  shortName,
  stateLabelMarkers,
  yardMarker,
} from "./mapLabels";

/** Drive-time shapes for the selected pair (isochrones), when the data teammate provides them. */
export interface ReachCollection {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };
    properties?: { minutes?: number; label?: string } | null;
  }[];
}

export interface PlanSceneProps {
  data: PlanData;
  ranked: RankedOverlap[];
  projectsById: Map<string, Project>;
  /** The selected pair (overlap id). */
  selectedId: string | null;
  /** Construction radar month (0 = Jan 2026) or null when the radar is off. */
  radarMonth: number | null;
  /** Lines and stations the user picked ("your lines"). */
  selectedProjects: Set<string>;
  reach: ReachCollection | null;
  /** State names on the map (only meaningful for the Georgia / South Carolina pair). */
  showStateLabels: boolean;
  onSelectOverlap: (id: string) => void;
  onProjectClick: (project: Project, at: Position, additive: boolean) => void;
  onEmptyClick: () => void;
}

const dashes = new PathStyleExtension({ dash: true });
const PAPER4: [number, number, number, number] = [250, 248, 244, 255];

interface ContextPath {
  path: Position[];
  kv: number;
}

export function flattenLines(fc: LineCollection): ContextPath[] {
  const out: ContextPath[] = [];
  for (const f of fc.features) {
    if (!f?.geometry) continue;
    const raw = f.properties?.voltage;
    const kv = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? "")) || 0;
    if (f.geometry.type === "LineString") out.push({ path: f.geometry.coordinates, kv });
    else if (f.geometry.type === "MultiLineString") for (const p of f.geometry.coordinates) out.push({ path: p, kv });
  }
  return out;
}

/** Existing lines are background hairlines: just enough to show the network. */
function contextWidth(kv: number): number {
  if (kv >= 400) return 0.9;
  if (kv >= 200) return 0.7;
  return 0.55;
}

export function riverLayers(river: LineCollection, id = "river"): Layer[] {
  const paths = flattenLines(river);
  return [
    new PathLayer<ContextPath>({
      id: `${id}-wash`,
      data: paths,
      getPath: (d) => d.path,
      getColor: [...RIVER, 46],
      getWidth: 10,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
    }),
    new PathLayer<ContextPath>({
      id: `${id}-core`,
      data: paths,
      getPath: (d) => d.path,
      getColor: [...RIVER, 140],
      getWidth: 1.6,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
    }),
  ];
}

export function contextLineLayer(lines: LineCollection, id = "context-lines", alpha = 48): Layer {
  return new PathLayer<ContextPath>({
    id,
    data: flattenLines(lines),
    getPath: (d) => d.path,
    getColor: [...INK, alpha],
    getWidth: (d) => contextWidth(d.kv),
    widthUnits: "pixels",
  });
}

/** Already built (or reported complete): drawn hollow, as reference. */
export function isBuilt(p: Project, now = Date.now()): boolean {
  if (p.status && /complete|in service|energi[sz]ed|placed in service/i.test(p.status)) return true;
  return !!p.inService && Date.parse(p.inService) < now;
}

/** Opacity for a project given the radar and the current focus. */
function projectAlpha(p: Project, radarMonth: number | null, focus: Set<string> | null): number {
  let a = 255;
  if (radarMonth != null) {
    const phase = phaseAt(p, radarMonth);
    a = phase === "building" ? 255 : phase === "built" ? 110 : phase === "planned" ? 34 : 90;
  }
  if (focus && focus.size && !focus.has(p.id)) a = Math.min(a, 64);
  return a;
}

type LineProject = Project & { geometry: { type: "LineString"; coordinates: Position[] } };
type PointProject = Project & { geometry: { type: "Point"; coordinates: Position } };

/** Where to draw a line's direction chevron, and which way it points (deck angle, degrees). */
function chevronOf(p: LineProject): { at: Position; angle: number } {
  const c = p.geometry.coordinates;
  const at = pointAlong(c, c[0], 0.55);
  // Direction of build: first place → last place in the filing.
  const i = Math.max(1, Math.min(c.length - 1, Math.round((c.length - 1) * 0.55)));
  const a = c[i - 1];
  const b = c[i];
  const k = Math.cos((at[1] * Math.PI) / 180);
  const angle = (Math.atan2(b[1] - a[1], (b[0] - a[0]) * k) * 180) / Math.PI;
  return { at, angle };
}

export function buildPlanLayers(props: PlanSceneProps): Layer[] {
  const { data, ranked, selectedId, radarMonth, selectedProjects, reach } = props;
  const selected = ranked.find((r) => r.overlap.id === selectedId)?.overlap ?? null;
  const focus = selected ? new Set([selected.descId, selected.gpcId]) : selectedProjects.size ? selectedProjects : null;
  const selKey = [...selectedProjects].join(",");
  const trigger = `${radarMonth == null ? "off" : Math.floor(radarMonth)}|${selectedId ?? ""}|${selKey}`;
  const now = Date.now();

  const lineProjects = data.projects.filter((p): p is LineProject => p.geometry.type === "LineString");
  const pointProjects = data.projects.filter((p): p is PointProject => p.geometry.type === "Point");
  const alphaOf = (p: Project) => projectAlpha(p, radarMonth, focus);
  const color = (p: Project): [number, number, number, number] => [...UTILITY_RGB[p.utility], alphaOf(p)];
  const width = (p: Project) => (focus?.has(p.id) ? 4.5 : 3.4);

  const layers: Layer[] = [contextLineLayer(data.lines), ...riverLayers(data.river)];

  // Crew reach: real drive-time shapes when available.
  if (selected && reach?.features.length) {
    const rings: { path: Position[]; minutes: number | null }[] = [];
    for (const f of reach.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) rings.push({ path: poly[0], minutes: f.properties?.minutes ?? null });
    }
    layers.push(
      new PathLayer<(typeof rings)[number], PathStyleExtensionProps<(typeof rings)[number]>>({
        id: "reach-outline",
        data: rings,
        getPath: (d) => d.path,
        getColor: [...INK, 120],
        getWidth: 1.2,
        widthUnits: "pixels",
        getDashArray: [5, 3],
        dashJustified: true,
        extensions: [dashes],
      }),
    );
  }

  // Dotted links between each pair's measured points, under the projects.
  const connectorData = ranked.map((r) => r.overlap).filter((o) => o.distanceKm > 0);
  layers.push(
    new PathLayer<Overlap, PathStyleExtensionProps<Overlap>>({
      id: "overlap-connectors",
      data: connectorData,
      getPath: (o) => o.closestPoints,
      getColor: (o) => (o.id === selectedId ? [...INK, 255] : [...TIER_RGB[o.tier], selected ? 50 : 200]),
      getWidth: (o) => (o.id === selectedId ? 2.2 : 1.3),
      widthUnits: "pixels",
      getDashArray: [2, 3],
      dashJustified: true,
      dashGapPickable: true,
      extensions: [dashes],
      pickable: true,
      updateTriggers: { getColor: trigger, getWidth: trigger },
    }),
  );

  // The shared zone of the selected pair: a hatched, hand-drawn corridor.
  if (selected) {
    const c = hatchedCorridor(
      selected.closestPoints[0],
      selected.closestPoints[1],
      corridorHalfWidth(selected.distanceKm),
      selected.rank || 1,
    );
    layers.push(
      new PathLayer<[Position, Position]>({
        id: "corridor-hatch",
        data: c.hatches,
        getPath: (d) => d,
        getColor: [...INK, 120],
        getWidth: 1,
        widthUnits: "pixels",
        capRounded: true,
      }),
      new PathLayer<{ path: Position[] }>({
        id: "corridor-outline",
        data: [{ path: c.outline }],
        getPath: (d) => d.path,
        getColor: [...INK, 190],
        getWidth: 1.4,
        widthUnits: "pixels",
        jointRounded: true,
        capRounded: true,
      }),
    );
  }

  // Your picked lines get a soft ink underlay.
  if (selectedProjects.size) {
    layers.push(
      new PathLayer<LineProject>({
        id: "selection-underlay",
        data: lineProjects.filter((p) => selectedProjects.has(p.id)),
        getPath: (p) => p.geometry.coordinates,
        getColor: [...INK, 70],
        getWidth: 12,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
      }),
    );
  }

  const built = (p: Project) => isBuilt(p, now);
  const planned = lineProjects.filter((p) => !built(p));
  const done = lineProjects.filter((p) => built(p));

  layers.push(
    new PathLayer<LineProject>({
      id: "project-line-halo",
      data: lineProjects,
      getPath: (p) => p.geometry.coordinates,
      getColor: (p) => [250, 248, 244, Math.round(alphaOf(p) * 0.85)],
      getWidth: 8,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      updateTriggers: { getColor: trigger },
    }),
    new PathLayer<LineProject>({
      id: "project-lines",
      data: planned.filter((p) => p.geometryQuality !== "straight"),
      getPath: (p) => p.geometry.coordinates,
      getColor: color,
      getWidth: width,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: true,
      updateTriggers: { getColor: trigger, getWidth: trigger },
    }),
    // Approximate routes (straight between endpoints) are dashed, so nobody reads them as surveyed.
    new PathLayer<LineProject, PathStyleExtensionProps<LineProject>>({
      id: "project-lines-approx",
      data: planned.filter((p) => p.geometryQuality === "straight"),
      getPath: (p) => p.geometry.coordinates,
      getColor: color,
      getWidth: width,
      widthUnits: "pixels",
      getDashArray: [3, 1.6],
      dashJustified: true,
      dashGapPickable: true,
      extensions: [dashes],
      pickable: true,
      updateTriggers: { getColor: trigger, getWidth: trigger },
    }),
    // Built lines are hollow: a coloured casing with a paper core.
    new PathLayer<LineProject>({
      id: "project-lines-built",
      data: done,
      getPath: (p) => p.geometry.coordinates,
      getColor: color,
      getWidth: 4.2,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: true,
      updateTriggers: { getColor: trigger },
    }),
    new PathLayer<LineProject>({
      id: "project-lines-built-core",
      data: done,
      getPath: (p) => p.geometry.coordinates,
      getColor: (p) => [250, 248, 244, alphaOf(p)],
      getWidth: 1.6,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      updateTriggers: { getColor: trigger },
    }),
    // Direction of build.
    new IconLayer<LineProject>({
      id: "project-direction",
      data: planned,
      getIcon: () => ICON_CHEVRON,
      getPosition: (p) => chevronOf(p).at,
      getAngle: (p) => chevronOf(p).angle,
      getSize: 13,
      sizeUnits: "pixels",
      getColor: color,
      updateTriggers: { getColor: trigger },
    }),
    // Stations as small squares; hollow once built.
    new IconLayer<PointProject>({
      id: "project-station-halo",
      data: pointProjects,
      getIcon: () => ICON_STATION_HALO,
      getPosition: (p) => p.geometry.coordinates,
      getSize: (p) => (focus?.has(p.id) ? 20 : 16),
      sizeUnits: "pixels",
      getColor: (p) => [PAPER4[0], PAPER4[1], PAPER4[2], alphaOf(p)],
      updateTriggers: { getColor: trigger, getSize: trigger },
    }),
    new IconLayer<PointProject>({
      id: "project-stations",
      data: pointProjects,
      getIcon: (p) => (built(p) ? ICON_STATION_HOLLOW : ICON_STATION),
      getPosition: (p) => p.geometry.coordinates,
      getSize: (p) => (focus?.has(p.id) ? 17 : 13),
      sizeUnits: "pixels",
      getColor: color,
      pickable: true,
      updateTriggers: { getColor: trigger, getSize: trigger },
    }),
  );

  return layers;
}

export function planMarkers(props: PlanSceneProps): MapMarker[] {
  const { ranked, selectedId, radarMonth, projectsById, selectedProjects, reach } = props;
  const markers: MapMarker[] = props.showStateLabels ? stateLabelMarkers() : [];
  const selected = ranked.find((r) => r.overlap.id === selectedId)?.overlap;

  if (selected) {
    const mid = midpoint(selected.closestPoints[0], selected.closestPoints[1]);
    const sides: ["DESC" | "GPC", string, number, "above" | "below"][] = [
      ["DESC", selected.descId, 0, "above"],
      ["GPC", selected.gpcId, 1, "below"],
    ];
    for (const [utility, pid, idx, placement] of sides) {
      const p = projectsById.get(pid);
      if (!p) continue;
      const at =
        p.geometry.type === "Point"
          ? p.geometry.coordinates
          : pointAlong(p.geometry.coordinates, selected.closestPoints[idx]);
      markers.push(projectLabel(`label-${utility}`, at, utility, p.name, placement));
    }
    markers.push(distanceLabel("distance", mid, selected.distanceKm, selected.distanceKm === 0));
    if (selected.stagingYard) {
      markers.push(
        yardMarker(`yard-${selected.id}`, selected.stagingYard.position, "Shared yard", selected.stagingYard.label),
      );
    }
    // Drive-time labels on the reach shapes.
    for (const [i, f] of (reach?.features ?? []).entries()) {
      const minutes = f.properties?.minutes;
      const ring = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0]?.[0];
      if (!ring?.length || minutes == null) continue;
      const top = ring.reduce((a, b) => (b[1] > a[1] ? b : a), ring[0]);
      markers.push({
        id: `reach-${i}`,
        position: top,
        node: (
          <span className="gs-passive rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-2">
            {f.properties?.label ?? `${minutes} min drive`}
          </span>
        ),
      });
    }
  } else {
    // Your picked lines, labelled in type.
    for (const id of selectedProjects) {
      const p = projectsById.get(id);
      if (!p) continue;
      const at =
        p.geometry.type === "Point"
          ? p.geometry.coordinates
          : pointAlong(p.geometry.coordinates, p.geometry.coordinates[0], 0.5);
      markers.push(selectionLabel(`sel-${id}`, at, p, isBuilt(p)));
    }
  }

  if (radarMonth != null) {
    for (const r of ranked) {
      const a = projectsById.get(r.overlap.descId);
      const b = projectsById.get(r.overlap.gpcId);
      if (!a || !b) continue;
      if (phaseAt(a, radarMonth) === "building" && phaseAt(b, radarMonth) === "building") {
        const o = r.overlap;
        markers.push({
          id: `pulse-${o.id}`,
          position: midpoint(o.closestPoints[0], o.closestPoints[1]),
          onClick: () => props.onSelectOverlap(o.id),
          node: (
            <button
              type="button"
              aria-label={`Both projects under construction: pair #${r.rank}`}
              className="relative block h-3.5 w-3.5 cursor-pointer rounded-full"
            >
              <span className="gs-pulse" style={{ borderColor: TIER_HEX[o.tier] }} />
              <span
                className="absolute inset-[3px] rounded-full border-2 border-white"
                style={{ background: TIER_HEX[o.tier] }}
              />
            </button>
          ),
        });
      }
    }
  }
  return markers;
}

export function handlePlanClick(
  info: PickingInfo,
  props: PlanSceneProps,
  event?: MapClickEvent,
): void {
  const id = info.layer?.id ?? "";
  if (id === "overlap-connectors" && info.object) {
    props.onSelectOverlap((info.object as Overlap).id);
    return;
  }
  if (id.startsWith("project-") && info.object && info.coordinate) {
    props.onProjectClick(info.object as Project, [info.coordinate[0], info.coordinate[1]], isShiftClick(event));
    return;
  }
  props.onEmptyClick();
}

export function planTooltip(info: PickingInfo, props: PlanSceneProps): ReactNode {
  const id = info.layer?.id ?? "";
  if (!info.object) return null;
  if (id === "overlap-connectors") {
    const o = info.object as Overlap;
    const a = props.projectsById.get(o.descId);
    const b = props.projectsById.get(o.gpcId);
    const rank = props.ranked.find((r) => r.overlap.id === o.id)?.rank;
    return (
      <>
        <div className="eyebrow mb-1">
          Pair #{rank} · {tierFull(o.tier)} · <span className="num">{fmtKm(o.distanceKm)}</span> apart
        </div>
        <div className="text-[13px] leading-[18px] text-ink">
          {a?.name ?? o.descId}
          <span className="text-ink-3"> and </span>
          {b?.name ?? o.gpcId}
        </div>
      </>
    );
  }
  if (id.startsWith("project-")) {
    const p = info.object as Project;
    const picked = props.selectedProjects.has(p.id);
    return (
      <>
        <div className="text-[13px] leading-[18px] text-ink">
          <span className="font-semibold" style={{ color: UTILITY_HEX[p.utility] }}>
            {UTILITY_NAME[p.utility]}:
          </span>{" "}
          {shortName(p.name)}
        </div>
        <div className="mt-1 text-[12px] text-ink-3">
          {picked ? "Click to unpick. Shift-click to add more." : "Click to pick. Shift-click to pick several."}
        </div>
      </>
    );
  }
  return null;
}

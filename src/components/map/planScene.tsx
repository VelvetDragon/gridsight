"use client";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { ReactNode } from "react";
import type { LineCollection, PlanData } from "@/lib/data";
import { fmtKm, fmtKv, fmtMonthYear } from "@/lib/format";
import { midpoint } from "@/lib/geo";
import type { RankedOverlap } from "@/lib/ranking";
import {
  INK,
  RIVER,
  TIER_HEX,
  TIER_RGB,
  tierFull,
  UTILITY_HEX,
  UTILITY_NAME,
  UTILITY_RGB,
  type RGB,
} from "@/lib/theme";
import { phaseAt } from "@/lib/timeline";
import type { Overlap, Position, Project } from "@/lib/types";
import { TIER_LIMIT_KM } from "@/lib/types";
import type { MapMarker } from "./MapCanvas";
import {
  distanceLabel,
  pointAlong,
  projectLabel,
  ringLabel,
  stateLabelMarkers,
  yardMarker,
} from "./mapLabels";

export interface PlanSceneProps {
  data: PlanData;
  ranked: RankedOverlap[];
  projectsById: Map<string, Project>;
  selectedId: string | null;
  /** Construction radar month (0 = Jan 2026) or null when the radar is off. */
  radarMonth: number | null;
  onSelectOverlap: (id: string) => void;
  onProjectClick: (project: Project, at: Position) => void;
  onEmptyClick: () => void;
}

const dashes = new PathStyleExtension({ dash: true });

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

function contextWidth(kv: number): number {
  if (kv >= 400) return 1.6;
  if (kv >= 200) return 1.15;
  return 0.8;
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

export function contextLineLayer(lines: LineCollection, id = "context-lines", alpha = 56): Layer {
  return new PathLayer<ContextPath>({
    id,
    data: flattenLines(lines),
    getPath: (d) => d.path,
    getColor: [...INK, alpha],
    getWidth: (d) => contextWidth(d.kv),
    widthUnits: "pixels",
  });
}

/** Opacity for a project given the radar and the current selection. */
function projectAlpha(p: Project, radarMonth: number | null, focus: Set<string> | null): number {
  let a = 255;
  if (radarMonth != null) {
    const phase = phaseAt(p, radarMonth);
    a = phase === "building" ? 255 : phase === "built" ? 110 : phase === "planned" ? 34 : 90;
  }
  if (focus && !focus.has(p.id)) a = Math.min(a, 70);
  return a;
}

type LineProject = Project & { geometry: { type: "LineString"; coordinates: Position[] } };
type PointProject = Project & { geometry: { type: "Point"; coordinates: Position } };

export function buildPlanLayers(props: PlanSceneProps): Layer[] {
  const { data, ranked, selectedId, radarMonth } = props;
  const selected = ranked.find((r) => r.overlap.id === selectedId)?.overlap ?? null;
  const focus = selected ? new Set([selected.descId, selected.gpcId]) : null;
  const trigger = `${radarMonth == null ? "off" : Math.floor(radarMonth)}|${selectedId ?? ""}`;

  const lineProjects = data.projects.filter((p): p is LineProject => p.geometry.type === "LineString");
  const pointProjects = data.projects.filter((p): p is PointProject => p.geometry.type === "Point");

  const color = (p: Project): [number, number, number, number] => [
    ...UTILITY_RGB[p.utility],
    projectAlpha(p, radarMonth, focus),
  ];

  const layers: Layer[] = [contextLineLayer(data.lines), ...riverLayers(data.river)];

  // Connectors between each overlap's closest points, drawn under the projects.
  const connectorData = ranked.map((r) => r.overlap).filter((o) => o.distanceKm > 0);
  layers.push(
    new PathLayer<Overlap, PathStyleExtensionProps<Overlap>>({
      id: "overlap-connectors",
      data: connectorData,
      getPath: (o) => o.closestPoints,
      getColor: (o) => {
        const base: RGB = o.id === selectedId ? INK : TIER_RGB[o.tier];
        const alpha = selected ? (o.id === selectedId ? 255 : 60) : 220;
        return [...base, alpha];
      },
      getWidth: (o) => (o.id === selectedId ? 2.4 : 1.4),
      widthUnits: "pixels",
      getDashArray: [3, 3],
      dashJustified: true,
      dashGapPickable: true,
      extensions: [dashes],
      pickable: true,
      updateTriggers: { getColor: trigger, getWidth: trigger },
    }),
  );

  // Selected match: concentric tier rings around the midpoint.
  if (selected) {
    const mid = midpoint(selected.closestPoints[0], selected.closestPoints[1]);
    const rings = (["row", "logistics", "crew"] as const).map((tier) => ({
      tier,
      km: TIER_LIMIT_KM[tier],
      center: mid,
    }));
    layers.push(
      new ScatterplotLayer<(typeof rings)[number]>({
        id: "tier-rings",
        data: rings,
        getPosition: (d) => d.center,
        getRadius: (d) => d.km * 1000,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: (d) => [...TIER_RGB[d.tier], d.tier === "row" ? 26 : 10],
        getLineColor: (d) => [...TIER_RGB[d.tier], 200],
        getLineWidth: 1.25,
        lineWidthUnits: "pixels",
        updateTriggers: { getPosition: selectedId },
      }),
    );
  }

  // Project lines: a paper halo underneath keeps them crisp over the basemap.
  layers.push(
    new PathLayer<LineProject>({
      id: "project-line-halo",
      data: lineProjects,
      getPath: (p) => p.geometry.coordinates,
      getColor: (p) => [250, 248, 244, Math.round(projectAlpha(p, radarMonth, focus) * 0.85)],
      getWidth: 7,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      updateTriggers: { getColor: trigger },
    }),
    new PathLayer<LineProject>({
      id: "project-lines",
      data: lineProjects.filter((p) => p.geometryQuality !== "straight"),
      getPath: (p) => p.geometry.coordinates,
      getColor: color,
      getWidth: (p) => (focus?.has(p.id) ? 4.5 : 3.5),
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: true,
      updateTriggers: { getColor: trigger, getWidth: trigger },
    }),
    // Approximate routes (straight between endpoints) are dashed, so nobody reads them as surveyed.
    new PathLayer<LineProject, PathStyleExtensionProps<LineProject>>({
      id: "project-lines-approx",
      data: lineProjects.filter((p) => p.geometryQuality === "straight"),
      getPath: (p) => p.geometry.coordinates,
      getColor: color,
      getWidth: (p) => (focus?.has(p.id) ? 4.5 : 3.5),
      widthUnits: "pixels",
      getDashArray: [3, 1.6],
      dashJustified: true,
      dashGapPickable: true,
      extensions: [dashes],
      pickable: true,
      updateTriggers: { getColor: trigger, getWidth: trigger },
    }),
    new ScatterplotLayer<PointProject>({
      id: "project-substations",
      data: pointProjects,
      getPosition: (p) => p.geometry.coordinates,
      getRadius: (p) => (focus?.has(p.id) ? 7 : 5.5),
      radiusUnits: "pixels",
      stroked: true,
      getFillColor: color,
      getLineColor: (p) => [255, 255, 255, projectAlpha(p, radarMonth, focus)],
      getLineWidth: 2,
      lineWidthUnits: "pixels",
      pickable: true,
      updateTriggers: { getFillColor: trigger, getLineColor: trigger, getRadius: trigger },
    }),
  );

  // Closest points of the selected match.
  if (selected) {
    layers.push(
      new ScatterplotLayer<{ p: Position; u: "DESC" | "GPC" }>({
        id: "closest-points",
        data: [
          { p: selected.closestPoints[0], u: "DESC" },
          { p: selected.closestPoints[1], u: "GPC" },
        ],
        getPosition: (d) => d.p,
        getRadius: 4,
        radiusUnits: "pixels",
        stroked: true,
        getFillColor: [255, 255, 255, 255],
        getLineColor: (d) => [...UTILITY_RGB[d.u], 255],
        getLineWidth: 2,
        lineWidthUnits: "pixels",
        updateTriggers: { getPosition: selectedId },
      }),
    );
  }

  return layers;
}

export function planMarkers(props: PlanSceneProps): MapMarker[] {
  const { ranked, selectedId, radarMonth, projectsById } = props;
  const markers: MapMarker[] = [];
  markers.push(...stateLabelMarkers());
  const selected = ranked.find((r) => r.overlap.id === selectedId)?.overlap;
  if (selected) {
    const mid = midpoint(selected.closestPoints[0], selected.closestPoints[1]);
    const rings: [number, string][] = [
      [1.6, "1.6 km · share land"],
      [8, "8 km · share yards"],
      [40, "40 km · share crews"],
    ];
    for (const [km, text] of rings) {
      // The small ring is labelled at its south edge, the big ones at the north-east,
      // so the labels stay clear of each other and of the pair's own labels.
      const angle = km < 2 ? -Math.PI / 2 : Math.PI / 4;
      const dx = (km * Math.cos(angle)) / (111.32 * Math.cos((mid[1] * Math.PI) / 180));
      const dy = (km * Math.sin(angle)) / 110.9;
      markers.push(ringLabel(`ring-${km}`, [mid[0] + dx, mid[1] + dy], text, km < 2 ? "below" : "on"));
    }
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
              aria-label={`Both projects under construction: overlap #${r.rank}`}
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

export function handlePlanClick(info: PickingInfo, props: PlanSceneProps): void {
  const id = info.layer?.id ?? "";
  if (id === "overlap-connectors" && info.object) {
    props.onSelectOverlap((info.object as Overlap).id);
    return;
  }
  if (id.startsWith("project-") && info.object && info.coordinate) {
    props.onProjectClick(info.object as Project, [info.coordinate[0], info.coordinate[1]]);
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
          <span className="text-ink-3"> ↔ </span>
          {b?.name ?? o.gpcId}
        </div>
      </>
    );
  }
  if (id.startsWith("project-")) {
    const p = info.object as Project;
    return (
      <>
        <div className="mb-1 text-[12px] font-semibold" style={{ color: UTILITY_HEX[p.utility] }}>
          {UTILITY_NAME[p.utility]} · {p.kind === "line" ? "power line" : "substation"}
        </div>
        <div className="text-[13px] leading-[18px] font-medium text-ink">{p.name}</div>
        <div className="mt-0.5 text-[12px] text-ink-3">
          {fmtKv(p.voltageKv)} · ready {fmtMonthYear(p.inService)}
        </div>
      </>
    );
  }
  return null;
}

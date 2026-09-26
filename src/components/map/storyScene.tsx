"use client";

import type { Layer } from "@deck.gl/core";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { PlanData } from "@/lib/data";
import { midpoint } from "@/lib/geo";
import type { RankedOverlap } from "@/lib/ranking";
import { TIER_HEX, TIER_RGB, UTILITY_RGB } from "@/lib/theme";
import type { Overlap, Position, Project } from "@/lib/types";
import type { MapMarker } from "./MapCanvas";
import { stateLabelMarkers } from "./mapLabels";
import {
  buildPlanLayers,
  contextLineLayer,
  flattenLines,
  planMarkers,
  riverLayers,
  type PlanSceneProps,
} from "./planScene";
import { buildResponseLayers, responseMarkers, TOP_ZONES, type ResponseSceneProps } from "./responseScene";

export interface StorySceneProps {
  /** 0-based chapter index. */
  chapter: number;
  /** 0..1 progress of the chapter's own animation. */
  progress: number;
  plan: PlanData | null;
  ranked: RankedOverlap[];
  planScene: PlanSceneProps | null;
  response: ResponseSceneProps | null;
}

const dashes = new PathStyleExtension({ dash: true });

type LineProject = Project & { geometry: { type: "LineString"; coordinates: Position[] } };
type PointProject = Project & { geometry: { type: "Point"; coordinates: Position } };

/** Projects in the order they go into service (undated ones last). */
export function projectsInBuildOrder(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => (a.inService ?? "9999").localeCompare(b.inService ?? "9999"));
}

/** How many projects are on screen at `progress` of chapter 2's time-lapse. */
export function revealedCount(total: number, progress: number): number {
  return Math.min(total, Math.floor(progress * (total + 0.999)));
}

function projectLayers(projects: Project[], alphaOf: (p: Project) => number, trigger: string): Layer[] {
  const lines = projects.filter((p): p is LineProject => p.geometry.type === "LineString");
  const points = projects.filter((p): p is PointProject => p.geometry.type === "Point");
  return [
    new PathLayer<LineProject>({
      id: "story-line-halo",
      data: lines,
      getPath: (p) => p.geometry.coordinates,
      getColor: (p) => [250, 248, 244, Math.round(alphaOf(p) * 0.85)],
      getWidth: 8,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      updateTriggers: { getColor: trigger },
    }),
    new PathLayer<LineProject>({
      id: "story-lines",
      data: lines,
      getPath: (p) => p.geometry.coordinates,
      getColor: (p) => [...UTILITY_RGB[p.utility], alphaOf(p)],
      getWidth: 4,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      updateTriggers: { getColor: trigger },
    }),
    new ScatterplotLayer<PointProject>({
      id: "story-points",
      data: points,
      getPosition: (p) => p.geometry.coordinates,
      getRadius: 6,
      radiusUnits: "pixels",
      stroked: true,
      getFillColor: (p) => [...UTILITY_RGB[p.utility], alphaOf(p)],
      getLineColor: (p) => [255, 255, 255, alphaOf(p)],
      getLineWidth: 2,
      lineWidthUnits: "pixels",
      updateTriggers: { getFillColor: trigger, getLineColor: trigger },
    }),
  ];
}

/** The last chapter shows only the top-priority repair zones and the yards that serve them. */
function focusResponse(response: ResponseSceneProps, chapter: number): ResponseSceneProps {
  if (chapter < 6) return response;
  const zones = topZones(response.data.zones);
  const ids = new Set(zones.map((z) => z.id));
  const yards = response.data.yards.filter((y) => y.serves.some((id) => ids.has(id)));
  return { ...response, data: { ...response.data, zones, yards } };
}

export function topZones<T extends { priority: number }>(zones: T[]): T[] {
  return [...zones].sort((a, b) => a.priority - b.priority).slice(0, TOP_ZONES);
}

export function buildStoryLayers(props: StorySceneProps): Layer[] {
  const { chapter, progress, plan, ranked, planScene, response } = props;

  if (chapter >= 5) {
    if (!response) return [];
    const visible =
      chapter === 5
        ? { track: true, segments: true, counties: false, zones: false, yards: false, vulnerable: false }
        : { track: false, segments: false, counties: false, zones: true, yards: true, vulnerable: false };
    return buildResponseLayers({ ...focusResponse(response, chapter), visible, selectedZoneId: null });
  }
  if (!plan) return [];
  if (chapter === 3 && planScene) {
    return buildPlanLayers({ ...planScene, selectedId: ranked[0]?.overlap.id ?? null, radarMonth: null });
  }
  if (chapter === 4 && planScene) {
    return buildPlanLayers({ ...planScene, selectedId: null, radarMonth: null });
  }

  // Chapter 1 shows the border, 2 the time-lapse, 3 the collisions.
  const base: Layer[] = [
    contextLineLayer(plan.lines, "story-context", chapter === 0 ? 70 : 40),
    ...riverLayers(plan.river, "story-river"),
  ];
  if (chapter === 0) {
    return [
      ...base,
      new PathLayer<{ path: Position[] }>({
        id: "story-river-glow",
        data: flattenLines(plan.river),
        getPath: (d) => d.path,
        getColor: [59, 130, 196, 70],
        getWidth: 18,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
      }),
    ];
  }

  const ordered = projectsInBuildOrder(plan.projects);
  if (chapter === 1) {
    const shown = new Set(ordered.slice(0, revealedCount(ordered.length, progress)).map((p) => p.id));
    return [...base, ...projectLayers(ordered, (p) => (shown.has(p.id) ? 255 : 0), `reveal-${shown.size}`)];
  }

  // Chapter 3: everything dims except the pairs.
  const overlaps = ranked.map((r) => r.overlap);
  return [
    ...base,
    ...projectLayers(ordered, () => 110, "dim"),
    new PathLayer<Overlap>({
      id: "story-connector-glow",
      data: overlaps.filter((o) => o.distanceKm > 0),
      getPath: (o) => o.closestPoints,
      getColor: [232, 196, 120, 120],
      getWidth: 12,
      widthUnits: "pixels",
      capRounded: true,
    }),
    new PathLayer<Overlap, PathStyleExtensionProps<Overlap>>({
      id: "story-connectors",
      data: overlaps.filter((o) => o.distanceKm > 0),
      getPath: (o) => o.closestPoints,
      getColor: [21, 24, 30, 255],
      getWidth: 2.2,
      widthUnits: "pixels",
      getDashArray: [3, 3],
      dashJustified: true,
      extensions: [dashes],
    }),
    new ScatterplotLayer<Overlap>({
      id: "story-pair-dots",
      data: overlaps,
      getPosition: (o) => midpoint(o.closestPoints[0], o.closestPoints[1]),
      getRadius: 5,
      radiusUnits: "pixels",
      stroked: true,
      getFillColor: (o) => [...TIER_RGB[o.tier], 255],
      getLineColor: [255, 255, 255, 255],
      getLineWidth: 1.5,
      lineWidthUnits: "pixels",
    }),
  ];
}

export function storyMarkers(props: StorySceneProps): MapMarker[] {
  const { chapter, progress, ranked, planScene, response } = props;
  if (chapter >= 5) {
    if (!response) return [];
    const visible =
      chapter === 5
        ? { track: true, segments: true, counties: false, zones: false, yards: false, vulnerable: false }
        : { track: false, segments: false, counties: false, zones: true, yards: true, vulnerable: false };
    return responseMarkers({ ...focusResponse(response, chapter), visible });
  }
  if (chapter === 3 && planScene) {
    return planMarkers({ ...planScene, selectedId: ranked[0]?.overlap.id ?? null, radarMonth: null });
  }
  const markers = stateLabelMarkers();
  // Chapter 3: tier rings pulse briefly around every pair.
  if (chapter === 2 && progress < 1) {
    for (const r of ranked) {
      const o = r.overlap;
      markers.push({
        id: `story-pulse-${o.id}`,
        position: midpoint(o.closestPoints[0], o.closestPoints[1]),
        node: (
          <span className="gs-passive relative block h-4 w-4">
            <span className="gs-pulse" style={{ borderColor: TIER_HEX[o.tier] }} />
          </span>
        ),
      });
    }
  }
  return markers;
}

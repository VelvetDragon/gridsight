"use client";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { ReactNode } from "react";
import type { ResponseData } from "@/lib/data";
import { fmtInt, fmtPct } from "@/lib/format";
import { approxWindRadiusKm, stormAt, zoneLabel } from "@/lib/response";
import { ALERT, failureColor, INK, SLATE, UTILITY_RGB, VULNERABLE_RGB } from "@/lib/theme";
import type { CountyOutage, LineSegmentRisk, Position, RepairZone, VulnerableArea } from "@/lib/types";
import type { MapMarker } from "./MapCanvas";
import { stateLabelMarkers, yardMarker } from "./mapLabels";
import { riverLayers } from "./planScene";

export type ResponseLayerId = "track" | "segments" | "counties" | "zones" | "yards" | "vulnerable";

export interface ResponseSceneProps {
  data: ResponseData;
  times: number[];
  timeMs: number;
  visible: Record<ResponseLayerId, boolean>;
  /** Replay time when the storm passed closest to each segment / county. */
  reveal: { segments: Float64Array; counties: Float64Array };
  selectedZoneId: string | null;
  onZoneClick: (id: string) => void;
}

const dashes = new PathStyleExtension({ dash: true });
/** Only the first few priorities get a label; the rest are listed in the panel. */
export const TOP_ZONES = 10;
/** Zone footprint radius drawn on the map, metres. */
const ZONE_RADIUS_M = 11000;

type SegmentRow = LineSegmentRisk & { i: number };
type CountyRow = CountyOutage & { i: number };

/** Proportional-circle radius (metres) for a customer count. */
function outageRadius(n: number): number {
  return Math.sqrt(Math.max(0, n)) * 55;
}

export function buildResponseLayers(props: ResponseSceneProps): Layer[] {
  const { data, times, timeMs, visible, reveal, selectedZoneId } = props;
  const layers: Layer[] = [...riverLayers(data.river, "r-river")];
  const tBucket = Math.round(timeMs / 60000);

  if (visible.segments) {
    const rows: SegmentRow[] = data.segments
      .map((s, i) => ({ ...s, i }))
      .sort((a, b) => a.failureProbability - b.failureProbability);
    layers.push(
      new PathLayer<SegmentRow>({
        id: "r-segments",
        data: rows,
        getPath: (s) => s.coordinates,
        getColor: (s) =>
          timeMs >= reveal.segments[s.i] ? [...failureColor(s.failureProbability), 255] : [120, 126, 138, 70],
        getWidth: (s) => (timeMs >= reveal.segments[s.i] ? 1.6 + 4 * Math.min(1, s.failureProbability * 2) : 1.2),
        widthUnits: "pixels",
        capRounded: true,
        pickable: true,
        updateTriggers: { getColor: tBucket, getWidth: tBucket },
      }),
    );
  }

  if (visible.zones) {
    const both = data.zones.filter((z) => z.utilities.length > 1);
    layers.push(
      new ScatterplotLayer<RepairZone>({
        id: "r-zones",
        data: data.zones,
        getPosition: (z) => z.centroid,
        getRadius: ZONE_RADIUS_M,
        radiusUnits: "meters",
        stroked: true,
        // Top priorities read strongest; the long tail stays faint.
        getFillColor: (z) => [...SLATE, z.id === selectedZoneId ? 40 : z.priority <= TOP_ZONES ? 16 : 6],
        getLineColor: (z) => [...SLATE, z.id === selectedZoneId ? 255 : z.priority <= TOP_ZONES ? 150 : 60],
        getLineWidth: (z) => (z.id === selectedZoneId ? 2 : 1.2),
        lineWidthUnits: "pixels",
        pickable: true,
        updateTriggers: { getFillColor: selectedZoneId, getLineColor: selectedZoneId, getLineWidth: selectedZoneId },
      }),
      // Zones where both utilities will be working get a two-colour rim.
      new ScatterplotLayer<RepairZone>({
        id: "r-zones-desc-rim",
        data: both,
        getPosition: (z) => z.centroid,
        getRadius: ZONE_RADIUS_M + 700,
        radiusUnits: "meters",
        stroked: true,
        filled: false,
        getLineColor: [...UTILITY_RGB.DESC, 220],
        getLineWidth: 2,
        lineWidthUnits: "pixels",
      }),
      new ScatterplotLayer<RepairZone>({
        id: "r-zones-gpc-rim",
        data: both,
        getPosition: (z) => z.centroid,
        getRadius: ZONE_RADIUS_M + 1500,
        radiusUnits: "meters",
        stroked: true,
        filled: false,
        getLineColor: [...UTILITY_RGB.GPC, 220],
        getLineWidth: 2,
        lineWidthUnits: "pixels",
      }),
      new TextLayer<RepairZone>({
        id: "r-zone-labels",
        data: data.zones.filter((z) => z.priority <= TOP_ZONES || z.id === selectedZoneId),
        getPosition: (z) => z.centroid,
        getText: (z) => `P${z.priority}`,
        getSize: 12,
        getColor: [...INK, 230],
        fontFamily: "Geist Mono, ui-monospace, monospace",
        fontWeight: 600,
        background: true,
        getBackgroundColor: [250, 248, 244, 235],
        backgroundPadding: [5, 2],
        backgroundBorderRadius: 4,
      }),
    );
  }

  if (visible.counties) {
    const rows: CountyRow[] = data.counties.map((c, i) => ({ ...c, i })).filter((c) => timeMs >= reveal.counties[c.i]);
    layers.push(
      new ScatterplotLayer<CountyRow>({
        id: "r-counties-actual",
        data: rows.filter((c) => c.actualPeakOut != null),
        getPosition: (c) => c.centroid,
        getRadius: (c) => outageRadius(c.actualPeakOut ?? 0),
        radiusUnits: "meters",
        getFillColor: [...ALERT, 40],
        stroked: false,
        pickable: true,
      }),
      new ScatterplotLayer<CountyRow>({
        id: "r-counties-predicted",
        data: rows,
        getPosition: (c) => c.centroid,
        getRadius: (c) => outageRadius(c.predictedPeakOut),
        radiusUnits: "meters",
        filled: false,
        stroked: true,
        getLineColor: [...ALERT, 190],
        getLineWidth: 1.25,
        lineWidthUnits: "pixels",
        pickable: true,
      }),
    );
  }

  if (visible.yards) {
    const zoneById = new Map(data.zones.map((z) => [z.id, z]));
    const links: { path: [Position, Position] }[] = [];
    for (const y of data.yards)
      for (const zid of y.serves) {
        const z = zoneById.get(zid);
        if (z) links.push({ path: [y.position, z.centroid] });
      }
    layers.push(
      new PathLayer<{ path: [Position, Position] }, PathStyleExtensionProps<{ path: [Position, Position] }>>({
        id: "r-yard-links",
        data: links,
        getPath: (d) => d.path,
        getColor: [...INK, 110],
        getWidth: 1.2,
        widthUnits: "pixels",
        getDashArray: [3, 3],
        dashJustified: true,
        extensions: [dashes],
      }),
    );
  }

  if (visible.vulnerable) {
    layers.push(
      new ScatterplotLayer<VulnerableArea>({
        id: "r-vulnerable",
        data: data.vulnerable,
        getPosition: (v) => v.position,
        getRadius: (v) => 2 + Math.sqrt(v.electricityDependent) / 5,
        radiusUnits: "pixels",
        stroked: true,
        getFillColor: [...VULNERABLE_RGB, 180],
        getLineColor: [255, 255, 255, 230],
        getLineWidth: 1.25,
        lineWidthUnits: "pixels",
        pickable: true,
      }),
    );
  }

  if (visible.track && data.storm.track.length) {
    const frame = stormAt(data.storm, times, timeMs);
    const past: Position[] = [];
    const future: Position[] = [];
    data.storm.track.forEach((p, i) => {
      if (times[i] <= timeMs) past.push(p.position);
      else future.push(p.position);
    });
    if (frame) {
      past.push(frame.position);
      future.unshift(frame.position);
    }
    layers.push(
      new PathLayer<{ path: Position[] }, PathStyleExtensionProps<{ path: Position[] }>>({
        id: "r-track-future",
        data: future.length > 1 ? [{ path: future }] : [],
        getPath: (d) => d.path,
        getColor: [...SLATE, 120],
        getWidth: 2,
        widthUnits: "pixels",
        getDashArray: [2, 2.5],
        extensions: [dashes],
      }),
      new PathLayer<{ path: Position[] }>({
        id: "r-track-past",
        data: past.length > 1 ? [{ path: past }] : [],
        getPath: (d) => d.path,
        getColor: [...SLATE, 230],
        getWidth: 3,
        widthUnits: "pixels",
        capRounded: true,
        jointRounded: true,
      }),
      new ScatterplotLayer<{ position: Position }>({
        id: "r-track-points",
        data: data.storm.track,
        getPosition: (p) => p.position,
        getRadius: 3,
        radiusUnits: "pixels",
        stroked: true,
        getFillColor: [255, 255, 255, 255],
        getLineColor: [...SLATE, 220],
        getLineWidth: 1.5,
        lineWidthUnits: "pixels",
      }),
    );
    if (frame) {
      const r = approxWindRadiusKm(frame);
      layers.push(
        new ScatterplotLayer<StormFrameRow>({
          id: "r-wind-ring",
          data: [{ position: frame.position, r }],
          getPosition: (d) => d.position,
          getRadius: (d) => d.r * 1000,
          radiusUnits: "meters",
          stroked: true,
          filled: false,
          getLineColor: [...ALERT, 140],
          getLineWidth: 1.5,
          lineWidthUnits: "pixels",
          updateTriggers: { getPosition: tBucket, getRadius: tBucket },
        }),
        new ScatterplotLayer<StormFrameRow>({
          id: "r-storm-center",
          data: [{ position: frame.position, r }],
          getPosition: (d) => d.position,
          getRadius: 7,
          radiusUnits: "pixels",
          stroked: true,
          getFillColor: [...ALERT, 255],
          getLineColor: [255, 255, 255, 255],
          getLineWidth: 2.5,
          lineWidthUnits: "pixels",
          updateTriggers: { getPosition: tBucket },
        }),
      );
    }
  }

  return layers;
}

type StormFrameRow = { position: Position; r: number };

export function responseMarkers(props: ResponseSceneProps): MapMarker[] {
  const { data, visible, times, timeMs } = props;
  const markers: MapMarker[] = [...stateLabelMarkers()];
  if (visible.yards) {
    for (const y of data.yards) {
      markers.push(
        yardMarker(
          `jy-${y.id}`,
          y.position,
          // Symbol only (explained in the key) so the zone numbers stay readable.
          null,
          `Shared yard: ${y.label}. Serves ${y.serves.length} zones, up to ${y.maxDriveMinutes} min drive`,
        ),
      );
    }
  }
  if (visible.track) {
    const frame = stormAt(data.storm, times, timeMs);
    if (frame) {
      markers.push({
        id: "storm-label",
        position: frame.position,
        node: (
          <div className="gs-passive translate-x-[calc(50%+14px)] rounded-full bg-ink px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-white shadow-[var(--shadow-float)]">
            Storm centre · <span className="num">{Math.round(frame.windKt * 1.151)}</span> mph winds
          </div>
        ),
      });
    }
  }
  return markers;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function handleResponseClick(info: PickingInfo, props: ResponseSceneProps): void {
  if (info.layer?.id === "r-zones" && info.object) props.onZoneClick((info.object as RepairZone).id);
}

export function responseTooltip(info: PickingInfo, props: ResponseSceneProps): ReactNode {
  if (!info.object) return null;
  const id = info.layer?.id ?? "";
  if (id === "r-segments") {
    const s = info.object as SegmentRow;
    const revealed = props.timeMs >= props.reveal.segments[s.i];
    const owner = s.utility === "DESC" ? "Dominion Energy" : s.utility === "GPC" ? "Georgia Power" : "Other owner";
    return (
      <>
        <div className="eyebrow mb-1">{owner} power line</div>
        {revealed ? (
          <div className="grid grid-cols-[auto_auto] gap-x-4 text-[13px]">
            <span className="text-ink-3">Chance of breaking</span>
            <span className="num text-right text-ink">{fmtPct(s.failureProbability, 1)}</span>
            <span className="text-ink-3">Peak gust</span>
            <span className="num text-right text-ink">{Math.round(s.peakWindMph)} mph</span>
          </div>
        ) : (
          <div className="text-[13px] text-ink-3">Storm has not reached this line yet.</div>
        )}
      </>
    );
  }
  if (id.startsWith("r-counties")) {
    const c = info.object as CountyOutage;
    return (
      <>
        <div className="eyebrow mb-1">
          {c.name} Co., {c.state}
        </div>
        <div className="grid grid-cols-[auto_auto] gap-x-4 text-[13px]">
          <span className="text-ink-3">Customers</span>
          <span className="num text-right text-ink">{fmtInt(c.customers)}</span>
          <span className="text-ink-3">Predicted peak out</span>
          <span className="num text-right text-ink">
            {fmtInt(c.predictedPeakOut)}{" "}
            <span className="text-ink-3">({fmtPct(c.predictedPeakOut / c.customers)})</span>
          </span>
          <span className="text-ink-3">Actual peak out</span>
          <span className="num text-right text-ink">
            {c.actualPeakOut != null ? (
              <>
                {fmtInt(c.actualPeakOut)} <span className="text-ink-3">({fmtPct(c.actualPeakOut / c.customers)})</span>
              </>
            ) : (
              "no data"
            )}
          </span>
        </div>
      </>
    );
  }
  if (id === "r-zones") {
    const z = info.object as RepairZone;
    return (
      <>
        <div className="eyebrow mb-1">Repair zone · crews go here {ordinal(z.priority)}</div>
        <div className="text-[13px] font-medium text-ink">near {zoneLabel(z, props.data.counties)}</div>
        <div className="num mt-0.5 text-[12px] text-ink-3">
          {z.expectedDamagedSegments.toFixed(1)} damaged segments expected · {fmtInt(z.vulnerablePeople)} vulnerable
        </div>
        <div className="mt-0.5 text-[12px] text-ink-2">
          {z.utilities.length > 1
            ? "Both companies working here"
            : z.utilities[0] === "DESC"
              ? "Dominion Energy"
              : "Georgia Power"}
        </div>
      </>
    );
  }
  if (id === "r-vulnerable") {
    const v = info.object as VulnerableArea;
    return (
      <>
        <div className="eyebrow mb-1">
          ZIP <span className="num">{v.zip}</span>
        </div>
        <div className="text-[13px] text-ink">
          <span className="num">{fmtInt(v.electricityDependent)}</span> people who rely on powered medical equipment
        </div>
      </>
    );
  }
  return null;
}

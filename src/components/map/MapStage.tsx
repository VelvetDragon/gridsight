"use client";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import MapCanvas, { type MapMarker, type MapPadding, type MapPopup, type ViewRequest } from "./MapCanvas";
import { buildPlanLayers, handlePlanClick, planMarkers, planTooltip, type PlanSceneProps } from "./planScene";

export type Mode = "plan" | "response";

export interface MapStageProps {
  mode: Mode;
  plan: PlanSceneProps | null;
  popup: MapPopup | null;
  view: ViewRequest | null;
  padding: MapPadding;
}

interface Hover {
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * The one persistent map. Each mode contributes deck.gl layers, DOM markers and
 * a hover tooltip; switching modes swaps the scene without re-creating the map.
 */
export default function MapStage({ mode, plan, popup, view, padding }: MapStageProps) {
  const [hover, setHover] = useState<Hover | null>(null);

  const layers = useMemo<Layer[]>(() => {
    if (mode === "plan" && plan) return buildPlanLayers(plan);
    return [];
  }, [mode, plan]);

  const markers = useMemo<MapMarker[]>(() => {
    if (mode === "plan" && plan) return planMarkers(plan);
    return [];
  }, [mode, plan]);

  const onHover = useCallback(
    (info: PickingInfo) => {
      const content = mode === "plan" && plan ? planTooltip(info, plan) : null;
      setHover(content ? { x: info.x, y: info.y, content } : null);
    },
    [mode, plan],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      if (mode === "plan" && plan) handlePlanClick(info, plan);
    },
    [mode, plan],
  );

  return (
    <>
      <MapCanvas
        layers={layers}
        markers={markers}
        popup={popup}
        view={view}
        padding={padding}
        onHover={onHover}
        onClick={onClick}
      />
      {hover ? (
        <div
          className="glass-strong pointer-events-none absolute z-30 max-w-[300px] rounded-[10px] px-3 py-2"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {hover.content}
        </div>
      ) : null}
    </>
  );
}

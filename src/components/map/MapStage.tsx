"use client";

import type { Layer, PickingInfo } from "@deck.gl/core";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { FxControls } from "./fx/FxControls";
import { useFx } from "./fx/useFx";
import MapCanvas, { type MapMarker, type MapPadding, type MapPopup, type ViewRequest } from "./MapCanvas";
import { buildPlanLayers, handlePlanClick, planMarkers, planTooltip, type PlanSceneProps } from "./planScene";
import {
  buildResponseLayers,
  handleResponseClick,
  responseMarkers,
  responseTooltip,
  type ResponseSceneProps,
} from "./responseScene";
import { buildStoryLayers, storyMarkers, type StorySceneProps } from "./storyScene";

/** "story" is the guided landing; "plan" and "response" are the two Explore views. */
export type Mode = "story" | "plan" | "response";

export interface MapStageProps {
  mode: Mode;
  plan: PlanSceneProps | null;
  response: ResponseSceneProps | null;
  story: StorySceneProps | null;
  popup: MapPopup | null;
  view: ViewRequest | null;
  padding: MapPadding;
}

interface Hover {
  x: number;
  y: number;
  /** Tooltip opens to the left of the cursor near the right edge. */
  flip: boolean;
  content: ReactNode;
}

/**
 * The one persistent map. Each mode contributes deck.gl layers, DOM markers and
 * a hover tooltip; switching modes swaps the scene without re-creating the map.
 */
export default function MapStage({ mode, plan, response, story, popup, view, padding }: MapStageProps) {
  const [hover, setHover] = useState<Hover | null>(null);
  const fx = useFx(mode, plan, response);

  const layers = useMemo<Layer[]>(() => {
    if (mode === "plan" && plan) return buildPlanLayers(plan);
    if (mode === "response" && response) return buildResponseLayers(response);
    if (mode === "story" && story) return buildStoryLayers(story);
    return [];
  }, [mode, plan, response, story]);

  const markers = useMemo<MapMarker[]>(() => {
    if (mode === "plan" && plan) return planMarkers(plan);
    if (mode === "response" && response) return responseMarkers(response);
    if (mode === "story" && story) return storyMarkers(story);
    return [];
  }, [mode, plan, response, story]);

  const onHover = useCallback(
    (info: PickingInfo) => {
      const content =
        mode === "plan" && plan
          ? planTooltip(info, plan)
          : mode === "response" && response
            ? responseTooltip(info, response)
            : null;
      setHover(content ? { x: info.x, y: info.y, flip: info.x > window.innerWidth - 340, content } : null);
    },
    [mode, plan, response],
  );

  const onClick = useCallback(
    (info: PickingInfo) => {
      if (mode === "plan" && plan) handlePlanClick(info, plan);
      else if (mode === "response" && response) handleResponseClick(info, response);
    },
    [mode, plan, response],
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
        fx={fx.controller}
      />
      {mode !== "story" ? (
        <FxControls
          fx={fx}
          className="absolute z-20"
          style={{
            top: padding.top - 16,
            // Just left of the right-hand column (plan keeps its savings column beside the pair drawer).
            right: mode === "plan" ? (plan?.selectedId ? 440 : 16) + 332 : padding.right > 48 ? padding.right - 20 : 16,
          }}
        />
      ) : null}
      {hover ? (
        <div
          className="glass-strong pointer-events-none absolute z-30 max-w-[300px] rounded-[10px] px-3 py-2"
          style={
            hover.flip
              ? { right: window.innerWidth - hover.x + 14, top: hover.y + 14 }
              : { left: hover.x + 14, top: hover.y + 14 }
          }
        >
          {hover.content}
        </div>
      ) : null}
    </>
  );
}

"use client";

import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { FxController } from "./FxController";

/**
 * Rendered inside <Map>: hands the MapLibre instance to the effects
 * controller and applies the optional ?view=lon,lat,zoom and ?tilt=1 params.
 */
export function FxMapHost({ controller }: { controller: FxController }) {
  const { current } = useMap();

  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    const q = new URLSearchParams(window.location.search);
    const view = q.get("view")?.split(",").map(Number);
    if (view && view.length >= 3 && view.every(Number.isFinite)) {
      map.jumpTo({ center: [view[0], view[1]], zoom: view[2] });
    }
    controller.attachMap(map);
    if (q.get("tilt") === "1") controller.setTilt(true, false);
    return () => controller.detachMap(map);
  }, [current, controller]);

  return null;
}

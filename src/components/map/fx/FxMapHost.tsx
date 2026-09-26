"use client";

import { useEffect } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { FxController } from "./FxController";

/** How long a shared ?view link keeps its camera against the app's opening moves. */
const HOLD_VIEW_MS = 12000;

/**
 * Rendered inside <Map>: hands the MapLibre instance to the effects
 * controller and applies the optional ?view=lon,lat,zoom and ?tilt=1 params
 * (handy for shared links and captures).
 */
export function FxMapHost({ controller }: { controller: FxController }) {
  const { current } = useMap();

  useEffect(() => {
    const map = current?.getMap();
    if (!map) return;
    controller.attachMap(map);
    const q = new URLSearchParams(window.location.search);
    const view = q.get("view")?.split(",").map(Number);
    const tilt = q.get("tilt") === "1";
    const camera =
      view && view.length >= 3 && view.every(Number.isFinite)
        ? { center: [view[0], view[1]] as [number, number], zoom: view[2] }
        : null;
    let applying = false;
    let tries = 0;
    const apply = () => {
      if (applying || tries++ > 6) return;
      applying = true;
      if (camera) map.jumpTo(camera);
      if (tilt) controller.setDepth(true, false);
      applying = false;
    };
    if (!camera && !tilt) return () => controller.detachMap(map);
    apply();
    // The app may open with its own camera move; the link's view wins for a moment.
    const until = performance.now() + HOLD_VIEW_MS;
    const onEnd = (e: { originalEvent?: unknown }) => {
      if (applying || e.originalEvent || performance.now() > until) return;
      const c = map.getCenter();
      const off =
        (camera && (Math.abs(c.lng - camera.center[0]) > 1e-4 || Math.abs(map.getZoom() - camera.zoom) > 0.01)) ||
        (tilt && map.getPitch() < 5);
      // Let the app's own move finish first, then restore the link's camera.
      if (off) setTimeout(apply, 0);
    };
    map.on("moveend", onEnd);
    return () => {
      map.off("moveend", onEnd);
      controller.detachMap(map);
    };
  }, [current, controller]);

  return null;
}

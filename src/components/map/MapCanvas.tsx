"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { LayersList, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Map, { Marker, Popup, useControl, type MapRef } from "react-map-gl/maplibre";
import { loadNaturalStyle } from "@/lib/basemap";
import type { Bounds } from "@/lib/geo";
import type { Position } from "@/lib/types";
import { declutter } from "./declutter";
import type { FxController } from "./fx/FxController";
import { FxMapHost } from "./fx/FxMapHost";

// MapLibre loads its worker by URL; scripts/copy-maplibre-worker.mjs puts it in public/.
if (typeof window !== "undefined") maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/** Centered on the Savannah River between Savannah and Augusta. */
export const INITIAL_VIEW = { longitude: -81.5, latitude: 32.8, zoom: 7.2 };

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A camera move requested by the UI. `key` changes each time a move is wanted. */
export type ViewRequest =
  | { key: string; kind: "bounds"; bounds: Bounds; maxZoom?: number; pitch?: number; durationMs?: number }
  | { key: string; kind: "center"; center: Position; zoom: number; pitch?: number; durationMs?: number };

export interface MapMarker {
  id: string;
  position: Position;
  node: ReactNode;
  onClick?: () => void;
  /**
   * Keep this label clear of the other ranked labels. Lower ranks hold their
   * place; higher ones are nudged aside when they would overlap.
   */
  declutter?: number;
}

export interface MapPopup {
  key: string;
  position: Position;
  content: ReactNode;
  onClose: () => void;
}

export interface MapCanvasProps {
  layers: LayersList;
  markers?: MapMarker[];
  popup?: MapPopup | null;
  view?: ViewRequest | null;
  padding: MapPadding;
  onHover?: (info: PickingInfo) => void;
  onClick?: (info: PickingInfo, event?: MapClickEvent) => void;
  /** Realistic map effects; when set, layers pass through it on their way to the overlay. */
  fx?: FxController | null;
  /**
   * When the container changes size, frame the same area again instead of
   * keeping the zoom and cropping or padding it (for resizable map panes).
   */
  keepFramedOnResize?: boolean;
}

function DeckOverlay({ fx, ...props }: MapboxOverlayProps & { fx?: FxController | null }) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  useEffect(() => {
    if (fx) fx.syncOverlay(overlay, props);
    else overlay.setProps(props);
  });
  return null;
}

type LoadState = "loading" | "ready" | "error";

/**
 * deck.gl types `srcEvent` as the DOM event, but over MapLibre it is MapLibre's own event,
 * which carries the DOM event as `originalEvent`.
 */
export interface MapClickEvent {
  srcEvent?: { shiftKey?: boolean } | { originalEvent?: { shiftKey?: boolean } };
}

/** True when the click was a shift-click. */
export function isShiftClick(event?: MapClickEvent): boolean {
  const src = event?.srcEvent;
  if (!src) return false;
  return "originalEvent" in src ? !!src.originalEvent?.shiftKey : !!("shiftKey" in src && src.shiftKey);
}

export default function MapCanvas({
  layers,
  markers = [],
  popup,
  view,
  padding,
  onHover,
  onClick,
  fx,
  keepFramedOnResize = false,
}: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const [load, setLoad] = useState<LoadState>("loading");
  const lastViewKey = useRef<string | null>(null);
  // What the map last showed at rest, so a resize can frame it again.
  const framed = useRef<maplibregl.LngLatBounds | null>(null);
  // The basemap style is fetched once and re-coloured before the map mounts.
  const [mapStyle, setMapStyle] = useState<maplibregl.StyleSpecification | string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    loadNaturalStyle(ctrl.signal).then((style) => {
      if (!ctrl.signal.aborted) setMapStyle(style);
    });
    return () => ctrl.abort();
  }, []);

  const applyView = useCallback(
    (req: ViewRequest | null | undefined) => {
      const map = mapRef.current;
      if (!map || !req || lastViewKey.current === req.key) return;
      lastViewKey.current = req.key;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const duration = reduce ? 0 : (req.durationMs ?? 1100);
      // Pitch and bearing are always set, so leaving a tilted story view levels the map again.
      const tilt = { pitch: req.pitch ?? 0, bearing: 0 };
      if (req.kind === "bounds") {
        map.fitBounds(req.bounds, {
          padding,
          maxZoom: req.maxZoom ?? 11,
          duration,
          essential: true,
          ...tilt,
        });
      } else {
        map.flyTo({ center: req.center, zoom: req.zoom, padding, duration, essential: true, ...tilt });
      }
    },
    [padding],
  );

  useEffect(() => {
    if (load === "ready") applyView(view);
  }, [view, load, applyView]);

  const rememberFrame = useCallback(() => {
    const map = mapRef.current;
    if (keepFramedOnResize && map && map.getPitch() === 0) framed.current = map.getBounds();
  }, [keepFramedOnResize]);

  const reframe = useCallback(() => {
    if (!keepFramedOnResize) return;
    // A frame later, once the deck.gl overlay has taken the new size from its own
    // resize listener; moving before that draws the lines at the old size.
    requestAnimationFrame(() => {
      const map = mapRef.current;
      const bounds = framed.current;
      // Mid-flight or tilted, the target camera matters more than the old frame.
      if (!map || !bounds || map.isMoving() || map.getPitch() !== 0) return;
      map.fitBounds(bounds, { padding: 0, maxZoom: map.getMaxZoom(), duration: 0 });
    });
  }, [keepFramedOnResize]);

  // Nudge overlapping labels apart after every frame the markers move in.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (load !== "ready" || !map) return;
    const run = () => declutter(map.getContainer());
    map.on("render", run);
    const raf = requestAnimationFrame(run);
    return () => {
      map.off("render", run);
      cancelAnimationFrame(raf);
    };
  }, [load, markers]);

  const handleHover = useCallback(
    (info: PickingInfo) => {
      const canvas = mapRef.current?.getCanvas();
      if (canvas) canvas.style.cursor = info.object ? "pointer" : "";
      onHover?.(info);
    },
    [onHover],
  );

  return (
    <div className="absolute inset-0 isolate bg-paper">
      {mapStyle ? (
        <Map
          ref={mapRef}
          mapLib={maplibregl}
          initialViewState={INITIAL_VIEW}
          mapStyle={mapStyle}
          style={{ position: "absolute", inset: 0 }}
          attributionControl={{ compact: false }}
          dragRotate={false}
          // Shift-click adds to a selection, so shift-drag must not start a box zoom.
          boxZoom={false}
          pitchWithRotate={false}
          touchPitch={false}
          minZoom={5}
          maxZoom={14}
          onLoad={() => setLoad("ready")}
          onMoveEnd={rememberFrame}
          onResize={reframe}
          onStyleData={() => {
            if (load === "loading") setLoad("ready");
          }}
          onError={(e) => {
            if (load === "loading") setLoad("error");
            console.warn("[map]", e.error?.message ?? e);
          }}
        >
          <DeckOverlay layers={layers} onHover={handleHover} onClick={onClick} pickingRadius={6} fx={fx} />
          {fx ? <FxMapHost controller={fx} /> : null}
          {markers.map((m) => (
            <Marker
              key={m.id}
              longitude={m.position[0]}
              latitude={m.position[1]}
              anchor="center"
              className={m.declutter != null ? `gs-declutter gs-rank-${m.declutter}` : undefined}
              onClick={(e) => {
                if (!m.onClick) return;
                e.originalEvent.stopPropagation();
                m.onClick();
              }}
            >
              {m.node}
            </Marker>
          ))}
          {popup ? (
            <Popup
              key={popup.key}
              longitude={popup.position[0]}
              latitude={popup.position[1]}
              anchor="bottom"
              offset={14}
              closeButton={false}
              closeOnClick={false}
              maxWidth="320px"
              className="gs-popup"
              onClose={popup.onClose}
            >
              {popup.content}
            </Popup>
          ) : null}
        </Map>
      ) : null}
      {load === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="eyebrow rounded-full bg-white/70 px-3 py-1.5">Loading basemap</span>
        </div>
      ) : null}
      {load === "error" ? (
        <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2">
          <span className="rounded-full border border-hairline bg-white/90 px-3 py-1.5 text-[12px] text-ink-2">
            Basemap tiles unavailable. Overlays still work.
          </span>
        </div>
      ) : null}
    </div>
  );
}

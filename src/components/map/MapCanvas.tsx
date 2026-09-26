"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { LayersList, PickingInfo } from "@deck.gl/core";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Map, { Marker, Popup, useControl, type MapRef } from "react-map-gl/maplibre";
import type { Bounds } from "@/lib/geo";
import type { Position } from "@/lib/types";
import type { FxController } from "./fx/FxController";
import { FxMapHost } from "./fx/FxMapHost";

// MapLibre loads its worker by URL; scripts/copy-maplibre-worker.mjs puts it in public/.
if (typeof window !== "undefined") maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

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
  | { key: string; kind: "bounds"; bounds: Bounds; maxZoom?: number }
  | { key: string; kind: "center"; center: Position; zoom: number };

export interface MapMarker {
  id: string;
  position: Position;
  node: ReactNode;
  onClick?: () => void;
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
  onClick?: (info: PickingInfo) => void;
  /** Realistic map effects; when set, layers pass through it on their way to the overlay. */
  fx?: FxController | null;
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

export default function MapCanvas({
  layers,
  markers = [],
  popup,
  view,
  padding,
  onHover,
  onClick,
  fx,
}: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null);
  const [load, setLoad] = useState<LoadState>("loading");
  const lastViewKey = useRef<string | null>(null);

  const applyView = useCallback(
    (req: ViewRequest | null | undefined) => {
      const map = mapRef.current;
      if (!map || !req || lastViewKey.current === req.key) return;
      lastViewKey.current = req.key;
      if (req.kind === "bounds") {
        map.fitBounds(req.bounds, {
          padding,
          maxZoom: req.maxZoom ?? 11,
          duration: 1100,
          essential: true,
        });
      } else {
        map.flyTo({ center: req.center, zoom: req.zoom, padding, duration: 1100, essential: true });
      }
    },
    [padding],
  );

  useEffect(() => {
    if (load === "ready") applyView(view);
  }, [view, load, applyView]);

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
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        initialViewState={INITIAL_VIEW}
        mapStyle={BASEMAP_STYLE}
        style={{ position: "absolute", inset: 0 }}
        attributionControl={{ compact: false }}
        dragRotate={false}
        pitchWithRotate={false}
        touchPitch={false}
        minZoom={5}
        maxZoom={14}
        onLoad={() => setLoad("ready")}
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

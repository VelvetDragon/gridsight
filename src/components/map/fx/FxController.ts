/**
 * Runs the map effects. It takes the scene's ordinary deck.gl layers,
 * replaces the flat river with real water, and drives one three.js custom
 * layer inside MapLibre (the 3D river surface, and 3D towers with sagging
 * wires along the selected pair of planned lines when zoomed in).
 *
 * While effects animate it runs its own requestAnimationFrame loop, so React
 * never re-renders per frame; only layers whose uniforms change get new props.
 * The "3D" view tilts the camera and adds hillshaded relief and a sky.
 */
import type { Layer } from "@deck.gl/core";
import type { MapboxOverlay, MapboxOverlayProps } from "@deck.gl/mapbox";
import type * as maplibregl from "maplibre-gl";
import type { Bbox } from "@/lib/fx/geometry";
import { metersPerPixel } from "@/lib/fx/geometry";
import type { PlanSceneProps } from "../planScene";
import type { ResponseSceneProps } from "../responseScene";
import { TOWER_ZOOM, TowerField, type PowerFxInput, type StructureCollection } from "./PowerLineLayers";
import { riverFxLayers, riverPaths } from "./RiverLayers";
import { disableTerrain, enableTerrain } from "./terrain";
import { GridPass, TOWER_H } from "./three/Grid3D";
import { RiverPass } from "./three/River3D";
import { ThreeFxLayer } from "./three/ThreeFxLayer";

export interface FxScene {
  mode: "plan" | "response" | "story";
  plan: PlanSceneProps | null;
  response: ResponseSceneProps | null;
}

export interface FxOptions {
  reducedMotion: boolean;
}

interface Frame {
  time: number;
  zoom: number;
  pitch: number;
  bounds: Bbox;
  mpp: number;
}

const STRUCTURES_URL = "/data/context/structures.geojson";
/** On-screen height (px) below which towers are scaled up to stay legible. */
const MIN_TOWER_PX = 20;

const ids = new WeakMap<object, number>();
let seq = 0;
function identity(o: object): number {
  let id = ids.get(o);
  if (id == null) {
    id = ++seq;
    ids.set(o, id);
  }
  return id;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class FxController {
  private overlay: MapboxOverlay | null = null;
  private baseProps: MapboxOverlayProps = {};
  private map: maplibregl.Map | null = null;
  private scene: FxScene = { mode: "plan", plan: null, response: null };
  private power: PowerFxInput | null = null;
  private opts: FxOptions = { reducedMotion: false };
  private depth = false;
  private raf = 0;
  private running = false;
  private readonly t0 = typeof performance !== "undefined" ? performance.now() : 0;
  private lastRender = 0;
  /** Optional frame cap (?fxfps=N), for low-power devices and headless captures. */
  private readonly minFrameMs = (() => {
    if (typeof window === "undefined") return 0;
    const fps = Number(new URLSearchParams(window.location.search).get("fxfps"));
    return fps > 0 ? 1000 / fps : 0;
  })();
  private towers = new TowerField();
  private structures: StructureCollection | null = null;
  private three: ThreeFxLayer | null = null;
  private riverPass = new RiverPass();
  private gridPass = new GridPass();
  private lastThreeTry = 0;

  /* ---------- wiring ---------- */

  setOptions(opts: FxOptions) {
    this.opts = opts;
    this.kick();
  }

  setScene(scene: FxScene) {
    this.scene = scene;
    this.updatePower();
  }

  private updatePower() {
    const p = this.scene.plan;
    if (!p || this.scene.mode !== "plan") {
      this.power = null;
      return;
    }
    const sel = p.ranked.find((r) => r.overlap.id === p.selectedId)?.overlap;
    this.power = { plan: p.data, towerIds: sel ? new Set([sel.descId, sel.gpcId]) : null, structures: this.structures };
  }

  syncOverlay(overlay: MapboxOverlay, props: MapboxOverlayProps) {
    this.overlay = overlay;
    this.baseProps = props;
    this.renderNow();
    this.kick();
  }

  attachMap(map: maplibregl.Map) {
    this.map = map;
    map.on("move", this.onMove);
    map.on("styledata", this.onStyle);
    fetch(STRUCTURES_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((fc: StructureCollection | null) => {
        if (fc && Array.isArray(fc.features) && fc.features.length) {
          this.structures = fc;
          this.updatePower();
          this.renderNow();
        }
      })
      .catch(() => {});
    this.kick();
  }

  detachMap(map: maplibregl.Map) {
    map.off("move", this.onMove);
    map.off("styledata", this.onStyle);
    this.removeThree();
    if (this.map === map) this.map = null;
    this.stop();
  }

  destroy() {
    if (this.map) this.detachMap(this.map);
    this.overlay = null;
  }

  getMap(): maplibregl.Map | null {
    return this.map;
  }

  /* ---------- 3D view ---------- */

  /** Tilts the camera and adds relief shading (or levels the map and removes it). */
  setDepth(on: boolean, animate = true) {
    this.depth = on;
    const map = this.map;
    if (!map) return;
    if (on) enableTerrain(map);
    else disableTerrain(map);
    const target = { pitch: on ? 58 : 0, bearing: on ? -12 : 0 };
    if (!animate || this.opts.reducedMotion) map.jumpTo(target);
    else map.easeTo({ ...target, duration: 1600, essential: true, easing: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) });
  }

  /* ---------- loop ---------- */

  private onMove = () => {
    if (!this.running) this.renderNow();
  };

  private onStyle = () => {
    this.ensureThree();
    if (this.depth && this.map && !this.map.getLayer("fx-hillshade")) enableTerrain(this.map);
  };

  private get animating(): boolean {
    return !this.opts.reducedMotion && !!this.overlay && !!this.map;
  }

  private kick() {
    if (this.animating) {
      if (!this.running) {
        this.running = true;
        this.raf = requestAnimationFrame(this.tick);
      }
    } else {
      this.stop();
      this.renderNow();
    }
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.running = false;
  }

  private tick = () => {
    this.raf = 0;
    if (!this.animating) {
      this.running = false;
      return;
    }
    const now = performance.now();
    if (!this.minFrameMs || now - this.lastRender >= this.minFrameMs) {
      this.lastRender = now;
      this.renderNow();
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /* ---------- rendering ---------- */

  private frame(): Frame | null {
    const map = this.map;
    if (!map) return null;
    const b = map.getBounds();
    const zoom = map.getZoom();
    const time = this.opts.reducedMotion ? 0 : (performance.now() - this.t0) / 1000;
    return {
      time,
      zoom,
      pitch: map.getPitch(),
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      mpp: metersPerPixel(zoom, map.getCenter().lat),
    };
  }

  renderNow() {
    const overlay = this.overlay;
    if (!overlay) return;
    const props = this.baseProps;
    const f = this.frame();
    if (!f) {
      overlay.setProps(props);
      return;
    }
    overlay.setProps({ ...props, layers: this.compose((props.layers ?? []) as Layer[], f) });
  }

  private compose(base: Layer[], f: Frame): Layer[] {
    const { mode, plan, response } = this.scene;
    const threeOk = this.ensureThree();
    const river = mode === "response" ? response?.data.river : plan?.data.river;

    if (threeOk) {
      this.riverPass.time = f.time;
      this.riverPass.setRiver(river ? riverPaths(river) : null);
      const power = this.power;
      const grow = power?.towerIds ? smoothstep(TOWER_ZOOM - 0.2, TOWER_ZOOM + 0.4, f.zoom) : 0;
      const set =
        power && grow > 0
          ? this.towers.get(power, f, `${identity(power.plan)}|${power.structures ? "s" : "c"}|${plan?.selectedId ?? ""}`)
          : null;
      const scale = Math.max(1, (MIN_TOWER_PX * f.mpp) / TOWER_H);
      this.gridPass.setData(set, {
        scale,
        grow,
        thick: Math.min(3, Math.max(1, (0.45 * f.mpp) / (0.15 * scale))),
        wireWidth: 1,
        time: f.time,
      });
      this.map?.triggerRepaint();
    }

    const out: Layer[] = [];
    for (const layer of base) {
      const id = layer.id;
      if (id.endsWith("river-wash")) {
        // The 3D water replaces the flat river; a calm 2D water body is the fallback.
        if (!threeOk && river) out.push(...riverFxLayers(river, { id: id.replace("-wash", ""), time: f.time, zoom: f.zoom }));
        continue;
      }
      if (id.endsWith("river-core")) continue;
      out.push(layer);
    }
    return out;
  }

  /* ---------- three.js custom layer ---------- */

  /** Adds the shared three.js layer below the basemap labels. False until the style can take it. */
  private ensureThree(): boolean {
    const map = this.map;
    if (!map) return false;
    if (!this.three) this.three = new ThreeFxLayer([this.riverPass, this.gridPass]);
    if (map.getLayer(this.three.id)) return true;
    const now = performance.now();
    if (now - this.lastThreeTry < 400) return false;
    this.lastThreeTry = now;
    try {
      const firstSymbol = map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
      map.addLayer(this.three, firstSymbol);
      return true;
    } catch {
      // Style not ready yet; the next styledata event retries.
      return false;
    }
  }

  private removeThree() {
    const map = this.map;
    if (map && this.three) {
      try {
        if (map.getLayer(this.three.id)) map.removeLayer(this.three.id);
      } catch {
        // Map already torn down.
      }
    }
    this.three = null;
  }
}

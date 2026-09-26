/**
 * Runs the map effects. It takes the scene's ordinary deck.gl layers,
 * replaces the flat river with real water, and drives one three.js custom
 * layer inside MapLibre (the 3D river surface, 3D towers with sagging wires
 * along the selected pair of planned lines when zoomed in, and the hurricane
 * in the storm replay). Storm damage and wind streaks are deck.gl layers.
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
import { approxWindRadiusKm, stormAt } from "@/lib/response";
import type { PlanSceneProps } from "../planScene";
import type { ResponseSceneProps } from "../responseScene";
import { damageSegmentsLayer } from "./DamageLayers";
import { HurricanePass, type StormVisual } from "./HurricaneLayer";
import { TOWER_ZOOM, TowerField, type PowerFxInput, type StructureCollection } from "./PowerLineLayers";
import { riverFxLayers, riverPaths } from "./RiverLayers";
import { disableTerrain, enableTerrain } from "./terrain";
import { GridPass, TOWER_H } from "./three/Grid3D";
import { RiverPass } from "./three/River3D";
import { ThreeFxLayer } from "./three/ThreeFxLayer";
import { windStreakLayer } from "./WindLayers";

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

/** Replay time glides to the scrubber's value with this time constant, seconds. */
const STORM_SMOOTHING_S = 0.12;
const HOUR_MS = 3.6e6;
/** Base-scene layers the hurricane replaces. */
const STORM_MARKS = new Set(["r-wind-ring", "r-storm-center"]);
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
  private stormPass = new HurricanePass();
  private displayMs: number | null = null;
  private lastTick = 0;
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

  private updateDisplayTime(): number | null {
    const target = this.scene.mode === "response" ? this.scene.response?.timeMs : undefined;
    const now = performance.now();
    const dt = this.lastTick ? Math.min(0.25, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    if (target == null) {
      this.displayMs = null;
    } else if (this.displayMs == null || !this.running || Math.abs(target - this.displayMs) > 6 * HOUR_MS) {
      this.displayMs = target;
    } else {
      this.displayMs += (target - this.displayMs) * (1 - Math.exp(-dt / STORM_SMOOTHING_S));
      if (Math.abs(target - this.displayMs) < 1000) this.displayMs = target;
    }
    return this.displayMs;
  }

  /** The storm at the (smoothed) replay time, sized from its wind and radius of maximum wind. */
  private stormVisual(f: Frame, displayMs: number | null): StormVisual | null {
    const { mode, response } = this.scene;
    if (mode !== "response" || !response || displayMs == null || !response.visible.track) return null;
    const frame = stormAt(response.data.storm, response.times, displayMs);
    if (!frame) return null;
    const outerKm = Math.min(480, Math.max(170, approxWindRadiusKm(frame) * 1.3));
    const wallKm = frame.rmwKm ?? Math.max(18, 72 - 0.38 * frame.windKt);
    return {
      center: frame.position,
      radiusM: outerKm * 1000,
      wall: Math.min(0.4, Math.max(0.07, wallKm / outerKm)),
      eye: Math.min(0.2, Math.max(0.035, (wallKm * 0.5) / outerKm)),
      intensity: Math.max(0, Math.min(1, (frame.windKt - 30) / 90)),
      time: f.time,
      depth: smoothstep(10, 40, f.pitch),
    };
  }

  private compose(base: Layer[], f: Frame): Layer[] {
    const { mode, plan, response } = this.scene;
    const threeOk = this.ensureThree();
    const river = mode === "response" ? response?.data.river : plan?.data.river;
    const displayMs = this.updateDisplayTime();
    const storm = this.stormVisual(f, displayMs);

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
      this.stormPass.setVisual(storm);
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
      if (mode === "response" && response) {
        // The cloud itself marks the storm; the flat ring and dot give way to it.
        if (threeOk && storm && STORM_MARKS.has(id)) continue;
        if (id === "r-segments") {
          out.push(
            damageSegmentsLayer({
              data: response.data,
              reveal: response.reveal.segments,
              epochMs: response.times[0] ?? 0,
              nowMs: displayMs ?? response.timeMs,
              wallTime: f.time,
            }),
          );
          continue;
        }
        if (id === "r-track-future" && storm) out.push(windStreakLayer(storm.center, storm.radiusM, f.time));
      }
      out.push(layer);
    }
    return out;
  }

  /* ---------- three.js custom layer ---------- */

  /** Adds the shared three.js layer below the basemap labels. False until the style can take it. */
  private ensureThree(): boolean {
    const map = this.map;
    if (!map) return false;
    if (!this.three) this.three = new ThreeFxLayer([this.riverPass, this.gridPass, this.stormPass]);
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

/**
 * Runs the realistic map effects. It takes the scene's ordinary deck.gl
 * layers, swaps or augments a few of them (river, power lines) and pushes the result to the overlay, and it drives one three.js
 * custom layer inside MapLibre (3D river, 3D towers and wires).
 *
 * While effects animate it runs its own requestAnimationFrame loop, so React
 * never re-renders per frame; only layers whose uniforms change get new props.
 * In Clean mode the scene's layers pass through untouched, except the river,
 * which keeps its light 2D flow.
 */
import type { Layer } from "@deck.gl/core";
import type { MapboxOverlay, MapboxOverlayProps } from "@deck.gl/mapbox";
import type * as maplibregl from "maplibre-gl";
import type { Bbox } from "@/lib/fx/geometry";
import { metersPerPixel } from "@/lib/fx/geometry";
import type { PlanSceneProps } from "../planScene";
import type { ResponseSceneProps } from "../responseScene";
import {
  constructionLayer,
  flatTowerLayers,
  tiltBlend,
  TOWER_3D_ZOOM,
  TowerField,
  towerFade,
  type PowerFxInput,
  type StructureCollection,
} from "./PowerLineLayers";
import { riverFxLayers, riverPaths } from "./RiverLayers";
import { GridPass, TOWER_H } from "./three/Grid3D";
import { RiverPass } from "./three/River3D";
import { ThreeFxLayer } from "./three/ThreeFxLayer";
import { loadTowerAtlas } from "./towerIcon";

export interface FxScene {
  mode: "plan" | "response";
  plan: PlanSceneProps | null;
  response: ResponseSceneProps | null;
}

export interface FxOptions {
  realistic: boolean;
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
  private opts: FxOptions = { realistic: true, reducedMotion: false };
  private raf = 0;
  private running = false;
  private readonly t0 = typeof performance !== "undefined" ? performance.now() : 0;
  private lastTick = 0;
  private lastRender = 0;
  /** Optional frame cap (?fxfps=N), for low-power devices and headless captures. */
  private readonly minFrameMs = (() => {
    if (typeof window === "undefined") return 0;
    const fps = Number(new URLSearchParams(window.location.search).get("fxfps"));
    return fps > 0 ? 1000 / fps : 0;
  })();
  private towers = new TowerField();
  private atlas: HTMLCanvasElement | null = null;
  private structures: StructureCollection | null = null;
  private three: ThreeFxLayer | null = null;
  private riverPass = new RiverPass();
  private gridPass = new GridPass();
  private threeActive = false;
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
    if (!p) {
      this.power = null;
      return;
    }
    const sel = p.ranked.find((r) => r.overlap.id === p.selectedId)?.overlap;
    this.power = {
      plan: p.data,
      radarMonth: p.radarMonth,
      focus: sel ? new Set([sel.descId, sel.gpcId]) : null,
      structures: this.structures,
    };
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
    loadTowerAtlas()
      .then((a) => {
        this.atlas = a;
        this.renderNow();
      })
      .catch(() => {});
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

  isRealistic(): boolean {
    return this.opts.realistic;
  }

  /* ---------- camera ---------- */

  setTilt(on: boolean, animate = true) {
    const map = this.map;
    if (!map) return;
    const target = { pitch: on ? 55 : 0, bearing: on ? -14 : 0 };
    if (!animate || this.opts.reducedMotion) map.jumpTo(target);
    else map.easeTo({ ...target, duration: 1600, essential: true, easing: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) });
  }

  /* ---------- loop ---------- */

  private onMove = () => {
    if (!this.running) this.renderNow();
  };

  private onStyle = () => {
    if (this.opts.realistic) this.ensureThree();
  };

  private get animating(): boolean {
    return !this.opts.reducedMotion && !!this.overlay && !!this.map;
  }

  private kick() {
    if (this.animating) {
      if (!this.running) {
        this.running = true;
        this.lastTick = performance.now();
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
    const base = (props.layers ?? []) as Layer[];
    const layers = this.opts.realistic ? this.compose(base, f) : this.composeClean(base, f);
    overlay.setProps({ ...props, layers });
  }

  /** Clean: the scene as drawn by its builders, with the river's light 2D flow. */
  private composeClean(base: Layer[], f: Frame): Layer[] {
    this.hideThree();
    const { mode, plan, response } = this.scene;
    const out: Layer[] = [];
    for (const layer of base) {
      const id = layer.id;
      if (id === "river-wash" || id === "r-river-wash") {
        const river = mode === "plan" ? plan?.data.river : response?.data.river;
        if (river) out.push(...riverFxLayers(river, { id: id.replace("-wash", ""), time: f.time, zoom: f.zoom }));
        continue;
      }
      if (id === "river-core" || id === "r-river-core") continue;
      out.push(layer);
    }
    return out;
  }

  private compose(base: Layer[], f: Frame): Layer[] {
    const { mode, plan, response } = this.scene;
    const out: Layer[] = [];
    const threeOk = this.ensureThree();

    const river = mode === "plan" ? plan?.data.river : response?.data.river;
    const power = mode === "plan" && plan ? this.power : null;
    const tilt = tiltBlend(f.pitch);
    const gate3d = smoothstep(TOWER_3D_ZOOM - 0.2, TOWER_3D_ZOOM + 0.4, f.zoom);
    const grow = threeOk ? tilt * gate3d : 0;
    const flat = towerFade(f.zoom) * (1 - grow);
    const towerSet =
      power && (flat > 0 || grow > 0)
        ? this.towers.get(
            power,
            f,
            `${identity(power.plan)}|${power.structures ? "s" : "c"}|${power.radarMonth == null ? "now" : Math.floor(power.radarMonth)}|${plan?.selectedId ?? ""}`,
          )
        : null;

    // three.js passes.
    if (threeOk) {
      this.riverPass.time = f.time;
      this.riverPass.setRiver(river ? riverPaths(river) : null);
      const scale = Math.max(1, (16 * f.mpp) / TOWER_H);
      this.gridPass.setData(towerSet, {
        scale,
        grow,
        thick: Math.min(4, Math.max(1, (0.5 * f.mpp) / (0.15 * scale))),
        wireWidth: 1,
        time: f.time,
      });
      this.map?.triggerRepaint();
    }

    for (const layer of base) {
      const id = layer.id;
      if (id === "river-wash" || id === "r-river-wash") {
        // The 3D water replaces the flat river; the 2D flow stays as a fallback.
        if (!threeOk && river) out.push(...riverFxLayers(river, { id: id.replace("-wash", ""), time: f.time, zoom: f.zoom }));
        continue;
      }
      if (id === "river-core" || id === "r-river-core") continue;

      if (power) {
        const lift = Math.max(towerFade(f.zoom) * (1 - grow), grow);
        if ((id === "context-lines" || id === "project-lines") && lift > 0) {
          out.push(layer.clone({ opacity: 1 - (id === "context-lines" ? 0.6 : 0.4) * lift }));
          continue;
        }
        if (id === "project-substations") {
          if (towerSet) out.push(...flatTowerLayers(towerSet, this.atlas, f.zoom, flat));
          const build = constructionLayer(power, f.time, 1 - grow);
          if (build) out.push(build);
        }
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
    if (!this.three) this.three = new ThreeFxLayer([this.riverPass, this.gridPass]);
    if (map.getLayer(this.three.id)) {
      this.threeActive = true;
      return true;
    }
    const now = performance.now();
    if (now - this.lastThreeTry < 400) return false;
    this.lastThreeTry = now;
    try {
      const firstSymbol = map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
      map.addLayer(this.three, firstSymbol);
      this.threeActive = true;
      return true;
    } catch {
      // Style not ready yet; the next styledata event retries.
      return false;
    }
  }

  private hideThree() {
    if (!this.threeActive) return;
    this.riverPass.setRiver(null);
    this.gridPass.setData(null, { scale: 1, grow: 0, thick: 1, wireWidth: 1, time: 0 });
    this.map?.triggerRepaint();
    this.threeActive = false;
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
    this.threeActive = false;
  }
}

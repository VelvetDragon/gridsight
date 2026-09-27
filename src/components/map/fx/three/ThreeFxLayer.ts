/**
 * One MapLibre custom layer that hosts every three.js effect (river water,
 * 3D towers and wires, the hurricane) with a single WebGLRenderer on the
 * map's own GL context. Each effect is a "pass" with its own scene.
 */
import * as maplibregl from "maplibre-gl";
import type { CustomLayerInterface, CustomRenderMethodInput } from "maplibre-gl";
import * as THREE from "three";

export interface PassFrame {
  renderer: THREE.WebGLRenderer;
  /** MapLibre's mercator [0..1] to clip-space matrix for this frame. */
  main: THREE.Matrix4;
  map: maplibregl.Map;
  /** Drawing-buffer size in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
}

export interface ThreePass {
  readonly name: string;
  init(renderer: THREE.WebGLRenderer): void;
  render(frame: PassFrame): void;
  dispose(): void;
}

/**
 * A local metric frame around an origin: x east, y north, z up, in metres
 * (exact mercator shape, scaled by the origin's metres-per-unit). Keeps
 * vertex coordinates small so float32 stays precise at street zoom.
 */
export class LocalFrame {
  readonly origin: maplibregl.MercatorCoordinate;
  readonly scale: number;
  readonly matrix: THREE.Matrix4;

  constructor(lng: number, lat: number) {
    this.origin = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0);
    this.scale = this.origin.meterInMercatorCoordinateUnits();
    this.matrix = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, 0)
      .scale(new THREE.Vector3(this.scale, -this.scale, this.scale));
  }

  toLocal(lng: number, lat: number): [number, number] {
    const m = maplibregl.MercatorCoordinate.fromLngLat({ lng, lat }, 0);
    return [(m.x - this.origin.x) / this.scale, -(m.y - this.origin.y) / this.scale];
  }
}

export class ThreeFxLayer implements CustomLayerInterface {
  readonly id = "fx-three";
  readonly type = "custom" as const;
  readonly renderingMode = "3d" as const;

  private renderer: THREE.WebGLRenderer | null = null;
  private map: maplibregl.Map | null = null;
  private readonly main = new THREE.Matrix4();

  constructor(private readonly passes: ThreePass[]) {}

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext) {
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    for (const p of this.passes) p.init(this.renderer);
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput) {
    const renderer = this.renderer;
    const map = this.map;
    if (!renderer || !map) return;
    this.main.fromArray(options.defaultProjectionData.mainMatrix as unknown as number[]);
    const canvas = map.getCanvas();
    const pixelRatio = canvas.width / Math.max(1, canvas.clientWidth);
    const frame: PassFrame = {
      renderer,
      main: this.main,
      map,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      pixelRatio,
    };
    renderer.resetState();
    // No setPixelRatio/setSize here: three would write back the canvas size it saw in
    // onAdd, shrinking MapLibre's drawing buffer after every resize (a stretched map).
    // The canvas belongs to MapLibre; three only needs the viewport.
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    for (const p of this.passes) p.render(frame);
  }

  onRemove() {
    for (const p of this.passes) p.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  }
}

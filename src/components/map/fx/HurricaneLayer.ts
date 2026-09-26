/**
 * A procedural hurricane drawn with three.js inside MapLibre's GL context
 * (a pass of the shared ThreeFxLayer), meant to read like the storm seen
 * from orbit: a dense white cloud mass, logarithmic spiral rain bands
 * broken up by domain-warped fbm noise, a sharp eyewall around a clear eye,
 * feathered cirrus at the edge, soft self-shadowing from a low sun and a
 * faint shadow on the ground. The texture turns counter-clockwise, faster
 * near the core, and the whole storm thins as its winds drop over land.
 *
 * In the 3D view the cloud gains volume: the main deck rises into a dome
 * around the eye (which becomes a visible well), with a darker lower deck
 * and a thin cirrus canopy at altitude.
 *
 * It is inserted below the basemap's labels, and the deck.gl overlay (lines,
 * zones, track) draws above it, so the data stays readable through the storm.
 */
import * as maplibregl from "maplibre-gl";
import * as THREE from "three";
import type { Position } from "@/lib/types";
import type { PassFrame, ThreePass } from "./three/ThreeFxLayer";

export interface StormVisual {
  center: Position;
  /** Outer cloud radius, metres. */
  radiusM: number;
  /** Eye and eyewall radius as fractions of radiusM. */
  eye: number;
  wall: number;
  /** 0 (tropical storm) .. 1 (major hurricane). */
  intensity: number;
  /** Wall-clock seconds, drives rotation and cloud evolution. */
  time: number;
  /** 0 flat map .. 1 tilted 3D view. */
  depth: number;
}

const NOISE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uSpin;
uniform float uEye;
uniform float uWall;
uniform float uIntensity;
uniform float uDepth;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.0;
  float a = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    norm += a;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.1;
    a *= 0.5;
  }
  return s / norm;
}
vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
// Domain-warped cloud texture: puffy cells with torn, streaky edges.
float clouds(vec2 q, int oct) {
  vec2 w = vec2(fbm(q * 0.7 + 5.2, 3), fbm(q * 0.7 - 3.7, 3));
  float n = fbm(q + (w - 0.5) * 2.2, oct);
  return smoothstep(0.2, 0.8, n);
}
// Texture in a frame that turns counter-clockwise, faster near the eyewall
// (differential rotation). Two phases cross-fade so winding never runs away.
float swirl(vec2 p, float r, int oct) {
  float w = 0.3 / max(r, 0.3);
  // A static log-spiral twist makes the streaks curve inwards, as real cloud lines do.
  float twist = 1.1 * log(max(r, 0.03));
  float ph = uTime / 28.0;
  float f1 = fract(ph);
  float f2 = fract(ph + 0.5);
  // Stretch the texture along the flow so it streaks around the centre.
  vec2 q1 = rot2(p, -uSpin - w * f1 - twist);
  vec2 q2 = rot2(p, -uSpin - w * f2 - twist);
  float n1 = clouds(q1 * 5.5 + 3.1, oct);
  float n2 = clouds(q2 * 5.5 + 23.7, oct);
  return mix(n2, n1, 1.0 - abs(2.0 * f1 - 1.0));
}
float gCore;
float gTex;
float stormDensity(vec2 p, int oct) {
  float r = length(p);
  float th = atan(p.y, p.x);
  float n = swirl(p, r, oct);
  // Rain bands: logarithmic spirals winding counter-clockwise into the core.
  float lr = log(max(r, 0.02));
  float warp = (n - 0.5) * 2.2;
  float b1 = 0.5 + 0.5 * cos(2.0 * (th - uSpin + 2.4 * lr) + warp);
  float b2 = 0.5 + 0.5 * cos(3.0 * (th - uSpin + 2.2 * lr) + warp * 1.3 + 1.7);
  float org = 0.55 + 0.45 * uIntensity;
  float bands = (pow(b1, 2.0) * 1.0 + pow(b2, 3.0) * 0.45) * org;
  bands *= smoothstep(uWall * 1.1, uWall * 1.9 + 0.06, r) * (1.0 - smoothstep(0.6, 1.0, r));
  // Central dense overcast and the eyewall ring.
  float cdoR = uWall * (1.5 + 1.1 * uIntensity) + 0.05;
  float cdo = 1.0 - smoothstep(cdoR * 0.55, cdoR * 1.2 + 0.1 * (n - 0.5), r);
  float wallW = 0.035 + 0.05 * (1.0 - uIntensity);
  float wall = exp(-pow((r - uWall) / wallW, 2.0));
  gCore = cdo;
  gTex = n;
  float d = max(cdo * (0.7 + 0.4 * n), bands * (0.35 + 0.85 * n));
  d = max(d, wall * (0.9 + 0.15 * n));
  // A clear eye with a sharp inner edge, only for organised storms.
  float eyeEdge = uEye * (0.92 + 0.12 * (n - 0.5));
  float eye = smoothstep(eyeEdge * 0.78, eyeEdge, r);
  d *= mix(1.0, eye, smoothstep(0.25, 0.6, uIntensity));
  // Feathered outer edge and cumulus erosion away from the core.
  d *= 1.0 - smoothstep(0.62 + 0.3 * n, 1.0, r);
  float erosion = (1.0 - cdo) * 0.3;
  d = clamp((d - erosion * (1.0 - n)) / (1.0 - erosion * 0.5), 0.0, 1.0);
  // Weak storms are thinner overall.
  return d * (0.7 + 0.3 * uIntensity);
}
`;

const CLOUD_VS = /* glsl */ `
${NOISE_GLSL}
uniform float uHeight;
uniform float uLift;
varying vec2 vP;
void main() {
  vec2 p = position.xy;
  float r = length(p);
  float d = stormDensity(p, 2);
  // Billowy relief: a dome over the core, the eyewall towering highest, the
  // bands as low ridges, and only a little of the fine texture.
  float wall = exp(-pow((r - uWall) / 0.07, 2.0)) * uIntensity;
  float eyeWell = smoothstep(uEye * 0.6, uEye * 1.3, r);
  float h = uHeight * (0.55 * gCore + 0.6 * wall + 0.3 * d + 0.12 * gTex * d) * eyeWell + uLift;
  h *= 0.12 + 0.88 * uDepth;
  vP = p;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, h, 1.0);
}
`;

const CLOUD_FS = /* glsl */ `
${NOISE_GLSL}
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vP;
void main() {
  float d = stormDensity(vP, 5);
  float core = gCore;
  float tex = gTex;
  // Low sun from the north-west: slopes rising towards it fall into shadow.
  vec2 toSun = normalize(vec2(-0.7, 0.7));
  float d2 = stormDensity(vP + toSun * 0.012, 4);
  float slope = (d2 - d) * 6.0;
  float light = clamp(0.82 - slope + 0.18 * d, 0.0, 1.0);
  vec3 shade = vec3(0.56, 0.61, 0.69);
  vec3 lit = vec3(0.985, 0.99, 1.0);
  vec3 col = mix(shade, lit, light);
  // Thin cloud reads blue-grey, thick cloud bright white; the eyewall's inner
  // face stays a touch darker, like a stadium wall.
  float r = length(vP);
  float innerWall = smoothstep(uEye * 0.8, uEye * 1.4, r) * (1.0 - smoothstep(uEye * 1.4, uWall, r));
  col = mix(col * vec3(0.84, 0.88, 0.95), col, smoothstep(0.12, 0.7, d));
  col *= 1.0 - 0.1 * innerWall * uIntensity;
  // Bumpy convective tops catch the light; troughs between them fall grey.
  col *= 0.86 + 0.2 * tex;
  col *= uTint;
  // The dense core is nearly opaque, the bands stay see-through.
  float alpha = min(0.9, smoothstep(0.04, 0.62, d) * uOpacity * mix(1.0, 1.28, core));
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

const SHADOW_FS = /* glsl */ `
${NOISE_GLSL}
uniform float uOpacity;
varying vec2 vP;
void main() {
  // The shadow falls to the south-east of the cloud, further when tilted.
  float d = stormDensity(vP + normalize(vec2(-0.7, 0.7)) * (0.02 + 0.04 * uDepth), 3);
  float alpha = smoothstep(0.15, 0.85, d) * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(0.12, 0.15, 0.22, alpha);
}
`;

const CANOPY_FS = /* glsl */ `
${NOISE_GLSL}
uniform float uOpacity;
varying vec2 vP;
void main() {
  float r = length(vP);
  float th = atan(vP.y, vP.x);
  // Cirrus outflow turns slowly clockwise and streaks along the flow.
  float a = th + uTime * 0.015;
  float streaks = fbm(vec2(a * 6.0, r * 22.0 - a * 2.5), 4);
  float canopy = (1.0 - smoothstep(uWall * 2.0, uWall * 3.6 + 0.15, r)) * smoothstep(uEye * 1.3, uEye * 2.6, r);
  float alpha = canopy * smoothstep(0.4, 0.85, streaks) * uOpacity * uIntensity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(0.97, 0.98, 1.0, alpha);
}
`;

const FLAT_VS = /* glsl */ `
uniform float uLift;
uniform float uDepth;
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, uLift * (0.12 + 0.88 * uDepth), 1.0);
}
`;

/** A unit disc as a polar grid, denser towards the centre where the eye needs detail. */
function polarDisc(rings: number, segments: number): THREE.BufferGeometry {
  const pos: number[] = [0, 0, 0];
  for (let i = 1; i <= rings; i++) {
    const r = (i / rings) ** 1.4;
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      pos.push(r * Math.cos(a), r * Math.sin(a), 0);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segments; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segments));
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segments;
    const b0 = 1 + i * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

interface Uniforms {
  [key: string]: THREE.IUniform;
}

/** The storm as a pass of the shared three.js layer. */
export class HurricanePass implements ThreePass {
  readonly name = "hurricane";
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private disposables: { dispose: () => void }[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private visual: StormVisual | null = null;
  private readonly model = new THREE.Matrix4();
  private readonly scaleVec = new THREE.Vector3();
  private readonly shared: Uniforms = {
    uTime: { value: 0 },
    uSpin: { value: 0 },
    uEye: { value: 0.1 },
    uWall: { value: 0.2 },
    uIntensity: { value: 0.6 },
    uDepth: { value: 0 },
  };

  /** Current storm, or null to draw nothing. */
  setVisual(v: StormVisual | null) {
    this.visual = v;
  }

  init() {
    const make = (fs: string, vs: string, extra: Uniforms, opts: Partial<THREE.ShaderMaterialParameters>) => {
      const m = new THREE.ShaderMaterial({
        // Shared uniform objects: one update per frame reaches every deck.
        uniforms: { ...this.shared, ...extra },
        vertexShader: vs,
        fragmentShader: fs,
        transparent: true,
        side: THREE.DoubleSide,
        ...opts,
      });
      this.materials.push(m);
      this.disposables.push(m);
      return m;
    };

    const cloudGeo = polarDisc(96, 224);
    const flatGeo = new THREE.CircleGeometry(1, 160);
    this.disposables.push(cloudGeo, flatGeo);

    const meshes = [
      new THREE.Mesh(flatGeo, make(SHADOW_FS, FLAT_VS, { uOpacity: { value: 0.16 }, uLift: { value: 0 } }, { depthTest: false, depthWrite: false })),
      // A darker lower deck gives the bands depth when the camera is tilted.
      new THREE.Mesh(
        cloudGeo,
        make(
          CLOUD_FS,
          CLOUD_VS,
          { uOpacity: { value: 0.24 }, uHeight: { value: 0.012 }, uLift: { value: 0.006 }, uTint: { value: new THREE.Color(0.78, 0.82, 0.88) } },
          { depthTest: false, depthWrite: false },
        ),
      ),
      new THREE.Mesh(
        cloudGeo,
        make(
          CLOUD_FS,
          CLOUD_VS,
          { uOpacity: { value: 0.66 }, uHeight: { value: 0.045 }, uLift: { value: 0.02 }, uTint: { value: new THREE.Color(1, 1, 1) } },
          { depthTest: true, depthWrite: true },
        ),
      ),
      new THREE.Mesh(flatGeo, make(CANOPY_FS, FLAT_VS, { uOpacity: { value: 0.2 }, uLift: { value: 0.06 } }, { depthTest: true, depthWrite: false })),
    ];
    meshes.forEach((mesh, i) => {
      mesh.frustumCulled = false;
      mesh.renderOrder = i;
      this.scene.add(mesh);
    });
  }

  render({ renderer, main }: PassFrame) {
    const v = this.visual;
    if (!v) return;
    const mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: v.center[0], lat: v.center[1] }, 0);
    const s = mc.meterInMercatorCoordinateUnits() * v.radiusM;
    this.model.makeTranslation(mc.x, mc.y, 0).scale(this.scaleVec.set(s, -s, s));
    this.camera.projectionMatrix.copy(main).multiply(this.model);
    const u = this.shared;
    u.uTime.value = v.time;
    u.uSpin.value = v.time * 0.09;
    u.uEye.value = v.eye;
    u.uWall.value = v.wall;
    u.uIntensity.value = v.intensity;
    u.uDepth.value = v.depth;
    // Clouds sort among themselves only; nothing on the ground hides them.
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.materials = [];
    this.scene.clear();
  }
}

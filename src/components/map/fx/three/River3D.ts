/**
 * The Savannah River as a 3D water surface: a ribbon built from the
 * downstream-oriented centreline, shaded with scrolling ripple normals,
 * depth tint (deep channel, light banks), Fresnel sky reflection, sun
 * glints that appear when the camera tilts, and soft foam at the banks.
 * Flow runs downstream (Augusta to the Atlantic) along arc length.
 */
import type * as maplibregl from "maplibre-gl";
import * as THREE from "three";
import type { Position } from "@/lib/types";
import { LocalFrame, type PassFrame, type ThreePass } from "./ThreeFxLayer";

export interface RiverLine {
  path: Position[];
  distances: number[];
}

const VS = /* glsl */ `
attribute vec2 aNormal;
attribute float aSide;
attribute float aDist;
attribute float aElev;
uniform float uHalfWidth;
varying float vSide;
varying float vDist;
varying vec2 vT;
void main() {
  vSide = aSide;
  vT = normalize(vec2(aNormal.y, -aNormal.x));
  vDist = aDist;
  vec3 p = vec3(position.xy + aNormal * aSide * uHalfWidth, aElev + 1.5);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FS = /* glsl */ `
uniform float uHalfWidth;
uniform float uFlow;
uniform float uRipple;
uniform float uMpp;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uToCamera;
uniform vec3 uToSun;
varying float vSide;
varying float vDist;
varying vec2 vT;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float waves(vec2 q) {
  return noise(q) * 0.6 + noise(q * 2.3 + 7.1) * 0.3 + noise(q * 5.1 - 3.7) * 0.1;
}

void main() {
  float ax = abs(vSide);
  float across = vSide * uHalfWidth;
  // Ripple wavelength in metres, never finer than a few pixels.
  float wl = max(14.0, uMpp * 7.0);
  float px = uHalfWidth / uMpp;
  float detail = smoothstep(5.0, 18.0, px);
  vec2 q1 = vec2((vDist - uRipple) / wl, across / (wl * 0.65) + uTime * 0.03);
  vec2 q2 = vec2((vDist - uRipple * 0.55) / (wl * 2.6) + 3.1, across / (wl * 1.7) - uTime * 0.02);
  float e = 0.35;
  float h = waves(q1) + 0.7 * waves(q2);
  float hx = waves(q1 + vec2(e, 0.0)) + 0.7 * waves(q2 + vec2(e / 2.6, 0.0));
  float hy = waves(q1 + vec2(0.0, e)) + 0.7 * waves(q2 + vec2(0.0, e / 1.7));
  float amp = 0.55 * detail;
  // Ripple slopes are along (downstream, across); rotate them into east/north/up.
  vec2 dn = vec2(-(hx - h) / e * amp, -(hy - h) / e * amp);
  vec2 T = normalize(vT);
  vec3 N = normalize(vec3(T * dn.x + vec2(-T.y, T.x) * dn.y, 1.0));

  vec3 deep = vec3(0.15, 0.38, 0.56);
  vec3 shallow = vec3(0.44, 0.67, 0.80);
  vec3 base = mix(deep, shallow, smoothstep(0.15, 1.0, ax));
  base *= 0.93 + 0.14 * h * detail;

  vec3 V = normalize(uToCamera);
  float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  vec3 sky = vec3(0.82, 0.89, 0.96);
  vec3 col = mix(base, sky, clamp(fres, 0.0, 1.0) * 0.9);

  vec3 R = reflect(-normalize(uToSun), N);
  float rv = max(dot(R, V), 0.0);
  col += vec3(1.0, 0.97, 0.9) * (pow(rv, 140.0) * 1.8 * detail + pow(rv, 10.0) * 0.1);

  // Drifting flow streaks: the readable cue at low zoom.
  float sp = uMpp * 46.0;
  float streak = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float lane = (fi - 1.0) * 0.45;
    float u = (vDist - uFlow * (1.0 + 0.2 * fi)) / (sp * (1.0 + 0.37 * fi)) + fi * 0.37;
    float f = fract(u);
    float rnd = hash(vec2(floor(u), fi * 13.0));
    float len = 0.42 * (0.5 + 0.7 * rnd);
    float t = f / len;
    float s = t < 1.0 ? t * t * (1.0 - smoothstep(0.82, 1.0, t)) : 0.0;
    s *= step(0.25, rnd);
    float laneMask = mix(0.8, exp(-pow((vSide - lane) / 0.22, 2.0)), smoothstep(3.0, 9.0, px));
    streak = max(streak, s * laneMask);
  }
  col = mix(col, vec3(0.95, 0.98, 1.0), streak * mix(0.75, 0.35, detail));

  // Soft foam along the banks.
  float foam = smoothstep(0.8, 0.97, ax) * (0.45 + 0.55 * noise(vec2((vDist - uRipple * 0.3) / (wl * 0.8), vSide * 3.0)));
  col = mix(col, vec3(0.93, 0.96, 0.98), foam * 0.55 * detail);

  float alpha = uOpacity * (1.0 - smoothstep(0.9, 1.0, ax));
  gl_FragColor = vec4(col, alpha);
}
`;

/** Chaikin corner cutting, so coarse centrelines read as a flowing river. */
function smooth(path: Position[], rounds: number): Position[] {
  let p = path;
  for (let r = 0; r < rounds; r++) {
    const out: Position[] = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

interface Built {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  lngLats: Position[];
  elev: THREE.BufferAttribute;
}

export class RiverPass implements ThreePass {
  readonly name = "river";
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private material: THREE.ShaderMaterial | null = null;
  private built: Built | null = null;
  private source: RiverLine[] | null = null;
  private frame: LocalFrame | null = null;
  private flow = 0;
  private ripple = 0;
  private last = 0;
  private visible = false;
  private terrainKey = "";
  time = 0;

  /** River centrelines (downstream order) or null to hide. */
  setRiver(lines: RiverLine[] | null) {
    this.visible = !!lines?.length;
    if (!lines || lines === this.source) return;
    this.source = lines;
    this.rebuild();
  }

  init() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uHalfWidth: { value: 80 },
        uFlow: { value: 0 },
        uRipple: { value: 0 },
        uMpp: { value: 10 },
        uTime: { value: 0 },
        uOpacity: { value: 0.94 },
        uToCamera: { value: new THREE.Vector3(0, 0, 1) },
        uToSun: { value: new THREE.Vector3(-0.55, 0.55, 0.63) },
      },
    });
    this.rebuild();
  }

  private rebuild() {
    if (!this.material || !this.source) return;
    if (this.built) {
      this.scene.remove(this.built.mesh);
      this.built.geometry.dispose();
      this.built = null;
    }
    const lines = this.source;
    const first = lines[0]?.path[0];
    if (!first) return;
    const frame = (this.frame ??= new LocalFrame(first[0], first[1]));
    const pos: number[] = [];
    const nrm: number[] = [];
    const side: number[] = [];
    const dist: number[] = [];
    const idx: number[] = [];
    const lngLats: Position[] = [];
    let base = 0;
    for (const line of lines) {
      const avg = line.distances[line.distances.length - 1] / Math.max(1, line.path.length - 1);
      const path = avg > 700 ? smooth(line.path, 3) : line.path;
      const pts = path.map((p) => frame.toLocal(p[0], p[1]));
      let d = 0;
      for (let i = 0; i < pts.length; i++) {
        if (i > 0) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        // Miter: keep the ribbon width constant through bends.
        let miter = 1;
        if (i > 0 && i < pts.length - 1) {
          const sx = pts[i][0] - a[0];
          const sy = pts[i][1] - a[1];
          const sl = Math.hypot(sx, sy) || 1;
          const cos = (sx / sl) * tx + (sy / sl) * ty;
          miter = 1 / Math.max(0.5, cos);
        }
        for (const s of [-1, 1]) {
          pos.push(pts[i][0], pts[i][1], 0);
          nrm.push(-ty * miter, tx * miter);
          side.push(s);
          dist.push(d);
        }
        lngLats.push(path[i]);
        if (i > 0) {
          const k = base + i * 2;
          idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
      }
      base += pts.length * 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aNormal", new THREE.Float32BufferAttribute(nrm, 2));
    g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1));
    const elev = new THREE.Float32BufferAttribute(new Float32Array(side.length), 1);
    elev.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aElev", elev);
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.built = { mesh, geometry: g, lngLats, elev };
    this.terrainKey = "";
  }

  /** Lifts the water onto the terrain surface when 3D terrain is on. */
  private syncTerrain(map: maplibregl.Map) {
    const b = this.built;
    if (!b) return;
    const terrain = map.getTerrain();
    // Re-sample occasionally while DEM tiles stream in.
    const key = terrain ? `${terrain.exaggeration ?? 1}|${Math.floor(performance.now() / 1500)}` : "flat";
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    const arr = b.elev.array as Float32Array;
    for (let i = 0; i < b.lngLats.length; i++) {
      const e = terrain ? (map.queryTerrainElevation(b.lngLats[i] as [number, number]) ?? 0) : 0;
      arr[i * 2] = e;
      arr[i * 2 + 1] = e;
    }
    b.elev.needsUpdate = true;
  }

  render({ renderer, main, map }: PassFrame) {
    const m = this.material;
    if (!this.visible || !this.built || !m || !this.frame) return;
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const zoom = map.getZoom();
    const lat = map.getCenter().lat;
    const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    // Flow advances in screen space so it reads the same at every zoom.
    this.flow += dt * 16 * mpp;
    this.ripple += dt * Math.max(0.6, 6 * mpp);
    const pitch = (map.getPitch() * Math.PI) / 180;
    const bearing = (map.getBearing() * Math.PI) / 180;
    m.uniforms.uHalfWidth.value = Math.max(70, 2.3 * mpp);
    m.uniforms.uFlow.value = this.flow;
    m.uniforms.uRipple.value = this.ripple;
    m.uniforms.uMpp.value = mpp;
    m.uniforms.uTime.value = this.time;
    (m.uniforms.uToCamera.value as THREE.Vector3).set(
      -Math.sin(bearing) * Math.sin(pitch),
      -Math.cos(bearing) * Math.sin(pitch),
      Math.cos(pitch),
    );
    this.syncTerrain(map);
    this.camera.projectionMatrix.copy(main).multiply(this.frame.matrix);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.built) {
      this.built.geometry.dispose();
      this.scene.remove(this.built.mesh);
    }
    this.built = null;
    this.material?.dispose();
    this.material = null;
  }
}

/**
 * Transmission lines in true 3D: procedural steel lattice towers (tapered
 * four-leg body, X-bracing, cross-arm truss, earth-wire peaks, insulator
 * strings) and wood poles, drawn with InstancedMesh, plus catenary
 * conductors rendered as anti-aliased screen-space ribbons.
 *
 * Heights are real (about 38 m towers) at street zoom and scaled up only as
 * far as needed to stay visible further out. Everything rises out of the
 * ground as the camera tilts, so the flat map stays clean.
 */
import type * as maplibregl from "maplibre-gl";
import * as THREE from "three";
import { catenarySag } from "@/lib/fx/geometry";
import type { Position } from "@/lib/types";
import { LocalFrame, type PassFrame, type ThreePass } from "./ThreeFxLayer";

/* ---------------- data ---------------- */

export interface GridTower3D {
  position: Position;
  /** Unit (east, north) along the cross-arm. */
  arm: [number, number];
  /** 0 neutral (existing), 1 DESC, 2 GPC. */
  style: number;
  pole: boolean;
}

export interface GridSpan3D {
  a: GridTower3D;
  b: GridTower3D;
  meters: number;
  style: number;
  /** Under construction at the current timeline month. */
  building: boolean;
  /** Metres along the line at tower a (for the construction pulse). */
  along: number;
}

export interface GridData3D {
  towers: GridTower3D[];
  spans: GridSpan3D[];
}

/* ---------------- procedural geometry ---------------- */

type V3 = [number, number, number];

/** Nominal structure heights, metres. */
export const TOWER_H = 37.5;
const TOWER_PHASES: V3[] = [
  [-8.6, 0, 25.6],
  [0, 0, 25.6],
  [8.6, 0, 25.6],
];
const POLE_PHASES: V3[] = [
  [-2.1, 0, 16.4],
  [2.1, 0, 16.4],
  [0, 0, 17.8],
];

class MemberBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  inflate: number[] = [];
  mat: number[] = [];
  idx: number[] = [];

  /** A square-section member from a to b; `material` 0 steel, 1 insulator. */
  add(a: V3, b: V3, t: number, material = 0) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const ref = Math.abs(d.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const u = new THREE.Vector3().crossVectors(d, ref).normalize();
    const v = new THREE.Vector3().crossVectors(d, u).normalize();
    const h = t / 2;
    const corner = (end: V3, su: number, sv: number): [V3, V3] => {
      const off: V3 = [(u.x * su + v.x * sv) * h, (u.y * su + v.y * sv) * h, (u.z * su + v.z * sv) * h];
      return [[end[0] + off[0], end[1] + off[1], end[2] + off[2]], off];
    };
    const faces: { n: THREE.Vector3; c: [number, number][] }[] = [
      { n: u, c: [[1, -1], [1, 1]] },
      { n: v, c: [[1, 1], [-1, 1]] },
      { n: u.clone().negate(), c: [[-1, 1], [-1, -1]] },
      { n: v.clone().negate(), c: [[-1, -1], [1, -1]] },
    ];
    for (const f of faces) {
      const base = this.pos.length / 3;
      const quad = [corner(a, ...f.c[0]), corner(a, ...f.c[1]), corner(b, ...f.c[1]), corner(b, ...f.c[0])];
      for (const [p, off] of quad) {
        this.pos.push(...p);
        this.nrm.push(f.n.x, f.n.y, f.n.z);
        this.inflate.push(...off);
        this.mat.push(material);
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("aInflate", new THREE.Float32BufferAttribute(this.inflate, 3));
    g.setAttribute("aMat", new THREE.Float32BufferAttribute(this.mat, 1));
    g.setIndex(this.idx);
    return g;
  }
}

function latticeTower(): THREE.BufferGeometry {
  const m = new MemberBuilder();
  const half = (z: number) => 4.8 + (1.6 - 4.8) * (z / 22);
  const rings = [0.25, 5.5, 10.5, 15, 19, 22];
  const signs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  // Legs.
  for (const [sx, sy] of signs) m.add([sx * 4.8, sy * 4.8, 0], [sx * 1.6, sy * 1.6, 22], 0.5);
  // Rings and X-bracing on all four faces.
  rings.forEach((z, i) => {
    const h = half(z);
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = signs[k];
      const [bx, by] = signs[(k + 1) % 4];
      m.add([ax * h, ay * h, z], [bx * h, by * h, z], 0.2);
      if (i > 0) {
        const zp = rings[i - 1];
        const hp = half(zp);
        m.add([ax * hp, ay * hp, zp], [bx * h, by * h, z], 0.15);
        m.add([bx * hp, by * hp, zp], [ax * h, ay * h, z], 0.15);
      }
    }
  });
  // Upper window: columns splay out to the cross-arm.
  for (const [sx, sy] of signs) m.add([sx * 1.6, sy * 1.6, 22], [sx * 3.8, sy * 1.1, 29], 0.38);
  for (const sy of [-1, 1]) m.add([-3.8, sy * 1.1, 29], [3.8, sy * 1.1, 29], 0.28);
  for (const sx of [-1, 1]) {
    m.add([sx * 3.8, -1.1, 29], [sx * 3.8, 1.1, 29], 0.24);
    m.add([sx * 1.6, -1.6, 22], [sx * 3.8, 1.1, 29], 0.14);
    // Cross-arm truss.
    for (const sy of [-1, 1]) {
      m.add([sx * 3.8, sy * 1.1, 29], [sx * 10, sy * 0.35, 29], 0.28);
      m.add([sx * 3.8, sy * 1.1, 29], [sx * 3.8, 0, 31.8], 0.22);
      for (const x of [5.8, 7.8]) {
        const zt = 31.8 + ((29.2 - 31.8) * (x - 3.8)) / (10 - 3.8);
        const yb = 1.1 + ((0.35 - 1.1) * (x - 3.8)) / (10 - 3.8);
        m.add([sx * x, sy * yb, 29], [sx * x, 0, zt], 0.13);
      }
    }
    m.add([sx * 3.8, 0, 31.8], [sx * 10, 0, 29.2], 0.26);
    m.add([sx * 10, -0.35, 29], [sx * 10, 0.35, 29], 0.2);
    // Earth-wire peak.
    m.add([sx * 3.8, 0, 31.8], [sx * 3.0, 0, 37.5], 0.26);
    m.add([sx * 2.0, 0, 31.8], [sx * 3.0, 0, 37.5], 0.2);
  }
  m.add([-3.8, 0, 31.8], [3.8, 0, 31.8], 0.26);
  m.add([-3.35, 0, 34.6], [3.35, 0, 34.6], 0.18);
  // Insulator strings.
  for (const [x, , z] of TOWER_PHASES) m.add([x, 0, 29], [x, 0, z], 0.34, 1);
  return m.build();
}

function woodPole(): THREE.BufferGeometry {
  const m = new MemberBuilder();
  m.add([0, 0, 0], [0, 0, 17.4], 0.42);
  m.add([-2.5, 0, 15.6], [2.5, 0, 15.6], 0.2);
  m.add([-1.2, 0, 14.6], [0, 0, 15.6], 0.1);
  m.add([1.2, 0, 14.6], [0, 0, 15.6], 0.1);
  for (const [x, , z] of POLE_PHASES) m.add([x, 0, z - 0.8], [x, 0, z], 0.24, 1);
  return m.build();
}

/* ---------------- shaders ---------------- */

const TOWER_VS = /* glsl */ `
attribute vec3 aInflate;
attribute float aMat;
uniform float uScale;
uniform float uGrow;
uniform float uThick;
varying vec3 vN;
varying float vMat;
varying float vH;
varying vec3 vTint;
void main() {
  vec3 p = position + aInflate * (uThick - 1.0);
  p *= uScale;
  p.z *= uGrow;
  vec4 w = instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(instanceMatrix) * normal);
  vMat = aMat;
  vH = position.z / 38.0;
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(0.6);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * w;
}
`;

const TOWER_FS = /* glsl */ `
uniform vec3 uToSun;
varying vec3 vN;
varying float vMat;
varying float vH;
varying vec3 vTint;
void main() {
  vec3 N = normalize(vN);
  float diff = max(dot(N, normalize(uToSun)), 0.0);
  float sky = 0.5 + 0.5 * N.z;
  vec3 base = mix(vTint, vec3(0.52, 0.6, 0.68), step(0.5, vMat));
  vec3 col = base * (0.42 + 0.3 * sky + 0.55 * diff);
  col *= mix(0.78, 1.0, smoothstep(0.0, 0.35, vH));
  gl_FragColor = vec4(col, 1.0);
}
`;

const WIRE_VS = /* glsl */ `
attribute vec3 aP0;
attribute vec3 aO0;
attribute vec3 aP1;
attribute vec3 aO1;
attribute vec2 aCorner;
attribute vec4 aColor;
attribute float aWidth;
attribute float aAlong;
attribute float aPulse;
uniform float uScale;
uniform float uGrow;
uniform float uWidthScale;
uniform vec2 uViewport;
varying vec4 vColor;
varying float vSide;
varying float vAlong;
varying float vPulse;
vec3 place(vec3 p, vec3 o) {
  return vec3(p.xy + o.xy * uScale, p.z + o.z * uScale * uGrow);
}
void main() {
  vec4 c0 = projectionMatrix * modelViewMatrix * vec4(place(aP0, aO0), 1.0);
  vec4 c1 = projectionMatrix * modelViewMatrix * vec4(place(aP1, aO1), 1.0);
  vec4 c = aCorner.x < 0.5 ? c0 : c1;
  if (c0.w <= 0.0 || c1.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  vec2 s0 = c0.xy / c0.w * uViewport;
  vec2 s1 = c1.xy / c1.w * uViewport;
  vec2 dir = s1 - s0;
  dir = length(dir) > 1e-5 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w = aWidth * uWidthScale + 1.0;
  c.xy += nrm * aCorner.y * (w * 0.5) / uViewport * c.w;
  gl_Position = c;
  vColor = aColor;
  vSide = aCorner.y;
  vAlong = aAlong;
  vPulse = aPulse;
}
`;

const WIRE_FS = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
varying vec4 vColor;
varying float vSide;
varying float vAlong;
varying float vPulse;
void main() {
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
  vec3 col = vColor.rgb;
  if (vPulse > 0.5) {
    // Energising pulse running along lines under construction.
    float f = fract((vAlong - uTime * 900.0) / 2400.0);
    float p = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.08, 0.3, f));
    col = mix(col, vec3(1.0, 0.93, 0.72), p * 0.85);
  }
  float a = vColor.a * edge * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
`;

/* ---------------- pass ---------------- */

const STEEL = new THREE.Color(0.6, 0.63, 0.67);
const TOWER_TINT = [STEEL, new THREE.Color(0.2, 0.55, 0.54), new THREE.Color(0.78, 0.4, 0.22)];
const POLE_TINT = new THREE.Color(0.47, 0.38, 0.3);
const WIRE_RGB: [number, number, number][] = [
  [0.2, 0.22, 0.26],
  [0.05, 0.36, 0.36],
  [0.55, 0.2, 0.06],
];
const WIRE_STEPS = 10;
const MAX_INSTANCES = 4500;

export interface GridView {
  /** Height multiplier (1 = real size). */
  scale: number;
  /** 0..1: towers rise out of the ground. */
  grow: number;
  /** Member thickness multiplier so thin steel never vanishes. */
  thick: number;
  wireWidth: number;
  time: number;
}

export class GridPass implements ThreePass {
  readonly name = "grid";
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private towerGeo: THREE.BufferGeometry | null = null;
  private poleGeo: THREE.BufferGeometry | null = null;
  private towerMat: THREE.ShaderMaterial | null = null;
  private wireMat: THREE.ShaderMaterial | null = null;
  private towers: THREE.InstancedMesh | null = null;
  private poles: THREE.InstancedMesh | null = null;
  private wires: THREE.Mesh | null = null;
  private wireGeo: THREE.BufferGeometry | null = null;
  private data: GridData3D | null = null;
  private built: GridData3D | null = null;
  private frame: LocalFrame | null = null;
  private view: GridView = { scale: 1, grow: 0, thick: 1, wireWidth: 1.4, time: 0 };
  private terrainKey = "";

  setData(data: GridData3D | null, view: GridView) {
    this.data = data;
    this.view = view;
  }

  init() {
    this.towerGeo = latticeTower();
    this.poleGeo = woodPole();
    const sun = new THREE.Vector3(-0.5, 0.45, 0.74).normalize();
    this.towerMat = new THREE.ShaderMaterial({
      vertexShader: TOWER_VS,
      fragmentShader: TOWER_FS,
      side: THREE.DoubleSide,
      uniforms: {
        uScale: { value: 1 },
        uGrow: { value: 1 },
        uThick: { value: 1 },
        uToSun: { value: sun },
      },
    });
    this.wireMat = new THREE.ShaderMaterial({
      vertexShader: WIRE_VS,
      fragmentShader: WIRE_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uScale: { value: 1 },
        uGrow: { value: 1 },
        uWidthScale: { value: 1 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
      },
    });
  }

  private clear() {
    for (const obj of [this.towers, this.poles, this.wires]) if (obj) this.scene.remove(obj);
    this.towers?.dispose();
    this.poles?.dispose();
    this.wireGeo?.dispose();
    this.towers = this.poles = this.wires = null;
    this.wireGeo = null;
  }

  private rebuild(data: GridData3D) {
    this.clear();
    this.built = data;
    this.terrainKey = "";
    if (!this.towerGeo || !this.poleGeo || !this.towerMat || !this.wireMat || !data.towers.length) return;
    const c = data.towers[Math.floor(data.towers.length / 2)].position;
    this.frame = new LocalFrame(c[0], c[1]);
    const lattice = data.towers.filter((t) => !t.pole).slice(0, MAX_INSTANCES);
    const poles = data.towers.filter((t) => t.pole).slice(0, MAX_INSTANCES);
    const mk = (list: GridTower3D[], geo: THREE.BufferGeometry, tint: (t: GridTower3D) => THREE.Color) => {
      if (!list.length) return null;
      const mesh = new THREE.InstancedMesh(geo, this.towerMat!, list.length);
      mesh.frustumCulled = false;
      list.forEach((t, i) => mesh.setColorAt(i, tint(t)));
      mesh.userData.list = list;
      this.scene.add(mesh);
      return mesh;
    };
    this.towers = mk(lattice, this.towerGeo, (t) => TOWER_TINT[t.style] ?? STEEL);
    this.poles = mk(poles, this.poleGeo, () => POLE_TINT);
    this.buildWires(data);
  }

  private placeInstances(map: maplibregl.Map | null) {
    const frame = this.frame;
    if (!frame) return;
    const terrain = map?.getTerrain();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const one = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    for (const mesh of [this.towers, this.poles]) {
      if (!mesh) continue;
      const list = mesh.userData.list as GridTower3D[];
      list.forEach((t, i) => {
        const [x, y] = frame.toLocal(t.position[0], t.position[1]);
        const z = terrain ? (map!.queryTerrainElevation(t.position as [number, number]) ?? 0) : 0;
        q.setFromAxisAngle(zAxis, Math.atan2(t.arm[1], t.arm[0]));
        mesh.setMatrixAt(i, m.compose(pos.set(x, y, z), q, one));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private buildWires(data: GridData3D) {
    const frame = this.frame!;
    const P0: number[] = [];
    const O0: number[] = [];
    const P1: number[] = [];
    const O1: number[] = [];
    const corner: number[] = [];
    const color: number[] = [];
    const width: number[] = [];
    const along: number[] = [];
    const pulse: number[] = [];
    const idx: number[] = [];
    let v = 0;
    for (const sp of data.spans) {
      const pole = sp.a.pole || sp.b.pole;
      const pts = pole ? POLE_PHASES : TOWER_PHASES;
      const la = frame.toLocal(sp.a.position[0], sp.a.position[1]);
      const lb = frame.toLocal(sp.b.position[0], sp.b.position[1]);
      const rgb = WIRE_RGB[sp.style] ?? WIRE_RGB[0];
      const sagBase = Math.min(0.032 * sp.meters, pole ? 4 : 9);
      pts.forEach(([ax, , az]) => {
        const offA: [number, number] = [ax * sp.a.arm[0], ax * sp.a.arm[1]];
        const offB: [number, number] = [ax * sp.b.arm[0], ax * sp.b.arm[1]];
        const col = [...rgb, 0.9];
        const w = 0.9;
        let prev: { p: number[]; o: number[]; d: number } | null = null;
        for (let s = 0; s <= WIRE_STEPS; s++) {
          const u = s / WIRE_STEPS;
          const p = [la[0] + (lb[0] - la[0]) * u, la[1] + (lb[1] - la[1]) * u, 0];
          const sag = sagBase;
          const o = [offA[0] + (offB[0] - offA[0]) * u, offA[1] + (offB[1] - offA[1]) * u, az - sag * catenarySag(u)];
          const d = sp.along + sp.meters * u;
          if (prev) {
            for (const [cx, cy] of [
              [0, -1],
              [0, 1],
              [1, -1],
              [1, 1],
            ]) {
              P0.push(...prev.p);
              O0.push(...prev.o);
              P1.push(...p);
              O1.push(...o);
              corner.push(cx, cy);
              color.push(...col);
              width.push(w);
              along.push(cx ? d : prev.d);
              pulse.push(sp.building ? 1 : 0);
            }
            idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
            v += 4;
          }
          prev = { p, o, d };
        }
      });
    }
    const g = new THREE.BufferGeometry();
    const f = (a: number[], n: number) => new THREE.Float32BufferAttribute(a, n);
    const p0 = f(P0, 3);
    const p1 = f(P1, 3);
    p0.setUsage(THREE.DynamicDrawUsage);
    p1.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aP0", p0);
    g.setAttribute("aO0", f(O0, 3));
    g.setAttribute("aP1", p1);
    g.setAttribute("aO1", f(O1, 3));
    g.setAttribute("aCorner", f(corner, 2));
    g.setAttribute("aColor", f(color, 4));
    g.setAttribute("aWidth", f(width, 1));
    g.setAttribute("aAlong", f(along, 1));
    g.setAttribute("aPulse", f(pulse, 1));
    // three needs a position attribute to size the draw call.
    g.setAttribute("position", f(new Array(corner.length / 2 * 3).fill(0), 3));
    g.setIndex(idx);
    this.wireGeo = g;
    this.wires = new THREE.Mesh(g, this.wireMat!);
    this.wires.frustumCulled = false;
    this.wires.renderOrder = 2;
    this.scene.add(this.wires);
  }

  /** Terrain: lift wire ends to the ground elevation at their towers. */
  private liftWires(map: maplibregl.Map, data: GridData3D) {
    const g = this.wireGeo;
    if (!g) return;
    const terrain = map.getTerrain();
    const p0 = g.getAttribute("aP0") as THREE.BufferAttribute;
    const p1 = g.getAttribute("aP1") as THREE.BufferAttribute;
    const a0 = p0.array as Float32Array;
    const a1 = p1.array as Float32Array;
    let v = 0;
    for (const sp of data.spans) {
      const n = sp.a.pole || sp.b.pole ? POLE_PHASES.length : TOWER_PHASES.length;
      const za = terrain ? (map.queryTerrainElevation(sp.a.position as [number, number]) ?? 0) : 0;
      const zb = terrain ? (map.queryTerrainElevation(sp.b.position as [number, number]) ?? 0) : 0;
      for (let k = 0; k < n; k++) {
        for (let s = 1; s <= WIRE_STEPS; s++) {
          const u0 = (s - 1) / WIRE_STEPS;
          const u1 = s / WIRE_STEPS;
          for (let c = 0; c < 4; c++) {
            a0[(v + c) * 3 + 2] = za + (zb - za) * u0;
            a1[(v + c) * 3 + 2] = za + (zb - za) * u1;
          }
          v += 4;
        }
      }
    }
    p0.needsUpdate = true;
    p1.needsUpdate = true;
  }

  render({ renderer, main, map, width, height }: PassFrame) {
    const data = this.data;
    if (!data || this.view.grow <= 0.001) return;
    if (data !== this.built) this.rebuild(data);
    if (!this.frame || !this.towerMat || !this.wireMat) return;
    const terrain = map.getTerrain();
    const key = terrain ? `t${Math.floor(performance.now() / 1500)}` : "flat";
    if (key !== this.terrainKey) {
      this.terrainKey = key;
      this.placeInstances(map);
      this.liftWires(map, data);
    }
    const { scale, grow, thick, wireWidth, time } = this.view;
    this.towerMat.uniforms.uScale.value = scale;
    this.towerMat.uniforms.uGrow.value = grow;
    this.towerMat.uniforms.uThick.value = thick;
    const wu = this.wireMat.uniforms;
    wu.uScale.value = scale;
    wu.uGrow.value = grow;
    wu.uWidthScale.value = wireWidth;
    (wu.uViewport.value as THREE.Vector2).set(width / 2, height / 2);
    wu.uTime.value = time;
    wu.uOpacity.value = Math.min(1, grow * 1.5);
    this.camera.projectionMatrix.copy(main).multiply(this.frame.matrix);
    if (!terrain) renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clear();
    this.towerGeo?.dispose();
    this.poleGeo?.dispose();
    this.towerMat?.dispose();
    this.wireMat?.dispose();
    this.towerGeo = this.poleGeo = null;
    this.towerMat = this.wireMat = null;
    this.built = null;
  }
}

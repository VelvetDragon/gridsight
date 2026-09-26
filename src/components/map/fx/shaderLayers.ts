/**
 * PathLayer variants with small shader injections, so every animated effect
 * runs on the GPU from uniforms: no per-frame attribute rebuilds.
 *
 * - FlowPathLayer: water with drifting flow streaks, marching dashes, or
 *   comet streaks, driven by a per-vertex distance attribute and a time uniform.
 * - WirePathLayer: conductors lifted to the tower cross-arms in screen space,
 *   with a catenary sag proportional to the span's on-screen length.
 * - DamagePathLayer: failure colouring that follows the storm's passage.
 */
import type { Accessor, DefaultProps } from "@deck.gl/core";
import { PathLayer, type PathLayerProps } from "@deck.gl/layers";

type ShaderModule = {
  name: string;
  vs: string;
  fs: string;
  uniformTypes: Record<string, "f32" | "vec4<f32>">;
};

type Shaders = { modules: unknown[]; inject?: Record<string, string> };

interface ModelLike {
  shaderInputs: { setProps: (props: Record<string, Record<string, unknown>>) => void };
}

const HASH_GLSL = /* glsl */ `
float fx_hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
`;

/* ---------------- Flow ---------------- */

const flowBlock = /* glsl */ `\
layout(std140) uniform flowUniforms {
  float time;
  float mode;
  float speed;
  float spacing;
  float dashLength;
  vec4 accent;
} flow;
`;

const flowModule: ShaderModule = {
  name: "flow",
  vs: flowBlock,
  fs: flowBlock,
  uniformTypes: {
    time: "f32",
    mode: "f32",
    speed: "f32",
    spacing: "f32",
    dashLength: "f32",
    accent: "vec4<f32>",
  },
};

export type FlowMode = "water" | "march" | "comet";
const FLOW_MODE: Record<FlowMode, number> = { water: 0, march: 1, comet: 2 };

export type FlowPathLayerProps<D> = PathLayerProps<D> & {
  /** Per-vertex distance: metres along the path (water, march) or 0..1 (comet). */
  getDistances: Accessor<D, number[]>;
  /** Per-path seed (comet: integer part = speed x100, fraction = phase). */
  getSeed?: Accessor<D, number>;
  time: number;
  flowMode: FlowMode;
  /** Pixels per second (water, march) or cycles per second (comet). */
  flowSpeed: number;
  /** Pixels between repeats (water, march). */
  flowSpacing: number;
  /** Dash or streak length as a fraction of the repeat. */
  flowDashLength: number;
  /** Secondary colour, 0..255 RGBA (water: bank and streak tint). */
  flowAccent: [number, number, number, number];
};

const flowDefaults: DefaultProps<FlowPathLayerProps<unknown>> = {
  getDistances: { type: "accessor", value: [] },
  getSeed: { type: "accessor", value: 0 },
  time: 0,
  flowMode: "water",
  flowSpeed: 20,
  flowSpacing: 60,
  flowDashLength: 0.4,
  flowAccent: [255, 255, 255, 255],
};

export class FlowPathLayer<D = unknown> extends PathLayer<D, FlowPathLayerProps<D>> {
  static layerName = "FlowPathLayer";
  static defaultProps = flowDefaults;

  getShaders() {
    const shaders = super.getShaders() as Shaders;
    shaders.modules = [...shaders.modules, flowModule];
    shaders.inject = {
      "vs:#decl": /* glsl */ `
in float instanceDistances;
in float instanceNextDistances;
in float instanceSeeds;
out float vFlowDist;
out float vFlowSeed;
out float vFlowPxPerMeter;
out float vFlowHalfWidthPx;
`,
      "vs:#main-end": /* glsl */ `
float flowFrac = vPathLength > 0.0 ? vPathPosition.y / vPathLength : 0.0;
vFlowDist = instanceDistances + (instanceNextDistances - instanceDistances) * flowFrac;
vFlowSeed = instanceSeeds;
vFlowPxPerMeter = project_size_to_pixel(1.0);
vFlowHalfWidthPx = width.x * project.scale;
`,
      "fs:#decl": /* glsl */ `
in float vFlowDist;
in float vFlowSeed;
in float vFlowPxPerMeter;
in float vFlowHalfWidthPx;
${HASH_GLSL}
float fx_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fx_hash(i.x + i.y * 57.0);
  float b = fx_hash(i.x + 1.0 + i.y * 57.0);
  float c = fx_hash(i.x + (i.y + 1.0) * 57.0);
  float d = fx_hash(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`,
      "fs:#main-end": /* glsl */ `
if (!bool(picking.isActive)) {
  float ax = abs(vPathPosition.x);
  if (flow.mode < 0.5) {
    // Water: deeper channel, lighter banks, drifting streaks and a faint shimmer.
    vec3 deep = vColor.rgb;
    vec3 light = flow.accent.rgb;
    vec3 col = mix(deep, light, smoothstep(0.15, 1.0, ax));
    float bank = smoothstep(0.55, 0.8, ax) * (1.0 - smoothstep(0.84, 1.0, ax));
    col = mix(col, vec3(0.9, 0.95, 0.99), bank * 0.5);
    float px = vFlowDist * vFlowPxPerMeter;
    float wide = smoothstep(2.5, 7.0, vFlowHalfWidthPx);
    float streak = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float laneX = (fi - 1.0) * 0.45;
      float spd = flow.speed * (1.0 + 0.23 * fi - 0.12 * fi * fi);
      float sp = flow.spacing * (1.0 + 0.41 * fi);
      float u = (px - flow.time * spd) / sp + fi * 0.37;
      float cell = floor(u);
      float f = fract(u);
      float rnd = fx_hash(cell * 1.7 + fi * 31.0);
      float len = flow.dashLength * (0.5 + 0.7 * rnd);
      float t = f / len;
      float s = t < 1.0 ? t * t * (1.0 - smoothstep(0.82, 1.0, t)) : 0.0;
      s *= step(0.25, rnd);
      float lane = exp(-pow((vPathPosition.x - laneX - (rnd - 0.5) * 0.25) / 0.2, 2.0));
      streak = max(streak, s * mix(0.8, lane, wide));
    }
    float shimmer = fx_noise(vec2(px * 0.07 - flow.time * flow.speed * 0.05, vPathPosition.x * 2.5 + flow.time * 0.35));
    col += vec3(0.06) * smoothstep(0.62, 0.95, shimmer) * (1.0 - ax);
    col = mix(col, vec3(0.96, 0.985, 1.0), streak * 0.8);
    fragColor.rgb = col;
  } else if (flow.mode < 1.5) {
    // Marching dashes along the path.
    float px = vFlowDist * vFlowPxPerMeter;
    float u = (px - flow.time * flow.speed) / flow.spacing;
    float f = fract(u);
    float aa = max(fwidth(u), 1e-4);
    float on = smoothstep(0.0, aa, f) * (1.0 - smoothstep(flow.dashLength - aa, flow.dashLength, f));
    fragColor.a *= on;
  } else {
    // Comet streaks: a bright head travelling along the arc with a fading tail.
    float spd = floor(vFlowSeed) / 100.0;
    float phase = fract(vFlowSeed);
    float len = flow.dashLength;
    float head = fract(flow.time * flow.speed * spd + phase) * (1.0 + 2.0 * len) - len;
    float t = (vFlowDist - (head - len)) / len;
    float s = (t > 0.0 && t < 1.0) ? pow(t, 1.6) * (1.0 - smoothstep(0.9, 1.0, t)) : 0.0;
    s *= smoothstep(0.0, 0.12, vFlowDist) * (1.0 - smoothstep(0.88, 1.0, vFlowDist));
    fragColor.a *= s;
  }
  if (fragColor.a < 0.004) discard;
}
`,
    };
    return shaders;
  }

  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceDistancesPair: {
        size: 1,
        accessor: "getDistances",
        shaderAttributes: {
          instanceDistances: { vertexOffset: 0 },
          instanceNextDistances: { vertexOffset: 1 },
        },
      },
      instanceSeeds: { size: 1, accessor: "getSeed", defaultValue: 0 },
    });
  }

  draw(params: Parameters<PathLayer<D, FlowPathLayerProps<D>>["draw"]>[0]) {
    const { time, flowMode, flowSpeed, flowSpacing, flowDashLength, flowAccent } = this.props;
    const model = this.state.model as ModelLike | undefined;
    model?.shaderInputs.setProps({
      flow: {
        time,
        mode: FLOW_MODE[flowMode],
        speed: flowSpeed,
        spacing: flowSpacing,
        dashLength: flowDashLength,
        accent: flowAccent.map((c) => c / 255),
      },
    });
    super.draw(params);
  }
}

/* ---------------- Wires ---------------- */

const wireBlock = /* glsl */ `\
layout(std140) uniform wireUniforms {
  float towerPx;
  float sagRatio;
  float maxSag;
} wire;
`;

const wireModule: ShaderModule = {
  name: "wire",
  vs: wireBlock,
  fs: wireBlock,
  uniformTypes: { towerPx: "f32", sagRatio: "f32", maxSag: "f32" },
};

export type WirePathLayerProps<D> = PathLayerProps<D> & {
  /** Per vertex [x, y, sag]: cross-arm offset in tower heights and the 0..1 sag shape. */
  getAttach: Accessor<D, number[]>;
  /** Span length in metres. */
  getSpan: Accessor<D, number>;
  /** On-screen tower height, px. */
  towerPx: number;
  /** Sag as a fraction of the on-screen span. */
  sagRatio: number;
  /** Largest sag, in tower heights. */
  maxSag: number;
};

const wireDefaults: DefaultProps<WirePathLayerProps<unknown>> = {
  getAttach: { type: "accessor", value: [] },
  getSpan: { type: "accessor", value: 300 },
  towerPx: 24,
  sagRatio: 0.06,
  maxSag: 0.3,
};

export class WirePathLayer<D = unknown> extends PathLayer<D, WirePathLayerProps<D>> {
  static layerName = "WirePathLayer";
  static defaultProps = wireDefaults;

  getShaders() {
    const shaders = super.getShaders() as Shaders;
    shaders.modules = [...shaders.modules, wireModule];
    shaders.inject = {
      "vs:#decl": /* glsl */ `
in vec3 instanceAttach;
in vec3 instanceNextAttach;
in float instanceSpans;
`,
      "vs:#main-end": /* glsl */ `
float wireFrac = vPathLength > 0.0 ? clamp(vPathPosition.y / vPathLength, 0.0, 1.0) : 0.0;
vec3 att = mix(instanceAttach, instanceNextAttach, wireFrac);
float spanPx = project_size_to_pixel(instanceSpans);
float sagPx = min(wire.sagRatio * spanPx, wire.maxSag * wire.towerPx) * att.z;
vec2 lift = vec2(att.x * wire.towerPx, att.y * wire.towerPx - sagPx);
gl_Position.xy += project_pixel_size_to_clipspace(lift);
`,
    };
    return shaders;
  }

  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceAttachPair: {
        size: 3,
        accessor: "getAttach",
        shaderAttributes: {
          instanceAttach: { vertexOffset: 0 },
          instanceNextAttach: { vertexOffset: 1 },
        },
      },
      instanceSpans: { size: 1, accessor: "getSpan", defaultValue: 300 },
    });
  }

  draw(params: Parameters<PathLayer<D, WirePathLayerProps<D>>["draw"]>[0]) {
    const { towerPx, sagRatio, maxSag } = this.props;
    (this.state.model as ModelLike | undefined)?.shaderInputs.setProps({ wire: { towerPx, sagRatio, maxSag } });
    super.draw(params);
  }
}

/* ---------------- Damage ---------------- */

const damageBlock = /* glsl */ `\
layout(std140) uniform damageUniforms {
  float nowHours;
  float wallTime;
  float leadHours;
  float flickerHours;
} damage;
`;

const damageModule: ShaderModule = {
  name: "damage",
  vs: damageBlock,
  fs: damageBlock,
  uniformTypes: { nowHours: "f32", wallTime: "f32", leadHours: "f32", flickerHours: "f32" },
};

export type DamagePathLayerProps<D> = PathLayerProps<D> & {
  /** Hours (relative to the replay start) when the storm passed closest. */
  getRevealHours: Accessor<D, number>;
  getProbability: Accessor<D, number>;
  nowHours: number;
  wallTime: number;
  /** Hours before closest approach when colour starts to build. */
  leadHours: number;
  /** Hours of flicker for likely failures, after closest approach. */
  flickerHours: number;
};

const damageDefaults: DefaultProps<DamagePathLayerProps<unknown>> = {
  getRevealHours: { type: "accessor", value: 0 },
  getProbability: { type: "accessor", value: 0 },
  nowHours: 0,
  wallTime: 0,
  leadHours: 3,
  flickerHours: 1.5,
};

/**
 * Mirrors FAILURE_STOPS in lib/theme.ts: sand, ochre, brick, oxblood.
 * Kept in GLSL so colour can follow the storm without attribute updates.
 */
const FAILURE_RAMP_GLSL = /* glsl */ `
vec3 fx_failure(float p) {
  vec3 c0 = vec3(226.0, 220.0, 204.0) / 255.0;
  vec3 c1 = vec3(232.0, 196.0, 120.0) / 255.0;
  vec3 c2 = vec3(214.0, 140.0, 52.0) / 255.0;
  vec3 c3 = vec3(178.0, 64.0, 30.0) / 255.0;
  vec3 c4 = vec3(96.0, 18.0, 18.0) / 255.0;
  float x = clamp(p, 0.0, 1.0);
  if (x <= 0.1) return mix(c0, c1, x / 0.1);
  if (x <= 0.25) return mix(c1, c2, (x - 0.1) / 0.15);
  if (x <= 0.5) return mix(c2, c3, (x - 0.25) / 0.25);
  return mix(c3, c4, (x - 0.5) / 0.5);
}
`;

export class DamagePathLayer<D = unknown> extends PathLayer<D, DamagePathLayerProps<D>> {
  static layerName = "DamagePathLayer";
  static defaultProps = damageDefaults;

  getShaders() {
    const shaders = super.getShaders() as Shaders;
    shaders.modules = [...shaders.modules, damageModule];
    shaders.inject = {
      "vs:#decl": /* glsl */ `
in float instanceReveal;
in float instanceProb;
${HASH_GLSL}
${FAILURE_RAMP_GLSL}
float fx_damageK() {
  return smoothstep(-damage.leadHours, 0.0, damage.nowHours - instanceReveal);
}
`,
      "vs:DECKGL_FILTER_SIZE": /* glsl */ `
float dk = fx_damageK();
float full = 1.6 + 4.0 * min(1.0, instanceProb * 2.0);
float now = mix(1.2, 1.6 + 4.0 * min(1.0, instanceProb * 2.0 * dk), smoothstep(0.0, 0.35, dk));
size *= now / full;
`,
      "vs:#main-end": /* glsl */ `
{
  float rel = damage.nowHours - instanceReveal;
  float k = fx_damageK();
  float p = instanceProb;
  float shown = smoothstep(0.0, 0.35, k);
  vec3 c = mix(vec3(120.0, 126.0, 138.0) / 255.0, fx_failure(p * k), shown);
  float a = mix(70.0 / 255.0, 1.0, shown);
  float likely = step(0.5, p);
  float flickering = likely * step(0.0, rel) * (1.0 - step(damage.flickerHours, rel));
  if (flickering > 0.5) {
    float n = fx_hash(floor(damage.wallTime * 12.0) + rowIndexes * 7.31);
    float lit = step(0.42, n);
    c = mix(vec3(0.16, 0.12, 0.12), mix(c, vec3(1.0, 0.84, 0.42), 0.6), lit);
  }
  // Lights out: failed lines settle dark.
  float out_ = likely * step(damage.flickerHours, rel);
  c = mix(c, c * 0.62, out_);
  vColor = vec4(c, a * layer.opacity);
}
`,
    };
    return shaders;
  }

  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceReveal: { size: 1, accessor: "getRevealHours", defaultValue: 0 },
      instanceProb: { size: 1, accessor: "getProbability", defaultValue: 0 },
    });
  }

  draw(params: Parameters<PathLayer<D, DamagePathLayerProps<D>>["draw"]>[0]) {
    const { nowHours, wallTime, leadHours, flickerHours } = this.props;
    (this.state.model as ModelLike | undefined)?.shaderInputs.setProps({
      damage: { nowHours, wallTime, leadHours, flickerHours },
    });
    super.draw(params);
  }
}

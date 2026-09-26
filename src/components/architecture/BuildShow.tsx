"use client";

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  CHAPTERS,
  EDGES,
  FLOWS,
  H,
  PART,
  PARTS,
  REGIONS,
  TONE,
  W,
  type Part,
  type Region,
} from "./content";

/* ---------------------------------------------------------------- maths */

type P = { x: number; y: number };

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeBack = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

function hash(i: number, s = 0) {
  const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** Lines sag gently between stations, like wires between towers. */
function wire(a: P, b: P) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (Math.abs(ny) < 0.25) {
    if (nx < 0) [nx, ny] = [-nx, -ny];
  } else if (ny < 0) [nx, ny] = [-nx, -ny];
  const sag = Math.min(len * 0.08, 44);
  const c = { x: (a.x + b.x) / 2 + nx * sag, y: (a.y + b.y) / 2 + ny * sag };
  let l = 0;
  let prev = a;
  for (let i = 1; i <= 20; i++) {
    const q = bez(a, c, b, i / 20);
    l += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  return { a, b, c, len: l, d: `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}` };
}

function bez(a: P, c: P, b: P, t: number): P {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/* ---------------------------------------------------------------- timeline */

const CH = 8.6; // one chapter
const T_ENTER = 1.1; // card slides in
const T_MERGE = 6.3; // card flies into its station
const T_FILL = 7.3; // station lights up

const FIN_INTRO = 3.6;
const STEP = 1.15;
const FLOW_LEAD = 0.8;
const FLOW_HOLD = 2.2;
const FIN_OUT = 2.4;

const BUILD = CHAPTERS.length * CH;
const FLOW_LEN = FLOWS.map((f) => FLOW_LEAD + f.steps.length * STEP + FLOW_HOLD);
const FLOW_START = FLOW_LEN.map((_, i) => BUILD + FIN_INTRO + FLOW_LEN.slice(0, i).reduce((a, b) => a + b, 0));
const OUT_START = BUILD + FIN_INTRO + FLOW_LEN.reduce((a, b) => a + b, 0);
const LOOP = OUT_START + FIN_OUT;

const SPAWN_CH: Record<string, number> = {};
const SPAWN_IX: Record<string, number> = {};
const FILL_CH: Record<string, number> = {};
CHAPTERS.forEach((c, i) => {
  FILL_CH[c.fill] = i;
  c.spawn.forEach((id, k) => {
    SPAWN_CH[id] = i;
    SPAWN_IX[id] = k;
  });
});

type Frame =
  | { mode: "build"; ch: number; lt: number }
  | { mode: "intro"; lt: number }
  | { mode: "flow"; fi: number; lt: number; step: number; p: number }
  | { mode: "out"; lt: number };

function frameAt(t: number): Frame {
  const x = ((t % LOOP) + LOOP) % LOOP;
  if (x < BUILD) {
    const ch = Math.floor(x / CH);
    return { mode: "build", ch, lt: x - ch * CH };
  }
  if (x < BUILD + FIN_INTRO) return { mode: "intro", lt: x - BUILD };
  if (x >= OUT_START) return { mode: "out", lt: x - OUT_START };
  let fi = FLOWS.length - 1;
  for (let i = 0; i < FLOWS.length; i++) {
    if (x < FLOW_START[i] + FLOW_LEN[i]) {
      fi = i;
      break;
    }
  }
  const lt = x - FLOW_START[fi];
  const s = (lt - FLOW_LEAD) / STEP;
  const step = s < 0 ? -1 : Math.min(Math.floor(s), FLOWS[fi].steps.length);
  return { mode: "flow", fi, lt, step, p: s < 0 ? 0 : step >= FLOWS[fi].steps.length ? 1 : s - step };
}

/** How far each station has appeared (0..1) and filled in (0..1), and how long ago it filled. */
function status(id: string, f: Frame) {
  if (f.mode !== "build") return { shown: 1, filled: 1, age: 99 };
  const sc = SPAWN_CH[id];
  const fc = FILL_CH[id];
  const shown = sc < f.ch ? 1 : sc === f.ch ? clamp((f.lt - 0.55 - SPAWN_IX[id] * 0.16) / 0.5) : 0;
  const filled = fc < f.ch ? 1 : fc === f.ch ? clamp((f.lt - T_FILL) / 0.5) : 0;
  const age = fc < f.ch ? 99 : fc === f.ch ? f.lt - T_FILL : -1;
  return { shown, filled, age };
}

/* ---------------------------------------------------------------- camera */

type Cam = { cx: number; cy: number; s: number; vx: number; vy: number; vw: number; vh: number };

function camTarget(f: Frame): Cam {
  // While building, follow the new part, its neighbours and the blanks it spawns; the finale shows everything.
  let ids: string[];
  if (f.mode === "build") {
    const cur = CHAPTERS[f.ch];
    const near = EDGES.flatMap((e) => (e.a === cur.fill ? [e.b] : e.b === cur.fill ? [e.a] : []));
    ids = [cur.fill, ...cur.spawn, ...near].filter((id) => SPAWN_CH[id] <= f.ch);
  } else ids = PARTS.map((p) => p.id);
  const pts = ids.map((id) => PART[id]);
  let x0 = Math.min(...pts.map((p) => p.x)) - 150;
  let x1 = Math.max(...pts.map((p) => p.x)) + 150;
  let y0 = Math.min(...pts.map((p) => p.y)) - 120;
  let y1 = Math.max(...pts.map((p) => p.y)) + 130;
  const minW = f.mode === "build" ? 1000 : 840;
  const minH = f.mode === "build" ? 700 : 600;
  if (x1 - x0 < minW) {
    const m = (x0 + x1) / 2;
    x0 = m - minW / 2;
    x1 = m + minW / 2;
  }
  if (y1 - y0 < minH) {
    const m = (y0 + y1) / 2;
    y0 = m - minH / 2;
    y1 = m + minH / 2;
  }
  const vp = f.mode === "build" ? { vx: 20, vy: 118, vw: 1040, vh: 730 } : { vx: 30, vy: 112, vw: 1540, vh: 668 };
  const s = Math.min(vp.vw / (x1 - x0), vp.vh / (y1 - y0));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s, ...vp };
}

function toScreen(c: Cam, p: P): P {
  return { x: c.vx + c.vw / 2 + (p.x - c.cx) * c.s, y: c.vy + c.vh / 2 + (p.y - c.cy) * c.s };
}

/* ---------------------------------------------------------------- live storms */

interface LiveStorm {
  name: string;
  kind: string;
  distanceKm: number;
}

function useLiveStorms() {
  const [line, setLine] = useState("checking the feed…");
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/storms/live")
        .then((r) => r.json())
        .then((b: { storms: LiveStorm[] | null }) => {
          if (!alive) return;
          if (!b.storms) setLine("feed unavailable right now");
          else if (!b.storms.length) setLine("no Atlantic storms right now");
          else {
            const s = b.storms[0];
            setLine(`${s.kind} ${s.name}, ${s.distanceKm.toLocaleString()} km from the border`);
          }
        })
        .catch(() => alive && setLine("feed unavailable right now"));
    load();
    const id = window.setInterval(load, 10 * 60 * 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);
  return line;
}

/* ---------------------------------------------------------------- page */

const START_CAM = camTarget(frameAt(0));

const noop = () => () => {};

/** Pure client-side animation: render nothing on the server so the first frame never mismatches. */
export function BuildShow() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return mounted ? <Show /> : <div className="fixed inset-0 bg-[#060910]" />;
}

function Show() {
  const clock = useRef(0);
  const paused = useRef(false);
  const cam = useRef<Cam>(START_CAM);
  const [view, setView] = useState({ t: 0, cam: START_CAM });
  const [isPaused, setIsPaused] = useState(false);
  const live = useLiveStorms();

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!paused.current) clock.current += dt;
      const target = camTarget(frameAt(clock.current));
      const k = 1 - Math.exp(-dt * 2.4);
      const c = cam.current;
      const next: Cam = {
        cx: lerp(c.cx, target.cx, k),
        cy: lerp(c.cy, target.cy, k),
        s: lerp(c.s, target.s, k),
        vx: lerp(c.vx, target.vx, k),
        vy: lerp(c.vy, target.vy, k),
        vw: lerp(c.vw, target.vw, k),
        vh: lerp(c.vh, target.vh, k),
      };
      cam.current = next;
      setView({ t: clock.current, cam: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const goTo = useCallback((x: number) => {
    const cycle = Math.floor(clock.current / LOOP);
    clock.current = cycle * LOOP + x + 0.001;
  }, []);

  useEffect(() => {
    const marks = [...CHAPTERS.map((_, i) => i * CH), BUILD, ...FLOW_START];
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const x = ((clock.current % LOOP) + LOOP) % LOOP;
      if (e.key === " ") {
        e.preventDefault();
        paused.current = !paused.current;
        setIsPaused(paused.current);
      } else if (e.key === "ArrowRight") {
        const next = marks.find((m) => m > x + 0.05);
        goTo(next ?? LOOP);
      } else if (e.key === "ArrowLeft") {
        const prev = [...marks].reverse().find((m) => m < x - 1.2);
        goTo(prev ?? 0);
      } else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo]);

  const f = frameAt(view.t);
  const c = view.cam;
  const current = f.mode === "build" ? PART[CHAPTERS[f.ch].fill] : null;
  const flow = f.mode === "flow" ? FLOWS[f.fi] : null;
  const stormy = flow?.storm ? clamp(f.mode === "flow" ? f.lt / 1.5 : 0) * clamp((FLOW_LEN[FLOWS.length - 1] - (f.mode === "flow" ? f.lt : 0)) / 1.2) : 0;
  const out = f.mode === "out" ? easeInOut(clamp(f.lt / (FIN_OUT - 0.4))) : 0;

  return (
    <div className={`fixed inset-0 overflow-hidden bg-[#060910] select-none ${isPaused ? "ab-paused" : ""}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label="MrGridy's architecture, built one part at a time"
      >
        <Defs />
        <Backdrop />
        <Weather t={view.t} storm={stormy} />

        {/* The world, framed by the camera */}
        <g
          transform={`translate(${c.vx + c.vw / 2},${c.vy + c.vh / 2}) scale(${c.s}) translate(${-c.cx},${-c.cy})`}
          opacity={1 - out}
        >
          <River f={f} />
          {REGIONS.map((r) => (
            <RegionBox key={r.id} r={r} f={f} />
          ))}
          <Edges f={f} />
          {flow && f.mode === "flow" ? <FlowPulses f={f} /> : null}
          {PARTS.map((p) => (
            <Station
              key={p.id}
              part={p}
              f={f}
              t={view.t}
              current={current?.id === p.id}
              onPick={() => goTo(FILL_CH[p.id] * CH)}
            />
          ))}
        </g>

        {current && f.mode === "build" ? <CardLayer part={current} ch={f.ch} lt={f.lt} cam={c} live={live} /> : null}

        <Chrome f={f} paused={isPaused} out={out} />
      </svg>

      <div className="ab-hint pointer-events-none absolute bottom-3 left-5 font-mono text-[11px] text-slate-500">
        → next · ← back · space pause · F full screen · click a station to replay it
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- backdrop */

function Defs() {
  return (
    <defs>
      <radialGradient id="ab-sky" cx="45%" cy="40%" r="80%">
        <stop offset="0%" stopColor="#0e1526" />
        <stop offset="55%" stopColor="#080c17" />
        <stop offset="100%" stopColor="#04060b" />
      </radialGradient>
      <radialGradient id="ab-aura" cx="30%" cy="55%" r="45%">
        <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.07" />
        <stop offset="100%" stopColor="#22D3EE" stopOpacity="0" />
      </radialGradient>
      <filter id="ab-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="ab-bloom" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="10" />
      </filter>
      <filter id="ab-soft" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="7" />
      </filter>
    </defs>
  );
}

const CONTOURS: string[] = (() => {
  const out: string[] = [];
  const centres: [number, number, number][] = [
    [260, 520, 1],
    [1180, 380, 2],
    [760, 980, 3],
  ];
  for (const [cx, cy, seed] of centres) {
    for (let k = 0; k < 10; k++) {
      const r = 60 + k * 46;
      let d = "";
      for (let s = 0; s <= 90; s++) {
        const th = (s / 90) * Math.PI * 2;
        const rr = r * (1 + 0.08 * Math.sin(3 * th + seed + k * 0.35) + 0.05 * Math.sin(5 * th + seed * 2));
        d += `${s ? "L" : "M"}${(cx + rr * Math.cos(th)).toFixed(1)},${(cy + rr * 0.7 * Math.sin(th)).toFixed(1)}`;
      }
      out.push(d + "Z");
    }
  }
  return out;
})();

const Backdrop = memo(function Backdrop() {
  return (
    <g>
      <rect width={W} height={H} fill="url(#ab-sky)" />
      <rect width={W} height={H} fill="url(#ab-aura)" />
      <g fill="none" stroke="#94a3b8" strokeOpacity="0.045">
        {CONTOURS.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g fill="#94a3b8" fillOpacity="0.09">
        {Array.from({ length: 33 * 19 }, (_, i) => (
          <circle key={i} cx={(i % 33) * 50} cy={Math.floor(i / 33) * 50} r="0.8" />
        ))}
      </g>
    </g>
  );
});

const ARMS: string[] = Array.from({ length: 4 }, (_, k) => {
  let d = "";
  for (let s = 0; s <= 46; s++) {
    const th = -s * 0.15 + (k * Math.PI) / 2;
    const r = 16 + s * 4.4;
    d += `${s ? "L" : "M"}${(r * Math.cos(th)).toFixed(1)},${(r * Math.sin(th)).toFixed(1)}`;
  }
  return d;
});

/** Faint weather in the background; a little stronger during the storm flow. */
function Weather({ t, storm }: { t: number; storm: number }) {
  const x = 1340 + Math.sin(t * 0.05) * 60;
  const y = 200 + Math.cos(t * 0.04) * 30;
  const rain = 0.05 + storm * 0.12;
  return (
    <g pointerEvents="none">
      <g transform={`translate(${x},${y}) rotate(${-t * 12})`} opacity={0.03 + storm * 0.08}>
        {ARMS.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#cbd5e1" strokeWidth={22} strokeLinecap="round" filter="url(#ab-soft)" />
        ))}
      </g>
      <g stroke="#93c5fd" strokeWidth={1}>
        {Array.from({ length: 44 }, (_, i) => {
          const rx = hash(i, 7) * W;
          const ry = ((hash(i, 8) * H + t * (360 + hash(i, 9) * 160)) % (H + 60)) - 30;
          return <line key={i} x1={rx} y1={ry} x2={rx - 6} y2={ry + 18} strokeOpacity={rain * (0.5 + hash(i, 10))} />;
        })}
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------- world */

const RIVER = "M385,-260 C430,-80 340,60 388,220 S450,440 392,600 S362,820 402,1020";

function River({ f }: { f: Frame }) {
  const o = status("static", f).filled;
  if (o <= 0) return null;
  return (
    <g opacity={o}>
      <path d={RIVER} fill="none" stroke="#22D3EE" strokeOpacity="0.06" strokeWidth={30} filter="url(#ab-soft)" />
      <path d={RIVER} fill="none" stroke="#22D3EE" strokeOpacity="0.28" strokeWidth={1.2} />
      <path d={RIVER} fill="none" stroke="#a5f3fc" strokeOpacity="0.35" strokeWidth={1} className="ab-river" />
      <path id="ab-river-text" d={RIVER} fill="none" stroke="none" />
      <text fontSize="11" letterSpacing="2.4" fill="#67e8f9" fillOpacity="0.5" fontFamily="var(--font-numbers)">
        <textPath href="#ab-river-text" startOffset="30%">
          DEPLOYED WITH THE SITE · EVERY PUSH TO MAIN
        </textPath>
      </text>
    </g>
  );
}

function RegionBox({ r, f }: { r: Region; f: Frame }) {
  const o = Math.max(...PARTS.filter((p) => p.region === r.id).map((p) => status(p.id, f).filled));
  if (o <= 0) return null;
  const hex = TONE[r.tone];
  return (
    <g opacity={easeOut(o)}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={26} fill={hex} fillOpacity={0.028} stroke={hex} strokeOpacity={0.16} strokeDasharray="2 6" />
      <text x={r.x + 20} y={r.y + 28} fontSize="12" letterSpacing="2.6" fill={hex} fillOpacity={0.75} fontFamily="var(--font-numbers)">
        {r.name.toUpperCase()}
      </text>
    </g>
  );
}

const WIRES = EDGES.map((e) => ({ ...e, w: wire(PART[e.a], PART[e.b]) }));

function Edges({ f }: { f: Frame }) {
  return (
    <g>
      {WIRES.map((e) => {
        const later = SPAWN_CH[e.a] >= SPAWN_CH[e.b] ? e.a : e.b;
        const earlier = later === e.a ? e.b : e.a;
        let draw = 1;
        if (f.mode === "build") {
          const sc = SPAWN_CH[later];
          draw = sc < f.ch ? 1 : sc === f.ch ? clamp((f.lt - 0.1 - SPAWN_IX[later] * 0.16) / 0.65) : 0;
        }
        if (draw <= 0) return null;
        const solid = Math.min(status(e.a, f).filled, status(e.b, f).filled);
        // Always draw from the part that already exists towards the new one.
        const w = earlier === e.a ? e.w : wire(PART[e.b], PART[e.a]);
        const tone = e.backup ? "#FBBF24" : "#7dd3fc";
        const tip = bez(w.a, w.c, w.b, easeOut(draw));
        return (
          <g key={`${e.a}|${e.b}`}>
            <path
              d={w.d}
              fill="none"
              stroke="#334155"
              strokeWidth={1.4}
              strokeDasharray={`${w.len} ${w.len}`}
              strokeDashoffset={w.len * (1 - easeOut(draw))}
              opacity={1 - solid}
            />
            <path
              d={w.d}
              fill="none"
              stroke={tone}
              strokeOpacity={e.backup ? 0.55 : 0.32}
              strokeWidth={1.6}
              strokeDasharray={e.backup ? "5 7" : undefined}
              opacity={solid}
            />
            {draw < 1 ? <circle cx={tip.x} cy={tip.y} r={5} fill="#e0f2fe" filter="url(#ab-glow)" /> : null}
            {e.backup && solid > 0 ? (
              <text
                x={bez(w.a, w.c, w.b, 0.5).x}
                y={bez(w.a, w.c, w.b, 0.5).y - 8}
                textAnchor="middle"
                fontSize="11"
                fill="#FBBF24"
                fillOpacity={0.7 * solid}
                fontFamily="var(--font-numbers)"
              >
                backup route
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

function Station({
  part,
  f,
  t,
  current,
  onPick,
}: {
  part: Part;
  f: Frame;
  t: number;
  current: boolean;
  onPick: () => void;
}) {
  const { shown, filled, age } = status(part.id, f);
  if (shown <= 0) return null;
  const hex = TONE[part.tone];
  const Icon = part.icon;
  const pop = easeBack(shown);
  const r = 36;
  const waiting = current && f.mode === "build" && f.lt > T_ENTER - 0.3 && filled === 0;
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.4 + part.x * 0.01);
  return (
    <g
      transform={`translate(${part.x},${part.y}) scale(${pop})`}
      className={filled >= 1 ? "cursor-pointer" : undefined}
      onClick={filled >= 1 ? onPick : undefined}
    >
      {/* Blank */}
      <g opacity={1 - filled}>
        <circle r={r} fill="#0a0f1c" stroke="#475569" strokeWidth={1.4} strokeDasharray="4 5" />
        <rect x={-46} y={r + 16} width={92} height={9} rx={4.5} fill="#1e293b" />
        <rect x={-30} y={r + 32} width={60} height={7} rx={3.5} fill="#172033" />
        {waiting ? (
          <g transform={`rotate(${t * 40})`}>
            <circle r={r + 12} fill="none" stroke={hex} strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="10 8" />
          </g>
        ) : null}
        {waiting ? <circle r={r + 20 + breathe * 6} fill="none" stroke={hex} strokeOpacity={0.14} /> : null}
      </g>

      {/* Filled */}
      {filled > 0 ? (
        <g opacity={filled}>
          <circle r={r + 20} fill={hex} opacity={0.07 + breathe * 0.04} filter="url(#ab-bloom)" />
          <circle r={r} fill="#0b1222" stroke={hex} strokeWidth={1.8} />
          <circle r={r - 6} fill={hex} fillOpacity={0.09} />
          <Icon x={-14} y={-14} width={28} height={28} color={hex} strokeWidth={1.7} />
          <g transform={`translate(0,${(1 - filled) * 8})`}>
            <text
              y={r + 26}
              textAnchor="middle"
              fontSize="17"
              fontWeight="600"
              fill="#f1f5f9"
              fontFamily="var(--font-sans-ui)"
              stroke="#060910"
              strokeWidth={5}
              strokeOpacity={0.85}
              paintOrder="stroke"
            >
              {part.name}
            </text>
            <text
              y={r + 45}
              textAnchor="middle"
              fontSize="12"
              fill="#8391a7"
              fontFamily="var(--font-numbers)"
              stroke="#060910"
              strokeWidth={4}
              strokeOpacity={0.85}
              paintOrder="stroke"
            >
              {part.tech.slice(0, 2).join(" · ")}
            </text>
          </g>
        </g>
      ) : null}

      {/* The moment it lights up */}
      {age >= 0 && age < 1.5 ? (
        <g>
          <circle r={r + age * 110} fill="none" stroke={hex} strokeWidth={2.5} opacity={1 - age / 1.5} />
          <circle r={r + age * 60} fill="none" stroke={hex} strokeWidth={1} opacity={(1 - age / 1.5) * 0.6} />
          <circle r={r} fill={hex} opacity={Math.max(0, 0.5 - age)} filter="url(#ab-bloom)" />
        </g>
      ) : null}
    </g>
  );
}

function FlowPulses({ f }: { f: Extract<Frame, { mode: "flow" }> }) {
  const flow = FLOWS[f.fi];
  const walked = flow.steps.slice(0, Math.max(0, f.step));
  const now = f.step >= 0 && f.step < flow.steps.length ? flow.steps[f.step] : [];
  return (
    <g>
      {walked.flat().map((s, i) => {
        const w = wire(PART[s.a], PART[s.b]);
        return (
          <path
            key={`w${i}`}
            d={w.d}
            fill="none"
            stroke={s.fail ? "#F87171" : "#34D399"}
            strokeOpacity={s.fail ? 0.7 : 0.55}
            strokeWidth={2}
            strokeDasharray={s.fail ? "3 7" : undefined}
          />
        );
      })}
      {now.map((s, i) => (
        <Pulse key={`${f.step}-${i}`} a={PART[s.a]} b={PART[s.b]} p={f.p} fail={!!s.fail} />
      ))}
    </g>
  );
}

function Pulse({ a, b, p, fail }: { a: P; b: P; p: number; fail: boolean }) {
  const w = wire(a, b);
  const e = Math.min(easeInOut(clamp(p / 0.8)), fail ? 0.55 : 1);
  const head = bez(w.a, w.c, w.b, e);
  return (
    <g>
      <path
        d={w.d}
        fill="none"
        stroke="#34D399"
        strokeWidth={2.6}
        strokeDasharray={`${w.len} ${w.len}`}
        strokeDashoffset={w.len * (1 - e)}
        filter="url(#ab-glow)"
      />
      {Array.from({ length: 8 }, (_, k) => {
        const tt = e - k * 0.02;
        if (tt < 0) return null;
        const q = bez(w.a, w.c, w.b, tt);
        return <circle key={k} cx={q.x} cy={q.y} r={k === 0 ? 5.5 : 4.4 - k * 0.45} fill={k === 0 ? "#ecfdf5" : "#34D399"} opacity={k === 0 ? 1 : 0.6 - k * 0.07} />;
      })}
      <circle cx={head.x} cy={head.y} r={16} fill="#34D399" opacity={0.5} filter="url(#ab-bloom)" />
      {fail && p > 0.45 ? <Spark at={bez(w.a, w.c, w.b, 0.55)} p={clamp((p - 0.45) / 0.55)} /> : null}
    </g>
  );
}

function Spark({ at: c, p }: { at: P; p: number }) {
  return (
    <g>
      {Array.from({ length: 12 }, (_, i) => {
        const ang = hash(i, 3) * Math.PI * 2;
        const r = 8 + p * (26 + hash(i, 4) * 34);
        return (
          <line
            key={i}
            x1={c.x + Math.cos(ang) * r * 0.6}
            y1={c.y + Math.sin(ang) * r * 0.6}
            x2={c.x + Math.cos(ang) * r}
            y2={c.y + Math.sin(ang) * r}
            stroke={i % 3 ? "#FCA5A5" : "#FDE68A"}
            strokeWidth={1.6}
            opacity={1 - p}
          />
        );
      })}
      <g transform={`translate(${c.x},${c.y})`} stroke="#F87171" strokeWidth={2.6} strokeLinecap="round">
        <line x1={-7} y1={-7} x2={7} y2={7} />
        <line x1={7} y1={-7} x2={-7} y2={7} />
      </g>
    </g>
  );
}

/* ---------------------------------------------------------------- the card */

const CARD = { x: 1090, y: 150, w: 470, h: 640 };

function CardLayer({ part, ch, lt, cam, live }: { part: Part; ch: number; lt: number; cam: Cam; live: string }) {
  if (lt < T_ENTER || lt >= T_FILL) return null;
  const hex = TONE[part.tone];
  const enter = easeOut(clamp((lt - T_ENTER) / 0.6));
  const m = clamp((lt - T_MERGE) / (T_FILL - T_MERGE));
  const home = { x: CARD.x + CARD.w / 2, y: CARD.y + CARD.h / 2 };
  const node = toScreen(cam, part);
  const em = easeInOut(m);
  const pos = {
    x: lerp(home.x + (1 - enter) * 70, node.x, em),
    y: lerp(home.y, node.y, em) - Math.sin(m * Math.PI) * 90,
  };
  const scale = lerp(1, 0.06, easeInOut(clamp(m * 1.1)));
  const opacity = enter * (m < 0.7 ? 1 : 1 - (m - 0.7) / 0.3);
  const tether = m === 0 ? clamp((lt - T_ENTER - 0.5) / 0.6) : 0;

  return (
    <g>
      {/* A thin line ties the card to the blank it describes */}
      {tether > 0 ? (
        <g opacity={tether * 0.8}>
          <path
            d={`M${CARD.x},${home.y} C${CARD.x - 120},${home.y} ${node.x + 140},${node.y} ${node.x + 50 * cam.s},${node.y}`}
            fill="none"
            stroke={hex}
            strokeOpacity={0.45}
            strokeWidth={1.2}
            strokeDasharray="3 6"
            className="ab-tether"
          />
          <circle cx={CARD.x} cy={home.y} r={3.5} fill={hex} />
        </g>
      ) : null}

      {m > 0 ? <circle cx={pos.x} cy={pos.y} r={10 + Math.sin(m * Math.PI) * 26} fill={hex} opacity={Math.sin(m * Math.PI) * 0.7} filter="url(#ab-bloom)" /> : null}

      <g transform={`translate(${pos.x},${pos.y}) scale(${scale})`} opacity={opacity}>
        <foreignObject x={-CARD.w / 2} y={-CARD.h / 2} width={CARD.w} height={CARD.h} style={{ overflow: "visible" }}>
          <CardBody part={part} ch={ch} live={live} />
        </foreignObject>
      </g>
    </g>
  );
}

const CardBody = memo(function CardBody({ part, ch, live }: { part: Part; ch: number; live: string }) {
  const hex = TONE[part.tone];
  const Icon = part.icon;
  const region = REGIONS.find((r) => r.id === part.region);
  const isLive = part.id === "nhc";
  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-[26px] border px-8 pt-7 pb-7 text-slate-300"
      style={{
        background: "linear-gradient(160deg, rgba(17,25,42,0.97), rgba(9,13,24,0.97))",
        borderColor: `${hex}33`,
        boxShadow: `0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 60px ${hex}14`,
        fontFamily: "var(--font-sans-ui)",
      }}
    >
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${hex}, transparent 80%)` }} />
      <div
        className="ab-in font-mono text-[12px] tracking-[0.22em] uppercase"
        style={{ color: hex, animationDelay: "0.05s" }}
      >
        Part {String(ch + 1).padStart(2, "0")} · {region?.name}
      </div>

      <div className="ab-in mt-4 flex items-center gap-4" style={{ animationDelay: "0.12s" }}>
        <span
          className="grid size-[58px] shrink-0 place-items-center rounded-2xl"
          style={{ background: `${hex}14`, color: hex, boxShadow: `inset 0 0 0 1px ${hex}55, 0 0 28px ${hex}22` }}
        >
          <Icon size={28} strokeWidth={1.7} />
        </span>
        <h2
          className="text-[36px] leading-[40px] text-white"
          style={{ fontFamily: "var(--font-display)", fontVariationSettings: '"SOFT" 60, "opsz" 72' }}
        >
          {part.name}
        </h2>
      </div>

      <p className="ab-in mt-4 text-[20px] leading-[28px] text-slate-200" style={{ animationDelay: "0.22s" }}>
        {part.does}
      </p>

      <div className="ab-in mt-6 border-t border-white/[0.07] pt-5" style={{ animationDelay: "0.34s" }}>
        <div className="flex items-baseline gap-3">
          {isLive ? <span className="ab-blink size-2.5 translate-y-[-6px] rounded-full bg-red-400" /> : null}
          <span className="font-mono text-[46px] leading-none tracking-tight" style={{ color: hex, textShadow: `0 0 28px ${hex}55` }}>
            {part.stat.value}
          </span>
        </div>
        <div className="mt-2 text-[14px] leading-5 text-slate-400">{isLive ? live : part.stat.label}</div>
      </div>

      <ul className="mt-6 space-y-3">
        {part.points.map((pt, i) => (
          <li key={pt} className="ab-in flex gap-3 text-[15.5px] leading-[23px]" style={{ animationDelay: `${0.5 + i * 0.12}s` }}>
            <span className="mt-[9px] size-1.5 shrink-0 rounded-full" style={{ background: hex }} />
            <span>{pt}</span>
          </li>
        ))}
      </ul>

      <div className="ab-in mt-auto flex flex-wrap gap-2 pt-5" style={{ animationDelay: "0.95s" }}>
        {part.tech.map((tag) => (
          <span key={tag} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[12px] text-slate-300">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
});

/* ---------------------------------------------------------------- title, counter, captions */

function Chrome({ f, paused, out }: { f: Frame; paused: boolean; out: number }) {
  const built = f.mode === "build" ? f.ch + (f.lt >= T_FILL ? 1 : 0) : CHAPTERS.length;
  return (
    <g>
      <g transform="translate(48,70)">
        <text fontSize="34" fill="#f8fafc" fontFamily="var(--font-display)" style={{ fontVariationSettings: '"SOFT" 60, "opsz" 72' }}>
          MrGridy
          <tspan fill="#64748b" fontSize="22" dx="12">
            how it&apos;s built
          </tspan>
        </text>
        {paused ? (
          <text y={26} fontSize="11" letterSpacing="2.4" fill="#FBBF24" fontFamily="var(--font-numbers)">
            PAUSED
          </text>
        ) : null}
      </g>

      {/* Parts built so far */}
      <g transform={`translate(${W - 48},58)`}>
        <text textAnchor="end" fontSize="28" fill="#e2e8f0" fontFamily="var(--font-numbers)">
          {String(built).padStart(2, "0")}
          <tspan fill="#475569" fontSize="18">
            {" "}/ {CHAPTERS.length}
          </tspan>
        </text>
        <text y={20} textAnchor="end" fontSize="10.5" letterSpacing="2.4" fill="#64748b" fontFamily="var(--font-numbers)">
          PARTS BUILT
        </text>
        <g transform={`translate(${-CHAPTERS.length * 17},34)`}>
          {CHAPTERS.map((c, i) => {
            const part = PART[c.fill];
            const done = i < built;
            const now = f.mode === "build" && i === f.ch && !done;
            return (
              <rect
                key={c.fill}
                x={i * 17}
                y={0}
                width={13}
                height={4}
                rx={2}
                fill={done || now ? TONE[part.tone] : "#1e293b"}
                opacity={done ? 0.9 : now ? 0.45 : 1}
              />
            );
          })}
        </g>
      </g>

      {/* Finale titles */}
      {f.mode === "intro" ? <FinaleTitle lt={f.lt} /> : null}
      {f.mode === "flow" ? <FlowCaption f={f} /> : null}
      {f.mode === "out" ? (
        <text
          x={W / 2}
          y={H / 2}
          textAnchor="middle"
          fontSize="30"
          fill="#e2e8f0"
          opacity={Math.sin(clamp(out) * Math.PI)}
          fontFamily="var(--font-display)"
        >
          Once more, from the start.
        </text>
      ) : null}
    </g>
  );
}

function FinaleTitle({ lt }: { lt: number }) {
  const o = clamp(lt / 0.6) * clamp((FIN_INTRO - lt) / 0.5);
  return (
    <g opacity={o} transform={`translate(${W / 2},${H - 70})`}>
      <text textAnchor="middle" fontSize="34" fill="#f8fafc" fontFamily="var(--font-display)" style={{ fontVariationSettings: '"SOFT" 60, "opsz" 72' }}>
        The whole system
      </text>
      <text y={32} textAnchor="middle" fontSize="17" fill="#94a3b8" fontFamily="var(--font-sans-ui)">
        Built once before the demo, served as files, calling out only when it has to. Now watch three real requests.
      </text>
    </g>
  );
}

function FlowCaption({ f }: { f: Extract<Frame, { mode: "flow" }> }) {
  const flow = FLOWS[f.fi];
  const o = clamp(f.lt / 0.5) * clamp((FLOW_LEN[f.fi] - f.lt) / 0.4);
  return (
    <g opacity={o} transform={`translate(${W / 2},${H - 72})`}>
      <text textAnchor="middle" fontSize="12" letterSpacing="2.6" fill="#34D399" fontFamily="var(--font-numbers)">
        REQUEST {f.fi + 1} OF {FLOWS.length}
      </text>
      <text y={34} textAnchor="middle" fontSize="30" fill="#f8fafc" fontFamily="var(--font-display)" style={{ fontVariationSettings: '"SOFT" 60, "opsz" 72' }}>
        {flow.title}
      </text>
      <text y={62} textAnchor="middle" fontSize="17" fill="#a3adbd" fontFamily="var(--font-sans-ui)">
        {flow.caption}
      </text>
    </g>
  );
}

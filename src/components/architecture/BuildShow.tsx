"use client";

import { RotateCcw, SkipForward } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ACTS,
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

const CH = 10; // one chapter
const T_FOCUS = 1.2; // camera closes in on the new part
const T_TITLE = 2.2; // the title trace grows out of the station
const T_STAT = 3.3; // the headline number counts up
const T_FACTS = 3.7; // one trace per fact
const T_TAGS = 4.7; // tech tags drift into orbit
const T_MERGE = 7.4; // everything is pulled back into the station
const T_FILL = 8.5; // the station lights up
const T_RELEASE = 8.4; // camera pulls back out

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

/** Where the part in focus sits on screen, leaving the right side for its story. */
const FOCUS = { x: 430, y: 480, s: 1.9 };

function focusCam(p: P): Cam {
  return {
    cx: p.x + (W / 2 - FOCUS.x) / FOCUS.s,
    cy: p.y + (H / 2 - FOCUS.y) / FOCUS.s,
    s: FOCUS.s,
    vx: 0,
    vy: 0,
    vw: W,
    vh: H,
  };
}

function camTarget(f: Frame): Cam {
  if (f.mode === "build" && f.lt >= T_FOCUS && f.lt < T_RELEASE) return focusCam(PART[CHAPTERS[f.ch].fill]);
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
  const vp = f.mode === "build" ? { vx: 40, vy: 120, vw: 1520, vh: 680 } : { vx: 30, vy: 112, vw: 1540, vh: 624 };
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

/** Replaying one part on its own: starts just before the camera closes in, ends once it has lit up again. */
const REPLAY_FROM = T_FOCUS - 0.2;
const REPLAY_END = T_FILL + 1.1;

type Replay = { id: string; lt: number } | null;

function Show() {
  const clock = useRef(0);
  const paused = useRef(false);
  const replay = useRef<Replay>(null);
  const cam = useRef<Cam>(START_CAM);
  const [view, setView] = useState<{ t: number; cam: Cam; replay: Replay }>({ t: 0, cam: START_CAM, replay: null });
  const [isPaused, setIsPaused] = useState(false);
  const live = useLiveStorms();

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // A replay holds the main story where it is and plays one part on top.
      const r = replay.current;
      if (r) {
        if (!paused.current) r.lt += dt;
        if (r.lt > REPLAY_END) replay.current = null;
      } else if (!paused.current) clock.current += dt;
      const rp = replay.current;
      const target =
        rp && rp.lt < T_RELEASE ? focusCam(PART[rp.id]) : camTarget(frameAt(clock.current));
      const k = 1 - Math.exp(-dt * 3);
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
      setView({ t: clock.current, cam: next, replay: rp ? { ...rp } : null });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const goTo = useCallback((x: number) => {
    replay.current = null;
    const cycle = Math.floor(clock.current / LOOP);
    clock.current = cycle * LOOP + x + 0.001;
  }, []);

  /** A part that is already built is replayed on its own; one that is not yet built is jumped to. */
  const pick = useCallback(
    (id: string) => {
      const f = frameAt(clock.current);
      const built = f.mode !== "build" || FILL_CH[id] < f.ch || (FILL_CH[id] === f.ch && f.lt >= T_FILL);
      if (built) replay.current = { id, lt: REPLAY_FROM };
      else goTo(FILL_CH[id] * CH);
    },
    [goTo],
  );

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
        if (replay.current) replay.current = null;
        else goTo(marks.find((m) => m > x + 0.05) ?? LOOP);
      } else if (e.key === "ArrowLeft") {
        goTo([...marks].reverse().find((m) => m < x - 1.2) ?? 0);
      } else if (e.key === "Home") {
        goTo(0);
      } else if (e.key === "End") {
        goTo(BUILD);
      } else if (e.key === "Escape") {
        replay.current = null;
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
  const rp = view.replay;
  const current = !rp && f.mode === "build" ? PART[CHAPTERS[f.ch].fill] : null;
  const flow = f.mode === "flow" ? FLOWS[f.fi] : null;
  const stormy =
    flow?.storm && f.mode === "flow" ? clamp(f.lt / 1.5) * clamp((FLOW_LEN[FLOWS.length - 1] - f.lt) / 1.2) : 0;
  const out = f.mode === "out" ? easeInOut(clamp(f.lt / (FIN_OUT - 0.4))) : 0;
  const built = f.mode === "build" ? f.ch + (f.lt >= T_FILL ? 1 : 0) : CHAPTERS.length;

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
          {flow && f.mode === "flow" && !rp ? <FlowPulses f={f} /> : null}
          {PARTS.map((p) => (
            <Station
              key={p.id}
              part={p}
              f={f}
              t={view.t}
              replayLt={rp?.id === p.id ? rp.lt : null}
              onPick={() => pick(p.id)}
            />
          ))}
        </g>

        {current && f.mode === "build" ? <Focus part={current} ch={f.ch} lt={f.lt} cam={c} live={live} /> : null}
        {rp ? <Focus part={PART[rp.id]} ch={FILL_CH[rp.id]} lt={rp.lt} cam={c} live={live} /> : null}

        <Chrome f={f} paused={isPaused} out={out} replaying={Boolean(rp)} />
      </svg>

      <Rail
        built={built}
        now={rp ? FILL_CH[rp.id] : f.mode === "build" ? f.ch : -1}
        finale={f.mode !== "build"}
        onPick={(i) => pick(CHAPTERS[i].fill)}
        onStart={() => goTo(0)}
        onEnd={() => goTo(BUILD)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- part rail */

/** Jump to any part: built ones replay on their own, the rest are skipped to. */
function Rail({
  built,
  now,
  finale,
  onPick,
  onStart,
  onEnd,
}: {
  built: number;
  now: number;
  finale: boolean;
  onPick: (i: number) => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? (now >= 0 ? now : null);
  const btn =
    "flex h-8 items-center gap-1.5 rounded-full px-3 font-mono text-[11px] tracking-[0.08em] text-slate-400 uppercase transition hover:bg-white/[0.07] hover:text-white";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <div className="pointer-events-auto relative flex items-center gap-2 rounded-full border border-white/[0.07] bg-[#0a0f1b]/80 py-1.5 pr-1.5 pl-2 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-md">
        <button onClick={onStart} className={btn} aria-label="Start over">
          <RotateCcw size={13} /> Start
        </button>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <div className="flex items-center" onMouseLeave={() => setHover(null)}>
          {CHAPTERS.map((c, i) => {
            const part = PART[c.fill];
            const hex = TONE[part.tone];
            const done = i < built;
            const isNow = i === now;
            const gap = ACTS.some((a) => a.from === i && i > 0);
            return (
              <button
                key={c.fill}
                onClick={() => onPick(i)}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                aria-label={`${i + 1}. ${part.name}${done ? ", replay" : ", jump to"}`}
                className={`group grid size-7 place-items-center rounded-full ${gap ? "ml-3" : ""}`}
              >
                <span
                  className="grid size-[18px] place-items-center rounded-full font-mono text-[9.5px] transition-transform group-hover:scale-125"
                  style={{
                    background: done ? `${hex}26` : "transparent",
                    color: done ? hex : "#475569",
                    boxShadow: isNow ? `0 0 0 1.5px ${hex}, 0 0 14px ${hex}88` : `inset 0 0 0 1px ${done ? `${hex}66` : "#334155"}`,
                  }}
                >
                  {i + 1}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <button onClick={onEnd} className={`${btn} ${finale ? "text-emerald-300" : ""}`} aria-label="Skip to the full system">
          Full system <SkipForward size={13} />
        </button>

        {shown !== null ? (
          <div className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 rounded-full border border-white/[0.08] bg-[#0a0f1b]/90 px-3 py-1 font-mono text-[11px] whitespace-nowrap text-slate-300">
            <span style={{ color: TONE[PART[CHAPTERS[shown].fill].tone] }}>{String(shown + 1).padStart(2, "0")}</span>
            {"  "}
            {PART[CHAPTERS[shown].fill].name}
            <span className="text-slate-500">
              {"  ·  "}
              {shown === now && hover === null ? "now explaining" : shown < built ? "click to replay" : "click to jump here"}
            </span>
          </div>
        ) : null}
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
  replayLt,
  onPick,
}: {
  part: Part;
  f: Frame;
  t: number;
  replayLt: number | null;
  onPick: () => void;
}) {
  const st = status(part.id, f);
  const { shown, filled } = st;
  const age = replayLt === null ? st.age : replayLt - T_FILL;
  const labelIn = replayLt === null ? 1 : replayLt < T_FOCUS ? 1 : clamp((replayLt - T_FILL) / 0.3);
  if (shown <= 0) return null;
  const hex = TONE[part.tone];
  const Icon = part.icon;
  const pop = easeBack(shown);
  const r = 36;
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.4 + part.x * 0.01);
  return (
    <g
      transform={`translate(${part.x},${part.y}) scale(${pop})`}
      className={filled >= 1 ? "cursor-pointer" : undefined}
      onClick={filled >= 1 ? onPick : undefined}
    >
      {/* Not explained yet: the icon in grey, no label */}
      <g opacity={1 - filled}>
        <circle r={r} fill="#0a0f1c" stroke="#475569" strokeWidth={1.4} strokeDasharray="4 5" />
        <Icon x={-14} y={-14} width={28} height={28} color="#64748b" strokeWidth={1.6} />
      </g>

      {/* Filled */}
      {filled > 0 ? (
        <g opacity={filled}>
          <circle r={r + 20} fill={hex} opacity={0.07 + breathe * 0.04} filter="url(#ab-bloom)" />
          <circle r={r} fill="#0b1222" stroke={hex} strokeWidth={1.8} />
          <circle r={r - 6} fill={hex} fillOpacity={0.09} />
          <Icon x={-14} y={-14} width={28} height={28} color={hex} strokeWidth={1.7} />
          <g opacity={labelIn}>
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

/* ---------------------------------------------------------------- the part in focus */

/*
 * A new part is explained where it stands. The camera closes in, the rest of
 * the grid dims, and the part's story grows out of it like circuitry: a trace
 * to its title, one trace per fact, its tech in orbit. Then every trace is
 * pulled back in, the title shrinks into the station's label, and it lights up.
 */

const seg = (lt: number, start: number, dur: number) => clamp((lt - start) / dur);

type Poly = P[];

function polyLen(pts: Poly) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

function polyAt(pts: Poly, t: number): P {
  let want = polyLen(pts) * clamp(t);
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (want <= d) {
      const k = d ? want / d : 0;
      return { x: lerp(pts[i - 1].x, pts[i].x, k), y: lerp(pts[i - 1].y, pts[i].y, k) };
    }
    want -= d;
  }
  return pts[pts.length - 1];
}

const polyD = (pts: Poly) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

/** A trace leaves the ring at `deg`, runs out, bends 45 degrees and ends level with `y` at `x`. */
function trace(n: P, rr: number, deg: number, x: number, y: number): Poly {
  const a = (deg * Math.PI) / 180;
  const p0 = { x: n.x + Math.cos(a) * rr, y: n.y + Math.sin(a) * rr };
  const p1 = { x: n.x + Math.cos(a) * (rr + 22), y: n.y + Math.sin(a) * (rr + 22) };
  const p2 = { x: p1.x + Math.abs(y - p1.y), y };
  return [p0, p1, p2, { x, y }];
}

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if (line && (line + " " + w).length > max) {
      out.push(line);
      line = w;
    } else line = line ? line + " " + w : w;
  }
  if (line) out.push(line);
  return out;
}

/** "10,000" counts up; "~50 s" keeps its prefix and unit; words appear as they are. */
function counting(value: string, k: number): string {
  const m = value.match(/^(~?)([\d,]+)(.*)$/);
  if (!m) return value;
  const n = Number(m[2].replace(/,/g, ""));
  const now = Math.round(n * k);
  return m[1] + (m[2].includes(",") ? now.toLocaleString("en-US") : String(now)) + m[3];
}

const widthCache = new Map<string, number>();
/** Width of the hero title, so it can shrink onto the label's exact spot. */
function titleWidth(text: string, size: number): number {
  const key = `${size}|${text}`;
  const hit = widthCache.get(key);
  if (hit) return hit;
  const ctx = document.createElement("canvas").getContext("2d");
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-sans-ui") || "sans-serif";
  if (!ctx) return text.length * size * 0.55;
  ctx.font = `600 ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (document.fonts?.status === "loaded") widthCache.set(key, w);
  return w;
}

const HERO = 52; // title size in the focus
const LABEL = 17; // station label size in the world

function Focus({ part, ch, lt, cam, live }: { part: Part; ch: number; lt: number; cam: Cam; live: string }) {
  if (lt < T_FOCUS) return null;
  const hex = TONE[part.tone];
  const n = toScreen(cam, part);
  const R = 36 * cam.s;
  const rr = R + 12;
  const tx = n.x + R + 112; // text column
  const padX = tx - 26;
  const sx = 1220; // number column

  const spot = seg(lt, T_FOCUS, 0.8) * (1 - seg(lt, T_FILL - 0.2, 0.8));
  const merge = seg(lt, T_MERGE, T_FILL - T_MERGE);
  const fadeOut = 1 - seg(lt, T_MERGE, 0.35);
  const ring = seg(lt, T_FOCUS + 0.6, 0.6) * (1 - merge);

  // Title trace and accent bar
  const topY = n.y - 176;
  const botY = n.y - 14;
  const titleTrace = trace(n, rr, -40, padX, (topY + botY) / 2);
  const titleDraw = seg(lt, T_TITLE, 0.45) * (1 - seg(lt, T_MERGE, 0.4));
  const bar = seg(lt, T_TITLE + 0.35, 0.35) * fadeOut;

  // Hero title: wipes in, then shrinks onto the station label
  const reveal = easeOut(seg(lt, T_TITLE + 0.55, 0.6));
  const morph = easeInOut(seg(lt, T_MERGE + 0.25, T_FILL - T_MERGE - 0.25));
  const label = toScreen(cam, { x: part.x, y: part.y + 36 + 26 });
  const endScale = (LABEL * cam.s) / HERO;
  const w = titleWidth(part.name, HERO);
  const hx = lerp(tx, label.x - (w * endScale) / 2, morph);
  const hy = lerp(n.y - 98, label.y, morph);
  const hs = lerp(1, endScale, morph);

  // Facts
  const rows = part.points.map((pt, i) => {
    const y = n.y + 42 + i * 52;
    const start = T_FACTS + i * 0.32;
    const back = seg(lt, T_MERGE + (2 - i) * 0.1, 0.5);
    return {
      pt,
      y,
      poly: trace(n, rr, 12 + i * 20, padX, y),
      draw: easeOut(seg(lt, start, 0.45)) * (1 - easeInOut(back)),
      text: seg(lt, start + 0.35, 0.35) * (1 - seg(lt, T_MERGE + (2 - i) * 0.1, 0.25)),
      back,
    };
  });

  // Number
  const statIn = seg(lt, T_STAT, 0.4) * fadeOut;
  const count = easeOut(seg(lt, T_STAT, 1.1));
  const isLive = part.id === "nhc";
  const statLines = wrap(isLive ? live : part.stat.label, 34);

  const kickerIn = seg(lt, T_TITLE + 0.45, 0.4) * fadeOut;
  const doesIn = seg(lt, T_TITLE + 0.9, 0.45) * fadeOut;
  const region = REGIONS.find((r) => r.id === part.region);

  return (
    <g pointerEvents="none">
      {/* Spotlight */}
      <defs>
        <radialGradient id="ab-spot" gradientUnits="userSpaceOnUse" cx={n.x} cy={n.y} r={R + 150}>
          <stop offset="0" stopColor="#000" />
          <stop offset="0.45" stopColor="#000" />
          <stop offset="1" stopColor="#fff" />
        </radialGradient>
        <mask id="ab-spot-mask">
          <rect width={W} height={H} fill="url(#ab-spot)" />
        </mask>
        <linearGradient id="ab-fade-right" x1="0" x2="1">
          <stop offset="0" stopColor="#03050a" stopOpacity="0" />
          <stop offset="1" stopColor="#03050a" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="#03050a" opacity={0.8 * spot} mask="url(#ab-spot-mask)" />

      {/* Ring powering up around the station */}
      {ring > 0 ? (
        <g>
          <circle
            cx={n.x}
            cy={n.y}
            r={rr}
            fill="none"
            stroke={hex}
            strokeWidth={2}
            strokeDasharray={`${2 * Math.PI * rr} ${2 * Math.PI * rr}`}
            strokeDashoffset={2 * Math.PI * rr * (1 - easeOut(ring))}
            transform={`rotate(-90 ${n.x} ${n.y})`}
            filter="url(#ab-glow)"
          />
          <g transform={`rotate(${lt * 8} ${n.x} ${n.y})`} opacity={0.4 * ring}>
            {Array.from({ length: 48 }, (_, i) => {
              const a = (i / 48) * Math.PI * 2;
              const r0 = rr + 10;
              const r1 = rr + (i % 4 === 0 ? 20 : 15);
              return (
                <line
                  key={i}
                  x1={n.x + Math.cos(a) * r0}
                  y1={n.y + Math.sin(a) * r0}
                  x2={n.x + Math.cos(a) * r1}
                  y2={n.y + Math.sin(a) * r1}
                  stroke={hex}
                  strokeWidth={1}
                />
              );
            })}
          </g>
          <circle cx={n.x} cy={n.y} r={R + 34} fill={hex} opacity={0.12 * ring} filter="url(#ab-bloom)" />
        </g>
      ) : null}

      {/* Title trace, accent bar, kicker, title, one-liner */}
      <Trace poly={titleTrace} draw={titleDraw} hex={hex} lt={lt} back={seg(lt, T_MERGE, 0.4)} />
      <line x1={padX} y1={topY} x2={padX} y2={lerp(topY, botY, easeOut(bar))} stroke={hex} strokeWidth={2.5} strokeLinecap="round" opacity={bar} />
      <text
        x={tx}
        y={n.y - 152}
        fontSize="13"
        letterSpacing="3"
        fill={hex}
        opacity={kickerIn}
        fontFamily="var(--font-numbers)"
      >
        {`PART ${String(ch + 1).padStart(2, "0")} OF ${CHAPTERS.length}  ·  ${region?.name.toUpperCase()}`}
      </text>
      <defs>
        <clipPath id="ab-title-clip">
          <rect x={tx - 6} y={n.y - 150} width={morph > 0 ? 4000 : (w + 20) * reveal} height={80} />
        </clipPath>
      </defs>
      <g clipPath={morph > 0 ? undefined : "url(#ab-title-clip)"} opacity={1 - seg(lt, T_FILL, 0.3)}>
        <text
          transform={`translate(${hx},${hy}) scale(${hs})`}
          fontSize={HERO}
          fontWeight="600"
          fill="#f8fafc"
          fontFamily="var(--font-sans-ui)"
          letterSpacing="-0.5"
        >
          {part.name}
        </text>
      </g>
      <text
        x={tx}
        y={n.y - 56}
        fontSize="23"
        fill="#cbd5e1"
        opacity={doesIn}
        fontFamily="var(--font-sans-ui)"
        transform={`translate(0,${(1 - doesIn) * 8})`}
      >
        {part.does}
      </text>

      <text
        x={tx}
        y={n.y - 22}
        fontSize="15"
        fill={hex}
        opacity={seg(lt, T_TITLE + 1.2, 0.45) * fadeOut}
        fontFamily="var(--font-numbers)"
      >
        {`↳  ${part.via}`}
      </text>

      {/* The number */}
      <g opacity={statIn} transform={`translate(${(1 - statIn) * 16},0)`}>
        <line x1={sx - 44} y1={n.y - 178} x2={sx - 44} y2={n.y - 6} stroke="#334155" strokeWidth={1} />
        <g transform={`translate(${sx},${n.y - 84})`}>
          {isLive ? <circle cx={8} cy={-26} r={7} fill="#F87171" className="ab-blink" /> : null}
          <text
            x={isLive ? 26 : 0}
            fontSize="80"
            fill={hex}
            fontFamily="var(--font-numbers)"
            letterSpacing="-2"
            filter="url(#ab-glow)"
          >
            {counting(part.stat.value, count)}
          </text>
        </g>
        {statLines.map((l, i) => (
          <text key={i} x={sx} y={n.y - 46 + i * 21} fontSize="16" fill="#94a3b8" fontFamily="var(--font-sans-ui)">
            {l}
          </text>
        ))}
      </g>

      {/* Facts, each on its own trace */}
      {rows.map((r, i) => (
        <g key={i}>
          <Trace poly={r.poly} draw={r.draw} hex={hex} lt={lt + i * 0.37} back={r.back} />
          {r.draw > 0.97 ? (
            <g>
              <circle cx={padX} cy={r.y} r={6} fill="#060910" stroke={hex} strokeWidth={1.6} />
              <circle cx={padX} cy={r.y} r={2.4} fill={hex} />
            </g>
          ) : null}
          <text
            x={tx}
            y={r.y + 7}
            fontSize="20"
            fill="#e2e8f0"
            opacity={r.text}
            transform={`translate(${(1 - r.text) * -14},0)`}
            fontFamily="var(--font-sans-ui)"
          >
            {r.pt}
          </text>
        </g>
      ))}

      {/* Tech tags in orbit on the left */}
      {part.tech.map((tag, i) => {
        const k = part.tech.length;
        const appear = easeBack(seg(lt, T_TAGS + i * 0.09, 0.5));
        const pull = easeInOut(seg(lt, T_MERGE + 0.15 + i * 0.05, 0.7));
        if (appear <= 0 || pull >= 1) return null;
        const base = Math.PI + (i - (k - 1) / 2) * 0.46 + Math.sin(lt * 0.35) * 0.04;
        const ang = base + pull * 2.2;
        const rad = lerp(rr, rr + 74, appear) * (1 - pull) + R * 0.2 * pull;
        const cx = n.x + Math.cos(ang) * rad;
        const cy = n.y + Math.sin(ang) * rad;
        const tw = tag.length * 8 + 26;
        const o = clamp(appear) * (1 - pull);
        return (
          <g key={tag} opacity={o}>
            <line
              x1={n.x + Math.cos(ang) * (rr + 4)}
              y1={n.y + Math.sin(ang) * (rr + 4)}
              x2={n.x + Math.cos(ang) * (rad - 8)}
              y2={n.y + Math.sin(ang) * (rad - 8)}
              stroke={hex}
              strokeOpacity={0.35}
            />
            <g transform={`translate(${cx - tw / 2 - Math.max(0, -Math.cos(ang)) * (tw / 2 - 6)},${cy - 14}) scale(${1 - pull * 0.6})`}>
              <rect width={tw} height={28} rx={14} fill="#0b1222" stroke={hex} strokeOpacity={0.45} />
              <text x={tw / 2} y={19} textAnchor="middle" fontSize="13" fill="#e2e8f0" fontFamily="var(--font-numbers)">
                {tag}
              </text>
            </g>
          </g>
        );
      })}

      {/* The pull-in: a flash gathering in the station */}
      {merge > 0 ? (
        <circle cx={n.x} cy={n.y} r={R * (0.6 + merge * 0.6)} fill={hex} opacity={Math.sin(merge * Math.PI) * 0.45} filter="url(#ab-bloom)" />
      ) : null}
    </g>
  );
}

/** A trace that grows out of the station, carries current while it is up, and retracts back in. */
function Trace({ poly, draw, hex, lt, back }: { poly: Poly; draw: number; hex: string; lt: number; back: number }) {
  if (draw <= 0) return null;
  const len = polyLen(poly);
  const d = polyD(poly);
  const tip = polyAt(poly, draw);
  const settled = draw > 0.97 && back === 0;
  return (
    <g>
      <path d={d} fill="none" stroke={hex} strokeOpacity={0.18} strokeWidth={6} strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - draw)} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={hex} strokeOpacity={0.85} strokeWidth={1.6} strokeDasharray={`${len} ${len}`} strokeDashoffset={len * (1 - draw)} strokeLinejoin="round" />
      {!settled ? <circle cx={tip.x} cy={tip.y} r={4.5} fill="#f8fafc" filter="url(#ab-glow)" /> : null}
      {settled
        ? [0, 0.5].map((o) => {
            const q = polyAt(poly, (lt * 0.55 + o) % 1);
            return <circle key={o} cx={q.x} cy={q.y} r={2.6} fill="#f8fafc" opacity={0.85} filter="url(#ab-glow)" />;
          })
        : null}
    </g>
  );
}

/* ---------------------------------------------------------------- title, counter, captions */

function Chrome({ f, paused, out, replaying }: { f: Frame; paused: boolean; out: number; replaying: boolean }) {
  const built = f.mode === "build" ? f.ch + (f.lt >= T_FILL ? 1 : 0) : CHAPTERS.length;
  const actIx = f.mode === "build" ? ACTS.filter((a) => a.from <= f.ch).length - 1 : -1;
  const story =
    replaying ? "REPLAYING ONE PART" : actIx >= 0 ? `STORY ${actIx + 1} OF ${ACTS.length}  ·  ${ACTS[actIx].title.toUpperCase()}` : "THE WHOLE SYSTEM";
  return (
    <g>
      <g transform="translate(48,70)">
        <text fontSize="34" fill="#f8fafc" fontFamily="var(--font-display)" style={{ fontVariationSettings: '"SOFT" 60, "opsz" 72' }}>
          MrGridy
          <tspan fill="#64748b" fontSize="22" dx="12">
            how it&apos;s built
          </tspan>
        </text>
        <text y={30} fontSize="11.5" letterSpacing="2.6" fill={paused ? "#FBBF24" : "#7dd3fc"} fillOpacity={0.85} fontFamily="var(--font-numbers)">
          {paused ? "PAUSED" : story}
        </text>
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
      </g>

      {/* Finale titles */}
      {f.mode === "intro" && !replaying ? <FinaleTitle lt={f.lt} /> : null}
      {f.mode === "flow" && !replaying ? <FlowCaption f={f} /> : null}
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
    <g opacity={o} transform={`translate(${W / 2},${H - 150})`}>
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
    <g opacity={o} transform={`translate(${W / 2},${H - 170})`}>
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

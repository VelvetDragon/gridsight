"use client";

/**
 * Customers out over time for one county (or a state / both states).
 *
 *   <OutageChart storm="helene" fips="13245" />
 *   <OutageChart storm="helene" state="SC" />
 *
 * Reads GET /api/outages. Shows a "Live from Tiger Data" badge when the curve
 * came from the database; otherwise names the static source. Plain SVG.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Database } from "lucide-react";
import { fetchOutageCurve, type OutageCurve } from "@/lib/integrations/outages";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const LINE = "var(--slate, #334155)";
const PAD = { top: 12, right: 12, bottom: 22, left: 44 };

function compact(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}

function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const timeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  timeZone: "America/New_York",
});

type Load = { key: string; curve: OutageCurve | null; error: string | null };

export interface OutageChartProps {
  storm?: string;
  fips?: string;
  state?: "GA" | "SC";
  height?: number;
  className?: string;
}

export function OutageChart({ storm, fips, state, height = 160, className }: OutageChartProps) {
  const key = `${storm ?? ""}|${fips ?? ""}|${state ?? ""}`;
  const [load, setLoad] = useState<Load | null>(null);
  const [width, setWidth] = useState(360);
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchOutageCurve({ storm, fips, state }, ctrl.signal)
      .then((curve) => setLoad({ key, curve, error: null }))
      .catch((err: Error) => {
        if (!ctrl.signal.aborted) setLoad({ key, curve: null, error: err.message });
      });
    return () => ctrl.abort();
  }, [key, storm, fips, state]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = load?.key === key ? load : null;
  const curve = current?.curve ?? null;
  // Only quote "of N customers" when the customer count covers the area (sample data may not).
  const customers =
    curve?.customers && curve.peak && curve.peak.out <= curve.customers ? curve.customers : null;

  const geom = useMemo(() => {
    if (!curve || curve.points.length < 2) return null;
    const pts = curve.points;
    const innerW = width - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const yMax = niceMax(Math.max(...pts.map((p) => p.out), curve.predictedPeakOut ?? 0));
    const t0 = Date.parse(pts[0].t);
    const t1 = Date.parse(pts[pts.length - 1].t);
    const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * innerW;
    const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
    const xy = pts.map((p) => [x(Date.parse(p.t)), y(p.out)] as const);
    const line = xy.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
    const area = `${line}L${xy[xy.length - 1][0].toFixed(1)},${y(0)}L${xy[0][0].toFixed(1)},${y(0)}Z`;
    // One tick per day at local midnight.
    const days: number[] = [];
    const first = new Date(t0);
    first.setHours(24, 0, 0, 0);
    for (let t = first.getTime(); t <= t1; t += 86_400_000) days.push(t);
    const step = Math.ceil(days.length / Math.max(1, Math.floor(innerW / 64)));
    return { pts, xy, line, area, yMax, x, y, days: days.filter((_, i) => i % step === 0), innerW };
  }, [curve, width, height]);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left + PAD.left;
    let best = 0;
    for (let i = 1; i < geom.xy.length; i++) {
      if (Math.abs(geom.xy[i][0] - px) < Math.abs(geom.xy[best][0] - px)) best = i;
    }
    setHover(best);
  }

  const hovered = geom && hover != null ? geom.pts[hover] : null;
  const badge =
    curve?.source === "tiger" ? (
      <span className="inline-flex h-[20px] items-center gap-1 rounded-full bg-[rgba(51,65,85,0.1)] px-2 text-[11px] font-medium text-ink-2">
        <Database size={11} aria-hidden />
        Live from Tiger Data
      </span>
    ) : curve ? (
      <span className="text-[11px] text-ink-3">
        {curve.basis === "eaglei" ? "EAGLE-I outage record" : "Estimated shape from model peaks"}
      </span>
    ) : null;

  return (
    <figure className={cx("flex flex-col gap-1.5 text-ink", className)}>
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium">
          Customers out{curve ? ` · ${curve.label}` : ""}
        </span>
        {badge}
      </figcaption>
      <div ref={boxRef} className="relative w-full" style={{ height }}>
        {!current ? (
          <div className="h-full w-full animate-pulse rounded-[8px] bg-wash" aria-label="Loading outage curve" />
        ) : !geom ? (
          <div className="flex h-full items-center justify-center rounded-[8px] bg-wash text-[12px] text-ink-3">
            {current.error ?? "No outage record for this area"}
          </div>
        ) : (
          <>
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={`Customers out in ${curve!.label}${curve!.peak ? `, peaking at ${curve!.peak.out.toLocaleString("en-US")} on ${timeFmt.format(new Date(curve!.peak.t))}` : ""}`}
              className="block overflow-visible"
            >
              {[0, 0.5, 1].map((f) => (
                <g key={f}>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={geom.y(geom.yMax * f)}
                    y2={geom.y(geom.yMax * f)}
                    stroke="var(--hairline, rgba(0,0,0,0.08))"
                  />
                  <text
                    x={PAD.left - 6}
                    y={geom.y(geom.yMax * f)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-ink-3 text-[10px] tabular-nums"
                  >
                    {compact(geom.yMax * f)}
                  </text>
                </g>
              ))}
              {geom.days.map((t) => (
                <text
                  key={t}
                  x={geom.x(t)}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-ink-3 text-[10px]"
                >
                  {dayFmt.format(new Date(t))}
                </text>
              ))}
              {curve!.predictedPeakOut && curve!.basis === "eaglei" ? (
                <g>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={geom.y(curve!.predictedPeakOut)}
                    y2={geom.y(curve!.predictedPeakOut)}
                    stroke="var(--ink-3, #5a6070)"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                  />
                  <text
                    x={width - PAD.right}
                    y={geom.y(curve!.predictedPeakOut) - 4}
                    textAnchor="end"
                    className="fill-ink-3 text-[10px]"
                  >
                    Model peak {compact(curve!.predictedPeakOut)}
                  </text>
                </g>
              ) : null}
              <path d={geom.area} fill={LINE} opacity={0.1} />
              <path d={geom.line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
              {hovered && hover != null ? (
                <g pointerEvents="none">
                  <line
                    x1={geom.xy[hover][0]}
                    x2={geom.xy[hover][0]}
                    y1={PAD.top}
                    y2={height - PAD.bottom}
                    stroke="var(--ink-3, #5a6070)"
                    strokeWidth={1}
                  />
                  <circle
                    cx={geom.xy[hover][0]}
                    cy={geom.xy[hover][1]}
                    r={4}
                    fill={LINE}
                    stroke="var(--paper, #fff)"
                    strokeWidth={2}
                  />
                </g>
              ) : null}
              <rect
                x={PAD.left}
                y={PAD.top}
                width={geom.innerW}
                height={height - PAD.top - PAD.bottom}
                fill="transparent"
                onPointerMove={onMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>
            {hovered && hover != null ? (
              <div
                className="pointer-events-none absolute top-0 z-10 rounded-[6px] bg-ink px-2 py-1 text-[11px] leading-[15px] text-white shadow"
                style={{
                  left: Math.min(Math.max(geom.xy[hover][0] - 60, 0), width - 128),
                  width: 128,
                }}
              >
                <div className="text-white/70">{timeFmt.format(new Date(hovered.t))}</div>
                <div className="font-medium tabular-nums">
                  {hovered.out.toLocaleString("en-US")} out
                  {customers ? (
                    <span className="text-white/70"> · {((hovered.out / customers) * 100).toFixed(1)}%</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      {curve?.peak ? (
        <p className="text-[11px] text-ink-3">
          Peak {curve.peak.out.toLocaleString("en-US")}
          {customers ? ` of ${customers.toLocaleString("en-US")} customers` : ""} on{" "}
          {timeFmt.format(new Date(curve.peak.t))} (Eastern).
        </p>
      ) : null}
    </figure>
  );
}

export default OutageChart;

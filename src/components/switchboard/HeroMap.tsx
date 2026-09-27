"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { TIER_HEX, TIER_LABEL, UTILITY_HEX } from "@/lib/theme";
import type { OverlapTier, Position, Project } from "@/lib/types";

/**
 * The Switchboard's hero: both utilities' real planned projects drawn on a
 * survey-style map of Georgia and South Carolina. Lines draw themselves in,
 * then every place the plans meet appears in rank order. Hover a marker to
 * read it; click to open it in Crosswire.
 */

export interface HeroOverlap {
  id: string;
  tier: OverlapTier;
  rank: number;
  distanceKm: number;
  timelineOverlapMonths: number;
  closestPoints: [Position, Position];
  summary: string;
  cost?: { totalUsd?: number };
}

interface StateFeature {
  properties: { state: string; name: string };
  geometry: { type: "MultiPolygon" | "Polygon"; coordinates: Position[][][] | Position[][] };
}

interface RiverFeature {
  geometry: { type: "LineString" | "MultiLineString"; coordinates: Position[] | Position[][] };
}

const VB = { w: 1000, h: 800 };
// Framed on the border region, where the plans meet; far-west Georgia runs off the edge.
const BOX = { lon0: -85.0, lon1: -78.9, lat0: 30.75, lat1: 35.25 };
const COS = Math.cos((32.8 * Math.PI) / 180);
const K = Math.min(VB.w / ((BOX.lon1 - BOX.lon0) * COS), VB.h / (BOX.lat1 - BOX.lat0));
const OX = (VB.w - (BOX.lon1 - BOX.lon0) * COS * K) / 2;
const OY = (VB.h - (BOX.lat1 - BOX.lat0) * K) / 2;

function xy([lon, lat]: Position): [number, number] {
  return [OX + (lon - BOX.lon0) * COS * K, OY + (BOX.lat1 - lat) * K];
}

function line(coords: Position[]): string {
  return coords.map((c, i) => `${i ? "L" : "M"}${xy(c).map((v) => v.toFixed(1)).join(",")}`).join("");
}

function rings(f: StateFeature): Position[][] {
  return f.geometry.type === "MultiPolygon"
    ? (f.geometry.coordinates as Position[][][]).flat()
    : (f.geometry.coordinates as Position[][]);
}

const TIER_R: Record<OverlapTier, number> = { crossing: 8, row: 7, logistics: 6.5, crew: 4.2 };

export function HeroMap({
  projects,
  overlaps,
  states,
  river,
  liveLine,
  title,
}: {
  projects: Project[];
  overlaps: HeroOverlap[];
  states: StateFeature[];
  river: RiverFeature[];
  liveLine: string | null;
  /** Which pair this is, shown in the top corner. */
  title?: ReactNode;
}) {
  const [hover, setHover] = useState<HeroOverlap | null>(null);

  // Crew-range markers first, crossings last, so the important ones sit on top.
  const ordered = useMemo(() => {
    const order: OverlapTier[] = ["crew", "logistics", "row", "crossing"];
    return [...overlaps].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || b.rank - a.rank);
  }, [overlaps]);

  const lines = projects.filter((p) => p.geometry.type === "LineString");
  const points = projects.filter((p) => p.geometry.type === "Point");
  const riverPaths = river.flatMap((f) =>
    f.geometry.type === "LineString"
      ? [line(f.geometry.coordinates as Position[])]
      : (f.geometry.coordinates as Position[][]).map(line),
  );

  const pos = (o: HeroOverlap) => {
    const [a, b] = o.closestPoints;
    return xy([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  };

  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="h-full w-full" role="img" aria-label="Both utilities' planned projects and the 50 places they meet">
        <defs>
          <pattern id="hm-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#15181E" strokeOpacity="0.045" strokeWidth="1" />
          </pattern>
          <filter id="hm-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        <rect width={VB.w} height={VB.h} fill="url(#hm-grid)" />

        {/* The two states */}
        {states.map((f) => {
          const tint = f.properties.state === "GA" ? UTILITY_HEX.GPC : UTILITY_HEX.DESC;
          return (
            <path
              key={f.properties.state}
              d={rings(f).map((r) => line(r) + "Z").join("")}
              fill={tint}
              fillOpacity={0.045}
              stroke="#15181E"
              strokeOpacity={0.22}
              strokeWidth={1.1}
              strokeLinejoin="round"
              className="hm-fade"
            />
          );
        })}
        <text {...label(-83.7, 32.2)} className="hm-fade">GEORGIA</text>
        <text {...label(-80.05, 34.45)} className="hm-fade">SOUTH CAROLINA</text>

        {/* The Savannah River, the border between them */}
        {riverPaths.map((d, i) => (
          <g key={i}>
            <path d={d} fill="none" stroke="#3B82C4" strokeOpacity={0.18} strokeWidth={9} strokeLinecap="round" filter="url(#hm-soft)" />
            <path d={d} fill="none" stroke="#3B82C4" strokeOpacity={0.75} strokeWidth={1.6} strokeLinecap="round" className="hm-river" pathLength={1} />
          </g>
        ))}
        {riverPaths[0] ? (
          <>
            <path id="hm-river-label" d={riverPaths[0]} fill="none" stroke="none" />
            <text fontSize="13" fill="#3B82C4" fillOpacity="0.9" fontStyle="italic" fontFamily="var(--font-display)" className="hm-fade">
              <textPath href="#hm-river-label" startOffset="46%">
                Savannah River
              </textPath>
            </text>
          </>
        ) : null}

        {/* Planned lines draw themselves in, one utility after the other */}
        {lines.map((p, i) => (
          <path
            key={p.id}
            d={line(p.geometry.coordinates as Position[])}
            fill="none"
            stroke={UTILITY_HEX[p.utility]}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="hm-draw"
            style={{ animationDelay: `${0.35 + (p.utility === "GPC" ? 0.35 : 0) + (i % 17) * 0.045}s` }}
          />
        ))}
        {points.map((p, i) => {
          const [x, y] = xy(p.geometry.coordinates as Position);
          return (
            <rect
              key={p.id}
              x={x - 3.4}
              y={y - 3.4}
              width={6.8}
              height={6.8}
              rx={1.2}
              fill="#FAF8F4"
              stroke={UTILITY_HEX[p.utility]}
              strokeWidth={1.8}
              className="hm-pop"
              style={{ animationDelay: `${0.7 + (i % 20) * 0.04}s`, transformOrigin: `${x}px ${y}px` }}
            />
          );
        })}

        {/* Every place the plans meet, in rank order */}
        {ordered.map((o) => {
          const [x, y] = pos(o);
          const r = TIER_R[o.tier];
          const strong = o.tier !== "crew";
          const delay = 1.6 + (o.rank - 1) * 0.05;
          const active = hover?.id === o.id;
          return (
            <g
              key={o.id}
              className="hm-pop cursor-pointer"
              style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px` }}
              onMouseEnter={() => setHover(o)}
              onMouseLeave={() => setHover((h) => (h?.id === o.id ? null : h))}
            >
              <Link href={`/compare?match=${encodeURIComponent(o.id)}`} aria-label={`Match ${o.rank}: ${o.summary}`}>
                <circle cx={x} cy={y} r={r + 9} fill="transparent" />
                {strong ? (
                  <circle cx={x} cy={y} r={r} fill="none" stroke={TIER_HEX[o.tier]} strokeWidth={1.4} className="hm-ping" style={{ animationDelay: `${delay + 0.6}s`, transformOrigin: `${x}px ${y}px` }} />
                ) : null}
                <circle
                  cx={x}
                  cy={y}
                  r={active ? r + 2 : r}
                  fill={strong ? TIER_HEX[o.tier] : "#FAF8F4"}
                  fillOpacity={strong ? 1 : 0.92}
                  stroke={strong ? "#FAF8F4" : TIER_HEX[o.tier] === "#B3BAC6" ? "#7B8699" : TIER_HEX[o.tier]}
                  strokeWidth={strong ? 2 : 1.4}
                  style={{ transition: "r 150ms ease" }}
                />
                {o.rank <= 3 ? (
                  <g transform={`translate(${x + r + 8},${y - r - 10})`}>
                    <rect width={22} height={20} rx={10} fill="#15181E" />
                    <text x={11} y={14} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="#FAF8F4" fontFamily="var(--font-numbers)">
                      {o.rank}
                    </text>
                  </g>
                ) : null}
              </Link>
            </g>
          );
        })}
      </svg>

      {/* Which pair, and the live storm watch from the National Hurricane Center */}
      <div className="absolute top-4 left-4 flex max-w-[82%] flex-col items-start gap-2">
        {title ? (
          <div className="hm-rise glass flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium text-ink" style={{ animationDelay: "0.3s" }}>
            {title}
          </div>
        ) : null}
        {liveLine ? (
          <div className="hm-rise glass flex max-w-full items-center gap-2 rounded-full py-1.5 pr-3.5 pl-3 text-[12.5px] text-ink-2" style={{ animationDelay: "2.4s" }}>
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-alert opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-alert" />
            </span>
            <span className="font-medium text-ink">Live</span>
            <span className="truncate">{liveLine}</span>
          </div>
        ) : null}
      </div>

      {/* Legend */}
      <div className="hm-rise glass absolute bottom-4 left-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[12px] px-3.5 py-2.5 text-[12.5px] text-ink-2" style={{ animationDelay: "2.2s" }}>
        <Key color={UTILITY_HEX.DESC} label="Dominion Energy SC" />
        <Key color={UTILITY_HEX.GPC} label="Georgia Power" />
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-[#FAF8F4] bg-tier-crossing ring-1 ring-tier-crossing" />
          Where the plans meet
        </span>
      </div>

      {/* Hover card */}
      {hover ? <HoverCard o={hover} at={pos(hover)} /> : null}
    </div>
  );
}

function label(lon: number, lat: number) {
  const [x, y] = xy([lon, lat]);
  return {
    x,
    y,
    textAnchor: "middle" as const,
    fontSize: 14,
    letterSpacing: 5,
    fill: "#15181E",
    fillOpacity: 0.32,
    fontFamily: "var(--font-sans-ui)",
    fontWeight: 600,
  };
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-[3px] w-4 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function HoverCard({ o, at: [x, y] }: { o: HeroOverlap; at: [number, number] }) {
  const left = (x / VB.w) * 100;
  const top = (y / VB.h) * 100;
  const flip = left > 60;
  return (
    <div
      className="glass-strong pointer-events-none absolute z-10 w-[260px] rounded-[14px] px-4 py-3"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: `translate(${flip ? "calc(-100% - 18px)" : "18px"}, -50%)`,
      }}
    >
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <span className="num text-ink">#{o.rank}</span>
        <span className="size-1 rounded-full bg-ink-3" />
        {TIER_LABEL[o.tier]}
        {o.tier !== "crossing" ? <span className="num">· {o.distanceKm.toFixed(1)} km</span> : null}
      </div>
      <p className="mt-1 line-clamp-4 text-[13.5px] leading-[19px] text-ink">{o.summary}</p>
      <div className="mt-2 flex items-center gap-1 text-[12.5px] font-medium text-ink">
        Open in Crosswire <ArrowRight size={13} aria-hidden />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- data */

export interface StormEntry {
  id: string;
  name: string;
  year: number;
  focus: "inland" | "coastal";
  headline: string;
}

export interface HeroData {
  projects: Project[];
  overlaps: HeroOverlap[];
  states: StateFeature[];
  river: RiverFeature[];
  storms: StormEntry[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/data/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Everything the hero needs, straight from the pipeline's files. */
export function useHeroData(): HeroData | null {
  const [data, setData] = useState<HeroData | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      get<Project[]>("plan/projects.json"),
      get<HeroOverlap[]>("plan/overlaps.json"),
      get<{ features: StateFeature[] }>("context/states.geojson"),
      get<{ features: RiverFeature[] }>("context/savannah-river.geojson"),
      get<StormEntry[]>("response/storms.json").catch(() => []),
    ])
      .then(([projects, overlaps, states, river, storms]) => {
        if (alive) setData({ projects, overlaps, states: states.features, river: river.features, storms });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** Every utility the storm model covers, across all replayed storms (read after the hero has drawn). */
export function useStormUtilities(storms: StormEntry[] | undefined): string[] | null {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!storms?.length) return;
    let alive = true;
    Promise.all(
      storms.map((st) =>
        get<{ owners: { id: string; name: string }[] }>(`response/${st.id}/teamup.json`).catch(() => ({ owners: [] })),
      ),
    ).then((all) => {
      if (!alive) return;
      const seen = new Map<string, string>();
      for (const t of all) for (const o of t.owners) seen.set(o.id, o.name);
      setNames([...seen.values()]);
    });
    return () => {
      alive = false;
    };
  }, [storms]);
  return names;
}

interface LiveStorm {
  name: string;
  kind: string;
  distanceKm: number;
  watch: boolean;
}

/** One line about the nearest live Atlantic storm, or null while loading. */
export function useLiveStormLine(): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/storms/live")
      .then((r) => r.json())
      .then((b: { storms: LiveStorm[] | null }) => {
        if (!alive) return;
        if (!b.storms) setLine("Hurricane Center feed unavailable right now");
        else if (!b.storms.length) setLine("No Atlantic storms right now");
        else {
          const s = b.storms[0];
          setLine(
            `${s.kind} ${s.name} is ${s.distanceKm.toLocaleString("en-US")} km from the border${s.watch ? ". Both utilities flagged." : ""}`,
          );
        }
      })
      .catch(() => alive && setLine(null));
    return () => {
      alive = false;
    };
  }, []);
  return line;
}

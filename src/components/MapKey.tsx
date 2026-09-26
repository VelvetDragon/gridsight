"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx, Panel } from "./ui/primitives";

const DESC = "#0E7C7B";
const GPC = "#C2410C";
const RIVER = "#3B82C4";
const INK = "#16181D";

/** 32×16 symbol cells so every key row lines up. */
function Sym({ children }: { children: ReactNode }) {
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" aria-hidden className="shrink-0">
      {children}
    </svg>
  );
}

export const SYMBOLS = {
  river: (
    <Sym>
      <path d="M2 8 L30 8" stroke={RIVER} strokeOpacity="0.2" strokeWidth="8" strokeLinecap="round" />
      <path d="M2 8 L30 8" stroke={RIVER} strokeOpacity="0.7" strokeWidth="1.6" />
    </Sym>
  ),
  existing: (
    <Sym>
      <path d="M2 8 L30 8" stroke={INK} strokeOpacity="0.35" strokeWidth="1" />
    </Sym>
  ),
  gpc: (
    <Sym>
      <path d="M2 8 L30 8" stroke={GPC} strokeWidth="3.5" strokeLinecap="round" />
    </Sym>
  ),
  desc: (
    <Sym>
      <path d="M2 8 L30 8" stroke={DESC} strokeWidth="3.5" strokeLinecap="round" />
    </Sym>
  ),
  solidDashed: (
    <Sym>
      <path d="M2 5 L30 5" stroke="#555C6B" strokeWidth="3" strokeLinecap="round" />
      <path d="M2 11 L30 11" stroke="#555C6B" strokeWidth="3" strokeDasharray="5 3" />
    </Sym>
  ),
  substation: (
    <Sym>
      <circle cx="10" cy="8" r="5" fill={DESC} stroke="#fff" strokeWidth="2" />
      <circle cx="22" cy="8" r="5" fill={GPC} stroke="#fff" strokeWidth="2" />
    </Sym>
  ),
  connector: (
    <Sym>
      <path d="M4 8 L28 8" stroke={INK} strokeWidth="1.6" strokeDasharray="2 2.5" />
      <circle cx="4" cy="8" r="2.6" fill="#fff" stroke={DESC} strokeWidth="1.6" />
      <circle cx="28" cy="8" r="2.6" fill="#fff" stroke={GPC} strokeWidth="1.6" />
    </Sym>
  ),
  rings: (
    <Sym>
      <circle cx="16" cy="8" r="7" fill="none" stroke="#7B8699" strokeWidth="1" />
      <circle cx="16" cy="8" r="3.2" fill="rgba(63,75,96,0.12)" stroke="#3F4B60" strokeWidth="1" />
    </Sym>
  ),
  yard: (
    <Sym>
      <rect x="9" y="1" width="14" height="14" rx="3.5" fill={INK} />
      <rect x="13.5" y="5.5" width="5" height="5" rx="1" fill="#fff" />
    </Sym>
  ),
  pulse: (
    <Sym>
      <circle cx="16" cy="8" r="6.5" fill="none" stroke="#3F4B60" strokeOpacity="0.45" strokeWidth="1.5" />
      <circle cx="16" cy="8" r="3.5" fill="#3F4B60" stroke="#fff" strokeWidth="1.5" />
    </Sym>
  ),
} as const;

export interface KeyRow {
  symbol: ReactNode;
  label: ReactNode;
  note?: ReactNode;
}

export function KeyList({ rows }: { rows: KeyRow[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="pt-0.5">{r.symbol}</span>
          <span className="min-w-0">
            <span className="block text-[13px] leading-[18px] text-ink">{r.label}</span>
            {r.note ? <span className="block text-[12px] leading-4 text-ink-3">{r.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Map legend: a small pill when closed, a full panel when open. */
export function MapKey({ open, onToggle, rows }: { open: boolean; onToggle: () => void; rows: KeyRow[] }) {
  return (
    <Panel
      className={cx(
        "pointer-events-auto flex min-h-0 flex-col overflow-hidden",
        open ? "w-[240px] max-w-full" : "w-fit rounded-full",
      )}
      aria-label="Map legend"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-white/30"
      >
        <span className={cx("eyebrow", open && "min-w-0 flex-1")}>Legend</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cx("shrink-0 text-ink-3 transition-transform duration-200", open ? "rotate-180" : "")}
        />
      </button>
      {open ? (
        <div className="scroll-quiet min-h-0 overflow-y-auto border-t border-hairline px-3 pt-2.5 pb-3">
          <KeyList rows={rows} />
        </div>
      ) : null}
    </Panel>
  );
}

const EXTRA_SYMBOLS = {
  stations: (
    <Sym>
      <rect x="5" y="3" width="10" height="10" rx="1.5" fill={DESC} stroke="#fff" strokeWidth="1.5" />
      <rect x="18.5" y="4.5" width="8" height="8" rx="1" fill="none" stroke={GPC} strokeWidth="2" />
    </Sym>
  ),
  built: (
    <Sym>
      <path d="M2 8 L30 8" stroke={DESC} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M2 8 L30 8" stroke="#FAF8F4" strokeWidth="1.6" strokeLinecap="round" />
    </Sym>
  ),
  direction: (
    <Sym>
      <path d="M2 8 L30 8" stroke={GPC} strokeWidth="3.2" strokeLinecap="round" />
      <path
        d="M13 3.5 L19 8 L13 12.5"
        fill="none"
        stroke="#FAF8F4"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Sym>
  ),
  corridor: (
    <Sym>
      <path d="M5 3 C12 1 24 2 28 6 C31 10 26 14 16 14 C7 14 2 11 3 7 Z" fill="none" stroke={INK} strokeWidth="1.2" />
      {[8, 12, 16, 20, 24].map((x) => (
        <line key={x} x1={x - 3} y1="12" x2={x + 2} y2="4" stroke={INK} strokeOpacity="0.55" strokeWidth="1" />
      ))}
    </Sym>
  ),
  reach: (
    <Sym>
      <path
        d="M3 9 C5 3 14 1 22 3 C30 5 31 12 24 14 C16 16 5 15 3 9 Z"
        fill="none"
        stroke={INK}
        strokeOpacity="0.6"
        strokeWidth="1.2"
        strokeDasharray="4 2.5"
      />
    </Sym>
  ),
};

/** Crosswire's key, in the names of whichever two utilities are open. */
export function planKeyRows(names: { you: string; neighbor: string }, showRiver: boolean): KeyRow[] {
  return [
    ...(showRiver
      ? [
          {
            symbol: SYMBOLS.river,
            label: "Savannah River",
            note: "The border: Georgia to the west, South Carolina to the east.",
          },
        ]
      : []),
    { symbol: SYMBOLS.existing, label: "Existing power lines", note: "Hairlines in the background, for context." },
    { symbol: SYMBOLS.desc, label: `${names.you} planned work`, note: "Your utility." },
    { symbol: SYMBOLS.gpc, label: `${names.neighbor} planned work`, note: "The neighbour." },
    {
      symbol: EXTRA_SYMBOLS.direction,
      label: "Arrow on a line",
      note: "Direction of build, from the first place named to the last.",
    },
    {
      symbol: SYMBOLS.solidDashed,
      label: "Solid: route known · Dashed: approximate",
      note: "Dashed lines are new routes that are not public yet, drawn straight.",
    },
    { symbol: EXTRA_SYMBOLS.built, label: "Hollow line or square", note: "Already built; shown for reference." },
    { symbol: EXTRA_SYMBOLS.stations, label: "Squares", note: "Substation work, in the company's colour." },
    { symbol: SYMBOLS.connector, label: "Dotted link", note: "Where two projects come closest." },
    {
      symbol: EXTRA_SYMBOLS.corridor,
      label: "Hatched corridor",
      note: "The shared zone between the two projects of a pair.",
    },
    {
      symbol: EXTRA_SYMBOLS.reach,
      label: "Dashed outline",
      note: "How far crews can drive from the pair, when known.",
    },
    { symbol: SYMBOLS.yard, label: "Suggested shared staging yard", note: "Where both crews could keep materials." },
    { symbol: SYMBOLS.pulse, label: "Pulsing dot", note: "During playback: both utilities building at once." },
  ];
}

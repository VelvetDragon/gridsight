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

/** Collapsible "What you're seeing" key panel. */
export function MapKey({
  open,
  onToggle,
  rows,
  subtitle,
}: {
  open: boolean;
  onToggle: () => void;
  rows: KeyRow[];
  subtitle: string;
}) {
  return (
    <Panel className="pointer-events-auto flex min-h-0 flex-col overflow-hidden" aria-label="Map key">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-white/30"
      >
        <span className="min-w-0 flex-1">
          <span className="display block text-[17px] leading-6 font-medium text-ink">What you&apos;re seeing</span>
          {open ? <span className="block text-[12px] leading-4 text-ink-3">{subtitle}</span> : null}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={cx("shrink-0 text-ink-3 transition-transform duration-200", open ? "rotate-180" : "")}
        />
      </button>
      {open ? (
        <div className="scroll-quiet min-h-0 overflow-y-auto border-t border-hairline px-5 pt-3.5 pb-4">
          <KeyList rows={rows} />
        </div>
      ) : null}
    </Panel>
  );
}

export const PLAN_KEY: KeyRow[] = [
  {
    symbol: SYMBOLS.river,
    label: "Savannah River",
    note: "The border: Georgia to the west, South Carolina to the east.",
  },
  { symbol: SYMBOLS.existing, label: "Existing power lines", note: "Thin grey lines, for context." },
  { symbol: SYMBOLS.desc, label: "Dominion Energy planned work", note: "South Carolina side." },
  { symbol: SYMBOLS.gpc, label: "Georgia Power planned work", note: "Georgia side." },
  {
    symbol: SYMBOLS.solidDashed,
    label: "Solid: route known · Dashed: approximate",
    note: "Dashed lines are new routes that are not public yet, drawn straight.",
  },
  { symbol: SYMBOLS.substation, label: "Substation work", note: "A dot in the company's colour." },
  {
    symbol: SYMBOLS.connector,
    label: "Closest points of a matching pair",
    note: "A dotted link between the two projects.",
  },
  {
    symbol: SYMBOLS.rings,
    label: "Rings around a selected pair",
    note: "1.6 km: share land · 8 km: share yards · 40 km: share crews.",
  },
  { symbol: SYMBOLS.yard, label: "Suggested shared staging yard", note: "Where both crews could keep materials." },
  { symbol: SYMBOLS.pulse, label: "Pulsing dot", note: "During playback: both companies building at once." },
];

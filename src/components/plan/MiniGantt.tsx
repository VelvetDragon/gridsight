"use client";

import { fmtMonthYear } from "@/lib/format";
import { UTILITY_HEX, UTILITY_NAME } from "@/lib/theme";
import { monthIndex, windowOverlap } from "@/lib/timeline";
import type { Project } from "@/lib/types";

const W = 344;
const LABEL_W = 0;
const ROW_H = 22;
const TOP = 18;

/**
 * Two build windows on a shared month axis with their overlap shaded.
 * Months are counted from Jan 2026 (see lib/timeline).
 */
export function MiniGantt({ desc, gpc, cursorMonth }: { desc: Project; gpc: Project; cursorMonth: number | null }) {
  const rows = [
    { p: desc, color: UTILITY_HEX.DESC, label: UTILITY_NAME.DESC },
    { p: gpc, color: UTILITY_HEX.GPC, label: UTILITY_NAME.GPC },
  ];
  const windows = rows.map((r) => r.p.buildWindow).filter((w): w is [string, string] => !!w);
  if (!windows.length) {
    return <p className="text-[13px] text-ink-3">Build windows were not published for these projects.</p>;
  }
  const starts = windows.map((w) => monthIndex(w[0]));
  const ends = windows.map((w) => monthIndex(w[1]));
  const y0 = Math.floor((Math.min(...starts) - 1) / 12);
  const y1 = Math.ceil((Math.max(...ends) + 1) / 12);
  const m0 = y0 * 12;
  const m1 = Math.max(y1 * 12, m0 + 12);
  const x = (m: number) => LABEL_W + ((m - m0) / (m1 - m0)) * (W - LABEL_W);
  const shared = windowOverlap(desc.buildWindow, gpc.buildWindow);
  const H = TOP + rows.length * (ROW_H + 8) + 2;

  const years: number[] = [];
  for (let y = y0; y <= m1 / 12; y++) years.push(y);

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Build windows of both projects">
        {years.map((y) => (
          <g key={y}>
            <line x1={x(y * 12)} x2={x(y * 12)} y1={12} y2={H} stroke="rgba(20,22,28,0.08)" />
            {y * 12 < m1 ? (
              <text x={x(y * 12) + 3} y={9} fontSize="10" fill="#5A6070" className="num">
                {2026 + y}
              </text>
            ) : null}
          </g>
        ))}
        {shared ? (
          <rect
            x={x(monthIndex(shared[0]))}
            width={Math.max(1, x(monthIndex(shared[1])) - x(monthIndex(shared[0])))}
            y={TOP - 4}
            height={H - TOP + 2}
            fill="rgba(20,22,28,0.07)"
            stroke="rgba(20,22,28,0.22)"
            strokeDasharray="2 2"
          />
        ) : null}
        {rows.map((r, i) => {
          const y = TOP + i * (ROW_H + 8);
          if (!r.p.buildWindow) {
            return (
              <text key={r.label} x={4} y={y + 15} fontSize="11" fill="#5A6070">
                {r.label}: window not published
              </text>
            );
          }
          const a = x(monthIndex(r.p.buildWindow[0]));
          const b = x(monthIndex(r.p.buildWindow[1]));
          return (
            <g key={r.label}>
              <rect x={a} y={y} width={Math.max(3, b - a)} height={ROW_H} rx={5} fill={r.color} />
              <text
                x={a + 7}
                y={y + 15}
                fontSize="11"
                fontWeight={500}
                fill="#fff"
                style={{ display: b - a > 104 ? undefined : "none" }}
              >
                {r.label}
              </text>
            </g>
          );
        })}
        {cursorMonth != null && cursorMonth >= m0 && cursorMonth <= m1 ? (
          <line x1={x(cursorMonth)} x2={x(cursorMonth)} y1={12} y2={H} stroke="#16181D" strokeWidth={1.5} />
        ) : null}
      </svg>
      <figcaption className="flex flex-col gap-0.5 text-[12px] text-ink-3">
        {rows.map((r) => (
          <span key={r.label} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: r.color }} aria-hidden />
            <span className="w-[118px] text-ink-2">{r.label}</span>
            <span className="num">
              {r.p.buildWindow
                ? `${fmtMonthYear(r.p.buildWindow[0])} – ${fmtMonthYear(r.p.buildWindow[1])}`
                : "not published"}
            </span>
          </span>
        ))}
        {shared ? (
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-[2px] border border-dashed border-ink-3 bg-wash-2"
              aria-hidden
            />
            <span className="w-[118px] text-ink-2">Both building</span>
            <span className="num">
              {fmtMonthYear(shared[0])} – {fmtMonthYear(shared[1])}
            </span>
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

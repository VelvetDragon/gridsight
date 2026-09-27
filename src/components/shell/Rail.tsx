"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../ui/primitives";
import { NAV_CLEARANCE } from "./AppShell";

export const RAIL_W = 392;
export const RAIL_COLLAPSED_W = 60;
export const RAIL_GUTTER = 12;

export interface RailSection {
  id: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

/** Width the map should keep clear on the left for the rail. */
export function railInset(open: boolean): number {
  // Phones: an open rail covers the map like a sheet, so the map keeps its full width.
  if (typeof window !== "undefined" && window.innerWidth < 768) return open ? 24 : RAIL_GUTTER + RAIL_COLLAPSED_W + 12;
  return RAIL_GUTTER + (open ? RAIL_W : RAIL_COLLAPSED_W) + 24;
}

/**
 * The single side rail used by the map places. One section shows at a time;
 * collapsed, it becomes a slim strip of icons so the map gets the room.
 */
export function Rail({
  title,
  tagline,
  sections,
  active,
  onActive,
  open,
  onOpen,
  header,
}: {
  title: string;
  tagline: string;
  sections: RailSection[];
  active: string;
  onActive: (id: string) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Always-visible block under the title (for example the utility picker). */
  header?: ReactNode;
}) {
  const current = sections.find((s) => s.id === active) ?? sections[0];
  const top = NAV_CLEARANCE;

  if (!open) {
    return (
      <nav
        aria-label={`${title} sections`}
        className="glass fixed z-30 flex flex-col items-center gap-1 rounded-[16px] py-2"
        style={{ top, left: RAIL_GUTTER, width: RAIL_COLLAPSED_W }}
      >
        <button
          type="button"
          onClick={() => onOpen(true)}
          aria-label="Open the side panel"
          title="Open the side panel"
          className="flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-2 hover:bg-white/60 hover:text-ink"
        >
          <PanelLeftOpen size={18} aria-hidden />
        </button>
        <span className="my-1 h-px w-8 bg-hairline-strong" />
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onActive(s.id);
              onOpen(true);
            }}
            aria-label={s.label}
            title={s.label}
            className={cx(
              "flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors",
              s.id === current?.id ? "bg-white/80 text-ink" : "text-ink-2 hover:bg-white/60 hover:text-ink",
            )}
          >
            {s.icon}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <aside
      aria-label={title}
      className="glass gs-in-left fixed z-30 flex flex-col overflow-hidden rounded-[16px]"
      style={{ top, left: RAIL_GUTTER, bottom: RAIL_GUTTER, width: `min(${RAIL_W}px, calc(100vw - ${RAIL_GUTTER * 2}px))` }}
    >
      <header className="flex items-start gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <h1 className="display text-[24px] leading-8 font-medium text-ink">{title}</h1>
          <p className="mt-0.5 text-[13px] leading-[19px] text-ink-3">{tagline}</p>
        </div>
        <button
          type="button"
          onClick={() => onOpen(false)}
          aria-label="Collapse the side panel"
          title="Collapse the side panel"
          className="-mr-1.5 flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-white/60 hover:text-ink"
        >
          <PanelLeftClose size={16} aria-hidden />
        </button>
      </header>
      {header ? <div className="px-5 pb-3">{header}</div> : null}
      {sections.length > 1 ? (
        <div role="tablist" aria-label={`${title} sections`} className="flex gap-1 border-y border-hairline px-3 py-2">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === current?.id}
              onClick={() => onActive(s.id)}
              className={cx(
                "flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors",
                s.id === current?.id
                  ? "bg-white/85 text-ink shadow-[0_0_0_1px_rgba(20,24,30,0.08)]"
                  : "text-ink-3 hover:text-ink",
              )}
            >
              <span className="text-ink-3">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {current?.content}
      </div>
    </aside>
  );
}

"use client";

import { PanelLeftClose } from "lucide-react";
import type { ReactNode } from "react";
import type { ResponseLayerId } from "../map/responseScene";
import { Eyebrow, IconButton, Panel, ToggleRow } from "../ui/primitives";
import { FAILURE_LEGEND, rgbCss } from "@/lib/theme";

const FAILURE_GRADIENT = `linear-gradient(to right, ${FAILURE_LEGEND.map(
  (s) => `${rgbCss(s.c)} ${Math.round((s.t / 0.5) * 100)}%`,
).join(", ")})`;

function Row({ children }: { children: ReactNode }) {
  return <div className="pb-2 pl-[46px] pr-2 text-[12px] leading-4 text-ink-3">{children}</div>;
}

export function LayersPanel({
  visible,
  onToggle,
  onCollapse,
  hasActuals,
}: {
  visible: Record<ResponseLayerId, boolean>;
  onToggle: (id: ResponseLayerId, on: boolean) => void;
  onCollapse: () => void;
  hasActuals: boolean;
}) {
  return (
    <Panel className="flex w-[300px] flex-col" aria-label="Map layers">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <Eyebrow>Layers</Eyebrow>
        <IconButton label="Collapse panel" onClick={onCollapse} className="-mr-1.5">
          <PanelLeftClose size={16} />
        </IconButton>
      </div>
      <div className="flex flex-col px-2 pb-2">
        <ToggleRow checked={visible.track} onChange={(v) => onToggle("track", v)}>
          Storm track
        </ToggleRow>
        {visible.track ? (
          <Row>
            <span className="flex items-center gap-2">
              <svg width="28" height="10" aria-hidden>
                <line x1="0" y1="5" x2="14" y2="5" stroke="#334155" strokeWidth="3" strokeLinecap="round" />
                <line x1="16" y1="5" x2="28" y2="5" stroke="#334155" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="2 3" />
              </svg>
              past · ahead
              <span className="ml-1 inline-block h-2.5 w-2.5 rounded-full border border-[rgba(180,35,24,0.6)] bg-[rgba(180,35,24,0.1)]" />
              wind field (est.)
            </span>
          </Row>
        ) : null}

        <ToggleRow checked={visible.segments} onChange={(v) => onToggle("segments", v)}>
          Line failure probability
        </ToggleRow>
        {visible.segments ? (
          <Row>
            <div className="h-1.5 w-full rounded-full" style={{ background: FAILURE_GRADIENT }} aria-hidden />
            <div className="num mt-1 flex justify-between text-[11px]">
              <span>0%</span>
              <span>25%</span>
              <span>50%+</span>
            </div>
            <div className="mt-1">Grey until the storm passes.</div>
          </Row>
        ) : null}

        <ToggleRow checked={visible.counties} onChange={(v) => onToggle("counties", v)}>
          County outages
        </ToggleRow>
        {visible.counties ? (
          <Row>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full border-[1.5px] border-[rgba(180,35,24,0.8)]" /> predicted
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full bg-[rgba(180,35,24,0.28)]" />
                {hasActuals ? "actual" : "actual (none)"}
              </span>
            </span>
            <div className="mt-1">Circle area ∝ customers out.</div>
          </Row>
        ) : null}

        <ToggleRow checked={visible.zones} onChange={(v) => onToggle("zones", v)}>
          Repair zones
        </ToggleRow>
        {visible.zones ? (
          <Row>
            <span className="flex items-center gap-2">
              <span className="relative inline-block h-3.5 w-3.5 rounded-full border-2 border-desc">
                <span className="absolute -inset-[3px] rounded-full border-2 border-gpc" />
              </span>
              both utilities nearby
            </span>
          </Row>
        ) : null}

        <ToggleRow checked={visible.yards} onChange={(v) => onToggle("yards", v)}>
          Joint staging yards
        </ToggleRow>
        <ToggleRow checked={visible.vulnerable} onChange={(v) => onToggle("vulnerable", v)}>
          Vulnerable residents
        </ToggleRow>
        {visible.vulnerable ? (
          <Row>
            <span className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#243B6B]" />
              electricity-dependent (HHS emPOWER)
            </span>
          </Row>
        ) : null}
      </div>
    </Panel>
  );
}

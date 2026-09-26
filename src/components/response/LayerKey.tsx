"use client";

import type { ReactNode } from "react";
import { FAILURE_LEGEND, rgbCss } from "@/lib/theme";
import type { ResponseLayerId } from "../map/responseScene";
import { cx } from "../ui/primitives";

const FAILURE_GRADIENT = `linear-gradient(to right, ${FAILURE_LEGEND.map(
  (s) => `${rgbCss(s.c)} ${Math.round((s.t / 0.5) * 100)}%`,
).join(", ")})`;

function Sym({ children }: { children: ReactNode }) {
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" aria-hidden className="shrink-0">
      {children}
    </svg>
  );
}

/** One key row that doubles as a layer switch. */
function KeyToggle({
  checked,
  onChange,
  symbol,
  label,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  symbol: ReactNode;
  label: string;
  children?: ReactNode;
}) {
  return (
    <label className="group flex cursor-pointer gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-white/40">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className={cx("pt-0.5 transition-opacity", !checked && "opacity-30")}>{symbol}</span>
      <span className="min-w-0 flex-1">
        <span className={cx("block text-[13px] leading-[18px]", checked ? "text-ink" : "text-ink-3")}>{label}</span>
        {checked && children ? <span className="mt-0.5 block text-[12px] leading-4 text-ink-3">{children}</span> : null}
      </span>
      <span
        aria-hidden
        className={cx(
          "relative mt-0.5 h-[16px] w-[28px] shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
          checked ? "bg-ink-2" : "bg-[rgba(20,24,30,0.16)]",
        )}
      >
        <span
          className={cx(
            "absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white shadow-[0_1px_2px_rgba(20,24,30,0.3)] transition-transform duration-200",
            checked ? "translate-x-[14px]" : "translate-x-[2px]",
          )}
        />
      </span>
    </label>
  );
}

/** Stormline's map key: each row explains a layer and switches it on or off. */
export function LayerKey({
  visible,
  onToggle,
  hasActuals,
}: {
  visible: Record<ResponseLayerId, boolean>;
  onToggle: (id: ResponseLayerId, on: boolean) => void;
  hasActuals: boolean;
}) {
  return (
    <div>
      <p className="px-5 pt-4 text-[13px] leading-5 text-ink-3">
        Each switch turns a layer on or off. Symbols match the map.
      </p>
      <div className="flex flex-col px-3 py-3">
        <KeyToggle
          checked={visible.track}
          onChange={(v) => onToggle("track", v)}
          label="Storm path and damaging winds"
          symbol={
            <Sym>
              <path d="M2 8 L16 8" stroke="#334155" strokeWidth="3" strokeLinecap="round" />
              <path d="M18 8 L30 8" stroke="#334155" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="2 3" />
            </Sym>
          }
        >
          Solid is where it has been, dashed is where it goes next. The red ring is roughly where winds were strong
          enough to do damage (estimate).
        </KeyToggle>

        <KeyToggle
          checked={visible.segments}
          onChange={(v) => onToggle("segments", v)}
          label="Power lines: chance of breaking"
          symbol={
            <Sym>
              <rect x="2" y="6" width="28" height="4" rx="2" style={{ fill: "url(#fg)" }} />
              <defs>
                <linearGradient id="fg">
                  <stop offset="0" stopColor="#E2DCCC" />
                  <stop offset="0.5" stopColor="#D68C34" />
                  <stop offset="1" stopColor="#601212" />
                </linearGradient>
              </defs>
            </Sym>
          }
        >
          <span className="mb-1 block h-1.5 w-full rounded-full" style={{ background: FAILURE_GRADIENT }} />
          <span className="flex justify-between">
            <span>unlikely</span>
            <span>
              <span className="num">50%</span> or more
            </span>
          </span>
          Lines stay grey until the storm has passed them.
        </KeyToggle>

        <KeyToggle
          checked={visible.counties}
          onChange={(v) => onToggle("counties", v)}
          label="Homes without power, by county"
          symbol={
            <Sym>
              <circle cx="11" cy="8" r="6" fill="none" stroke="rgba(180,35,24,0.85)" strokeWidth="1.5" />
              <circle cx="23" cy="8" r="6" fill="rgba(180,35,24,0.28)" />
            </Sym>
          }
        >
          Outline: what the model predicted. Filled: what actually happened
          {hasActuals ? "" : " (no outage records for this storm)"}. Bigger circle, more homes out.
        </KeyToggle>

        <KeyToggle
          checked={visible.zones}
          onChange={(v) => onToggle("zones", v)}
          label="Repair zones, numbered by priority"
          symbol={
            <Sym>
              <circle cx="16" cy="8" r="6.5" fill="rgba(51,65,85,0.1)" stroke="#334155" strokeWidth="1" />
              <circle cx="16" cy="8" r="7.3" fill="none" stroke="#0E7C7B" strokeWidth="1.2" />
            </Sym>
          }
        >
          P1 is where crews should go first. A teal and orange rim means both companies will be working there.
        </KeyToggle>

        <KeyToggle
          checked={visible.yards}
          onChange={(v) => onToggle("yards", v)}
          label="Shared staging yards"
          symbol={
            <Sym>
              <rect x="9" y="1" width="14" height="14" rx="3.5" fill="#16181D" />
              <rect x="13.5" y="5.5" width="5" height="5" rx="1" fill="#fff" />
            </Sym>
          }
        >
          Where both companies could keep crews and materials. Dotted lines show the zones each one serves.
        </KeyToggle>

        <KeyToggle
          checked={visible.vulnerable}
          onChange={(v) => onToggle("vulnerable", v)}
          label="Vulnerable residents"
          symbol={
            <Sym>
              <circle cx="16" cy="8" r="4.5" fill="#243B6B" stroke="#fff" strokeWidth="1.3" />
            </Sym>
          }
        >
          People who rely on powered medical equipment, by ZIP code (HHS emPOWER).
        </KeyToggle>
      </div>
    </div>
  );
}

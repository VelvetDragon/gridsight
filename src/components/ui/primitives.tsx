"use client";

import type { ComponentProps, ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OverlapTier, UtilityId } from "@/lib/types";
import { TIER_HEX, TIER_LABEL, UTILITY_HEX } from "@/lib/theme";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Floating glass surface. */
export function Panel({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("glass rounded-[12px] text-ink", className)} {...rest}>
      {children}
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("eyebrow", className)}>{children}</div>;
}

export function Divider({ className }: { className?: string }) {
  return <div role="separator" className={cx("h-px bg-hairline", className)} />;
}

export function UtilityDot({ utility, size = 8 }: { utility: UtilityId; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: UTILITY_HEX[utility] }}
    />
  );
}

export function TierSwatch({ tier, size = 8 }: { tier: OverlapTier; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-[2px]"
      style={{ width: size, height: size, background: TIER_HEX[tier] }}
    />
  );
}

export function TierChip({ tier, className }: { tier: OverlapTier; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full border border-hairline bg-white/70 px-2 text-[12px] font-medium text-ink-2",
        className,
      )}
    >
      <TierSwatch tier={tier} size={7} />
      {TIER_LABEL[tier]}
    </span>
  );
}

export function Chip({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "quiet" | "alert";
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[12px] font-medium",
        tone === "neutral" && "border border-hairline bg-white/70 text-ink-2",
        tone === "quiet" && "bg-wash-2 text-ink-2",
        tone === "alert" && "border border-[rgba(180,35,24,0.22)] bg-[rgba(180,35,24,0.06)] text-alert",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Hover/focus tooltip rendered in a portal, so it is never clipped by a
 * scrolling glass panel. The text is also always available to assistive tech
 * through a visually hidden description.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
  width = 240,
  focusable = true,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
  width?: number;
  /** Set false when the trigger already sits inside a focusable control. */
  focusable?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const show = () => setRect(ref.current?.getBoundingClientRect() ?? null);
  const hide = () => setRect(null);

  let left = 0;
  if (rect) {
    const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
    left = Math.max(8, Math.min(vw - width - 8, rect.left + rect.width / 2 - width / 2));
  }

  return (
    <span
      ref={ref}
      className={cx("inline-flex rounded-full", className)}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={id}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={focusable ? show : undefined}
      onBlur={focusable ? hide : undefined}
    >
      {children}
      <span id={id} className="sr-only">
        {content}
      </span>
      {rect
        ? createPortal(
            <span
              role="tooltip"
              aria-hidden
              style={{
                position: "fixed",
                left,
                top: side === "top" ? rect.top - 8 : rect.bottom + 8,
                transform: side === "top" ? "translateY(-100%)" : undefined,
                width,
              }}
              className="pointer-events-none z-[100] rounded-[8px] bg-ink px-2.5 py-2 text-[12px] leading-[17px] font-normal text-white/90 shadow-[var(--shadow-float)]"
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-ink-2 transition-colors duration-150 hover:bg-wash-2 hover:text-ink disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({
  className,
  variant = "secondary",
  children,
  ...rest
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors duration-150 disabled:opacity-40",
        variant === "primary" && "bg-ink text-white hover:bg-[#2a2e37]",
        variant === "secondary" && "border border-hairline-strong bg-white/80 text-ink hover:bg-white",
        variant === "ghost" && "text-ink-2 hover:bg-wash-2 hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  hint?: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-8 items-center rounded-[9px] bg-wash-2 p-[3px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-[26px] rounded-[7px] px-3 text-[13px] font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45",
              active
                ? "bg-white text-ink shadow-[0_1px_2px_rgba(20,22,28,0.12),0_0_0_1px_rgba(20,22,28,0.06)]"
                : "text-ink-3 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] text-ink-2">
          {label}
        </label>
        <span className="num text-[12px] text-ink-3">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--fill" as string]: `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** Checkbox row styled as a quiet switch, for layer and filter toggles. */
export function ToggleRow({
  checked,
  onChange,
  children,
  trailing,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <label className="group flex h-8 cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-[13px] text-ink transition-colors duration-150 hover:bg-wash">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={cx(
          "relative h-[16px] w-[28px] shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
          checked ? "bg-ink-2" : "bg-[rgba(20,22,28,0.16)]",
        )}
      >
        <span
          className={cx(
            "absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white shadow-[0_1px_2px_rgba(20,22,28,0.3)] transition-transform duration-200",
            checked ? "translate-x-[14px]" : "translate-x-[2px]",
          )}
        />
      </span>
      <span className={cx("flex min-w-0 flex-1 items-center gap-2", !checked && "text-ink-3")}>{children}</span>
      {trailing}
    </label>
  );
}

export function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-0.5", className)}>
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className="num text-[18px] leading-6 font-medium text-ink">{value}</span>
      {sub ? <span className="text-[12px] text-ink-3">{sub}</span> : null}
    </div>
  );
}

"use client";

import { ArrowLeftRight } from "lucide-react";
import { TIER_LABEL, TIER_RANGE, TIERS, UTILITY_HEX } from "@/lib/theme";
import type { OverlapTier } from "@/lib/types";
import type { CrosswireState } from "../crosswire/useCrosswire";
import { UtilityCombo } from "../crosswire/UtilityPicker";
import { forgetFoundUtility, isFoundUtility } from "@/lib/catalog";
import { fmtMoney } from "../plan/Savings";
import { cx, TierSwatch } from "../ui/primitives";

/**
 * The board's top strip: which two utilities, then the four kinds of pair as
 * counts you can switch on and off, then the money for what is shown.
 */
export function BoardHeader({ cw, onFind }: { cw: CrosswireState; onFind: (() => void) | null }) {
  const utilities = cw.catalog?.utilities ?? [];
  // Added utilities can be removed; the page reloads on the default pair.
  const removable = {
    can: isFoundUtility,
    remove: (id: string) => {
      forgetFoundUtility(id);
      window.location.replace(`${window.location.origin}/compare`);
    },
  };
  const you = utilities.find((u) => u.id === cw.pairIds?.[0]) ?? null;
  const neighbor = utilities.find((u) => u.id === cw.pairIds?.[1]) ?? null;

  const counts = new Map<OverlapTier, number>();
  for (const o of cw.candidates) counts.set(o.tier, (counts.get(o.tier) ?? 0) + 1);
  const { savings } = cw;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {cw.catalog ? (
        <div className="flex min-w-0 items-center gap-1">
          <div className="w-[230px] min-w-0">
            <UtilityCombo
              label="Your utility"
              swatch={UTILITY_HEX.DESC}
              value={you}
              options={utilities}
              exclude={neighbor?.id ?? null}
              onChange={(id) => neighbor && cw.setPair(id, neighbor.id)}
              onFind={null}
              onRemove={removable}
              compact
            />
          </div>
          <button
            type="button"
            onClick={() => you && neighbor && cw.setPair(neighbor.id, you.id)}
            aria-label="Swap the two utilities"
            title="Swap"
            className="flex h-9 w-8 shrink-0 items-center justify-center rounded-[10px] text-ink-3 hover:bg-white/70 hover:text-ink"
          >
            <ArrowLeftRight size={15} aria-hidden />
          </button>
          <div className="w-[230px] min-w-0">
            <UtilityCombo
              label="Neighbour"
              swatch={UTILITY_HEX.GPC}
              value={neighbor}
              options={utilities}
              exclude={you?.id ?? null}
              onChange={(id) => you && cw.setPair(you.id, id)}
              onFind={onFind}
              onRemove={removable}
              compact
            />
          </div>
        </div>
      ) : (
        <div className="gs-skeleton h-9 w-[500px] max-w-full" />
      )}

      <div role="group" aria-label="Show pairs that" className="flex flex-wrap items-center gap-1.5">
        {TIERS.map((t) => {
          const on = cw.tiers.has(t);
          const n = counts.get(t) ?? 0;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => cw.toggleTier(t)}
              title={`${TIER_RANGE[t]}. Click to ${on ? "hide" : "show"} these.`}
              className={cx(
                "flex h-9 items-center gap-2 rounded-[10px] border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
                on
                  ? "border-hairline-strong bg-white/85 text-ink shadow-[0_1px_2px_rgba(20,24,30,0.06)]"
                  : "border-dashed border-hairline-strong bg-transparent text-ink-3",
              )}
            >
              <span className={cx(!on && "opacity-35")}>
                <TierSwatch tier={t} size={8} />
              </span>
              <span className="num text-[15px] font-semibold">{cw.plan ? n : "–"}</span>
              {TIER_LABEL[t]}
            </button>
          );
        })}
      </div>

      <p className="ml-auto flex items-baseline gap-2 whitespace-nowrap">
        <span className="text-[12px] text-ink-3">
          Could save on <span className="num">{savings.count}</span> pairs, estimated
        </span>
        <span className="display num text-[22px] leading-7 font-medium text-ink">
          {savings.count > 0 ? fmtMoney(savings.total) : "–"}
        </span>
      </p>
    </div>
  );
}

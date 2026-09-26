"use client";

import { useEffect, useState } from "react";
import type { LiveStorm } from "@/app/api/storms/live/route";

/** One live sentence from the National Hurricane Center feed, above the storm replays. */
export function StormWatch() {
  const [storms, setStorms] = useState<LiveStorm[] | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/api/storms/live")
      .then((r) => r.json())
      .then((d: { storms: LiveStorm[] | null }) => alive && setStorms(d.storms))
      .catch(() => alive && setStorms(null));
    return () => {
      alive = false;
    };
  }, []);

  if (storms === undefined) return <p className="text-[13px] text-ink-3">Checking the National Hurricane Center…</p>;
  if (storms === null) return null;

  const threat = storms.filter((s) => s.watch);
  const others = storms.filter((s) => !s.watch);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-ink-3">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${threat.length ? "bg-alert" : "bg-[#3F8F5B]"}`}
        />
        Live from the National Hurricane Center
      </div>
      {threat.length ? (
        <p className="text-[14px] leading-[21px] text-ink">
          {threat.map((s, i) => (
            <span key={s.id}>
              {i > 0 ? " " : ""}
              <b>
                {s.kind} {s.name}
              </b>{" "}
              is about <b>{s.distanceKm.toLocaleString()} km</b> from the Savannah River border
              {s.moving ? `, moving ${s.moving}` : ""}. Both utilities should start planning shared crews and yards.
            </span>
          ))}
        </p>
      ) : (
        <p className="text-[14px] leading-[21px] text-ink">
          {storms.length === 0
            ? "No active Atlantic storms right now. Replay a past storm below to see how MrGridy plans ahead."
            : `${others.map((s) => `${s.kind} ${s.name}`).join(" and ")} ${
                others.length === 1 ? "is" : "are"
              } active in the Atlantic, but none threatens Georgia or South Carolina right now.`}
        </p>
      )}
    </div>
  );
}

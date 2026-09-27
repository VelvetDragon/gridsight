"use client";

import { useEffect, useState } from "react";
import type { LiveStorm } from "@/app/api/storms/live/route";
import { loadTracks, SAMPLE_STORM, stormTwins, type LiveStormLike, type StormTwin } from "@/lib/stormTwin";

/** One live sentence from the National Hurricane Center feed, above the storm replays. */
export function StormWatch({ onOpen, stormIds }: { onOpen?: (id: string) => void; stormIds?: string[] }) {
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
      {onOpen && stormIds?.length ? <TwinBlock live={storms[0] ?? null} ids={stormIds} onOpen={onOpen} /> : null}
    </div>
  );
}

/** Storm Twin: the replayed storm most like the nearest live storm (or a labelled sample). */
function TwinBlock({ live, ids, onOpen }: { live: LiveStorm | null; ids: string[]; onOpen: (id: string) => void }) {
  const [sample, setSample] = useState(false);
  const [twin, setTwin] = useState<{ key: string; t: StormTwin } | null>(null);
  const subject: (LiveStormLike & { sample?: boolean }) | null = sample
    ? SAMPLE_STORM
    : live
      ? { name: `${live.kind} ${live.name}`, position: live.position, windKt: live.windKt, headingDeg: live.headingDeg }
      : null;
  const key = subject ? `${subject.name}:${ids.join()}` : "";

  useEffect(() => {
    if (!subject) return;
    let alive = true;
    loadTracks(ids).then(({ storms, ids: got }) => {
      const best = stormTwins(subject, storms, got)[0];
      if (alive && best) setTwin({ key, t: best });
    });
    return () => {
      alive = false;
    };
    // subject is derived from key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const t = twin?.key === key ? twin.t : null;
  return (
    <div className="mt-2 rounded-[10px] border border-hairline bg-white/60 px-3 py-2.5">
      <div className="text-[12px] font-medium text-ink-3">Storm Twin</div>
      {subject && t ? (
        <>
          <p className="mt-0.5 text-[13px] leading-[19px] text-ink">
            {subject.name} looks most like <b>{t.name} {t.year}</b> ({t.match} match: {t.distanceKm} km from where {t.name} was,{" "}
            {Math.abs(t.windDiffKt)} kt {t.windDiffKt >= 0 ? "weaker" : "stronger"}
            {t.headingDiffDeg != null ? `, ${t.headingDiffDeg}° off its heading` : ""}).
            {t.hoursToBorder != null
              ? ` From that point, ${t.name} reached Georgia and South Carolina ${t.hoursToBorder} hours later.`
              : ""}
          </p>
          <button
            type="button"
            onClick={() => onOpen(t.stormId)}
            className="mt-1.5 text-[13px] font-medium text-ink underline underline-offset-2"
          >
            Open {t.name}&apos;s plan
          </button>
        </>
      ) : subject ? (
        <p className="mt-0.5 text-[13px] text-ink-3">Comparing with 14 past storms…</p>
      ) : null}
      <button
        type="button"
        onClick={() => setSample((v) => !v)}
        className="mt-1.5 block text-[12px] text-ink-3 underline underline-offset-2 hover:text-ink"
      >
        {sample ? "Back to the live storm" : "Try it with a sample hurricane near the Bahamas"}
      </button>
    </div>
  );
}

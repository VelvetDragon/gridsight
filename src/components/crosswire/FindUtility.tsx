"use client";

import { useState, type FormEvent } from "react";
import type { CrosswireState } from "./useCrosswire";

/** "Find another utility": look up a utility's public plan by name. */
export function FindUtility({ cw, onClose }: { cw: CrosswireState; onClose: () => void }) {
  const [q, setQ] = useState(cw.finding?.query ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) cw.find(q.trim());
  };
  if (cw.finding?.status === "working") {
    return (
      <div className="rounded-[12px] border border-hairline bg-white/60 p-3" role="status" aria-live="polite">
        <p className="text-[14px] text-ink">Looking for {cw.finding.query}&apos;s public plan…</p>
        <p className="mt-1 text-[12px] text-ink-3">
          Reading filings and placing each project on the map. This can take a minute.
        </p>
        <div className="gs-skeleton mt-3 h-1.5 w-full" />
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="rounded-[12px] border border-hairline bg-white/60 p-3">
      <label className="text-[13px] font-medium text-ink" htmlFor="find-utility">
        Which utility should we look up?
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="find-utility"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Entergy Mississippi"
          className="h-9 min-w-0 flex-1 rounded-[8px] border border-hairline-strong bg-white px-2.5 text-[14px] outline-none focus:border-ink-2"
        />
        <button type="submit" className="h-9 rounded-[8px] bg-ink px-3 text-[13px] font-medium text-white">
          Find
        </button>
      </div>
      {cw.finding?.status === "failed" ? <p className="mt-2 text-[12px] text-alert">{cw.finding.error}</p> : null}
      <button type="button" onClick={onClose} className="mt-2 text-[12px] text-ink-3 underline underline-offset-2">
        Never mind
      </button>
    </form>
  );
}

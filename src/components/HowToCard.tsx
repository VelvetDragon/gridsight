"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Mode } from "./map/MapStage";
import { Button, Panel } from "./ui/primitives";

const STORAGE_KEY = "gridsight.howto.dismissed.v1";

type ExploreMode = Exclude<Mode, "story">;

const STEPS: Record<ExploreMode, { title: string; body: string }[]> = {
  plan: [
    {
      title: "Two companies, one river",
      body: "Teal is Dominion Energy in South Carolina, orange is Georgia Power in Georgia. Each line or dot is a project they plan to build.",
    },
    {
      title: "Pick a pair from the list",
      body: "The list on the left ranks pairs of projects that sit close together. Click one and the map zooms to it.",
    },
    {
      title: "Read the rings, then press play",
      body: "Rings show what they could share: land within 1.6 km, yards within 8 km, crews within 40 km. Play the timeline to see when they build.",
    },
  ],
  response: [
    {
      title: "Replay a real hurricane",
      body: "The dark line is the storm's path and the red ring is roughly where winds were damaging. Press play at the bottom.",
    },
    {
      title: "Watch the lines change colour",
      body: "Once the storm passes, power lines turn from sand to deep red by their chance of breaking.",
    },
    {
      title: "See where to send crews",
      body: "Circles show homes without power (outline: predicted, fill: what happened). Numbered zones are where crews should go first.",
    },
  ],
};

// localStorage can be missing or throw (private mode, blocked site data).
let memoryDismissed = false;
let reopened = false;
const listeners = new Set<() => void>();

// ?intro=0 skips the card for this visit (demo links, screenshots).
const skipByUrl = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("intro") === "0";

function readDismissed(): boolean {
  if (skipByUrl && !reopened) return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1" || memoryDismissed;
  } catch {
    return memoryDismissed;
  }
}

function writeDismissed(value: boolean) {
  if (!value) reopened = true;
  memoryDismissed = value;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether the first-visit card is showing, plus open/dismiss actions. */
export function useHowTo() {
  // Server snapshot says "dismissed" so the card never flashes during hydration.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  const open = useCallback(() => writeDismissed(false), []);
  const dismiss = useCallback(() => writeDismissed(true), []);
  return { visible: !dismissed, open, dismiss };
}

export function HowToCard({ mode, onDismiss }: { mode: ExploreMode; onDismiss: () => void }) {
  const steps = STEPS[mode];
  return (
    <Panel className="glass-strong gs-fade w-[440px] p-6" role="dialog" aria-label="How to read this map">
      <h2 className="display text-[22px] leading-7 font-medium">How to read this map</h2>
      <p className="mt-1 text-[13px] text-ink-3">Three things to know. You can reopen this with the ? button.</p>
      <ol className="mt-5 flex flex-col gap-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3.5">
            <span className="display flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline-strong bg-white/70 text-[14px] font-medium">
              {i + 1}
            </span>
            <span>
              <span className="block text-[14px] leading-5 font-semibold text-ink">{s.title}</span>
              <span className="mt-0.5 block text-[13px] leading-5 text-ink-2">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex justify-end">
        <Button variant="primary" className="h-9 px-4" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Panel>
  );
}

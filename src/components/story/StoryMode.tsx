"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import type { PlanData, ResponseData } from "@/lib/data";
import type { RankedOverlap } from "@/lib/ranking";
import { perCustomer, type SavingsSummary } from "@/lib/savings";
import { cx } from "../ui/primitives";
import { HONEST_NOTE, SavingsBar, SavingsHeadline } from "../plan/Savings";
import { RestorationChart } from "../response/TimeSaved";
import { projectsInBuildOrder, revealedCount } from "../map/storyScene";
import { CHAPTER_COUNT, CHAPTER_TITLES, chapterText } from "./chapters";

export interface StoryModeProps {
  chapter: number;
  progress: number;
  onGo: (n: number) => void;
  onNext: () => void;
  onBack: () => void;
  onExplore: () => void;
  plan: PlanData | null;
  ranked: RankedOverlap[];
  response: ResponseData | null;
  savings: SavingsSummary;
  wordmark: React.ReactNode;
}

/** Guided landing: one caption at a time over the full-bleed map. */
export function StoryMode(props: StoryModeProps) {
  const { chapter, progress, onGo, onNext, onBack, onExplore, plan, ranked, response, savings } = props;
  const text = chapterText(chapter, plan, ranked, response);
  const last = chapter === CHAPTER_COUNT - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return;
      const onButton = t?.tagName === "BUTTON" || t?.tagName === "A";
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && !onButton)) {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onBack]);

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Chrome: wordmark and the way out. */}
      <div className="absolute top-4 right-4 left-4 flex items-center justify-between">
        <div className="glass pointer-events-auto flex h-12 items-center rounded-[14px] px-4">{props.wordmark}</div>
        <button
          type="button"
          onClick={onExplore}
          className="glass pointer-events-auto flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-ink transition-colors hover:bg-white/80"
        >
          Skip to explore
          <ArrowRight size={15} aria-hidden />
        </button>
      </div>

      {/* One caption card. */}
      <section
        key={chapter}
        aria-live="polite"
        className="glass-strong gs-rise pointer-events-auto absolute bottom-[72px] left-8 w-[min(560px,calc(100vw-64px))] rounded-[18px] px-7 pt-6 pb-5"
      >
        <div className="flex items-center justify-between text-[13px] text-ink-3">
          <span className="font-medium text-ink-2">{CHAPTER_TITLES[chapter]}</span>
          <span className="tabular-nums">
            {chapter + 1} / {CHAPTER_COUNT}
          </span>
        </div>

        {chapter === 4 ? (
          <div className="mt-3">
            <p className="display text-[24px] leading-8 font-medium text-ink">{text.headline}</p>
            <div className="mt-3">
              <SavingsHeadline summary={savings} size="xl" />
            </div>
            <div className="mt-4">
              <SavingsBar land={savings.land} yard={savings.yard} crew={savings.crew} />
            </div>
            <p className="mt-3 text-[14px] text-ink-2">
              ≈ <span className="num">${perCustomer(savings.total).toFixed(2)}</span> per customer of both companies,
              one-time (illustrative).
            </p>
            <p className="mt-2 text-[12px] leading-4 text-ink-3">Estimate. {HONEST_NOTE}</p>
          </div>
        ) : (
          <>
            <h1
              className={cx(
                "display mt-3 font-medium text-balance text-ink",
                text.headline.length > 90 ? "text-[26px] leading-[34px]" : "text-[30px] leading-[38px]",
              )}
            >
              {text.headline}
            </h1>
            {text.support ? <p className="mt-3 text-[15px] leading-[23px] text-ink-2">{text.support}</p> : null}
          </>
        )}

        {chapter === 1 && plan ? <LiveCounter plan={plan} progress={progress} /> : null}

        {chapter === 6 && response?.mutualAid ? (
          <div className="mt-4">
            <RestorationChart
              separate={response.mutualAid.scenarios.separate}
              coordinated={response.mutualAid.scenarios.coordinated}
              height={110}
            />
          </div>
        ) : null}

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={chapter === 0}
            className="flex h-10 items-center gap-1.5 rounded-full border border-hairline-strong bg-white/60 px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-white disabled:opacity-35"
          >
            <ArrowLeft size={15} aria-hidden />
            Back
          </button>
          {last ? (
            <>
              <button
                type="button"
                onClick={onExplore}
                className="flex h-10 items-center rounded-full bg-ink px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#2a2e37]"
              >
                Explore the map
              </button>
              <button
                type="button"
                onClick={() => onGo(0)}
                className="flex h-10 items-center rounded-full px-4 text-[14px] font-medium text-ink-2 hover:bg-white/60"
              >
                Replay the story
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onNext}
              className="flex h-10 items-center gap-1.5 rounded-full bg-ink px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#2a2e37]"
            >
              Next
              <ArrowRight size={15} aria-hidden />
            </button>
          )}
          <span className="ml-auto text-[12px] text-ink-3">← → or space</span>
        </div>
      </section>

      {/* Progress dots. */}
      <nav
        aria-label="Story chapters"
        className="glass pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1.5"
      >
        {CHAPTER_TITLES.map((title, i) => (
          <button
            key={title}
            type="button"
            onClick={() => onGo(i)}
            aria-label={`Chapter ${i + 1}: ${title}`}
            aria-current={i === chapter ? "step" : undefined}
            className="flex h-6 items-center justify-center px-1"
          >
            <span
              className={cx(
                "block h-2 rounded-full transition-all duration-300",
                i === chapter ? "w-6 bg-ink" : i < chapter ? "w-2 bg-ink-3" : "w-2 bg-[rgba(20,24,30,0.2)]",
              )}
            />
          </button>
        ))}
      </nav>
    </div>
  );
}

function LiveCounter({ plan, progress }: { plan: PlanData; progress: number }) {
  const ordered = projectsInBuildOrder(plan.projects);
  const shown = ordered.slice(0, revealedCount(ordered.length, progress));
  const d = shown.filter((p) => p.utility === "DESC").length;
  const g = shown.filter((p) => p.utility === "GPC").length;
  const year = shown.at(-1)?.inService?.slice(0, 4);
  return (
    <div className="mt-4 flex items-center gap-5 text-[14px]">
      <span className="flex items-center gap-2">
        <span className="h-3 w-[3px] rounded-full bg-desc" aria-hidden />
        <span className="font-semibold text-desc">Dominion</span> <span className="num text-ink">{d}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="h-3 w-[3px] rounded-full bg-gpc" aria-hidden />
        <span className="font-semibold text-gpc">Georgia Power</span> <span className="num text-ink">{g}</span>
      </span>
      {year ? <span className="ml-auto text-ink-3 tabular-nums">through {year}</span> : null}
    </div>
  );
}

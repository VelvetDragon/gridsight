"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MARK_PATH, SPARK } from "./Wordmark";

const SOUND_KEY = "mrgridy.sound.v1";
const SPARK_AUDIO = "/audio/spark.mp3";
/** Total length of the intro, ms. */
export const SPLASH_MS = 2600;

function readSound(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * Intro: the power line draws itself as a wave, a spark runs along it and
 * "ignites" the wordmark (a short flicker, arc and glow). Skippable with any
 * click or key. Sound is off unless the viewer turns it on, and only plays if
 * /audio/spark.mp3 exists. Reduced motion shows the finished logo briefly.
 */
export function Splash({ onDone }: { onDone: () => void }) {
  const [sound, setSound] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const finish = () => {
      if (done.current) return;
      done.current = true;
      onDone();
    };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(finish, reduce ? 700 : SPLASH_MS);
    const skip = (e: KeyboardEvent) => {
      if (e.key === "Tab") return;
      finish();
    };
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", skip);
    };
  }, [onDone]);

  // Only offer sound when the file exists.
  useEffect(() => {
    let alive = true;
    fetch(SPARK_AUDIO, { method: "HEAD" })
      .then((r) => {
        if (!alive || !r.ok) return;
        audio.current = new Audio(SPARK_AUDIO);
        audio.current.volume = 0.5;
        setAudioReady(true);
        setSound(readSound());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The spark reaches the wordmark about 1.5 s in.
  useEffect(() => {
    if (!audioReady || !sound) return;
    const t = window.setTimeout(() => {
      audio.current?.play().catch(() => {});
    }, 1450);
    return () => window.clearTimeout(t);
  }, [audioReady, sound]);

  const toggleSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !sound;
    setSound(next);
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (next) audio.current?.play().catch(() => {});
  };

  return (
    <div
      className="gs-splash fixed inset-0 z-[200] flex cursor-pointer flex-col items-center justify-center bg-paper"
      onClick={() => {
        if (!done.current) {
          done.current = true;
          onDone();
        }
      }}
      role="presentation"
    >
      <div className="flex items-center gap-5">
        <svg width="190" height="116" viewBox="0 0 36 22" aria-hidden className="overflow-visible">
          <defs>
            <filter id="gs-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.1" />
            </filter>
          </defs>
          <path
            id="gs-mark-path"
            className="gs-splash-line"
            d={MARK_PATH}
            fill="none"
            stroke="#15181E"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
          />
          {/* The spark travelling along the line. */}
          <g className="gs-splash-spark">
            <circle r="2.4" fill="#F2B544" opacity="0.55" filter="url(#gs-glow)" />
            <circle r="1.1" fill="#FFF4D6" />
            <animateMotion
              dur="0.75s"
              begin="0.95s"
              fill="freeze"
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.4 0 0.2 1"
            >
              <mpath href="#gs-mark-path" />
            </animateMotion>
          </g>
          {/* It comes to rest as the mark's spark. */}
          <g className="gs-splash-rest">
            <circle cx={SPARK.x} cy={SPARK.y} r="2.6" fill="#F2B544" opacity="0.3" />
            <circle cx={SPARK.x} cy={SPARK.y} r="1.35" fill="#D98A1A" />
          </g>
          {/* A tiny arc jumping to the wordmark. */}
          <path
            className="gs-splash-arc"
            d="M33.5 8 l1.6 -1.4 l-0.6 2.1 l1.9 -1.2"
            fill="none"
            stroke="#E0A526"
            strokeWidth="0.55"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="gs-splash-word display text-[64px] leading-none font-semibold text-ink">
          <span className="font-normal">Mr.</span>Gridy
        </span>
      </div>
      <p className="gs-splash-tag mt-6 text-[15px] text-ink-3">Where neighbouring grids meet.</p>

      <div className="absolute right-5 bottom-5 flex items-center gap-3 text-[12px] text-ink-3">
        <span>Click or press any key to skip</span>
        {audioReady ? (
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={sound}
            aria-label={sound ? "Turn sound off" : "Turn sound on"}
            className="flex h-8 items-center gap-1.5 rounded-full border border-hairline-strong bg-white/60 px-3 text-ink-2 hover:bg-white"
          >
            {sound ? <Volume2 size={14} aria-hidden /> : <VolumeX size={14} aria-hidden />}
            {sound ? "Sound on" : "Sound off"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

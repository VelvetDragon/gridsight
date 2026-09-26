"use client";

/**
 * "Listen to the storm briefing" for Response mode, in English or Spanish.
 *
 *   <StormBriefingButton stormId={stormId} />
 *
 * Plays public/audio/briefing-<stormId>.mp3 (or briefing-<stormId>-es.mp3),
 * voiced with ElevenLabs. The transcript is one click away; without audio the
 * button becomes "Read the storm briefing". Renders nothing if the storm has
 * no briefing at all.
 */
import { useState } from "react";
import { FileText, Headphones, Pause } from "lucide-react";
import { narration, useNarration, useNarrationClip, useNarrationProgress } from "@/lib/integrations/narration";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Lang = "en" | "es";

const TEXT = {
  en: { listen: "Listen to the storm briefing", pause: "Pause briefing", read: "Read the storm briefing", hide: "Hide briefing", transcript: "Transcript", hideT: "Hide transcript" },
  es: { listen: "Escuchar el informe de tormenta", pause: "Pausar informe", read: "Leer el informe de tormenta", hide: "Ocultar informe", transcript: "Transcripción", hideT: "Ocultar transcripción" },
} as const;

export function StormBriefingButton({ stormId, className }: { stormId: string; className?: string }) {
  const [lang, setLang] = useState<Lang>("en");
  const spanish = useNarrationClip(`briefing-${stormId}-es`);
  const id = lang === "es" && spanish ? `briefing-${stormId}-es` : `briefing-${stormId}`;
  const n = useNarration(id);
  const elapsed = useNarrationProgress(id);
  const [showText, setShowText] = useState(false);

  if (!n.clip) return null;
  const t = TEXT[id.endsWith("-es") ? "es" : "en"];
  const canPlay = n.available && !n.muted;
  const pct = n.durationMs > 0 ? Math.min(100, (elapsed * 1000 * 100) / n.durationMs) : 0;

  function switchTo(next: Lang) {
    if (next === lang) return;
    narration.stop();
    setLang(next);
  }

  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {canPlay ? (
          <button
            type="button"
            onClick={n.toggle}
            aria-pressed={n.isPlaying}
            className="relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-[8px] bg-ink px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#2a2e37]"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-white/15 transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
            {n.isPlaying ? <Pause size={14} aria-hidden /> : <Headphones size={14} aria-hidden />}
            <span className="relative">{n.isPlaying ? t.pause : t.listen}</span>
            <span className="relative tabular-nums text-white/70">
              {n.isPlaying ? clock(elapsed * 1000) : clock(n.durationMs)}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setShowText((v) => !v)}
          aria-expanded={showText}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-hairline-strong bg-white/80 px-3 text-[13px] font-medium text-ink hover:bg-white"
        >
          <FileText size={14} aria-hidden />
          {canPlay ? (showText ? t.hideT : t.transcript) : showText ? t.hide : t.read}
        </button>
        {spanish ? (
          <div role="group" aria-label="Briefing language" className="inline-flex h-8 items-center rounded-[8px] border border-hairline p-0.5">
            {(["en", "es"] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => switchTo(l)}
                aria-pressed={lang === l}
                lang={l}
                className={cx(
                  "h-full rounded-[6px] px-2 text-[12px] font-medium uppercase",
                  lang === l ? "bg-ink text-white" : "text-ink-2 hover:bg-wash-2",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {showText ? (
        <p lang={id.endsWith("-es") ? "es" : "en"} className="max-w-prose rounded-[8px] bg-wash px-3 py-2 text-[13px] leading-[19px] text-ink-2">
          {n.text}
        </p>
      ) : null}
    </div>
  );
}

export default StormBriefingButton;

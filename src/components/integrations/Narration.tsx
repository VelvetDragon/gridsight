"use client";

/**
 * Narration controls for story chapters and the corridor flight.
 *
 *   <NarrationControl id="story-3" autoPlay onEnded={nextChapter} />
 *   <NarrationMuteToggle />
 *
 * Both render nothing when the clip has no audio yet, so they are safe to
 * place before the MP3s exist.
 */
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useNarration, useNarrationState, narration, type UseNarrationOptions } from "@/lib/integrations/narration";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export interface NarrationControlProps extends UseNarrationOptions {
  id: string;
  /** Show the mute toggle next to play/pause (default true). */
  showMute?: boolean;
  className?: string;
}

export function NarrationControl({ id, showMute = true, className, ...options }: NarrationControlProps) {
  const n = useNarration(id, options);
  if (!n.available) return null;
  const label = n.muted ? "Narration muted" : n.isPlaying ? "Pause narration" : "Play narration";
  return (
    <div
      className={cx(
        "inline-flex items-center gap-0.5 rounded-full border border-hairline bg-white/80 p-0.5 text-ink-2 shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        onClick={n.toggle}
        disabled={n.muted}
        aria-label={label}
        title={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-wash-2 hover:text-ink disabled:opacity-40"
      >
        {n.isPlaying ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
      </button>
      {showMute ? <MuteButton muted={n.muted} /> : null}
    </div>
  );
}

function MuteButton({ muted, className }: { muted: boolean; className?: string }) {
  const label = muted ? "Turn narration on" : "Mute narration";
  return (
    <button
      type="button"
      onClick={narration.toggleMute}
      aria-label={label}
      aria-pressed={muted}
      title={label}
      className={cx(
        "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-wash-2 hover:text-ink",
        className,
      )}
    >
      {muted ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
    </button>
  );
}

/** Stand-alone mute toggle (remembered across visits). */
export function NarrationMuteToggle({ className }: { className?: string }) {
  const { muted } = useNarrationState();
  return <MuteButton muted={muted} className={className} />;
}

export default NarrationControl;

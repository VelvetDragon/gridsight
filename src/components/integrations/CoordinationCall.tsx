"use client";

/**
 * "Hear the coordination call" for the match drawer.
 *
 *   <CoordinationCall overlapId={overlap.id} />                         // DESC / Georgia Power plan
 *   <CoordinationCall match={{ overlap, yours, theirs, you, neighbor }} /> // any two catalog utilities
 *
 * POST /api/call returns a short call between the two utilities' planners
 * (Gemini script, ElevenLabs two-voice audio) and this plays it with a live
 * transcript. Without audio it still shows the transcript.
 */
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Phone, Play } from "lucide-react";
import { fetchCall, type CoordinationCall as Call, type MatchRequest } from "@/lib/integrations/call";
import { narration } from "@/lib/integrations/narration";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

const DOT: Record<string, string> = { DESC: "var(--desc, #0e7c7b)", GPC: "var(--gpc, #c2410c)" };

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; call: Call } | { kind: "error"; message: string };

/** Line index being spoken at `t` seconds, estimated from each line's share of the words. */
function lineAt(call: Call, t: number): number {
  const words = call.lines.map((l) => l.text.split(/\s+/).length + 2);
  const total = words.reduce((a, b) => a + b, 0);
  const dur = call.durationMs / 1000;
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    acc += (words[i] / total) * dur;
    if (t < acc) return i;
  }
  return words.length - 1;
}

export function CoordinationCall({
  overlapId: givenId,
  match,
  className,
}: {
  overlapId?: string;
  match?: MatchRequest;
  className?: string;
}) {
  const request: MatchRequest = match ?? givenId ?? "";
  const overlapId = typeof request === "string" ? request : request.overlap.id;
  const [entry, setEntry] = useState<{ id: string; status: Status }>({ id: overlapId, status: { kind: "idle" } });
  const status: Status = entry.id === overlapId ? entry.status : { kind: "idle" };
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop audio when the match changes or the card unmounts.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [overlapId]);

  async function load() {
    const id = overlapId;
    setEntry({ id, status: { kind: "loading" } });
    try {
      const call = await fetchCall(request);
      setEntry({ id, status: { kind: "ready", call } });
    } catch (err) {
      setEntry({ id, status: { kind: "error", message: (err as Error).message || "Something went wrong" } });
    }
  }

  function play(call: Call) {
    if (!call.audioUrl) return;
    narration.stop();
    let el = audioRef.current;
    if (!el) {
      el = new Audio(call.audioUrl);
      el.addEventListener("timeupdate", () => setT(el!.currentTime));
      el.addEventListener("play", () => setPlaying(true));
      el.addEventListener("pause", () => setPlaying(false));
      el.addEventListener("ended", () => {
        setPlaying(false);
        setT(0);
      });
      el.addEventListener("error", () => setPlaying(false));
      audioRef.current = el;
    }
    el.play().catch(() => setPlaying(false));
  }

  const btn =
    "inline-flex h-8 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors duration-150 disabled:opacity-50";

  if (status.kind !== "ready") {
    return (
      <div className={cx("flex flex-col gap-2", className)}>
        <button
          type="button"
          onClick={load}
          disabled={status.kind === "loading"}
          className={cx(btn, "self-start border border-hairline-strong bg-white/80 text-ink hover:bg-white")}
        >
          {status.kind === "loading" ? (
            <LoaderCircle size={14} className="animate-spin" aria-hidden />
          ) : (
            <Phone size={14} aria-hidden />
          )}
          {status.kind === "loading" ? "Writing the script…" : "Prepare the coordination call"}
        </button>
        {status.kind === "error" ? (
          <p role="alert" className="text-[12px] text-alert">
            {status.message}.{" "}
            <button type="button" onClick={load} className="underline underline-offset-2">
              Try again
            </button>
          </p>
        ) : null}
      </div>
    );
  }

  const call = status.call;
  const active = playing || t > 0 ? lineAt(call, t) : -1;
  return (
    <section
      aria-label="Coordination call"
      className={cx("flex flex-col gap-2 rounded-[10px] border border-hairline bg-white/70 p-3 text-ink", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
          <Phone size={12} aria-hidden />
          Call script for the planner · {call.script === "gemini" ? "written with Gemini" : "built from the plan data"}
        </span>
        {call.audioUrl ? (
          <button
            type="button"
            onClick={() => (playing ? audioRef.current?.pause() : play(call))}
            aria-label={playing ? "Pause audio preview" : "Play audio preview"}
            title="A 60-second audio preview of the call, voiced with ElevenLabs"
            className="inline-flex h-7 items-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-medium text-white hover:bg-[#2a2e37]"
          >
            {playing ? <Pause size={12} aria-hidden /> : <Play size={12} aria-hidden />}
            {playing ? "Pause" : "Audio preview"}
          </button>
        ) : null}
      </div>
      <ol className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {call.lines.map((l, i) => (
          <li
            key={i}
            className={cx(
              "rounded-[8px] px-2 py-1.5 text-[13px] leading-[18px] transition-colors",
              i === active ? "bg-wash-2 text-ink" : "text-ink-2",
            )}
          >
            <span className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: DOT[l.speaker] }} />
              {l.label}
            </span>
            {l.text}
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-ink-3">
        Talking points for the real call between the two utilities&apos; planners, built only from public plan data.
        The audio preview is voiced with ElevenLabs; no real conversation took place.
      </p>
    </section>
  );
}

export default CoordinationCall;

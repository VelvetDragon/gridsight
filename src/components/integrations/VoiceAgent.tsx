"use client";

/**
 * The "Ask MrGridy" voice button and conversation bubble, shared by Stormline and Crosswire.
 * Each page passes its own client tools; /api/agent?page=... hands out a signed URL for that
 * page's ElevenLabs agent, so the API key never reaches the browser. While the planner talks
 * the bubble shows what MrGridy heard; once it answers, the answer replaces it.
 */
import { ConversationProvider, useConversation, type ClientTools } from "@elevenlabs/react";
import { LoaderCircle, Mic, Square } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { cx } from "../ui/primitives";

export type AgentPage = "storm" | "crosswire";

function Agent({
  tools,
  page,
  hint,
  className,
  style,
}: {
  tools: ClientTools;
  page: AgentPage;
  hint: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [line, setLine] = useState<string | null>(null);
  /** What the planner just said; shown until MrGridy's answer arrives. */
  const [heard, setHeard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const convo = useConversation({
    clientTools: tools,
    onMessage: (m) => {
      if (m.role === "user") {
        setHeard(m.message);
      } else {
        setHeard(null);
        setLine(m.message);
      }
    },
    onError: (message) => setError(typeof message === "string" ? message : "Voice connection failed"),
    onDisconnect: () => {
      setLine(null);
      setHeard(null);
    },
  });
  const live = convo.status === "connected";

  async function start() {
    setError(null);
    setStarting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch(`/api/agent?page=${page}`);
      const body = (await res.json()) as { signedUrl?: string; error?: string };
      if (!body.signedUrl) throw new Error(body.error ?? "Voice agent is not set up");
      convo.startSession({ signedUrl: body.signedUrl });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the voice agent");
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || convo.status === "connecting";
  return (
    <div
      className={cx("z-30 flex w-[min(460px,calc(100vw-32px))] -translate-x-1/2 flex-col items-center gap-2", className)}
      style={style}
    >
      <div className="glass flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3.5">
        {live ? (
          <>
            <span
              aria-hidden
              className={cx("h-2.5 w-2.5 rounded-full", convo.isSpeaking ? "animate-pulse bg-[#2F6F45]" : "bg-alert")}
            />
            <span className="text-[13px] font-medium text-ink">{convo.isSpeaking ? "MrGridy is speaking" : "Listening"}</span>
            <button
              type="button"
              onClick={() => convo.endSession()}
              className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-medium text-white hover:bg-[#2a2e37]"
            >
              <Square size={11} aria-hidden /> End
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="inline-flex h-8 items-center gap-2 rounded-full pr-2 text-[13px] font-medium text-ink disabled:opacity-60"
            title={hint}
          >
            {busy ? <LoaderCircle size={15} className="animate-spin" aria-hidden /> : <Mic size={15} aria-hidden />}
            {busy ? "Connecting…" : "Ask MrGridy"}
          </button>
        )}
      </div>
      {live && heard ? (
        <p className="glass max-w-full rounded-[14px] px-4 py-2 text-center text-[13px] leading-[19px] text-ink-2">
          <span className="font-medium text-ink-3">You: </span>
          {heard}
        </p>
      ) : live && line ? (
        <p className="glass max-w-full rounded-[14px] px-4 py-2.5 text-center text-[13px] leading-[19px] text-ink">{line}</p>
      ) : null}
      {error ? <p className="glass rounded-[12px] px-3 py-1.5 text-[12px] text-alert">{error}</p> : null}
    </div>
  );
}


export function VoiceAgent(props: {
  tools: ClientTools;
  page: AgentPage;
  hint: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <ConversationProvider>
      <Agent {...props} />
    </ConversationProvider>
  );
}

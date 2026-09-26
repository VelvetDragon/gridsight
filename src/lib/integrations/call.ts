/** Shared types and the browser helper for POST /api/call ("Hear the coordination call"). */

export type CallSpeaker = "DESC" | "GPC";

export interface CallLine {
  speaker: CallSpeaker;
  /** "Dominion Energy SC planner" / "Georgia Power planner". */
  label: string;
  text: string;
}

export interface CoordinationCall {
  overlapId: string;
  lines: CallLine[];
  /** MP3 of both voices, or null when audio is not available (transcript only). */
  audioUrl: string | null;
  durationMs: number;
  /** Who wrote the script: Gemini, or the deterministic template. */
  script: "gemini" | "template";
  /** How the audio was made (ElevenLabs), or null. */
  audio: "text-to-dialogue" | "text-to-speech" | null;
  model: string | null;
  generatedAt: string;
  cached: boolean;
}

export const SPEAKER_LABEL: Record<CallSpeaker, string> = {
  DESC: "Dominion Energy SC planner",
  GPC: "Georgia Power planner",
};

export async function fetchCall(overlapId: string, signal?: AbortSignal): Promise<CoordinationCall> {
  const res = await fetch("/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ overlapId }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as (CoordinationCall & { error?: string }) | null;
  if (!res.ok || !body || body.error) throw new Error(body?.error ?? `Call request failed (${res.status})`);
  return body;
}

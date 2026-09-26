/** Shared types and the browser helper for POST /api/call ("Hear the coordination call"). */
import type { CatalogUtility, Overlap, Project } from "@/lib/types";

export type CallSpeaker = "DESC" | "GPC";

export interface CallLine {
  speaker: CallSpeaker;
  /** "DESC planner" / "Georgia Power planner" (or the two catalog utilities' short names). */
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

/** An overlap id from the DESC / Georgia Power plan, or a full match (the Crosswire slot props). */
export type MatchRequest = string | { overlap: Overlap; yours: Project; theirs: Project; you?: CatalogUtility | null; neighbor?: CatalogUtility | null };

/** JSON body for /api/call and /api/explain. */
export function matchBody(match: MatchRequest): string {
  if (typeof match === "string") return JSON.stringify({ overlapId: match });
  const { overlap, yours, theirs, you, neighbor } = match;
  return JSON.stringify({
    overlap,
    yours,
    theirs,
    you: you ? { name: you.name, shortName: you.shortName } : null,
    neighbor: neighbor ? { name: neighbor.name, shortName: neighbor.shortName } : null,
  });
}

export async function fetchCall(match: MatchRequest, signal?: AbortSignal): Promise<CoordinationCall> {
  const res = await fetch("/api/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: matchBody(match),
    signal,
  });
  const body = (await res.json().catch(() => null)) as (CoordinationCall & { error?: string }) | null;
  if (!res.ok || !body || body.error) throw new Error(body?.error ?? `Call request failed (${res.status})`);
  return body;
}

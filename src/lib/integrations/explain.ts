/** Shared types and the browser helper for POST /api/explain (Gemini). */
import { matchBody, type MatchRequest } from "./call";

export interface ExplainMemo {
  subject: string;
  to: string;
  body: string;
}

export interface ExplainResult {
  overlapId: string;
  /** "gemini" when the Gemini API wrote it, "template" for the deterministic fallback. */
  source: "gemini" | "template";
  model: string | null;
  summary: string;
  memo: ExplainMemo;
  talkingPoints: string[];
  generatedAt: string;
  cached: boolean;
  /** Where the overlap data came from: pipeline output or sample fixtures. */
  dataOrigin: "pipeline" | "sample";
}

export async function fetchExplanation(match: MatchRequest, signal?: AbortSignal): Promise<ExplainResult> {
  const res = await fetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: matchBody(match),
    signal,
  });
  const body = (await res.json().catch(() => null)) as (ExplainResult & { error?: string }) | null;
  if (!res.ok || !body || body.error) {
    throw new Error(body?.error ?? `Explain request failed (${res.status})`);
  }
  return body;
}

/** Plain-text memo for copy / download. */
export function memoAsText(memo: ExplainMemo): string {
  return `To: ${memo.to}\nSubject: ${memo.subject}\n\n${memo.body.trim()}\n`;
}

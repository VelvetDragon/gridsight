/**
 * Shared types and the browser helper for POST /api/utilities/find
 * (Gemini utility finder). The route streams newline-delimited JSON events.
 */
import type { CatalogProject, CatalogUtility, SourceRef } from "@/lib/types";

export type FinderStep = "search" | "download" | "read" | "extract" | "geocode" | "done";

export type FinderEvent =
  | { type: "status"; step: FinderStep; message: string; progress?: number }
  | { type: "document"; source: SourceRef & { title: string }; via: "search" | "knowledge" | "provided" | "cache" }
  | { type: "result"; utility: CatalogUtility; projects: CatalogProject[]; cached: boolean }
  | { type: "error"; message: string; hint?: string };

export interface FinderResult {
  utility: CatalogUtility;
  projects: CatalogProject[];
}

/**
 * Run the finder and report each event. Resolves with the result, or rejects
 * with the error message the server sent.
 */
export async function findUtility(
  input: { name: string; url?: string },
  onEvent: (e: FinderEvent) => void,
  signal?: AbortSignal,
): Promise<FinderResult> {
  const res = await fetch("/api/utilities/find", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Finder failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: FinderResult | null = null;
  let error: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let event: FinderEvent;
      try {
        event = JSON.parse(line) as FinderEvent;
      } catch {
        continue;
      }
      onEvent(event);
      if (event.type === "result") result = { utility: event.utility, projects: event.projects };
      if (event.type === "error") error = event.hint ? `${event.message} ${event.hint}` : event.message;
    }
    if (done) break;
  }
  if (result) return result;
  throw new Error(error ?? "The finder stopped without a result");
}

/**
 * Shared types and the browser helper for POST /api/savings-agent.
 *
 * The savings agent works in five steps and reports each one:
 *   grants  find funding programs: re-check the verified list's official pages,
 *           search Grants.gov's open and forecast listings, and search the web
 *           when grounding is available. Each program found is read into a
 *           requirement list; every requirement quotes the listing word for word.
 *   prices  price the shared work with published unit costs (lib/savings.ts,
 *           run in the browser)
 *   rules   check every project against every requirement of every program
 *           (lib/grants.ts, run in the browser and on the server alike)
 *   verify  Gemini re-reads each project's filing against the work each
 *           program funds; it can mark a requirement met only by quoting the
 *           filing, and the server checks the quote is really there
 *   notes   Gemini writes one plain note per pair that fits, from those facts only
 * The route streams newline-delimited JSON events.
 */
import type { CheckOverrides, GrantProgram, GrantProject } from "@/lib/grants";
import type { Opportunity } from "@/lib/opportunities";

export type AgentStep = "grants" | "prices" | "rules" | "verify" | "notes";

export interface AgentProject extends GrantProject {
  /** Utility short name, for the notes. */
  utility: string;
  miles: number | null;
}

export interface AgentPair {
  id: string;
  /** Project ids, from `projects`. */
  a: string;
  b: string;
  /** The pair's ways to work together found by the rules. */
  shared: Pick<Opportunity, "kind" | "title">[];
  /** Estimated saving from published unit costs (lib/savings). */
  savedUsd: number;
}

export interface AgentRequest {
  projects: AgentProject[];
  pairs: AgentPair[];
}

/** Where the programs came from. */
export interface GrantSources {
  catalog: number;
  /** Grants.gov listings read, and how many of them fund electric utility work. */
  grantsGov: { read: number; kept: number } | null;
  web: number | null;
}

export type AgentEvent =
  | { type: "status"; step: AgentStep; message: string }
  | { type: "grants"; programs: GrantProgram[]; sources: GrantSources; note: string }
  | { type: "rules"; checks: number; toVerify: number }
  | {
      type: "verified";
      overrides: CheckOverrides;
      /** Project × requirement checks Gemini re-read, and how many answers it changed. */
      checked: number;
      changed: number;
      model: string | null;
      note: string;
    }
  | { type: "notes"; notes: Record<string, string>; source: "gemini" | "template"; model: string | null }
  | { type: "done" }
  | { type: "error"; message: string };

/** Run the agent and report each event; resolves when the stream ends. */
export async function runSavingsAgent(
  body: AgentRequest,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/savings-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? `Savings agent failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as AgentEvent);
      } catch {
        /* a broken line is skipped */
      }
    }
    if (done) break;
  }
}

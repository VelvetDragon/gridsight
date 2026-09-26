"use client";

import { useCallback, useEffect, useState } from "react";
import { GRANT_CATALOG, type CheckOverrides, type GrantProgram } from "@/lib/grants";
import { runSavingsAgent, type AgentRequest, type AgentStep, type GrantSources } from "@/lib/integrations/savingsAgent";

export type StepState = "waiting" | "working" | "done" | "skipped" | "failed";

export interface SavingsAgentState {
  steps: Record<AgentStep, { state: StepState; message: string | null }>;
  programs: GrantProgram[];
  sources: GrantSources | null;
  grantsNote: string | null;
  /** Requirement checks the rules ran, and how many went to Gemini. */
  rules: { checks: number; toVerify: number } | null;
  /** Gemini's re-reads, keyed grant|project|requirement. */
  overrides: CheckOverrides;
  verified: { checked: number; changed: number; model: string | null; note: string } | null;
  notes: Record<string, string>;
  notesSource: "gemini" | "template" | null;
  notesModel: string | null;
  running: boolean;
  error: string | null;
}

const initial = (): SavingsAgentState => ({
  steps: {
    grants: { state: "waiting", message: null },
    prices: { state: "done", message: null },
    rules: { state: "waiting", message: null },
    verify: { state: "waiting", message: null },
    notes: { state: "waiting", message: null },
  },
  // Until the agent answers, the verified list is what the checklist uses.
  programs: GRANT_CATALOG,
  sources: null,
  grantsNote: null,
  rules: null,
  overrides: {},
  verified: null,
  notes: {},
  notesSource: null,
  notesModel: null,
  running: false,
  error: null,
});

const IDLE = initial();
/** The state a run starts from, before its first event. */
const STARTED: SavingsAgentState = { ...IDLE, running: true, steps: { ...IDLE.steps, grants: { state: "working", message: null } } };

/**
 * Runs the savings agent for the pairs on screen: grant research, the
 * requirement checks, Gemini's verification, then notes. `key` changes when
 * the pairs do (a new utility pair or
 * measure); the run for an old key is cancelled.
 */
export function useSavingsAgent(key: string, request: AgentRequest) {
  const [run, setRun] = useState(0);
  const active = key && request.pairs.length ? `${key}#${run}` : "";
  // Tagged with its run, so a new run starts clean without a reset inside the effect.
  const [tagged, setTagged] = useState<{ run: string; state: SavingsAgentState }>({ run: "", state: IDLE });
  const state = tagged.run === active ? tagged.state : active ? STARTED : IDLE;

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const setState = (f: (prev: SavingsAgentState) => SavingsAgentState) =>
      setTagged((prev) => ({ run: active, state: f(prev.run === active ? prev.state : STARTED) }));
    const step = (s: AgentStep, st: StepState, message?: string | null) =>
      setState((prev) => ({
        ...prev,
        steps: { ...prev.steps, [s]: { state: st, message: message === undefined ? prev.steps[s].message : message } },
      }));
    runSavingsAgent(
      request,
      (e) => {
        if (ctrl.signal.aborted) return;
        switch (e.type) {
          case "status":
            step(e.step, "working", e.message);
            break;
          case "grants":
            setState((prev) => ({ ...prev, programs: e.programs, sources: e.sources, grantsNote: e.note }));
            step("grants", "done", e.note);
            break;
          case "rules":
            setState((prev) => ({ ...prev, rules: { checks: e.checks, toVerify: e.toVerify } }));
            step("rules", "done", null);
            break;
          case "verified":
            setState((prev) => ({
              ...prev,
              overrides: e.overrides,
              verified: { checked: e.checked, changed: e.changed, model: e.model, note: e.note },
            }));
            step("verify", e.checked ? "done" : "skipped", null);
            break;
          case "notes":
            setState((prev) => ({ ...prev, notes: e.notes, notesSource: e.source, notesModel: e.model }));
            step("notes", "done", null);
            break;
          case "done":
            setState((prev) => ({
              ...prev,
              running: false,
              steps: prev.steps.notes.state === "done" ? prev.steps : { ...prev.steps, notes: { state: "skipped", message: null } },
            }));
            break;
          case "error":
            setState((prev) => ({ ...prev, running: false, error: e.message }));
            break;
        }
      },
      ctrl.signal,
    )
      .then(() => !ctrl.signal.aborted && setState((prev) => ({ ...prev, running: false })))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        // Offline or no server: the verified list is still checked in the browser, by rule.
        setState((prev) => ({
          ...prev,
          running: false,
          error: err instanceof Error ? err.message : String(err),
          steps: {
            ...prev.steps,
            grants: prev.steps.grants.state === "done" ? prev.steps.grants : { state: "failed", message: null },
          },
        }));
      });
    return () => ctrl.abort();
    // `request` follows `key`; re-running on every new array would repeat the same work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const rerun = useCallback(() => setRun((n) => n + 1), []);
  return { ...state, rerun };
}

export type SavingsAgent = ReturnType<typeof useSavingsAgent>;

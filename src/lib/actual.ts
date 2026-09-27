/**
 * What actually happened in each storm, per utility, from published sources only
 * (/data/response/actual-restoration.json). Every fact carries its source link; a
 * figure that could not be found in a utility or news source is left out, not guessed.
 */
import type { UtilityId } from "./types";

export const ACTUAL_FILE = "response/actual-restoration.json";

export interface ActualFact {
  /** One plain sentence, quoting the source's own figures. */
  text: string;
  source: string;
  url: string;
}

export interface ActualStorm {
  utilities: Partial<Record<UtilityId, ActualFact[]>>;
  /** Storm-level notes (e.g. whether the two utilities helped each other). */
  notes?: ActualFact[];
  /** Why the outage-cost estimate is not shown, when the model's outages run well above published ones. */
  outageCostHidden?: string;
}

export interface ActualRestoration {
  checked: string;
  storms: Record<string, ActualStorm>;
}

export function isActualRestoration(v: unknown): v is ActualRestoration {
  const s = (v as ActualRestoration | null)?.storms;
  return !!s && typeof s === "object" && !Array.isArray(s);
}

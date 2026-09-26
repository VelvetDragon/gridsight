/**
 * Extension points for teammates' components. Each slot is null until a
 * component is plugged in here; Crosswire renders a slot only when it is set,
 * so nothing half-finished ever shows.
 *
 *   import { ExplainMatch } from "./gemini/ExplainMatch";
 *   export const ExplainMatchSlot: SlotComponent<MatchSlotProps> | null = ExplainMatch;
 */
import type { ComponentType } from "react";
import type { CatalogUtility, Overlap, Project } from "@/lib/types";
import { CoordinationCallForPair, ExplainMatchForPair } from "./integrations/slotAdapters";

export interface MatchSlotProps {
  overlap: Overlap;
  /** Your utility's project (map slot "DESC"). */
  yours: Project;
  /** The neighbour's project (map slot "GPC"). */
  theirs: Project;
  you: CatalogUtility;
  neighbor: CatalogUtility;
}

export type SlotComponent<P> = ComponentType<P>;

/** Gemini "Explain this match" (integrations teammate). */
export const ExplainMatchSlot: SlotComponent<MatchSlotProps> | null = ExplainMatchForPair;

/** "Hear the coordination call" audio (integrations teammate). */
export const CoordinationCallSlot: SlotComponent<MatchSlotProps> | null = CoordinationCallForPair;

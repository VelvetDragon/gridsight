"use client";

/**
 * Adapters from the Crosswire pair-detail slots (src/components/slots.tsx,
 * MatchSlotProps) to the integration components.
 */
import type { MatchSlotProps } from "../slots";
import { CoordinationCall } from "./CoordinationCall";
import { ExplainMatch } from "./ExplainMatch";

export function ExplainMatchForPair({ overlap, yours, theirs, you, neighbor }: MatchSlotProps) {
  return <ExplainMatch match={{ overlap, yours, theirs, you, neighbor }} />;
}

export function CoordinationCallForPair({ overlap, yours, theirs, you, neighbor }: MatchSlotProps) {
  return <CoordinationCall match={{ overlap, yours, theirs, you, neighbor }} />;
}

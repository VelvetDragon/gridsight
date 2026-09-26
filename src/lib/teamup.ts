import type { Position } from "./types";

/** Shape of /data/response/<id>/teamup.json (pipeline/gridsight/response/teamup.py). */
export interface TeamUpOwner {
  id: string;
  name: string;
  lineKm: number;
  damagedSections: number;
  workHours: number;
  crews: number;
  hoursAlone: number;
  strongWindShare: number;
  damageCenter: Position;
  role: "needs help" | "can help" | "busy" | "little on this map";
}

export interface LendMove {
  kind: "lend";
  from: string;
  to: string;
  crews: number;
  path: [Position, Position];
  driveHours: number;
  hoursSooner: number;
  costUsd: number;
  why: string;
}

export interface SharedMove {
  kind: "yard" | "crews";
  a: string;
  b: string;
  distanceKm: number;
  sectionsNearby: number;
  at: Position;
  why: string;
}

export type TeamUpMove = LendMove | SharedMove;

export interface TeamUp {
  storm: string;
  owners: TeamUpOwner[];
  moves: TeamUpMove[];
  assumptions: string[];
  sources: Record<string, unknown>;
}

export function isTeamUp(v: unknown): v is TeamUp {
  const t = v as TeamUp | null;
  return !!t && Array.isArray(t.owners) && Array.isArray(t.moves);
}

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

export interface CrewCost {
  crews: number;
  workersPerCrew: number;
  workers: number;
  workHours: number;
  driveHoursBothWays: number;
  paidHours: number;
  wageUsdH: number;
  overtime: number;
  stormWageUsdH: number;
  days: number;
  perDiemUsd: number;
  laborUsd: number;
  perDiemTotalUsd: number;
  totalUsd: number;
}

export interface LendMove {
  kind: "lend";
  from: string;
  to: string;
  crews: number;
  receiverCrews?: number;
  receiverWorkHours?: number;
  efficiency?: number;
  hoursBefore?: number;
  hoursAfter?: number;
  cost?: CrewCost;
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

/** Stable id for a move, shared by the panel and the map. */
export function moveKey(m: TeamUpMove): string {
  return m.kind === "lend" ? `lend-${m.from}-${m.to}` : `${m.kind}-${m.a}-${m.b}`;
}

/** "A", "A and B", "A, B and C". */
export function andList(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function isTeamUp(v: unknown): v is TeamUp {
  const t = v as TeamUp | null;
  return !!t && Array.isArray(t.owners) && Array.isArray(t.moves);
}

/** Customers in each state stand in for Dominion (SC) and Georgia Power (GA) customers. */
const STATE_OF: Record<string, "SC" | "GA"> = { desc: "SC", "georgia-power": "GA" };
/** Restoration is spread over the outage, so the average customer gains about half the time saved. */
export const AVERAGE_GAIN = 0.5;

export interface TeamUpImpact {
  /** Receiving utility -> hours sooner (sum of its lend moves). */
  sooner: { id: string; name: string; hours: number; customers: number | null }[];
  customerHours: number;
  costUsd: number;
  /** Crew cost of the moves whose customer-hours are counted (Dominion / Georgia Power). */
  costCountedUsd: number;
  sharedYards: number;
  sharedCrewAreas: number;
}

export function teamUpImpact(t: TeamUp, counties: { state: string; predictedPeakOut: number }[]): TeamUpImpact {
  const name = new Map(t.owners.map((o) => [o.id, o.name]));
  const byTo = new Map<string, number>();
  let costUsd = 0;
  let costCountedUsd = 0;
  for (const m of t.moves) {
    if (m.kind !== "lend") continue;
    byTo.set(m.to, (byTo.get(m.to) ?? 0) + m.hoursSooner);
    costUsd += m.costUsd;
    if (STATE_OF[m.to]) costCountedUsd += m.costUsd;
  }
  const out = (st: string) => counties.filter((c) => c.state === st).reduce((a, c) => a + c.predictedPeakOut, 0);
  const sooner = [...byTo.entries()]
    .map(([id, hours]) => ({ id, name: name.get(id) ?? id, hours, customers: STATE_OF[id] ? out(STATE_OF[id]) : null }))
    // Utilities whose customers we can count come first; then by hours.
    .sort((a, b) => Number(b.customers != null) - Number(a.customers != null) || b.hours - a.hours);
  const customerHours = sooner.reduce((a, s) => a + (s.customers ?? 0) * s.hours * AVERAGE_GAIN, 0);
  return {
    sooner,
    customerHours,
    costUsd,
    costCountedUsd,
    sharedYards: t.moves.filter((m) => m.kind === "yard").length,
    sharedCrewAreas: t.moves.filter((m) => m.kind === "crews").length,
  };
}

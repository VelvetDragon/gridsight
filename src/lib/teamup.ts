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

/**
 * Owners whose whole network is in the simulation (the two utilities it is built for).
 * Other owners get crews scaled to the part of their network on the map, so their hours
 * are not reliable.
 */
export function fullyModeled(id: string): boolean {
  return id === "desc" || id === "georgia-power";
}

export interface TeamUpImpact {
  /** Receiving owner -> hours sooner on its simulated transmission repairs (sum of its lend moves). */
  sooner: { id: string; name: string; hours: number }[];
  costUsd: number;
  sharedYards: number;
  sharedCrewAreas: number;
}

export function teamUpImpact(t: TeamUp): TeamUpImpact {
  const name = new Map(t.owners.map((o) => [o.id, o.name]));
  const byTo = new Map<string, number>();
  let costUsd = 0;
  for (const m of t.moves) {
    if (m.kind !== "lend") continue;
    byTo.set(m.to, (byTo.get(m.to) ?? 0) + m.hoursSooner);
    costUsd += m.costUsd;
  }
  const sooner = [...byTo.entries()]
    .map(([id, hours]) => ({ id, name: name.get(id) ?? id, hours }))
    // The two fully modeled utilities first; then by hours.
    .sort((a, b) => Number(fullyModeled(b.id)) - Number(fullyModeled(a.id)) || b.hours - a.hours);
  return {
    sooner,
    costUsd,
    sharedYards: t.moves.filter((m) => m.kind === "yard").length,
    sharedCrewAreas: t.moves.filter((m) => m.kind === "crews").length,
  };
}

/** Team-up owner ids that have repair zones (the two utilities the zones are built for). */
const SLOT_OF: Record<string, "DESC" | "GPC"> = { desc: "DESC", "georgia-power": "GPC" };

export interface ZoneCrews {
  /** Lent crews working in this zone, by lender. */
  helpers: { from: string; name: string; crews: number }[];
  /** Shared staging yard serving this zone, if any. */
  yard: string | null;
}

/**
 * Who repairs where. For every lend move into Dominion or Georgia Power, the lent crews go
 * to the helped company's repair zones in priority order, split by each zone's share of that
 * company's expected damage (largest remainders to the highest priorities). Computed from
 * teamup.json, zones.json and yards.json for the storm on screen.
 */
export function zoneCrewPlan(
  t: TeamUp | null,
  zones: { id: string; utilities: string[]; expectedDamagedSegments: number; priority: number }[],
  yards: { label: string; serves: string[] }[],
): Map<string, ZoneCrews> {
  const plan = new Map<string, ZoneCrews>();
  for (const z of zones) {
    plan.set(z.id, { helpers: [], yard: yards.find((y) => y.serves.includes(z.id))?.label ?? null });
  }
  if (!t) return plan;
  const name = new Map(t.owners.map((o) => [o.id, o.name]));
  for (const m of t.moves) {
    if (m.kind !== "lend" || !SLOT_OF[m.to]) continue;
    const mine = zones.filter((z) => z.utilities.includes(SLOT_OF[m.to])).sort((a, b) => a.priority - b.priority);
    const total = mine.reduce((a, z) => a + z.expectedDamagedSegments, 0);
    if (!mine.length || total <= 0) continue;
    const exact = mine.map((z) => (m.crews * z.expectedDamagedSegments) / total);
    const whole = exact.map(Math.floor);
    let left = m.crews - whole.reduce((a, b) => a + b, 0);
    for (const i of exact.map((v, i) => i).sort((a, b) => exact[b] - whole[b] - (exact[a] - whole[a]) || a - b)) {
      if (left <= 0) break;
      whole[i] += 1;
      left -= 1;
    }
    mine.forEach((z, i) => {
      if (whole[i] > 0) plan.get(z.id)!.helpers.push({ from: m.from, name: name.get(m.from) ?? m.from, crews: whole[i] });
    });
  }
  return plan;
}

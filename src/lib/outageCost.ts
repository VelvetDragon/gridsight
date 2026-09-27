/**
 * What an hour of outage costs customers, and what faster restoration is worth.
 *
 * Rates come from /data/response/outage-cost.json (pipeline/gridsight/response/outage_cost.py):
 * LBNL ICE 2.0 interruption costs (2023$) for one more hour of an outage already 8+ hours
 * long, weighted by each utility's residential / business customer mix and usage from
 * EIA-861 (Dominion Energy SC in South Carolina, Georgia Power in Georgia).
 *
 * Customers out for a utility = predicted peak outages in its state (counties.json) x the
 * utility's share of the state's customers. Dollars = customer-hours sooner x the utility's
 * rate. Upper bound: it assumes those customers wait on the transmission repairs being
 * sped up; distribution repairs are not modelled.
 */
import type { MutualAid, RestorationScenario } from "./savings";

export const OUTAGE_COST_FILE = "response/outage-cost.json";

export type UtilityKey = "DESC" | "GPC";

export interface UtilityOutageCost {
  state: "SC" | "GA";
  customers: { residential: number; nonResidential: number; total: number };
  stateShare: number;
  residentialKwh: number;
  nonResidentialKwh: number;
  residentialUsdPerHour: number;
  nonResidentialUsdPerHour: number;
  usdPerCustomerHour: number;
}

export interface OutageCost {
  dollarYear: number;
  utilities: Record<UtilityKey, UtilityOutageCost>;
  sources: { label: string; url: string }[];
  assumptions: string[];
}

export function isOutageCost(v: unknown): v is OutageCost {
  const u = (v as OutageCost | null)?.utilities;
  return !!u && typeof u.DESC?.usdPerCustomerHour === "number" && typeof u.GPC?.usdPerCustomerHour === "number";
}

export const UTILITY_KEYS: UtilityKey[] = ["DESC", "GPC"];

/** A utility's customers predicted out at the peak: its state's predicted outages x its share of the state. */
export function customersOut(counties: { state: string; predictedPeakOut: number }[], u: UtilityOutageCost): number {
  const state = counties.filter((c) => c.state === u.state).reduce((a, c) => a + c.predictedPeakOut, 0);
  return state * u.stateShare;
}

/** Percent restored at hour h on a step curve (100 after its end). */
function pctAt(s: RestorationScenario, h: number): number {
  const c = s.restorationCurve;
  if (!c.length || h >= c[c.length - 1].hour) return c.length ? Math.max(c[c.length - 1].pctRestored, 100) : 100;
  let v = 0;
  for (const p of c) {
    if (p.hour > h) break;
    v = p.pctRestored;
  }
  return v;
}

/**
 * Average hours sooner per customer: the area between the two restoration curves.
 * Customers come back in proportion to repaired line sections.
 */
export function averageHoursSooner(aid: MutualAid): number {
  const { separate, coordinated } = aid.scenarios;
  const hours = [...new Set([...separate.restorationCurve, ...coordinated.restorationCurve].map((p) => p.hour))].sort(
    (a, b) => a - b,
  );
  let area = 0;
  for (let i = 0; i + 1 < hours.length; i++) {
    area += ((pctAt(coordinated, hours[i]) - pctAt(separate, hours[i])) / 100) * (hours[i + 1] - hours[i]);
  }
  return Math.max(0, area);
}

export interface RestorationValue {
  customers: number;
  avgHoursSooner: number;
  customerHours: number;
  usd: number;
  byUtility: { key: UtilityKey; customers: number; usdPerCustomerHour: number; usd: number }[];
}

/** Dollars of outage cost avoided by the coordinated mutual-aid scenario. */
export function restorationValue(
  aid: MutualAid,
  counties: { state: string; predictedPeakOut: number }[],
  oc: OutageCost,
): RestorationValue {
  const avgHoursSooner = averageHoursSooner(aid);
  const byUtility = UTILITY_KEYS.map((key) => {
    const u = oc.utilities[key];
    const customers = customersOut(counties, u);
    return { key, customers, usdPerCustomerHour: u.usdPerCustomerHour, usd: customers * avgHoursSooner * u.usdPerCustomerHour };
  });
  const customers = byUtility.reduce((a, b) => a + b.customers, 0);
  return {
    customers,
    avgHoursSooner,
    customerHours: customers * avgHoursSooner,
    usd: byUtility.reduce((a, b) => a + b.usd, 0),
    byUtility,
  };
}

/** "How we calculated this" lines for the outage-cost part. */
export function outageCostLines(oc: OutageCost): string[] {
  const d = oc.utilities.DESC;
  const g = oc.utilities.GPC;
  return [
    `Cost of an outage hour (${oc.dollarYear} dollars): Dominion Energy SC $${d.usdPerCustomerHour.toFixed(0)} per customer-hour, Georgia Power $${g.usdPerCustomerHour.toFixed(0)} (homes about $${d.residentialUsdPerHour.toFixed(2)}, businesses $${d.nonResidentialUsdPerHour.toFixed(0)} in SC and $${g.nonResidentialUsdPerHour.toFixed(0)} in GA).`,
    `Customers out: predicted peak outages in the state x the utility's share of the state's customers (${Math.round(d.stateShare * 100)}% in SC, ${Math.round(g.stateShare * 100)}% in GA, EIA-861). Upper bound: it assumes they wait on these transmission repairs.`,
    ...oc.assumptions,
    ...oc.sources.map((s) => `Source: ${s.label} (${s.url})`),
  ];
}

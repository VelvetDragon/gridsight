/** Shared types and the browser helper for GET /api/outages. */

export interface OutagePoint {
  /** ISO time at the start of the hour. */
  t: string;
  /** Peak customers out during that hour. */
  out: number;
}

export interface OutageCurve {
  storm: string;
  /** County FIPS, or null for a state / two-state total. */
  fips: string | null;
  /** "Richmond County, GA", "Georgia", "Georgia and South Carolina". */
  label: string;
  state: "GA" | "SC" | null;
  /** Customers served (for "% out"), when known. */
  customers: number | null;
  /** "tiger" = queried live from Tiger Data; "static" = files in public/data. */
  source: "tiger" | "static";
  /** "eaglei" = measured (EAGLE-I); "estimate" = shape estimated from the model's county peaks. */
  basis: "eaglei" | "estimate";
  stepMinutes: number;
  points: OutagePoint[];
  peak: OutagePoint | null;
  /** The model's predicted peak for this county / area, when available. */
  predictedPeakOut: number | null;
}

export async function fetchOutageCurve(
  params: { storm?: string; fips?: string; state?: "GA" | "SC" },
  signal?: AbortSignal,
): Promise<OutageCurve> {
  const qs = new URLSearchParams();
  if (params.storm) qs.set("storm", params.storm);
  if (params.fips) qs.set("fips", params.fips);
  if (params.state) qs.set("state", params.state);
  const res = await fetch(`/api/outages?${qs.toString()}`, { signal });
  const body = (await res.json().catch(() => null)) as (OutageCurve & { error?: string }) | null;
  if (!res.ok || !body || body.error) throw new Error(body?.error ?? `Outage request failed (${res.status})`);
  return body;
}

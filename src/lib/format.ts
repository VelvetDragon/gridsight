const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtKm(km: number | null | undefined): string {
  if (km == null || Number.isNaN(km)) return "–";
  if (km === 0) return "0 km";
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function fmtMiles(mi: number | null | undefined): string {
  if (mi == null) return "–";
  return `${mi % 1 === 0 ? mi.toFixed(0) : mi.toFixed(1)} mi`;
}

export function fmtUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null || Number.isNaN(n)) return "–";
  const compact = opts.compact ?? true;
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
    if (abs >= 1e3) return `$${Math.round(n / 1e3)}k`;
    return `$${Math.round(n)}`;
  }
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "–";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(x: number | null | undefined, digits = 0): string {
  if (x == null || Number.isNaN(x)) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtMonths(m: number): string {
  const r = Math.round(m);
  if (r <= 0) return "none";
  return `${r} mo`;
}

/** "2026-12-01" → "Dec 2026" */
export function fmtMonthYear(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  if (!y || !m) return iso;
  return `${MONTHS[m - 1]} ${y}`;
}

/** "2026-12-01" → "Dec 1, 2026" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m) return iso;
  return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
}

/** UTC timestamp → "Sep 27 · 06:00 UTC" */
export function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} · ${hh}:${mm} UTC`;
}

export function fmtMinutes(min: number | null | undefined): string {
  if (min == null) return "–";
  const r = Math.round(min);
  if (r < 60) return `${r} min`;
  return `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")} min`;
}

/**
 * A project name without its filing tail or area prefix:
 * "Jasper – Okatie 230 kV #2: Construct" → "Jasper – Okatie 230 kV #2",
 * "SAV: Goshen (SAV) - McIntosh 115 kV Line Rebuild" → "Goshen (SAV) - McIntosh 115 kV Line Rebuild".
 */
export function shortProjectName(name: string): string {
  const i = name.indexOf(":");
  if (i < 0) return name.trim();
  const head = name.slice(0, i).trim();
  const tail = name.slice(i + 1).trim();
  return head.length <= 6 && tail ? tail : head;
}

export function fmtKv(kv: number[]): string {
  if (!kv.length) return "–";
  return `${kv.join("/")} kV`;
}

/** Saffir-Simpson label from sustained wind in knots. */
export function stormCategory(kt: number): string {
  if (kt >= 137) return "Cat 5";
  if (kt >= 113) return "Cat 4";
  if (kt >= 96) return "Cat 3";
  if (kt >= 83) return "Cat 2";
  if (kt >= 64) return "Cat 1";
  if (kt >= 34) return "Tropical storm";
  return "Depression";
}

export function stormCategoryShort(kt: number): string {
  const c = stormCategory(kt);
  return c === "Tropical storm" ? "TS" : c === "Depression" ? "TD" : c;
}

export const ACTION_LABEL = {
  new: "New construction",
  rebuild: "Rebuild",
  upgrade: "Equipment upgrade",
} as const;

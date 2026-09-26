"""Overlap engine: DESC x Georgia Power pairs by closest-point distance.

Distances are shapely distances between the two project geometries in UTM 17N
(EPSG:32617), i.e. closest point to closest point, never centre to centre.

Tiers (Sperry Tech):
  crossing  geometries touch or cross (distance 0)   -> must coordinate
  row       < 1.6 km   share right-of-way, access roads, permits
  logistics < 8 km     share laydown yards, deliveries
  crew      < 40 km    share crews & equipment (a crew's morning drive)
Pairs farther than 40 km are ignored.

Build windows (assumption, typical utility schedules): construction ends at the
in-service date and starts BUILD_MONTHS earlier.

Robustness: each geometry carries an uncertainty radius (geometry.py). The pair
is re-tested at distance - (r1 + r2) and distance + (r1 + r2); it is "robust"
when both stay in the same tier, else "uncertain".

Score (0..1), documented formula:
  score = conf * rob * (0.40*T + 0.20*D + 0.25*W + 0.15*S)
  T = tier weight   crossing 1.0, row 0.8, logistics 0.55, crew 0.3
  D = exp(-distance_km / 10)             continuous distance decay
  W = min(1, overlap_months / 12)        build-window overlap
  S = size: mean of min(1, log10(1 + DESC cost in $M) / 2) and a Georgia Power
      voltage factor (500 kV 1.0, 230 kV 0.7, 115 kV 0.5, lower 0.3)
  conf = sqrt(location confidence DESC * location confidence GPC)
  rob = 1.0 robust, 0.9 uncertain
"""

from __future__ import annotations

import calendar
import math
from datetime import date

from shapely.geometry import Point
from shapely.ops import nearest_points

from gridsight.config import TIER_LIMITS_KM
from gridsight.plan.geometry import to_lonlat

TIERS = ["crossing", "row", "logistics", "crew"]
TIER_WEIGHT = {"crossing": 1.0, "row": 0.8, "logistics": 0.55, "crew": 0.3}
BUILD_MONTHS = {
    ("line", "new"): 24,
    ("line", "rebuild"): 12,
    ("line", "upgrade"): 9,
    ("substation", "new"): 18,
    ("substation", "rebuild"): 12,
    ("substation", "upgrade"): 9,
}
MIN_CONFIDENCE = 0.2  # projects at or below this are listed but not scored

SHAREABLE = {
    "crossing": ["outage coordination", "right-of-way", "access roads", "permits", "laydown yard",
                 "material deliveries", "crews", "equipment"],
    "row": ["right-of-way", "access roads", "permits", "laydown yard", "material deliveries", "crews",
            "equipment"],
    "logistics": ["laydown yard", "material deliveries", "crews", "equipment"],
    "crew": ["crews", "equipment"],
}
RIGHT_SIZING = "right-sizing review (FERC Order 1920-A)"


def tier_for(d_km: float, crossing: bool = False) -> str | None:
    if crossing or d_km <= 1e-6:
        return "crossing"
    if d_km < TIER_LIMITS_KM["row"]:
        return "row"
    if d_km < TIER_LIMITS_KM["logistics"]:
        return "logistics"
    if d_km <= TIER_LIMITS_KM["crew"]:
        return "crew"
    return None


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    y += d.year
    m += 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def build_window(kind: str, action: str, in_service: str | None,
                 explicit: tuple[str, str | None] | None = None) -> tuple[str, str] | None:
    months = BUILD_MONTHS.get((kind, action), 12)
    if explicit and explicit[0]:
        start = date.fromisoformat(explicit[0])
        end = date.fromisoformat(explicit[1]) if explicit[1] else add_months(start, months)
        return start.isoformat(), end.isoformat()
    if not in_service:
        return None
    end = date.fromisoformat(in_service)
    return add_months(end, -months).isoformat(), end.isoformat()


def overlap_months(a: tuple[str, str] | None, b: tuple[str, str] | None) -> float:
    if not a or not b:
        return 0.0
    s = max(date.fromisoformat(a[0]), date.fromisoformat(b[0]))
    e = min(date.fromisoformat(a[1]), date.fromisoformat(b[1]))
    return round(max(0.0, (e - s).days / 30.44), 1)


def voltage_factor(kv: list[int]) -> float:
    v = max(kv) if kv else 0
    return 1.0 if v >= 500 else 0.7 if v >= 230 else 0.5 if v >= 115 else 0.3


def size_factor(desc_cost: float | None, gpc_kv: list[int]) -> float:
    c = min(1.0, math.log10(1 + (desc_cost or 0) / 1e6) / 2)
    return (c + voltage_factor(gpc_kv)) / 2


def pair(desc: dict, gpc: dict) -> dict | None:
    """Compare one DESC and one GPC project (dicts with _metric/_radius keys)."""
    ga, gb = desc["_metric"], gpc["_metric"]
    d_km = ga.distance(gb) / 1000.0
    crossing = ga.intersects(gb) and not (ga.geom_type == "Point" and gb.geom_type == "Point")
    tier = tier_for(d_km, crossing)
    if tier is None:
        return None
    pa, pb = nearest_points(ga, gb)
    if crossing:
        inter = ga.intersection(gb)
        pa = pb = inter.representative_point() if not inter.is_empty else pa
    r = desc["_radius"] + gpc["_radius"]
    lo_t = tier_for(max(0.0, d_km - r), crossing and r == 0)
    hi_t = tier_for(d_km + r, crossing and r == 0)
    robust = lo_t == tier and hi_t == tier
    months = overlap_months(desc["buildWindow"], gpc["buildWindow"])
    conf = math.sqrt(desc["locationConfidence"] * gpc["locationConfidence"])
    score = conf * (1.0 if robust else 0.9) * (
        0.40 * TIER_WEIGHT[tier]
        + 0.20 * math.exp(-d_km / 10.0)
        + 0.25 * min(1.0, months / 12.0)
        + 0.15 * size_factor(desc["costUsd"], gpc["voltageKv"])
    )
    shareable = list(SHAREABLE[tier])
    if "rebuild" in (desc["action"], gpc["action"]):
        shareable.append(RIGHT_SIZING)
    lo_a, la_a = to_lonlat(pa.x, pa.y)
    lo_b, la_b = to_lonlat(pb.x, pb.y)
    return {
        "descId": desc["id"],
        "gpcId": gpc["id"],
        "distanceKm": round(d_km, 2),
        "tier": tier,
        "closestPoints": [[round(lo_a, 5), round(la_a, 5)], [round(lo_b, 5), round(la_b, 5)]],
        "timelineOverlapMonths": months,
        "robustness": "robust" if robust else "uncertain",
        "shareable": shareable,
        "score": round(score, 3),
        "_pa": Point(pa.x, pa.y),
        "_pb": Point(pb.x, pb.y),
    }


def find_overlaps(projects: list[dict]) -> tuple[list[dict], int]:
    """All DESC x GPC pairs within 40 km (both projects above MIN_CONFIDENCE)."""
    desc = [p for p in projects if p["utility"] == "DESC" and p["locationConfidence"] > MIN_CONFIDENCE]
    gpc = [p for p in projects if p["utility"] == "GPC" and p["locationConfidence"] > MIN_CONFIDENCE]
    out = []
    for a in desc:
        for b in gpc:
            o = pair(a, b)
            if o:
                out.append(o)
    return out, len(desc) * len(gpc)


def window_str(w: tuple[str, str] | None) -> str:
    if not w:
        return "unknown"
    return f"{date.fromisoformat(w[0]):%b %Y} to {date.fromisoformat(w[1]):%b %Y}"

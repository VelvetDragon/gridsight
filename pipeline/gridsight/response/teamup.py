"""Who should team up for a storm: every transmission owner in the path, not just two.

Scenario model on top of the Monte Carlo (simulate.py). All sums are expectations, so
they come straight from the per-segment means the simulation already saved; no extra
GPU run is needed.

Per owner (OSM ``operator`` tag, grouped; Dominion / Georgia Power by attribution):
    damagedSections   expected failed ~1 km line sections (wind or trees), sum of p_seg
    workHours         crew-hours of repair: failed structures x REPAIR_HOURS + tree
                      strikes x TREE_SPAN_HOURS
    crews             transmission storm crews for the part of its network on the map,
                      scaled by line km from the Dominion and Georgia Power workforce
                      figures (mutual_aid.py)
    hoursAlone        workHours / crews: hours of work per crew if nobody helps

Moves, ranked by hours saved for the utility that receives help:
    lend crews     a utility with spare crews (finishes its own work within KEEP_HOURS
                   and keeps at least half its crews home) lends to the nearest utility
                   that would need more than NEED_HOURS alone; help works at
                   CROSS_EFFICIENCY on another utility's assets.
    share a yard   two hit utilities whose damaged sections come within 8 km
    share crews    ... within 40 km (the same tiers Crosswire uses for planned projects)

Cost of lent crews: BLS median line-worker wage x storm overtime x crew size, plus per
diem, for the hours worked plus the drive both ways. Listed as assumptions.

Output: public/data/response/<storm>/teamup.json
"""

from __future__ import annotations

import argparse
import re

import numpy as np
import pandas as pd

from gridsight.config import RESPONSE_OUT
from gridsight.response import mutual_aid, simulate
from gridsight.response.common import haversine_km, write_json
from gridsight.response.storms import resolve

OWNERS = [
    # id, name, operator pattern (DESC / GPC come from the network attribution)
    ("desc", "Dominion Energy SC", None),
    ("georgia-power", "Georgia Power", None),
    ("duke", "Duke Energy", r"duke"),
    ("santee-cooper", "Santee Cooper", r"santee|public service authority"),
    ("tva", "Tennessee Valley Authority", r"tennessee valley|\btva\b"),
    ("alabama-power", "Alabama Power", r"alabama power"),
    ("fpl", "Florida Power & Light", r"florida power|\bfpl\b"),
    ("jea", "JEA", r"jacksonville electric|\bjea\b"),
    ("gtc", "Georgia Transmission", r"georgia transmission"),
    ("meag", "MEAG Power", r"\bmeag\b|municipal electric authority"),
    ("powersouth", "PowerSouth", r"powersouth"),
    ("epb", "EPB Chattanooga", r"\bepb\b|electric power board"),
    ("coops", "Electric co-ops (EMCs)", r"\bemc\b|electric membership|cooperative|co-op"),
]
NAME = {i: n for i, n, _ in OWNERS}

TREE_SPAN_HOURS = 6.0  # crew-hours to clear a fallen tree and re-string one span (assumption)
KEEP_HOURS = 24.0  # a lender keeps enough crews to finish its own work within a day
KEEP_SHARE = 0.5  # and never sends more than half its crews
NEED_HOURS = 24.0  # a utility needs help when its crews alone need more than a day
MIN_SECTIONS = 1.0  # owners with less expected damage are listed as not hit
MIN_KM = 1000.0  # below this much line on the map, crew numbers are too uncertain to lend or receive
DAMAGED_P = 0.2  # a section counts as damaged for the yard / crew tiers at p >= 0.2
YARD_KM, CREW_KM = 8.0, 40.0
DRIVE_KMH = 80.0  # highway average; straight line x ROAD_FACTOR
ROAD_FACTOR = 1.3
WAGE_USD_H = 44.50  # BLS OEWS May 2024 median, electrical power-line installers (49-9051)
OVERTIME = 1.5  # storm work is paid at time and a half or more
PER_DIEM_USD = 75.0  # per worker per day
SOURCES = {
    "wage": "https://www.bls.gov/oes/current/oes499051.htm",
    "stormPay": "https://www.powerlinemanjobs.com/storm-pay-for-linemen-how-much-linemen-make-chasing-storms",
    "workforce": mutual_aid.SOURCES,
}


def owner_of(seg: pd.DataFrame) -> pd.Series:
    out = pd.Series(np.where(seg["utility"] == "DESC", "desc", np.where(seg["utility"] == "GPC", "georgia-power", "")),
                    index=seg.index, dtype=object)
    op = seg["operator"].fillna("").str.lower()
    for oid, _, pat in OWNERS:
        if pat:
            out[(out == "") & op.str.contains(pat, regex=True)] = oid
    return out


def crews_per_km(seg: pd.DataFrame) -> float:
    """Transmission storm crews per km of line, from the two published workforces."""
    km = seg.groupby("utility")["length_km"].sum()
    crews = (mutual_aid.DESC_WORKFORCE + mutual_aid.GPC_WORKFORCE) * mutual_aid.TRANSMISSION_SHARE / mutual_aid.CREW_SIZE
    return crews / float(km.get("DESC", 0) + km.get("GPC", 0))


def drive_hours(a: tuple[float, float], b: tuple[float, float]) -> float:
    return float(haversine_km(a[0], a[1], b[0], b[1])) * ROAD_FACTOR / DRIVE_KMH


def crew_cost(crews: float, hours: float, drive_h: float) -> dict:
    """Line-by-line cost of lent crews: workers x paid hours x storm wage, plus per diem.

    Crews work in 16-hour storm shifts, so one day of per diem covers 16 paid hours.
    """
    workers = round(crews) * mutual_aid.CREW_SIZE
    paid = hours + 2 * drive_h
    days = max(1.0, paid / 16.0)
    labor = workers * paid * WAGE_USD_H * OVERTIME
    diem = workers * days * PER_DIEM_USD
    return {
        "crews": round(crews), "workersPerCrew": mutual_aid.CREW_SIZE, "workers": workers,
        "workHours": round(hours, 1), "driveHoursBothWays": round(2 * drive_h, 1), "paidHours": round(paid, 1),
        "wageUsdH": WAGE_USD_H, "overtime": OVERTIME, "stormWageUsdH": round(WAGE_USD_H * OVERTIME, 2),
        "days": round(days, 1), "perDiemUsd": PER_DIEM_USD,
        "laborUsd": round(labor, -2), "perDiemTotalUsd": round(diem, -2), "totalUsd": round(labor + diem, -3),
    }


def owners_table(seg: pd.DataFrame) -> pd.DataFrame:
    seg = seg.assign(owner=owner_of(seg))
    seg = seg[seg.owner != ""]
    seg = seg.assign(
        work=seg["e_struct"] * seg["structure"].map(mutual_aid.REPAIR_HOURS).fillna(12.0)
        + seg["tree_spans"] * TREE_SPAN_HOURS,
        w=seg["p_seg"],
    )
    per_km = crews_per_km(seg)
    rows = []
    for oid, g in seg.groupby("owner"):
        w = g["w"].to_numpy()
        home = (float(g.mid_lon.mean()), float(g.mid_lat.mean()))
        hit = (float((g.mid_lon * w).sum() / w.sum()), float((g.mid_lat * w).sum() / w.sum())) if w.sum() > 0 else home
        crews = max(1.0, float(g["length_km"].sum()) * per_km)
        work = float(g["work"].sum())
        rows.append({
            "id": oid, "name": NAME[oid], "lineKm": round(float(g["length_km"].sum())),
            "damagedSections": round(float(w.sum()), 1), "workHours": round(work),
            "crews": round(crews), "hoursAlone": round(work / crews, 1),
            "home": home, "damageCenter": hit,
            "strongWindShare": round(float((g["gust_mph"] >= 58).mean()), 3),
        })
    return pd.DataFrame(rows).set_index("id").sort_values("damagedSections", ascending=False)


def lend_moves(t: pd.DataFrame) -> list[dict]:
    t = t.copy()
    t["spare"] = np.where(
        t.hoursAlone <= KEEP_HOURS,
        np.minimum(t.crews * KEEP_SHARE, t.crews - t.workHours / KEEP_HOURS).clip(lower=0),
        0.0,
    )
    t["have"] = t.crews.astype(float)
    moves = []
    t.loc[t.lineKm < MIN_KM, "spare"] = 0.0
    need = t[(t.hoursAlone > NEED_HOURS) & (t.damagedSections >= MIN_SECTIONS) & (t.lineKm >= MIN_KM)]
    for rid in need.sort_values("workHours", ascending=False).index:  # most work first
        r = t.loc[rid]
        donors = sorted(
            [d for d in t.index if d != rid and t.loc[d, "spare"] >= 1],
            key=lambda d: drive_hours(t.loc[d, "home"], r["damageCenter"]),
        )
        for did in donors:
            need = r.workHours / NEED_HOURS - t.loc[rid, "have"]  # crews to finish in a day
            if need <= 0:
                break
            give = float(min(t.loc[did, "spare"], need / mutual_aid.CROSS_EFFICIENCY))
            if give < 1:
                continue
            before = r.workHours / t.loc[rid, "have"]
            t.loc[rid, "have"] += give * mutual_aid.CROSS_EFFICIENCY
            t.loc[did, "spare"] -= give
            after = r.workHours / t.loc[rid, "have"]
            dh = drive_hours(t.loc[did, "home"], r["damageCenter"])
            cost = crew_cost(give, after, dh)
            moves.append({
                "kind": "lend", "from": did, "to": rid, "crews": round(give),
                "receiverCrews": round(float(t.loc[rid, "have"] - give * mutual_aid.CROSS_EFFICIENCY)),
                "receiverWorkHours": round(float(r.workHours)),
                "efficiency": mutual_aid.CROSS_EFFICIENCY,
                "hoursBefore": round(float(before), 1), "hoursAfter": round(float(after), 1),
                "cost": cost,
                "path": [[round(v, 4) for v in t.loc[did, "home"]], [round(v, 4) for v in r["damageCenter"]]],
                "driveHours": round(dh, 1), "hoursSooner": round(before - after - dh, 1),
                "costUsd": cost["totalUsd"],
                "why": f"{NAME[did]} can finish its own repairs within a day and still send {round(give)} crews; "
                       f"{NAME[rid]} would need {before:.0f} hours alone.",
            })
    return [m for m in moves if m["hoursSooner"] > 0]


def shared_moves(seg: pd.DataFrame, t: pd.DataFrame) -> list[dict]:
    seg = seg.assign(owner=owner_of(seg))
    hot = seg[(seg.owner != "") & (seg.p_seg >= DAMAGED_P)]
    ids = [i for i in t.index if t.loc[i, "damagedSections"] >= MIN_SECTIONS and i in set(hot.owner)]
    out = []
    for i, a in enumerate(ids):
        pa = hot[hot.owner == a][["mid_lon", "mid_lat"]].to_numpy()
        for b in ids[i + 1:]:
            pb = hot[hot.owner == b][["mid_lon", "mid_lat"]].to_numpy()
            d = haversine_km(pa[:, None, 0], pa[:, None, 1], pb[None, :, 0], pb[None, :, 1])
            k = int(np.argmin(d))
            km = float(d.flat[k])
            if km > CREW_KM:
                continue
            ia, ib = np.unravel_index(k, d.shape)
            near = int((d.min(axis=1) <= CREW_KM).sum() + (d.min(axis=0) <= CREW_KM).sum())
            where = [round(float((pa[ia, 0] + pb[ib, 0]) / 2), 4), round(float((pa[ia, 1] + pb[ib, 1]) / 2), 4)]
            kind = "yard" if km <= YARD_KM else "crews"
            out.append({
                "kind": kind, "a": a, "b": b, "distanceKm": round(km, 1), "sectionsNearby": near, "at": where,
                "why": (f"Damage on both systems comes within {km:.1f} km: one staging yard can serve both."
                        if kind == "yard" else
                        f"Damage on both systems is {km:.0f} km apart: crews working one can reach the other."),
            })
    return sorted(out, key=lambda m: (m["kind"] != "yard", -m["sectionsNearby"]))


def build(storm: str) -> dict:
    sim = simulate.load(storm, "best")
    t = owners_table(sim.seg)
    lend = lend_moves(t)
    shared = shared_moves(sim.seg, t[t.lineKm >= MIN_KM])
    owners = []
    for oid, r in t.iterrows():
        if r.lineKm < 20:
            continue
        owners.append({
            "id": oid, "name": r["name"], "lineKm": int(r.lineKm), "damagedSections": float(r.damagedSections),
            "workHours": int(r.workHours), "crews": int(r.crews), "hoursAlone": float(r.hoursAlone),
            "strongWindShare": float(r.strongWindShare),
            "damageCenter": [round(v, 4) for v in r.damageCenter],
            "role": "little on this map" if r.lineKm < MIN_KM
            else "needs help" if r.hoursAlone > NEED_HOURS and r.damagedSections >= MIN_SECTIONS
            else ("can help" if r.hoursAlone <= KEEP_HOURS else "busy"),
        })
    return {
        "storm": storm,
        "owners": owners,
        "moves": sorted(lend, key=lambda m: -m["hoursSooner"]) + shared,
        "assumptions": [
            f"Crews: {mutual_aid.DESC_WORKFORCE:,} (Dominion) + {mutual_aid.GPC_WORKFORCE:,} (Georgia Power) storm workers, "
            f"{mutual_aid.TRANSMISSION_SHARE:.0%} on transmission, {mutual_aid.CREW_SIZE} per crew, spread by line km; "
            "other utilities get the same crews per km for the part of their network on this map.",
            f"Repair: {mutual_aid.REPAIR_HOURS['pole']:.0f} crew-hours per wood pole, {mutual_aid.REPAIR_HOURS['lattice']:.0f} per steel tower, "
            f"{TREE_SPAN_HOURS:.0f} per span hit by a tree.",
            f"A utility lends only if it can finish its own work within {KEEP_HOURS:.0f} h and keeps at least half its crews; "
            f"lent crews work at {mutual_aid.CROSS_EFFICIENCY:.0%} on another utility's assets.",
            f"Drive: straight line x {ROAD_FACTOR} at {DRIVE_KMH:.0f} km/h.",
            f"Cost: ${WAGE_USD_H:.2f}/h median line-worker wage (BLS, May 2024) x {OVERTIME} storm overtime, "
            f"{mutual_aid.CREW_SIZE} per crew, ${PER_DIEM_USD:.0f} per diem per worker-day; equipment not included.",
            "Transmission owners come from OpenStreetMap operator tags; lines without an operator tag are left out.",
        ],
        "sources": SOURCES,
    }


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Who should team up: every owner in the storm's path")
    ap.add_argument("--storm", default="published")
    a = ap.parse_args(argv)
    for spec in resolve(a.storm):
        if not spec.publish:
            continue
        out = build(spec.key)
        write_json("teamup.json", out, RESPONSE_OUT / spec.key)
        hit = [f"{o['name']} {o['damagedSections']:.0f} ({o['role']})" for o in out["owners"][:5]]
        print(f"{spec.key}: {'; '.join(hit)} | {len(out['moves'])} moves")


if __name__ == "__main__":
    main()

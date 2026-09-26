"""Mutual-aid restoration scenario model: separate vs coordinated DESC / GPC response.

This is a scenario model, not a prediction. It takes the simulated transmission damage
(expected failed structures per segment, best-track run) and schedules repairs with a
simple, transparent greedy list scheduler under two staging / dispatch rules. Every
number that is not measured is an explicit assumption listed in the output.

Output: public/data/response/<storm>/mutual-aid.json

    {
      "scenarios": {
        "separate":    Scenario,
        "coordinated": Scenario
      },
      "savedHours": {                      // separate minus coordinated (null if n/a)
        "to50pct": number | null,
        "to90pct": number | null,
        "to100pct": number | null,
        "vulnerableTo90pct": number | null
      },
      "assumptions": string[]
    }

    Scenario = {
      "hoursTo50pct": number | null,       // hours after restoration starts until 50 %
      "hoursTo90pct": number | null,       //   of expected damaged segments are repaired
      "hoursTo100pct": number | null,
      "vulnerableHoursTo90pct": number | null,  // same, weighted by electricity-dependent residents
      "restorationCurve": [{"hour": number, "pctRestored": number}]   // pct is 0-100
    }

Work: every DESC / GPC segment with expected failed structures >= MIN_STRUCTURES. Segments
inside a repair zone form one work item per zone and utility; the rest form one item per
county and utility, located at the damage-weighted centroid. Each item is split into
jobs of about one structure. Job crew-hours = structures x REPAIR_HOURS[structure type].

Staging:
    own-side yards   the OSM city/town in the utility's own state (DESC: SC, GPC: GA)
                     nearest to each work item.
    joint yards      yards.json (shared staging next to both utilities' work).
Travel: OSRM drive time (router.project-osrm.org, cached) from the item's yard to the
item, driven there and back for every job.

Scenarios:
    separate     each utility's crews repair only their own assets and stage only at
                 their own-side yards.
    coordinated  shared staging: both utilities can use every own-side yard and every
                 joint yard (bridges make the other side reachable), and mutual aid:
                 a free crew takes the next job from either utility, at CROSS_EFFICIENCY
                 productivity on the other utility's assets.
Both scenarios use the same priority order (electricity-dependent residents per
crew-hour of work, then size), so the difference comes only from staging and mutual aid.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math

import numpy as np
import pandas as pd

from gridsight.config import RESPONSE_OUT
from gridsight.response import simulate, vulnerable, zones
from gridsight.response.common import haversine_km, write_json
from gridsight.response.geo import county_of
from gridsight.response.storms import STORMS, resolve
from gridsight.response.yards import candidates, osrm_minutes

# ---- assumptions (all listed in the output) ----
DESC_WORKFORCE = 4000  # "more than 4,000 crew members", Dominion Energy, 2024-10-09 (Helene)
GPC_WORKFORCE = 20000  # "20,000+ personnel", Georgia Power Helene anniversary release
TRANSMISSION_SHARE = 0.05  # share of the storm workforce on transmission line work
CREW_SIZE = 5
REPAIR_HOURS = {"pole": 12.0, "lattice": 48.0}  # crew-hours per failed structure
CROSS_EFFICIENCY = 0.85  # productivity on the other utility's assets (standards, escorts)
MIN_STRUCTURES = 0.01
VULN_RADIUS_KM = 15.0
FALLBACK_KMH = 50.0  # if OSRM has no route: straight-line x 1.3 at 50 km/h
SOURCES = {
    "desc": "https://news.dominionenergy.com/press-releases/press-releases/2024/Dominion-Energy-Substantially-Completes-Hurricane-Helene-Power-Restoration-in-Hardest-Hit-Communities-10-09-2024/default.aspx",
    "gpc": "https://www.georgiapower.com/news-hub/press-releases/anniversary-of-hurricane-helene-reinforces-importance-of-severe-weather-preparedness.html",
}
STATE_OF = {"DESC": "SC", "GPC": "GA"}


def crews() -> dict[str, int]:
    return {
        "DESC": max(1, round(DESC_WORKFORCE * TRANSMISSION_SHARE / CREW_SIZE)),
        "GPC": max(1, round(GPC_WORKFORCE * TRANSMISSION_SHARE / CREW_SIZE)),
    }


def work_items(seg: pd.DataFrame, members: pd.DataFrame, zlist: list[dict], vuln: pd.DataFrame) -> pd.DataFrame:
    s = seg[seg.utility.isin(["DESC", "GPC"]) & (seg.e_struct >= MIN_STRUCTURES)].copy()
    s["zone"] = members["zone"].reindex(s.index) if "zone" in members else np.nan
    s["hours"] = s["e_struct"] * s["structure"].map(REPAIR_HOURS)
    s["key"] = np.where(s["zone"].notna(), s["zone"].astype(str), "C" + s["fips"].astype(str))
    zpeople = {z["id"]: z["vulnerablePeople"] for z in zlist}
    rows = []
    for (key, util), g in s.groupby(["key", "utility"]):
        w = g["e_struct"].to_numpy()
        lon = float((g.mid_lon * w).sum() / w.sum())
        lat = float((g.mid_lat * w).sum() / w.sum())
        rows.append({"key": key, "utility": util, "lon": lon, "lat": lat,
                     "structures": float(w.sum()), "segments": float(g["p_seg"].sum()),
                     "hours": float(g["hours"].sum())})
    items = pd.DataFrame(rows)
    if items.empty:
        return items
    # electricity-dependent residents: zone total split by work share, else ZIPs within radius
    people = []
    for r in items.itertuples():
        if r.key in zpeople:
            tot = items.loc[items.key == r.key, "hours"].sum()
            people.append(zpeople[r.key] * r.hours / max(tot, 1e-9))
        else:
            d = haversine_km(vuln.lon.to_numpy(), vuln.lat.to_numpy(), r.lon, r.lat)
            people.append(float(vuln.loc[d <= VULN_RADIUS_KM, "electricityDependent"].sum()))
    items["people"] = people
    return items.reset_index(drop=True)


def own_side_yards(items: pd.DataFrame) -> pd.DataFrame:
    """Nearest OSM city/town in each item's own state."""
    c = candidates()
    towns = c[c.kind != "bridge"].copy()
    towns["state"] = [{"13": "GA", "45": "SC"}.get(f[:2], "") for f in county_of(towns.lon.to_numpy(), towns.lat.to_numpy())]
    out = []
    for r in items.itertuples():
        t = towns[towns.state == STATE_OF[r.utility]]
        d = haversine_km(t.lon.to_numpy(), t.lat.to_numpy(), r.lon, r.lat)
        k = int(np.argmin(d))
        out.append((t.iloc[k].label, float(t.iloc[k].lon), float(t.iloc[k].lat)))
    return pd.DataFrame(out, columns=["yard", "ylon", "ylat"], index=items.index)


def drive_hours(yard_pos: dict[str, tuple], items: pd.DataFrame, pairs: list[tuple[str, int]]) -> dict:
    """OSRM drive hours for (yard label, item index) pairs, one table call per yard."""
    by_yard: dict[str, list[int]] = {}
    for y, i in pairs:
        by_yard.setdefault(y, []).append(i)
    out = {}
    for y, idx in by_yard.items():
        idx = sorted(set(idx))
        for k in range(0, len(idx), 80):
            chunk = idx[k : k + 80]
            dests = items.loc[chunk, ["lon", "lat"]].values.tolist()
            try:
                m = osrm_minutes([list(yard_pos[y])], dests)[0]
            except Exception as exc:  # routing unavailable: documented fallback
                print(f"  OSRM failed for {y}: {exc}")
                m = np.full(len(chunk), np.nan)
            for i, mm in zip(chunk, m):
                if not np.isfinite(mm):
                    km = haversine_km(yard_pos[y][0], yard_pos[y][1], items.at[i, "lon"], items.at[i, "lat"]) * 1.3
                    mm = km / FALLBACK_KMH * 60
                out[(y, i)] = float(mm) / 60.0
    return out


def schedule(
    items: pd.DataFrame,
    travel: dict[tuple[str, int], float],
    ncrew: dict[str, int],
    yards: dict[tuple[int, str], list[str]],
    mutual_aid: bool,
):
    """Greedy list scheduling. Returns sorted completion events (time, segments, people).

    Jobs are taken in priority order. Each job goes to the crew that would finish it
    first: the earliest-free crew of the job's utility or, with mutual aid, the
    earliest-free crew of the other utility (ties go to the owner). Job time =
    2 x drive from the best allowed yard + crew-hours / productivity.
    """
    jobs = []
    for i, r in items.iterrows():
        n = max(1, math.ceil(r.structures - 1e-9))
        prio = r.people / max(r.hours, 1e-9)
        for _ in range(n):
            jobs.append({"item": i, "utility": r.utility, "hours": r.hours / n,
                         "segments": r.segments / n, "people": r.people / n, "prio": prio, "size": r.structures})
    jobs.sort(key=lambda j: (-j["prio"], -j["size"]))
    free = {u: [0.0] * ncrew[u] for u in ("DESC", "GPC")}
    for u in free:
        heapq.heapify(free[u])
    events = []
    for job in jobs:
        ju = job["utility"]
        tr = min(travel[(y, job["item"])] for y in yards[(job["item"], ju)])
        best_u, best_done = ju, free[ju][0] + 2 * tr + job["hours"]
        if mutual_aid:
            other = "GPC" if ju == "DESC" else "DESC"
            done_other = free[other][0] + 2 * tr + job["hours"] / CROSS_EFFICIENCY
            if done_other < best_done - 1e-9:
                best_u, best_done = other, done_other
        heapq.heapreplace(free[best_u], best_done)
        events.append((best_done, job["segments"], job["people"]))
    return sorted(events)


def summarize(events, total_seg: float, total_people: float) -> dict:
    if not events or total_seg <= 0:
        return {"hoursTo50pct": None, "hoursTo90pct": None, "hoursTo100pct": None,
                "vulnerableHoursTo90pct": None, "restorationCurve": []}
    t = np.array([e[0] for e in events])
    cs = np.cumsum([e[1] for e in events]) / total_seg
    cp = np.cumsum([e[2] for e in events]) / total_people if total_people > 0 else None

    def first(frac, arr):
        k = np.searchsorted(arr, frac - 1e-9)
        return round(float(t[min(k, len(t) - 1)]), 1)

    end = float(t[-1])
    step = 1 if end <= 240 else (2 if end <= 480 else 6)
    hours = np.arange(0, math.ceil(end) + step, step)
    idx = np.searchsorted(t, hours, side="right")
    pct = np.where(idx > 0, cs[np.maximum(idx - 1, 0)], 0.0) * 100
    return {
        "hoursTo50pct": first(0.5, cs),
        "hoursTo90pct": first(0.9, cs),
        "hoursTo100pct": round(end, 1),
        "vulnerableHoursTo90pct": first(0.9, cp) if cp is not None else None,
        "restorationCurve": [{"hour": int(h), "pctRestored": round(float(p), 1)} for h, p in zip(hours, pct)],
    }


def run_storm(key: str) -> dict:
    sim = simulate.load(key, "best")
    vuln = vulnerable.load()
    zlist, members = zones.build_zones(sim.seg, vuln)
    yards_path = RESPONSE_OUT / key / "yards.json"
    joint = json.loads(yards_path.read_text()) if yards_path.exists() else []
    items = work_items(sim.seg, members, zlist, vuln)
    n = crews()
    assumptions = [
        f"Scenario model, not a prediction: schedules the simulated transmission damage (best-track run, {sim.sims} simulations, expected failed structures) with a greedy list scheduler.",
        f"Crews: DESC {n['DESC']}, GPC {n['GPC']} transmission crews = public Helene storm workforce (DESC more than {DESC_WORKFORCE:,} crew members, Dominion Energy 2024-10-09; GPC {GPC_WORKFORCE:,}+ personnel, Georgia Power) x {TRANSMISSION_SHARE:.0%} assumed on transmission / {CREW_SIZE} people per crew. The same crews are used for every storm.",
        f"Repair time: {REPAIR_HOURS['pole']:.0f} crew-hours per failed pole structure, {REPAIR_HOURS['lattice']:.0f} per failed lattice tower (assumed).",
        "Hour 0 = restoration start after the storm passes; mobilization, damage assessment, tree clearing and distribution work are not modeled.",
        "Travel: OSRM drive time from the staging yard to the work, driven there and back for every job (straight line x 1.3 at 50 km/h if no route).",
        "Separate: each utility repairs only its own assets and stages only at the nearest city/town on its own side (DESC in SC, GPC in GA).",
        f"Coordinated: shared staging at every own-side town and the joint yards in yards.json ({len(joint)} for this storm), and mutual aid: a free crew takes the next job from either utility, at {CROSS_EFFICIENCY:.0%} productivity on the other utility's assets (assumed).",
        "Both scenarios use the same priority order (electricity-dependent residents per crew-hour, then size), so savings come only from staging and mutual aid.",
        f"Work covers DESC/GPC segments with at least {MIN_STRUCTURES} expected failed structures; OTHER owners' lines are excluded. Percent restored counts expected damaged segments.",
    ]
    if items.empty or items.structures.sum() < 0.5:
        res = summarize([], 0, 0)
        out = {"scenarios": {"separate": res, "coordinated": res},
               "savedHours": {"to50pct": None, "to90pct": None, "to100pct": None, "vulnerableTo90pct": None},
               "assumptions": assumptions + ["This storm has less than one expected failed DESC/GPC transmission structure, so there is nothing to schedule."]}
        write_json("mutual-aid.json", out, RESPONSE_OUT / key)
        return out
    own = own_side_yards(items)
    yard_pos = {r.yard: (r.ylon, r.ylat) for r in own.itertuples()}
    for y in joint:
        yard_pos[f"joint:{y['id']}"] = tuple(y["position"])
    # own-side yard of each utility nearest to each item (for coordinated cross work)
    own_by_util = {}
    for u in ("DESC", "GPC"):
        tmp = items.assign(utility=u)
        o = own_side_yards(tmp)
        for i, r in o.iterrows():
            own_by_util[(i, u)] = r.yard
            yard_pos[r.yard] = (r.ylon, r.ylat)
    sep, coord = {}, {}
    pairs = set()
    for i, r in items.iterrows():
        for u in ("DESC", "GPC"):
            sep[(i, u)] = [own.at[i, "yard"]] if u == r.utility else [own_by_util[(i, u)]]
            near_joint = [f"joint:{y['id']}" for y in joint
                          if haversine_km(y["position"][0], y["position"][1], r.lon, r.lat) <= 90]
            coord[(i, u)] = sorted({own_by_util[(i, "DESC")], own_by_util[(i, "GPC")], *near_joint})
            for y in sep[(i, u)] + coord[(i, u)]:
                pairs.add((y, i))
    travel = drive_hours(yard_pos, items, sorted(pairs))
    total_seg = float(items.segments.sum())
    total_people = float(items.people.sum())
    res = {
        "separate": summarize(schedule(items, travel, n, sep, mutual_aid=False), total_seg, total_people),
        "coordinated": summarize(schedule(items, travel, n, coord, mutual_aid=True), total_seg, total_people),
    }
    # decomposition: shared staging only (no mutual aid), reported in the assumptions
    so = summarize(schedule(items, travel, n, coord, mutual_aid=False), total_seg, total_people)

    def saved(k):
        a, b = res["separate"][k], res["coordinated"][k]
        return None if a is None or b is None else round(a - b, 1)

    out = {
        "scenarios": res,
        "savedHours": {"to50pct": saved("hoursTo50pct"), "to90pct": saved("hoursTo90pct"),
                       "to100pct": saved("hoursTo100pct"), "vulnerableTo90pct": saved("vulnerableHoursTo90pct")},
        "assumptions": assumptions + [
            f"Work items: {len(items)} ({items.structures.sum():.1f} expected failed structures: DESC {items.loc[items.utility == 'DESC', 'structures'].sum():.1f}, GPC {items.loc[items.utility == 'GPC', 'structures'].sum():.1f}).",
            f"Shared staging alone (no mutual aid) reaches 90 % at {so['hoursTo90pct']} h and 100 % at {so['hoursTo100pct']} h, vs {res['separate']['hoursTo90pct']} h and {res['separate']['hoursTo100pct']} h separate.",
        ],
    }
    write_json("mutual-aid.json", out, RESPONSE_OUT / key)
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Mutual-aid restoration scenarios (separate vs coordinated)")
    ap.add_argument("--storm", default="published")
    a = ap.parse_args(argv)
    for spec in resolve(a.storm):
        if not spec.publish:
            continue
        out = run_storm(spec.key)
        s, c = out["scenarios"]["separate"], out["scenarios"]["coordinated"]
        print(f"{spec.key}: separate 90% {s['hoursTo90pct']} h / 100% {s['hoursTo100pct']} h; "
              f"coordinated 90% {c['hoursTo90pct']} h / 100% {c['hoursTo100pct']} h; saved {out['savedHours']}")


if __name__ == "__main__":
    main()

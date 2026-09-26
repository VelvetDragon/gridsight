"""Build the Plan-mode dataset.

Usage (from the repo root or from pipeline/):
    python -m gridsight.plan.build            # full run
    python -m gridsight.plan.build --no-roads # skip OSRM calls (roadKm/stagingYard = null)

Writes public/data/plan/{projects,overlaps,meta}.json and
public/data/context/{transmission-lines,savannah-river}.geojson.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from datetime import date, datetime, timezone

from gridsight import osm
from gridsight.config import PLAN_OUT, UTILITIES
from gridsight.plan import context, cost, gpc_web, parse_desc, parse_sertp, roads
from gridsight.plan.geocode import Gazetteer, Located, county_point, km, locate, normalize, region_centers
from gridsight.plan.geometry import LineNetwork, build as build_geometry, to_metric
from gridsight.plan.overlap import MIN_CONFIDENCE, build_window, find_overlaps, window_str
from gridsight.plan.records import RawProject

FERC_SOURCE = {
    "document": "FERC Order No. 1920-A news release",
    "url": "https://www.ferc.gov/news-events/news/ferc-strengthens-order-no-1920-expanded-state-provisions",
    "page": None,
}
OTHER_SOURCES = [
    {"document": "OpenStreetMap power infrastructure via Overpass API (substations, plants, power lines)",
     "url": "https://www.openstreetmap.org/copyright", "page": None},
    {"document": "US Census Bureau 2023 cartographic state boundaries (cb_2023_us_state_500k)",
     "url": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip", "page": None},
    {"document": "USGS GNIS Domestic Names, South Carolina and Georgia (populated places, crossings)",
     "url": "https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/", "page": None},
    {"document": "US Census Bureau 2023 Gazetteer, counties (internal points, land area)",
     "url": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip",
     "page": None},
    {"document": "USDA NASS Land Values 2025 Summary (farm real estate value per acre)", "url": cost.NASS_URL, "page": 9},
    {"document": "MISO Transmission Cost Estimation Guide for MTEP24 (land, acquisition and permitting per acre)",
     "url": cost.MISO24_URL, "page": 8},
    {"document": "MISO Transmission and Substation Project Cost Estimation Guide for MTEP 2018 (mobilization/demobilization)",
     "url": cost.MISO18_URL, "page": 16},
    {"document": "Georgia Transmission Corp.: Transmission Line Heights and Easement Widths", "url": cost.GTC_URL,
     "page": 1},
    {"document": "Georgia Power: certification request for ~9,900 MW of new resources (July 31, 2025)",
     "url": gpc_web.PRESS, "page": None},
    {"document": "OSRM public demo server (road distances and drive times)", "url": roads.OSRM, "page": None},
    FERC_SOURCE,
]

ALL_STATES = ("GA", "SC", "AL", "MS", "FL", "TN", "NC")


def _route(p: RawProject) -> list[str]:
    return p.route or p.places


def _key(p: RawProject) -> frozenset:
    return frozenset(normalize(x) for x in _route(p) if normalize(x))


def geocode_all(gaz: Gazetteer, projects: list[RawProject], zones: dict) -> dict[str, object]:
    out = {}
    for p in projects:
        if p.county:
            # Only a county is public (e.g. the new Effingham County substation); an OSM site
            # that happens to share the county's name is a different, existing facility.
            out[p.id] = Located()
            continue
        if p.utility == "DESC":
            home, allowed = "SC", ("SC", "GA")
        elif p.zone == "SAV":
            home, allowed = "GA", ("GA", "SC")  # tagged Savannah area: Georgia Power in Georgia
        elif p.owner == "SOCO" and p.id.startswith("gpc-sertp"):
            home, allowed = "", ALL_STATES  # decide Georgia vs Alabama/Mississippi from the match
        else:
            home, allowed = "GA", ("GA", "SC", "AL", "FL")
        loc = locate(gaz, _route(p), home=home, allowed=allowed, miles=p.miles,
                     zone_center=zones.get(p.zone) if p.zone else None)
        if not loc.matches and p.extra_places:
            loc = locate(gaz, p.extra_places[:2], home=home, allowed=allowed, miles=p.miles)
            if loc.matches:
                p.notes.append("Located from places named in the description.")
        out[p.id] = loc
    return out


def soco_in_georgia(p: RawProject, loc, gaz: Gazetteer) -> str:
    """'GA' when a SOCO SERTP project lands in Georgia; else a reason to exclude."""
    states = [m.site.state for m in loc.matches if m.method == "site"]
    if not states or len(states) < len(_route(p)):
        # every named site must be found, otherwise a same-named site elsewhere could pass
        return "unlocated" if not any(s != "GA" for s in states) else "outside Georgia"
    if "MS" in states or not any(s == "GA" for s in states):
        return "outside Georgia"
    if len(loc.matches) == 1:
        # single-site name: reject if an equally good match exists outside Georgia
        best = loc.matches[0]
        rivals = [s for sc, s in gaz.candidates(best.place, "", ALL_STATES) if sc >= best.score and s.state != "GA"]
        if rivals:
            return "ambiguous state"
    return "GA"


def to_project(p: RawProject, built, bw, unmatched: list[str]) -> dict:
    desc = p.description
    for n in p.notes:
        desc += f" {n}"
    conf = built.confidence if built else 0.1
    if built is None or not built.geometry:
        conf = min(conf, 0.2)
    if unmatched and conf <= MIN_CONFIDENCE:
        desc += f" [Location not found for: {', '.join(unmatched)}; excluded from overlap scoring.]"
    elif unmatched:
        desc += f" [Not located: {', '.join(unmatched)}.]"
    return {
        "id": p.id,
        "utility": p.utility,
        "owner": p.owner,
        "name": p.name,
        "kind": p.kind,
        "action": p.action,
        "description": re.sub(r"\s+", " ", desc).strip(),
        "voltageKv": p.voltage_kv,
        "miles": p.miles,
        "places": p.places,
        "inService": p.in_service,
        "buildWindow": list(bw) if bw else None,
        "costUsd": p.cost_usd,
        "status": p.status,
        "state": p.state,
        "geometry": built.geometry if built else None,
        "geometryQuality": built.quality if built else "point",
        "locationConfidence": round(conf, 2),
        "source": {"document": p.source_document, "url": p.source_url, "page": p.source_page},
    }


def _fallback_point(utility: str) -> dict:
    # Unlocated projects still need a geometry; they sit at the utility's state
    # capital (Columbia SC / Atlanta GA) with confidence <= 0.2 and are never scored.
    lon, lat = (-81.0348, 34.0007) if utility == "DESC" else (-84.388, 33.749)
    return {"type": "Point", "coordinates": [lon, lat]}


def near_place(gaz: Gazetteer, lon: float, lat: float) -> str | None:
    best = None
    for s in gaz.places:
        if not s.kind.endswith(("city", "town", "village")):
            continue
        d = km((lon, lat), s)
        if best is None or d < best[0]:
            best = (d, s)
    if not best:
        return None
    return f"{best[1].names[0]}, {best[1].state}" if best[1].state else best[1].names[0]


def summary(o: dict, a: dict, b: dict, where: str | None) -> str:
    tier_text = {
        "crossing": "touch or cross, so they must coordinate outages and could share right-of-way, access roads and permits",
        "row": "are close enough to share right-of-way, access roads and permits",
        "logistics": "are close enough to share laydown yards and material deliveries",
        "crew": "are within a crew's morning drive, so they could share crews and equipment",
    }[o["tier"]]
    dist = "touch" if o["tier"] == "crossing" else f"come within {o['distanceKm']:.1f} km of each other"
    s = (
        f"DESC's {a['name']} and Georgia Power's {b['name']} {dist}"
        + (f" near {where}" if where else "")
        + f"; they {tier_text}."
    )
    if o["timelineOverlapMonths"] > 0:
        s += (f" Their estimated build windows overlap by about {o['timelineOverlapMonths']:.0f} months "
              f"(DESC {window_str(a['buildWindow'])}, Georgia Power {window_str(b['buildWindow'])}).")
    else:
        s += (f" Their estimated build windows do not overlap (DESC {window_str(a['buildWindow'])}, "
              f"Georgia Power {window_str(b['buildWindow'])}), so the sharing is sequential.")
    y = o.get("stagingYard")
    if y and max(y["driveMinutesDesc"], y["driveMinutesGpc"]) < 2:
        s += " One staging yard at the closest point would serve both jobs."
    elif y:
        where_yard = "" if y["label"] == "Candidate yard" else " " + y["label"][0].lower() + y["label"][1:]
        s += (f" A shared staging yard{where_yard} would be {y['driveMinutesDesc']:.0f} min by road from DESC's "
              f"work and {y['driveMinutesGpc']:.0f} min from Georgia Power's.")
    if o.get("roadVerified") is False:
        s += f" By road the closest points are {o['roadKm']:.0f} km apart because of the river crossing."
    if o["robustness"] == "uncertain":
        s += " The exact routes are not public, so the tier could change once they are."
    c = o.get("cost")
    if c and c["totalUsd"] > 0:
        s += f" Rough savings: about ${c['totalUsd']:,.0f} central estimate ({c['assumptions'][0].split(' (')[0].replace('Range: ', 'range ')})."
    if any("1920-A" in x for x in o["shareable"]):
        s += (" Because at least one project rebuilds an existing line, it is also a candidate for a "
              "right-sizing review under FERC Order 1920-A (upsizing a line that is being replaced anyway).")
    return s


def known_matches(overlaps: list[dict], projects: dict[str, dict]) -> list[dict]:
    def best(pred_desc, pred_gpc):
        hits = [o for o in overlaps if pred_desc(projects[o["descId"]]) and pred_gpc(projects[o["gpcId"]])]
        return min(hits, key=lambda o: o["rank"]) if hits else None

    def desc_has(word):
        return lambda p: word in (p["name"] + " " + " ".join(p["places"])).lower()

    def mcintosh(p):
        return p["id"] == "gpc-gen-mcintosh-expansion"

    def thomson_vogtle(p):
        return p["id"] == "gpc-web-thomson-vogtle"

    specs = [
        ("Savannah: DESC Jasper work vs Georgia Power Plant McIntosh expansion", desc_has("jasper"), mcintosh),
        ("Savannah: DESC Okatie work vs Georgia Power Plant McIntosh expansion", desc_has("okatie"), mcintosh),
        ("Savannah: DESC Bluffton work vs Georgia Power Plant McIntosh expansion",
         lambda p: "bluffton" in (p["name"] + " " + p["description"]).lower(), mcintosh),
        ("Augusta: DESC Urquhart work vs Georgia Power Thomson-Vogtle transmission line", desc_has("urquhart"),
         thomson_vogtle),
    ]
    out = []
    for label, pd, pg in specs:
        o = best(pd, pg)
        out.append({"label": label, "found": o is not None, "overlapId": o["id"] if o else None})
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--no-roads", action="store_true", help="skip OSRM road checks")
    args = ap.parse_args(argv)

    # 1. Parse filings (all public, none carries a visible CEII marking)
    desc = parse_desc.parse()
    assert len(desc) == 54, f"expected 54 DESC projects, got {len(desc)}"
    web = gpc_web.records()
    r26, r26_info = parse_sertp.parse_report_2026()
    q2, q2_info = parse_sertp.parse_q2()
    rp, rp_info = parse_sertp.parse_regional_2025()
    print(f"parsed DESC {len(desc)}, web {len(web)}, SERTP 2026 report {len(r26)}, SERTP 2026 Q2 {len(q2)}, "
          f"SERTP 2025 plan {len(rp)}")

    # 2. Geocode
    gaz = Gazetteer()
    zones = region_centers(gaz)
    candidates = desc + web + r26 + q2 + rp
    located = geocode_all(gaz, candidates, zones)

    # 3. Keep SOCO projects only when they are in Georgia; newest edition wins on duplicates
    excluded = {"socoOutsideGeorgia": 0, "socoUnlocated": 0, "socoAmbiguousState": 0, "duplicates": 0}
    keys = {}
    for p in web:
        keys.setdefault((_key(p), p.kind), p)
    gpc_extra = []
    for p in r26 + q2 + rp:
        if p.owner == "SOCO" and p.zone != "SAV":
            verdict = soco_in_georgia(p, located[p.id], gaz)
            if verdict != "GA":
                excluded[{"outside Georgia": "socoOutsideGeorgia", "unlocated": "socoUnlocated",
                          "ambiguous state": "socoAmbiguousState"}[verdict]] += 1
                continue
        elif p.zone == "SAV" and not any(m.method == "site" for m in located[p.id].matches):
            excluded["socoUnlocated"] += 1
            continue
        k = (_key(p), p.kind)
        if k in keys and k[0]:
            excluded["duplicates"] += 1
            first = keys[k]
            first.notes.append(f"Also listed in {p.source_document} (p. {p.source_page}, in service {p.in_service[:4] if p.in_service else 'n/a'}).")
            continue
        keys[k] = p
        gpc_extra.append(p)
    raw_projects = desc + web + gpc_extra

    # 4. Geometry
    net = LineNetwork(osm.power_sites())
    projects: list[dict] = []
    for p in raw_projects:
        loc = located[p.id]
        cp = county_point(p.county, p.state) if p.county else None
        built = build_geometry(p.kind, p.miles, loc, net, cp)
        bw = build_window(p.kind, p.action, p.in_service, p.build_window)
        d = to_project(p, built, bw, loc.unmatched if not cp else [])
        if d["geometry"] is None:
            d["geometry"] = _fallback_point(p.utility)
            d["geometryQuality"] = "point"
            d["locationConfidence"] = min(d["locationConfidence"], 0.1)
            if "excluded from overlap scoring" not in d["description"]:
                d["description"] += " [Location not found; excluded from overlap scoring.]"
        d["_metric"] = built.metric if built else None
        d["_radius"] = built.radius_km if built else 0.0
        projects.append(d)
    by_id = {p["id"]: p for p in projects}

    # 5. Overlaps
    scored = [p for p in projects if p["_metric"] is not None]
    overlaps, pairs = find_overlaps(scored)
    overlaps.sort(key=lambda o: -o["score"])
    bridges = [] if args.no_roads else roads.savannah_bridges()
    ranges: list[dict] = []
    for rank, o in enumerate(overlaps, start=1):
        a, b = by_id[o["descId"]], by_id[o["gpcId"]]
        o["id"] = f"ov-{a['id']}--{b['id']}"
        o["rank"] = rank
        pa, pb = tuple(o["closestPoints"][0]), tuple(o["closestPoints"][1])
        if args.no_roads:
            o["roadKm"], o["roadVerified"], o["stagingYard"] = None, None, None
        else:
            o["roadKm"], o["roadVerified"], o["stagingYard"] = roads.road_check(pa, pb, bridges)
        o["cost"], rng = cost.estimate(a, b, o["tier"], o["timelineOverlapMonths"])
        ranges.append({"overlapId": o["id"], **rng})
        mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
        o["summary"] = summary(o, a, b, near_place(gaz, *mid))

    # 6. Write
    keys_out = ["id", "descId", "gpcId", "distanceKm", "tier", "closestPoints", "roadKm", "roadVerified",
                "stagingYard", "timelineOverlapMonths", "robustness", "shareable", "score", "rank", "cost", "summary"]
    ov_out = [{k: o[k] for k in keys_out} for o in overlaps]
    proj_out = [{k: v for k, v in p.items() if not k.startswith("_")} for p in projects]
    counts = {"DESC": sum(p["utility"] == "DESC" for p in proj_out), "GPC": sum(p["utility"] == "GPC" for p in proj_out)}
    sources = []
    for p in proj_out:
        s = {"document": p["source"]["document"], "url": p["source"]["url"], "page": None}
        if s not in sources:
            sources.append(s)
    meta = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "utilities": [{"id": k, "name": v["name"], "state": v["state"], "color": v["color"]} for k, v in UTILITIES.items()],
        "projectCount": counts,
        "pairsCompared": pairs,
        "overlapsFound": len(ov_out),
        "knownMatches": known_matches(overlaps, by_id),
        "sources": sources + OTHER_SOURCES,
    }
    PLAN_OUT.mkdir(parents=True, exist_ok=True)
    (PLAN_OUT / "projects.json").write_text(json.dumps(proj_out, separators=(",", ":")))
    (PLAN_OUT / "overlaps.json").write_text(json.dumps(ov_out, separators=(",", ":")))
    (PLAN_OUT / "meta.json").write_text(json.dumps(meta, indent=2))
    (PLAN_OUT / "insights").mkdir(parents=True, exist_ok=True)
    (PLAN_OUT / "insights" / "cost-ranges.json").write_text(json.dumps(ranges, separators=(",", ":")))
    n_lines, size = context.write_transmission_lines()
    river = context.write_savannah_river()

    # 7. Report
    located_n = {u: sum(1 for p in proj_out if p["utility"] == u and p["locationConfidence"] > MIN_CONFIDENCE) for u in counts}
    tiers = {}
    for o in ov_out:
        tiers[o["tier"]] = tiers.get(o["tier"], 0) + 1
    print(json.dumps({
        "projects": counts,
        "located": {u: f"{located_n[u]}/{counts[u]} ({100 * located_n[u] / max(1, counts[u]):.0f}%)" for u in counts},
        "geometryQuality": {q: sum(p["geometryQuality"] == q for p in proj_out) for q in ("traced", "straight", "point")},
        "excluded": {**excluded, "sertp2026Report": r26_info, "sertpQ2": q2_info, "sertp2025": rp_info},
        "pairsCompared": pairs,
        "overlaps": len(ov_out),
        "tiers": tiers,
        "knownMatches": meta["knownMatches"],
        "context": {"transmissionLines": n_lines, "bytes": size, "riverBytes": river},
    }, indent=2))
    for o in ov_out[:10]:
        print(o["rank"], o["tier"], o["distanceKm"], o["timelineOverlapMonths"], o["score"],
              by_id[o["descId"]]["name"], "<->", by_id[o["gpcId"]]["name"])


if __name__ == "__main__":
    main()

"""Shared permits: mapped wetlands inside the corridors two projects would share.

Why it matters: placing structures, access roads or matting in wetlands and other
waters of the U.S. needs a U.S. Army Corps of Engineers permit under Clean Water
Act Section 404. Electric utility line work is usually authorized under
Nationwide Permit 57 (Electric Utility Line and Telecommunications Activities),
which has acreage limits and, in some cases, requires notifying the Corps before
work starts. Each permit needs a wetland delineation and environmental surveys.
When DESC and Georgia Power work in the same corridor, one delineation, one set
of surveys and coordinated notifications can serve both projects.

Corridor per overlap (only tiers crossing / row / logistics, i.e. <= 8 km, where
crews would actually share ground):
  * 800 m around the segment joining the two closest points, plus
  * 300 m around each project's geometry within R of its closest point
    (R = 1.6 km for crossing / row, 8 km for logistics).
Wetland polygons come from the USFWS National Wetlands Inventory map service and
are clipped to the corridor; acres are computed in UTM 17N.

Output shapes (TypeScript-like, for the UI):

    // public/data/plan/insights/wetlands.json
    interface OverlapWetlands {
      overlapId: string;
      corridorAcres: number;             // area of the corridor studied
      wetlandAcresInCorridor: number;
      wetlandTypes: string[];            // NWI WETLAND_TYPE values, largest first
      sharedPermitNote: string;          // plain-language permitting rationale
      sources: { document: string; url: string }[];
    }
    type WetlandsFile = OverlapWetlands[];

    // public/data/context/wetlands.geojson (clipped to the corridors, simplified)
    interface WetlandFeature {
      type: "Feature";
      geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
      properties: { overlapId: string; type: string; attribute: string; acres: number };
    }
"""

from __future__ import annotations

import hashlib
import json
import time

import requests
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import transform, unary_union

from gridsight.config import CACHE_DIR, CONTEXT_OUT
from gridsight.osm import USER_AGENT
from gridsight.plan.geometry import _to_ll, _to_m

NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query"
SOURCES = [
    {"document": "USFWS National Wetlands Inventory (Wetlands MapServer)",
     "url": "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer"},
    {"document": "EPA: Section 404 Permit Program (Clean Water Act)", "url": "https://www.epa.gov/cwa-404/section-404-permit-program"},
    {"document": "USACE: Nationwide Permits (NWP 57, electric utility line activities)",
     "url": "https://www.usace.army.mil/Missions/Civil-Works/Regulatory-Program-and-Permits/Nationwide-Permits/"},
    {"document": "MISO Transmission Cost Estimation Guide for MTEP24, Table 2.2-9 (wetland matting and mitigation per acre)",
     "url": "https://cdn.misoenergy.org/20240501%20PSC%20Item%2004%20MISO%20Transmission%20Cost%20Estimation%20Guide%20for%20MTEP24632680.pdf"},
]
MATTING_PER_ACRE, MITIGATION_PER_ACRE = 69_975, 56_132  # MTEP24 Table 2.2-9
ACRES_PER_SQ_M = 1 / 4046.8564224
MAX_BYTES = 3_000_000
_CACHE = CACHE_DIR / "nwi"


def _metric(geom):
    return transform(lambda x, y, z=None: _to_m.transform(x, y), geom)


def _lonlat(geom):
    return transform(lambda x, y, z=None: _to_ll.transform(x, y), geom)


def _query(envelope: tuple[float, float, float, float]) -> list[dict]:
    """All NWI polygons intersecting a lon/lat envelope (paged, cached, polite)."""
    _CACHE.mkdir(parents=True, exist_ok=True)
    feats: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "geometry": ",".join(f"{v:.5f}" for v in envelope),
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "Wetlands.ATTRIBUTE,Wetlands.WETLAND_TYPE,Wetlands.ACRES",
            "returnGeometry": "true",
            "outSR": "4326",
            "maxAllowableOffset": "0.00005",
            "resultOffset": str(offset),
            "resultRecordCount": "1000",
            "f": "geojson",
        }
        key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()
        path = _CACHE / f"{key}.json"
        if path.exists():
            data = json.loads(path.read_text())
        else:
            data = None
            for attempt in range(5):
                try:
                    r = requests.get(NWI, params=params, headers={"User-Agent": USER_AGENT}, timeout=120)
                    if r.status_code == 200:
                        data = r.json()
                        break
                except (requests.RequestException, ValueError):
                    pass
                time.sleep(3 * (attempt + 1))
            if data is None:
                raise RuntimeError("NWI query failed")
            path.write_text(json.dumps(data))
            time.sleep(1.0)
        batch = data.get("features", [])
        feats += batch
        if len(batch) < 1000 and not data.get("exceededTransferLimit"):
            return feats
        offset += len(batch)


def _prop(f: dict, name: str):
    props = f.get("properties") or {}
    return props.get(f"Wetlands.{name}", props.get(name))


def corridor(o: dict, desc: dict, gpc: dict):
    pa = Point(_to_m.transform(*o["closestPoints"][0]))
    pb = Point(_to_m.transform(*o["closestPoints"][1]))
    reach = 1600.0 if o["tier"] in ("crossing", "row") else 8000.0
    parts = [LineString([pa, pb]).buffer(800.0) if pa.distance(pb) > 0 else pa.buffer(800.0)]
    for proj, pt in ((desc, pa), (gpc, pb)):
        g = _metric(shape(proj["geometry"]))
        parts.append(g.intersection(pt.buffer(reach)).buffer(300.0))
    return unary_union([p for p in parts if not p.is_empty])


def build(projects: list[dict], overlaps: list[dict]) -> tuple[list[dict], dict]:
    by_id = {p["id"]: p for p in projects}
    rows, features = [], []
    for o in overlaps:
        if o["tier"] not in ("crossing", "row", "logistics"):
            continue
        corr = corridor(o, by_id[o["descId"]], by_id[o["gpcId"]])
        env = _lonlat(corr).bounds
        area = 0.0
        by_type: dict[str, float] = {}
        for f in _query(env):
            try:
                g = _metric(shape(f["geometry"]))
            except (ValueError, TypeError, KeyError):
                continue
            if not g.is_valid:
                g = g.buffer(0)
            clip = g.intersection(corr)
            if clip.is_empty:
                continue
            acres = clip.area * ACRES_PER_SQ_M
            wtype = _prop(f, "WETLAND_TYPE") or "Unclassified"
            area += acres
            by_type[wtype] = by_type.get(wtype, 0.0) + acres
            simple = _lonlat(clip.simplify(10.0))
            if simple.is_empty or simple.geom_type not in ("Polygon", "MultiPolygon"):
                continue
            features.append({"type": "Feature", "geometry": _round(mapping(simple)),
                             "properties": {"overlapId": o["id"], "type": wtype,
                                            "attribute": _prop(f, "ATTRIBUTE") or "", "acres": round(acres, 2)}})
        types = [t for t, _ in sorted(by_type.items(), key=lambda kv: -kv[1])]
        corridor_acres = corr.area * ACRES_PER_SQ_M
        rows.append({
            "overlapId": o["id"],
            "corridorAcres": round(corridor_acres, 1),
            "wetlandAcresInCorridor": round(area, 1),
            "wetlandTypes": types,
            "sharedPermitNote": _note(area, types, corridor_acres),
            "sources": SOURCES,
        })
    _write(features)
    return rows, {"overlapsStudied": len(rows), "wetlandPolygons": len(features)}


def _note(acres: float, types: list[str], corridor_acres: float) -> str:
    if acres < 0.05:
        return (f"The National Wetlands Inventory maps no wetlands in the {corridor_acres:,.0f}-acre shared corridor, so "
                "a joint wetland permit is unlikely to be needed; a field check is still required before work.")
    kinds = ", ".join(t.lower() for t in types[:3])
    return (
        f"About {acres:,.0f} acres of mapped wetlands ({kinds}) lie in the {corridor_acres:,.0f}-acre corridor the two "
        "projects would share. Work that touches wetlands needs a U.S. Army Corps of Engineers permit under Clean "
        "Water Act Section 404, usually Nationwide Permit 57 for utility lines, backed by a wetland delineation and "
        "environmental surveys. Doing one delineation and one set of surveys for both utilities, and coordinating "
        "their notices to the Corps, avoids paying for the same fieldwork twice. For scale, MISO's cost guide puts "
        f"wetland matting at ${MATTING_PER_ACRE:,}/acre and mitigation credits at ${MITIGATION_PER_ACRE:,}/acre "
        "(MTEP24 Table 2.2-9) wherever a project must work in wetlands. NWI maps are a screening tool, not a "
        "jurisdictional delineation."
    )


def _round(geom: dict) -> dict:
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], 5), round(c[1], 5)]
        return [r(x) for x in c]

    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def _write(features: list[dict]) -> None:
    fc = {"type": "FeatureCollection", "features": features}
    text = json.dumps(fc, separators=(",", ":"))
    tol = 0.0001
    while len(text.encode()) > MAX_BYTES and tol < 0.01:
        for f in features:
            f["geometry"] = _round(mapping(shape(f["geometry"]).simplify(tol)))
        text = json.dumps(fc, separators=(",", ":"))
        tol *= 2
    (CONTEXT_OUT / "wetlands.geojson").write_text(text)

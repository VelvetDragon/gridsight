"""Context layers for the map: existing transmission lines and the Savannah River (OSM)."""

from __future__ import annotations

import json
import re

from shapely.geometry import LineString, MultiLineString, mapping
from shapely.ops import linemerge

from gridsight import osm
from gridsight.config import CONTEXT_OUT

MAX_BYTES = 4_000_000


def utility_guess(operator: str) -> str:
    op = operator.lower()
    if re.search(r"georgia power|southern company|southern co\b", op):
        return "GPC"
    if re.search(r"sce&g|south carolina electric|dominion|scana", op):
        return "DESC"
    return "OTHER"


def _kv(voltage: str) -> list[int]:
    out = []
    for v in re.split(r"[;,]", voltage or ""):
        v = v.strip()
        if v.isdigit() and int(v) >= 1000:
            out.append(int(v) // 1000)
    return sorted(set(out), reverse=True)


def _round(coords, nd=5):
    out = []
    for x, y in coords:
        c = [round(x, nd), round(y, nd)]
        if not out or out[-1] != c:
            out.append(c)
    return out


def transmission_lines(min_kv: int = 0, tolerance_deg: float = 0.0008) -> dict:
    feats = []
    for w in osm.power_lines():
        tags = w["tags"]
        kv = _kv(tags.get("voltage", ""))
        if kv and max(kv) < min_kv:
            continue
        g = LineString(w["coords"]).simplify(tolerance_deg, preserve_topology=False)
        coords = _round(g.coords)
        if len(coords) < 2:
            continue
        props = {"voltage": max(kv) if kv else None, "operator": tags.get("operator") or None,
                 "utility": utility_guess(tags.get("operator", ""))}
        if tags.get("name"):
            props["name"] = tags["name"]
        feats.append({"type": "Feature", "properties": props,
                      "geometry": {"type": "LineString", "coordinates": coords}})
    return {"type": "FeatureCollection", "features": feats}


def write_transmission_lines() -> tuple[int, int]:
    """Write lines, tightening simplification / dropping low voltages until < 4 MB."""
    for min_kv, tol in [(0, 0.0005), (0, 0.0008), (69, 0.0008), (100, 0.001), (115, 0.0015)]:
        fc = transmission_lines(min_kv, tol)
        text = json.dumps(fc, separators=(",", ":"))
        if len(text.encode()) < MAX_BYTES:
            break
    (CONTEXT_OUT / "transmission-lines.geojson").write_text(text)
    return len(fc["features"]), len(text.encode())


def write_savannah_river() -> int:
    data = osm.savannah_river()
    lines = [LineString([(p["lon"], p["lat"]) for p in el["geometry"]])
             for el in data.get("elements", []) if el.get("type") == "way" and el.get("geometry")]
    merged = linemerge(MultiLineString(lines)) if lines else MultiLineString([])
    merged = merged.simplify(0.0003)
    geom = mapping(merged)
    if geom["type"] == "LineString":
        geom["coordinates"] = _round(geom["coordinates"])
    else:
        geom["coordinates"] = [_round(part) for part in geom["coordinates"]]
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": "Savannah River", "source": "OpenStreetMap"}, "geometry": geom}]}
    text = json.dumps(fc, separators=(",", ":"))
    (CONTEXT_OUT / "savannah-river.geojson").write_text(text)
    return len(text.encode())

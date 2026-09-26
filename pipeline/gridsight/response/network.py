"""Transmission network for Georgia / South Carolina from OpenStreetMap (Overpass API).

* power=line ways inside config.BBOX (OSM uses power=line for transmission and
  power=minor_line for distribution, so this is the transmission layer).
* Structure nodes on those ways (power=tower / power=pole with material/structure tags)
  tell us whether a line is carried by lattice towers or poles.
* Utility attribution: OSM operator/owner tags first. Most OSM lines in GA/SC have no
  operator tag, so untagged segments take the OWNER of the nearest HIFLD "Electric Power
  Transmission Lines" feature within HIFLD_MATCH_M (HIFLD open data, archived copy served
  by the DOE/NETL Energy Transition Atlas). Everything else is OTHER.
* Lines are split into ~1 km segments (the unit that the simulation scores).

Data (c) OpenStreetMap contributors, ODbL; HIFLD (public domain).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

from gridsight.config import BBOX
from gridsight.response.common import RESP_CACHE, haversine_km, http_get

OVERPASS_URLS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
SEGMENT_KM = 1.0
TILES = (4, 2)  # lon x lat tiles so each Overpass response stays small

QUERY = """[out:json][timeout:900];
way["power"="line"]({s},{w},{n},{e})->.l;
.l out body geom;
node(w.l)["power"~"^(tower|pole|portal|terminal)$"];
out tags;
"""

# Operator / owner strings -> utility. Matched case-insensitively against
# operator, owner and operator:short tags.
DESC_PATTERNS = [r"dominion", r"sce\s*&\s*g", r"scana", r"south carolina electric", r"south carolina gas\s*&\s*electric"]
GPC_PATTERNS = [r"georgia power", r"southern company", r"southern co\b", r"\bsoco\b"]


HIFLD_URL = (
    "https://arcgis.netl.doe.gov/server/rest/services/Hosted/"
    "Energy_Transition_Atlas_493d6/FeatureServer/18/query"
)
HIFLD_MATCH_M = 300.0


def match_owner(text: str) -> str:
    low = text.lower()
    if any(re.search(p, low) for p in DESC_PATTERNS):
        return "DESC"
    if any(re.search(p, low) for p in GPC_PATTERNS):
        return "GPC"
    return "OTHER"


def attribute(tags: dict) -> str:
    return match_owner(" ".join(str(tags.get(k, "")) for k in ("operator", "owner", "operator:short", "network")))


def fetch_hifld() -> "gpd.GeoDataFrame":
    """HIFLD transmission lines (owner, voltage) intersecting the study area (cached)."""
    import geopandas as gpd
    from shapely.geometry import LineString, MultiLineString

    w, s, e, n = BBOX
    feats, offset = [], 0
    while True:
        params = {
            "where": "1=1",
            "geometry": f"{w},{s},{e},{n}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": 4326,
            "outSR": 4326,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "id,owner,voltage,type,status",
            "orderByFields": "objectid_1",
            "resultOffset": offset,
            "resultRecordCount": 2000,
            "f": "json",
        }
        raw = http_get(HIFLD_URL, params=params, cache_name=f"hifld_lines_{offset}.json", timeout=300)
        data = json.loads(raw)
        batch = data.get("features", [])
        feats.extend(batch)
        if not data.get("exceededTransferLimit") or not batch:
            break
        offset += len(batch)
    rows, geoms = [], []
    for f in feats:
        paths = (f.get("geometry") or {}).get("paths") or []
        if not paths:
            continue
        geoms.append(MultiLineString([LineString(p) for p in paths if len(p) >= 2]))
        rows.append(f["attributes"])
    gdf = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:4326")
    gdf["utility"] = gdf["owner"].fillna("").map(match_owner)
    return gdf


def parse_voltage_kv(v: str | None) -> float:
    """Highest circuit voltage on the way in kV (OSM stores volts, ';'-separated)."""
    if not v:
        return float("nan")
    best = float("nan")
    for part in re.split(r"[;,/]", str(v)):
        try:
            kv = float(part.strip()) / 1000.0
        except ValueError:
            continue
        if kv > 0 and not (kv <= best):
            best = kv
    return best


def _tiles():
    w, s, e, n = BBOX
    nx, ny = TILES
    xs = np.linspace(w, e, nx + 1)
    ys = np.linspace(s, n, ny + 1)
    for i in range(nx):
        for j in range(ny):
            yield (round(xs[i], 4), round(ys[j], 4), round(xs[i + 1], 4), round(ys[j + 1], 4))


def fetch_osm() -> tuple[list[dict], dict[int, dict]]:
    """Return (ways, structure-node tags) for the whole study area (cached per tile)."""
    ways: dict[int, dict] = {}
    nodes: dict[int, dict] = {}
    for w, s, e, n in _tiles():
        q = QUERY.format(s=s, w=w, n=n, e=e)
        name = f"osm_power_line_{w}_{s}_{e}_{n}.json"
        raw = None
        for url in OVERPASS_URLS:
            try:
                raw = http_get(url, data={"data": q}, cache_name=name, timeout=1000, min_interval=2.0)
                break
            except RuntimeError as exc:
                print(f"  overpass mirror failed: {exc}")
        if raw is None:
            raise RuntimeError("all Overpass mirrors failed")
        data = json.loads(raw)
        for el in data["elements"]:
            if el["type"] == "way":
                ways[el["id"]] = el
            elif el["type"] == "node":
                nodes[el["id"]] = el.get("tags", {})
        print(f"  tile {w},{s},{e},{n}: {len(ways)} ways / {len(nodes)} structures so far")
    return list(ways.values()), nodes


def structure_class(tags: dict) -> str | None:
    """'lattice' | 'pole' | None from a structure node's tags."""
    p = tags.get("power")
    structure = str(tags.get("structure", "")).lower()
    material = str(tags.get("material", "")).lower()
    if p in ("tower", "portal"):
        if structure in ("tubular", "solid") or material in ("wood", "concrete"):
            return "pole"
        return "lattice"
    if p == "pole":
        return "pole"
    return None


@dataclass
class Network:
    """One row per ~1 km segment."""

    seg: pd.DataFrame  # columns below

    COLUMNS = [
        "way_id",
        "utility",
        "operator",
        "voltage_kv",
        "structure",  # lattice | pole
        "structure_source",  # osm-nodes | voltage-rule
        "length_km",
        "n_structures",
        "lon0",
        "lat0",
        "lon1",
        "lat1",
        "mid_lon",
        "mid_lat",
        "bearing_deg",
    ]


def _split(coords: np.ndarray, seg_km: float) -> list[tuple[int, int]]:
    """Split a polyline (N x 2 lon/lat) into index ranges of about ``seg_km``."""
    d = haversine_km(coords[:-1, 0], coords[:-1, 1], coords[1:, 0], coords[1:, 1])
    total = float(d.sum())
    if total <= 0:
        return []
    n = max(1, int(round(total / seg_km)))
    target = total / n
    out, start, acc = [], 0, 0.0
    for k, dk in enumerate(d):
        acc += dk
        if acc >= target and len(out) < n - 1:
            out.append((start, k + 1))
            start, acc = k + 1, 0.0
    out.append((start, len(coords) - 1))
    return [(a, b) for a, b in out if b > a]


def bearing(lon0, lat0, lon1, lat1):
    y = np.sin(np.radians(lon1 - lon0)) * np.cos(np.radians(lat1))
    x = np.cos(np.radians(lat0)) * np.sin(np.radians(lat1)) - np.sin(np.radians(lat0)) * np.cos(
        np.radians(lat1)
    ) * np.cos(np.radians(lon1 - lon0))
    return (np.degrees(np.arctan2(y, x)) + 360) % 360


# Voltage rule used when a line has no tagged structure nodes (documented assumption):
# in the US Southeast, lines >= 230 kV are carried almost entirely on steel lattice or
# steel pole structures; 115/69/46 kV sub-transmission is mostly wood (or concrete) poles.
LATTICE_MIN_KV = 230.0


def build_segments(ways: list[dict], nodes: dict[int, dict]) -> tuple[pd.DataFrame, dict]:
    rows = []
    span_samples = {"lattice": [], "pole": []}
    for w in ways:
        geom = w.get("geometry")
        if not geom or len(geom) < 2:
            continue
        tags = w.get("tags", {})
        if tags.get("location") in ("underground", "underwater") or tags.get("line") == "cable":
            continue
        coords = np.array([[g["lon"], g["lat"]] for g in geom], float)
        ids = w.get("nodes", [])
        cls = [structure_class(nodes.get(i, {})) for i in ids]
        n_lat = sum(c == "lattice" for c in cls)
        n_pole = sum(c == "pole" for c in cls)
        kv = parse_voltage_kv(tags.get("voltage"))
        if n_lat + n_pole >= 2:
            structure, src = ("lattice" if n_lat >= n_pole else "pole"), "osm-nodes"
        else:
            structure = "lattice" if (np.isfinite(kv) and kv >= LATTICE_MIN_KV) else "pole"
            src = "voltage-rule"
        # Typical span (km) between consecutive tagged structures on this way.
        tagged = [k for k, c in enumerate(cls) if c is not None]
        if len(tagged) >= 3 and len(tagged) >= 0.8 * len(ids):
            for a, b in zip(tagged[:-1], tagged[1:]):
                seg = haversine_km(coords[a:b, 0], coords[a:b, 1], coords[a + 1 : b + 1, 0], coords[a + 1 : b + 1, 1]).sum()
                if 0.02 < seg < 1.5:
                    span_samples[structure].append(float(seg))
        util = attribute(tags)
        op = str(tags.get("operator", tags.get("owner", "")))
        for a, b in _split(coords, SEGMENT_KM):
            part = coords[a : b + 1]
            length = float(
                haversine_km(part[:-1, 0], part[:-1, 1], part[1:, 0], part[1:, 1]).sum()
            )
            n_struct_osm = sum(1 for c in cls[a : b + 1] if c is not None)
            mid = part[len(part) // 2] if len(part) > 2 else part.mean(axis=0)
            rows.append(
                {
                    "way_id": w["id"],
                    "utility": util,
                    "operator": op,
                    "voltage_kv": kv,
                    "structure": structure,
                    "structure_source": src,
                    "length_km": length,
                    "n_struct_osm": n_struct_osm,
                    "lon0": part[0, 0],
                    "lat0": part[0, 1],
                    "lon1": part[-1, 0],
                    "lat1": part[-1, 1],
                    "mid_lon": float(mid[0]),
                    "mid_lat": float(mid[1]),
                }
            )
    seg = pd.DataFrame(rows)
    spans = {k: (float(np.median(v)) if v else float("nan")) for k, v in span_samples.items()}
    # Fallback spans if OSM tagging were too sparse (typical values, documented assumption).
    fallback = {"lattice": 0.35, "pole": 0.15}
    spans = {k: (spans[k] if np.isfinite(spans[k]) else fallback[k]) for k in spans}
    seg["n_structures"] = np.maximum(
        1.0, seg["length_km"] / seg["structure"].map(spans).astype(float)
    )
    seg["bearing_deg"] = bearing(seg.lon0, seg.lat0, seg.lon1, seg.lat1)
    seg = seg[seg["length_km"] > 0.05].reset_index(drop=True)
    stats = {
        "ways": len(ways),
        "segments": int(len(seg)),
        "km": float(seg.length_km.sum()),
        "median_span_km": spans,
        "span_samples": {k: len(v) for k, v in span_samples.items()},
    }
    return seg, stats


def attribute_hifld(seg: pd.DataFrame) -> pd.DataFrame:
    """Fill OTHER segments from the nearest HIFLD line owner within HIFLD_MATCH_M."""
    import geopandas as gpd

    from gridsight.config import METRIC_CRS

    hifld = fetch_hifld().to_crs(METRIC_CRS)
    hifld = hifld[hifld["utility"] != "OTHER"][["owner", "utility", "geometry"]]
    pts = gpd.GeoDataFrame(
        {"i": seg.index}, geometry=gpd.points_from_xy(seg.mid_lon, seg.mid_lat), crs="EPSG:4326"
    ).to_crs(METRIC_CRS)
    todo = pts[seg["utility"].to_numpy() == "OTHER"]
    j = gpd.sjoin_nearest(todo, hifld, how="left", max_distance=HIFLD_MATCH_M, distance_col="d")
    j = j[~j.index.duplicated(keep="first")].dropna(subset=["utility"])
    seg["attribution"] = np.where(seg["utility"] != "OTHER", "osm-operator", "none")
    seg.loc[j["i"].to_numpy(), "utility"] = j["utility"].to_numpy()
    seg.loc[j["i"].to_numpy(), "operator"] = j["owner"].to_numpy()
    seg.loc[j["i"].to_numpy(), "attribution"] = "hifld-owner"
    return seg


def load_network(refresh: bool = False) -> pd.DataFrame:
    path = RESP_CACHE / "segments.parquet"
    if path.exists() and not refresh:
        return pd.read_parquet(path)
    ways, nodes = fetch_osm()
    seg, stats = build_segments(ways, nodes)
    seg = attribute_hifld(seg)
    stats["attribution"] = seg.groupby(["utility", "attribution"]).size().rename("n").reset_index().to_dict("records")
    seg.to_parquet(path)
    (RESP_CACHE / "network_stats.json").write_text(json.dumps(stats, indent=1))
    print(json.dumps(stats, indent=1))
    return seg


def main() -> None:
    seg = load_network(refresh=True)
    print(seg.groupby(["utility", "structure"]).agg(n=("length_km", "size"), km=("length_km", "sum")).round(0))
    print(seg.structure_source.value_counts())
    print(seg.groupby(["utility", "attribution"]).length_km.sum().round(0))
    print(seg[seg.utility == "OTHER"].operator.value_counts().head(40))


if __name__ == "__main__":
    main()

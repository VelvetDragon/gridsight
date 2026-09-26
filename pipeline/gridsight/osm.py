"""Small, polite OpenStreetMap Overpass client with an on-disk cache.

Every response is cached in CACHE_DIR/overpass/<sha1>.json, so the pipeline only
hits the public Overpass servers once per distinct query.
"""

from __future__ import annotations

import hashlib
import json
import time

import requests

from gridsight.config import BBOX, CACHE_DIR

OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
USER_AGENT = "MrGridy/0.1 (ShellHacks 2026 research; github.com/VelvetDragon/gridsight)"
_CACHE = CACHE_DIR / "overpass"


def bbox_filter(bbox: tuple[float, float, float, float] = BBOX) -> str:
    """Overpass bbox string: (south, west, north, east)."""
    lon_min, lat_min, lon_max, lat_max = bbox
    return f"({lat_min},{lon_min},{lat_max},{lon_max})"


def overpass(query: str, *, timeout: int = 300, retries: int = 6) -> dict:
    """Run an Overpass QL query (cached). Retries politely on 429/504."""
    _CACHE.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(query.encode()).hexdigest()
    path = _CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())

    last_err: Exception | None = None
    for attempt in range(retries):
        url = OVERPASS_URLS[attempt % len(OVERPASS_URLS)]
        try:
            resp = requests.post(
                url,
                data={"data": query},
                headers={"User-Agent": USER_AGENT},
                timeout=timeout + 60,
            )
            if resp.status_code in (429, 502, 503, 504):
                raise RuntimeError(f"overpass busy ({resp.status_code})")
            resp.raise_for_status()
            data = resp.json()
            remark = str(data.get("remark", ""))
            if "error" in remark.lower() or "timed out" in remark.lower():
                raise RuntimeError(f"overpass partial result: {remark[:120]}")
            path.write_text(json.dumps(data))
            return data
        except (requests.RequestException, RuntimeError, ValueError) as err:
            last_err = err
            time.sleep(min(60, 5 * 2**attempt))
    raise RuntimeError(f"Overpass query failed after {retries} tries: {last_err}")


def power_sites(bbox: tuple[float, float, float, float] = BBOX) -> list[dict]:
    """Named substations, plants, generators' sites and switching stations in bbox.

    Returns a flat list of {osm, name, lon, lat, kind, operator, voltage}.
    """
    b = bbox_filter(bbox)
    q = f"""
[out:json][timeout:300];
(
  nwr["power"="substation"]{b};
  nwr["power"="plant"]{b};
  nwr["power"="switch"]["name"]{b};
);
out center tags;
"""
    data = overpass(q)
    out = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center") or {}
            lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None:
            continue
        names = [tags.get(k) for k in ("name", "alt_name", "old_name", "official_name", "short_name")]
        names = [n for n in names if n]
        out.append(
            {
                "osm": f"{el['type']}/{el['id']}",
                "names": names,
                "lon": lon,
                "lat": lat,
                "kind": tags.get("power", ""),
                "substation": tags.get("substation", ""),
                "operator": tags.get("operator", ""),
                "voltage": tags.get("voltage", ""),
                "ref": tags.get("ref", ""),
            }
        )
    return out


def _lines_tile(tb: tuple[float, float, float, float], depth: int = 0) -> list[dict]:
    """One tile of power=line ways; a tile the server cannot answer is split in four."""
    q = f"""
[out:json][timeout:300];
way["power"="line"]{bbox_filter(tb)};
out geom tags;
"""
    split_flag = _CACHE / f"split-{hashlib.sha1(q.encode()).hexdigest()}.flag"
    try:
        if split_flag.exists() and depth < 2:
            raise RuntimeError("tile previously too large; splitting")
        return overpass(q, retries=3 if depth < 2 else 6).get("elements", [])
    except RuntimeError:
        if depth >= 2:
            raise
        _CACHE.mkdir(parents=True, exist_ok=True)
        split_flag.touch()
        lon_min, lat_min, lon_max, lat_max = tb
        mx, my = (lon_min + lon_max) / 2, (lat_min + lat_max) / 2
        out: list[dict] = []
        for sub in ((lon_min, lat_min, mx, my), (mx, lat_min, lon_max, my),
                    (lon_min, my, mx, lat_max), (mx, my, lon_max, lat_max)):
            out += _lines_tile(sub, depth + 1)
        return out


def power_lines(bbox: tuple[float, float, float, float] = BBOX, tiles: int = 3) -> list[dict]:
    """All power=line ways in bbox with full geometry, fetched in tiles to stay polite."""
    lon_min, lat_min, lon_max, lat_max = bbox
    dx = (lon_max - lon_min) / tiles
    dy = (lat_max - lat_min) / tiles
    seen: dict[int, dict] = {}
    for i in range(tiles):
        for j in range(tiles):
            tb = (lon_min + i * dx, lat_min + j * dy, lon_min + (i + 1) * dx, lat_min + (j + 1) * dy)
            for el in _lines_tile(tb):
                if el["type"] != "way" or el["id"] in seen or "geometry" not in el:
                    continue
                seen[el["id"]] = {
                    "id": el["id"],
                    "tags": el.get("tags", {}),
                    "coords": [(p["lon"], p["lat"]) for p in el["geometry"]],
                    "nodes": el.get("nodes", []),
                }
    return list(seen.values())


def settlements(bbox: tuple[float, float, float, float] = BBOX) -> list[dict]:
    """Named populated places (city..hamlet/locality) in bbox, a fallback for site names."""
    q = f"""
[out:json][timeout:300];
node["place"~"^(city|town|village|hamlet|locality|neighbourhood|suburb|isolated_dwelling)$"]["name"]{bbox_filter(bbox)};
out;
"""
    out = []
    for el in overpass(q).get("elements", []):
        tags = el.get("tags", {})
        out.append(
            {
                "osm": f"node/{el['id']}",
                "names": [tags["name"]],
                "lon": el["lon"],
                "lat": el["lat"],
                "kind": "place:" + tags.get("place", ""),
                "substation": "",
                "operator": "",
                "voltage": "",
                "ref": "",
            }
        )
    return out


def savannah_river() -> dict:
    """The Savannah River main stem (waterway=river ways of the named relation)."""
    q = """
[out:json][timeout:300];
relation["waterway"="river"]["name"="Savannah River"];
way(r);
out geom tags;
"""
    return overpass(q)

"""Road check and candidate staging yard for each overlap (public OSRM demo server).

* roadKm: driving distance between the two closest points (OSRM /route).
* Staging yard: candidates are points at 1/4, 1/2 and 3/4 of the straight
  segment between the closest points, the closest points themselves, and the
  approaches of road bridges over the Savannah River within 40 km of the pair.
  The yard is the candidate that minimises the longer of its two drive times
  (OSRM /table).
* roadVerified (contract rule, src/lib/types.ts): true when the road distance
  between the closest points is also within ROAD_LIMIT_KM (40 km). The staging
  yard's two drive times are reported alongside; a yard is "within a morning
  drive" of both projects when both are <= DRIVE_LIMIT_MIN minutes.

Requests are cached in CACHE_DIR/osrm and throttled to at most 1 per second.
"""

from __future__ import annotations

import hashlib
import json
import math
import time

import requests

from gridsight import osm
from gridsight.config import CACHE_DIR

OSRM = "https://router.project-osrm.org"
DRIVE_LIMIT_MIN = 45.0
ROAD_LIMIT_KM = 40.0
USER_AGENT = osm.USER_AGENT
_CACHE = CACHE_DIR / "osrm"
_last = [0.0]


def _get(url: str) -> dict | None:
    _CACHE.mkdir(parents=True, exist_ok=True)
    path = _CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if path.exists():
        return json.loads(path.read_text())
    for attempt in range(5):
        wait = 1.05 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(3 * (attempt + 1))
                continue
            data = r.json()
            if data.get("code") == "Ok":
                path.write_text(json.dumps(data))
                return data
            return None
        except (requests.RequestException, ValueError):
            time.sleep(3 * (attempt + 1))
    return None


def _fmt(p) -> str:
    return f"{p[0]:.5f},{p[1]:.5f}"


def route_km(a, b) -> float | None:
    data = _get(f"{OSRM}/route/v1/driving/{_fmt(a)};{_fmt(b)}?overview=false")
    if not data or not data.get("routes"):
        return None
    return round(data["routes"][0]["distance"] / 1000.0, 1)


def savannah_bridges() -> list[dict]:
    """Road bridges over the Savannah River (motorway..secondary), one point each."""
    q = """
[out:json][timeout:300];
way["waterway"="river"]["name"="Savannah River"]->.r;
way(around.r:40)["highway"~"^(motorway|trunk|primary|secondary)$"]["bridge"="yes"];
out geom tags;
"""
    out = []
    seen = set()
    for el in osm.overpass(q).get("elements", []):
        tags = el.get("tags", {})
        g = el.get("geometry") or []
        if not g:
            continue
        ref = tags.get("ref") or tags.get("name") or "road"
        label = ref.split(";")[0].strip()
        mid = g[len(g) // 2]
        key = (label, round(mid["lat"], 2), round(mid["lon"], 2))
        if key in seen:
            continue
        seen.add(key)
        # both approaches: the first and last vertices of the bridge way
        for end in (g[0], g[-1]):
            out.append({"pos": (end["lon"], end["lat"]), "label": f"Near {label} bridge (Savannah River)"})
    return out


def _km(a, b) -> float:
    kx = 111.32 * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.57)


def staging_yard(pa, pb, bridges: list[dict]) -> dict | None:
    """Best yard for two closest points (lon, lat tuples)."""
    cands = [{"pos": pa, "label": "Candidate yard"}, {"pos": pb, "label": "Candidate yard"}]
    for t in (0.25, 0.5, 0.75):
        cands.append({"pos": (pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])), "label": "Candidate yard"})
    mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
    near = sorted((b for b in bridges if _km(b["pos"], mid) <= 40.0), key=lambda b: _km(b["pos"], mid))[:6]
    cands += near
    coords = ";".join(_fmt(p) for p in [pa, pb] + [c["pos"] for c in cands])
    dests = ";".join(str(i) for i in range(2, 2 + len(cands)))
    data = _get(f"{OSRM}/table/v1/driving/{coords}?sources=0;1&destinations={dests}&annotations=duration")
    if not data:
        return None
    dur = data["durations"]
    snapped = data.get("destinations", [])
    best = None
    for k, c in enumerate(cands):
        a, b = dur[0][k], dur[1][k]
        if a is None or b is None:
            continue
        worst = max(a, b)
        # prefer a bridge approach when it is within 3 minutes of the best option
        key = worst - (180 if c["label"] != "Candidate yard" else 0)
        if best is None or key < best[0]:
            loc = snapped[k]["location"] if k < len(snapped) else c["pos"]
            best = (key, c, a, b, loc)
    if not best:
        return None
    _, c, a, b, loc = best
    return {
        "position": [round(loc[0], 5), round(loc[1], 5)],
        "label": c["label"],
        "driveMinutesDesc": round(a / 60.0, 1),
        "driveMinutesGpc": round(b / 60.0, 1),
    }


def road_check(pa, pb, bridges) -> tuple[float | None, bool | None, dict | None]:
    road = route_km(pa, pb)
    yard = staging_yard(pa, pb, bridges)
    verified = None if road is None else road <= ROAD_LIMIT_KM
    return road, verified, yard

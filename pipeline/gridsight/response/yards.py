"""Joint staging yards for zones where DESC and GPC crews will work near each other.

Candidates (OpenStreetMap via Overpass, cached):
* road bridges (motorway / trunk / primary / secondary) over the Savannah River, the
  GA / SC border, where a yard can reach both sides quickly;
* cities and towns (place=city|town) in the study area.

For every joint zone we take candidates within CANDIDATE_KM of the zone and ask the
public OSRM demo server (https://router.project-osrm.org, car profile, <= 1 request/s,
responses cached) for drive times to the DESC part and the GPC part of the zone. The
yard is the candidate that minimises the larger of the two drive times. It then also
serves any other zone within SERVE_MINUTES by road. maxDriveMinutes is the longest
drive from the yard to a zone it serves.

Road data (c) OpenStreetMap contributors; routing by OSRM (Project OSRM demo server).
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from gridsight.config import BBOX
from gridsight.response.common import haversine_km, http_get, pos
from gridsight.response.network import OVERPASS_URLS

OSRM = "https://router.project-osrm.org/table/v1/driving/"
CANDIDATE_KM = 60.0
MAX_CANDIDATES = 60
SERVE_MINUTES = 60.0

BRIDGE_QUERY = """[out:json][timeout:300];
rel["waterway"="river"]["name"="Savannah River"];
way(r)->.river;
way["bridge"]["highway"~"^(motorway|trunk|primary|secondary)$"](around.river:150);
out center tags;
"""

TOWN_QUERY = """[out:json][timeout:300];
node["place"~"^(city|town)$"]({s},{w},{n},{e});
out tags;
"""


def _overpass(query: str, cache: str) -> dict:
    for url in OVERPASS_URLS:
        try:
            return json.loads(http_get(url, data={"data": query}, cache_name=cache, timeout=400, min_interval=2.0))
        except RuntimeError as exc:
            print(f"  overpass mirror failed: {exc}")
    raise RuntimeError("all Overpass mirrors failed")


def candidates() -> pd.DataFrame:
    rows = []
    br = _overpass(BRIDGE_QUERY, "osm_savannah_river_bridges.json")
    for el in br["elements"]:
        c = el.get("center")
        if not c:
            continue
        t = el.get("tags", {})
        road = t.get("ref") or t.get("name") or t.get("highway", "road")
        rows.append({"lon": c["lon"], "lat": c["lat"], "label": f"{road} bridge over the Savannah River", "kind": "bridge"})
    w, s, e, n = BBOX
    towns = _overpass(TOWN_QUERY.format(s=s, w=w, n=n, e=e), "osm_towns.json")
    for el in towns["elements"]:
        t = el.get("tags", {})
        name = t.get("name")
        if not name:
            continue
        st = t.get("is_in:state_code") or t.get("addr:state") or ""
        rows.append({"lon": el["lon"], "lat": el["lat"], "label": f"{name}{', ' + st if st else ''}", "kind": t.get("place")})
    df = pd.DataFrame(rows)
    # one candidate per bridge label / road (dual carriageways give two ways)
    df["key"] = df["label"] + df["lon"].round(2).astype(str) + df["lat"].round(2).astype(str)
    return df.drop_duplicates("key").reset_index(drop=True)


def osrm_minutes(sources: list[list[float]], dests: list[list[float]]) -> np.ndarray:
    """Drive minutes [len(sources), len(dests)] from the OSRM table service."""
    coords = sources + dests
    path = ";".join(f"{lon:.5f},{lat:.5f}" for lon, lat in coords)
    src = ";".join(str(i) for i in range(len(sources)))
    dst = ";".join(str(len(sources) + j) for j in range(len(dests)))
    url = f"{OSRM}{path}?sources={src}&destinations={dst}&annotations=duration"
    import hashlib

    name = "osrm_" + hashlib.sha1(url.encode()).hexdigest() + ".json"
    data = json.loads(http_get(url, cache_name=name, timeout=120, min_interval=1.1))
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM: {data.get('code')} {data.get('message')}")
    d = np.array([[np.nan if v is None else v for v in row] for row in data["durations"]], float)
    return d / 60.0


def _town_state(label: str, lon: float, lat: float) -> str:
    if label.endswith((", GA", ", SC", ", FL", ", NC", ", AL", ", TN")):
        return label
    from gridsight.response.geo import county_of

    f = county_of(np.array([lon]), np.array([lat]))[0]
    st = {"13": "GA", "45": "SC"}.get(f[:2], "")
    return f"{label}, {st}" if st else label


def build_yards(zones: list[dict]) -> list[dict]:
    joint = [z for z in zones if len(z["utilities"]) > 1]
    if not joint:
        return []
    cand = candidates()
    yards = []
    for z in joint:
        zc = z["centroid"]
        d = haversine_km(cand.lon, cand.lat, zc[0], zc[1])
        near = cand[d <= CANDIDATE_KM].assign(d=d[d <= CANDIDATE_KM]).sort_values("d").head(MAX_CANDIDATES)
        if near.empty:
            continue
        targets = [z["_parts"]["DESC"], z["_parts"]["GPC"]]
        mins = osrm_minutes(near[["lon", "lat"]].values.tolist(), targets)
        worst = np.nanmax(mins, axis=1)
        if np.all(np.isnan(worst)):
            continue
        k = int(np.nanargmin(worst))
        best = near.iloc[k]
        ypos = [float(best.lon), float(best.lat)]
        # other zones this yard can serve within SERVE_MINUTES
        others = [o for o in zones if o["id"] != z["id"]
                  and haversine_km(ypos[0], ypos[1], o["centroid"][0], o["centroid"][1]) <= 90]
        serves, drive = [z["id"]], [float(worst[k])]
        if others:
            m2 = osrm_minutes([ypos], [o["centroid"] for o in others])[0]
            for o, mm in zip(others, m2):
                if np.isfinite(mm) and mm <= SERVE_MINUTES:
                    serves.append(o["id"])
                    drive.append(float(mm))
        label = best.label if best.kind == "bridge" else _town_state(best.label, best.lon, best.lat)
        yards.append(
            {
                "id": f"Y{len(yards) + 1:02d}",
                "position": pos(*ypos),
                "label": label,
                "serves": serves,
                "maxDriveMinutes": round(max(drive), 1),
                "_driveDesc": round(float(mins[k, 0]), 1),
                "_driveGpc": round(float(mins[k, 1]), 1),
            }
        )
    return yards


def to_json(yards: list[dict]) -> list[dict]:
    keys = ["id", "position", "label", "serves", "maxDriveMinutes"]
    return [{k: y[k] for k in keys} for y in yards]

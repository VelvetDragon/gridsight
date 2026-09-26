"""Repair zones: clusters of likely-damaged DESC / GPC transmission segments.

1. High-risk segments: simulated failureProbability >= HIGH_RISK_P, utility DESC or GPC.
2. DBSCAN per utility on segment midpoints in EPSG:32617 metres
   (eps = EPS_KM, min_samples = MIN_SAMPLES). Noise points are dropped.
3. Joint zones: a DESC zone and a GPC zone whose closest member segments are within
   JOINT_KM (Sperry's 40 km crew tier) are merged (union-find) into one zone with
   utilities ["DESC", "GPC"]; these are where both utilities' crews will work near
   each other.
4. expectedDamagedSegments = sum of failure probabilities of member segments.
5. vulnerablePeople = emPOWER electricity-dependent beneficiaries in ZIPs whose centroid
   lies within the zone radius (max member distance from the centroid + 5 km, capped
   at 50 km).
6. priority (1 = first): rank by vulnerablePeople x (1 - exp(-expectedDamagedSegments / 5)),
   i.e. electricity-dependent residents weighted by how likely the zone is to have
   substantial damage (saturates at about 5 expected failed segments).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree
from sklearn.cluster import DBSCAN

from gridsight.config import GEO_CRS, METRIC_CRS
from gridsight.response.common import pos

HIGH_RISK_P = 0.2
EPS_KM = 5.0
MIN_SAMPLES = 3
JOINT_KM = 40.0
RADIUS_PAD_KM = 5.0
RADIUS_CAP_KM = 50.0
SATURATION_SEGMENTS = 5.0

_to_m = Transformer.from_crs(GEO_CRS, METRIC_CRS, always_xy=True)
_to_geo = Transformer.from_crs(METRIC_CRS, GEO_CRS, always_xy=True)


def _xy(lon, lat):
    x, y = _to_m.transform(np.asarray(lon, float), np.asarray(lat, float))
    return np.column_stack([x, y])


def cluster(seg: pd.DataFrame) -> pd.DataFrame:
    """Return high-risk DESC/GPC segments with a 'cluster' label ('DESC-3', ...)."""
    hr = seg[(seg["p_seg"] >= HIGH_RISK_P) & seg["utility"].isin(["DESC", "GPC"])].copy()
    hr["cluster"] = ""
    for util, grp in hr.groupby("utility"):
        if len(grp) < MIN_SAMPLES:
            continue
        lab = DBSCAN(eps=EPS_KM * 1000, min_samples=MIN_SAMPLES).fit_predict(_xy(grp.mid_lon, grp.mid_lat))
        hr.loc[grp.index, "cluster"] = [f"{util}-{k}" if k >= 0 else "" for k in lab]
    return hr[hr["cluster"] != ""]


def _merge_joint(hr: pd.DataFrame) -> dict[str, str]:
    """Union-find over DESC-GPC cluster pairs within JOINT_KM (closest member points)."""
    parent = {c: c for c in hr["cluster"].unique()}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    desc = {c: _xy(g.mid_lon, g.mid_lat) for c, g in hr[hr.utility == "DESC"].groupby("cluster")}
    gpc = {c: _xy(g.mid_lon, g.mid_lat) for c, g in hr[hr.utility == "GPC"].groupby("cluster")}
    for cd, pd_ in desc.items():
        tree = cKDTree(pd_)
        for cg, pg in gpc.items():
            d, _ = tree.query(pg, k=1)
            if d.min() <= JOINT_KM * 1000:
                parent[find(cd)] = find(cg)
    return {c: find(c) for c in parent}


def build_zones(seg: pd.DataFrame, vuln: pd.DataFrame) -> tuple[list[dict], pd.DataFrame]:
    hr = cluster(seg)
    if hr.empty:
        return [], hr
    root = _merge_joint(hr)
    hr["group"] = hr["cluster"].map(root)
    vxy = _xy(vuln.lon, vuln.lat)
    vtree = cKDTree(vxy)
    zones = []
    for _, g in hr.groupby("group"):
        xy = _xy(g.mid_lon, g.mid_lat)
        w = g["p_seg"].to_numpy()
        c = (xy * w[:, None]).sum(0) / w.sum()
        radius = min(RADIUS_CAP_KM * 1000, np.sqrt(((xy - c) ** 2).sum(1)).max() + RADIUS_PAD_KM * 1000)
        idx = vtree.query_ball_point(c, r=radius)
        people = int(vuln.iloc[idx]["electricityDependent"].sum()) if idx else 0
        lon, lat = _to_geo.transform(c[0], c[1])
        utils = sorted(g["utility"].unique().tolist())
        exp_seg = float(w.sum())
        zones.append(
            {
                "utilities": utils,
                "centroid": pos(lon, lat),
                "expectedDamagedSegments": round(exp_seg, 1),
                "vulnerablePeople": people,
                "_score": people * (1 - np.exp(-exp_seg / SATURATION_SEGMENTS)),
                "_radius_km": round(radius / 1000, 1),
                "_members": g.index.to_numpy(),
                "_parts": {
                    u: pos(*_to_geo.transform(*((_xy(p.mid_lon, p.mid_lat) * p.p_seg.to_numpy()[:, None]).sum(0) / p.p_seg.sum())))
                    for u, p in g.groupby("utility")
                },
            }
        )
    zones.sort(key=lambda z: (-z["_score"], -z["expectedDamagedSegments"]))
    for i, z in enumerate(zones, 1):
        z["priority"] = i
        kind = "J" if len(z["utilities"]) > 1 else z["utilities"][0][0]
        z["id"] = f"Z{i:02d}-{kind}"
    for z in zones:
        hr.loc[z["_members"], "zone"] = z["id"]
    return zones, hr


def to_json(zones: list[dict]) -> list[dict]:
    keys = ["id", "centroid", "utilities", "expectedDamagedSegments", "vulnerablePeople", "priority"]
    return [{k: z[k] for k in keys} for z in zones]

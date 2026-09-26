"""Electricity-dependent residents by ZIP code (HHS emPOWER).

Source: HHS emPOWER REST service (public), layer "Electricity Dependent DME - ALL -
ZipLevel": de-identified counts of Medicare Fee-for-Service and Medicare Advantage
beneficiaries with a claim for electricity-dependent durable medical equipment
(field Power_Dependent_Devices_DME). HIPAA-masked small counts are published as 0 or
suppressed by HHS; we use the published values as-is.
https://empowerprogram.hhs.gov/empowermap
Positions: Census 2023 Gazetteer ZCTA internal points (ZIP ~ ZCTA).
"""

from __future__ import annotations

import json

import pandas as pd

from gridsight.response.common import http_get, pos
from gridsight.response.geo import zcta_centroids

EMPOWER_URL = (
    "https://services2.arcgis.com/ZQ4jTQn6k7VPXEwO/arcgis/rest/services/"
    "HHS_emPOWER_REST_Service_Public/FeatureServer/1/query"
)


def fetch_empower(states=("GA", "SC")) -> pd.DataFrame:
    rows, offset = [], 0
    where = "STATE IN (" + ",".join(f"'{s}'" for s in states) + ")"
    while True:
        params = {
            "where": where,
            "outFields": "STATE,Zip_Code,FIPS_Code,Medicare_Benes,Power_Dependent_Devices_DME",
            "returnGeometry": "false",
            "orderByFields": "OBJECTID",
            "resultOffset": offset,
            "resultRecordCount": 2000,
            "f": "json",
        }
        raw = http_get(EMPOWER_URL, params=params, cache_name=f"empower_{'_'.join(states)}_{offset}.json")
        data = json.loads(raw)
        if "error" in data:
            raise RuntimeError(f"emPOWER error: {data['error']}")
        feats = data.get("features", [])
        rows += [f["attributes"] for f in feats]
        if not data.get("exceededTransferLimit") or not feats:
            break
        offset += len(feats)
    df = pd.DataFrame(rows)
    df["zip"] = df["Zip_Code"].astype(str).str.zfill(5)
    df["electricityDependent"] = pd.to_numeric(df["Power_Dependent_Devices_DME"], errors="coerce").fillna(0).astype(int)
    return df


def load() -> pd.DataFrame:
    """ZIP, lon, lat, fips, electricityDependent for GA + SC (ZIPs with a ZCTA point)."""
    emp = fetch_empower()
    z = zcta_centroids()
    df = emp.merge(z, on="zip", how="inner")
    df["fips"] = df["FIPS_Code"].astype(str).str.zfill(5)
    return df[["zip", "lon", "lat", "fips", "electricityDependent"]]


def to_json(df: pd.DataFrame) -> list[dict]:
    return [
        {"zip": r.zip, "position": pos(r.lon, r.lat), "electricityDependent": int(r.electricityDependent)}
        for r in df.sort_values("zip").itertuples()
    ]


if __name__ == "__main__":
    d = load()
    print(len(d), d.electricityDependent.sum(), d.groupby(d.fips.str[:2]).electricityDependent.sum().to_dict())

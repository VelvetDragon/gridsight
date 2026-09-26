"""Census geography used by Response mode: GA/SC counties, a US land mask and ZCTA centroids.

Sources (public domain, U.S. Census Bureau):
* Cartographic boundary counties 1:5M, 2023: cb_2023_us_county_5m.zip
* Cartographic boundary states 1:20M, 2023: cb_2023_us_state_20m.zip (land mask)
* 2023 Gazetteer ZCTA file (internal points of ZIP code tabulation areas)
Customer counts per county: EAGLE-I modeled county customers (MCC.csv, ORNL, CC BY 4.0).
"""

from __future__ import annotations

import io
import zipfile
from functools import lru_cache

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.ops import unary_union

from gridsight.config import GEO_CRS, METRIC_CRS
from gridsight.response.common import RAW_DIR, download

COUNTY_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_5m.zip"
STATE_URL = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip"
ZCTA_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip"
MCC_URL = "https://ndownloader.figshare.com/files/42547708"  # EAGLE-I MCC.csv

STATE_FIPS = {"13": "GA", "45": "SC"}


@lru_cache(maxsize=1)
def counties() -> gpd.GeoDataFrame:
    """GA + SC counties with centroid (internal point), area and customers."""
    path = download(COUNTY_URL, RAW_DIR / "cb_2023_us_county_5m.zip")
    gdf = gpd.read_file(f"zip://{path}")
    gdf = gdf[gdf["STATEFP"].isin(STATE_FIPS)].copy()
    gdf["fips"] = gdf["GEOID"]
    gdf["state"] = gdf["STATEFP"].map(STATE_FIPS)
    gdf["name"] = gdf["NAME"]
    gdf = gdf.to_crs(GEO_CRS)
    pts = gdf.geometry.representative_point()
    gdf["clon"], gdf["clat"] = pts.x, pts.y
    gdf["area_km2"] = gdf.to_crs(METRIC_CRS).geometry.area / 1e6
    mcc = customers()
    gdf["customers"] = gdf["fips"].map(mcc).fillna(0).astype(int)
    return gdf[["fips", "name", "state", "clon", "clat", "area_km2", "customers", "geometry"]].reset_index(drop=True)


@lru_cache(maxsize=1)
def customers() -> dict[str, int]:
    """EAGLE-I modeled county customers (Moehl et al.), keyed by 5-digit FIPS."""
    path = download(MCC_URL, RAW_DIR / "eaglei_MCC.csv")
    df = pd.read_csv(path, encoding="utf-8-sig", dtype={"County_FIPS": str})
    df["fips"] = df["County_FIPS"].str.zfill(5)
    return dict(zip(df["fips"], df["Customers"].astype(int)))


@lru_cache(maxsize=1)
def land_mask():
    """Union of US state polygons (1:20M), prepared for fast point-in-polygon tests."""
    path = download(STATE_URL, RAW_DIR / "cb_2023_us_state_20m.zip")
    gdf = gpd.read_file(f"zip://{path}").to_crs(GEO_CRS)
    geom = unary_union(gdf.geometry.values)
    shapely.prepare(geom)
    return geom


def on_land(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    geom = land_mask()
    return shapely.contains_xy(geom, np.asarray(lon, float), np.asarray(lat, float))


def county_of(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """5-digit county FIPS for each point (GA/SC only; '' elsewhere)."""
    c = counties()
    pts = gpd.GeoDataFrame(geometry=gpd.points_from_xy(lon, lat), crs=GEO_CRS)
    j = gpd.sjoin(pts, c[["fips", "geometry"]], how="left", predicate="within")
    j = j[~j.index.duplicated(keep="first")]
    return j["fips"].fillna("").to_numpy()


@lru_cache(maxsize=1)
def zcta_centroids() -> pd.DataFrame:
    path = download(ZCTA_URL, RAW_DIR / "2023_Gaz_zcta_national.zip")
    with zipfile.ZipFile(path) as zf:
        name = [n for n in zf.namelist() if n.endswith(".txt")][0]
        text = zf.read(name).decode("utf-8")
    df = pd.read_csv(io.StringIO(text), sep="\t", dtype={"GEOID": str})
    df.columns = [c.strip() for c in df.columns]
    return df.rename(columns={"GEOID": "zip", "INTPTLAT": "lat", "INTPTLONG": "lon"})[["zip", "lon", "lat"]]

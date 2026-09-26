"""Tree canopy cover along the lines and per county (USFS / MRLC NLCD Tree Canopy Cover).

Source: USDA Forest Service, NLCD Tree Canopy Cover (TCC) CONUS, product suite v2025-6,
30 m, annual 1985-2025, percent canopy cover 0-100. Public domain. Served by the
Interagency Imagery Publishing Platform as an ArcGIS ImageServer:
    https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer
(the old apps.fs.usda.gov/fsgisx01 endpoint now redirects there). Product page:
https://data.fs.usda.gov/geodata/rastergateway/treecanopycover/

Lightweight access: instead of the ~20 GB CONUS GeoTIFF we request the study-area
bounding box once through ``exportImage`` (one year locked with the mosaic rule),
resampled to a GRID_DEG (~0.001 deg, ~100 m) grid in EPSG:4326, in TILES x TILES tiles
(~40 MB in total), and cache it as a compressed numpy array. Everything else is
computed locally from that grid:

* segment canopy: mean canopy of the 3 x 3 grid cells (~300 m x 300 m) around each
  segment's two end points and midpoint, i.e. the tree cover next to the right-of-way
  (the cleared right-of-way itself is inside that window, so this is an under-estimate
  of the canopy at the right-of-way edge);
* county canopy: mean canopy of the grid cells whose centres fall inside the county.

YEAR = 2021 for every storm (2016-2024): canopy changes slowly and one year keeps the
exposure layer identical across storms (assumption).

County distribution-exposure proxies (also cached here):
* customers per km^2 of land: EAGLE-I modeled county customers (MCC.csv) / land area
  from the 2023 Census Gazetteer county file (ALAND);
* rural share: share of the county's housing units in rural blocks, 2020 Census
  urban/rural county file (2020_UA_COUNTY.xlsx, HOUPCT_RUR). Housing units stand in for
  electricity customers.
"""

from __future__ import annotations

import io
import json
import zipfile
from functools import lru_cache

import numpy as np
import pandas as pd
import shapely
from PIL import Image

from gridsight.config import BBOX
from gridsight.response.common import RAW_DIR, RESP_CACHE, download, http_get

TCC_URL = "https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_NLCD_TCC_CONUS/ImageServer"
YEAR = 2021
GRID_DEG = 0.001
TILES = 4
WINDOW = 1  # cells on each side (3 x 3 window)
GAZ_COUNTY_URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip"
UA_COUNTY_URL = "https://www2.census.gov/geo/docs/reference/ua/2020_UA_COUNTY.xlsx"
CACHE = RESP_CACHE / "canopy"
CACHE.mkdir(parents=True, exist_ok=True)

SOURCES = {
    "tree_canopy": {
        "citation": "USDA Forest Service, NLCD Tree Canopy Cover, CONUS, v2025-6 (30 m, percent)",
        "service": TCC_URL,
        "year": YEAR,
        "grid_deg": GRID_DEG,
    },
    "customers_density": "EAGLE-I MCC customers / 2023 Census Gazetteer county land area",
    "rural_share": "2020 Census urban and rural county file, HOUPCT_RUR (share of housing units in rural blocks)",
}


def _raster_id(year: int) -> int:
    """ImageServer catalog id of the NLCD TCC raster for ``year``."""
    raw = http_get(
        f"{TCC_URL}/query",
        params={"where": f"beginyear={year}", "outFields": "objectid,name,beginyear", "returnGeometry": "false", "f": "json"},
        cache_name=f"tcc_catalog_{year}.json",
        timeout=120,
    )
    feats = json.loads(raw).get("features", [])
    hits = [f["attributes"] for f in feats if "nlcd_tcc_conus" in f["attributes"]["name"]]
    if not hits:
        raise RuntimeError(f"no NLCD TCC CONUS raster for {year} in {TCC_URL}")
    return int(hits[0]["objectid"])


def _grid_shape() -> tuple[int, int]:
    w, s, e, n = BBOX
    return int(round((n - s) / GRID_DEG)), int(round((e - w) / GRID_DEG))


@lru_cache(maxsize=1)
def grid() -> np.ndarray:
    """Canopy percent on the BBOX grid, float32 [rows (north->south), cols]; NaN = no data."""
    path = CACHE / f"tcc_{YEAR}_{GRID_DEG:g}.npz"
    if path.exists():
        return _as_float(np.load(path)["tcc"])
    w, s, e, n = BBOX
    rows, cols = _grid_shape()
    rid = _raster_id(YEAR)
    out = np.full((rows, cols), 255, np.uint8)
    rb = np.linspace(0, rows, TILES + 1).astype(int)
    cb = np.linspace(0, cols, TILES + 1).astype(int)
    for i in range(TILES):
        for j in range(TILES):
            r0, r1, c0, c1 = rb[i], rb[i + 1], cb[j], cb[j + 1]
            bbox = (w + c0 * GRID_DEG, n - r1 * GRID_DEG, w + c1 * GRID_DEG, n - r0 * GRID_DEG)
            params = {
                "bbox": ",".join(f"{v:.6f}" for v in bbox),
                "bboxSR": 4326,
                "imageSR": 4326,
                "size": f"{c1 - c0},{r1 - r0}",
                "format": "tiff",
                "pixelType": "U8",
                "noDataInterpretation": "esriNoDataMatchAny",
                "interpolation": "RSP_BilinearInterpolation",
                "mosaicRule": json.dumps({"mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": [rid]}),
                "f": "image",
            }
            raw = http_get(f"{TCC_URL}/exportImage", params=params, cache_name=f"tcc_{YEAR}_{i}_{j}.tif", timeout=600)
            try:
                tile = np.array(Image.open(io.BytesIO(raw)))
            except OSError:
                # An all-no-data tile (open ocean) comes back as a sparse TIFF whose
                # internal tiles have no data blocks; anything else is a real error.
                if len(raw) > 100_000:
                    raise
                tile = np.full((r1 - r0, c1 - c0), 255, np.uint8)
            if tile.shape != (r1 - r0, c1 - c0):
                raise RuntimeError(f"tile {i},{j}: got {tile.shape}, expected {(r1 - r0, c1 - c0)}")
            out[r0:r1, c0:c1] = tile
            print(f"  canopy tile {i * TILES + j + 1}/{TILES * TILES}", end="\r", flush=True)
    print()
    np.savez_compressed(path, tcc=out)
    return _as_float(out)


def _as_float(a: np.ndarray) -> np.ndarray:
    f = a.astype(np.float32)
    f[a > 100] = np.nan  # 255 = no data (outside CONUS / water mask)
    return f


def _cell(lon, lat):
    w, s, e, n = BBOX
    rows, cols = _grid_shape()
    r = np.clip(((n - np.asarray(lat, float)) / GRID_DEG).astype(int), 0, rows - 1)
    c = np.clip(((np.asarray(lon, float) - w) / GRID_DEG).astype(int), 0, cols - 1)
    return r, c


def window_mean(lon, lat, k: int = WINDOW) -> np.ndarray:
    """Mean canopy percent in the (2k+1)^2 window around each point (NaN-aware)."""
    g = grid()
    rows, cols = g.shape
    r, c = _cell(lon, lat)
    tot = np.zeros(len(r))
    cnt = np.zeros(len(r))
    for dr in range(-k, k + 1):
        for dc in range(-k, k + 1):
            v = g[np.clip(r + dr, 0, rows - 1), np.clip(c + dc, 0, cols - 1)]
            ok = np.isfinite(v)
            tot += np.where(ok, v, 0.0)
            cnt += ok
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(cnt > 0, tot / cnt, np.nan)


def segment_canopy(seg: pd.DataFrame) -> np.ndarray:
    """Canopy fraction (0-1) next to each segment: mean over end points and midpoint."""
    key = CACHE / f"segments_{YEAR}_{len(seg)}.npy"
    if key.exists():
        return np.load(key)
    vals = np.vstack([
        window_mean(seg.lon0.to_numpy(), seg.lat0.to_numpy()),
        window_mean(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy()),
        window_mean(seg.lon1.to_numpy(), seg.lat1.to_numpy()),
    ])
    with np.errstate(invalid="ignore"):
        pct = np.nanmean(vals, axis=0)
    frac = np.nan_to_num(pct, nan=0.0) / 100.0
    np.save(key, frac.astype(np.float32))
    return frac.astype(np.float32)


def county_canopy() -> pd.Series:
    """Mean canopy fraction (0-1) per county FIPS."""
    from gridsight.response.geo import counties

    path = CACHE / f"counties_{YEAR}.csv"
    if path.exists():
        return pd.read_csv(path, dtype={"fips": str}).set_index("fips")["canopy"]
    g = grid()
    w, s, e, n = BBOX
    rows, cols = g.shape
    lon_c = w + (np.arange(cols) + 0.5) * GRID_DEG
    lat_c = n - (np.arange(rows) + 0.5) * GRID_DEG
    out = {}
    for r in counties().itertuples():
        x0, y0, x1, y1 = r.geometry.bounds
        ci = np.where((lon_c >= x0) & (lon_c <= x1))[0]
        ri = np.where((lat_c >= y0) & (lat_c <= y1))[0]
        if not len(ci) or not len(ri):
            out[r.fips] = np.nan
            continue
        xx, yy = np.meshgrid(lon_c[ci], lat_c[ri])
        inside = shapely.contains_xy(r.geometry, xx, yy)
        v = g[np.ix_(ri, ci)][inside]
        out[r.fips] = float(np.nanmean(v)) / 100.0 if np.isfinite(v).any() else np.nan
    s_ = pd.Series(out, name="canopy")
    s_.index.name = "fips"
    s_.reset_index().to_csv(path, index=False)
    return s_


@lru_cache(maxsize=1)
def county_exposure() -> pd.DataFrame:
    """Per county FIPS: canopy (0-1), customers per km^2 of land, rural share (0-1)."""
    from gridsight.response.geo import counties

    c = counties().set_index("fips")
    gaz = download(GAZ_COUNTY_URL, RAW_DIR / "2023_Gaz_counties_national.zip")
    with zipfile.ZipFile(gaz) as zf:
        name = [x for x in zf.namelist() if x.endswith(".txt")][0]
        g = pd.read_csv(io.StringIO(zf.read(name).decode("utf-8")), sep="\t", dtype={"GEOID": str})
    g.columns = [x.strip() for x in g.columns]
    aland_km2 = g.set_index("GEOID")["ALAND"].astype(float) / 1e6
    ua = download(UA_COUNTY_URL, RAW_DIR / "2020_UA_COUNTY.xlsx")
    u = pd.read_excel(ua, sheet_name="2020_UA_COUNTY", dtype={"STATE": str, "COUNTY": str})
    u["fips"] = u["STATE"].str.zfill(2) + u["COUNTY"].str.zfill(3)
    rural = u.set_index("fips")["HOUPCT_RUR"].astype(float)
    df = pd.DataFrame(index=c.index)
    df["canopy"] = county_canopy().reindex(c.index)
    df["cust_per_km2"] = c["customers"] / aland_km2.reindex(c.index).clip(lower=1.0)
    df["rural_share"] = rural.reindex(c.index)
    missing = df.isna().sum()
    if missing.any():
        print(f"  county exposure: filling missing values {missing[missing > 0].to_dict()} with medians")
        df = df.fillna(df.median())
    return df


def main() -> None:
    from gridsight.response.network import load_network

    seg = load_network()
    f = segment_canopy(seg)
    print(f"segments: {len(f)}, canopy mean {f.mean():.3f}, median {np.median(f):.3f}, >50 %: {(f > 0.5).mean():.3f}")
    ce = county_exposure()
    print(ce.describe().round(3).to_string())


if __name__ == "__main__":
    main()

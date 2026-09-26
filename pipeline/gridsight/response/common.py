"""Small helpers shared by the Response-mode modules: HTTP with cache, geodesy, JSON output."""

from __future__ import annotations

import hashlib
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import requests

from gridsight.config import CACHE_DIR, RAW_DIR, RESPONSE_OUT

USER_AGENT = "GridSight/0.1 (ShellHacks 2026 research; github.com/VelvetDragon/gridsight)"
HEADERS = {"User-Agent": USER_AGENT}

STORM_KEY = "helene"
OUT_DIR = RESPONSE_OUT / STORM_KEY
RESP_CACHE = CACHE_DIR / "response"
RESP_CACHE.mkdir(parents=True, exist_ok=True)

EARTH_RADIUS_KM = 6371.0088
KT_TO_MS = 0.514444
MS_TO_MPH = 2.236936
NM_TO_KM = 1.852


def utc(s: str) -> datetime:
    """Parse an ISO-ish UTC timestamp into an aware datetime."""
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_get(
    url: str,
    *,
    params: dict | None = None,
    data: dict | str | None = None,
    cache_name: str | None = None,
    retries: int = 4,
    timeout: int = 300,
    min_interval: float = 0.0,
    headers: dict | None = None,
) -> bytes:
    """GET (or POST when ``data`` is given) with an on-disk cache and polite retries."""
    if cache_name is None:
        key = json.dumps([url, params, data], sort_keys=True, default=str)
        cache_name = hashlib.sha1(key.encode()).hexdigest() + ".bin"
    path = RESP_CACHE / "http" / cache_name
    if path.exists():
        return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    hdrs = dict(HEADERS, **(headers or {}))
    last: Exception | None = None
    for attempt in range(retries):
        try:
            if min_interval:
                time.sleep(min_interval)
            if data is None:
                resp = requests.get(url, params=params, headers=hdrs, timeout=timeout)
            else:
                resp = requests.post(url, data=data, headers=hdrs, timeout=timeout)
            if resp.status_code in (429, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {resp.status_code}", response=resp)
            resp.raise_for_status()
            path.write_bytes(resp.content)
            return resp.content
        except (requests.RequestException, OSError) as exc:  # network hiccup or rate limit
            last = exc
            wait = 10 * (attempt + 1)
            print(f"  retry {attempt + 1}/{retries} in {wait}s: {exc}")
            time.sleep(wait)
    raise RuntimeError(f"failed to fetch {url}: {last}")


def download(url: str, dest: Path, *, timeout: int = 600) -> Path:
    """Stream a file to ``dest`` once (skip if present)."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, headers=HEADERS, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
    tmp.rename(dest)
    return dest


def haversine_km(lon1, lat1, lon2, lat2):
    """Great-circle distance in km; works on scalars and numpy arrays."""
    lon1, lat1, lon2, lat2 = (np.radians(np.asarray(v, dtype=float)) for v in (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def r5(x: float) -> float:
    return round(float(x), 5)


def pos(lon: float, lat: float) -> list[float]:
    """[lon, lat] rounded to 5 decimals (about 1 m)."""
    return [r5(lon), r5(lat)]


def write_json(name: str, obj: Any, out_dir: Path | None = None) -> Path:
    out_dir = out_dir or OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    with open(path, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"), allow_nan=False)
    size = path.stat().st_size
    print(f"wrote {path.relative_to(RESPONSE_OUT.parents[1])} ({size / 1e6:.2f} MB)")
    return path


def read_json(name: str) -> Any:
    with open(OUT_DIR / name) as fh:
        return json.load(fh)


def finite(x: float) -> bool:
    return x is not None and math.isfinite(x)


__all__ = [
    "CACHE_DIR",
    "RAW_DIR",
    "RESP_CACHE",
    "OUT_DIR",
    "HEADERS",
    "KT_TO_MS",
    "MS_TO_MPH",
    "NM_TO_KM",
    "download",
    "haversine_km",
    "http_get",
    "iso",
    "pos",
    "r5",
    "read_json",
    "utc",
    "write_json",
]

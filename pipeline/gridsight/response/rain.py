"""County rainfall for each storm (Open-Meteo historical weather API, ERA5 reanalysis).

Source: https://open-meteo.com/en/docs/historical-weather-api (free, no key, CC BY 4.0).
Daily precipitation at each county's interior point, in two windows:

    rain_storm_mm   landfall - 1 day .. landfall + 3 days  (the storm's own rain)
    rain_before_mm  the 7 days before that                 (already-soaked ground)

Soaked soil loosens roots, so the same gust brings down more trees; both windows
feed the county outage model. Cached per storm under RESP_CACHE/rain.
"""

from __future__ import annotations

import time
from datetime import timedelta

import pandas as pd
import requests

from gridsight.response.common import HEADERS, RESP_CACHE
from gridsight.response.geo import counties
from gridsight.response.storms import StormSpec

URL = "https://archive-api.open-meteo.com/v1/archive"
CACHE = RESP_CACHE / "rain"
BATCH = 50  # locations per request
STORM_DAYS = (-1, 3)
BEFORE_DAYS = 7


def _daily(lats: list[float], lons: list[float], start: str, end: str) -> list[dict]:
    params = {
        "latitude": ",".join(f"{v:.4f}" for v in lats),
        "longitude": ",".join(f"{v:.4f}" for v in lons),
        "start_date": start,
        "end_date": end,
        "daily": "precipitation_sum",
        "timezone": "GMT",
    }
    for attempt in range(6):
        try:
            r = requests.get(URL, params=params, headers=HEADERS, timeout=120)
            if r.status_code == 429:  # free tier is rate limited per minute: wait it out
                print("  rain: rate limited, waiting 65 s")
                time.sleep(65)
                continue
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else [data]
        except requests.RequestException as exc:
            print(f"  rain retry {attempt + 1}: {exc}")
    raise RuntimeError("Open-Meteo request failed")


def county_rain(spec: StormSpec) -> pd.DataFrame:
    """Per county FIPS: rain_storm_mm, rain_before_mm."""
    CACHE.mkdir(parents=True, exist_ok=True)
    c = counties()
    path = CACHE / f"{spec.key}_{len(c)}.csv"
    if path.exists():
        return pd.read_csv(path, dtype={"fips": str}).set_index("fips")
    day0 = spec.landfall.date()
    s0, s1 = day0 + timedelta(days=STORM_DAYS[0]), day0 + timedelta(days=STORM_DAYS[1])
    b0 = s0 - timedelta(days=BEFORE_DAYS)
    rows = []
    for i in range(0, len(c), BATCH):
        part = c.iloc[i : i + BATCH]
        out = _daily(part["clat"].tolist(), part["clon"].tolist(), b0.isoformat(), s1.isoformat())
        for fips, loc in zip(part["fips"], out):
            d = pd.Series(loc["daily"]["precipitation_sum"], index=pd.to_datetime(loc["daily"]["time"]).date, dtype=float)
            rows.append(
                {
                    "fips": fips,
                    "rain_storm_mm": float(d[(d.index >= s0) & (d.index <= s1)].sum()),
                    "rain_before_mm": float(d[d.index < s0].sum()),
                }
            )
    df = pd.DataFrame(rows).set_index("fips")
    df.reset_index().to_csv(path, index=False)
    print(f"  rain {spec.key}: storm mean {df.rain_storm_mm.mean():.0f} mm, before mean {df.rain_before_mm.mean():.0f} mm")
    return df

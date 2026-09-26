"""DOE / ORNL EAGLE-I county outage records (15-minute customers out), GA + SC only.

Source: Brelsford et al., "The Environment for Analysis of Geo-Located Energy
Information's Recorded Electricity Outages 2014-2025", figshare
(doi:10.6084/m9.figshare.24237376), CC BY 4.0. The same data is published on ORNL
Constellation (2014-2022: doi:10.13139/ORNLNCCS/1975202, 2024: doi:10.13139/OLCF/2500278)
but only through Globus, which needs a login; figshare serves the same yearly CSVs over
plain HTTPS with byte-range support.

The yearly files are 0.6-1.4 GB. We never download a whole year: each file is sorted
(2014-2023 by timestamp, 2024+ by county FIPS), so we binary-search byte offsets with
HTTP Range requests and fetch only the storm window (time-sorted years) or only the
GA/SC county block (FIPS-sorted years). A few tens of MB per storm instead of GBs.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta

import pandas as pd
import requests

from gridsight.response.common import HEADERS, RESP_CACHE

FIGSHARE_ARTICLE = "https://api.figshare.com/v2/articles/24237376"
FILE_IDS = {
    2016: 42547825,
    2017: 42547828,
    2018: 42547879,
    2019: 42547885,
    2020: 42547894,
    2021: 42547891,
    2022: 42547897,
    2023: 44574907,
    2024: 53581661,
}
SORT_KEY = {2016: "time", 2017: "time", 2018: "time", 2019: "time", 2020: "time", 2021: "time", 2022: "time", 2023: "time", 2024: "fips"}
STATES = ("01", "12", "13", "37", "45", "47")  # AL, FL, GA, NC, SC, TN (sorted: the 2024 file is FIPS-sorted)
CACHE = RESP_CACHE / "eaglei"
CACHE.mkdir(parents=True, exist_ok=True)
CHUNK = 64 * 1024


def _url(year: int) -> str:
    return f"https://ndownloader.figshare.com/files/{FILE_IDS[year]}"


def _range(year: int, start: int, end: int) -> bytes:
    """Bytes [start, end] of the yearly file (figshare redirects to a short-lived S3 URL)."""
    for attempt in range(5):
        try:
            r = requests.get(
                _url(year), headers=dict(HEADERS, Range=f"bytes={start}-{end}"), timeout=600
            )
            if r.status_code in (200, 206):
                return r.content
            raise requests.HTTPError(f"HTTP {r.status_code}")
        except requests.RequestException as exc:
            print(f"  range retry {attempt + 1}: {exc}")
    raise RuntimeError(f"range request failed for {year} {start}-{end}")


def _size(year: int) -> int:
    r = requests.get(_url(year), headers=dict(HEADERS, Range="bytes=0-0"), timeout=120)
    return int(r.headers["Content-Range"].split("/")[-1])


def _header(year: int) -> list[str]:
    return _range(year, 0, 4096).decode().splitlines()[0].strip().split(",")


def _first_row_at(year: int, offset: int) -> tuple[int, list[str]] | None:
    """Offset of and fields of the first complete line starting after ``offset``."""
    buf = _range(year, offset, offset + CHUNK)
    nl = buf.find(b"\n")
    if nl < 0:
        return None
    rest = buf[nl + 1 :]
    end = rest.find(b"\n")
    if end < 0:
        return None
    return offset + nl + 1, rest[:end].decode().strip().split(",")


def _key(fields: list[str], cols: list[str], kind: str) -> str:
    if kind == "time":
        return fields[cols.index("run_start_time")]
    return fields[cols.index("fips_code")].zfill(5)


def _search(year: int, target: str, kind: str, cols: list[str], size: int) -> int:
    """Smallest line offset whose key >= target (keys compare as strings)."""
    lo, hi = 0, size
    while hi - lo > CHUNK:
        mid = (lo + hi) // 2
        row = _first_row_at(year, mid)
        if row is None or _key(row[1], cols, kind) >= target:
            hi = mid
        else:
            lo = mid
    return lo


def _parse(block: bytes, cols: list[str]) -> pd.DataFrame:
    # Drop the partial first/last lines, then parse.
    start = block.find(b"\n") + 1
    end = block.rfind(b"\n")
    df = pd.read_csv(io.BytesIO(block[start:end]), names=cols, header=None, dtype={cols[0]: str})
    df = df.rename(columns={"sum": "customers_out"})
    df["fips"] = df["fips_code"].astype(str).str.zfill(5)
    df = df[df["fips"].str[:2].isin(STATES)]
    df["time"] = pd.to_datetime(df["run_start_time"], utc=True)
    return df[["fips", "time", "customers_out"]]


def fetch_window(year: int, t0: datetime, t1: datetime) -> pd.DataFrame:
    """GA/SC county rows with t0 <= time <= t1 (cached)."""
    name = CACHE / f"eaglei_{year}_{t0:%Y%m%d%H}_{t1:%Y%m%d%H}_{len(STATES)}st.parquet"
    if name.exists():
        return pd.read_parquet(name)
    cols = _header(year)
    size = _size(year)
    kind = SORT_KEY[year]
    blocks = []
    if kind == "time":
        a = _search(year, t0.strftime("%Y-%m-%d %H:%M:%S"), kind, cols, size)
        b = _search(year, (t1 + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S"), kind, cols, size)
        print(f"  EAGLE-I {year}: bytes {a:,}-{b + CHUNK:,} ({(b + CHUNK - a) / 1e6:.1f} MB)")
        blocks.append(_range(year, a, min(size - 1, b + CHUNK)))
    else:
        for st in STATES:
            a = _search(year, f"{st}000", kind, cols, size)
            b = _search(year, f"{int(st) + 1:02d}000", kind, cols, size)
            print(f"  EAGLE-I {year} state {st}: bytes {a:,}-{b + CHUNK:,} ({(b + CHUNK - a) / 1e6:.1f} MB)")
            blocks.append(_range(year, a, min(size - 1, b + CHUNK)))
    df = pd.concat([_parse(b, cols) for b in blocks], ignore_index=True)
    df = df[(df["time"] >= pd.Timestamp(t0)) & (df["time"] <= pd.Timestamp(t1))]
    df = df.drop_duplicates(["fips", "time"]).sort_values(["fips", "time"]).reset_index(drop=True)
    df.to_parquet(name)
    return df


def peak_out(year: int, t0: datetime, t1: datetime) -> pd.Series:
    """Peak customers out per county (FIPS index) within [t0, t1]."""
    df = fetch_window(year, t0, t1)
    return df.groupby("fips")["customers_out"].max()

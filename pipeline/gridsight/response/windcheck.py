"""Check the parametric wind field against observed ASOS peak gusts in GA / SC.

Observations: Iowa Environmental Mesonet ASOS archive (routine + special METARs),
networks GA_ASOS and SC_ASOS, max of reported gust and peak-wind remarks per station.
ASOS gusts are 5-second averages; the model gives 3-second gusts, so the model should
read slightly high. Many stations lose power at the height of a storm, so observed
maxima are lower bounds; we keep stations with at least 80 % of the expected hourly
reports in the window.

Usage: python -m gridsight.response.windcheck --storm helene
"""

from __future__ import annotations

import argparse
import io
from datetime import timedelta

import numpy as np
import pandas as pd
import torch

from gridsight.response import wind
from gridsight.response.common import http_get
from gridsight.response.geo import on_land
from gridsight.response.simulate import get_track
from gridsight.response.storms import resolve

IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
KT_TO_MPH = 1.15078


def observed(spec, hours_before: int = 12, hours_after: int = 36) -> pd.DataFrame:
    t0 = spec.landfall - timedelta(hours=hours_before)
    t1 = spec.landfall + timedelta(hours=hours_after)
    params = [
        ("network", "GA_ASOS"), ("network", "SC_ASOS"),
        ("data", "gust"), ("data", "peak_wind_gust"),
        ("year1", t0.year), ("month1", t0.month), ("day1", t0.day), ("hour1", t0.hour),
        ("year2", t1.year), ("month2", t1.month), ("day2", t1.day), ("hour2", t1.hour),
        ("tz", "Etc/UTC"), ("format", "onlycomma"), ("latlon", "yes"), ("missing", "M"),
        ("report_type", "3"), ("report_type", "4"),
    ]
    url = IEM + "?" + "&".join(f"{k}={v}" for k, v in params)
    raw = http_get(url, cache_name=f"asos_{spec.key}.csv", timeout=300)
    d = pd.read_csv(io.BytesIO(raw), na_values=["M", "T"])
    d["valid"] = pd.to_datetime(d["valid"])
    d["hour"] = d["valid"].dt.floor("h")
    expected = (t1 - t0).total_seconds() / 3600
    g = d.groupby("station").agg(
        lon=("lon", "first"), lat=("lat", "first"), gust=("gust", "max"),
        peak=("peak_wind_gust", "max"), hours=("hour", "nunique"),
    )
    g["obs_mph"] = g[["gust", "peak"]].max(axis=1) * KT_TO_MPH
    g = g[(g["hours"] >= 0.8 * expected) & g["obs_mph"].notna()]
    return g.reset_index()


def modeled(spec, mode: str, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    track = get_track(spec, mode)
    steps = wind.interpolate(track, dt_min=15.0)
    n = len(lon)
    zeros = torch.zeros(1, len(steps.hours), dtype=torch.float64)
    _, gust, _, _ = wind.peak_wind(
        steps,
        torch.tensor(lon, dtype=torch.float64), torch.tensor(lat, dtype=torch.float64),
        torch.tensor(on_land(lon, lat)), torch.zeros(n, dtype=torch.float64),
        ct_offset_km=zeros, dv_ms=zeros, rm_mult=torch.ones(1, dtype=torch.float64),
        gust_factor=torch.tensor([wind.GUST_FACTOR], dtype=torch.float64),
    )
    return gust[0].numpy() * 2.236936


def check(spec) -> dict:
    obs = observed(spec)
    out = {"storm": spec.key, "stations": int(len(obs))}
    for mode in ("best", "forecast"):
        m = modeled(spec, mode, obs.lon.to_numpy(float), obs.lat.to_numpy(float))
        err = m - obs.obs_mph.to_numpy()
        out[f"{mode}_bias_mph"] = round(float(err.mean()), 1)
        out[f"{mode}_mae_mph"] = round(float(np.abs(err).mean()), 1)
        out[f"{mode}_r"] = round(float(np.corrcoef(m, obs.obs_mph)[0, 1]), 2)
        obs[f"{mode}_mph"] = m.round(1)
    print(obs.sort_values("obs_mph", ascending=False).head(12).to_string(index=False))
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--storm", default="helene")
    a = ap.parse_args(argv)
    for spec in resolve(a.storm):
        print(check(spec))


if __name__ == "__main__":
    main()

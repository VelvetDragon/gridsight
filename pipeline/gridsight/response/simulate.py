"""Monte Carlo transmission-damage simulation (vectorised PyTorch; CPU or CUDA).

For every simulation s we perturb the storm and evaluate the wind field at every ~1 km
line segment midpoint (wind.py), then the structure fragility (fragility.py):

    p_struct[s, i] = P(structure on segment i fails | peak gust, wind-line angle)
    p_seg[s, i]    = 1 - (1 - p_struct)^n_i        (n_i structures on the segment,
                                                     independent given the wind)
    E_struct[s, i] = n_i * p_struct

Reported per segment: mean over simulations of p_seg (failureProbability) and of the
peak 3-s gust. Reported per utility / county: expected failed segments and structures
(mean and 5-95 % range over simulations).

Perturbations (independent per simulation; one draw per storm, applied along the track):

* Cross-track offset of the centre: z * sigma_track(lead), z ~ N(0, 1).
    forecast mode: sigma from NHC official Atlantic track errors 2020-2025 (mean
    distance error E at each lead time; sigma = E / sqrt(pi/2) for a circular normal):
    0/12/24/36/48/72/96/120 h -> 6.9/22.7/34.2/45.5/58.2/89.4/126.8/182.9 n mi.
    best-track mode: sigma = 15 km (assumed best-track position uncertainty).
* Intensity offset: z * sigma_int(lead) (kt).
    forecast: NHC OFCL mean absolute intensity errors 2020-2025,
    1.4/5.2/7.5/9.0/10.3/11.4/12.9/14.3 kt, sigma = MAE * sqrt(pi/2).
    best track: sigma = 5 kt (assumed).
* Radius of maximum wind: multiplier exp(N(0, 0.25^2)) (assumed).
* Gust factor: N(1.23, 0.05^2), clipped to [1.10, 1.40] (assumed spread around Durst).

Source for the error tables: https://www.nhc.noaa.gov/verification/verify5.shtml
(1989-present_OFCL_ATL_annual_trk_errors.pdf, 1990-present_OFCL_ATL_annual_int_errors.pdf).

Usage:
    python -m gridsight.response.simulate --storm helene --device auto --sims 10000
    python -m gridsight.response.simulate --storm all --device cuda --sims 10000
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd
import torch

from gridsight.config import BBOX
from gridsight.response import fragility, wind
from gridsight.response.common import RESP_CACHE, iso
from gridsight.response.hurdat import Track, load_ofcl, load_storms
from gridsight.response.network import load_network
from gridsight.response.storms import STORMS, StormSpec, resolve

LEAD_H = np.array([0, 12, 24, 36, 48, 72, 96, 120], float)
OFCL_TRACK_NM = np.array([6.9, 22.7, 34.2, 45.5, 58.2, 89.4, 126.8, 182.9])
OFCL_INT_KT = np.array([1.4, 5.2, 7.5, 9.0, 10.3, 11.4, 12.9, 14.3])
BEST_TRACK_SIGMA_KM = 15.0
BEST_INT_SIGMA_KT = 5.0
RMAX_LN_SIGMA = 0.25
GF_MEAN, GF_SD = wind.GUST_FACTOR, 0.05
UTILS = ["DESC", "GPC", "OTHER"]
SIM_DIR = RESP_CACHE / "sim"
SIM_DIR.mkdir(parents=True, exist_ok=True)


def pick_device(name: str) -> torch.device:
    if name == "auto":
        name = "cuda" if torch.cuda.is_available() else "cpu"
    if name == "cuda" and not torch.cuda.is_available():
        raise SystemExit("--device cuda requested but CUDA is not available")
    return torch.device(name)


def default_sims(device: torch.device) -> int:
    return 10000 if device.type == "cuda" else 500


def sigma_track_km(lead_h: np.ndarray, mode: str) -> np.ndarray:
    if mode == "best":
        return np.full_like(lead_h, BEST_TRACK_SIGMA_KM)
    e_nm = np.interp(lead_h, LEAD_H, OFCL_TRACK_NM)
    return e_nm * 1.852 / math.sqrt(math.pi / 2)


def sigma_int_ms(lead_h: np.ndarray, mode: str) -> np.ndarray:
    if mode == "best":
        return np.full_like(lead_h, BEST_INT_SIGMA_KT * 0.514444)
    return np.interp(lead_h, LEAD_H, OFCL_INT_KT) * math.sqrt(math.pi / 2) * 0.514444


def _near_region(steps: wind.TrackSteps, margin_deg: float = 7.0) -> np.ndarray:
    w, s, e, n = BBOX
    return (
        (steps.lon > w - margin_deg)
        & (steps.lon < e + margin_deg)
        & (steps.lat > s - margin_deg)
        & (steps.lat < n + margin_deg)
    )


@dataclass
class SimResult:
    storm: str
    mode: str
    sims: int
    device: str
    seconds: float
    seg: pd.DataFrame  # per segment: p_seg, e_struct, gust_mph, sus_mph (means)
    util_seg: np.ndarray  # [S, 3] expected failed segments per utility per sim
    util_struct: np.ndarray  # [S, 3] expected failed structures per utility per sim
    county: pd.DataFrame  # per county fips: e_seg, e_struct, n_seg, gust_mph, ts_hours (centroid)

    def summary(self) -> dict:
        out = {"storm": self.storm, "mode": self.mode, "sims": self.sims, "device": self.device,
               "seconds": round(self.seconds, 1)}
        for j, u in enumerate(UTILS):
            for name, arr in (("segments", self.util_seg), ("structures", self.util_struct)):
                v = arr[:, j]
                out[f"{u}_{name}_mean"] = round(float(v.mean()), 2)
                out[f"{u}_{name}_p05"] = round(float(np.percentile(v, 5)), 2)
                out[f"{u}_{name}_p95"] = round(float(np.percentile(v, 95)), 2)
        return out


def get_track(spec: StormSpec, mode: str) -> Track:
    if mode == "forecast":
        return load_ofcl(spec.hurdat_id, spec.forecast_cycle)
    return load_storms([spec.hurdat_id])[spec.hurdat_id]


def run(
    spec: StormSpec,
    mode: str = "forecast",
    sims: int | None = None,
    device: str = "auto",
    seed: int = 20240927,
    chunk: int | None = None,
    dt_min: float = 30.0,
) -> SimResult:
    from gridsight.response.geo import counties, county_of, on_land

    dev = pick_device(device)
    sims = sims or default_sims(dev)
    chunk = chunk or (1000 if dev.type == "cuda" else 25)
    dtype = torch.float32
    seg = load_network()
    cty = counties()
    track = get_track(spec, mode)
    steps = wind.interpolate(track, dt_min=dt_min)
    keep = _near_region(steps)
    if not keep.any():
        raise RuntimeError(f"{spec.key}: track never comes near the study area")
    idx = np.where(keep)[0]
    steps = wind.TrackSteps(
        steps.hours[idx], steps.lat[idx], steps.lon[idx], steps.vmax_ms[idx], steps.rmw_km[idx], steps.r34_km[idx],
        steps.vt_e[idx], steps.vt_n[idx], steps.lead_h[idx], steps.center_land[idx], steps.t0,
    )
    T = len(steps.hours)

    # Points: segment midpoints followed by county centroids (wind only).
    if "fips" not in seg.columns:
        seg["fips"] = county_of(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    if "land" not in seg.columns:
        seg["land"] = on_land(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    n_seg, n_cty = len(seg), len(cty)
    lon = np.concatenate([seg.mid_lon.to_numpy(), cty.clon.to_numpy()])
    lat = np.concatenate([seg.mid_lat.to_numpy(), cty.clat.to_numpy()])
    land = np.concatenate([seg.land.to_numpy(bool), np.ones(n_cty, bool)])
    brg = np.concatenate([seg.bearing_deg.to_numpy(), np.zeros(n_cty)])

    def t(x, dt=dtype):
        return torch.as_tensor(np.asarray(x), device=dev, dtype=dt)

    pt_lon, pt_lat, pt_land, pt_brg = t(lon), t(lat), torch.as_tensor(land, device=dev), t(brg)
    is_lat = torch.as_tensor(seg.structure.to_numpy() == "lattice", device=dev)
    n_struct = t(seg.n_structures.to_numpy())
    util_idx = torch.as_tensor(seg.utility.map({u: i for i, u in enumerate(UTILS)}).to_numpy(), device=dev)
    sig_ct = t(sigma_track_km(steps.lead_h, mode))
    sig_int = t(sigma_int_ms(steps.lead_h, mode))

    gen = torch.Generator(device="cpu").manual_seed(seed)
    acc_p = torch.zeros(n_seg, device=dev, dtype=torch.float64)
    acc_e = torch.zeros(n_seg, device=dev, dtype=torch.float64)
    acc_g = torch.zeros(n_seg + n_cty, device=dev, dtype=torch.float64)
    acc_s = torch.zeros(n_seg + n_cty, device=dev, dtype=torch.float64)
    acc_d = torch.zeros(n_seg + n_cty, device=dev, dtype=torch.float64)
    util_seg, util_struct = [], []
    t0 = time.time()
    done = 0
    while done < sims:
        m = min(chunk, sims - done)
        z = torch.randn(m, 4, generator=gen).to(dev, dtype)
        ct = z[:, 0:1] * sig_ct[None, :]  # [m, T]
        dv = z[:, 1:2] * sig_int[None, :]
        rm_mult = torch.exp(RMAX_LN_SIGMA * z[:, 2])
        gf = torch.clamp(GF_MEAN + GF_SD * z[:, 3], 1.10, 1.40)
        sus, gust, theta, dur = wind.peak_wind(
            steps, pt_lon, pt_lat, pt_land, pt_brg,
            ct_offset_km=ct, dv_ms=dv, rm_mult=rm_mult, gust_factor=gf,
        )
        ps = fragility.p_fail(gust[:, :n_seg], theta[:, :n_seg], is_lat)
        pseg = 1.0 - torch.pow(1.0 - ps, n_struct[None, :])
        est = ps * n_struct[None, :]
        acc_p += pseg.sum(0).double()
        acc_e += est.sum(0).double()
        acc_g += gust.sum(0).double()
        acc_s += sus.sum(0).double()
        acc_d += dur.sum(0).double()
        us = torch.zeros(m, len(UTILS), device=dev, dtype=torch.float64)
        ue = torch.zeros(m, len(UTILS), device=dev, dtype=torch.float64)
        us.index_add_(1, util_idx, pseg.double())
        ue.index_add_(1, util_idx, est.double())
        util_seg.append(us.cpu().numpy())
        util_struct.append(ue.cpu().numpy())
        done += m
        if dev.type == "cuda":
            torch.cuda.synchronize()
        print(f"  {spec.key}/{mode}: {done}/{sims} sims, {time.time() - t0:.0f}s", end="\r", flush=True)
    print()
    secs = time.time() - t0
    mph = wind.MS_TO_MPH if hasattr(wind, "MS_TO_MPH") else 2.236936
    g = (acc_g / sims).cpu().numpy() * mph
    s = (acc_s / sims).cpu().numpy() * mph
    dur_h = (acc_d / sims).cpu().numpy()
    out = seg.copy()
    out["p_seg"] = (acc_p / sims).cpu().numpy()
    out["e_struct"] = (acc_e / sims).cpu().numpy()
    out["gust_mph"] = g[:n_seg]
    out["sus_mph"] = s[:n_seg]
    cagg = out.groupby("fips").agg(e_seg=("p_seg", "sum"), e_struct=("e_struct", "sum"),
                                   n_seg=("p_seg", "size"), seg_gust_mph=("gust_mph", "mean"),
                                   seg_gust_max=("gust_mph", "max"))
    cdf = pd.DataFrame({"fips": cty.fips, "gust_mph": g[n_seg:], "sus_mph": s[n_seg:], "ts_hours": dur_h[n_seg:]}).set_index("fips")
    cdf = cdf.join(cagg, how="left").fillna({"e_seg": 0.0, "e_struct": 0.0, "n_seg": 0, "seg_gust_mph": 0.0, "seg_gust_max": 0.0})
    res = SimResult(spec.key, mode, sims, dev.type, secs, out, np.concatenate(util_seg), np.concatenate(util_struct), cdf.reset_index())
    save(res)
    return res


def _path(storm: str, mode: str) -> tuple:
    return SIM_DIR / f"{storm}_{mode}.npz", SIM_DIR / f"{storm}_{mode}.json"


def save(res: SimResult) -> None:
    npz, js = _path(res.storm, res.mode)
    np.savez_compressed(
        npz,
        p_seg=res.seg.p_seg.to_numpy(np.float32),
        e_struct=res.seg.e_struct.to_numpy(np.float32),
        gust_mph=res.seg.gust_mph.to_numpy(np.float32),
        sus_mph=res.seg.sus_mph.to_numpy(np.float32),
        util_seg=res.util_seg.astype(np.float32),
        util_struct=res.util_struct.astype(np.float32),
        county_fips=res.county.fips.to_numpy(str),
        county_gust=res.county.gust_mph.to_numpy(np.float32),
        county_sus=res.county.sus_mph.to_numpy(np.float32),
        county_ts_hours=res.county.ts_hours.to_numpy(np.float32),
    )
    meta = res.summary()
    meta["generatedAt"] = iso(pd.Timestamp.now('UTC').to_pydatetime())
    js.write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta))


def load(storm: str, mode: str) -> SimResult:
    """Rebuild a SimResult from the cached npz (for --skip-sim)."""
    from gridsight.response.geo import counties, county_of, on_land

    npz, js = _path(storm, mode)
    if not npz.exists():
        raise FileNotFoundError(f"no cached simulation for {storm}/{mode}; run simulate first")
    d = np.load(npz)
    info = json.loads(js.read_text())
    seg = load_network()
    if len(seg) != len(d["p_seg"]):
        raise RuntimeError("network changed since the simulation was cached; rerun simulate")
    seg["fips"] = county_of(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    seg["land"] = on_land(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    for k in ("p_seg", "e_struct", "gust_mph", "sus_mph"):
        seg[k] = d[k].astype(float)
    cagg = seg.groupby("fips").agg(e_seg=("p_seg", "sum"), e_struct=("e_struct", "sum"),
                                   n_seg=("p_seg", "size"), seg_gust_mph=("gust_mph", "mean"),
                                   seg_gust_max=("gust_mph", "max"))
    cdf = pd.DataFrame({"fips": d["county_fips"], "gust_mph": d["county_gust"], "sus_mph": d["county_sus"],
                        "ts_hours": d["county_ts_hours"]}).set_index("fips")
    cdf = cdf.join(cagg, how="left").fillna({"e_seg": 0.0, "e_struct": 0.0, "n_seg": 0, "seg_gust_mph": 0.0, "seg_gust_max": 0.0})
    _ = counties()
    return SimResult(storm, mode, int(info["sims"]), info["device"], float(info["seconds"]), seg,
                     d["util_seg"], d["util_struct"], cdf.reset_index())


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--storm", default="helene", help="storm key, HURDAT2 id, comma list, or 'all'")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--sims", type=int, default=None, help="default 10000 on cuda, 500 on cpu")
    ap.add_argument("--train-sims", type=int, default=None,
                    help="sims for the best-track (training) runs; default = --sims")
    ap.add_argument("--mode", default="both", choices=["forecast", "best", "both"])
    ap.add_argument("--chunk", type=int, default=None)
    ap.add_argument("--seed", type=int, default=20240927)
    a = ap.parse_args(argv)
    for spec in resolve(a.storm):
        modes = ["forecast", "best"] if a.mode == "both" else [a.mode]
        if not spec.publish:
            modes = ["best"]  # training-only storms need only the hindcast
        for mode in modes:
            n = a.train_sims if (mode == "best" and a.train_sims) else a.sims
            run(spec, mode=mode, sims=n, device=a.device, seed=a.seed, chunk=a.chunk)


if __name__ == "__main__":
    main()

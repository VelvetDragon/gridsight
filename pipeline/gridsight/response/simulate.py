"""Monte Carlo transmission-damage simulation (vectorised PyTorch; CPU or CUDA).

For every simulation s we perturb the storm and evaluate the wind field at every ~1 km
line segment midpoint (wind.py), then the structure fragility (fragility.py):

    p_struct[s, i] = P(structure on segment i fails | peak gust, wind-line angle)
    p_seg[s, i]    = 1 - (1 - p_struct)^n_i        (n_i structures on the segment,
                                                     independent given the wind)
    E_struct[s, i] = n_i * p_struct
    p_tree[s, i]   = 1 - exp(-lambda_i * length_i)   (tree strikes, treefall.py; lambda
                                                     from gust, wind-line angle, canopy)
    p_seg[s, i]    <- 1 - (1 - p_seg)(1 - p_tree)   (wind or trees, independent)

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
from gridsight.response import fragility, treefall, wind
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
    seg: pd.DataFrame  # per segment means: p_seg (wind or trees), p_seg_wind, p_tree, e_struct, tree_spans, gust_mph, sus_mph, canopy
    util_seg: np.ndarray  # [S, 3] expected failed segments (wind or trees) per utility per sim
    util_struct: np.ndarray  # [S, 3] expected wind-failed structures per utility per sim
    county: pd.DataFrame  # per county fips: e_seg, e_struct, n_seg, gust_mph, ts_hours, tree_frac (centroid)
    util_seg_wind: np.ndarray | None = None  # [S, 3] expected wind-only failed segments
    util_tree_spans: np.ndarray | None = None  # [S, 3] expected tree-struck spans

    def summary(self) -> dict:
        out = {"storm": self.storm, "mode": self.mode, "sims": self.sims, "device": self.device,
               "seconds": round(self.seconds, 1)}
        arrays = [("segments", self.util_seg), ("structures", self.util_struct)]
        if self.util_seg_wind is not None:
            arrays += [("wind_segments", self.util_seg_wind), ("tree_spans", self.util_tree_spans)]
        for j, u in enumerate(UTILS):
            for name, arr in arrays:
                v = arr[:, j]
                out[f"{u}_{name}_mean"] = round(float(v.mean()), 2)
                out[f"{u}_{name}_p05"] = round(float(np.percentile(v, 5)), 2)
                out[f"{u}_{name}_p95"] = round(float(np.percentile(v, 95)), 2)
        return out


def get_track(spec: StormSpec, mode: str) -> Track:
    if mode == "forecast":
        return load_ofcl(spec.hurdat_id, spec.forecast_cycle)
    return load_storms([spec.hurdat_id])[spec.hurdat_id]


@dataclass
class Scenario:
    """Everything the Monte Carlo needs, on the target device."""

    dev: torch.device
    seg: pd.DataFrame
    cty: pd.DataFrame
    steps: wind.TrackSteps
    n_seg: int
    n_cty: int
    pts: tuple  # (lon, lat, land, bearing) tensors for segments then county points
    is_lat: torch.Tensor
    n_struct: torch.Tensor
    seg_km: torch.Tensor
    canopy: torch.Tensor
    row_w: torch.Tensor
    row_h: torch.Tensor
    util_idx: torch.Tensor
    sig_ct: torch.Tensor
    sig_int: torch.Tensor


def prepare(spec: StormSpec, mode: str, device: str | torch.device = "auto", dt_min: float = 30.0,
            track: Track | None = None) -> Scenario:
    from gridsight.response.canopy import segment_canopy
    from gridsight.response.geo import counties, county_of, on_land

    dev = device if isinstance(device, torch.device) else pick_device(device)
    dtype = torch.float32
    seg = load_network()
    cty = counties()
    track = track or get_track(spec, mode)
    steps = wind.interpolate(track, dt_min=dt_min)
    keep = _near_region(steps)
    if not keep.any():
        raise RuntimeError(f"{spec.key}: track never comes near the study area")
    idx = np.where(keep)[0]
    steps = wind.TrackSteps(
        steps.hours[idx], steps.lat[idx], steps.lon[idx], steps.vmax_ms[idx], steps.rmw_km[idx], steps.r34_km[idx],
        steps.vt_e[idx], steps.vt_n[idx], steps.lead_h[idx], steps.center_land[idx], steps.t0,
    )
    if "fips" not in seg.columns:
        seg["fips"] = county_of(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    if "land" not in seg.columns:
        seg["land"] = on_land(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    seg["canopy"] = segment_canopy(seg)
    n_seg, n_cty = len(seg), len(cty)
    lon = np.concatenate([seg.mid_lon.to_numpy(), cty.clon.to_numpy()])
    lat = np.concatenate([seg.mid_lat.to_numpy(), cty.clat.to_numpy()])
    land = np.concatenate([seg.land.to_numpy(bool), np.ones(n_cty, bool)])
    brg = np.concatenate([seg.bearing_deg.to_numpy(), np.zeros(n_cty)])

    def t(x):
        return torch.as_tensor(np.array(x, dtype=float), device=dev, dtype=dtype)

    w, h = treefall.row_geometry(seg.voltage_kv.to_numpy())
    return Scenario(
        dev=dev, seg=seg, cty=cty, steps=steps, n_seg=n_seg, n_cty=n_cty,
        pts=(t(lon), t(lat), torch.as_tensor(land, device=dev), t(brg)),
        is_lat=torch.as_tensor(seg.structure.to_numpy() == "lattice", device=dev),
        n_struct=t(seg.n_structures.to_numpy()),
        seg_km=t(seg.length_km.to_numpy()),
        canopy=t(seg.canopy.to_numpy()),
        row_w=t(w), row_h=t(h),
        util_idx=torch.as_tensor(seg.utility.map({u: i for i, u in enumerate(UTILS)}).to_numpy(), device=dev),
        sig_ct=t(sigma_track_km(steps.lead_h, mode)),
        sig_int=t(sigma_int_ms(steps.lead_h, mode)),
    )


def draw(sc: Scenario, m: int, gen: torch.Generator):
    """One chunk of m perturbed storms: peak sustained, gust (m/s), wind-line angle, TS hours."""
    dtype = torch.float32
    z = torch.randn(m, 4, generator=gen).to(sc.dev, dtype)
    ct = z[:, 0:1] * sc.sig_ct[None, :]  # [m, T]
    dv = z[:, 1:2] * sc.sig_int[None, :]
    rm_mult = torch.exp(RMAX_LN_SIGMA * z[:, 2])
    gf = torch.clamp(GF_MEAN + GF_SD * z[:, 3], 1.10, 1.40)
    lon, lat, land, brg = sc.pts
    return wind.peak_wind(sc.steps, lon, lat, land, brg, ct_offset_km=ct, dv_ms=dv, rm_mult=rm_mult, gust_factor=gf)


def damage(sc: Scenario, gust: torch.Tensor, theta: torch.Tensor) -> dict:
    """Per-segment damage for a chunk of storms ([m, n_seg] each)."""
    g, th = gust[:, : sc.n_seg], theta[:, : sc.n_seg]
    ps = fragility.p_fail(g, th, sc.is_lat)
    p_wind = 1.0 - torch.pow(1.0 - ps, sc.n_struct[None, :])
    lam = treefall.strike_rate_per_km(g, th, sc.canopy, sc.row_w, sc.row_h)
    lam_len = lam * sc.seg_km[None, :]
    p_tree = 1.0 - torch.exp(-lam_len)
    spans = sc.n_struct[None, :] * (1.0 - torch.exp(-lam_len / sc.n_struct[None, :]))
    p_seg = 1.0 - (1.0 - p_wind) * (1.0 - p_tree)
    return {"p_seg": p_seg, "p_wind": p_wind, "p_tree": p_tree, "e_struct": ps * sc.n_struct[None, :], "spans": spans}


def run(
    spec: StormSpec,
    mode: str = "forecast",
    sims: int | None = None,
    device: str = "auto",
    seed: int = 20240927,
    chunk: int | None = None,
    dt_min: float = 30.0,
) -> SimResult:
    dev = pick_device(device)
    sims = sims or default_sims(dev)
    chunk = chunk or (1000 if dev.type == "cuda" else 25)
    sc = prepare(spec, mode, dev, dt_min)
    seg, cty, n_seg, n_cty = sc.seg, sc.cty, sc.n_seg, sc.n_cty

    gen = torch.Generator(device="cpu").manual_seed(seed)
    f64 = torch.float64
    acc = {k: torch.zeros(n_seg, device=dev, dtype=f64) for k in ("p_seg", "p_wind", "p_tree", "e_struct", "spans")}
    acc_g = torch.zeros(n_seg + n_cty, device=dev, dtype=f64)
    acc_s = torch.zeros(n_seg + n_cty, device=dev, dtype=f64)
    acc_d = torch.zeros(n_seg + n_cty, device=dev, dtype=f64)
    acc_tf = torch.zeros(n_cty, device=dev, dtype=f64)
    per_util = {k: [] for k in ("p_seg", "e_struct", "p_wind", "spans")}
    t0 = time.time()
    done = 0
    while done < sims:
        m = min(chunk, sims - done)
        sus, gust, theta, dur = draw(sc, m, gen)
        d = damage(sc, gust, theta)
        for k in acc:
            acc[k] += d[k].sum(0).double()
        acc_g += gust.sum(0).double()
        acc_s += sus.sum(0).double()
        acc_d += dur.sum(0).double()
        acc_tf += treefall.tree_fail_fraction(gust[:, n_seg:]).sum(0).double()
        for k in per_util:
            u = torch.zeros(m, len(UTILS), device=dev, dtype=f64)
            u.index_add_(1, sc.util_idx, d[k].double())
            per_util[k].append(u.cpu().numpy())
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
    for k, col in (("p_seg", "p_seg"), ("p_wind", "p_seg_wind"), ("p_tree", "p_tree"), ("e_struct", "e_struct"), ("spans", "tree_spans")):
        out[col] = (acc[k] / sims).cpu().numpy()
    out["gust_mph"] = g[:n_seg]
    out["sus_mph"] = s[:n_seg]
    cdf = pd.DataFrame({"fips": cty.fips, "gust_mph": g[n_seg:], "sus_mph": s[n_seg:], "ts_hours": dur_h[n_seg:],
                        "tree_frac": (acc_tf / sims).cpu().numpy()}).set_index("fips")
    res = SimResult(spec.key, mode, sims, dev.type, secs, out, np.concatenate(per_util["p_seg"]),
                    np.concatenate(per_util["e_struct"]), _county_agg(out, cdf),
                    np.concatenate(per_util["p_wind"]), np.concatenate(per_util["spans"]))
    save(res)
    return res


def _county_agg(seg: pd.DataFrame, cdf: pd.DataFrame) -> pd.DataFrame:
    cagg = seg.groupby("fips").agg(e_seg=("p_seg", "sum"), e_seg_wind=("p_seg_wind", "sum"), e_struct=("e_struct", "sum"),
                                   e_tree_spans=("tree_spans", "sum"), n_seg=("p_seg", "size"),
                                   seg_gust_mph=("gust_mph", "mean"), seg_gust_max=("gust_mph", "max"))
    cdf = cdf.join(cagg, how="left").fillna({"e_seg": 0.0, "e_seg_wind": 0.0, "e_struct": 0.0, "e_tree_spans": 0.0,
                                             "n_seg": 0, "seg_gust_mph": 0.0, "seg_gust_max": 0.0})
    return cdf.reset_index()


def _path(storm: str, mode: str) -> tuple:
    return SIM_DIR / f"{storm}_{mode}.npz", SIM_DIR / f"{storm}_{mode}.json"


SEG_COLS = ("p_seg", "p_seg_wind", "p_tree", "e_struct", "tree_spans", "gust_mph", "sus_mph")


def save(res: SimResult) -> None:
    npz, js = _path(res.storm, res.mode)
    np.savez_compressed(
        npz,
        **{k: res.seg[k].to_numpy(np.float32) for k in SEG_COLS},
        util_seg=res.util_seg.astype(np.float32),
        util_struct=res.util_struct.astype(np.float32),
        util_seg_wind=res.util_seg_wind.astype(np.float32),
        util_tree_spans=res.util_tree_spans.astype(np.float32),
        county_fips=res.county.fips.to_numpy(str),
        county_gust=res.county.gust_mph.to_numpy(np.float32),
        county_sus=res.county.sus_mph.to_numpy(np.float32),
        county_ts_hours=res.county.ts_hours.to_numpy(np.float32),
        county_tree_frac=res.county.tree_frac.to_numpy(np.float32),
    )
    meta = res.summary()
    meta["generatedAt"] = iso(pd.Timestamp.now('UTC').to_pydatetime())
    meta["treefall"] = {"F_ROW": treefall.F_ROW, "rho_per_m2": treefall.RHO_PER_M2}
    js.write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta))


def load(storm: str, mode: str) -> SimResult:
    """Rebuild a SimResult from the cached npz (for --skip-sim)."""
    from gridsight.response.canopy import segment_canopy
    from gridsight.response.geo import counties, county_of, on_land

    npz, js = _path(storm, mode)
    if not npz.exists():
        raise FileNotFoundError(f"no cached simulation for {storm}/{mode}; run simulate first")
    d = np.load(npz)
    if "p_tree" not in d.files:
        raise RuntimeError(f"cached simulation {npz.name} predates the tree-fall term; rerun simulate")
    info = json.loads(js.read_text())
    seg = load_network()
    if len(seg) != len(d["p_seg"]):
        raise RuntimeError("network changed since the simulation was cached; rerun simulate")
    seg["fips"] = county_of(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    seg["land"] = on_land(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    seg["canopy"] = segment_canopy(seg)
    for k in SEG_COLS:
        seg[k] = d[k].astype(float)
    cdf = pd.DataFrame({"fips": d["county_fips"], "gust_mph": d["county_gust"], "sus_mph": d["county_sus"],
                        "ts_hours": d["county_ts_hours"], "tree_frac": d["county_tree_frac"]}).set_index("fips")
    _ = counties()
    return SimResult(storm, mode, int(info["sims"]), info["device"], float(info["seconds"]), seg,
                     d["util_seg"], d["util_struct"], _county_agg(seg, cdf), d["util_seg_wind"], d["util_tree_spans"])


def calibrate_row_factor(storm: str = "helene", sims: int = 200, device: str = "auto", seed: int = 20240927) -> float:
    """Managed right-of-way factor F_ROW such that the storm's expected struck DESC spans
    (best track) equal treefall.CALIBRATION_TARGET_SPANS. Prints the value to hard-code."""
    spec = STORMS[storm]
    old = treefall.F_ROW
    treefall.F_ROW = 1.0
    try:
        dev = pick_device(device)
        sc = prepare(spec, "best", dev)
        desc = sc.util_idx == UTILS.index("DESC")
        gen = torch.Generator(device="cpu").manual_seed(seed)
        lam_len, n = [], sc.n_struct[desc]
        done = 0
        while done < sims:
            m = min(25, sims - done)
            _, gust, theta, _ = draw(sc, m, gen)
            lam = treefall.strike_rate_per_km(gust[:, : sc.n_seg], theta[:, : sc.n_seg], sc.canopy, sc.row_w, sc.row_h)
            lam_len.append((lam * sc.seg_km[None, :])[:, desc].cpu())
            done += m
        L = torch.cat(lam_len).double()
        n = n.cpu().double()

        def spans(f: float) -> float:
            return float((n[None, :] * (1 - torch.exp(-f * L / n[None, :]))).sum(1).mean())

        lo, hi = 1e-6, 1.0
        target = treefall.CALIBRATION_TARGET_SPANS
        if spans(hi) < target:
            return 1.0
        for _ in range(60):
            mid = math.sqrt(lo * hi)
            lo, hi = (mid, hi) if spans(mid) < target else (lo, mid)
        f = math.sqrt(lo * hi)
        print(f"F_ROW = {f:.4f}: {storm} expected struck DESC spans {spans(f):.1f} (F_ROW = 1: {spans(1.0):.1f})")
        return f
    finally:
        treefall.F_ROW = old


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
    ap.add_argument("--calibrate-row", action="store_true", help="print the managed right-of-way factor and exit")
    a = ap.parse_args(argv)
    if a.calibrate_row:
        calibrate_row_factor(device=a.device)
        return
    for spec in resolve(a.storm):
        modes = ["forecast", "best"] if a.mode == "both" else [a.mode]
        if not spec.publish:
            modes = ["best"]  # training-only storms need only the hindcast
        for mode in modes:
            n = a.train_sims if (mode == "best" and a.train_sims) else a.sims
            run(spec, mode=mode, sims=n, device=a.device, seed=a.seed, chunk=a.chunk)


if __name__ == "__main__":
    main()

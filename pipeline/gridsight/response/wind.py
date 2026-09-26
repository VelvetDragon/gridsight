"""Parametric hurricane surface wind field (PyTorch, runs on CPU or CUDA).

Model, per track time step and point:

1. Track interpolated linearly to <= 30-minute steps (HURDAT2 is 6-hourly).
2. Symmetric profile: Holland (1980) gradient-wind form with Coriolis,
       V(r) = sqrt( Vs^2 (Rm/r)^B exp(1 - (Rm/r)^B) + (r f / 2)^2 ) - r f / 2
   where Vs = Vmax - a*Vt is the storm-relative (symmetric) part of the best-track
   maximum wind. Holland, G.J. (1980), Mon. Wea. Rev. 108:1212-1218.
   Holland B is fitted so that the symmetric profile passes through the analysed or
   forecast 34-kt wind radius (mean of the four quadrants, HURDAT2 / OFCL), i.e.
   V(R34) = 34 kt, solved by bisection and clipped to [0.8, 2.5]. This matters for
   large storms such as Helene, whose tropical-storm-force winds reached far from the
   centre. When no R34 is available, B follows Vickery & Wadhera (2008), J. Appl.
   Meteor. Climatol. 47:2497-2517: B = 1.881 - 0.00557 Rm[km] - 0.01295 lat, clipped
   to [0.8, 2.2].
   If even B = 0.8 cannot reach R34, the outer exponent x of Holland et al. (2010)
   is lowered from 0.5 (see outer_exponent) so the profile still passes through R34.
   Rm = best-track radius of maximum wind when present (HURDAT2 since 2021, ATCF
   b-deck before that), else Willoughby, Darling & Rahn (2006) (hurdat.rmax_willoughby).
3. Direction: cyclonic tangential flow turned 20 deg inward (surface inflow angle).
4. Translation asymmetry: add a*Vt, with a = 0.55 and the translation vector rotated
   20 deg counter-clockwise (Lin & Chavas 2012, J. Geophys. Res. 117:D09120).
5. Surface reduction: HURDAT2 Vmax is already a 1-min, 10-m surface wind for the
   exposure under the eyewall (marine while the centre is offshore, land after
   landfall). When the centre is over water and the point is on land we multiply by a
   documented marine-to-open-terrain factor K_LAND = 0.83 (assumption; typical
   z0 = 0.0002 m -> 0.03 m log-law transition at 10 m gives about 0.8-0.87).
6. Gust: 3-s gust = GF x 1-min sustained, GF ~ 1.23 for open terrain (Durst 1960
   curve: 1.52 / 1.24; also used in ASCE 7 commentary). Perturbed per simulation.

Output: peak 1-min sustained and 3-s gust (m/s) at each point over the storm, the
angle between the wind and each line at the time of the peak gust (for fragility), and
the hours of tropical-storm-force (>= 34 kt) sustained wind.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import torch

from gridsight.response.hurdat import Track

A_TRANS = 0.55
TRANS_ROT_DEG = 20.0
INFLOW_DEG = 20.0
K_LAND = 0.83
GUST_FACTOR = 1.23
OMEGA = 7.292e-5
KM_PER_DEG = 111.195


@dataclass
class TrackSteps:
    """Track interpolated to fixed steps (numpy, host)."""

    hours: np.ndarray  # hours since first step
    lat: np.ndarray
    lon: np.ndarray
    vmax_ms: np.ndarray
    rmw_km: np.ndarray
    r34_km: np.ndarray  # NaN where not analysed / forecast
    vt_e: np.ndarray  # translation velocity (m/s), east / north
    vt_n: np.ndarray
    lead_h: np.ndarray  # hours since forecast issue (0 for best track)
    center_land: np.ndarray  # bool
    t0: np.datetime64


def interpolate(track: Track, dt_min: float = 30.0, t_start=None, t_end=None) -> TrackSteps:
    from gridsight.response.geo import on_land

    df = track.df
    t = df["time"].to_numpy(dtype="datetime64[s]").astype("int64") / 3600.0
    lo = t[0] if t_start is None else max(t[0], np.datetime64(t_start, "s").astype("int64") / 3600.0)
    hi = t[-1] if t_end is None else min(t[-1], np.datetime64(t_end, "s").astype("int64") / 3600.0)
    step = dt_min / 60.0
    tt = np.arange(lo, hi + 1e-9, step)
    lat = np.interp(tt, t, df["lat"].to_numpy(float))
    lon = np.interp(tt, t, df["lon"].to_numpy(float))
    vmax = np.interp(tt, t, df["vmax_kt"].to_numpy(float)) * 0.514444
    rmw = np.interp(tt, t, track.rmw_filled())
    r34_src = df["r34_km"].to_numpy(float) if "r34_km" in df else np.full(len(t), np.nan)
    ok = np.isfinite(r34_src)
    if ok.sum() >= 2:
        r34 = np.interp(tt, t[ok], r34_src[ok], left=np.nan, right=np.nan)
        # only between analysed times (no extrapolation past the last radius)
        r34[(tt < t[ok][0]) | (tt > t[ok][-1])] = np.nan
    else:
        r34 = np.full_like(tt, np.nan)
    # translation velocity from centred differences of the interpolated track
    dy = np.gradient(lat) * KM_PER_DEG * 1000.0
    dx = np.gradient(lon) * KM_PER_DEG * 1000.0 * np.cos(np.radians(lat))
    vt_e = dx / (step * 3600.0)
    vt_n = dy / (step * 3600.0)
    if track.issued is not None:
        issued = np.datetime64(track.issued.replace(tzinfo=None), "s").astype("int64") / 3600.0
        lead = np.maximum(0.0, tt - issued)
    else:
        lead = np.zeros_like(tt)
    t0 = np.datetime64(int(tt[0] * 3600), "s")
    return TrackSteps(tt - tt[0], lat, lon, vmax, rmw, r34, vt_e, vt_n, lead, on_land(lon, lat), t0)


def holland_b(rm_km: torch.Tensor, lat: torch.Tensor) -> torch.Tensor:
    return torch.clamp(1.881 - 0.00557 * rm_km - 0.01295 * lat, 0.8, 2.2)


V34_MS = 34 * 0.514444


def fit_b_r34(vs: torch.Tensor, rm: torch.Tensor, r34_km: float, iters: int = 40) -> torch.Tensor:
    """B such that the symmetric Holland profile gives 34 kt at r34 (bisection, [0.8, 2.5]).

    For r > Rm the profile at a fixed radius decreases monotonically with B.
    """
    lo = torch.full_like(vs, 0.8)
    hi = torch.full_like(vs, 2.5)
    ratio = torch.clamp(rm / r34_km, max=0.999)
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        x = ratio**mid
        v = vs * torch.sqrt(x * torch.exp(1.0 - x))
        too_strong = v > V34_MS  # profile too broad -> raise B
        lo = torch.where(too_strong, mid, lo)
        hi = torch.where(too_strong, hi, mid)
    return 0.5 * (lo + hi)


def outer_exponent(vs: torch.Tensor, rm: torch.Tensor, B: torch.Tensor, r34_km: float) -> torch.Tensor:
    """Holland et al. (2010) outer exponent x (0.5 = Holland 1980).

    When even B = 0.8 cannot carry 34 kt out to the analysed R34 (very large, weakening
    storms such as Irma over Georgia), keep B and lower x so V(R34) = 34 kt:
    x = ln(V34 / Vs) / ln(X e^(1 - X)), X = (Rm / R34)^B, clipped to [0.25, 0.5].
    Holland, Belanger & Fritz (2010), Mon. Wea. Rev. 138:4393-4401.
    """
    X = torch.clamp(rm / r34_km, max=0.999) ** B
    base = torch.clamp(X * torch.exp(1.0 - X), min=1e-6, max=0.999999)
    need = torch.log(torch.clamp(V34_MS / vs, max=0.999999)) / torch.log(base)
    return torch.clamp(need, 0.25, 0.5)


def peak_wind(
    steps: TrackSteps,
    pt_lon: torch.Tensor,
    pt_lat: torch.Tensor,
    pt_land: torch.Tensor,
    line_bearing: torch.Tensor,
    *,
    ct_offset_km: torch.Tensor,  # [S, T] cross-track offset of the centre (km, + = right of motion)
    dv_ms: torch.Tensor,  # [S, T] intensity perturbation (m/s)
    rm_mult: torch.Tensor,  # [S] multiplier on Rmax
    gust_factor: torch.Tensor,  # [S]
    max_radius_km: float = 900.0,
):
    """Peak sustained / gust wind (m/s), wind-line angle (deg) at the peak gust and hours
    of >= 34 kt sustained wind, each [S, N]."""
    dev, dt = pt_lon.device, pt_lon.dtype
    S, N = ct_offset_km.shape[0], pt_lon.shape[0]
    peak_sus = torch.zeros(S, N, device=dev, dtype=dt)
    ts_hours = torch.zeros(S, N, device=dev, dtype=dt)
    dt_h = float(steps.hours[1] - steps.hours[0]) if len(steps.hours) > 1 else 0.5
    peak_gust = torch.zeros(S, N, device=dev, dtype=dt)
    theta = torch.zeros(S, N, device=dev, dtype=dt)
    coslat_pts = torch.cos(torch.deg2rad(pt_lat))
    rot_t = math.radians(TRANS_ROT_DEG)
    inflow = math.radians(INFLOW_DEG)
    brg = torch.deg2rad(line_bearing)
    # unit vector along each line (east, north)
    le, ln = torch.sin(brg), torch.cos(brg)

    def T(x):
        return torch.as_tensor(x, device=dev, dtype=dt)

    for k in range(len(steps.hours)):
        lat_c, lon_c = float(steps.lat[k]), float(steps.lon[k])
        vte, vtn = float(steps.vt_e[k]), float(steps.vt_n[k])
        vt = math.hypot(vte, vtn)
        # right-hand normal of the motion (east, north)
        if vt > 0.1:
            ne, nn = vtn / vt, -vte / vt
        else:
            ne, nn = 0.0, 0.0
        off = ct_offset_km[:, k : k + 1]  # [S,1]
        clat = lat_c + off * nn / KM_PER_DEG
        clon = lon_c + off * ne / (KM_PER_DEG * math.cos(math.radians(lat_c)))
        # local tangent-plane offsets point - centre (km)
        dx = (pt_lon[None, :] - clon) * KM_PER_DEG * coslat_pts[None, :]
        dy = (pt_lat[None, :] - clat) * KM_PER_DEG
        r = torch.sqrt(dx * dx + dy * dy).clamp_min(0.5)
        if float(r.min()) > max_radius_km:
            continue
        vmax = torch.clamp(T(steps.vmax_ms[k]) + dv_ms[:, k : k + 1], min=8.0)  # [S,1]
        vs = torch.clamp(vmax - A_TRANS * vt, min=5.0)
        rm = (T(steps.rmw_km[k]) * rm_mult)[:, None]  # [S,1]
        r34 = float(steps.r34_km[k])
        xo = torch.full_like(vs, 0.5)
        if math.isfinite(r34) and float(vmax.min()) > V34_MS * 1.05:
            B = fit_b_r34(vs, rm, r34)
            xo = outer_exponent(vs, rm, B, r34)
        else:
            B = holland_b(rm, clat)
        f = 2 * OMEGA * math.sin(math.radians(abs(lat_c)))
        rf2 = r * 1000.0 * f / 2.0
        x = (rm / r) ** B
        shape = (x * torch.exp(1.0 - x)) ** (2.0 * xo)
        v_sym = torch.sqrt(vs * vs * shape + rf2 * rf2) - rf2
        # cyclonic (counter-clockwise) tangential unit vector, turned inward by the inflow angle
        te, tn = -dy / r, dx / r
        re_, rn_ = -dx / r, -dy / r  # inward radial
        ue = te * math.cos(inflow) + re_ * math.sin(inflow)
        un = tn * math.cos(inflow) + rn_ * math.sin(inflow)
        # translation component rotated counter-clockwise by TRANS_ROT_DEG
        ae = A_TRANS * (vte * math.cos(rot_t) - vtn * math.sin(rot_t))
        an = A_TRANS * (vte * math.sin(rot_t) + vtn * math.cos(rot_t))
        we = v_sym * ue + ae
        wn = v_sym * un + an
        speed = torch.sqrt(we * we + wn * wn)
        if not bool(steps.center_land[k]):
            speed = torch.where(pt_land[None, :], speed * K_LAND, speed)
        gust = speed * gust_factor[:, None]
        better = gust > peak_gust
        # angle between wind and conductor, folded to [0, 90]
        cosang = torch.abs(we * le[None, :] + wn * ln[None, :]) / speed.clamp_min(1e-6)
        ang = torch.rad2deg(torch.arccos(torch.clamp(cosang, 0.0, 1.0)))
        theta = torch.where(better, ang, theta)
        peak_gust = torch.maximum(peak_gust, gust)
        peak_sus = torch.maximum(peak_sus, speed)
        ts_hours += (speed >= V34_MS).to(dt) * dt_h
    return peak_sus, peak_gust, theta, ts_hours

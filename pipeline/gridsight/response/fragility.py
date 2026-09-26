"""Wind fragility curves for transmission structures.

All curves are lognormal CDFs of the peak 3-second gust at 10 m (open terrain):

    P(fail | V) = Phi( (ln V - mu) / sigma ) = Phi( ln(V / median) / beta )

Structure type per segment comes from OSM structure nodes (power=tower vs power=pole)
or, when untagged, a voltage rule (>= 230 kV lattice, else pole); see network.py.

WOOD / POLE STRUCTURES
    Darestani, Y.M. and Shafieezadeh, A. (2019). "Multi-dimensional wind fragility
    functions for wood utility poles." Engineering Structures 183:937-948.
    doi:10.1016/j.engstruct.2019.01.048. Accepted manuscript: https://par.nsf.gov/servlets/purl/10098529
    We use the 4-D model with pole height treated as uncertain (Section 3.2, eq. 21-22),
    Class 1 poles, Table 14:
        mu, sigma = b0 + b1*th + b2*AC + b3*t + b4*th^2 + b5*th*AC + b6*AC^2
                    + b7*th*t + b8*AC*t + b9*t^2
    th = angle between wind and conductors (deg, 0-90), AC = conductor area (m^2, 0-8),
    t = max(age, 25) years, V in mph (3-s gust). Check: th=90, AC=2, t=50 gives a
    median of exp(mu) = 165 mph, matching the paper's Fig. 4b / text.
    Assumptions (ours): Class 1 is the strongest class in the paper and stands in for
    transmission wood poles (which are often larger, so this is conservative); age 40
    years; AC = 8 m^2 (the top of the paper's validated range: three phases plus a shield
    wire over ~100 m spans exceed it, so we clamp).

STEEL LATTICE TOWERS
    Raj, S.V., Kumar, M. and Bhatia, U. (2021). "Fragility curves for power transmission
    towers in Odisha, India, based on observed damage during 2019 Cyclone Fani."
    arXiv:2107.06072. Table 1, combined uncertainty, 50th percentile, functionality
    disruption: median 280.4 km/h (3-s gust), beta 0.088. Their Table 2 shows this is
    consistent with the empirical US curve from Texas hurricanes 1999-2008 (Quanta
    Technology 2009: median 284 km/h) and Panteli et al. (2017) (294 km/h, beta 0.25).
    PNNL-33587 (Kabre & Weimar 2022, "Fragility Functions Resource Report") catalogs
    these tower-line fragility families (Sections 3.8-3.11, 4.1-4.2).
"""

from __future__ import annotations

import math

import torch

FRAGILITY_SOURCES = {
    "wood_pole": {
        "citation": "Darestani & Shafieezadeh (2019), Multi-dimensional wind fragility functions for wood utility poles, Engineering Structures 183:937-948",
        "url": "https://par.nsf.gov/servlets/purl/10098529",
        "model": "4-D lognormal, height uncertain, Class 1 (Table 14)",
        "intensity": "3-s gust, mph",
        "assumptions": {"class": 1, "age_years": 40, "conductor_area_m2": 8.0},
    },
    "steel_lattice": {
        "citation": "Raj, Kumar & Bhatia (2021), Fragility curves for power transmission towers in Odisha, India, based on observed damage during 2019 Cyclone Fani, arXiv:2107.06072",
        "url": "https://arxiv.org/abs/2107.06072",
        "model": "lognormal, functionality disruption, combined uncertainty 50th percentile (Table 1)",
        "intensity": "3-s gust, km/h",
        "median_kmh": 280.4,
        "beta": 0.088,
        "cross_check": "Quanta Technology (2009) Texas hurricanes: 284 km/h; Panteli et al. (2017): 294 km/h (Raj et al. Table 2)",
    },
    "catalog": {
        "citation": "Kabre & Weimar (2022), Fragility Functions Resource Report, PNNL-33587",
        "url": "https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-33587.pdf",
    },
}

# Table 14 (Class 1, height uncertain): coefficients b0..b9 for mu and sigma.
CLASS1_MU = [5.581e00, -4.306e-03, -2.408e-02, 5.986e-03, 2.569e-05, -1.231e-03, 3.524e-03, -1.176e-06, -1.324e-05, -1.327e-04]
CLASS1_SIGMA = [2.974e-01, -1.411e-03, -9.462e-03, -2.678e-03, 7.782e-06, -5.088e-05, 6.199e-04, 6.805e-06, 5.630e-05, 6.037e-05]

WOOD_AGE = 40.0
WOOD_AC = 8.0
LATTICE_MEDIAN_MPH = 280.4 / 1.609344
LATTICE_BETA = 0.088
MS_TO_MPH = 2.236936


def _surface(b, th, ac, t):
    return (
        b[0]
        + b[1] * th
        + b[2] * ac
        + b[3] * t
        + b[4] * th**2
        + b[5] * th * ac
        + b[6] * ac**2
        + b[7] * th * t
        + b[8] * ac * t
        + b[9] * t**2
    )


def wood_params(theta_deg, age=WOOD_AGE, ac=WOOD_AC):
    """(mu, sigma) of ln V[mph] for a Class 1 wood pole (Darestani & Shafieezadeh 2019)."""
    t = max(age, 25.0)
    mu = _surface(CLASS1_MU, theta_deg, ac, t)
    sigma = _surface(CLASS1_SIGMA, theta_deg, ac, t)
    return mu, sigma


def _phi(z: torch.Tensor) -> torch.Tensor:
    return 0.5 * (1.0 + torch.erf(z / math.sqrt(2.0)))


def p_fail(gust_ms: torch.Tensor, theta_deg: torch.Tensor, is_lattice: torch.Tensor) -> torch.Tensor:
    """Per-structure failure probability given the peak 3-s gust (m/s).

    gust_ms, theta_deg: [..., N]; is_lattice: [N] bool.
    """
    v = torch.clamp(gust_ms * MS_TO_MPH, min=1e-3)
    lnv = torch.log(v)
    th = torch.clamp(theta_deg, 0.0, 90.0)
    mu_w, sig_w = wood_params(th)
    p_wood = _phi((lnv - mu_w) / torch.clamp(sig_w, min=1e-3))
    p_lat = _phi((lnv - math.log(LATTICE_MEDIAN_MPH)) / LATTICE_BETA)
    return torch.where(is_lattice, p_lat, p_wood)


def describe() -> str:
    lines = []
    for th in (0.0, 45.0, 90.0):
        mu, sig = wood_params(torch.tensor(th))
        lines.append(f"wood Class 1 (age {WOOD_AGE:.0f}, AC {WOOD_AC} m2, theta {th:.0f}): median {math.exp(mu):.0f} mph, sigma {float(sig):.3f}")
    mu, sig = wood_params(torch.tensor(90.0), age=50, ac=2.0)
    lines.append(f"paper check (theta 90, AC 2, age 50): median {math.exp(mu):.1f} mph (paper: 165)")
    lines.append(f"steel lattice: median {LATTICE_MEDIAN_MPH:.0f} mph, beta {LATTICE_BETA}")
    return "\n".join(lines)


if __name__ == "__main__":
    print(describe())
    for mph in (60, 80, 100, 120, 140):
        g = torch.tensor([mph / MS_TO_MPH, mph / MS_TO_MPH])
        p = p_fail(g, torch.tensor([90.0, 90.0]), torch.tensor([False, True]))
        print(f"{mph} mph gust: wood {float(p[0]):.4f}  lattice {float(p[1]):.2e}")

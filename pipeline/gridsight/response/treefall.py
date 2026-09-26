"""Tree-fall term: probability that wind-thrown trees strike a transmission segment.

Direct wind fragility (fragility.py) only covers structures failing under wind load.
In hurricanes most line damage inland comes from trees falling into lines, so the
simulation adds a tree-strike term that depends on the peak 3-s gust, the wind-line
angle and the tree canopy next to the line (canopy.py, USFS NLCD Tree Canopy Cover).

PUBLISHED MODEL (functional form and tree parameters)
    Hou, G. and Muraleetharan, K.K. (2023). "Modeling the Resilience of Power
    Distribution Systems Subjected to Extreme Winds Considering Tree Failures: An
    Integrated Framework." International Journal of Disaster Risk Science 14:194-208.
    doi:10.1007/s13753-023-00478-x (open access, CC BY). Built on Hou, G. and Chen, S.
    (2020), Natural Hazards 102:1323-1350, doi:10.1007/s11069-020-03969-y.

    Tree fragility, logistic in tree height H (m) and 3-s gust U (m/s), Eq. 1-2, Table 2
    (Bur oak, finite-element tree model, AUC 0.98):
        stem breakage:  logit P = -17.28 + 0.42 H + 0.13 U
        uprooting:      logit P =  -2.22 - 0.43 H + 0.11 U
    Tree height H ~ Uniform[8, 28] m (their Table 1, after Hou & Chen 2020).
    Length of the broken piece: Hb = 0.946 H - 1.827 (Eq. 21).
    A failed tree reaches the line when (Eq. 11-12, Fig. 3)
        uprooted:  H  > sqrt(h^2  + d'^2)
        broken:    Hb > sqrt(h'^2 + d'^2),  h' = h - (H - Hb)
    with h the conductor height, d the tree-line distance and d' = d / sin(theta),
    theta the angle between the fall direction and the line. Trees fall downwind, so
    theta is the wind-line angle at the peak gust (wind.py) and only the upwind side
    of the line contributes.

WHAT WE COMPUTE (per segment, per simulation)
    For a tree at distance d the reach condition gives a maximum distance
        d_max(H, theta) = sin(theta) * sqrt(L^2 - h_eff^2)
    (L = H, h_eff = h for uprooting; L = Hb, h_eff = h' for breakage). Trees stand
    beyond the cleared right-of-way half-width w, so the strip of trees that can hit
    the line is max(0, d_max - w) wide. Expected strikes per km of line:
        lambda = 1000 * rho * c * E_H[ P_sb(H,U) * max(0, d_sb - w) + P_up(H,U) * max(0, d_up - w) ]
    c = canopy fraction next to the segment (0-1), rho = trees per m^2 under full
    canopy, E_H = average over H ~ U[8, 28] (11-point grid). Then, with Poisson strikes,
        P(segment struck) = 1 - exp(-lambda * length_km)
        expected struck spans = n_spans * (1 - exp(-lambda * length_km / n_spans))
    and the segment failure probability combines wind and trees as independent causes:
        p_seg = 1 - (1 - p_wind) * (1 - p_tree).

    The logistic curves give a small non-zero failure rate at zero wind; we remove it
    (P(U) - P(0)) / (1 - P(0)) so that calm weather produces no storm damage.

ASSUMPTIONS (ours, not from the paper; all uncertain)
    * Bur oak fragility stands in for all Southeast trees (mixed pine-hardwood).
    * rho = 0.03 trees per m^2 (300 overstory trees per hectare) under 100 % canopy.
    * Right-of-way half-width w and conductor height h by voltage class (typical
      utility right-of-way widths; not surveyed for these lines):
          < 100 kV: w 10 m, h 10 m;  100-199 kV: w 15 m, h 12 m;
          200-345 kV: w 20 m, h 14 m;  > 345 kV: w 30 m, h 18 m.
    * Every tree strike damages the span it hits (a repair job for a crew); the
      paper's wire-breakage / short-circuit fragility for distribution conductors is
      not applied to transmission conductors.
    * Managed right-of-way factor F_ROW (CALIBRATED, not validated): transmission
      owners remove danger trees along their rights-of-way (NERC FAC-003) and edge
      trees are more wind-firm than the open-grown trees the fragility describes, so
      only a fraction F_ROW of the forest's trees remain as hazard trees. With
      F_ROW = 1 the term predicts about 2,830 struck DESC spans for Helene (best
      track, 200 simulations), about 8 times the 350 damaged spans DESC reported
      (plus 130 poles). F_ROW is the single
      free scale of the term and is set so that Helene's expected struck DESC spans
      equal the 350 spans DESC reported (see calibrate_row_factor). The Helene span
      figure is therefore used for calibration and is NOT an independent check; the
      pole figure (130) is compared with structure failures, which the calibration
      does not touch.
    * The gust is the open-terrain 10 m gust from wind.py (no reduction for the
      forest's own roughness).
"""

from __future__ import annotations

import math

import numpy as np
import torch

SOURCE = {
    "citation": "Hou & Muraleetharan (2023), Modeling the Resilience of Power Distribution Systems Subjected to Extreme Winds Considering Tree Failures: An Integrated Framework, Int. J. Disaster Risk Sci. 14:194-208",
    "doi": "10.1007/s13753-023-00478-x",
    "tree_fragility": "Table 2, Bur oak: stem breakage (-17.28, 0.42 H, 0.13 U), uprooting (-2.22, -0.43 H, 0.11 U), U = 3-s gust m/s",
    "tree_height_m": [8, 28],
    "reach": "Eq. 11-12, Hb = 0.946 H - 1.827 (Eq. 21)",
}

SB = (-17.28, 0.42, 0.13)  # stem breakage: a0, a1 (H), a2 (U)
UP = (-2.22, -0.43, 0.11)  # uprooting
H_GRID = np.linspace(8.0, 28.0, 11)
RHO_PER_M2 = 0.03
F_ROW = 0.11  # `python -m gridsight.response.simulate --calibrate-row` gave 0.1096; see docstring
CALIBRATION_TARGET_SPANS = 350.0  # DESC transmission spans damaged in Helene (SC Daily Gazette, 2024-10-07)
# (upper kV bound, right-of-way half-width m, conductor height m)
VOLTAGE_CLASSES = [(99.0, 10.0, 10.0), (199.0, 15.0, 12.0), (345.0, 20.0, 14.0), (1e9, 30.0, 18.0)]
DEFAULT_CLASS = 1  # unknown voltage -> 100-199 kV class

ASSUMPTIONS = {
    "trees_per_m2_full_canopy": RHO_PER_M2,
    "tree_species": "Bur oak fragility used for all trees",
    "row_half_width_and_conductor_height_m_by_kv": {
        "<100": [10, 10], "100-199": [15, 12], "200-345": [20, 14], ">345": [30, 18],
    },
    "strike_damages_span": True,
    "managed_row_factor": "F_ROW, calibrated on Helene DESC damaged spans (350)",
    "gust": "open-terrain 10 m 3-s gust (no forest roughness reduction)",
}


def row_geometry(voltage_kv: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Right-of-way half-width and conductor height (m) per segment from its voltage."""
    v = np.asarray(voltage_kv, float)
    w = np.full(v.shape, VOLTAGE_CLASSES[DEFAULT_CLASS][1])
    h = np.full(v.shape, VOLTAGE_CLASSES[DEFAULT_CLASS][2])
    lo = -np.inf
    for hi, ww, hh in VOLTAGE_CLASSES:
        m = np.isfinite(v) & (v > lo) & (v <= hi)
        w[m], h[m] = ww, hh
        lo = hi
    return w, h


def _logistic_adj(a, H, U):
    """Logistic tree-failure probability with the zero-wind rate removed."""
    p = torch.sigmoid(a[0] + a[1] * H + a[2] * U)
    p0 = 1.0 / (1.0 + math.exp(-(a[0] + a[1] * H)))
    return torch.clamp((p - p0) / (1.0 - p0), min=0.0)


def tree_fail_fraction(gust_ms: torch.Tensor) -> torch.Tensor:
    """Expected fraction of trees (H ~ U[8, 28] m) that break or uproot at this gust."""
    acc = torch.zeros_like(gust_ms)
    for H in H_GRID:
        ps = _logistic_adj(SB, float(H), gust_ms)
        pu = _logistic_adj(UP, float(H), gust_ms)
        acc += 1.0 - (1.0 - ps) * (1.0 - pu)
    return acc / len(H_GRID)


def strike_rate_per_km(
    gust_ms: torch.Tensor, theta_deg: torch.Tensor, canopy: torch.Tensor, half_width_m: torch.Tensor, height_m: torch.Tensor
) -> torch.Tensor:
    """Expected tree strikes per km of line. gust/theta: [S, N]; canopy/width/height: [N]."""
    s = torch.sin(torch.deg2rad(torch.clamp(theta_deg, 0.0, 90.0)))
    w = half_width_m[None, :]
    h = height_m[None, :]
    band = torch.zeros_like(gust_ms)
    for H in H_GRID:
        H = float(H)
        hb = 0.946 * H - 1.827
        h_brk = h - (H - hb)
        reach_up = s * torch.sqrt(torch.clamp(H * H - h * h, min=0.0))
        reach_sb = s * torch.sqrt(torch.clamp(hb * hb - h_brk * h_brk, min=0.0))
        band += _logistic_adj(SB, H, gust_ms) * torch.clamp(reach_sb - w, min=0.0)
        band += _logistic_adj(UP, H, gust_ms) * torch.clamp(reach_up - w, min=0.0)
    band = band / len(H_GRID)
    return 1000.0 * RHO_PER_M2 * F_ROW * canopy[None, :] * band


def describe() -> str:
    lines = []
    for mph in (40, 60, 80, 100, 120):
        u = torch.tensor([mph / 2.236936])
        f = float(tree_fail_fraction(u)[0])
        lam = [
            float(strike_rate_per_km(u[None, :], torch.tensor([[90.0]]), torch.tensor([0.5]), torch.tensor([w]), torch.tensor([h]))[0, 0])
            for _, w, h in VOLTAGE_CLASSES
        ]
        lines.append(
            f"{mph:3d} mph gust: trees failing {f:.4f}; strikes/km at 50 % canopy, wind across the line, by kV class "
            + " / ".join(f"{x:.3f}" for x in lam)
        )
    return "\n".join(lines)


if __name__ == "__main__":
    print(describe())

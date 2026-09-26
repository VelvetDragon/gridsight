"""Downsampled network for the in-browser storm physics (src/lib/storm/physics.ts).

Writes public/data/response/segments-lite.json: a columnar sample of the ~64k
transmission segments that the browser can score for 50 perturbed tracks in about a
second. Sampling is stratified by utility, keeping every k-th segment in network order
(ways are stored contiguously, so this spreads the sample along every line); each kept
segment carries ``weight`` = the number of original segments it stands for, so
per-utility and per-county totals can be scaled back to the full network.

    DESC  k = 2   (the featured utility keeps the densest sample)
    GPC   k = 5
    OTHER k = 8

Per segment: utility index, structure (1 = lattice), midpoint lon/lat, bearing, length,
structures on the segment, land flag, county index, canopy fraction next to the line
(canopy.py), right-of-way half-width and conductor height (treefall.row_geometry),
weight. Also written: the GA/SC counties (fips, name, interior point), a coarse land
mask for the storm centre (the same US-states land test wind.py uses, on a 0.1 deg
grid, bit-packed, base64) and the physics constants.

    python -m gridsight.response.lite                    # segments-lite.json
    python -m gridsight.response.lite --fixture helene   # + Python reference values
                                                         #   for scripts/compare-storm-physics.mjs
"""

from __future__ import annotations

import argparse
import base64
import json

import numpy as np
import pandas as pd

from gridsight.config import REPO_ROOT, RESPONSE_OUT
from gridsight.response import fragility, treefall, wind
from gridsight.response.canopy import segment_canopy
from gridsight.response.common import write_json
from gridsight.response.geo import counties, county_of, on_land
from gridsight.response.network import load_network

STRIDE = {"DESC": 2, "GPC": 5, "OTHER": 8}
UTILS = ["DESC", "GPC", "OTHER"]
MASK = {"west": -100.0, "south": 10.0, "east": -60.0, "north": 48.0, "step": 0.1}
FIXTURE_DIR = REPO_ROOT / "scripts" / "fixtures"


def sample(seg: pd.DataFrame) -> pd.DataFrame:
    parts = []
    for u, k in STRIDE.items():
        g = seg[seg.utility == u]
        idx = np.arange(0, len(g), k)
        w = np.full(len(idx), k, float)
        w[-1] = len(g) - idx[-1]  # the last kept segment stands for the remainder
        parts.append(g.iloc[idx].assign(weight=w))
    return pd.concat(parts)


def land_mask() -> dict:
    m = MASK
    nx = int(round((m["east"] - m["west"]) / m["step"]))
    ny = int(round((m["north"] - m["south"]) / m["step"]))
    lon = m["west"] + (np.arange(nx) + 0.5) * m["step"]
    lat = m["south"] + (np.arange(ny) + 0.5) * m["step"]
    xx, yy = np.meshgrid(lon, lat)  # row 0 = south
    bits = on_land(xx.ravel(), yy.ravel()).astype(np.uint8)
    return {**m, "nx": nx, "ny": ny, "order": "row-major from the south-west cell",
            "bits": base64.b64encode(np.packbits(bits, bitorder="little").tobytes()).decode()}


def build() -> tuple[dict, pd.DataFrame]:
    seg = load_network()
    seg["fips"] = county_of(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    seg["land"] = on_land(seg.mid_lon.to_numpy(), seg.mid_lat.to_numpy())
    seg["canopy"] = segment_canopy(seg)
    w, h = treefall.row_geometry(seg.voltage_kv.to_numpy())
    seg["row_w"], seg["row_h"] = w, h
    lite = sample(seg)
    cty = counties()
    cidx = {f: i for i, f in enumerate(cty.fips)}
    out = {
        "note": "MrGridy downsampled transmission network for in-browser storm physics; see pipeline/gridsight/response/lite.py",
        "sampling": {"stride": STRIDE, "sourceSegments": int(len(seg)), "segments": int(len(lite))},
        "utilities": UTILS,
        "segments": {
            "utility": lite.utility.map({u: i for i, u in enumerate(UTILS)}).astype(int).tolist(),
            "lattice": (lite.structure == "lattice").astype(int).tolist(),
            "lon": [round(float(x), 5) for x in lite.mid_lon],
            "lat": [round(float(x), 5) for x in lite.mid_lat],
            "bearing": [round(float(x), 1) for x in lite.bearing_deg],
            "lengthKm": [round(float(x), 3) for x in lite.length_km],
            "nStructures": [round(float(x), 2) for x in lite.n_structures],
            "land": lite.land.astype(int).tolist(),
            "county": [cidx.get(f, -1) for f in lite.fips],
            "canopy": [round(float(x), 3) for x in lite.canopy],
            "rowHalfWidthM": [round(float(x), 1) for x in lite.row_w],
            "conductorHeightM": [round(float(x), 1) for x in lite.row_h],
            "weight": [round(float(x), 2) for x in lite.weight],
        },
        "counties": {
            "fips": cty.fips.tolist(),
            "name": cty.name.tolist(),
            "state": cty.state.tolist(),
            "lon": [round(float(x), 5) for x in cty.clon],
            "lat": [round(float(x), 5) for x in cty.clat],
        },
        "landMask": land_mask(),
        "constants": {
            "wind": {"aTrans": wind.A_TRANS, "transRotDeg": wind.TRANS_ROT_DEG, "inflowDeg": wind.INFLOW_DEG,
                     "kLand": wind.K_LAND, "gustFactor": wind.GUST_FACTOR},
            "fragility": {"woodAgeYears": fragility.WOOD_AGE, "woodConductorAreaM2": fragility.WOOD_AC,
                          "latticeMedianMph": round(fragility.LATTICE_MEDIAN_MPH, 3), "latticeBeta": fragility.LATTICE_BETA},
            "treefall": {"fRow": treefall.F_ROW, "rhoPerM2": treefall.RHO_PER_M2},
        },
    }
    return out, lite


def fixture(storm: str, lite: pd.DataFrame) -> None:
    """Python reference values on the lite segments (best-track simulation)."""
    from gridsight.response import simulate
    from gridsight.response.hurdat import load_storms
    from gridsight.response.storms import STORMS

    sim = simulate.load(storm, "best")
    s = sim.seg.loc[lite.index]
    trk = load_storms([STORMS[storm].hurdat_id])[STORMS[storm].hurdat_id].df
    r34 = [None if not np.isfinite(v) else round(float(v), 1) for v in trk["r34_km"]]
    per_util = {u: {"expectedFailedSegments": round(float(sim.util_seg[:, j].mean()), 2),
                    "expectedFailedStructures": round(float(sim.util_struct[:, j].mean()), 2),
                    "expectedWindFailedSegments": round(float(sim.util_seg_wind[:, j].mean()), 2),
                    "expectedTreeSpans": round(float(sim.util_tree_spans[:, j].mean()), 2)}
                for j, u in enumerate(UTILS)}
    obj = {
        "storm": storm, "mode": "best", "sims": sim.sims,
        "r34Km": r34,
        "pSeg": [round(float(x), 5) for x in s.p_seg],
        "pWind": [round(float(x), 5) for x in s.p_seg_wind],
        "pTree": [round(float(x), 5) for x in s.p_tree],
        "gustMph": [round(float(x), 2) for x in s.gust_mph],
        "perUtility": per_util,
    }
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    path = FIXTURE_DIR / f"{storm}-python-lite.json"
    path.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"wrote {path.relative_to(REPO_ROOT)} ({path.stat().st_size / 1e6:.2f} MB)")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--fixture", default=None, help="also export Python reference values for this storm")
    a = ap.parse_args(argv)
    out, lite = build()
    write_json("segments-lite.json", out, RESPONSE_OUT)
    print(f"lite segments: {len(lite)} of {out['sampling']['sourceSegments']}")
    if a.fixture:
        fixture(a.fixture, lite)


if __name__ == "__main__":
    main()

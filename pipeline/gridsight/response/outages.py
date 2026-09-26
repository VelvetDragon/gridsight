"""County peak-outage model: physics features + gradient boosting, leave-one-storm-out.

Target (per county and storm): EAGLE-I peak customers out within
[landfall - 24 h, landfall + 96 h], as a fraction of the county's customers
(EAGLE-I modeled county customers, MCC.csv).

Features (from the Monte Carlo simulation of that storm, simulate.py):
    exp_seg_density   expected failed transmission segments per 1,000 km^2
    exp_struct_log    log(1 + expected failed transmission structures in the county)
    gust_centroid     mean peak 3-s gust at the county's interior point (mph)
    gust_lines        mean peak gust over the county's line segments (mph)
    ts_hours          hours of >= 34 kt sustained wind at the interior point (duration)
    seg_density       transmission segments per 1,000 km^2 (exposure)
    log_customers     log(customers)

Model:    sklearn GradientBoostingRegressor (absolute-error loss) on all features.
Baseline: the same learner on gust_centroid only ("wind-only").
Both predict the outage fraction; predictions are multiplied by customers.

Evaluation: leave-one-storm-out over every storm with EAGLE-I data. Each storm's
published predictedPeakOut comes from the model trained without that storm. The
held-out score is the county MAE of the outage FRACTION (predicted vs actual peak
customers out / customers, actual clipped to 1), over GA + SC counties with EAGLE-I
records; the MAE in customers is reported alongside.
"""

from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor

from gridsight.response import eaglei
from gridsight.response.geo import counties
from gridsight.response.simulate import SimResult
from gridsight.response.storms import StormSpec

FEATURES = ["exp_seg_density", "exp_struct_log", "gust_centroid", "gust_lines", "ts_hours", "seg_density", "log_customers"]
BASELINE = ["gust_centroid"]
WINDOW_BEFORE_H = 24
WINDOW_AFTER_H = 96


def actual_peaks(spec: StormSpec) -> pd.Series | None:
    """EAGLE-I peak customers out per GA/SC county, or None if unavailable."""
    if spec.year not in eaglei.FILE_IDS:
        return None
    t0 = spec.landfall - timedelta(hours=WINDOW_BEFORE_H)
    t1 = spec.landfall + timedelta(hours=WINDOW_AFTER_H)
    try:
        return eaglei.peak_out(spec.year, t0, t1)
    except Exception as exc:  # network / format problems: degrade gracefully
        print(f"  EAGLE-I unavailable for {spec.key}: {exc}")
        return None


def features(sim: SimResult) -> pd.DataFrame:
    c = counties().set_index("fips")
    s = sim.county.set_index("fips").reindex(c.index)
    area = c["area_km2"].clip(lower=1.0)
    df = pd.DataFrame(index=c.index)
    df["exp_seg_density"] = s["e_seg"].fillna(0) / area * 1000
    df["exp_struct_log"] = np.log1p(s["e_struct"].fillna(0))
    df["gust_centroid"] = s["gust_mph"].fillna(0)
    lines = s["seg_gust_mph"].where(s["n_seg"] > 0)
    df["gust_lines"] = lines.fillna(df["gust_centroid"])
    df["ts_hours"] = s["ts_hours"].fillna(0)
    df["seg_density"] = s["n_seg"].fillna(0) / area * 1000
    df["log_customers"] = np.log(c["customers"].clip(lower=1))
    df["customers"] = c["customers"]
    return df


def _model() -> GradientBoostingRegressor:
    return GradientBoostingRegressor(
        loss="absolute_error", n_estimators=300, max_depth=3, learning_rate=0.05,
        subsample=0.8, min_samples_leaf=8, random_state=0,
    )


def build_table(sims: dict[str, SimResult], specs: dict[str, StormSpec]) -> pd.DataFrame:
    rows = []
    for key, sim in sims.items():
        f = features(sim)
        act = actual_peaks(specs[key])
        f["storm"] = key
        f["actual"] = np.nan if act is None else act.reindex(f.index).astype(float)
        rows.append(f.reset_index())
    t = pd.concat(rows, ignore_index=True)
    t["frac"] = (t["actual"] / t["customers"].clip(lower=1)).clip(0, 1)
    return t


def leave_one_storm_out(train: pd.DataFrame, apply: dict[str, pd.DataFrame] | None = None):
    """Train on all labelled storms but one; score / predict the held-out storm.

    ``train`` rows use the training-feature variant (best-track simulations).
    ``apply`` optionally maps storm -> feature rows to predict for that storm (e.g.
    forecast-driven features); defaults to its own training rows.
    Returns (per-storm predictions, cross-validation list).
    """
    labelled = sorted(train.loc[train["actual"].notna(), "storm"].unique())
    preds, cv = {}, []
    for storm in sorted(train["storm"].unique()):
        tr = train[(train["storm"] != storm) & train["actual"].notna()]
        if tr["storm"].nunique() < 2:
            continue
        m_full = _model().fit(tr[FEATURES], tr["frac"])
        m_base = _model().fit(tr[BASELINE], tr["frac"])
        target = (apply or {}).get(storm, train[train["storm"] == storm])
        out = target[["fips", "customers"]].copy()
        out["pred"] = np.clip(m_full.predict(target[FEATURES]), 0, 1) * out["customers"]
        out["base"] = np.clip(m_base.predict(target[BASELINE]), 0, 1) * out["customers"]
        own = train[train["storm"] == storm].set_index("fips")["actual"]
        out["actual"] = out["fips"].map(own)
        preds[storm] = out
        if storm in labelled:
            ok = out["actual"].notna()
            o = out[ok]
            cust = o["customers"].clip(lower=1)
            fa = (o["actual"] / cust).clip(0, 1)
            cv.append(
                {
                    "storm": storm,
                    "maePredicted": round(float((o["pred"] / cust - fa).abs().mean()), 4),
                    "maeBaseline": round(float((o["base"] / cust - fa).abs().mean()), 4),
                    "maeCustomersPredicted": round(float((o["pred"] - o["actual"]).abs().mean()), 1),
                    "maeCustomersBaseline": round(float((o["base"] - o["actual"]).abs().mean()), 1),
                    "counties": int(ok.sum()),
                    "trainStorms": sorted(tr["storm"].unique().tolist()),
                }
            )
    return preds, cv

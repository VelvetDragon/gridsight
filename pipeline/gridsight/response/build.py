"""End-to-end Response-mode build: simulations -> outage model -> zones -> yards -> JSON.

Usage (from pipeline/):
    python -m gridsight.response.build --storm all                 # CPU: 500 sims per run
    python -m gridsight.response.build --storm all --skip-sim      # reuse cached simulations
    python -m gridsight.response.build --storm all --device cuda --sims 10000

Writes public/data/response/<storm>/{storm,segments,counties,zones,yards,vulnerable,meta}.json
and mutual-aid.json (mutual_aid.py) for each published storm, and
public/data/response/storms.json. Shapes follow
src/lib/types.ts (Response mode) and are checked before writing.

Which simulation drives the published maps (--track):
    best      HURDAT2 best track + analysis-uncertainty perturbations (default; the
              damage/outage pattern the model gives when the track is known).
    forecast  NHC official forecast issued ~48 h before landfall + NHC forecast-error
              perturbations (what the tool would have shown at replayStart).
Both are simulated for published storms and both scores are printed and saved to the
cache (build_report.json), so the difference is visible.
"""

from __future__ import annotations

import argparse
import json
import math

import numpy as np
import pandas as pd

from gridsight.response import outages, simulate, vulnerable, yards, zones
from gridsight.config import RESPONSE_OUT
from gridsight.response.common import RESP_CACHE, iso, pos, write_json
from gridsight.response.geo import counties
from gridsight.response.hurdat import load_storms, storm_json
from gridsight.response.storms import STORMS, resolve

# Public damage figures to compare with (only Helene has one for DESC transmission).
# Keller Kissam (DESC president), quoted by SC Daily Gazette, 2024-10-07: 130 transmission
# poles, 350 spans of transmission line, 2,130 distribution poles, 1,090 transformers
# damaged in DESC's service area. The single damage number shown is expected damaged
# DESC line sections (wind or trees), compared with the 350 damaged spans. The tree-fall
# term is calibrated on those 350 spans (treefall.py), so this is a consistency check;
# the independent test is the county outage error (countyMae*).
REPORTED_DESC_TX_SPANS = {"helene": 350}
REPORTED_SOURCE = "https://scdailygazette.com/2024/10/07/sc-led-southeast-in-customers-in-the-dark-days-after-helene-utilities-respond-to-complaints/"

SEG_MIN_P = 0.005  # segments below this failure probability are not written
SEG_MAX_BYTES = 3_000_000
VULN_MIN_FRACTION = 0.01  # ZIPs in counties with predicted outage >= 1 % of customers


def run_sims(specs, published, device, sims, train_sims, skip):
    for spec in specs:
        modes = ["best"] + (["forecast"] if spec.key in published else [])
        for mode in modes:
            if skip:
                continue
            n = train_sims if (mode == "best" and spec.key not in published and train_sims) else sims
            simulate.run(spec, mode=mode, sims=n, device=device)


def segments_json(seg: pd.DataFrame) -> list[dict]:
    s = seg[(seg["p_seg"] >= SEG_MIN_P)].sort_values("p_seg", ascending=False)
    out = []
    size = 2
    for r in s.itertuples():
        rec = {
            "utility": r.utility,
            "coordinates": [pos(r.lon0, r.lat0), pos(r.lon1, r.lat1)],
            "peakWindMph": round(float(r.gust_mph), 1),
            "failureProbability": round(float(r.p_seg), 4),
        }
        size += len(json.dumps(rec, separators=(",", ":"))) + 1
        if size > SEG_MAX_BYTES:
            break
        out.append(rec)
    return out


def counties_json(pred: pd.DataFrame) -> list[dict]:
    c = counties().set_index("fips")
    p = pred.set_index("fips")
    out = []
    for f, r in c.sort_index().iterrows():
        act = p.at[f, "actual"] if f in p.index else math.nan
        out.append(
            {
                "fips": f,
                "name": r["name"],
                "state": r["state"],
                "customers": int(r["customers"]),
                "predictedPeakOut": int(round(float(p.at[f, "pred"]))) if f in p.index else 0,
                "actualPeakOut": None if not np.isfinite(act) else int(round(float(act))),
                "centroid": pos(r["clon"], r["clat"]),
            }
        )
    return out


# ---- contract check (mirrors src/lib/types.ts) ----

def _is_pos(v):
    return isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v)


def check_contract(files: dict) -> list[str]:
    errs = []
    st = files["storm.json"]
    for k in ("id", "name", "year", "track", "replayStart"):
        if k not in st:
            errs.append(f"storm.{k} missing")
    for p in st["track"]:
        if set(p) != {"time", "position", "windKt", "pressureMb", "rmwKm"} or not _is_pos(p["position"]):
            errs.append("storm.track point shape")
            break
    for s in files["segments.json"]:
        if set(s) != {"utility", "coordinates", "peakWindMph", "failureProbability"} or s["utility"] not in ("DESC", "GPC", "OTHER"):
            errs.append("segment shape")
            break
    for c in files["counties.json"]:
        if set(c) != {"fips", "name", "state", "customers", "predictedPeakOut", "actualPeakOut", "centroid"} or c["state"] not in ("GA", "SC", "FL", "AL", "NC", "TN"):
            errs.append("county shape")
            break
    for z in files["zones.json"]:
        if set(z) != {"id", "centroid", "utilities", "expectedDamagedSegments", "vulnerablePeople", "priority"}:
            errs.append("zone shape")
            break
    for y in files["yards.json"]:
        if set(y) != {"id", "position", "label", "serves", "maxDriveMinutes"}:
            errs.append("yard shape")
            break
    for v in files["vulnerable.json"]:
        if set(v) != {"zip", "position", "electricityDependent"}:
            errs.append("vulnerable shape")
            break
    m = files["meta.json"]
    if set(m) - {"generatedAt", "simulations", "device", "validation", "crossValidation"}:
        errs.append("meta extra keys")
    if m["device"] not in ("cuda", "cpu"):
        errs.append("meta.device")
    if set(m["validation"]) != {"countyMaePredicted", "countyMaeBaseline", "reportedDescDamagedSpans", "predictedDescDamagedSections"}:
        errs.append("meta.validation keys")
    return errs


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Build Response-mode JSON for one or all storms")
    ap.add_argument("--storm", default="all", help="storm key / HURDAT2 id / comma list / all")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--sims", type=int, default=None, help="default 10000 on cuda, 500 on cpu")
    ap.add_argument("--train-sims", type=int, default=None, help="sims for training-only storms")
    ap.add_argument("--skip-sim", action="store_true", help="reuse cached simulation results")
    ap.add_argument("--track", default="best", choices=["best", "forecast"])
    ap.add_argument("--no-mutual-aid", action="store_true", help="skip the mutual-aid scenarios")
    a = ap.parse_args(argv)

    published = {s.key for s in resolve(a.storm) if s.publish}
    specs = list(STORMS.values())  # every storm is needed to train the outage model
    run_sims(specs, published, a.device, a.sims, a.train_sims, a.skip_sim)

    best = {k: simulate.load(k, "best") for k in STORMS}
    table = outages.build_table(best, STORMS)
    fc = {}
    for k in published:
        try:
            fc[k] = simulate.load(k, "forecast")
        except Exception as exc:  # no forecast run: that storm is published from the best track only
            print(f"  {k}: no forecast simulation ({exc})")
    apply_best = {k: table[table.storm == k] for k in published}
    apply_fc = {k: outages.features(fc[k], STORMS[k]).reset_index().assign(storm=k) for k in fc}
    preds_best, cv_best = outages.leave_one_storm_out(table, apply_best)
    preds_fc, cv_fc = outages.leave_one_storm_out(table, apply_fc)
    preds, cv = (preds_best, cv_best) if a.track == "best" else (preds_fc, cv_fc)
    cv_public = [{"storm": c["storm"], "maePredicted": c["maePredicted"], "maeBaseline": c["maeBaseline"]} for c in cv]
    cv_by = {c["storm"]: c for c in cv}

    vuln_all = vulnerable.load()
    hurdat = load_storms([STORMS[k].hurdat_id for k in published])
    report = {"track": a.track, "crossValidation": {"best": cv_best, "forecast": cv_fc}, "storms": {}}
    index = []
    for key in [s.key for s in STORMS.values() if s.key in published]:
        spec = STORMS[key]
        sim = best[key] if a.track == "best" else fc[key]
        seg = sim.seg
        pred = preds[key]
        cjson = counties_json(pred)
        # affected ZIPs: counties with predicted outage >= 1 % of customers
        frac = {c["fips"]: c["predictedPeakOut"] / max(1, c["customers"]) for c in cjson}
        hot = {f for f, v in frac.items() if v >= VULN_MIN_FRACTION}
        zlist, members = zones.build_zones(seg, vuln_all)
        vuln = vuln_all[vuln_all.fips.isin(hot)]
        ylist = yards.build_yards(zlist)
        desc_idx = simulate.UTILS.index("DESC")
        util_seg = sim.util_seg[:, desc_idx]
        util_str = sim.util_struct[:, desc_idx]
        own = cv_by.get(key)
        meta = {
            "generatedAt": iso(pd.Timestamp.now("UTC").to_pydatetime()),
            "simulations": int(sim.sims),
            "device": sim.device,
            "validation": {
                "countyMaePredicted": own["maePredicted"] if own else None,
                "countyMaeBaseline": own["maeBaseline"] if own else None,
                "reportedDescDamagedSpans": REPORTED_DESC_TX_SPANS.get(key),
                "predictedDescDamagedSections": round(float(util_seg.mean()), 1),
            },
        }
        if cv_public:
            meta["crossValidation"] = cv_public
        files = {
            "storm.json": storm_json(hurdat[spec.hurdat_id], spec.replay_start),
            "segments.json": segments_json(seg),
            "counties.json": cjson,
            "zones.json": zones.to_json(zlist),
            "yards.json": yards.to_json(ylist),
            "vulnerable.json": vulnerable.to_json(vuln),
            "meta.json": meta,
        }
        errs = check_contract(files)
        if errs:
            raise SystemExit(f"{key}: contract check failed: {errs}")
        for name, obj in files.items():
            write_json(name, obj, RESPONSE_OUT / key)
        act = pred["actual"]
        report["storms"][key] = {
            "sims": sim.sims,
            "device": sim.device,
            "segmentsWritten": len(files["segments.json"]),
            "zones": len(zlist),
            "jointZones": sum(len(z["utilities"]) > 1 for z in zlist),
            "yards": [{k: v for k, v in y.items()} for y in ylist],
            "descExpectedFailedSegments": [round(float(util_seg.mean()), 1), round(float(np.percentile(util_seg, 5)), 1), round(float(np.percentile(util_seg, 95)), 1)],
            "descExpectedFailedStructures": [round(float(util_str.mean()), 1), round(float(np.percentile(util_str, 5)), 1), round(float(np.percentile(util_str, 95)), 1)],
            "gpcExpectedFailedStructures": round(float(sim.util_struct[:, 1].mean()), 1),
            "predictedTotalPeakOut": int(pred["pred"].sum()),
            "actualTotalPeakOut": None if act.isna().all() else int(act.sum()),
            "reportedDescDamagedSpans": REPORTED_DESC_TX_SPANS.get(key),
        }
        index.append(
            {
                "id": key,
                "name": spec.name,
                "year": spec.year,
                "headline": spec.headline,
                "focus": spec.focus,
                "validated": bool(act.notna().any()),
                "featured": spec.featured,
            }
        )
        print(f"{key}: {json.dumps(report['storms'][key], default=str)[:600]}")
    if a.storm.strip().lower() in ("all", "published"):
        order = {s.key: i for i, s in enumerate(STORMS.values())}
        write_json("storms.json", sorted(index, key=lambda e: order[e["id"]]), RESPONSE_OUT)
    (RESP_CACHE / "build_report.json").write_text(json.dumps(report, indent=1, default=str))
    print("leave-one-storm-out county MAE, fraction of customers (customers in brackets):")
    for c in cv:
        print(f"  {c['storm']:8s} model {c['maePredicted']:.4f} [{c['maeCustomersPredicted']:8.0f}]"
              f"  wind-only {c['maeBaseline']:.4f} [{c['maeCustomersBaseline']:8.0f}]  ({c['counties']} counties)"
              f"  rank {c['rankPredicted']:.2f} vs {c['rankBaseline']:.2f}, top-10 {c['top10Predicted']} vs {c['top10Baseline']}")
    if not a.no_mutual_aid:
        from gridsight.response import mutual_aid

        mutual_aid.main(["--storm", ",".join(sorted(published))])
    from gridsight.response import teamup

    teamup.main(["--storm", ",".join(sorted(published))])


if __name__ == "__main__":
    main()

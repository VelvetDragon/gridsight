"""EAGLE-I county outage curves for the replayable storms (GA and SC only).

Reads the 15-minute EAGLE-I snapshots the response pipeline cached under
<gridsight-data>/cache/response/eaglei/eaglei_<year>_<startYYYYMMDDHH>_<endYYYYMMDDHH>.parquet
(columns fips, time, customers_out). If they are missing, run the response
pipeline's fetch step first (pipeline/scripts/fetch_data.py on the
feat/response-pipeline branch downloads EAGLE-I from the ORNL/DOE archive).

  python -m gridsight.integrations.outages --export   # write public/data/outages/<storm>.json

The export is the static fallback behind GET /api/outages when Tiger Data is
not configured: hourly peak customers out per county, plus GA and SC totals.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from gridsight.config import CACHE_DIR
from gridsight.integrations.common import data_dir, read_json, write_json

EAGLEI_DIR = CACHE_DIR / "response" / "eaglei"
STATE_FIPS = {"13": "GA", "45": "SC"}
FILE_RE = re.compile(r"eaglei_(\d{4})_(\d{10})_(\d{10})\.parquet$")

# Landfall-ish reference times used when a storm has no storm.json (e.g. Michael,
# which the response pipeline trains on but does not list in storms.json).
KNOWN_STORMS = {
    "matthew": "2016-10-08T12:00:00Z",
    "irma": "2017-09-11T12:00:00Z",
    "michael": "2018-10-10T18:00:00Z",
    "idalia": "2023-08-30T12:00:00Z",
    "debby": "2024-08-07T00:00:00Z",
    "helene": "2024-09-27T06:00:00Z",
}


@dataclass
class EagleiFile:
    path: Path
    start: datetime
    end: datetime


def _ts(s: str) -> datetime:
    return datetime.strptime(s, "%Y%m%d%H").replace(tzinfo=timezone.utc)


def eaglei_files(directory: Path = EAGLEI_DIR) -> list[EagleiFile]:
    out = []
    for p in sorted(directory.glob("eaglei_*.parquet")) if directory.is_dir() else []:
        m = FILE_RE.search(p.name)
        if m:
            out.append(EagleiFile(p, _ts(m.group(2)), _ts(m.group(3))))
    return out


def _iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def storm_reference_times(root: Path | None = None) -> dict[str, list[datetime]]:
    """storm id -> track times (from storm.json) or a single known reference time."""
    refs: dict[str, list[datetime]] = {k: [_iso(v)] for k, v in KNOWN_STORMS.items()}
    index, _ = read_json("response/storms.json", root, fixtures=False)
    for entry in index or []:
        sid = entry.get("id")
        storm, _ = read_json(f"response/{sid}/storm.json", root, fixtures=False)
        times = [_iso(p["time"]) for p in (storm or {}).get("track", []) if p.get("time")]
        if times:
            refs[sid] = times
    return refs


def files_by_storm(root: Path | None = None) -> dict[str, list[EagleiFile]]:
    refs = storm_reference_times(root)
    out: dict[str, list[EagleiFile]] = {}
    for f in eaglei_files():
        best, best_hits = None, 0
        for sid, times in refs.items():
            hits = sum(f.start <= t <= f.end for t in times)
            if hits > best_hits:
                best, best_hits = sid, hits
        if best:
            out.setdefault(best, []).append(f)
    return out


def load_storm(files: list[EagleiFile]):
    """15-minute snapshots for GA and SC as a DataFrame (fips, state, time, customers_out)."""
    import pandas as pd

    frames = []
    for f in files:
        df = pd.read_parquet(f.path, columns=["fips", "time", "customers_out"])
        df["fips"] = df["fips"].astype(str).str.zfill(5)
        df = df[df["fips"].str[:2].isin(STATE_FIPS)]
        frames.append(df)
    if not frames:
        return pd.DataFrame(columns=["fips", "state", "time", "customers_out"])
    df = pd.concat(frames, ignore_index=True)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    df = df.drop_duplicates(["fips", "time"]).sort_values(["fips", "time"])
    df["state"] = df["fips"].str[:2].map(STATE_FIPS)
    df["customers_out"] = df["customers_out"].fillna(0).astype("int64")
    return df[["fips", "state", "time", "customers_out"]]


def hourly_curves(df) -> dict[str, Any]:
    """Hourly peak customers out per county on a shared hourly axis."""
    import pandas as pd

    if df.empty:
        return {"start": None, "hours": 0, "counties": {}, "totals": {}}
    df = df.assign(bucket=df["time"].dt.floor("1h"))
    wide = df.groupby(["bucket", "fips"])["customers_out"].max().unstack("fips")
    axis = pd.date_range(wide.index.min(), wide.index.max(), freq="1h", tz="UTC")
    # EAGLE-I omits zero rows; a county that is missing for an hour had no reported outage.
    wide = wide.reindex(axis).fillna(0).astype("int64")
    counties = {fips: wide[fips].tolist() for fips in wide.columns if wide[fips].max() > 0}
    totals = {}
    for state_fips, state in STATE_FIPS.items():
        cols = [c for c in wide.columns if c.startswith(state_fips)]
        if cols:
            totals[state] = wide[cols].sum(axis=1).astype("int64").tolist()
    return {
        "start": axis[0].strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hours": len(axis),
        "counties": counties,
        "totals": totals,
    }


def export_static(root: Path | None = None) -> list[Path]:
    root = data_dir(root)
    written = []
    for storm, files in sorted(files_by_storm(root).items()):
        curves = hourly_curves(load_storm(files))
        if not curves["hours"]:
            continue
        payload = {
            "storm": storm,
            "source": "EAGLE-I (ORNL / DOE), 15-minute county snapshots, hourly peak",
            "start": curves["start"],
            "stepMinutes": 60,
            "hours": curves["hours"],
            "totals": curves["totals"],
            "counties": curves["counties"],
        }
        out = root / "outages" / f"{storm}.json"
        write_json(out, payload, pretty=False)
        written.append(out)
        print(f"wrote {out} ({len(curves['counties'])} counties, {curves['hours']} hours)")
    if not written:
        print(f"No EAGLE-I files under {EAGLEI_DIR}; nothing exported.")
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--export", action="store_true", help="write public/data/outages/<storm>.json")
    ap.add_argument("--data-dir", help="data dir (default public/data)")
    args = ap.parse_args(argv)
    if args.export:
        export_static(Path(args.data_dir) if args.data_dir else None)
    else:
        for storm, files in sorted(files_by_storm(data_dir(args.data_dir)).items()):
            print(storm, [f.path.name for f in files])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

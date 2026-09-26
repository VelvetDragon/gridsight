"""NOAA HURDAT2 best tracks and NHC official (OFCL) forecast tracks.

HURDAT2 format: https://www.nhc.noaa.gov/data/hurdat/hurdat2-format-atl-1851-2021.pdf
Each data line gives time, record identifier (L = landfall), status, lat, lon, max
sustained 1-min 10-m wind (kt), min pressure (mb), wind radii and, since 2021, the
radius of maximum wind (nm, -999 when missing).

ATCF a-deck (forecast) format: https://www.nrlmry.navy.mil/atcf_web/docs/database/new/abdeck.txt
We use the OFCL (NHC official) rows, which are what the public saw in each advisory.
"""

from __future__ import annotations

import gzip
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from gridsight.response.common import NM_TO_KM, RAW_DIR, download, iso, pos, utc, write_json

HURDAT_URL = "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-091226.txt"
HURDAT_PATH = RAW_DIR / "hurdat2.txt"
ADECK_URL = "https://ftp.nhc.noaa.gov/atcf/archive/{year}/a{basin}{num}{year}.dat.gz"
BDECK_URL = "https://ftp.nhc.noaa.gov/atcf/archive/{year}/b{basin}{num}{year}.dat.gz"

# Storms used by Response mode. Helene is the replay/test storm; the others (all of
# which caused outages in Georgia and/or South Carolina) are the training storms for
# the county-outage model. IDs verified against the HURDAT2 file header lines.
HELENE = "AL092024"
TRAINING_STORMS = {
    "AL142016": "Matthew",
    "AL112017": "Irma",
    "AL142018": "Michael",
    "AL102023": "Idalia",
    "AL042024": "Debby",
}
ALL_STORMS = {**TRAINING_STORMS, HELENE: "Helene"}

# Helene's Florida (Big Bend) landfall per HURDAT2 record "L": 2024-09-27 03:10 UTC.
HELENE_LANDFALL = datetime(2024, 9, 27, 3, 10, tzinfo=timezone.utc)
# Replay "now": the 00 UTC 25 Sep OFCL cycle, i.e. the advisory released ~03 UTC
# on 25 Sep, about 48 h before landfall.
HELENE_FORECAST_CYCLE = datetime(2024, 9, 25, 0, 0, tzinfo=timezone.utc)
HELENE_REPLAY_START = datetime(2024, 9, 25, 3, 0, tzinfo=timezone.utc)


def rmax_willoughby(vmax_kt: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Radius of maximum wind (km) when the track does not provide one.

    Willoughby, Darling & Rahn (2006), Mon. Wea. Rev. 134:1102, eq. (7a):
    Rmax = 46.4 exp(-0.0155 Vmax + 0.0169 |lat|), Vmax in m/s, Rmax in km.
    """
    v = np.asarray(vmax_kt, float) * 0.514444
    return 46.4 * np.exp(-0.0155 * v + 0.0169 * np.abs(np.asarray(lat, float)))


@dataclass
class Track:
    storm_id: str
    name: str
    # Columns: time (UTC), lat, lon, vmax_kt, pmin_mb, rmw_km, r34_km, status, record
    df: pd.DataFrame
    source: str = "HURDAT2"
    # For forecasts: the cycle (analysis) time; lead time is measured from here.
    issued: datetime | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def year(self) -> int:
        return int(self.storm_id[-4:])

    def rmw_filled(self) -> np.ndarray:
        """Best-track RMW where available, otherwise Willoughby et al. (2006)."""
        r = self.df["rmw_km"].to_numpy(float)
        fallback = rmax_willoughby(self.df["vmax_kt"].to_numpy(), self.df["lat"].to_numpy())
        return np.where(np.isfinite(r), r, fallback)


def _latlon(tok: str) -> float:
    tok = tok.strip()
    v = float(tok[:-1])
    return -v if tok[-1] in "SW" else v


def _r34(quadrants) -> float:
    """Mean 34-kt wind radius (km) over the four quadrants; NaN when not analysed.

    A zero quadrant means no 34-kt winds there, so it counts as zero in the mean.
    """
    try:
        q = [float(x) for x in quadrants]
    except ValueError:
        return math.nan
    if any(v < 0 for v in q) or max(q) <= 0:
        return math.nan
    return sum(q) / 4.0 * NM_TO_KM


def parse_hurdat(path=HURDAT_PATH) -> dict[str, Track]:
    download(HURDAT_URL, path)
    storms: dict[str, Track] = {}
    with open(path) as fh:
        lines = fh.read().splitlines()
    i = 0
    while i < len(lines):
        head = [t.strip() for t in lines[i].split(",")]
        sid, name, n = head[0], head[1].title(), int(head[2])
        rows = []
        for line in lines[i + 1 : i + 1 + n]:
            # One 1969 record in the 2025 release lacks the comma between lat and lon;
            # split "63.3N    7.5E" so the rest of the file parses.
            line = re.sub(r"([NS])\s+(\d)", r"\1, \2", line)
            t = [x.strip() for x in line.split(",")]
            when = datetime.strptime(t[0] + t[1], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
            p = float(t[7])
            rmw = float(t[20]) if len(t) > 20 and t[20] not in ("", "-999") else math.nan
            rows.append(
                {
                    "time": when,
                    "record": t[2],
                    "status": t[3],
                    "lat": _latlon(t[4]),
                    "lon": _latlon(t[5]),
                    "vmax_kt": float(t[6]),
                    "pmin_mb": p if p > 0 else math.nan,
                    "rmw_km": rmw * NM_TO_KM if rmw > 0 else math.nan,
                    "r34_km": _r34([t[8], t[9], t[10], t[11]]),
                }
            )
        storms[sid] = Track(sid, name, pd.DataFrame(rows))
        i += n + 1
    return storms


def load_storms(ids=None) -> dict[str, Track]:
    ids = list(ids or ALL_STORMS)
    db = parse_hurdat()
    out = {}
    for sid in ids:
        if sid not in db:
            raise KeyError(f"{sid} not in HURDAT2")
        tr = db[sid]
        if tr.name.lower() != ALL_STORMS.get(sid, tr.name).lower():
            raise ValueError(f"{sid} is {tr.name}, expected {ALL_STORMS[sid]}")
        fill_rmw_from_bdeck(tr)
        out[sid] = tr
    return out


def bdeck_rmw(storm_id: str) -> pd.Series:
    """Radius of maximum wind (km) from the ATCF b-deck (NHC working best track), by time.

    HURDAT2 only carries RMW from 2021 on; the b-deck has it for older storms too.
    Without it, large weakening storms (Irma 2017, Matthew 2016) get a Willoughby Rmax
    about half the analysed one and their inland winds come out 15-20 mph too low
    against ASOS stations (windcheck.py).
    """
    basin, num, year = storm_id[:2].lower(), storm_id[2:4], storm_id[4:]
    path = download(BDECK_URL.format(year=year, basin=basin, num=num), RAW_DIR / f"b{basin}{num}{year}.dat.gz")
    rows = {}
    with gzip.open(path, "rt") as fh:
        for line in fh:
            t = [x.strip() for x in line.split(",")]
            if len(t) < 20 or not t[19].isdigit() or int(t[19]) <= 0:
                continue
            when = datetime.strptime(t[2], "%Y%m%d%H").replace(tzinfo=timezone.utc)
            rows.setdefault(when, float(t[19]) * NM_TO_KM)
    return pd.Series(rows).sort_index()


def fill_rmw_from_bdeck(track: Track) -> None:
    """Fill missing best-track RMW from the b-deck (time-interpolated, inside its span)."""
    df = track.df
    missing = df["rmw_km"].isna()
    if not missing.any():
        return
    try:
        b = bdeck_rmw(track.storm_id)
    except Exception as exc:  # no b-deck: Willoughby fallback stays
        track.notes.append(f"b-deck RMW unavailable: {exc}")
        return
    if b.empty:
        return
    bt = np.array([t.timestamp() for t in b.index])
    tt = np.array([t.timestamp() for t in df["time"]])
    inside = (tt >= bt[0]) & (tt <= bt[-1])
    fill = np.interp(tt, bt, b.to_numpy())
    df.loc[missing & inside, "rmw_km"] = fill[(missing & inside).to_numpy()]
    track.notes.append(f"RMW from ATCF b-deck for {int((missing & inside).sum())} of {len(df)} fixes")


def landfall_times(track: Track) -> list[datetime]:
    return list(track.df.loc[track.df["record"] == "L", "time"])


def load_ofcl(storm_id: str, cycle: datetime) -> Track:
    """NHC official forecast issued for ``cycle`` (synoptic time) from the ATCF a-deck.

    The a-deck has one row per forecast hour and wind-radius threshold; we keep one row
    per hour. OFCL rows do not carry RMW (0), so Rmax falls back to Willoughby (2006).
    The 3-h row ("TAU 3") is the advisory position; TAU 0 is the synoptic analysis.
    """
    basin, num, year = storm_id[:2].lower(), storm_id[2:4], storm_id[4:]
    url = ADECK_URL.format(year=year, basin=basin, num=num)
    path = download(url, RAW_DIR / f"a{basin}{num}{year}.dat.gz")
    stamp = cycle.strftime("%Y%m%d%H")
    rows = {}
    with gzip.open(path, "rt") as fh:
        for line in fh:
            t = [x.strip() for x in line.split(",")]
            if len(t) < 10 or t[4] != "OFCL" or t[2] != stamp:
                continue
            tau = int(t[5])
            if tau in rows:
                continue
            lat = float(t[6][:-1]) / 10 * (1 if t[6][-1] == "N" else -1)
            lon = float(t[7][:-1]) / 10 * (-1 if t[7][-1] == "W" else 1)
            p = float(t[9]) if t[9] else 0.0
            rows[tau] = {
                "time": cycle + timedelta(hours=tau),
                "tau_h": tau,
                "record": "",
                "status": t[10] if len(t) > 10 else "",
                "lat": lat,
                "lon": lon,
                "vmax_kt": float(t[8]),
                "pmin_mb": p if p > 0 else math.nan,
                "rmw_km": math.nan,
                "r34_km": _r34(t[13:17]) if len(t) > 16 and t[11] == "34" else math.nan,
            }
    if not rows:
        raise ValueError(f"no OFCL forecast for {storm_id} at {stamp}")
    df = pd.DataFrame([rows[k] for k in sorted(rows)])
    return Track(storm_id, ALL_STORMS.get(storm_id, storm_id), df, source="NHC OFCL (ATCF a-deck)", issued=cycle)


def storm_json(track: Track, replay_start: datetime) -> dict:
    """Storm contract object (src/lib/types.ts: Storm)."""
    pts = []
    for r in track.df.itertuples():
        pts.append(
            {
                "time": iso(r.time),
                "position": pos(r.lon, r.lat),
                "windKt": int(round(r.vmax_kt)),
                "pressureMb": None if not math.isfinite(r.pmin_mb) else int(round(r.pmin_mb)),
                "rmwKm": None if not math.isfinite(r.rmw_km) else round(float(r.rmw_km), 1),
            }
        )
    return {
        "id": track.storm_id,
        "name": track.name,
        "year": track.year,
        "track": pts,
        "replayStart": iso(replay_start),
    }


def main() -> None:
    storms = load_storms()
    for sid, tr in storms.items():
        lf = ", ".join(iso(t) for t in landfall_times(tr)) or "none"
        print(f"{sid} {tr.name:8s} {len(tr.df):3d} pts  peak {tr.df.vmax_kt.max():.0f} kt  landfalls: {lf}")
    hel = storms[HELENE]
    write_json("storm.json", storm_json(hel, HELENE_REPLAY_START))
    fc = load_ofcl(HELENE, HELENE_FORECAST_CYCLE)
    print(f"OFCL {utc(iso(HELENE_FORECAST_CYCLE))}: {len(fc.df)} forecast hours")
    print(fc.df[["tau_h", "lat", "lon", "vmax_kt"]].to_string(index=False))


if __name__ == "__main__":
    main()

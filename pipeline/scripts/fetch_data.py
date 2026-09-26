"""Download the public source documents into RAW_DIR.

Usage: python pipeline/scripts/fetch_data.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gridsight.config import RAW_DIR  # noqa: E402

SOURCES = {
    # Dominion Energy South Carolina: planned transmission projects $2M+ (SCRTP), 54 projects.
    "desc-2026-2030-projects.pdf": "https://www.scrtp.com/assets/pdfs/home/2026-2030-2million-and-above-project-descriptions.pdf",
    # Southeastern Regional Transmission Planning, 2026 Q2 preliminary 10-year expansion plan (Georgia Power = SOCO).
    "sertp-2026-q2-preliminary-plan.pdf": "https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_2nd_Qtr_Presentation.pdf",
    # NOAA HURDAT2 Atlantic best-track database (Hurricane Helene = AL092024).
    "hurdat2.txt": "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-091226.txt",
}

# Response mode (the pipeline also downloads these on demand; listed here so a fresh
# machine can prefetch everything). Large datasets that are sliced remotely rather
# than downloaded (EAGLE-I yearly CSVs via HTTP range requests, OSM via Overpass,
# HIFLD lines, emPOWER, OSRM) are fetched and cached by gridsight.response.*.
RESPONSE_SOURCES = {
    # NHC ATCF a-decks: official (OFCL) forecasts issued before each landfall.
    **{
        f"a{sid[:2].lower()}{sid[2:4]}{sid[4:]}.dat.gz": f"https://ftp.nhc.noaa.gov/atcf/archive/{sid[4:]}/a{sid[:2].lower()}{sid[2:4]}{sid[4:]}.dat.gz"
        for sid in ("AL092024", "AL142016", "AL112017", "AL102023", "AL042024", "AL142018")
    },
    # NHC official forecast verification (track / intensity errors by lead time).
    "nhc-ofcl-atl-track-errors.pdf": "https://www.nhc.noaa.gov/verification/pdfs/1989-present_OFCL_ATL_annual_trk_errors.pdf",
    "nhc-ofcl-atl-intensity-errors.pdf": "https://www.nhc.noaa.gov/verification/pdfs/1990-present_OFCL_ATL_annual_int_errors.pdf",
    # Census cartographic boundaries and ZCTA gazetteer.
    "cb_2023_us_county_5m.zip": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_county_5m.zip",
    "cb_2023_us_state_20m.zip": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip",
    "2023_Gaz_zcta_national.zip": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip",
    # EAGLE-I modeled county customers (ORNL, figshare doi:10.6084/m9.figshare.24237376).
    "eaglei_MCC.csv": "https://ndownloader.figshare.com/files/42547708",
    # Fragility sources.
    "wood-pole-fragility-par10098529.pdf": "https://par.nsf.gov/servlets/purl/10098529",
    "fani-tower-fragility-arxiv2107.06072.pdf": "https://arxiv.org/pdf/2107.06072",
    "PNNL-33587.pdf": "https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-33587.pdf",
}
SOURCES.update(RESPONSE_SOURCES)

HEADERS = {"User-Agent": "GridSight/0.1 (ShellHacks 2026 research)"}


def main() -> None:
    for name, url in SOURCES.items():
        dest = RAW_DIR / name
        if dest.exists():
            print(f"skip  {name}")
            continue
        print(f"fetch {name}")
        resp = requests.get(url, headers=HEADERS, timeout=300)
        resp.raise_for_status()
        dest.write_bytes(resp.content)


if __name__ == "__main__":
    main()

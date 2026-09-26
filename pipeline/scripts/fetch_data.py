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
    # SERTP 2025 Regional Transmission Plan & Input Assumptions (public, no CEII): Southern BAA project list.
    "sertp-2025-regional-plan.pdf": "https://www.southeasternrtp.com/docs/general/2025/2025%20Regional%20Transmission%20Plan%20and%20Input%20Assumptions.pdf",
    # Georgia Power 2025 IRP, public-disclosure filing (GA PSC Docket 56002, document 221233, zip).
    # Technical Appendix Vol. 3 holds the 2024 GA ITS Ten-Year Transmission Plan (costs redacted).
    "gpc-2025-irp-pd.bin": "https://services.psc.ga.gov/api/v1/External/Public/Get/Document/DownloadFile/221233/102406",
    # US Census 2023 cartographic state boundaries and county gazetteer (state tagging, county points).
    "cb_2023_us_state_500k.zip": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip",
    "2023_Gaz_counties_national.zip": "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_counties_national.zip",
    # USGS GNIS Domestic Names (populated places, crossings): place-level fallback for site names.
    "DomesticNames_SC_Text.zip": "https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/DomesticNames_SC_Text.zip",
    "DomesticNames_GA_Text.zip": "https://prd-tnm.s3.amazonaws.com/StagedProducts/GeographicNames/DomesticNames/DomesticNames_GA_Text.zip",
    # USDA NASS Land Values 2025 Summary (farm real estate $/acre by state, p. 9).
    "nass-land-values-2025.pdf": "https://www.nass.usda.gov/Publications/Todays_Reports/reports/land0825.pdf",
    # Georgia Power project pages used by gridsight/plan/gpc_web.py (kept for traceability).
    "gpc-thomson-vogtle.html": "https://www.georgiapower.com/about/grid-reliability/grid-improvements/grid-projects/thomson-vogtle.html",
    "gpc-callaway-thomson.html": "https://www.georgiapower.com/about/grid-reliability/grid-improvements/grid-projects/transmission-projects/callaway-thomson.html",
    "gpc-effingham-county.html": "https://www.georgiapower.com/about/grid-reliability/grid-improvements/grid-projects/transmission-projects/effingham-county.html",
    "gpc-9900mw-certification.html": "https://www.georgiapower.com/news-hub/press-releases/georgia-power-requests-certification-of-approximately-9900-mw-of-new-resources-from-the-georgia-psc.html",
    # NOAA HURDAT2 Atlantic best-track database (Hurricane Helene = AL092024).
    "hurdat2.txt": "https://www.nhc.noaa.gov/data/hurdat/hurdat2-1851-2025-091226.txt",
}

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; GridSight/0.1; ShellHacks 2026 research)"}


def main() -> None:
    for name, url in SOURCES.items():
        dest = RAW_DIR / name
        if dest.exists():
            print(f"skip  {name}")
            continue
        print(f"fetch {name}")
        resp = requests.get(url, headers=HEADERS, timeout=600)
        resp.raise_for_status()
        dest.write_bytes(resp.content)


if __name__ == "__main__":
    main()

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

HEADERS = {"User-Agent": "GridSight/0.1 (ShellHacks 2026 research)"}


def main() -> None:
    for name, url in SOURCES.items():
        dest = RAW_DIR / name
        if dest.exists():
            print(f"skip  {name}")
            continue
        print(f"fetch {name}")
        resp = requests.get(url, headers=HEADERS, timeout=120)
        resp.raise_for_status()
        dest.write_bytes(resp.content)


if __name__ == "__main__":
    main()

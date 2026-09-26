"""Shared paths and constants for the pipeline."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Raw public documents and datasets are kept outside the repo (large, re-downloadable).
RAW_DIR = Path(os.environ.get("GRIDSIGHT_RAW", REPO_ROOT.parent / "gridsight-data" / "raw"))
CACHE_DIR = Path(os.environ.get("GRIDSIGHT_CACHE", REPO_ROOT.parent / "gridsight-data" / "cache"))

# Everything the web app reads.
OUT_DIR = REPO_ROOT / "public" / "data"
PLAN_OUT = OUT_DIR / "plan"
RESPONSE_OUT = OUT_DIR / "response"
CONTEXT_OUT = OUT_DIR / "context"

# Projected CRS for distances in metres (UTM zone 17N covers Savannah and Augusta).
METRIC_CRS = "EPSG:32617"
GEO_CRS = "EPSG:4326"

# Study area: Georgia / South Carolina (lon_min, lat_min, lon_max, lat_max).
BBOX = (-85.7, 30.3, -78.4, 35.3)

# Sperry Tech overlap tiers (closest-point distance, km).
TIER_LIMITS_KM = {"crossing": 0.0, "row": 1.6, "logistics": 8.0, "crew": 40.0}

UTILITIES = {
    "DESC": {"name": "Dominion Energy South Carolina", "state": "SC", "color": "#0E7C7B"},
    "GPC": {"name": "Georgia Power", "state": "GA", "color": "#C2410C"},
}

for _d in (RAW_DIR, CACHE_DIR, PLAN_OUT, RESPONSE_OUT, CONTEXT_OUT):
    _d.mkdir(parents=True, exist_ok=True)

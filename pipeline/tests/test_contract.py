"""Generated Plan-mode files must match src/lib/types.ts exactly (keys and basic types)."""

from __future__ import annotations

import json

import pytest

from gridsight.config import CONTEXT_OUT, PLAN_OUT

PROJECT = {"id", "utility", "owner", "name", "kind", "action", "description", "voltageKv", "miles", "places",
           "inService", "buildWindow", "costUsd", "status", "state", "geometry", "geometryQuality",
           "locationConfidence", "source"}
OVERLAP = {"id", "descId", "gpcId", "distanceKm", "tier", "closestPoints", "roadKm", "roadVerified", "stagingYard",
           "timelineOverlapMonths", "robustness", "shareable", "score", "rank", "cost", "summary"}
YARD = {"position", "label", "driveMinutesDesc", "driveMinutesGpc"}
COST = {"sharedCorridorKm", "sharedAcres", "landValuePerAcreUsd", "landSavingsUsd", "mobilizationSavingsUsd",
        "yardSavingsUsd", "totalUsd", "assumptions"}
META = {"generatedAt", "utilities", "projectCount", "pairsCompared", "overlapsFound", "knownMatches", "sources"}
SOURCE = {"document", "url", "page"}

have_data = pytest.mark.skipif(not (PLAN_OUT / "projects.json").exists(), reason="run gridsight.plan.build first")


def _pos(p):
    return isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) for v in p)


@have_data
def test_projects_match_contract():
    projects = json.loads((PLAN_OUT / "projects.json").read_text())
    assert projects
    for p in projects:
        assert set(p) == PROJECT, p["id"]
        assert p["utility"] in ("DESC", "GPC") and p["state"] in ("SC", "GA")
        assert p["kind"] in ("line", "substation") and p["action"] in ("new", "rebuild", "upgrade")
        assert p["geometryQuality"] in ("traced", "straight", "point")
        assert 0 <= p["locationConfidence"] <= 1
        assert set(p["source"]) == SOURCE
        g = p["geometry"]
        assert g["type"] in ("Point", "LineString")
        assert _pos(g["coordinates"]) if g["type"] == "Point" else all(_pos(c) for c in g["coordinates"])
        assert p["buildWindow"] is None or (len(p["buildWindow"]) == 2 and p["buildWindow"][0] <= p["buildWindow"][1])
    assert sum(p["utility"] == "DESC" for p in projects) == 54


@have_data
def test_overlaps_match_contract():
    projects = {p["id"]: p for p in json.loads((PLAN_OUT / "projects.json").read_text())}
    overlaps = json.loads((PLAN_OUT / "overlaps.json").read_text())
    ranks = [o["rank"] for o in overlaps]
    assert ranks == list(range(1, len(overlaps) + 1))
    for o in overlaps:
        assert set(o) == OVERLAP, o["id"]
        assert projects[o["descId"]]["utility"] == "DESC" and projects[o["gpcId"]]["utility"] == "GPC"
        assert 0 <= o["distanceKm"] <= 40
        assert o["tier"] in ("crossing", "row", "logistics", "crew")
        assert o["robustness"] in ("robust", "uncertain")
        assert all(_pos(p) for p in o["closestPoints"])
        assert o["stagingYard"] is None or set(o["stagingYard"]) == YARD
        assert o["cost"] is None or set(o["cost"]) == COST
        assert isinstance(o["summary"], str) and o["summary"]


@have_data
def test_meta_and_context():
    meta = json.loads((PLAN_OUT / "meta.json").read_text())
    assert set(meta) == META
    assert all(set(s) == SOURCE for s in meta["sources"])
    assert all(set(k) == {"label", "found", "overlapId"} for k in meta["knownMatches"])
    lines = CONTEXT_OUT / "transmission-lines.geojson"
    assert lines.stat().st_size < 4_000_000
    assert json.loads((CONTEXT_OUT / "savannah-river.geojson").read_text())["type"] == "FeatureCollection"

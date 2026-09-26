"""Shape checks for public/data/plan/insights/* (documented in gridsight/plan/insights/*.py)."""

from __future__ import annotations

import json

import pytest

from gridsight.config import CONTEXT_OUT, PLAN_OUT

INS = PLAN_OUT / "insights"


def _load(name):
    path = INS / name
    if not path.exists():
        pytest.skip(f"{name} not built")
    return json.loads(path.read_text())


def test_cost_ranges():
    overlaps = {o["id"]: o for o in json.loads((PLAN_OUT / "overlaps.json").read_text())}
    for r in _load("cost-ranges.json"):
        assert set(r) == {"overlapId", "lowUsd", "centralUsd", "highUsd", "components"}
        assert r["lowUsd"] <= r["centralUsd"] <= r["highUsd"]
        assert set(r["components"]) == {"land", "permits", "mobilization", "yard"}
        assert overlaps[r["overlapId"]]["cost"]["totalUsd"] == r["centralUsd"]
        assert overlaps[r["overlapId"]]["cost"]["assumptions"][0].startswith("Range: ")


def test_plan_changes_and_slip_stats():
    pc = _load("plan-changes.json")
    assert {"editions", "gpcEditions", "desc", "gpc"} <= set(pc)
    assert [e["id"] for e in pc["editions"]] == ["2023-2027", "2024-2028", "2025-2029", "2026-2030"]
    for h in pc["desc"]:
        assert set(h["flags"]) == {"added", "removed", "delayedMonths", "costChangeUsd", "costChangePct"}
        assert h["history"]
    stats = _load("slip-stats.json")
    assert 0 <= stats["desc"]["shareDelayed"] <= 1 and 0 <= stats["gpc"]["shareDelayed"] <= 1


def test_structures():
    rows = _load("structures.json")
    for r in rows:
        assert {"projectId", "structureCount", "towers", "poles", "spanAvgM"} <= set(r)
        assert r["structureCount"] == r["towers"] + r["poles"]
    files = [p for p in CONTEXT_OUT.glob("structures*.geojson")]
    assert files and all(p.stat().st_size < 6_000_000 for p in files)


def test_wetlands():
    rows = _load("wetlands.json")
    for r in rows:
        assert {"overlapId", "wetlandAcresInCorridor", "wetlandTypes", "sharedPermitNote"} <= set(r)
        assert 0 <= r["wetlandAcresInCorridor"] <= r["corridorAcres"]
    assert (CONTEXT_OUT / "wetlands.geojson").stat().st_size < 3_000_000

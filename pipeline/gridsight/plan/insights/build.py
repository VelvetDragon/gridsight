"""Build the Plan-mode insight files on top of public/data/plan/{projects,overlaps}.json.

Usage (from pipeline/, after `python -m gridsight.plan.build`):
    python -m gridsight.plan.insights.build [--skip structures,wetlands,changes]

Writes (shapes documented at the top of each module):
    public/data/plan/insights/structures.json      structures.py
    public/data/context/structures.geojson         structures.py
    public/data/plan/insights/plan-changes.json    plan_changes.py
    public/data/plan/insights/slip-stats.json      plan_changes.py
    public/data/plan/insights/wetlands.json        wetlands.py
    public/data/context/wetlands.geojson           wetlands.py
(public/data/plan/insights/cost-ranges.json is written by gridsight.plan.build.)
"""

from __future__ import annotations

import argparse
import json

from gridsight.config import PLAN_OUT
from gridsight.plan.insights import plan_changes, structures, wetlands

OUT = PLAN_OUT / "insights"


def _write(name: str, data) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, separators=(",", ":")))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--skip", default="", help="comma list: structures,wetlands,changes")
    skip = set(filter(None, ap.parse_args(argv).skip.split(",")))
    projects = json.loads((PLAN_OUT / "projects.json").read_text())
    overlaps = json.loads((PLAN_OUT / "overlaps.json").read_text())
    report = {}
    if "changes" not in skip:
        changes, stats = plan_changes.build(projects)
        _write("plan-changes.json", changes)
        _write("slip-stats.json", stats)
        report["slipStats"] = {k: {kk: vv for kk, vv in v.items() if kk != "byAction"} for k, v in stats.items() if k != "notes"}
    if "structures" not in skip:
        rows, info = structures.build(projects, overlaps)
        _write("structures.json", rows)
        report["structures"] = {**info, "projectsCounted": len(rows)}
    if "wetlands" not in skip:
        rows, info = wetlands.build(projects, overlaps)
        _write("wetlands.json", rows)
        report["wetlands"] = info
        report["wetlandAcres"] = {r["overlapId"]: r["wetlandAcresInCorridor"] for r in rows}
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

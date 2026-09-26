"""Sanity checks for the Plan-mode parsers (run: cd pipeline && python -m pytest tests)."""

from __future__ import annotations

import pytest

from gridsight.config import RAW_DIR
from gridsight.plan import records

needs_raw = pytest.mark.skipif(not (RAW_DIR / "desc-2026-2030-projects.pdf").exists(), reason="raw PDFs not downloaded")


def test_voltages():
    assert records.voltages("Okatie 230-115kV Substation") == [230, 115]
    assert records.voltages("Hooks - Modoc 115/46 kV Rebuild") == [115, 46]
    assert records.voltages("HATCH - WADLEY 500 KV LINE") == [500]


def test_dates_clamp_invalid_days():
    assert records.parse_date("04/31/26") == "2026-04-30"
    assert records.parse_date("06/31/2026") == "2026-06-30"
    assert records.parse_date("10/1/2025 (phase 1) and 10/1/2026 (phase 2)") == "2026-10-01"


def test_places_and_action():
    assert records.split_places("Jasper – Okatie 230 kV #2") == ["Jasper", "Okatie"]
    assert records.name_places("SAV: GOSHEN (SAV) - MCINTOSH 115KV LINE REBUILD") == ["GOSHEN", "MCINTOSH"]
    assert records.name_places("UNION CITY – LINE CREEK – YATES 230 KV LINE REBUILD") == ["UNION CITY", "LINE CREEK", "YATES"]
    assert records.action_from("Jasper – Okatie 230 kV #2: Construct") == "new"
    assert records.action_from("Urquhart – Toolebeck 115kV line: Rebuild") == "rebuild"
    assert records.miles("Approximately 12.5 miles.") == 12.5


@needs_raw
def test_desc_has_54_projects_one_per_page():
    from gridsight.plan import parse_desc

    ps = parse_desc.parse()
    assert len(ps) == 54
    assert [p.source_page for p in ps] == list(range(1, 55))
    assert all(p.in_service for p in ps)
    assert all(p.cost_usd and p.cost_usd > 1e6 for p in ps)
    by_page = {p.source_page: p for p in ps}
    assert by_page[12].route == ["Jasper", "Okatie"] and by_page[12].miles == 6.5 and by_page[12].action == "new"
    assert by_page[41].places == ["Okatie", "McIntosh"]
    assert by_page[7].miles == 12.5 and by_page[7].in_service == "2026-08-12"
    assert by_page[1].in_service == "2026-04-30"  # 04/31/26 clamped


@needs_raw
def test_gpc_irp_keeps_only_georgia_power_sponsors():
    from gridsight.plan import parse_gpc_irp

    ps, info = parse_gpc_irp.parse()
    assert ps and {p.owner for p in ps} <= {"GPC", "SAV"}
    assert info["excludedSponsors"].get("GTC", 0) > 0
    names = {p.name.upper() for p in ps}
    assert any("MCINTOSH - PURRYSBURG" in n for n in names)
    assert any("FENWICK STREET" in n for n in names)


@needs_raw
def test_sertp_q2_soco_slides():
    from gridsight.plan import parse_sertp

    ps, info = parse_sertp.parse_q2()
    hw = [p for p in ps if "HATCH - WADLEY" in p.name.upper()]
    assert hw and hw[0].in_service == "2031-06-01" and hw[0].miles == 65 and hw[0].kind == "line"
    assert info["excludedOwners"].get("GTC", 0) > 0

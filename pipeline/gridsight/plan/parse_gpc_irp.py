"""Parse Georgia Power's 10-year transmission plan from its 2025 IRP.

Source: Georgia PSC Docket 56002, filing 221233 "2025 Integrated Resource Plan PD"
(public-disclosure version, a zip). Technical Appendix Volume 3 contains
"2024 GA ITS Ten-Year Plan (2025-2034)": Table 2 lists every project with its
sponsor (GPC, SAV, GTC, MEAG, DU) and each project then has a detail page with
Teams #, Need Date, Start Date and a description. Costs are redacted in the
public version and are left null here.

Sponsors kept as Georgia Power: GPC, and SAV (Georgia Power's Savannah-area
projects; the plan's cover says "Georgia Projects (Includes ITS & Savannah
Projects)"). GTC (Georgia Transmission Corp), MEAG (municipal) and DU (Dalton
Utilities) are other ITS owners and are excluded, only counted.

We only read fields that are printed in the public-disclosure filing (names,
dates, descriptions); nothing redacted is inferred.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

import pymupdf

from gridsight.config import RAW_DIR
from gridsight.plan.records import (
    SUB_WORDS,
    RawProject,
    action_from,
    clean_place,
    dedupe,
    from_to,
    from_to_pairs,
    miles,
    name_places,
    parse_date,
    slug,
    voltages,
)

ZIP = "gpc-2025-irp-pd.bin"
MEMBER = "Technical Appendix Volume 3 PUBLIC DISCLOSURE/2025 IRP Volume 3 PUBLIC DISCLOSURE.pdf"
URL = "https://services.psc.ga.gov/api/v1/External/Public/Get/Document/DownloadFile/221233/102406"
DOC = (
    "Georgia Power 2025 IRP, Technical Appendix Vol. 3 (public disclosure): "
    "2024 GA ITS Ten-Year Transmission Plan 2025-2034 (GA PSC Docket 56002)"
)
GPC_SPONSORS = {"GPC", "SAV"}

ROW_RE = re.compile(
    r"(?P<zone>\d{3}) / (?P<year>20\d\d) / (?P<teams>\d{4,5}) / (?P<name>.+?) / "
    r"(?P<need>\d{1,2}/\d{1,2}/\d{4}) / (?P<sponsor>[A-Z]{2,5}) / REDACTED"
)
DETAIL_RE = re.compile(
    r"Page \d+ of \d+ / (?P<name>.+?) / Teams # (?P<teams>\d+) / Need Date (?P<need>[\d/]+) "
    r"Start Date (?P<start>[\d/]+) / .*?parity forecast purposes only / (?P<body>.*?) / PUBLIC DISCLOSURE"
)
PREFIX_RE = re.compile(r"^(?:(SAV|GTC|MEAG|DU|GRID|PS)\s*[:-]\s*)+", re.I)
CC_RE = re.compile(r"^CC\s*-\s*", re.I)


def pdf_path() -> Path:
    """Extract Volume 3 from the PSC zip into RAW_DIR once."""
    out = RAW_DIR / "gpc-2025-irp-volume3.pdf"
    if not out.exists():
        with zipfile.ZipFile(RAW_DIR / ZIP) as z:
            out.write_bytes(z.read(MEMBER))
    return out


def _pages(path: Path) -> list[str]:
    doc = pymupdf.open(path)
    return [" / ".join(ln.strip() for ln in p.get_text().splitlines() if ln.strip()) for p in doc]


def project_list(pages: list[str]) -> dict[str, dict]:
    """Table 2 rows keyed by Teams #: zone, year, name, need date, sponsor."""
    rows: dict[str, dict] = {}
    for text in pages:
        if "Georgia ITS 10 Year Plan Project List" not in text and "Project / Sponsor" not in text:
            continue
        if "Cancelled Projects" in text or "Completed Projects" in text:
            # These two tables list removed projects; Table 2 rows never share a page with them.
            text = text.split("Cancelled Projects")[0].split("Completed Projects")[0]
        for m in ROW_RE.finditer(text):
            rows.setdefault(m["teams"], {**m.groupdict(), "name": m["name"].replace(" / ", " ")})
    return rows


def _clean_name(name: str) -> str:
    name = re.sub(r"\s+", " ", name.replace(" / ", " ")).strip()
    return name


def _body_description(body: str) -> str:
    parts = [p.strip() for p in body.split(" / ")]
    # Drop trailing redaction marker and the two "change from previous" cells.
    text_parts = []
    for p in parts:
        if p == "REDACTED":
            break
        text_parts.append(p)
    return re.sub(r"\s+", " ", " ".join(text_parts)).strip()


def _places(name: str, description: str) -> tuple[list[str], list[str]]:
    places = name_places(name)
    route = list(places)
    if len(route) < 2:
        pairs = from_to_pairs(description)
        if pairs:
            route = list(pairs[0])
    # "at Rice Hope", "at Thomson Primary substation"
    if not places:
        m = re.search(r"\bat (?:the )?([A-Z][\w.' ]+?)(?: substation| sub\b| 230| 115| 500|[.,]|$)", description)
        if m:
            places = [clean_place(m.group(1))]
            route = list(places)
    return dedupe(places + [r for r in route if r not in places]), route


def _kind(name: str, route: list[str]) -> str:
    line_words = re.search(r"\b(line|rebuild|reconductor|re-?conductor|tl|loop|tap)\b", name, re.I)
    if len(route) >= 2 and (line_words or not SUB_WORDS.search(name)):
        return "line"
    if SUB_WORDS.search(name) or len(route) < 2:
        return "substation"
    return "line"


def parse(path: Path | None = None) -> tuple[list[RawProject], dict]:
    """Georgia Power (GPC + SAV) projects and counts of excluded ITS owners."""
    path = path or pdf_path()
    pages = _pages(path)
    table = project_list(pages)
    projects: list[RawProject] = []
    excluded: dict[str, int] = {}
    seen: set[str] = set()
    for i, text in enumerate(pages):
        m = DETAIL_RE.search(text)
        if not m or m["teams"] in seen:
            continue
        teams = m["teams"]
        row = table.get(teams)
        if not row:
            continue  # detail page for a project that is not in Table 2 (cancelled/completed)
        seen.add(teams)
        sponsor = row["sponsor"]
        if sponsor not in GPC_SPONSORS:
            excluded[sponsor] = excluded.get(sponsor, 0) + 1
            continue
        name = _clean_name(m["name"])
        desc = _body_description(m["body"])
        places, route = _places(name, desc)
        kind = _kind(name, route)
        action = action_from(name, desc)
        if kind == "substation" and action == "rebuild":
            action = "upgrade"
        start = parse_date(m["start"])
        need = parse_date(m["need"])
        text_all = f"{name} {desc}"
        projects.append(
            RawProject(
                id=f"gpc-irp-{teams}",
                utility="GPC",
                owner=sponsor,
                name=name.title().replace("Kv", "kV").replace("Sav:", "SAV:").replace("Cc -", "CC -"),
                kind=kind,
                action=action,
                description=(
                    f"{desc} (Georgia ITS Teams #{teams}; planning start {start}, need date {need}; "
                    f"sponsor {sponsor}; cost redacted in public filing)"
                ),
                voltage_kv=voltages(text_all),
                miles=miles(desc),
                places=places,
                route=route,
                in_service=need,
                cost_usd=None,
                status="Planned (Georgia ITS 10-year plan)",
                state="GA",
                source_document=DOC,
                source_url=URL,
                source_page=i + 1,
                extra_places=[x for x in from_to(desc) if x.upper() not in {p.upper() for p in places}],
                zone=row["zone"],
            )
        )
    return projects, {"excludedSponsors": excluded, "tableRows": len(table)}


if __name__ == "__main__":
    ps, info = parse()
    print(len(ps), info)
    for p in ps:
        print(p.source_page, p.owner, p.kind, p.action, p.voltage_kv, p.miles, p.in_service, "|", p.name, "|", p.places, p.route)

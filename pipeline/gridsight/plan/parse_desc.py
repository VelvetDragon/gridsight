"""Parse DESC 'Planned Transmission Projects $2M and above' (SCRTP, 2026-2030).

The PDF has exactly one project per page with a fixed layout:
title, Project ID, Project Description, Project Need, Project Status,
Planned In-Service Date, Estimated Project Cost (Previous, 2026..2030, Total).
"""

from __future__ import annotations

import re
from pathlib import Path

import pymupdf

from gridsight.config import RAW_DIR
from gridsight.plan.records import (
    SUB_WORDS,
    VOLT_RE,
    RawProject,
    _is_place,
    action_from,
    clean_place,
    cut_at_voltage,
    dedupe,
    from_to,
    from_to_pairs,
    miles,
    money,
    parse_date,
    slug,
    split_places,
    voltages,
)

PDF = "desc-2026-2030-projects.pdf"
URL = "https://www.scrtp.com/assets/pdfs/home/2026-2030-2million-and-above-project-descriptions.pdf"
DOC = "DESC Planned Transmission Projects $2M and above, 2026-2030 (SCRTP)"

FIELDS = [
    "Project ID",
    "Project Description",
    "Project Need",
    "Project Status",
    "Planned In-Service Date",
    "Estimated Project Cost",
]


def _sections(lines: list[str]) -> dict[str, str]:
    """Split one page into {title, Project ID, ...} using the fixed field labels."""
    out: dict[str, list[str]] = {"title": []}
    current = None
    started = False
    for ln in lines:
        if ln == "5 Year Budget":
            started, current = True, "title"
            continue
        if not started:
            continue
        if ln in FIELDS:
            current = ln
            out[current] = []
            continue
        if current:
            out[current].append(ln)
    return {k: " ".join(v).strip() for k, v in out.items()}


TAIL_ROUTE_RE = re.compile(
    r"^\s*(?:rebuild|replace|construct|upgrade)\s+(?:line\s+)?(?:from\s+)?"
    r"(?P<a>[A-Z][\w.' ]+?)\s+(?:to|–|-)\s+(?P<b>[A-Z][\w.'/ ]+?)(?:\s+section)?\s*$",
    re.IGNORECASE,
)


def _places(title: str, description: str) -> tuple[list[str], list[str], str]:
    """(places, route, first_segment) from the title.

    The part before the first colon names the facility ("Jasper – Okatie 230 kV #2").
    Extra comma/and segments only count when they name another facility (contain
    a dash or a voltage). A "Rebuild X to Y" tail narrows the route; a single-site
    title takes its route from "from X to Y" in the description.
    """
    head, _, tail = title.partition(":")
    segments = [x for x in re.split(r",|\s&\s|\sand\s", head) if x.strip()]
    first = segments[0] if segments else head
    places: list[str] = []
    for k, seg in enumerate(segments):
        if k == 0 or re.search(r"[–—-]", seg) or VOLT_RE.search(seg):
            places += split_places(seg)
    # "Williams St Sub: Replace ..., AM Williams Sub: Replace ..., and McMeekin Sub: Add ..."
    places += [p.strip() for p in re.findall(r"(?:^|,\s*(?:and\s+)?)([A-Z][\w. ]+?) Sub:", title)]
    places = dedupe([p for p in places if p])
    route = list(places)
    m = TAIL_ROUTE_RE.match(tail) if tail else None
    if m:
        a, b = (clean_place(cut_at_voltage(m.group(g))) for g in ("a", "b"))
        if _is_place(a) and _is_place(b):
            route = [a, b]
            places = dedupe(places + route)
    elif len(route) < 2:
        pairs = from_to_pairs(description)
        if pairs:
            route = list(pairs[0])
            places = dedupe(places + route)
    return places, route, first


def _kind(title: str, first_segment: str, route: list[str]) -> str:
    """Substation when the first facility named is a sub (unless it is a tap line
    between two named sites); line when a route has two ends; else by keywords."""
    if SUB_WORDS.search(first_segment) and len(split_places(first_segment)) < 2:
        if re.search(r"\btap\b", title, re.I) and len(route) >= 2:
            return "line"
        return "substation"
    if len(route) >= 2:
        return "line"
    if SUB_WORDS.search(title):
        return "substation"
    return "line"


def _cost(cost_text: str) -> float | None:
    """Total is the last dollar figure of the cost row; interconnection-funded
    projects state 'Estimated cost of $X is to be financed ...'."""
    m = re.search(r"Estimated cost of \$([\d,]+)", cost_text)
    if m:
        return float(m.group(1).replace(",", ""))
    body = cost_text.split("Total", 1)[-1].split("*Total")[0]  # older editions add a rate-base footnote
    tokens = re.findall(r"\$\s*[\d,]{2,}", body) or re.findall(r"\$?[\d,]{2,}", body)
    return money(tokens[-1]) if tokens else None


def parse(path: Path | None = None) -> list[RawProject]:
    path = path or RAW_DIR / PDF
    doc = pymupdf.open(path)
    projects: list[RawProject] = []
    for i, page in enumerate(doc):
        lines = [ln.strip() for ln in page.get_text().splitlines() if ln.strip()]
        s = _sections(lines)
        title = re.sub(r"\s+", " ", s["title"]).strip()
        desc = s.get("Project Description", "")
        need = s.get("Project Need", "")
        pid = s.get("Project ID", "").strip()
        places, route, first = _places(title, desc)
        extra = [p for p in from_to(desc) if p.lower() not in {x.lower() for x in places}]
        text = f"{title} {desc}"
        kind = _kind(title, first, route)
        action = action_from(title, desc)
        if kind == "substation" and action == "rebuild":
            action = "upgrade"  # equipment replacement inside a substation
        projects.append(
            RawProject(
                id=f"desc-{i + 1:02d}-{slug(title)[:40]}",
                utility="DESC",
                owner="DESC",
                name=title,
                kind=kind,
                action=action,
                description=f"{desc} Need: {need}".strip() + (f" (DESC project ID {pid})" if pid else ""),
                voltage_kv=voltages(text),
                miles=miles(text),
                places=places,
                route=route,
                in_service=parse_date(s.get("Planned In-Service Date", "")),
                cost_usd=_cost(s.get("Estimated Project Cost", "")),
                status=s.get("Project Status") or None,
                state="SC",
                source_document=DOC,
                source_url=URL,
                source_page=i + 1,
                extra_places=extra,
            )
        )
    return projects


if __name__ == "__main__":
    for p in parse():
        print(p.source_page, p.kind, p.action, p.voltage_kv, p.miles, p.in_service, p.cost_usd, p.places, p.route, p.extra_places)

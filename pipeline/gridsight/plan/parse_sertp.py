"""Parse Southern Company projects out of two public SERTP documents.

1. SERTP 2026 Q2 preliminary 10-year expansion plan (slide deck). Project slides
   have a title such as "SOCO:  HATCH - WADLEY 500 KV LINE STRATEGIC PROJECT",
   an in-service year bullet ("• 2031"), DESCRIPTION and SUPPORTING STATEMENT.
2. SERTP 2025 Regional Transmission Plan & Input Assumptions (Nov 2025). The
   Southern BAA appendix lists "In-Service Year / Project Name / Description".

Owner tags: SOCO = Southern Company, which covers Georgia Power *and* Alabama /
Mississippi Power, so a SOCO project only becomes a Georgia Power (GPC) project
once geocoding places it in Georgia (see geocode.py). GTC, MEAG, DU and PS are
other owners and are excluded (counted in meta); when their slide assigns a
bullet explicitly to GPC ("GPC: Construct ..."), that bullet is kept as a GPC
record.
"""

from __future__ import annotations

import re
from pathlib import Path

import pymupdf

from gridsight.config import RAW_DIR
from gridsight.plan.records import (
    RawProject,
    action_from,
    clean_place,
    cut_at_voltage,
    dedupe,
    from_to_pairs,
    miles,
    name_places,
    slug,
    split_places,
    voltages,
    year_to_date,
)

Q2_PDF = "sertp-2026-q2-preliminary-plan.pdf"
Q2_URL = "https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_2nd_Qtr_Presentation.pdf"
Q2_DOC = "SERTP 2026 2nd Quarter Meeting: Preliminary 10-Year Transmission Expansion Plan"

RP_PDF = "sertp-2025-regional-plan.pdf"
RP_URL = (
    "https://www.southeasternrtp.com/docs/general/2025/"
    "2025%20Regional%20Transmission%20Plan%20and%20Input%20Assumptions.pdf"
)
RP_DOC = "SERTP 2025 Regional Transmission Plan & Input Assumptions Overview"

NON_GPC_OWNERS = {"GTC", "MEAG", "DU", "PS", "POWERSOUTH"}

TITLE_RE = re.compile(
    r"(?:^| / )(?P<owner>SOCO|GTC|MEAG|DU|PS)\s*:\s+(?P<title>[A-Z0-9][A-Z0-9 .,&#/()'’–\-]{4,}?)(?= / |$)"
)
YEAR_RE = re.compile(r"•\s*(20\d\d)\b")
def _kind(title: str, places: list[str], description: str) -> str:
    if re.search(r"\b(LINE|TL|LINES)\b", title, re.I) and len(places) >= 2:
        return "line"
    if re.search(r"\bSUBSTATION|SWITCHING STATION|AUTOTRANSFORMER|BREAKER|REACTOR|RELAY|BUS\b|SWITCH", title, re.I):
        return "substation"
    return "line" if len(places) >= 2 else "substation"


def _record(*, pid, owner, title, desc, year, doc, url, page, note="") -> RawProject:
    places = name_places(title)
    route = list(places)
    if len(route) < 2:
        pairs = from_to_pairs(desc)
        if pairs:
            route = list(pairs[0])
    kind = _kind(title, route, desc)
    action = action_from(title, desc)
    if kind == "substation" and action == "rebuild":
        action = "upgrade"
    return RawProject(
        id=pid,
        utility="GPC",
        owner=owner,
        name=re.sub(r"\s+", " ", title).strip(),
        kind=kind,
        action=action,
        description=(desc + (f" {note}" if note else "")).strip(),
        voltage_kv=voltages(f"{title} {desc}"),
        miles=miles(desc) or miles(title),
        places=dedupe(places + [r for r in route if r not in places]),
        route=route,
        in_service=year_to_date(year) if year else None,
        cost_usd=None,
        status="Planned (SERTP expansion plan)",
        state="GA",
        source_document=doc,
        source_url=url,
        source_page=page,
    )


def _pages(path: Path) -> list[str]:
    return [" / ".join(ln.strip() for ln in p.get_text().splitlines() if ln.strip()) for p in pymupdf.open(path)]


def _between(text: str, start: str, end: str) -> str:
    m = re.search(start + r"\s*:?\s*/?(.*?)(?:" + end + r"|$)", text, re.I | re.S)
    if not m:
        return ""
    body = m.group(1)
    body = re.sub(r"\s*/\s*[•–]\s*/\s*", " ", body)
    body = re.sub(r"\s*/\s*", " ", body)
    return re.sub(r"\s+", " ", body).strip(" •–")


def parse_q2(path: Path | None = None) -> tuple[list[RawProject], dict]:
    """SOCO project slides (+ GPC bullets on other owners' slides) from the 2026 Q2 deck."""
    pages = _pages(path or RAW_DIR / Q2_PDF)
    out: list[RawProject] = []
    excluded: dict[str, int] = {}
    in_southern = False
    for i, text in enumerate(pages):
        n = i + 1
        if "SOUTHERN Balancing Authority Area" in text and re.search(r"Transmission Expansion Plan", text):
            in_southern = True
            continue
        if re.search(r"(TVA|DUKE|LG&E|AECI|PowerSouth).{0,40}Balancing Authority Area\s*(/|$)", text) and (
            "Expansion Plan" in text or "Generation Assumptions" in text
        ):
            in_southern = False
        if not in_southern:
            continue
        m = TITLE_RE.search(text)
        ym = YEAR_RE.search(text)
        if not m or not ym:
            continue
        owner, title, year = m["owner"], m["title"].strip(), int(ym.group(1))
        desc = _between(text, "DESCRIPTION", "SUPPORTING STATEMENT")
        if owner in NON_GPC_OWNERS:
            excluded[owner] = excluded.get(owner, 0) + 1
            # Keep bullets explicitly assigned to Georgia Power.
            for k, bm in enumerate(re.finditer(r"\b((?:[A-Z]{2,4}/)*GPC(?:/[A-Z]{2,4})*)\s*:\s*(.+?)(?=(?:\b[A-Z]{2,4}(?:/[A-Z]{2,4})*\s*:)|$)", desc)):
                bullet = bm.group(2).strip()
                places = [p for pair in from_to_pairs(bullet) for p in pair]
                places += [clean_place(x) for x in re.findall(r"(?:the|a new)\s+([A-Z][\w'’. ]+?)\s+\d{3}(?:/\d{3})?\s*kV\s+(?:switching station|substation)", bullet)]
                places += [p for seg in re.findall(r"([A-Z][\w'’. ]+?\s+[-–]\s+[A-Z][\w'’. ]+?)\s+\d{3}\s*kV\s+line", bullet) for p in split_places(seg)]
                places = dedupe([p for p in places if p])
                rec = _record(
                    pid=f"gpc-sertp26-s{n}-{k}",
                    owner=bm.group(1),
                    title=f"{title} ({bm.group(1)} portion)",
                    desc=bullet,
                    year=year,
                    doc=Q2_DOC,
                    url=Q2_URL,
                    page=n,
                    note=f"Slide owner {owner}; this record keeps only the part assigned to {bm.group(1)}.",
                )
                rec.places, rec.route = places, places[:2]
                rec.kind = "line" if "line" in bullet.lower() and len(places) >= 2 else "substation"
                out.append(rec)
            continue
        out.append(
            _record(pid=f"gpc-sertp26-s{n}", owner=owner, title=title, desc=desc, year=year, doc=Q2_DOC, url=Q2_URL, page=n)
        )
    return out, {"excludedOwners": excluded}


ENTRY_RE = re.compile(
    r"In-Service / Year: / (?P<year>20\d\d) / Project Name: / (?P<name>.+?) / Description: / (?P<desc>.+?)"
    r" / Supporting / Statements: / (?P<supp>.+?)(?= / In-Service / Year:|<<PAGE|$)",
    re.S,
)
BOILER_RE = re.compile(
    r"SERTP TRANSMISSION PROJECTS \(CEII\) / \d+ / Balancing Authority / SERTP TRANSMISSION PROJECTS \(CEII\) / "
    r"[^/]*Balancing Authority Area / SERTP TRANSMISSION PROJECTS / "
)


def parse_regional_2025(path: Path | None = None) -> tuple[list[RawProject], dict]:
    """Southern-BAA entries of the 2025 regional plan (candidates; Georgia check happens in geocoding)."""
    pages = _pages(path or RAW_DIR / RP_PDF)
    joined = []
    for i, text in enumerate(pages):
        if "SOUTHERN Balancing Authority Area" not in text or "Project Name" not in text:
            continue
        joined.append(f"<<PAGE {i + 1}>> / " + BOILER_RE.sub("", text))
    blob = " / ".join(joined)
    marks = [(m.start(), int(m.group(1))) for m in re.finditer(r"<<PAGE (\d+)>>", blob)]
    out: list[RawProject] = []
    excluded: dict[str, int] = {}
    for m in ENTRY_RE.finditer(blob):
        page = max((p for pos, p in marks if pos <= m.start()), default=None)
        name = re.sub(r"\s*/\s*", " ", m["name"]).strip()
        desc = re.sub(r"<<PAGE \d+>>", " ", re.sub(r"\s*/\s*", " ", m["desc"])).strip()
        supp = re.sub(r"<<PAGE \d+>>", " ", re.sub(r"\s*/\s*", " ", m["supp"])).strip()
        pm = re.match(r"^(SAV|GTC|MEAG|DU|PS|GRID)\s*:\s*", name)
        owner = pm.group(1) if pm else "SOCO"
        if owner in NON_GPC_OWNERS:
            excluded[owner] = excluded.get(owner, 0) + 1
            gpc = re.search(r"\bGPC\s*:\s*(.+?)(?=\b(?:GTC|MEAG|DU)\s*:|$)", desc)
            if not gpc:
                continue
            desc = gpc.group(1).strip()
            owner = "GPC"
            name = f"{name} (GPC portion)"
        rec = _record(
            pid=f"gpc-sertp25-p{page}-{slug(name)[:30]}",
            owner=owner,
            title=name,
            desc=f"{desc} Supporting statement: {supp}",
            year=int(m["year"]),
            doc=RP_DOC,
            url=RP_URL,
            page=page,
        )
        out.append(rec)
    return out, {"excludedOwners": excluded, "entries": len(out) + sum(excluded.values())}


if __name__ == "__main__":
    q2, info = parse_q2()
    print("Q2", len(q2), info)
    for p in q2:
        print(p.source_page, p.owner, p.kind, p.action, p.in_service, p.miles, "|", p.name, "|", p.places, p.route)
    rp, info = parse_regional_2025()
    print("RP", len(rp), info)
    for p in rp[:400]:
        print(p.source_page, p.owner, p.kind, p.action, p.in_service, p.miles, "|", p.name, "|", p.places, p.route)

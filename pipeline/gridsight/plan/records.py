"""Shared record type and text helpers for the Plan-mode parsers.

Every parser turns one public filing into a list of RawProject. Geocoding and
geometry are added later (gridsight.plan.geocode / gridsight.plan.geometry).
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import date


@dataclass
class RawProject:
    id: str
    utility: str  # "DESC" | "GPC"
    owner: str  # owner tag in the filing, e.g. "DESC", "SOCO", "GPC", "SAV"
    name: str
    kind: str  # "line" | "substation"
    action: str  # "new" | "rebuild" | "upgrade"
    description: str
    voltage_kv: list[int]
    miles: float | None
    places: list[str]  # every site named in the title, as written
    route: list[str]  # ordered endpoints used to draw a line (subset of places)
    in_service: str | None  # ISO date
    cost_usd: float | None
    status: str | None
    state: str  # "SC" | "GA"
    source_document: str
    source_url: str
    source_page: int | None
    # Places mentioned only in the description (fallback for geocoding).
    extra_places: list[str] = field(default_factory=list)
    # Human notes appended to the description (e.g. "location not found").
    notes: list[str] = field(default_factory=list)
    # Optional explicit build window [start, end] from the source itself.
    build_window: tuple[str, str | None] | None = None
    # County-level location hint ("Effingham County, GA") when no site is named.
    county: str | None = None
    # Region tag printed in the filing ("SAV" = Georgia Power's Savannah area), used to
    # disambiguate names that exist in several places.
    zone: str | None = None


# ---------------------------------------------------------------- voltages

# "230 kV", "230kV", "230-115kV", "115/46 kV", "115 – 12kV", "500/230 KV".
VOLT_RE = re.compile(
    r"(\d{2,3}(?:\.\d)?)(?:\s*(?:[-/–]|to)\s*(\d{1,3}(?:\.\d)?))?\s*-?\s*k\s*v\b",
    re.IGNORECASE,
)


def voltages(text: str) -> list[int]:
    """All transmission voltages (kV) mentioned, deduplicated, high to low."""
    out: set[int] = set()
    for m in VOLT_RE.finditer(text):
        for g in m.groups():
            if g:
                v = float(g)
                if 34 <= v <= 765:
                    out.add(int(round(v)))
    return sorted(out, reverse=True)


# ---------------------------------------------------------------- miles

MILES_RE = re.compile(
    r"(?:approx(?:imately|\.)?\s*|~\s*)?(\d{1,3}(?:\.\d{1,2})?)\s*[- ]?\s*(?:mile|mi\b)",
    re.IGNORECASE,
)
MILES_AFTER_RE = re.compile(r"(?:length\s*[-:]\s*|total length,?\s*)(\d{1,3}(?:\.\d{1,2})?)\s*miles?", re.I)


def miles(text: str) -> float | None:
    """Largest mileage figure stated in the text (line length), else None."""
    vals = [float(m.group(1)) for m in MILES_RE.finditer(text)]
    vals += [float(m.group(1)) for m in MILES_AFTER_RE.finditer(text)]
    vals = [v for v in vals if 0 < v < 400]
    return max(vals) if vals else None


# ---------------------------------------------------------------- dates

DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")


def parse_date(text: str, *, last: bool = True) -> str | None:
    """Parse US m/d/y dates; invalid days (04/31/26) are clamped to month end.

    With several dates ("10/1/2025 (phase 1) and 10/1/2026 (phase 2)") the last
    one is the final in-service date.
    """
    found = DATE_RE.findall(text or "")
    if not found:
        return None
    m, d, y = found[-1] if last else found[0]
    year = int(y) + (2000 if len(y) == 2 else 0)
    month = max(1, min(12, int(m)))
    day = max(1, min(int(d), calendar.monthrange(year, month)[1]))
    return date(year, month, day).isoformat()


def year_to_date(year: int) -> str:
    """SERTP lists in-service *years* for summer peak; we use June 1 of that year."""
    return date(year, 6, 1).isoformat()


# ---------------------------------------------------------------- action / kind

# Verb -> action. Order matters: the first verb found in the title wins.
ACTION_WORDS = [
    (r"\bre-?build|\brebuilt|\breconduct|\bre-?conductor|\breplace\b|\breplacement|\bmove line|\bre-?terminat", "rebuild"),
    (r"\bconstruct|\bnew\b|\bbuild\b|\badd\b.*\bline\b|\binstall\b.*\bline\b|\bconversion\b|\bconvert", "new"),
    (r"\bupgrade|\buprate|\badd\b|\binstall|\bexpan|\breplac|\bmoderniz|\bimprove|\breactor|\brelay|\bbreaker", "upgrade"),
]


def action_from(title: str, description: str = "") -> str:
    for text in (title, description):
        low = text.lower()
        hits = []
        for pattern, action in ACTION_WORDS:
            m = re.search(pattern, low)
            if m:
                hits.append((m.start(), action))
        if hits:
            return min(hits)[1]
    return "upgrade"


LINE_WORDS = re.compile(
    r"\b(line|lines|tie|tap|loop|t\.?l\.?|tl|reconductor|rebuild|fold-?in|crossing|circuit|spdc|spsc)\b", re.I
)
SUB_WORDS = re.compile(
    r"\b(sub|substation|switching station|switchyard|sw house|switch house|transformers?|autotransformers?|"
    r"auto transformer|bank|breakers?|relays?|reactors?|capacitors?|bus|statcom|svc|line trap|switch(?:es)?|"
    r"jumpers?|ring bus|synchronous condenser)\b",
    re.I,
)


def kind_from(title: str, n_places: int) -> str:
    """line when the title names a line/tap/rebuild between sites, else substation."""
    has_line = bool(LINE_WORDS.search(title))
    has_sub = bool(SUB_WORDS.search(title))
    if n_places >= 2 and has_line:
        return "line"
    if has_sub and not (has_line and n_places >= 2):
        return "substation"
    if n_places >= 2:
        return "line"
    return "line" if has_line and not has_sub else "substation"


# ---------------------------------------------------------------- places

DASH_SPLIT = re.compile(r"\s*[–—]\s*|\s+-\s*|\s*-\s+|(?<=[A-Za-z0-9.])-(?=[A-Z])")
NOT_PLACES = re.compile(
    r"^(#.*|.*\brebuild\b.*|.*\bdead ends?\b|fold-?in|rebuild|construct|tap|line|lines|sub|substation|project|phase \d|section|"
    r"structures?(?: \d+)?|replace.*|upgrade.*|add.*|install.*|and|the|new|tie lines?|"
    r"transmission|loop|t\.?l\.?|reconductor.*|conversion|expansion|in|grid|cc)$",
    re.I,
)


def cut_at_voltage(text: str) -> str:
    m = VOLT_RE.search(text)
    return text[: m.start()] if m else text


def clean_place(p: str) -> str:
    p = re.sub(r"\(.*?\)", " ", p)
    p = re.sub(r"\bkv\b", " ", p, flags=re.I)
    p = re.sub(r"(\s+(sub(station)?|line|lines|tl)\.?)+\s*$", " ", p, flags=re.I)
    p = re.sub(r"\s+", " ", p).strip(" ,.;:&/")
    p = re.sub(r"(\s+\d{2,3}(?:\.\d)?)+$", "", p)  # "Hills Bridge 500 230" -> "Hills Bridge"
    return p


def split_places(segment: str) -> list[str]:
    """'Jasper – Okatie 230 kV #2' -> ['Jasper', 'Okatie']."""
    head = cut_at_voltage(segment)
    parts = [clean_place(x) for x in DASH_SPLIT.split(head)]
    return [p for p in parts if _is_place(p)]


FROM_TO_RE = re.compile(
    r"\b(?:from|between)\s+(?:the\s+)?(?P<a>[A-Z0-9][\w.'#&/]*(?:\s+[A-Z0-9#][\w.'#&/]*){0,4})"
    r"\s+(?:to|and|&|–|-)\s+(?:the\s+)?(?P<b>[A-Z0-9][\w.'#&/]*(?:\s+[A-Z0-9#][\w.'#&/]*){0,4})"
)


def _is_place(p: str) -> bool:
    return bool(p) and len(p) > 1 and p[0].isalpha() and not NOT_PLACES.match(p)


ABBREV = {"st", "n", "s", "e", "w", "rd", "jct", "pri", "mt", "ft", "sw", "sta"}


def _stop_at_sentence(name: str) -> str:
    """'Church Creek. Include Long Savannah' -> 'Church Creek' (keeps 'St. Helena')."""
    out = []
    for tok in name.split():
        if tok.endswith(".") and tok[:-1].lower() not in ABBREV:
            out.append(tok[:-1])
            break
        out.append(tok)
    return " ".join(out)


def from_to_pairs(text: str) -> list[tuple[str, str]]:
    """Endpoint pairs in 'from X to Y' / 'between X and Y' phrases (capitalised names only)."""
    out: list[tuple[str, str]] = []
    for m in FROM_TO_RE.finditer(text or ""):
        a = clean_place(cut_at_voltage(_stop_at_sentence(m.group("a"))))
        b = clean_place(cut_at_voltage(_stop_at_sentence(m.group("b"))))
        if _is_place(a) and _is_place(b):
            out.append((a, b))
    return out


def from_to(text: str) -> list[str]:
    """Flattened, de-duplicated endpoint names from from_to_pairs()."""
    out: list[str] = []
    for a, b in from_to_pairs(text):
        for p in (a, b):
            if p not in out:
                out.append(p)
    return out


# Words after which a title stops naming places.
TITLE_STOP = re.compile(
    r"\b(SUBSTATION|SWITCHING STATION|SWITCHYARD|NEW|STRATEGIC|PROJECT|AREA|SOLUTION|"
    r"IMPROVEMENTS?|UPGRADE|REBUILD|RECONDUCTOR|AUTOTRANSFORMER|TRANSFORMERS?|BREAKERS?|RELAY|"
    r"REPLACEMENT|INSTALLATION|MODERNIZATION|EXPANSION|CONVERSION|BUS|BANK|REACTORS?|NETWORK|"
    r"CAPACITOR|JUMPER|TRAP|CONSTRUCT|TRANSMISSION|LIMITING|PROTECTION|PROTECTIVE|SWITCH|EQUIPMENT|"
    r"LOOP-IN|LOOP|FIBER|RESAG|STATCOM|SYNCHRONOUS)\b.*$",
    re.I,
)


def name_places(title: str) -> list[str]:
    """'HATCH - WADLEY 500 KV LINE STRATEGIC PROJECT' -> ['HATCH', 'WADLEY']."""
    t = re.sub(r"\(.*?\)", " ", title)
    t = re.sub(r"^(?:(?:SAV|GRID|CC|GTC|MEAG|DU|PS)\s*[:–—-]\s*)+", "", t.strip(), flags=re.I)
    t = re.sub(r"^NEW\s+", "", t, flags=re.I)
    t = cut_at_voltage(t)
    t = t.split(",")[0]
    t = TITLE_STOP.sub("", t)
    places = [re.sub(r"\s+(TS|SS|SW|LINE|LINES|TL)$", "", p, flags=re.I) for p in split_places(t)]
    return [p for p in places if _is_place(p)]


def dedupe(seq: list[str]) -> list[str]:
    seen, out = set(), []
    for s in seq:
        k = s.lower()
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out


def money(text: str) -> float | None:
    """'$19,280,474' -> 19280474.0 (also tolerates '$14,303648')."""
    m = re.search(r"\$?\s*([\d,]{4,})", text)
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


KEEP_UPPER = {"SAV", "CC", "GPC", "GTC", "MEAG", "DU", "PS", "SOCO", "APC", "FPL", "USA", "LG&E", "QTS", "SK", "EA",
              "TS", "SS", "TL", "BESS", "II", "III", "IPO", "ACSS", "ACSR", "RAS"}


def display_name(name: str) -> str:
    """Title-case an ALL CAPS filing name, keeping tags (SAV, CC) and kV/Mc spellings."""
    if name.upper() != name:
        return re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), name)
    out = []
    for tok in re.split(r"(\s+|[-–/(),:])", name):
        up = tok.upper()
        if up in KEEP_UPPER:
            out.append(up)
        elif re.fullmatch(r"\d+KV", up):
            out.append(up[:-2] + "kV")
        elif up == "KV":
            out.append("kV")
        else:
            out.append(tok.capitalize())
    s = "".join(out)
    return re.sub(r"\bMc([a-z])", lambda m: "Mc" + m.group(1).upper(), s)

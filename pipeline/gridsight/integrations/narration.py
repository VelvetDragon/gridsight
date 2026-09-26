"""Narration scripts built from the real data files, plus the ElevenLabs client.

The texts are written to be read aloud: short, calm sentences, numbers rounded
the way a person would say them. Every number comes from public/data (or the
fixtures when the pipeline output is missing).
"""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import requests

from gridsight.integrations.common import env, read_json

PRODUCT = "MrGridy"

STORY_TITLES = [
    "Two neighbors",
    "Their plans",
    "Where they collide",
    "The best match",
    "What it saves",
    "When a storm comes",
    "Fix it together",
]

ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
# A stock narrator voice from the ElevenLabs premade library ("George": warm, calm).
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_MODEL_ID = "eleven_multilingual_v2"
OUTPUT_FORMAT = "mp3_44100_128"
BITRATE_KBPS = 128
WORDS_PER_SECOND = 2.6


@dataclass
class Clip:
    id: str
    kind: str  # "story" | "flight" | "briefing"
    title: str
    text: str
    file: str | None = None
    durationMs: int = 0
    hash: str = ""

    def finalize(self) -> "Clip":
        self.text = re.sub(r"\s+", " ", self.text).strip()
        self.hash = hashlib.sha1(self.text.encode("utf-8")).hexdigest()[:12]
        if not self.durationMs:
            self.durationMs = estimate_ms(self.text)
        return self

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def estimate_ms(text: str) -> int:
    words = len(text.split())
    return int(round((words / WORDS_PER_SECOND) * 1000 + 400, -2))


# ---------------------------------------------------------------- speech text


def spoken_name(name: str) -> str:
    """Make a filing's project name readable aloud."""
    text = re.sub(r"^[A-Z]{2,6}:\s*", "", name)  # "SAV: Goshen ..." -> "Goshen ..."
    text = text.split(":")[0]  # "Summerville 115kV Loop: Rebuild" -> "Summerville 115kV Loop"
    text = re.sub(r"\s*\([^)]*\)", "", text)  # drop "(SAV)", "(GPC portion)"
    text = re.sub(r"(\d+)\s*kV\b", r"\1 kilovolt", text)
    text = re.sub(r"\s+[-–—]\s+", " to ", text)
    text = text.replace("#", "number ")
    return re.sub(r"\s+", " ", text).strip(" ,")


def say_int(n: float) -> str:
    n = int(round(n))
    if abs(n) >= 1_000_000:
        v = n / 1_000_000
        return f"{v:.1f} million".replace(".0 million", " million")
    if abs(n) >= 10_000:
        return f"{int(round(n, -3)):,}"
    return f"{n:,}"


def say_usd(n: float) -> str:
    if n >= 1_000_000:
        v = n / 1_000_000
        return f"${v:.1f} million".replace(".0 million", " million")
    if n >= 10_000:
        return f"${int(round(n, -4)):,}"
    return f"${int(round(n)):,}"


def say_about(n: float) -> str:
    """Round to two significant figures for speech: 401 -> 400, 1739 -> 1,700."""
    n = float(n)
    if n < 10.5:
        return say_count(int(round(n)), "x", "x")[:-2]
    if n < 100:
        return str(int(round(n)))
    digits = len(str(int(n))) - 2
    return f"{int(round(n, -digits)):,}"


def say_place(label: str) -> str:
    return re.sub(r",\s*GA\b", ", Georgia", re.sub(r",\s*SC\b", ", South Carolina", label))


def say_list(items: list[str]) -> str:
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return ", ".join(items[:-1]) + " and " + items[-1]


def say_count(n: int, one: str, many: str | None = None) -> str:
    words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
    word = words[n] if 0 <= n < len(words) else f"{n:,}"
    return f"{word} {one if n == 1 else (many or one + 's')}"


def overlap_place(summary: str) -> str | None:
    m = re.search(r"\bnear ([A-Z][A-Za-z .'-]+, (?:GA|SC))", summary or "")
    if not m:
        return None
    town, state = m.group(1).rsplit(", ", 1)
    return f"{town}, {'Georgia' if state == 'GA' else 'South Carolina'}"


def _km(a: list[float], b: list[float]) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    dx = (a[0] - b[0]) * 111.32 * math.cos(lat)
    dy = (a[1] - b[1]) * 110.57
    return math.hypot(dx, dy)


# ---------------------------------------------------------------- data


@dataclass
class Data:
    meta: dict[str, Any] | None
    projects: dict[str, dict[str, Any]]
    overlaps: list[dict[str, Any]]
    cost_ranges: dict[str, dict[str, Any]]
    storm: dict[str, Any] | None  # index entry of the featured storm
    counties: list[dict[str, Any]]
    zones: list[dict[str, Any]]
    yards: list[dict[str, Any]]
    vulnerable: list[dict[str, Any]]
    mutual_aid: Any
    origins: dict[str, str | None]


def load_data(root: Path | None, storm_id: str | None = None) -> Data:
    origins: dict[str, str | None] = {}

    def get(rel: str) -> Any:
        value, origin = read_json(rel, root)
        origins[rel] = origin
        return value

    meta = get("plan/meta.json")
    projects = {p["id"]: p for p in (get("plan/projects.json") or [])}
    overlaps = sorted(get("plan/overlaps.json") or [], key=lambda o: o.get("rank", 1e9))
    ranges_raw, _ = read_json("plan/insights/cost-ranges.json", root, fixtures=False)
    cost_ranges = {r["overlapId"]: r for r in (ranges_raw or []) if "overlapId" in r}

    storms = get("response/storms.json") or []
    storm = None
    if storm_id:
        storm = next((s for s in storms if s.get("id") == storm_id), {"id": storm_id, "name": storm_id.title()})
    elif storms:
        storm = next((s for s in storms if s.get("featured")), storms[0])

    counties: list = []
    zones: list = []
    yards: list = []
    vulnerable: list = []
    mutual_aid = None
    if storm:
        sid = storm["id"]
        counties = get(f"response/{sid}/counties.json") or []
        zones = get(f"response/{sid}/zones.json") or []
        yards = get(f"response/{sid}/yards.json") or []
        vulnerable = get(f"response/{sid}/vulnerable.json") or []
        for rel in (f"response/{sid}/mutual-aid.json", "response/mutual-aid.json", "plan/insights/mutual-aid.json"):
            mutual_aid, _ = read_json(rel, root, fixtures=False)
            if mutual_aid is not None:
                origins[rel] = "pipeline"
                break
    return Data(meta, projects, overlaps, cost_ranges, storm, counties, zones, yards, vulnerable, mutual_aid, origins)


def mutual_aid_sentence(mutual_aid: Any) -> str | None:
    """Use a one-line summary from mutual-aid.json when the file provides one."""
    if mutual_aid is None:
        return None
    candidates: list[Any] = []
    if isinstance(mutual_aid, dict):
        candidates = [mutual_aid.get(k) for k in ("narration", "headline", "summary")]
    elif isinstance(mutual_aid, list) and mutual_aid and isinstance(mutual_aid[0], dict):
        candidates = [mutual_aid[0].get(k) for k in ("narration", "headline", "summary")]
    for c in candidates:
        if isinstance(c, str) and 10 < len(c) < 300:
            return c.strip().rstrip(".") + "."
    return None


def nearest_county(point: list[float], counties: list[dict[str, Any]]) -> dict[str, Any] | None:
    best = None
    best_d = float("inf")
    for c in counties:
        centroid = c.get("centroid")
        if not centroid:
            continue
        d = _km(point, centroid)
        if d < best_d:
            best, best_d = c, d
    return best


def county_label(c: dict[str, Any]) -> str:
    return f"{c['name']} County"


# ---------------------------------------------------------------- scripts


def story_clips(d: Data) -> list[Clip]:
    meta = d.meta or {}
    counts = meta.get("projectCount") or {}
    n_desc = int(counts.get("DESC", sum(1 for p in d.projects.values() if p.get("utility") == "DESC")))
    n_gpc = int(counts.get("GPC", sum(1 for p in d.projects.values() if p.get("utility") == "GPC")))
    years = sorted(int(p["inService"][:4]) for p in d.projects.values() if p.get("inService"))
    upcoming = [y for y in years if y >= 2026] or years
    pairs = int(meta.get("pairsCompared") or n_desc * n_gpc)
    found = int(meta.get("overlapsFound") or len(d.overlaps))
    tiers = {t: sum(1 for o in d.overlaps if o.get("tier") == t) for t in ("crossing", "row", "logistics", "crew")}
    top = d.overlaps[0] if d.overlaps else None

    texts: list[str] = []
    texts.append(
        "Dominion Energy South Carolina and Georgia Power face each other across the Savannah River. "
        "Each one plans its own grid, mostly on its own."
    )
    span = f" due in service between {upcoming[0]} and {upcoming[-1]}" if upcoming else ""
    texts.append(
        f"Between them they have {n_desc + n_gpc} planned transmission projects{span}: "
        f"{n_desc} in South Carolina and {n_gpc} in Georgia. {PRODUCT} put every one of them on one map."
    )
    close = tiers["crossing"] + tiers["row"]
    close_line = (
        f"{say_count(tiers['crossing'], 'pair').capitalize()} touch or cross."
        if tiers["crossing"]
        else f"{say_count(close, 'pair').capitalize()} run within a mile of each other."
    )
    texts.append(
        f"{PRODUCT} compared all {pairs:,} pairs and found {found} places where the two plans come "
        f"within 40 kilometers of each other. {close_line}"
    )
    if top:
        desc = d.projects.get(top["descId"], {})
        gpc = d.projects.get(top["gpcId"], {})
        place = overlap_place(top.get("summary", ""))
        where = f" near {place}" if place else ""
        months = round(float(top.get("timelineOverlapMonths") or 0))
        timing = (
            f" Their build windows overlap by about {months} months."
            if months > 0
            else " Their build windows sit close together."
        )
        texts.append(
            f"The strongest match is{where}: DESC's {spoken_name(desc.get('name', 'project'))} "
            f"and Georgia Power's {spoken_name(gpc.get('name', 'project'))}.{timing}"
        )
    else:
        texts.append("The strongest match is where both utilities plan work in the same place at the same time.")

    top10 = d.overlaps[:10]
    central = sum((d.cost_ranges.get(o["id"], {}).get("centralUsd") or (o.get("cost") or {}).get("totalUsd") or 0)
                  for o in top10)
    low = sum(d.cost_ranges.get(o["id"], {}).get("lowUsd", 0) for o in top10)
    high = sum(d.cost_ranges.get(o["id"], {}).get("highUsd", 0) for o in top10)
    if central > 0:
        rng = f", somewhere between {say_usd(low)} and {say_usd(high)}" if low and high and d.cost_ranges else ""
        texts.append(
            f"Sharing crews, yards and right-of-way across the top {say_count(len(top10), 'match', 'matches')} could save "
            f"roughly {say_usd(central)}{rng}. That comes from avoided trips and shared land, not from any budget."
        )
    else:
        texts.append("Sharing crews, yards and right-of-way means fewer trips, less new land and fewer outages.")

    storm = d.storm or {}
    name = storm.get("name", "the storm")
    year = storm.get("year")
    predicted = sum(c.get("predictedPeakOut", 0) for c in d.counties)
    actual = sum((c.get("actualPeakOut") or 0) for c in d.counties)
    when = f" in {year}" if year else ""
    storm_line = f"When Hurricane {name} came through{when}, both utilities were hit at once."
    if predicted:
        storm_line += f" {PRODUCT} replays it and expects about {say_int(predicted)} customers out at the peak"
        storm_line += f"; about {say_int(actual)} actually lost power." if actual else "."
    texts.append(storm_line)

    joint_zones = [z for z in d.zones if len(z.get("utilities", [])) > 1]
    people = sum(int(z.get("vulnerablePeople", 0)) for z in d.zones)
    fix = []
    if d.yards:
        labels = say_list([say_place(y.get("label", "")) for y in d.yards[:2]])
        fix.append(f"{say_count(len(d.yards), 'shared staging yard').capitalize()}, at {labels}, can serve crews from both sides.")
    else:
        fix.append("Shared staging yards let crews from both sides start closer to the damage.")
    if d.zones:
        fix.append(
            f"{PRODUCT} orders {len(d.zones)} repair zones"
            + (f", {say_count(len(joint_zones), 'shared by both utilities', 'shared by both utilities')}" if joint_zones else "")
            + f", putting about {say_int(people)} electricity-dependent residents first."
        )
    aid = mutual_aid_sentence(d.mutual_aid)
    if aid:
        fix.append(aid)
    fix.append("Two neighbors, one plan.")
    texts.append(" ".join(fix))

    return [
        Clip(id=f"story-{i + 1}", kind="story", title=STORY_TITLES[i], text=t).finalize()
        for i, t in enumerate(texts)
    ]


def flight_clip(d: Data) -> Clip | None:
    if not d.overlaps:
        return None
    top = d.overlaps[0]
    desc = d.projects.get(top["descId"], {})
    gpc = d.projects.get(top["gpcId"], {})
    place = overlap_place(top.get("summary", ""))
    dist = float(top.get("distanceKm") or 0)
    parts = [f"This is the number one match{f', near {place}' if place else ''}."]
    parts.append(f"In teal, DESC's {spoken_name(desc.get('name', 'project'))}.")
    parts.append(f"In orange, Georgia Power's {spoken_name(gpc.get('name', 'project'))}.")
    if dist <= 0.05:
        parts.append("Here the two projects touch, so their outages have to be planned together.")
    else:
        parts.append(f"At the closest point they are only {dist:.1f} kilometers apart.")
    share = [s for s in top.get("shareable", []) if s][:4]
    if share:
        parts.append(f"They could share {say_list(share)}.")
    yard = top.get("stagingYard")
    if yard:
        mins = max(float(yard.get("driveMinutesDesc", 0)), float(yard.get("driveMinutesGpc", 0)))
        reach = f"within {round(mins)} minutes' drive of both jobs" if mins >= 1 else "right beside both jobs"
        parts.append(f"One staging yard, {reach}, would serve both crews.")
    months = round(float(top.get("timelineOverlapMonths") or 0))
    if months > 0:
        parts.append(f"And for about {months} months, both crews are due to be here at the same time.")
    return Clip(id="flight-1", kind="flight", title="Corridor fly-through", text=" ".join(parts)).finalize()


def briefing_clip(d: Data) -> Clip | None:
    storm = d.storm
    if not storm or not d.counties:
        return None
    name = storm.get("name", storm["id"].title())

    def top_counties(state: str, n: int = 3) -> list[dict[str, Any]]:
        rows = [c for c in d.counties if c.get("state") == state and c.get("predictedPeakOut", 0) > 0]
        return sorted(rows, key=lambda c: c["predictedPeakOut"], reverse=True)[:n]

    ga, sc = top_counties("GA"), top_counties("SC")
    ga_out = sum(c.get("predictedPeakOut", 0) for c in d.counties if c.get("state") == "GA")
    sc_out = sum(c.get("predictedPeakOut", 0) for c in d.counties if c.get("state") == "SC")
    seg = {"GPC": 0.0, "DESC": 0.0}
    for z in d.zones:
        utils = z.get("utilities", [])
        for u in utils:
            if u in seg:
                seg[u] += float(z.get("expectedDamagedSegments", 0)) / max(len(utils), 1)

    parts = [f"Storm crew briefing for Hurricane {name}. Here is where to expect damage, and where to start."]
    if ga:
        parts.append(
            f"On the Georgia side, the heaviest outages are expected in {say_list([county_label(c) for c in ga])}, "
            f"with about {say_int(ga_out)} customers out across Georgia at the peak."
        )
    if sc:
        parts.append(
            f"On the South Carolina side, watch {say_list([county_label(c) for c in sc])}, "
            f"with about {say_int(sc_out)} customers out statewide."
        )
    if seg["GPC"] or seg["DESC"]:
        parts.append(
            f"The simulation expects roughly {say_about(seg['GPC'])} damaged transmission sections on "
            f"Georgia Power's system and {say_about(seg['DESC'])} on DESC's."
        )
    if d.yards:
        yard_bits = []
        for y in d.yards[:3]:
            yard_bits.append(
                f"{say_place(y.get('label', 'a shared yard'))}, which reaches "
                f"{say_count(len(y.get('serves', [])), 'repair zone')} within "
                f"{round(float(y.get('maxDriveMinutes', 0)))} minutes"
            )
        parts.append(f"Both utilities stage jointly at {say_list(yard_bits)}.")
    else:
        parts.append(
            "No single yard reaches both sides quickly for this storm, "
            "so each utility stages on its own side and shares updates."
        )

    ordered = [z for z in sorted(d.zones, key=lambda z: z.get("priority", 1e9)) if z.get("vulnerablePeople", 0) > 0]
    named: list[str] = []
    for z in ordered[:3]:
        c = nearest_county(z.get("centroid", [0, 0]), d.counties)
        if c and county_label(c) not in named:
            named.append(county_label(c))
    if ordered and named:
        rest = f", then {say_list(named[1:])}" if len(named) > 1 else ""
        parts.append(
            f"Vulnerable areas first. Start near {named[0]}, where about "
            f"{say_about(ordered[0].get('vulnerablePeople', 0))} residents rely on powered medical equipment{rest}."
        )
    aid = mutual_aid_sentence(d.mutual_aid)
    if aid:
        parts.append(aid)
    parts.append(f"Check the {PRODUCT} map for live zone order. Stay safe out there.")
    return Clip(id=f"briefing-{storm['id']}", kind="briefing", title=f"Storm crew briefing: {name}",
                text=" ".join(parts)).finalize()


def build_clips(root: Path | None, storm_id: str | None = None) -> tuple[list[Clip], Data]:
    d = load_data(root, storm_id)
    clips = story_clips(d)
    for extra in (flight_clip(d), briefing_clip(d)):
        if extra:
            clips.append(extra)
    return clips, d


# ---------------------------------------------------------------- ElevenLabs


class ElevenLabs:
    def __init__(self, api_key: str, voice_id: str | None = None, model_id: str | None = None):
        self.api_key = api_key
        self.voice_id = voice_id or DEFAULT_VOICE_ID
        self.model_id = model_id or DEFAULT_MODEL_ID
        self.session = requests.Session()

    @classmethod
    def from_env(cls) -> "ElevenLabs | None":
        key = env("ELEVENLABS_API_KEY")
        if not key:
            return None
        return cls(key, env("ELEVENLABS_VOICE_ID"), env("ELEVENLABS_MODEL_ID"))

    def synthesize(self, text: str, previous_text: str | None = None, next_text: str | None = None) -> bytes:
        body: dict[str, Any] = {
            "text": text,
            "model_id": self.model_id,
            # Calm, steady narration.
            "voice_settings": {"stability": 0.55, "similarity_boost": 0.75, "style": 0.1, "use_speaker_boost": True},
        }
        if previous_text:
            body["previous_text"] = previous_text
        if next_text:
            body["next_text"] = next_text
        resp = self.session.post(
            ELEVENLABS_URL.format(voice_id=self.voice_id),
            params={"output_format": OUTPUT_FORMAT},
            headers={"xi-api-key": self.api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
            json=body,
            timeout=120,
        )
        if resp.status_code != 200:
            detail = resp.text[:300].replace(self.api_key, "***")
            raise RuntimeError(f"ElevenLabs responded {resp.status_code}: {detail}")
        return resp.content


def mp3_duration_ms(data: bytes) -> int:
    """Constant-bitrate estimate (the API returns 128 kbps CBR MP3)."""
    return int(len(data) * 8 / BITRATE_KBPS)

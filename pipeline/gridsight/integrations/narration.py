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
DIALOGUE_URL = "https://api.elevenlabs.io/v1/text-to-dialogue"
SFX_URL = "https://api.elevenlabs.io/v1/sound-generation"
DIALOGUE_MODEL_ID = "eleven_v3"
# A stock narrator voice from the ElevenLabs premade library ("George": warm, calm).
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
# Two distinct stock voices for the coordination call (override with ELEVENLABS_VOICE_DESC / _GPC).
CALL_VOICE_DESC = "XrExE9yKIg1WjnnlVkGX"  # "Matilda": professional, American
CALL_VOICE_GPC = "iP95p4xoKVk53GoZ742B"  # "Chris": down-to-earth, American
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
    lang: str = "en"
    # For translations: hash of the source text they were made from.
    sourceHash: str | None = None

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
    track: dict[str, Any] | None = None  # storm.json of the storm
    response_meta: dict[str, Any] | None = None


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
    track = None
    response_meta = None
    if storm:
        sid = storm["id"]
        track = get(f"response/{sid}/storm.json")
        response_meta = get(f"response/{sid}/meta.json")
        counties = get(f"response/{sid}/counties.json") or []
        zones = get(f"response/{sid}/zones.json") or []
        yards = get(f"response/{sid}/yards.json") or []
        vulnerable = get(f"response/{sid}/vulnerable.json") or []
        for rel in (f"response/{sid}/mutual-aid.json", "response/mutual-aid.json", "plan/insights/mutual-aid.json"):
            mutual_aid, _ = read_json(rel, root, fixtures=False)
            if mutual_aid is not None:
                origins[rel] = "pipeline"
                break
    return Data(meta, projects, overlaps, cost_ranges, storm, counties, zones, yards, vulnerable, mutual_aid, origins,
                track, response_meta)


def hours_saved(mutual_aid: Any) -> dict[str, float] | None:
    """savedHours from mutual-aid.json (or the difference of the two scenarios)."""
    if not isinstance(mutual_aid, dict):
        return None
    saved = mutual_aid.get("savedHours")
    if isinstance(saved, dict) and saved.get("to90pct") is not None:
        return {k: float(v) for k, v in saved.items() if isinstance(v, (int, float))}
    sc = mutual_aid.get("scenarios") or {}
    a, b = sc.get("separate"), sc.get("coordinated")
    if isinstance(a, dict) and isinstance(b, dict) and a.get("hoursTo90pct") is not None:
        return {"to90pct": float(a["hoursTo90pct"]) - float(b["hoursTo90pct"]),
                "vulnerableTo90pct": float(a.get("vulnerableHoursTo90pct", 0)) - float(b.get("vulnerableHoursTo90pct", 0))}
    return None


def say_hours(h: float) -> str:
    """Matches the app's fmtHoursNumber: one decimal under 10, whole hours above."""
    return f"{h:.1f}" if abs(h) < 10 else f"{round(h)}"


def mutual_aid_sentence(mutual_aid: Any, short: bool = False) -> str | None:
    """One line about restoring power together, from mutual-aid.json."""
    saved = hours_saved(mutual_aid)
    if saved and saved.get("to90pct", 0) > 0:
        line = f"Working together, power comes back about {say_hours(saved['to90pct'])} hours sooner"
        vul = saved.get("vulnerableTo90pct", 0)
        if vul > 0 and not short:
            line += f", and {say_hours(vul)} hours sooner for people who rely on powered medical equipment"
        return line + "."
    candidates: list[Any] = []
    if isinstance(mutual_aid, dict):
        candidates = [mutual_aid.get(k) for k in ("narration", "headline", "summary")]
    for c in candidates:
        if isinstance(c, str) and 10 < len(c) < 300:
            return c.strip().rstrip(".") + "."
    return None


def hours_of_warning(d: "Data") -> int | None:
    """Hours between replayStart and the storm's closest pass to the top repair zone (as the app computes)."""
    from datetime import datetime

    track = (d.track or {}).get("track") or []
    start = (d.track or {}).get("replayStart")
    zones = sorted(d.zones, key=lambda z: z.get("priority", 1e9))
    if len(track) < 2 or not start or not zones:
        return None

    def ts(s: str) -> float:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()

    times = [ts(p["time"]) for p in track]
    target = zones[0]["centroid"]
    best, when = float("inf"), times[0]
    t = times[0]
    step = 15 * 60
    i = 1
    while t <= times[-1]:
        while i < len(times) - 1 and t > times[i]:
            i += 1
        k = (t - times[i - 1]) / ((times[i] - times[i - 1]) or 1)
        a, b = track[i - 1]["position"], track[i]["position"]
        pos = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
        dist = _km(pos, target)
        if dist < best:
            best, when = dist, t
        t += step
    h = round((when - ts(start)) / 3600)
    return h if h > 0 else None


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
    """One or two calm sentences per chapter, echoing the on-screen captions (src/components/story/chapters.ts)."""
    n_desc = sum(1 for p in d.projects.values() if p.get("utility") == "DESC")
    n_gpc = sum(1 for p in d.projects.values() if p.get("utility") == "GPC")
    meta = d.meta or {}
    pairs = int(meta.get("pairsCompared") or n_desc * n_gpc)
    found = len(d.overlaps)
    touching = sum(1 for o in d.overlaps if o.get("tier") == "crossing")
    top = d.overlaps[0] if d.overlaps else None

    texts: list[str] = []
    texts.append(
        "Two power companies share a river, but plan their work without seeing each other. "
        "The Savannah River is the border: Georgia Power builds on the Georgia side, "
        "Dominion Energy on the South Carolina side."
    )
    texts.append(
        f"Dominion plans {n_desc} jobs. Georgia Power plans {n_gpc}. Nobody lines them up. "
        f"{PRODUCT} put every one of them on one map, from their public filings."
    )
    touch = f" {say_count(touching, 'of them touches', 'of them touch').capitalize()} outright." if touching else ""
    texts.append(
        f"Of {pairs:,} possible pairs, only {found} are within a crew's morning drive, forty kilometers.{touch}"
    )
    if top:
        desc = d.projects.get(top["descId"], {})
        gpc = d.projects.get(top["gpcId"], {})
        km = float(top.get("distanceKm") or 0)
        km_s = f"{km:.1f}" if km < 10 else f"{round(km)}"
        lead = {
            "crossing": "These two jobs touch. One crew, one yard, one permit instead of two.",
            "row": f"These two jobs run {km_s} kilometers apart. They could share land and permits.",
            "logistics": f"These two jobs are {km_s} kilometers apart. They could share a yard and deliveries.",
        }.get(top.get("tier"), f"These two jobs are {km_s} kilometers apart. They could share crews and equipment.")
        months = round(float(top.get("timelineOverlapMonths") or 0))
        both = f" Both are under construction at the same time for about {months} months." if months > 0 else ""
        texts.append(
            f"{lead} Dominion's {spoken_name(desc.get('name', 'project'))}, "
            f"and Georgia Power's {spoken_name(gpc.get('name', 'project'))}.{both}"
        )
    else:
        texts.append("The best match is where both companies plan work in the same place at the same time.")

    central = sum((d.cost_ranges.get(o["id"], {}).get("centralUsd") or (o.get("cost") or {}).get("totalUsd") or 0)
                  for o in d.overlaps)
    low = sum(d.cost_ranges.get(o["id"], {}).get("lowUsd", 0) for o in d.overlaps)
    high = sum(d.cost_ranges.get(o["id"], {}).get("highUsd", 0) for o in d.overlaps)
    if central > 0:
        rng = f", somewhere between {say_usd(low)} and {say_usd(high)}" if d.cost_ranges and low and high else ""
        texts.append(
            f"What working together could save: roughly {say_usd(central)} across all {found} matches{rng}. "
            "It is an estimate. Georgia Power does not publish its project costs, so real savings could be higher."
        )
    else:
        texts.append("What working together could save: fewer trips, less new land, and fewer outages.")

    storm = d.storm or {}
    name = storm.get("name", "the storm")
    lead_h = hours_of_warning(d)
    rm = d.response_meta or {}
    sims = rm.get("simulations")
    before = f"About {lead_h} hours before" if lead_h else "Before"
    line6 = (f"{before} Hurricane {name} arrived, {PRODUCT} predicted where lines would break for both companies, "
             "and compared it with what happened.")
    if sims:
        line6 += f" It simulated the storm {int(sims):,} times, with physics."
    texts.append(line6)

    fix = []
    aid = mutual_aid_sentence(d.mutual_aid)
    if aid:
        fix.append(aid)
        fix.append("Shared staging yards and crews go to the nearest repair zone first, whichever company owns it.")
    elif d.yards:
        labels = say_list([say_place(y.get("label", "")) for y in d.yards[:2]])
        fix.append(f"{say_count(len(d.yards), 'shared staging yard').capitalize()}, at {labels}, "
                   "can serve crews from both companies.")
        fix.append("Numbered repair zones show where crews should go first.")
    else:
        fix.append("Shared staging yards let crews from both companies start closer to the damage.")
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

    parts = [f"Storm crew briefing for Hurricane {name}."]
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
        gpc = f"roughly {say_about(seg['GPC'])}" if round(seg["GPC"]) else "no"
        desc = say_about(seg["DESC"]) if round(seg["DESC"]) else "none"
        parts.append(
            f"The simulation expects {gpc} damaged transmission sections on "
            f"Georgia Power's system and {desc} on DESC's."
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
    aid = mutual_aid_sentence(d.mutual_aid, short=True)
    if aid:
        parts.append(aid)
    parts.append(f"Zone order is live on the {PRODUCT} map. Stay safe.")
    return Clip(id=f"briefing-{storm['id']}", kind="briefing", title=f"Storm crew briefing: {name}",
                text=" ".join(parts)).finalize()


def build_clips(root: Path | None, storm_id: str | None = None) -> tuple[list[Clip], Data]:
    d = load_data(root, storm_id)
    clips = story_clips(d)
    for extra in (flight_clip(d), briefing_clip(d)):
        if extra:
            clips.append(extra)
    # Without --storm, every storm in storms.json gets its own briefing (featured one first).
    if not storm_id:
        storms, _ = read_json("response/storms.json", root)
        for s in storms or []:
            if d.storm and s.get("id") == d.storm["id"]:
                continue
            extra = briefing_clip(load_data(root, s["id"]))
            if extra:
                clips.append(extra)
    clips.extend(sfx_clips())
    return clips, d


# Sound effects (ElevenLabs Sound Effects API). Short, quiet UI accents.
SFX = [
    ("sfx-spark", "Spark", "a single subtle electric spark crackle, short and clean, close up, no music", 1.2),
    ("sfx-hum", "Grid hum", "a soft low electrical substation hum, steady and calm, seamless loop, no music", 6.0),
]


def sfx_clips() -> list[Clip]:
    return [Clip(id=i, kind="sfx", title=t, text=prompt, durationMs=int(sec * 1000)).finalize() for i, t, prompt, sec in SFX]


def sfx_seconds(clip: Clip) -> float:
    return next((sec for i, _, _, sec in SFX if i == clip.id), clip.durationMs / 1000)


TRANSLATE_SYSTEM = (
    "You translate storm briefings for Spanish-speaking utility line crews in Georgia and South Carolina. "
    "Write natural, calm, spoken Latin American Spanish. Keep every number, county name, place name, company "
    "name and the product name MrGridy exactly as given. Do not add or drop any fact."
)


def spanish_clip(english: Clip, previous: dict[str, Any] | None) -> Clip | None:
    """Spanish version of a briefing. Reuses the previous translation while the English text is unchanged."""
    cid = f"{english.id}-es"
    if previous and previous.get("sourceHash") == english.hash and previous.get("text"):
        clip = Clip(id=cid, kind="briefing", title=f"{english.title} (español)", text=previous["text"], lang="es")
        clip.sourceHash = english.hash
        return clip.finalize()
    from gridsight.integrations.gemini import generate_json

    try:
        out, _ = generate_json(
            f"Translate this storm crew briefing into Spanish:\n\n{english.text}",
            {"type": "OBJECT", "properties": {"text": {"type": "STRING"}}, "required": ["text"]},
            system=TRANSLATE_SYSTEM,
            temperature=0.2,
        )
    except Exception as exc:
        print(f"note: Spanish briefing skipped ({exc})")
        return None
    text = str(out.get("text", "")).strip()
    if not text:
        return None
    clip = Clip(id=cid, kind="briefing", title=f"{english.title} (español)", text=text, lang="es")
    clip.sourceHash = english.hash
    return clip.finalize()


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

    def synthesize(self, text: str, previous_text: str | None = None, next_text: str | None = None,
                   speed: float = 1.0) -> bytes:
        body: dict[str, Any] = {
            "text": text,
            "model_id": self.model_id,
            # Calm, steady narration.
            "voice_settings": {"stability": 0.55, "similarity_boost": 0.75, "style": 0.1, "use_speaker_boost": True,
                               "speed": speed},
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
        return self._audio(resp)

    def _audio(self, resp: requests.Response) -> bytes:
        if resp.status_code in (401, 403):
            detail = resp.text[:300].replace(self.api_key, "***")
            raise ElevenLabsPermissionError(f"ElevenLabs responded {resp.status_code}: {detail}")
        if resp.status_code != 200:
            detail = resp.text[:300].replace(self.api_key, "***")
            raise RuntimeError(f"ElevenLabs responded {resp.status_code}: {detail}")
        return resp.content

    def dialogue(self, lines: list[tuple[str, str]], model_id: str = DIALOGUE_MODEL_ID) -> bytes:
        """Text to Dialogue: one MP3 with several voices. `lines` = [(text, voice_id)]."""
        resp = self.session.post(
            DIALOGUE_URL,
            params={"output_format": OUTPUT_FORMAT},
            headers={"xi-api-key": self.api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
            json={"inputs": [{"text": t, "voice_id": v} for t, v in lines], "model_id": model_id},
            timeout=240,
        )
        return self._audio(resp)

    def dialogue_or_stitch(self, lines: list[tuple[str, str]]) -> tuple[bytes, str]:
        """Prefer Text to Dialogue; fall back to per-line TTS joined into one MP3 stream."""
        try:
            return self.dialogue(lines), "text-to-dialogue"
        except ElevenLabsPermissionError:
            raise
        except Exception as exc:
            print(f"note: text-to-dialogue failed ({exc}); stitching per-line speech")
        chunks = []
        for text, voice in lines:
            saved = self.voice_id
            self.voice_id = voice
            try:
                chunks.append(self.synthesize(text))
            finally:
                self.voice_id = saved
        return b"".join(chunks), "text-to-speech"

    def sound_effect(self, text: str, seconds: float, influence: float = 0.5) -> bytes:
        resp = self.session.post(
            SFX_URL,
            params={"output_format": OUTPUT_FORMAT},
            headers={"xi-api-key": self.api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
            json={"text": text, "duration_seconds": seconds, "prompt_influence": influence},
            timeout=120,
        )
        return self._audio(resp)


class ElevenLabsPermissionError(RuntimeError):
    """The key is valid but lacks a permission (e.g. sound_generation)."""


def mp3_duration_ms(data: bytes) -> int:
    """Constant-bitrate estimate (the API returns 128 kbps CBR MP3)."""
    return int(len(data) * 8 / BITRATE_KBPS)

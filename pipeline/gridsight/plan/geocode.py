"""Locate project places (substations, plants, switching stations) with OpenStreetMap.

Method
------
1. Gazetteer: every named power=substation / power=plant / named power=switch in
   the study area (plus Alabama and Mississippi, only so that Southern Company
   projects can be told apart from Georgia Power ones), each tagged with its US
   state from the Census 2023 cartographic state boundaries.
2. Names are normalised (lower case; drop "kV", "Sub", "Substation", "Switching
   Station", "Tie", "Primary", "#1", voltages, ...) and compared with rapidfuzz.
   Exact normalised matches score 100, a name contained in a longer OSM name
   scores 92, otherwise fuzz.ratio.
3. Candidates in the project's home state (SC for DESC, GA for Georgia Power)
   are preferred; a neighbouring state costs STATE_PENALTY points, which still
   lets cross-border ties (Okatie - McIntosh, McIntosh - Purrysburg) resolve.
4. Ambiguous names are resolved jointly per project: line endpoints must be a
   plausible distance apart given the stated miles, and projects tagged "SAV"
   in the SERTP reports (Georgia Power's Savannah area) prefer candidates near
   Savannah (two Georgia substations are named Goshen).
5. If no power site matches, an exactly named USGS GNIS "Populated Place" in the
   home state is used as a place-level location with low confidence
   (substations are usually named after the community they serve).

Location confidence (0..1) is assigned in geometry.py from how each place was
matched; unlocated projects keep confidence <= 0.2 and are excluded from
overlap scoring.
"""

from __future__ import annotations

import math
import re
import zipfile
from dataclasses import dataclass, field
from functools import lru_cache
from statistics import median

import geopandas as gpd
from rapidfuzz import fuzz
from shapely.geometry import Point

from gridsight import osm
from gridsight.config import BBOX, RAW_DIR

# Alabama/Mississippi/Georgia box, used only to check whether a SOCO name is in Georgia.
SOCO_BBOX = (-89.6, 30.1, -80.8, 35.1)
STATE_FIPS = {"13": "GA", "45": "SC", "01": "AL", "28": "MS", "12": "FL", "37": "NC", "47": "TN"}
STATE_PENALTY = 8.0
MIN_SCORE = 87.0
# A site in a neighbouring state is only a candidate within this distance of the
# home state (cross-border ties such as Okatie - McIntosh end just across the river).
BORDER_KM = 25.0

# Name aliases: abbreviations used in the filings -> the name OSM uses. Names only,
# never coordinates.
ALIASES = {
    "vcs1": "virgil c summer",
    "vcs2": "virgil c summer",
    "v c summer": "virgil c summer",
    "belv": "belvedere",
    "wadley pri": "wadley",
    "n dublin": "north dublin",
    "s griffin": "south griffin",
    "e walton": "east walton",
    "plant yates": "yates",
    "purrysburg": "purysburgh",  # GNIS spelling (feature 1253483)
}

DROP_TOKENS = {
    "kv", "sub", "substation", "switching", "switchyard", "station", "sw", "sta", "ss", "ts", "tie",
    "primary", "pri", "the", "transmission", "trans", "distribution", "dist", "electric", "generating",
    "facility", "plant", "power", "steam", "nuclear", "customer", "sav", "apc", "usa", "fpl", "gpc",
    "tap", "point", "delivery", "hydroelectric", "project", "energy", "center",
}
EXPAND = {"n": "north", "s": "south", "e": "east", "w": "west", "jct": "junction", "rd": "road",
          "mt": "mount", "ft": "fort", "st": "saint", "ave": "avenue", "hwy": "highway", "co": "county"}


def normalize(name: str) -> str:
    s = name.lower().strip()
    s = ALIASES.get(re.sub(r"[^a-z0-9 ]", "", s), s)
    s = re.sub(r"\(.*?\)", " ", s)
    s = s.replace("&", " and ").replace("’", "'")
    s = re.sub(r"#\s*\d+\w*", " ", s)
    s = re.sub(r"\b\d+(\.\d+)?\s*(kv|mva|mw)?\b", " ", s)
    s = re.sub(r"[^a-z' ]+", " ", s).replace("'", "")
    raw = s.split()
    # "St George" -> saint george; "Fenwick St" -> fenwick street
    toks = [("saint" if k == 0 else "street") if t == "st" else EXPAND.get(t, t) for k, t in enumerate(raw)]
    toks = [t for t in toks if t not in DROP_TOKENS]
    out = " ".join(toks).strip()
    return ALIASES.get(out, out)


@dataclass
class Site:
    osm: str
    names: list[str]
    norms: list[str]
    lon: float
    lat: float
    kind: str  # substation | plant | switch | place:*
    state: str | None
    voltage: str = ""
    operator: str = ""


@dataclass
class Match:
    place: str
    site: Site
    score: float
    method: str  # "site" | "settlement" | "county"


@dataclass
class Located:
    """Result for one project: matched places in route order + all candidates considered."""
    matches: list[Match] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)


def _states_frame() -> gpd.GeoDataFrame:
    z = RAW_DIR / "cb_2023_us_state_500k.zip"
    gdf = gpd.read_file(f"zip://{z}")
    return gdf[gdf["STATEFP"].isin(STATE_FIPS)][["STATEFP", "geometry"]].to_crs("EPSG:4326")


def _assign_states(sites: list[dict]) -> list[str | None]:
    states = _states_frame()
    pts = gpd.GeoDataFrame(geometry=[Point(s["lon"], s["lat"]) for s in sites], crs="EPSG:4326")
    joined = gpd.sjoin(pts, states, how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]
    return [STATE_FIPS.get(f) if isinstance(f, str) else None for f in joined["STATEFP"]]


def county_point(county: str, state: str) -> tuple[float, float, float] | None:
    """Census 2023 Gazetteer internal point (lon, lat) and equivalent radius km of a county."""
    z = RAW_DIR / "2023_Gaz_counties_national.zip"
    with zipfile.ZipFile(z) as f:
        text = f.read(f.namelist()[0]).decode("utf-8", "replace")
    for line in text.splitlines()[1:]:
        cols = [c.strip() for c in line.split("\t")]
        if cols[0] == state and cols[3].lower() == f"{county.lower()} county":
            area_km2 = float(cols[4]) / 1e6
            return float(cols[9]), float(cols[8]), math.sqrt(area_km2 / math.pi)
    return None


def gnis_places() -> list[dict]:
    """USGS GNIS Domestic Names (Populated Place, Crossing) for SC and GA."""
    out = []
    for st in ("SC", "GA"):
        z = RAW_DIR / f"DomesticNames_{st}_Text.zip"
        if not z.exists():
            continue
        with zipfile.ZipFile(z) as f:
            member = next(n for n in f.namelist() if n.endswith(".txt"))
            lines = f.read(member).decode("utf-8-sig", "replace").splitlines()
        for line in lines[1:]:
            c = line.split("|")
            if len(c) < 17 or c[2] not in ("Populated Place", "Crossing") or c[4] not in ("45", "13"):
                continue
            out.append({"osm": f"gnis/{c[0]}", "names": [c[1]], "lon": float(c[16]), "lat": float(c[15]),
                        "kind": "place:gnis", "state": "SC" if c[4] == "45" else "GA"})
    return out


class Gazetteer:
    def __init__(self) -> None:
        raw = {s["osm"]: s for s in osm.power_sites(BBOX)}
        for s in osm.power_sites(SOCO_BBOX):
            raw.setdefault(s["osm"], s)
        sites = [s for s in raw.values() if s["names"]]
        places = osm.settlements(BBOX)
        states = _assign_states(sites + places)
        self.sites: list[Site] = []
        self.places: list[Site] = []
        for s, st in zip(sites + places, states):
            site = Site(
                osm=s["osm"],
                names=s["names"],
                norms=[normalize(n) for n in s["names"]],
                lon=s["lon"],
                lat=s["lat"],
                kind=s["kind"],
                state=st,
                voltage=s.get("voltage", ""),
                operator=s.get("operator", ""),
            )
            (self.places if s["kind"].startswith("place:") else self.sites).append(site)
        self.gnis = [
            Site(osm=g["osm"], names=g["names"], norms=[normalize(g["names"][0])], lon=g["lon"], lat=g["lat"],
                 kind=g["kind"], state=g["state"])
            for g in gnis_places()
        ]
        # distance (km) from each site to GA and SC, for the neighbouring-state rule
        states = _states_frame().to_crs("EPSG:32617")
        polys = {STATE_FIPS[f]: g for f, g in zip(states["STATEFP"], states.geometry)}
        pts = gpd.GeoSeries([Point(s.lon, s.lat) for s in self.sites], crs="EPSG:4326").to_crs("EPSG:32617")
        self.border_km: dict[str, dict[str, float]] = {}
        for st in ("GA", "SC"):
            d = pts.distance(polys[st]) / 1000.0
            for site, dk in zip(self.sites, d):
                self.border_km.setdefault(site.osm, {})[st] = float(dk)
        self._index: dict[str, list[Site]] = {}
        for site in self.sites:
            for n in site.norms:
                for tok in n.split():
                    self._index.setdefault(tok, []).append(site)

    @lru_cache(maxsize=None)
    def candidates(self, name: str, home: str, allowed: tuple[str, ...]) -> list[tuple[float, Site]]:
        q = normalize(name)
        if not q:
            return []
        pool: dict[str, Site] = {}
        for tok in q.split():
            for s in self._index.get(tok, []):
                pool[s.osm] = s
        if len(q.split()) == 1 or not pool:
            # fuzzy fallback over everything sharing the first 3 letters
            for s in self.sites:
                if any(n[:3] == q[:3] for n in s.norms):
                    pool[s.osm] = s
        out: list[tuple[float, Site]] = []
        for s in pool.values():
            if s.state not in allowed:
                continue
            if home and s.state != home and self.border_km.get(s.osm, {}).get(home, 0.0) > BORDER_KM:
                continue
            best = 0.0
            for n in s.norms:
                if not n:
                    continue
                if n == q:
                    sc = 100.0
                elif re.search(rf"(^| ){re.escape(q)}( |$)", n) and not re.match(r"(north|south|east|west|new|old|little|big) ", n):
                    sc = 92.0  # 'mcintosh' inside 'mcintosh combined cycle'
                else:
                    sc = float(fuzz.ratio(q, n))
                best = max(best, sc)
            if home and s.state != home:
                best -= STATE_PENALTY
            if best >= MIN_SCORE - STATE_PENALTY:
                out.append((best, s))
        out.sort(key=lambda x: (-x[0], _kind_rank(x[1].kind)))
        return out[:8]

    def settlement(self, name: str, home: str, near: tuple[float, float] | None = None) -> Site | None:
        q = normalize(name)
        hits = [p for p in self.gnis if p.state == home and q and q in p.norms]
        if near and hits:
            hits.sort(key=lambda p: km(p, near))
        return hits[0] if hits and (len(hits) == 1 or near) else None


def _kind_rank(kind: str) -> int:
    return {"substation": 0, "switch": 1, "plant": 2}.get(kind, 3)


def km(a: Site | tuple[float, float], b: Site | tuple[float, float]) -> float:
    (x1, y1) = (a.lon, a.lat) if isinstance(a, Site) else a
    (x2, y2) = (b.lon, b.lat) if isinstance(b, Site) else b
    kx = 111.32 * math.cos(math.radians((y1 + y2) / 2))
    return math.hypot((x1 - x2) * kx, (y1 - y2) * 110.57)


def locate(
    gaz: Gazetteer,
    places: list[str],
    *,
    home: str,
    allowed: tuple[str, ...],
    miles: float | None,
    zone_center: tuple[float, float] | None = None,
) -> Located:
    """Pick one site per place, jointly, so a line's ends are a plausible distance apart."""
    res = Located()
    cands = []
    for p in places:
        c = [(sc, s) for sc, s in gaz.candidates(p, home, allowed) if sc >= MIN_SCORE - STATE_PENALTY]
        cands.append(c[:5])

    def prior(site: Site) -> float:
        if zone_center is None:
            return 0.0
        d = km(site, zone_center)
        return -max(0.0, d - 60.0) * 0.15  # soft pull towards the tagged region

    chosen: list[tuple[float, Site] | None] = [None] * len(places)
    located_idx = [i for i, c in enumerate(cands) if c]
    if len(located_idx) >= 2:
        # Joint choice over the first two locatable places (line ends); others greedily.
        i, j = located_idx[0], located_idx[1]
        limit = (miles * 1.609 * 1.6 + 15.0) if miles else 100.0
        best = None
        for sa, a in cands[i]:
            for sb, b in cands[j]:
                if a.osm == b.osm:
                    continue
                d = km(a, b)
                pen = 0.0 if d <= limit else (d - limit) * 0.8
                val = sa + sb + prior(a) + prior(b) - pen
                if best is None or val > best[0]:
                    best = (val, (sa, a), (sb, b))
        if best:
            chosen[i], chosen[j] = best[1], best[2]
            if km(best[1][1], best[2][1]) > 1.5 * limit:
                # no plausible pair: keep the better-scored end only
                if best[1][0] >= best[2][0]:
                    chosen[j] = None
                else:
                    chosen[i] = None
        anchor = chosen[i][1] if chosen[i] else (chosen[j][1] if chosen[j] else None)
        for k in located_idx[2:]:
            pick = max(cands[k], key=lambda t: t[0] + (-km(t[1], anchor) * 0.1 if anchor else 0) + prior(t[1]))
            # a third site far from the other two is a same-named place elsewhere
            chosen[k] = pick if anchor is None or km(pick[1], anchor) <= limit else None
    elif len(located_idx) == 1:
        k = located_idx[0]
        chosen[k] = max(cands[k], key=lambda t: t[0] + prior(t[1]) - _kind_rank(t[1].kind) * 0.5)

    anchor_site = next((c[1] for c in chosen if c), None)
    anchor = (anchor_site.lon, anchor_site.lat) if anchor_site else zone_center
    for p, ch in zip(places, chosen):
        if ch and ch[0] >= MIN_SCORE - STATE_PENALTY:
            res.matches.append(Match(p, ch[1], ch[0], "site"))
            continue
        st = gaz.settlement(p, home or "GA", anchor)
        if st and anchor_site and km(st, anchor_site) > ((miles or 60) * 1.609 * 1.6 + 15):
            st = None  # a same-named community far away from the other end
        elif st and not anchor_site and zone_center and km(st, zone_center) > 120:
            st = None  # far outside the tagged region
        if st:
            res.matches.append(Match(p, st, 70.0, "settlement"))
        else:
            res.unmatched.append(p)
    return res


def region_centers(gaz: Gazetteer) -> dict[str, tuple[float, float]]:
    """Centre points for region tags printed in the filings: SAV = Savannah, GA (USGS GNIS)."""
    out = {}
    for tag, name in (("SAV", "savannah"),):
        hits = [p for p in gaz.gnis if p.state == "GA" and name in p.norms]
        if hits:
            out[tag] = (hits[0].lon, hits[0].lat)
    return out

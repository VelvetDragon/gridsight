"""Project geometry: points for substations, traced or straight lines for lines.

Tracing: every OSM power=line way becomes edges of a graph (shared OSM node ids
join ways). OSM lines usually stop at a substation fence without sharing a node
with the next line, so each named power site gets a virtual hub connected to all
line endpoints within HUB_RADIUS_M (named or unnamed substations, plants), and
line ends within JOIN_RADIUS_M of another line's vertex are joined. A line project between two located sites is
the shortest path between their hubs; it is accepted as "traced" when its
length is within 0.6-1.8x the stated miles (or <= 1.8x the straight distance
when no miles are given). Otherwise the project is a straight "straight" line.

Uncertainty radius (km) per geometry, used for the robustness re-test in
overlap.py:
  traced line / exact site point ...... 0      (we trust the OSM geometry)
  straight line ....................... clamp(0.15 x length, 1, 8)  (real routes
                                         bow away from the chord; 15% of length
                                         is a typical lateral detour)
  settlement-level point .............. 3
  line known only at one end .......... min(stated length, 25), else 8
  county-level point .................. equivalent county radius
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point

from gridsight import osm
from gridsight.config import GEO_CRS, METRIC_CRS
from gridsight.plan.geocode import Located

HUB_RADIUS_M = 600.0
JOIN_RADIUS_M = 150.0  # line ends this close to another line vertex are joined
SNAP_RADIUS_M = 2000.0
KM_PER_MILE = 1.609344

_to_m = Transformer.from_crs(GEO_CRS, METRIC_CRS, always_xy=True)
_to_ll = Transformer.from_crs(METRIC_CRS, GEO_CRS, always_xy=True)


def to_metric(lon, lat):
    return _to_m.transform(lon, lat)


def to_lonlat(x, y):
    return _to_ll.transform(x, y)


@dataclass
class _SiteRef:
    osm: str
    lon: float
    lat: float


@dataclass
class Built:
    geometry: dict  # GeoJSON (lon/lat)
    metric: object  # shapely geometry in METRIC_CRS
    quality: str  # traced | straight | point
    confidence: float
    radius_km: float
    note: str = ""


class LineNetwork:
    """Graph over OSM power lines with virtual hubs at named power sites."""

    def __init__(self, sites) -> None:
        """sites: objects or dicts with osm/lon/lat (all power sites, named or not)."""
        sites = [s if hasattr(s, "osm") else _SiteRef(s["osm"], s["lon"], s["lat"]) for s in sites]
        ways = osm.power_lines()
        self.ways = ways
        ids: dict[int, int] = {}
        xs: list[float] = []
        ys: list[float] = []
        rows: list[int] = []
        cols: list[int] = []
        wts: list[float] = []
        endpoints: list[int] = []

        def nid(key, x, y):
            if key not in ids:
                ids[key] = len(xs)
                xs.append(x)
                ys.append(y)
            return ids[key]

        for w in ways:
            coords = w["coords"]
            nodes = w.get("nodes") or [None] * len(coords)
            if len(nodes) != len(coords):
                nodes = [None] * len(coords)
            mx, my = to_metric([c[0] for c in coords], [c[1] for c in coords])
            prev = None
            for k, (x, y) in enumerate(zip(mx, my)):
                key = nodes[k] if nodes[k] is not None else ("w", w["id"], k)
                cur = nid(key, x, y)
                if prev is not None and prev != cur:
                    d = math.hypot(xs[cur] - xs[prev], ys[cur] - ys[prev])
                    rows += [prev, cur]
                    cols += [cur, prev]
                    wts += [d + 0.01, d + 0.01]
                prev = cur
                if k in (0, len(coords) - 1):
                    endpoints.append(cur)
        self.n_line_nodes = len(xs)
        self.xy = np.column_stack([xs, ys])
        self.tree = cKDTree(self.xy)
        ep = np.array(sorted(set(endpoints)))
        ep_tree = cKDTree(self.xy[ep])
        # Join dangling line ends to nearby vertices of other lines.
        for k, near in enumerate(self.tree.query_ball_point(self.xy[ep], JOIN_RADIUS_M)):
            a = int(ep[k])
            for b in near:
                if b != a:
                    d = math.hypot(self.xy[a, 0] - self.xy[b, 0], self.xy[a, 1] - self.xy[b, 1])
                    rows += [a, b]
                    cols += [b, a]
                    wts += [d + 1.0, d + 1.0]
        # Hubs
        self.hub_of: dict[str, int] = {}
        hub_xy = []
        for s in sites:
            sx, sy = to_metric(s.lon, s.lat)
            near = ep_tree.query_ball_point([sx, sy], HUB_RADIUS_M)
            if not near:
                continue
            h = self.n_line_nodes + len(hub_xy)
            hub_xy.append((sx, sy))
            self.hub_of[s.osm] = h
            for j in near:
                n = int(ep[j])
                d = math.hypot(self.xy[n, 0] - sx, self.xy[n, 1] - sy)
                rows += [h, n]
                cols += [n, h]
                wts += [d + 1.0, d + 1.0]
        n_total = self.n_line_nodes + len(hub_xy)
        if hub_xy:
            self.xy = np.vstack([self.xy, np.array(hub_xy)])
        self.graph = coo_matrix((wts, (rows, cols)), shape=(n_total, n_total)).tocsr()

    def _snap(self, site) -> int | None:
        if site.osm in self.hub_of:
            return self.hub_of[site.osm]
        sx, sy = to_metric(site.lon, site.lat)
        d, i = self.tree.query([sx, sy])
        return int(i) if d <= SNAP_RADIUS_M else None

    def trace(self, a, b, limit_m: float) -> tuple[list[tuple[float, float]], float] | None:
        """Shortest network path between two sites (metric coords, length m)."""
        s, t = self._snap(a), self._snap(b)
        if s is None or t is None or s == t:
            return None
        dist, pred = dijkstra(self.graph, indices=s, return_predecessors=True, limit=limit_m)
        if not np.isfinite(dist[t]):
            return None
        path = [t]
        while path[-1] != s:
            p = pred[path[-1]]
            if p < 0:
                return None
            path.append(int(p))
        path.reverse()
        pts = [tuple(self.xy[k]) for k in path]
        return pts, float(dist[t])


def _match_factor(m) -> float:
    if m.method == "settlement":
        return 0.5
    return max(0.3, min(1.0, (m.score - 80.0) / 20.0))


def _geo(geom) -> dict:
    if geom.geom_type == "Point":
        lon, lat = to_lonlat(geom.x, geom.y)
        return {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]}
    xs, ys = geom.xy
    lons, lats = to_lonlat(list(xs), list(ys))
    coords = []
    for lo, la in zip(lons, lats):
        c = [round(lo, 5), round(la, 5)]
        if not coords or coords[-1] != c:
            coords.append(c)
    return {"type": "LineString", "coordinates": coords}


def build(kind: str, miles: float | None, located: Located, net: LineNetwork | None,
          county: tuple[float, float, float] | None = None) -> Built | None:
    """Geometry for one project from its located places (in route order)."""
    ms = located.matches
    stated_km = miles * KM_PER_MILE if miles else None
    if not ms:
        if county:
            lon, lat, r = county
            x, y = to_metric(lon, lat)
            g = Point(x, y)
            return Built(_geo(g), g, "point", 0.3, r, "county-level location")
        return None
    pts = [to_metric(m.site.lon, m.site.lat) for m in ms]
    factor = min(_match_factor(m) for m in ms)
    if kind == "substation" or len(ms) == 1:
        g = Point(*pts[0])
        if kind == "line":
            # a line we can only anchor at one end
            r = min(stated_km, 25.0) if stated_km else 8.0
            return Built(_geo(g), g, "point", round(0.45 * factor, 2), r, "line anchored at one end")
        r = 3.0 if ms[0].method == "settlement" else 0.0
        return Built(_geo(g), g, "point", round(0.9 * factor, 2), r)

    # Line through the located route places.
    segments = []
    traced_all = True
    for (a, pa), (b, pb) in zip(zip(ms, pts), zip(ms[1:], pts[1:])):
        straight = math.dist(pa, pb)
        got = None
        if net is not None and a.method == "site" and b.method == "site":
            limit = max(straight * 2.5, (stated_km or 0) * 1000 * 2.0, 5000.0)
            got = net.trace(a.site, b.site, limit)
        ok = False
        if got:
            path, length = got
            if stated_km and len(ms) == 2:
                ok = 0.6 <= (length / 1000) / stated_km <= 1.8
            else:
                ok = length <= 1.8 * max(straight, 500.0)
        if ok:
            # Start/end exactly at the two sites so the drawn line meets them.
            segments.append([pa] + path[1:-1] + [pb])
        else:
            traced_all = False
            segments.append([pa, pb])
    coords = segments[0]
    for seg in segments[1:]:
        coords = coords + seg[1:]
    g = LineString(coords).simplify(25.0)
    if traced_all:
        return Built(_geo(g), g, "traced", round(0.9 * factor, 2), 0.0)
    r = max(1.0, min(8.0, 0.15 * g.length / 1000))
    return Built(_geo(g), g, "straight", round(0.75 * factor, 2), r)

"""Tower-by-tower view: OSM transmission structures and counts per traced project.

Output shapes (TypeScript-like, for the UI):

    // public/data/context/structures.geojson
    // Tower and pole nodes of OSM power lines in boxes padded ~3 km around the
    // projects that take part in an overlap (not the whole study area), split into
    // structures-<region>.geojson files if one file would exceed 6 MB
    // (public/data/context/structures-index.json then lists them).
    interface StructureFeature {
      type: "Feature";
      geometry: { type: "Point"; coordinates: [number, number] };  // [lon, lat], 5 decimals
      properties: {
        id: number;                 // OSM node id
        type: "tower" | "pole";     // OSM power=tower / power=pole
        lineId: number | null;      // OSM way id of the nearest power=line within 30 m
        operator: string | null;    // operator tag of that line
        utility: "DESC" | "GPC" | "OTHER";  // guess from the operator tag
      };
    }

    // public/data/plan/insights/structures.json
    interface ProjectStructures {
      projectId: string;            // Project.id
      structureCount: number;       // towers + poles within 40 m of the traced route
      towers: number;
      poles: number;
      spanAvgM: number | null;      // traced length / (structureCount - 1)
      lineKm: number;               // traced length used for the count
      overlapIds: string[];         // overlaps this project takes part in
      costNote: string;             // plain-language line to show with those overlaps' cost
    }
    type StructuresFile = ProjectStructures[];

Only rebuild / upgrade projects that take part in an overlap and whose geometry was traced along an existing OSM
line are counted: for those the structures on the traced path are the ones the
work will touch. OSM structure mapping is incomplete in places, so counts are a
lower bound.
"""

from __future__ import annotations

import json

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, shape

from gridsight import osm
from gridsight.config import BBOX, CONTEXT_OUT
from gridsight.plan.context import utility_guess
from gridsight.plan.geometry import to_metric

ON_LINE_M = 30.0
ON_ROUTE_M = 40.0
MAX_BYTES = 6_000_000
REGIONS = {  # lon_min, lat_min, lon_max, lat_max: used only if one file would be too big
    "savannah": (-82.2, 31.4, -80.3, 32.8),
    "augusta": (-82.8, 32.8, -81.3, 34.0),
    "charleston": (-80.6, 32.4, -79.5, 33.3),
    "midlands": (-81.8, 33.2, -80.0, 34.6),
    "rest": BBOX,
}


def project_boxes(projects: list[dict], pad_deg: float = 0.03) -> list[tuple[float, float, float, float]]:
    """Padded lon/lat boxes around located projects, merged where they overlap, split if large."""
    boxes = []
    for p in projects:
        if p["locationConfidence"] <= 0.2:
            continue
        g = shape(p["geometry"])
        x0, y0, x1, y1 = g.bounds
        boxes.append([x0 - pad_deg, y0 - pad_deg, x1 + pad_deg, y1 + pad_deg])
    merged: list[list[float]] = []
    for bx in sorted(boxes):
        for m in merged:
            if bx[0] <= m[2] and bx[2] >= m[0] and bx[1] <= m[3] and bx[3] >= m[1]:
                m[:] = [min(m[0], bx[0]), min(m[1], bx[1]), max(m[2], bx[2]), max(m[3], bx[3])]
                break
        else:
            merged.append(list(bx))
    out = []
    for x0, y0, x1, y1 in merged:  # keep each query small: at most 0.4 x 0.4 degrees
        nx, ny = max(1, int((x1 - x0) / 0.4) + 1), max(1, int((y1 - y0) / 0.4) + 1)
        for i in range(nx):
            for j in range(ny):
                out.append((x0 + i * (x1 - x0) / nx, y0 + j * (y1 - y0) / ny,
                            x0 + (i + 1) * (x1 - x0) / nx, y0 + (j + 1) * (y1 - y0) / ny))
    return out


def fetch_structures(boxes) -> list[dict]:
    """power=tower / power=pole nodes that belong to power=line ways, in small boxes (cached)."""
    seen: dict[int, dict] = {}
    for tb in boxes:
        q = f"""
[out:json][timeout:180];
way["power"="line"]{osm.bbox_filter(tb)};
node(w)["power"~"^(tower|pole)$"];
out qt;
"""
        for el in osm.overpass(q, retries=8).get("elements", []):
            kind = el.get("tags", {}).get("power")
            if kind in ("tower", "pole"):
                seen[el["id"]] = {"id": el["id"], "lon": el["lon"], "lat": el["lat"], "type": kind}
    return list(seen.values())


def _line_index():
    ways = osm.power_lines()
    segs_a, segs_b, owner = [], [], []
    for k, w in enumerate(ways):
        xs, ys = to_metric([c[0] for c in w["coords"]], [c[1] for c in w["coords"]])
        for i in range(len(xs) - 1):
            segs_a.append((xs[i], ys[i]))
            segs_b.append((xs[i + 1], ys[i + 1]))
            owner.append(k)
    a, b = np.array(segs_a), np.array(segs_b)
    mid = (a + b) / 2
    return ways, a, b, np.array(owner), cKDTree(mid), float(np.max(np.linalg.norm(b - a, axis=1)))


def _nearest_line(pt, idx):
    ways, a, b, owner, tree, max_seg = idx
    cand = tree.query_ball_point(pt, max_seg / 2 + ON_LINE_M)
    best = None
    for c in cand:
        ab = b[c] - a[c]
        t = 0.0 if not ab.any() else max(0.0, min(1.0, float(np.dot(pt - a[c], ab) / np.dot(ab, ab))))
        d = float(np.linalg.norm(pt - (a[c] + t * ab)))
        if d <= ON_LINE_M and (best is None or d < best[0]):
            best = (d, ways[owner[c]])
    return best[1] if best else None


def _feature(s, line) -> dict:
    op = (line or {}).get("tags", {}).get("operator") if line else None
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(s["lon"], 5), round(s["lat"], 5)]},
        "properties": {"id": s["id"], "type": s["type"], "lineId": line["id"] if line else None,
                       "operator": op or None, "utility": utility_guess(op or "")},
    }


def build(projects: list[dict], overlaps: list[dict]) -> tuple[list[dict], dict]:
    # Structures are fetched around the projects that take part in an overlap (the
    # places where crews would share work); the whole study area is too large for
    # the public Overpass servers.
    in_overlap = {pid for o in overlaps for pid in (o["descId"], o["gpcId"])}
    focus = [p for p in projects if p["id"] in in_overlap]
    structures = fetch_structures(project_boxes(focus))
    xs, ys = to_metric([s["lon"] for s in structures], [s["lat"] for s in structures])
    pts = np.column_stack([xs, ys])
    tree = cKDTree(pts)

    located = [p for p in projects if p["locationConfidence"] > 0.2]
    metric = {}
    for p in located:
        g = shape(p["geometry"])
        if g.geom_type == "Point":
            metric[p["id"]] = Point(*to_metric(g.x, g.y))
        else:
            cx, cy = to_metric([c[0] for c in g.coords], [c[1] for c in g.coords])
            metric[p["id"]] = LineString(list(zip(cx, cy)))

    # Structures near any located project (context layer).
    inside = np.ones(len(pts), dtype=bool)  # every fetched box already surrounds an overlapping project
    idx = _line_index()
    features = []
    for i in np.nonzero(inside)[0]:
        features.append(_feature(structures[i], _nearest_line(pts[i], idx)))

    # Per-project counts for traced rebuild / upgrade projects.
    by_project = {}
    for o in overlaps:
        for pid in (o["descId"], o["gpcId"]):
            by_project.setdefault(pid, []).append(o["id"])
    rows = []
    for p in located:
        if p["id"] not in in_overlap:
            continue
        if p["geometryQuality"] != "traced" or p["action"] not in ("rebuild", "upgrade"):
            continue
        line = metric[p["id"]]
        steps = max(2, int(line.length // 50) + 1)
        samples = np.array([line.interpolate(t, normalized=True).coords[0] for t in np.linspace(0, 1, steps)])
        near = sorted({i for grp in tree.query_ball_point(samples, 50 + ON_ROUTE_M) for i in grp})
        on = [i for i in near if line.distance(Point(pts[i])) <= ON_ROUTE_M]
        towers = sum(structures[i]["type"] == "tower" for i in on)
        poles = len(on) - towers
        km = line.length / 1000
        span = round(line.length / (len(on) - 1), 1) if len(on) > 1 else None
        note = (
            f"OpenStreetMap maps {len(on)} structures ({towers} towers, {poles} poles) along the traced "
            f"{km:.1f} km route of {p['name']}"
            + (f", about one every {span:.0f} m" if span else "")
            + ". Crews sharing a schedule would work through these structures in one mobilization; OSM "
            "coverage is incomplete, so treat this as a lower bound."
        )
        rows.append({"projectId": p["id"], "structureCount": len(on), "towers": towers, "poles": poles,
                     "spanAvgM": span, "lineKm": round(km, 2), "overlapIds": by_project.get(p["id"], []),
                     "costNote": note})
    rows.sort(key=lambda r: -r["structureCount"])
    info = {"structuresInBbox": len(structures), "structuresWritten": len(features),
            "towers": sum(s["type"] == "tower" for s in structures), "poles": sum(s["type"] == "pole" for s in structures)}
    _write(features, info)
    return rows, info


def _write(features: list[dict], info: dict) -> None:
    fc = {"type": "FeatureCollection", "features": features}
    text = json.dumps(fc, separators=(",", ":"))
    if len(text.encode()) < MAX_BYTES:
        (CONTEXT_OUT / "structures.geojson").write_text(text)
        info["files"] = ["structures.geojson"]
        return
    files = []
    remaining = features
    for name, (x0, y0, x1, y1) in REGIONS.items():
        part, rest = [], []
        for f in remaining:
            x, y = f["geometry"]["coordinates"]
            (part if name == "rest" or (x0 <= x <= x1 and y0 <= y <= y1) else rest).append(f)
        remaining = rest
        fn = f"structures-{name}.geojson"
        (CONTEXT_OUT / fn).write_text(json.dumps({"type": "FeatureCollection", "features": part}, separators=(",", ":")))
        files.append(fn)
    (CONTEXT_OUT / "structures-index.json").write_text(json.dumps({"files": files}))
    info["files"] = files

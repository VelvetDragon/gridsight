"""Plan change radar: how each project moved between published plan editions.

DESC publishes a yearly "Planned Transmission Projects $2M and above" list on
scrtp.com. We parse the 2023-2027, 2024-2028, 2025-2029 and 2026-2030 editions
with the same parser as the core dataset and follow each project across them
(DESC project ID first, then a fuzzy name match).

For Georgia Power we use the SERTP Preliminary Expansion Plan Reports
(Non-CEII) of 2024, 2025 and 2026, which list in-service years; the current
Georgia Power projects are followed across them by their named sites.

Output shapes (TypeScript-like, for the UI):

    // public/data/plan/insights/plan-changes.json
    interface PlanChangesFile {
      editions: Edition[];               // DESC editions
      gpcEditions: Edition[];            // SERTP reports used for Georgia Power
      desc: DescProjectHistory[];
      gpc: GpcPlanChange[];
    }
    interface Edition { id: string; document: string; url: string; projects: number }
    interface DescProjectHistory {
      key: string;                       // stable track id
      projectId: string | null;          // Project.id when it is in the current (2026-2030) edition
      descProjectId: string | null;      // DESC's own project ID as printed in the latest edition
      name: string;                      // name in the latest edition it appears in
      action: "new" | "rebuild" | "upgrade";
      history: { edition: string; page: number; inService: string | null; costUsd: number | null; status: string | null }[];
      flags: {
        added: boolean;                  // first appears after the 2023-2027 edition
        removed: boolean;                // missing from the 2026-2030 edition (completed or dropped)
        delayedMonths: number | null;    // latest minus earliest in-service date (negative = advanced)
        costChangeUsd: number | null;    // latest minus earliest total cost
        costChangePct: number | null;
      };
    }
    interface GpcPlanChange {
      projectId: string;                 // Project.id
      name: string;
      history: { edition: string; page: number; inService: string | null; costUsd: null; status: null }[];
      delayedMonths: number | null;      // latest minus earliest in-service (whole years x 12)
      status: "new" | "unchanged" | "delayed" | "advanced";  // "new" = only in one edition
    }

    // public/data/plan/insights/slip-stats.json
    interface SlipStats {
      desc: SlipGroup & { byAction: Record<"new" | "rebuild" | "upgrade", SlipGroup> };
      gpc: SlipGroup & { basis: string };
      notes: string[];
    }
    interface SlipGroup {
      projectsCompared: number;          // projects seen in at least two editions
      delayed: number;                   // in-service moved later
      advanced: number;
      unchanged: number;
      shareDelayed: number;              // delayed / projectsCompared (0..1)
      medianDelayMonths: number | null;  // median over delayed projects
      medianShiftMonths: number | null;  // median over all compared projects (0 if unchanged)
    }
"""

from __future__ import annotations

import re
from datetime import date
from statistics import median

from rapidfuzz import fuzz

from gridsight.config import RAW_DIR
from gridsight.plan import parse_desc, parse_sertp
from gridsight.plan.geocode import normalize

EDITIONS = [
    ("2023-2027", "desc-2023-2027-projects.pdf"),
    ("2024-2028", "desc-2024-2028-projects.pdf"),
    ("2025-2029", "desc-2025-2029-projects.pdf"),
    ("2026-2030", "desc-2026-2030-projects.pdf"),
]
URL = "https://www.scrtp.com/assets/pdfs/home/{}-2million-and-above-project-descriptions.pdf"


def _pid(desc_text: str) -> str | None:
    m = re.search(r"\(DESC project ID (.+?)\)\s*$", desc_text)
    return m.group(1).strip() if m else None


def _base(pid: str | None) -> str | None:
    if not pid:
        return None
    m = re.match(r"0*(\d{3,5})", pid.replace(" ", ""))
    return m.group(1) if m else None


def _norm_pid(pid: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (pid or "").upper()).lstrip("0")


def _months(a: str | None, b: str | None) -> int | None:
    if not a or not b:
        return None
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    return (db.year - da.year) * 12 + (db.month - da.month)


def desc_histories() -> tuple[list[dict], list[dict]]:
    editions_meta = []
    tracks: list[dict] = []
    for k, (ed, fn) in enumerate(EDITIONS):
        projects = parse_desc.parse(RAW_DIR / fn)
        editions_meta.append({"id": ed, "document": f"DESC Planned Transmission Projects $2M and above, {ed} (SCRTP)",
                              "url": URL.format(ed), "projects": len(projects)})
        open_tracks = [t for t in tracks if t["last"] == k - 1]
        used: set[int] = set()
        for p in projects:
            pid = _pid(p.description)
            best, best_score = None, 0.0
            for ti, t in enumerate(open_tracks):
                if ti in used:
                    continue
                name_score = fuzz.token_set_ratio(p.name, t["name"])
                if _base(pid) and _base(pid) == _base(t["pid"]):
                    score = 100 + name_score if _norm_pid(pid) == _norm_pid(t["pid"]) else 50 + name_score
                    if name_score < 45 and _norm_pid(pid) != _norm_pid(t["pid"]):
                        continue  # same budget number, different job
                elif name_score >= 90:
                    score = name_score
                else:
                    continue
                if score > best_score:
                    best, best_score = ti, score
            rec = {"edition": ed, "page": p.source_page, "inService": p.in_service, "costUsd": p.cost_usd,
                   "status": p.status}
            if best is None:
                tracks.append({"pid": pid, "name": p.name, "action": p.action, "history": [rec], "first": k, "last": k,
                               "projectId": p.id if ed == "2026-2030" else None})
            else:
                used.add(best)
                t = open_tracks[best]
                t.update(pid=pid or t["pid"], name=p.name, action=p.action, last=k)
                t["history"].append(rec)
                if ed == "2026-2030":
                    t["projectId"] = p.id
    last_k = len(EDITIONS) - 1
    out = []
    for n, t in enumerate(tracks):
        h = t["history"]
        first, last = h[0], h[-1]
        delay = _months(first["inService"], last["inService"]) if len(h) > 1 else None
        cost_change = (last["costUsd"] - first["costUsd"]) if len(h) > 1 and first["costUsd"] and last["costUsd"] else None
        out.append({
            "key": f"desc-track-{n + 1:03d}",
            "projectId": t["projectId"],
            "descProjectId": t["pid"],
            "name": t["name"],
            "action": t["action"],
            "history": h,
            "flags": {
                "added": t["first"] > 0,
                "removed": t["last"] < last_k,
                "delayedMonths": delay,
                "costChangeUsd": round(cost_change) if cost_change is not None else None,
                "costChangePct": round(100 * cost_change / first["costUsd"], 1) if cost_change is not None else None,
            },
        })
    return out, editions_meta


SERTP_EDITIONS = [
    ("SERTP 2024", "sertp-2024-preliminary-expansion-plan-noncei.pdf",
     "https://www.southeasternrtp.com/docs/general/2024/2024_SERTP_Preliminary_Expansion_Plan_Report_(Non-CEII).pdf"),
    ("SERTP 2025", "sertp-2025-preliminary-expansion-plan-noncei.pdf",
     "https://www.southeasternrtp.com/docs/general/2025/2025%20SERTP%20Preliminary%20Expansion%20Plan%20Report%20(Non-CEII).pdf"),
    ("SERTP 2026", "sertp-2026-preliminary-expansion-plan-noncei.pdf",
     "https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_Preliminary_Expansion_Plan_Report_(Non-CEII).pdf"),
]


def _route_key(places: list[str]) -> frozenset:
    return frozenset(k for k in (normalize(x) for x in places) if k)


def gpc_changes(projects: list[dict]) -> tuple[list[dict], list[dict]]:
    """History of the current Georgia Power projects across SERTP preliminary reports.

    Only projects already confirmed in Georgia (projects.json) are followed; an
    older entry matches when it names the same set of sites and the same kind.
    """
    editions = []
    by_edition: list[dict] = []
    for ed, fn, url in SERTP_EDITIONS:
        entries, _ = parse_sertp.parse_project_report(RAW_DIR / fn, ed, url, ed.replace(" ", "").lower())
        editions.append({"id": ed, "document": f"{ed} Preliminary Expansion Plan Report (Non-CEII)", "url": url,
                         "projects": len(entries)})
        idx: dict[tuple, object] = {}
        for e in entries:
            idx.setdefault((_route_key(e.route or e.places), e.kind), e)
        by_edition.append(idx)
    out = []
    for p in projects:
        if p["utility"] != "GPC" or not p["id"].startswith("gpc-sertp"):
            continue
        key = (_route_key(p["places"]), p["kind"])
        if not key[0]:
            continue
        history = []
        for (ed, _, _), idx in zip(SERTP_EDITIONS, by_edition):
            e = idx.get(key)
            if e:
                history.append({"edition": ed, "page": e.source_page, "inService": e.in_service, "costUsd": None,
                                "status": None})
        if not history:
            continue
        delay = _months(history[0]["inService"], history[-1]["inService"]) if len(history) > 1 else None
        status = "new" if delay is None else "delayed" if delay > 0 else "advanced" if delay < 0 else "unchanged"
        out.append({"projectId": p["id"], "name": p["name"], "history": history, "delayedMonths": delay,
                    "status": status})
    return out, editions


def _group(shifts: list[int | None], flags: list[str]) -> dict:
    compared = [(s, f) for s, f in zip(shifts, flags) if f != "new"]
    delayed = [s for s, f in compared if f == "delayed"]
    known = [s for s, _ in compared if s is not None]
    return {
        "projectsCompared": len(compared),
        "delayed": len(delayed),
        "advanced": sum(f == "advanced" for _, f in compared),
        "unchanged": sum(f == "unchanged" for _, f in compared),
        "shareDelayed": round(len(delayed) / len(compared), 3) if compared else 0.0,
        "medianDelayMonths": median([s for s in delayed if s is not None]) if any(s is not None for s in delayed) else None,
        "medianShiftMonths": median(known) if known else None,
    }


def _desc_flag(h: dict) -> str:
    d = h["flags"]["delayedMonths"]
    if d is None:
        return "new"
    return "delayed" if d > 0 else "advanced" if d < 0 else "unchanged"


def build(projects: list[dict]) -> tuple[dict, dict]:
    desc, editions = desc_histories()
    gpc, gpc_editions = gpc_changes(projects)
    flags = [_desc_flag(h) for h in desc]
    shifts = [h["flags"]["delayedMonths"] for h in desc]
    by_action = {}
    for action in ("new", "rebuild", "upgrade"):
        sel = [i for i, h in enumerate(desc) if h["action"] == action]
        by_action[action] = _group([shifts[i] for i in sel], [flags[i] for i in sel])
    stats = {
        "desc": {**_group(shifts, flags), "byAction": by_action},
        "gpc": {**_group([g["delayedMonths"] for g in gpc], [g["status"] for g in gpc]),
                "basis": "In-service years of the current Georgia Power projects in the SERTP 2024, 2025 and 2026 "
                         "Preliminary Expansion Plan Reports (Non-CEII); year precision"},
        "notes": [
            "DESC: a project is compared when it appears in at least two of the 2023-2027 ... 2026-2030 editions; "
            "shift = latest minus earliest planned in-service date.",
            "Georgia Power: SERTP lists in-service years only, so shifts are whole years; only projects in the "
            "current dataset (confirmed in Georgia) are followed, matched by the same named sites.",
            "Projects that drop out of a later DESC edition are usually completed; they keep their last planned date.",
        ],
    }
    return {"editions": editions, "gpcEditions": gpc_editions, "desc": desc, "gpc": gpc}, stats

"""Optional QA pass: ask Gemini to re-read a sample of source pages and check our parsing.

For each sampled project, Gemini gets the source page text (the PDF page or web
page the project came from) and extracts kind, action, endpoints and in-service
date on its own. We compare that to projects.json and write
public/data/plan/insights/extraction-check.json with the agreement rate.

Usage:
  python -m gridsight.integrations.gemini_check            # run from pipeline/
  python -m gridsight.integrations.gemini_check --sample 20 --data-dir ../public/data
  python -m gridsight.integrations.gemini_check --dry-run  # show what would be sent

Needs GEMINI_API_KEY; without it the script prints a note and exits 0.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import importlib.util
import random
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

from gridsight.config import CACHE_DIR, RAW_DIR, REPO_ROOT
from gridsight.integrations.common import data_dir, env, integrations_cache, load_dotenv_local, read_json, write_json
from gridsight.integrations.gemini import GeminiAuthError, generate_json

MAX_CHARS = 7000

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "kind": {"type": "STRING", "enum": ["line", "substation"]},
        "action": {"type": "STRING", "enum": ["new", "rebuild", "upgrade"]},
        "endpoints": {"type": "ARRAY", "items": {"type": "STRING"},
                      "description": "Substation or site names the project connects or sits at, as written."},
        "inService": {"type": "STRING", "nullable": True,
                      "description": "Planned in-service date as YYYY-MM-DD or YYYY-MM or YYYY; null if not stated."},
        "evidence": {"type": "STRING", "description": "Short quote from the page supporting the answer."},
    },
    "required": ["kind", "action", "endpoints", "inService"],
}

PROMPT = """You check how a transmission project was parsed from a utility filing.
Read the SOURCE TEXT and find the project named "{name}".
Classify it using only the source text:
- kind: "line" for a transmission line, "substation" for a substation, switching station, plant or site.
- action: "new" = construct something new, "rebuild" = replace or reconductor along the same path,
  "upgrade" = equipment only (transformers, breakers, reactors, terminal equipment).
- endpoints: the substation or site names it connects (or the single site for a substation).
- inService: the planned in-service date.
Return JSON only.

SOURCE TEXT:
{text}"""


# ---------------------------------------------------------------- source text


def _fetch_sources() -> dict[str, str]:
    """url -> local file name, from pipeline/scripts/fetch_data.py SOURCES."""
    path = REPO_ROOT / "pipeline" / "scripts" / "fetch_data.py"
    try:
        spec = importlib.util.spec_from_file_location("_gs_fetch_data", path)
        module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return {url: name for name, url in getattr(module, "SOURCES", {}).items()}
    except Exception:
        return {}


def local_copy(url: str, sources: dict[str, str]) -> Path | None:
    names = [sources.get(url), url.rstrip("/").rsplit("/", 1)[-1]]
    for name in filter(None, names):
        for base in (RAW_DIR, CACHE_DIR / "response", CACHE_DIR):
            p = base / name
            if p.is_file():
                return p
    cached = integrations_cache() / ("src-" + hashlib.sha1(url.encode()).hexdigest()[:16])
    if cached.is_file():
        return cached
    try:
        resp = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0 (compatible; GridSight/0.1)"})
        resp.raise_for_status()
    except requests.RequestException:
        return None
    cached.write_bytes(resp.content)
    return cached


def _html_text(raw: bytes) -> str:
    text = raw.decode("utf-8", errors="ignore")
    text = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def _pdf_pages(path: Path) -> list[str]:
    try:
        import pymupdf
    except ImportError:  # older PyMuPDF
        import fitz as pymupdf  # type: ignore[no-redef]

    with pymupdf.open(path) as doc:
        return [page.get_text() for page in doc]


def _window(text: str, needles: list[str]) -> str:
    """Cut MAX_CHARS of text around the first needle found."""
    if len(text) <= MAX_CHARS:
        return text
    lower = text.lower()
    for n in needles:
        i = lower.find(n.lower()) if n else -1
        if i >= 0:
            start = max(0, i - MAX_CHARS // 3)
            return text[start:start + MAX_CHARS]
    return text[:MAX_CHARS]


def source_text(project: dict[str, Any], sources: dict[str, str]) -> str | None:
    src = project.get("source") or {}
    url = src.get("url")
    if not url:
        return None
    path = local_copy(url, sources)
    if not path:
        return None
    raw = path.read_bytes()
    needles = [project.get("name", "")] + list(project.get("places") or [])
    needles += [re.sub(r"^[A-Z]{2,6}:\s*", "", project.get("name", "")).split(":")[0].split(" - ")[0]]
    if raw[:5] == b"%PDF-":
        pages = _pdf_pages(path)
        page = src.get("page")
        if page and 1 <= page <= len(pages):
            # The project can spill onto the next page.
            chunk = pages[page - 1] + ("\n" + pages[page] if page < len(pages) else "")
            return _window(chunk, needles)
        for text in pages:
            if any(n and n.lower() in text.lower() for n in needles[:1] + needles[-1:]):
                return _window(text, needles)
        return None
    return _window(_html_text(raw), needles)


# ---------------------------------------------------------------- Gemini


def ask_gemini(api_key: str, prompt: str) -> tuple[dict[str, Any], str]:
    try:
        return generate_json(prompt, SCHEMA, temperature=0, api_key=api_key)
    except GeminiAuthError as exc:
        raise PermissionError(str(exc)) from exc


# ---------------------------------------------------------------- compare


def _norm(s: str) -> str:
    s = re.sub(r"\b(substation|switching station|sub|ss|plant|tie|line|kv|\d+)\b", " ", s.lower())
    return re.sub(r"[^a-z]+", " ", s).strip()


def endpoints_agree(ours: list[str], theirs: list[str]) -> bool:
    a = {_norm(x) for x in ours if _norm(x)}
    b = {_norm(x) for x in theirs if _norm(x)}
    if not a and not b:
        return True
    if not a or not b:
        return False
    return any(x in y or y in x for x in a for y in b)


def dates_agree(ours: str | None, theirs: str | None) -> bool:
    if not ours and not theirs:
        return True
    if not ours or not theirs:
        return False
    theirs = str(theirs)
    if len(theirs) >= 7 and len(ours) >= 7:
        return ours[:7] == theirs[:7]
    return ours[:4] == theirs[:4]


def sample_projects(projects: list[dict[str, Any]], n: int, seed: int) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    by_utility: dict[str, list[dict[str, Any]]] = {}
    for p in projects:
        by_utility.setdefault(p.get("utility", "?"), []).append(p)
    picked: list[dict[str, Any]] = []
    groups = list(by_utility.values())
    for i, group in enumerate(groups):
        k = n // len(groups) + (1 if i < n % len(groups) else 0)
        picked += rng.sample(group, min(k, len(group)))
    return picked


# ---------------------------------------------------------------- main


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sample", type=int, default=16)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--data-dir", help="read and write here instead of public/data")
    ap.add_argument("--dry-run", action="store_true", help="show the sample and source text sizes, no API calls")
    args = ap.parse_args(argv)

    load_dotenv_local()
    root = data_dir(args.data_dir)
    api_key = env("GEMINI_API_KEY")
    if not api_key and not args.dry_run:
        print("GEMINI_API_KEY not set: skipping the Gemini extraction check.")
        return 0

    projects, origin = read_json("plan/projects.json", root, fixtures=False)
    if not projects:
        print(f"No plan/projects.json under {root}: nothing to check.")
        return 0

    sources = _fetch_sources()
    items: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    used_model = None

    for p in sample_projects(projects, args.sample, args.seed):
        text = source_text(p, sources)
        if not text:
            skipped.append({"projectId": p["id"], "reason": "source text not available"})
            continue
        if args.dry_run:
            print(f"{p['id']}: {len(text)} chars from {p['source'].get('document')}")
            continue
        try:
            got, used_model = ask_gemini(api_key, PROMPT.format(name=p["name"], text=text))  # type: ignore[arg-type]
        except PermissionError as exc:
            print(exc)
            return 1
        except Exception as exc:
            skipped.append({"projectId": p["id"], "reason": str(exc)[:200]})
            continue
        ours = {"kind": p.get("kind"), "action": p.get("action"), "endpoints": p.get("places") or [],
                "inService": p.get("inService")}
        agree = {
            "kind": got.get("kind") == ours["kind"],
            "action": got.get("action") == ours["action"],
            "endpoints": endpoints_agree(ours["endpoints"], got.get("endpoints") or []),
            "inService": dates_agree(ours["inService"], got.get("inService")),
        }
        items.append({"projectId": p["id"], "name": p["name"], "utility": p.get("utility"),
                      "source": p.get("source"), "ours": ours, "gemini": got, "agree": agree})
        print(f"{'ok ' if all(agree.values()) else 'dif'} {p['id']} {agree}")

    if args.dry_run:
        print(f"dry run: {len(skipped)} of {args.sample} without source text")
        return 0

    fields = ["kind", "action", "endpoints", "inService"]
    field_rate = {f: (sum(i["agree"][f] for i in items) / len(items)) if items else None for f in fields}
    total = sum(sum(i["agree"].values()) for i in items)
    report = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model": used_model,
        "dataOrigin": origin,
        "sampleSize": args.sample,
        "checked": len(items),
        "agreementRate": round(total / (len(items) * len(fields)), 3) if items else None,
        "fullyAgreeing": sum(all(i["agree"].values()) for i in items),
        "fieldAgreement": {f: (round(v, 3) if v is not None else None) for f, v in field_rate.items()},
        "skipped": skipped,
        "items": items,
    }
    out = root / "plan" / "insights" / "extraction-check.json"
    write_json(out, report)
    print(f"wrote {out}: agreement {report['agreementRate']} over {len(items)} projects")
    return 0


if __name__ == "__main__":
    sys.exit(main())

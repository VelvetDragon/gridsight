"""Small helpers shared by the integration scripts."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from gridsight.config import CACHE_DIR, OUT_DIR, REPO_ROOT

# Values copied straight from .env.example are treated as "not set".
_PLACEHOLDER_MARKERS = ("your-", "your_", "changeme", "placeholder", "replace_in_console")


def env(name: str) -> str | None:
    """Return an environment variable, or None when it is empty or a placeholder."""
    value = os.environ.get(name, "").strip()
    if not value:
        return None
    lowered = value.lower()
    if any(marker in lowered for marker in _PLACEHOLDER_MARKERS):
        return None
    return value


def load_dotenv_local() -> None:
    """Load KEY=VALUE pairs from .env.local / .env at the repo root (without overriding)."""
    for name in (".env.local", ".env"):
        path = REPO_ROOT / name
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip().removeprefix("export ").strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def data_dir(override: str | Path | None = None) -> Path:
    """Directory that holds plan/, response/ and context/ (default public/data)."""
    if override:
        return Path(override).resolve()
    if os.environ.get("GRIDSIGHT_DATA_DIR"):
        return Path(os.environ["GRIDSIGHT_DATA_DIR"]).resolve()
    return OUT_DIR


def read_json(rel: str, root: Path | None = None, *, fixtures: bool = True) -> tuple[Any, str | None]:
    """Read <root>/<rel>, falling back to <root>/fixtures/<rel>.

    Returns (data, origin) where origin is "pipeline", "sample" or None if missing.
    """
    base = root or data_dir()
    candidates = [(base / rel, "pipeline")]
    if fixtures:
        candidates.append((base / "fixtures" / rel, "sample"))
        # A custom data dir may not carry fixtures; the repo's public/data does.
        if base != OUT_DIR:
            candidates.append((OUT_DIR / "fixtures" / rel, "sample"))
    for path, origin in candidates:
        if path.is_file():
            try:
                return json.loads(path.read_text(encoding="utf-8")), origin
            except (OSError, json.JSONDecodeError):
                continue
    return None, None


def write_json(path: Path, data: Any, *, pretty: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, indent=2 if pretty else None, ensure_ascii=False,
                      separators=None if pretty else (",", ":"))
    path.write_text(text + "\n", encoding="utf-8")


def integrations_cache() -> Path:
    path = CACHE_DIR / "integrations"
    path.mkdir(parents=True, exist_ok=True)
    return path

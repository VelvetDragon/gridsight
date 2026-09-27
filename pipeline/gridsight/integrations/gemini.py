"""Minimal Gemini API client (REST generateContent) with model fallback.

Request starts are spaced at least GEMINI_MIN_INTERVAL_MS apart (default 1000 ms)
so batch runs stay under the rate limit, and a 429 waits the delay Gemini asks for.
"""

from __future__ import annotations

import json
import re
import threading
import time
from typing import Any

import requests

from gridsight.integrations.common import env

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Current Flash models (ai.google.dev/gemini-api/docs/models); GEMINI_MODEL goes first when set.
DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3-flash-preview"]


class GeminiAuthError(RuntimeError):
    pass


_lock = threading.Lock()
_next_slot = 0.0


def _paced() -> None:
    """Wait for this request's turn: starts are spaced evenly across threads."""
    global _next_slot
    raw = env("GEMINI_MIN_INTERVAL_MS")
    try:
        gap = max(0.0, float(raw)) / 1000 if raw else 1.0
    except ValueError:
        gap = 1.0
    with _lock:
        now = time.monotonic()
        slot = max(now, _next_slot)
        _next_slot = slot + gap
    if slot > now:
        time.sleep(slot - now)


def _retry_delay(resp: requests.Response) -> float | None:
    """Seconds Gemini asked us to wait (RetryInfo.retryDelay or Retry-After), if it said."""
    m = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', resp.text or "")
    if m:
        return float(m.group(1))
    try:
        return float(resp.headers.get("Retry-After", ""))
    except ValueError:
        return None


def models() -> list[str]:
    return list(dict.fromkeys([m for m in [env("GEMINI_MODEL"), *DEFAULT_MODELS] if m]))


def generate_json(prompt: str | list[dict[str, Any]], schema: dict[str, Any], *, system: str | None = None,
                  temperature: float = 0.3, api_key: str | None = None, timeout: int = 120) -> tuple[Any, str]:
    """Return (parsed JSON, model used). `prompt` is text or a list of parts."""
    key = api_key or env("GEMINI_API_KEY")
    if not key:
        raise GeminiAuthError("GEMINI_API_KEY not set")
    parts = [{"text": prompt}] if isinstance(prompt, str) else prompt
    body: dict[str, Any] = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"temperature": temperature, "responseMimeType": "application/json",
                             "responseSchema": schema},
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    last: Exception | None = None
    for model in models():
        for attempt in range(2):
            _paced()
            try:
                resp = requests.post(ENDPOINT.format(model=model), json=body, timeout=timeout,
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json"})
            except requests.RequestException as exc:
                last = exc
                break
            if resp.status_code in (401, 403):
                raise GeminiAuthError(f"Gemini rejected the key ({resp.status_code})")
            if resp.status_code == 429 and "quota" in resp.text.lower():
                # Out of quota for this model: move on to the next one instead of hammering it.
                last = RuntimeError(f"{model}: 429 quota exceeded")
                break
            if resp.status_code in (429, 500, 503) and attempt == 0:
                time.sleep(min(_retry_delay(resp) or 4, 30))
                continue
            if not resp.ok:
                last = RuntimeError(f"{model}: {resp.status_code} {resp.text[:160]}")
                break
            try:
                cand = resp.json()["candidates"][0]["content"]["parts"]
                text = "".join(p.get("text", "") for p in cand if not p.get("thought"))
                return json.loads(text), model
            except (KeyError, IndexError, ValueError) as exc:
                last = exc
                break
    raise RuntimeError(f"all Gemini models failed: {last}")

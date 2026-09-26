"""Minimal Gemini API client (REST generateContent) with model fallback."""

from __future__ import annotations

import json
import time
from typing import Any

import requests

from gridsight.integrations.common import env

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Current Flash models (ai.google.dev/gemini-api/docs/models); GEMINI_MODEL goes first when set.
DEFAULT_MODELS = ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite"]


class GeminiAuthError(RuntimeError):
    pass


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
            try:
                resp = requests.post(ENDPOINT.format(model=model), json=body, timeout=timeout,
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json"})
            except requests.RequestException as exc:
                last = exc
                break
            if resp.status_code in (401, 403):
                raise GeminiAuthError(f"Gemini rejected the key ({resp.status_code})")
            if resp.status_code in (429, 500, 503) and attempt == 0:
                time.sleep(4)
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

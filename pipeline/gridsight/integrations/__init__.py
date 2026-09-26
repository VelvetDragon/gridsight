"""Sponsor integrations: ElevenLabs narration, Gemini checks, Tiger Data loading.

Every integration reads its key from the environment and skips cleanly when the
key is missing, so the core pipeline never depends on them.
"""

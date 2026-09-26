"""Build narration from the data files and voice it with ElevenLabs.

Writes public/audio/<id>.mp3 and public/audio/manifest.json:
  [{id, kind, title, text, file, durationMs, hash}]

Clips: story-1 .. story-7 (story mode chapters), flight-1 (corridor fly-through
of the #1 overlap) and briefing-<storm> (storm crew briefing, featured storm).

Usage:
  python pipeline/scripts/narrate.py --dry-run          # texts only, no API calls
  python pipeline/scripts/narrate.py                     # needs ELEVENLABS_API_KEY
  python pipeline/scripts/narrate.py --only story-4 --force
  python pipeline/scripts/narrate.py --storm matthew     # briefing for another storm

Without ELEVENLABS_API_KEY the script behaves like --dry-run. Existing MP3s whose
text has not changed are kept, so re-running costs no credits.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gridsight.config import REPO_ROOT  # noqa: E402
from gridsight.integrations.common import data_dir, load_dotenv_local, write_json  # noqa: E402
from gridsight.integrations.narration import ElevenLabs, build_clips, mp3_duration_ms  # noqa: E402

AUDIO_DIR = REPO_ROOT / "public" / "audio"


def previous_manifest(path: Path) -> dict[str, dict]:
    try:
        return {c["id"]: c for c in json.loads(path.read_text(encoding="utf-8"))}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="write manifest texts only, no audio")
    ap.add_argument("--data-dir", help="read data from here instead of public/data")
    ap.add_argument("--out-dir", default=str(AUDIO_DIR), help="where MP3s and manifest.json go")
    ap.add_argument("--storm", help="storm id for the briefing (default: the featured storm)")
    ap.add_argument("--only", nargs="*", help="only voice these clip ids")
    ap.add_argument("--force", action="store_true", help="re-voice clips even if the text is unchanged")
    ap.add_argument("--print", action="store_true", help="print the scripts")
    args = ap.parse_args()

    load_dotenv_local()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"

    clips, data = build_clips(data_dir(args.data_dir), args.storm)
    sample = sorted(k for k, v in data.origins.items() if v == "sample")
    missing = sorted(k for k, v in data.origins.items() if v is None)
    if sample:
        print(f"note: using sample fixtures for {', '.join(sample)}")
    if missing:
        print(f"note: missing {', '.join(missing)}")

    client = None if args.dry_run else ElevenLabs.from_env()
    if not args.dry_run and client is None:
        print("ELEVENLABS_API_KEY not set: writing texts only (same as --dry-run).")

    old = previous_manifest(manifest_path)
    wanted = set(args.only or [c.id for c in clips])
    failures = 0

    for i, clip in enumerate(clips):
        mp3 = out_dir / f"{clip.id}.mp3"
        prev = old.get(clip.id, {})
        unchanged = prev.get("hash") == clip.hash and mp3.is_file()
        if unchanged:
            # Keep the existing audio and its measured length.
            clip.file = f"/audio/{mp3.name}"
            clip.durationMs = int(prev.get("durationMs") or clip.durationMs)
        if args.print:
            print(f"\n[{clip.id}] {clip.title} (~{clip.durationMs / 1000:.0f}s)\n{clip.text}")
        if client is None or clip.id not in wanted or (unchanged and not args.force):
            continue
        # Neighbouring story text keeps the intonation continuous across chapters.
        same_kind = [c for c in clips if c.kind == clip.kind]
        idx = same_kind.index(clip)
        prev_text = same_kind[idx - 1].text if idx > 0 else None
        next_text = same_kind[idx + 1].text if idx + 1 < len(same_kind) else None
        try:
            audio = client.synthesize(clip.text, prev_text, next_text)
        except Exception as exc:  # network, quota, bad key: keep going, stay silent in the app
            failures += 1
            print(f"fail  {clip.id}: {exc}")
            continue
        mp3.write_bytes(audio)
        clip.file = f"/audio/{mp3.name}"
        clip.durationMs = mp3_duration_ms(audio)
        print(f"voice {clip.id} -> {mp3.relative_to(REPO_ROOT) if mp3.is_relative_to(REPO_ROOT) else mp3} "
              f"({clip.durationMs / 1000:.1f}s) [{i + 1}/{len(clips)}]")

    write_json(manifest_path, [c.as_dict() for c in clips])
    voiced = sum(1 for c in clips if c.file)
    print(f"wrote {manifest_path} ({len(clips)} clips, {voiced} with audio)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

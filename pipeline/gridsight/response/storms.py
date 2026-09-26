"""Storms replayed by Response mode.

Each storm is replayed "from before landfall": the damage and outage predictions use
the NHC official forecast (OFCL) issued about 48 h before the reference landfall, the
same information utilities had at that time. The best track is used for display and,
for the other storms, as training data for the county outage model.

HURDAT2 IDs were verified against the storm header lines of hurdat2-1851-2025-091226.txt.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


def _utc(*a) -> datetime:
    return datetime(*a, tzinfo=timezone.utc)


@dataclass(frozen=True)
class StormSpec:
    key: str  # folder name under public/data/response/
    hurdat_id: str
    name: str
    # Reference landfall (HURDAT2 "L" record) that the replay counts down to.
    landfall: datetime
    landfall_label: str
    focus: str  # "inland" | "coastal"
    featured: bool = False
    publish: bool = True  # False = training/cross-validation only, no folder

    @property
    def year(self) -> int:
        return self.landfall.year

    @property
    def forecast_cycle(self) -> datetime:
        """Latest synoptic OFCL cycle at or before landfall - 48 h."""
        t = self.landfall - timedelta(hours=48)
        return t.replace(hour=(t.hour // 6) * 6, minute=0, second=0, microsecond=0)

    @property
    def replay_start(self) -> datetime:
        """Advisory release time of that cycle (synoptic time + 3 h)."""
        return self.forecast_cycle + timedelta(hours=3)


STORMS: dict[str, StormSpec] = {
    s.key: s
    for s in [
        StormSpec("helene", "AL092024", "Helene", _utc(2024, 9, 27, 3, 10), "Big Bend, FL", "inland", featured=True),
        StormSpec("matthew", "AL142016", "Matthew", _utc(2016, 10, 8, 15, 0), "McClellanville, SC", "coastal"),
        StormSpec("irma", "AL112017", "Irma", _utc(2017, 9, 10, 19, 30), "Marco Island, FL", "inland"),
        StormSpec("idalia", "AL102023", "Idalia", _utc(2023, 8, 30, 11, 45), "Keaton Beach, FL", "inland"),
        StormSpec("debby", "AL042024", "Debby", _utc(2024, 8, 5, 11, 0), "Steinhatchee, FL", "coastal"),
        # Training / cross-validation only (EAGLE-I data exists; not in the storm picker).
        StormSpec("michael", "AL142018", "Michael", _utc(2018, 10, 10, 17, 30), "Mexico Beach, FL", "inland", publish=False),
    ]
}

FEATURED = "helene"


def resolve(arg: str) -> list[StormSpec]:
    """--storm value -> specs. Accepts folder keys, HURDAT2 IDs, 'all' or 'published'."""
    arg = arg.strip().lower()
    if arg == "all":
        return list(STORMS.values())
    if arg == "published":
        return [s for s in STORMS.values() if s.publish]
    out = []
    for part in arg.split(","):
        part = part.strip()
        hit = [s for s in STORMS.values() if part in (s.key, s.hurdat_id.lower())]
        if not hit:
            raise SystemExit(f"unknown storm {part!r}; choose from {', '.join(STORMS)} or all")
        out.extend(hit)
    return out

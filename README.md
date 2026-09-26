# GridSight

See the whole picture: where neighboring power companies' work collides, before they build and before the storm hits.

Built at ShellHacks 2026 for the Sperry Tech GridLock Challenge, using Dominion Energy South Carolina (DESC) and Georgia Power (GPC), two utilities that face each other across the Savannah River.

## Modes

- **Plan mode** reads both utilities' public construction plans, places every project on an interactive map, flags pairs within 40 km by closest-point distance (crossing / 1.6 km / 8 km / 40 km tiers), adds build-window overlap, and ranks the top coordination opportunities with a rough cost estimate.
- **Response mode** replays real hurricanes that hit both utilities (Helene 2024 featured; Matthew 2016, Irma 2017, Idalia 2023, Debby 2024 selectable), simulates transmission damage with engineering fragility curves (GPU Monte Carlo), and proposes shared staging yards so both utilities can restore power faster, most vulnerable residents first.

## Repository layout

```
src/            Next.js app (App Router, TypeScript, Tailwind)
src/lib/types.ts  data contract shared by the app and the pipeline
public/data/    JSON produced by the pipeline and read by the app
pipeline/       Python pipeline: public filings -> public/data
```

## Run the app

```bash
npm install
npm run dev
```

## Run the pipeline

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt
python pipeline/scripts/fetch_data.py
cd pipeline
python -m gridsight.plan.build          # Plan mode -> public/data/plan, public/data/context
python -m gridsight.plan.build --no-roads   # same, without OSRM road checks
python -m pytest tests
```

Raw documents are downloaded outside the repo (`../gridsight-data/raw`, override with `GRIDSIGHT_RAW`). OpenStreetMap (Overpass) and OSRM responses are cached in `../gridsight-data/cache` (`GRIDSIGHT_CACHE`), so a rebuild is offline once the cache is warm.

## Data sources

All public. No CEII.

- Dominion Energy South Carolina, Planned Transmission Projects $2M and above, 2026-2030 (SCRTP)
- Southeastern Regional Transmission Planning (SERTP), 2026 preliminary 10-year expansion plan
- NOAA HURDAT2, National Hurricane Center GIS
- DOE / ORNL EAGLE-I outage data
- OpenStreetMap, HIFLD (archived)
- HHS emPOWER

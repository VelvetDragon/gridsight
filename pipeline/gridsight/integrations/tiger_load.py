"""Load outage history, plan versions and simulation runs into Tiger Data (Postgres + TimescaleDB).

Tables (all hypertables):
  eaglei_outages       15-minute EAGLE-I customers out per county (GA, SC) for each storm window
  plan_changes         plan versions from public/data/plan/insights/plan-changes.json (if present)
  simulation_runs      Monte Carlo run summaries (pipeline cache + published meta.json)
Plus a plain county_info dimension table and the continuous aggregate
  outages_hourly       hourly max / avg customers out per storm and county (real-time enabled)
which GET /api/outages reads.

Usage (from pipeline/):
  python -m gridsight.integrations.tiger_load
  python -m gridsight.integrations.tiger_load --only outages --storm helene

Needs TIGER_DATABASE_URL (the service URL from the Tiger console, sslmode=require).
Without it the script prints a note and exits 0. Safe to re-run: every load is
an upsert or a replace.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from gridsight.config import CACHE_DIR
from gridsight.integrations.common import data_dir, env, load_dotenv_local, read_json
from gridsight.integrations.outages import EAGLEI_DIR, files_by_storm, load_storm

SIM_DIR = CACHE_DIR / "response" / "sim"
MCC_FILE = CACHE_DIR / "response" / "eaglei_MCC.csv"

SCHEMA = [
    """CREATE TABLE IF NOT EXISTS eaglei_outages (
        time          timestamptz NOT NULL,
        storm         text        NOT NULL,
        fips          text        NOT NULL,
        state         text        NOT NULL,
        customers_out integer     NOT NULL,
        PRIMARY KEY (storm, fips, time)
    )""",
    """CREATE TABLE IF NOT EXISTS county_info (
        fips      text PRIMARY KEY,
        name      text,
        state     text,
        customers integer
    )""",
    """CREATE TABLE IF NOT EXISTS plan_changes (
        version_date timestamptz NOT NULL,
        project_key  text        NOT NULL,
        change       text        NOT NULL,
        utility      text,
        detail       jsonb,
        PRIMARY KEY (project_key, change, version_date)
    )""",
    """CREATE TABLE IF NOT EXISTS simulation_runs (
        generated_at timestamptz NOT NULL,
        storm        text        NOT NULL,
        mode         text        NOT NULL,
        sims         integer,
        device       text,
        seconds      double precision,
        metrics      jsonb,
        PRIMARY KEY (storm, mode, generated_at)
    )""",
]

HYPERTABLES = {
    "eaglei_outages": ("time", "7 days"),
    "plan_changes": ("version_date", "365 days"),
    "simulation_runs": ("generated_at", "30 days"),
}

CAGG = """CREATE MATERIALIZED VIEW IF NOT EXISTS outages_hourly
WITH (timescaledb.continuous) AS
SELECT storm,
       fips,
       state,
       time_bucket(INTERVAL '1 hour', time) AS bucket,
       max(customers_out)                   AS customers_out_max,
       avg(customers_out)::integer          AS customers_out_avg
FROM eaglei_outages
GROUP BY storm, fips, state, bucket
WITH NO DATA"""


# ---------------------------------------------------------------- schema


def ensure_schema(conn) -> None:
    try:
        conn.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    except Exception as exc:  # already there on Tiger Cloud, or not allowed: carry on
        print(f"note: timescaledb extension: {str(exc).splitlines()[0]}")
    for stmt in SCHEMA:
        conn.execute(stmt)
    for table, (column, chunk) in HYPERTABLES.items():
        try:
            conn.execute(
                f"SELECT create_hypertable('{table}', by_range('{column}', INTERVAL '{chunk}'), if_not_exists => TRUE)"
            )
        except Exception:
            # TimescaleDB < 2.13 signature.
            conn.execute(
                f"SELECT create_hypertable('{table}', '{column}', chunk_time_interval => INTERVAL '{chunk}', "
                f"if_not_exists => TRUE, migrate_data => TRUE)"
            )
    conn.execute(CAGG)
    # Real-time aggregation: queries also see rows not yet materialised.
    conn.execute("ALTER MATERIALIZED VIEW outages_hourly SET (timescaledb.materialized_only = false)")
    conn.execute("CREATE INDEX IF NOT EXISTS outages_hourly_storm_fips ON outages_hourly (storm, fips, bucket)")


# ---------------------------------------------------------------- loaders


def load_counties(conn, root: Path) -> int:
    rows: dict[str, tuple[str, str | None, str | None, int | None]] = {}
    mcc: dict[str, int] = {}
    if MCC_FILE.is_file():
        import csv

        with MCC_FILE.open(encoding="utf-8-sig") as fh:
            for rec in csv.DictReader(fh):
                try:
                    mcc[str(rec["County_FIPS"]).zfill(5)] = int(float(rec["Customers"]))
                except (KeyError, ValueError):
                    continue
    index, _ = read_json("response/storms.json", root)
    for entry in index or []:
        counties, _ = read_json(f"response/{entry['id']}/counties.json", root)
        for c in counties or []:
            fips = str(c["fips"]).zfill(5)
            rows[fips] = (fips, c.get("name"), c.get("state"), c.get("customers") or mcc.get(fips))
    for fips, n in mcc.items():
        if fips[:2] in ("13", "45") and fips not in rows:
            rows[fips] = (fips, None, "GA" if fips.startswith("13") else "SC", n)
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO county_info (fips, name, state, customers) VALUES (%s, %s, %s, %s)
               ON CONFLICT (fips) DO UPDATE SET name = COALESCE(EXCLUDED.name, county_info.name),
                   state = EXCLUDED.state, customers = COALESCE(EXCLUDED.customers, county_info.customers)""",
            list(rows.values()),
        )
    return len(rows)


def load_outages(conn, root: Path, storms: list[str] | None) -> int:
    by_storm = files_by_storm(root)
    if not by_storm:
        print(f"No EAGLE-I files under {EAGLEI_DIR}. Run the response pipeline's EAGLE-I fetch first "
              "(or set GRIDSIGHT_CACHE to the folder that holds response/eaglei/).")
        return 0
    total = 0
    for storm, files in sorted(by_storm.items()):
        if storms and storm not in storms:
            continue
        df = load_storm(files)
        if df.empty:
            continue
        with conn.transaction():
            conn.execute(
                "CREATE TEMP TABLE IF NOT EXISTS _eaglei_stage (time timestamptz, storm text, fips text, "
                "state text, customers_out integer) ON COMMIT DELETE ROWS"
            )
            with conn.cursor() as cur:
                with cur.copy("COPY _eaglei_stage (time, storm, fips, state, customers_out) FROM STDIN") as copy:
                    for t, fips, state, out in zip(df["time"], df["fips"], df["state"], df["customers_out"]):
                        copy.write_row((t.to_pydatetime(), storm, fips, state, int(out)))
                cur.execute(
                    """INSERT INTO eaglei_outages (time, storm, fips, state, customers_out)
                       SELECT time, storm, fips, state, customers_out FROM _eaglei_stage
                       ON CONFLICT (storm, fips, time) DO UPDATE SET customers_out = EXCLUDED.customers_out"""
                )
        total += len(df)
        print(f"outages {storm}: {len(df):,} rows from {', '.join(f.path.name for f in files)}")
    return total


def refresh_aggregate(conn) -> None:
    # Must run outside a transaction block (the connection is in autocommit mode).
    conn.execute("CALL refresh_continuous_aggregate('outages_hourly', NULL, NULL)")


def _date(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and 1900 < value < 2200:
        return datetime(int(value), 1, 1, tzinfo=timezone.utc)
    s = str(value).strip()
    for fmt, n in (("%Y-%m-%dT%H:%M:%SZ", 20), ("%Y-%m-%d", 10), ("%Y-%m", 7), ("%Y", 4)):
        try:
            return datetime.strptime(s[:n], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _records(doc: Any) -> list[dict[str, Any]]:
    if isinstance(doc, list):
        return [r for r in doc if isinstance(r, dict)]
    if isinstance(doc, dict):
        for key in ("changes", "items", "records", "projects", "versions"):
            if isinstance(doc.get(key), list):
                return [r for r in doc[key] if isinstance(r, dict)]
    return []


def load_plan_changes(conn, root: Path) -> int:
    doc, _ = read_json("plan/insights/plan-changes.json", root, fixtures=False)
    if doc is None:
        print("plan changes: plan/insights/plan-changes.json not found, skipped")
        return 0
    rows = []
    for r in _records(doc):
        when = next((d for d in (_date(r.get(k)) for k in
                    ("versionDate", "version", "date", "planYear", "year", "to", "toVersion", "asOf")) if d), None)
        key = r.get("projectId") or r.get("id") or r.get("name") or r.get("project")
        if not when or not key:
            continue
        change = str(r.get("change") or r.get("type") or r.get("kind") or "listed")
        rows.append((when, str(key), change, r.get("utility"), json.dumps(r, default=str)))
    with conn.transaction():
        conn.execute("DELETE FROM plan_changes")
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO plan_changes (version_date, project_key, change, utility, detail)
                   VALUES (%s, %s, %s, %s, %s::jsonb) ON CONFLICT DO NOTHING""",
                rows,
            )
    print(f"plan changes: {len(rows)} rows")
    return len(rows)


def load_simulations(conn, root: Path) -> int:
    rows = []
    for path in sorted(SIM_DIR.glob("*.json")) if SIM_DIR.is_dir() else []:
        try:
            s = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        when = _date(s.get("generatedAt"))
        if not when or not s.get("storm"):
            continue
        metrics = {k: v for k, v in s.items() if k not in ("storm", "mode", "sims", "device", "seconds", "generatedAt")}
        rows.append((when, s["storm"], s.get("mode") or "unknown", s.get("sims"), s.get("device"),
                     s.get("seconds"), json.dumps(metrics)))
    index, _ = read_json("response/storms.json", root, fixtures=False)
    for entry in index or []:
        meta, _ = read_json(f"response/{entry['id']}/meta.json", root, fixtures=False)
        when = _date((meta or {}).get("generatedAt"))
        if not meta or not when:
            continue
        metrics = {"validation": meta.get("validation"), "crossValidation": meta.get("crossValidation")}
        rows.append((when, entry["id"], "published", meta.get("simulations"), meta.get("device"), None,
                     json.dumps(metrics)))
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO simulation_runs (generated_at, storm, mode, sims, device, seconds, metrics)
               VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
               ON CONFLICT (storm, mode, generated_at) DO UPDATE SET sims = EXCLUDED.sims,
                   device = EXCLUDED.device, seconds = EXCLUDED.seconds, metrics = EXCLUDED.metrics""",
            rows,
        )
    print(f"simulation runs: {len(rows)} rows")
    return len(rows)


# ---------------------------------------------------------------- main


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", help="read public data from here (default public/data)")
    ap.add_argument("--only", nargs="*", choices=["outages", "plan", "sims"], help="load only these parts")
    ap.add_argument("--storm", nargs="*", help="only these storms (outages)")
    args = ap.parse_args(argv)

    load_dotenv_local()
    url = env("TIGER_DATABASE_URL")
    if not url:
        print("TIGER_DATABASE_URL not set: skipping the Tiger Data load.")
        return 0
    try:
        import psycopg
    except ImportError:
        print("psycopg is not installed: pip install -r pipeline/requirements-integrations.txt")
        return 1

    root = data_dir(args.data_dir)
    parts = set(args.only or ["outages", "plan", "sims"])
    try:
        conn = psycopg.connect(url, autocommit=True, connect_timeout=15, application_name="mrgridy-loader")
    except psycopg.OperationalError as exc:
        print(f"Could not connect to Tiger Data: {str(exc).splitlines()[0]}")
        return 1
    with conn:
        ensure_schema(conn)
        if "outages" in parts:
            print(f"counties: {load_counties(conn, root)} rows")
            if load_outages(conn, root, args.storm):
                refresh_aggregate(conn)
                n = conn.execute("SELECT count(*) FROM outages_hourly").fetchone()[0]
                print(f"outages_hourly refreshed: {n:,} hourly rows")
        if "plan" in parts:
            load_plan_changes(conn, root)
        if "sims" in parts:
            load_simulations(conn, root)
    print("Tiger Data load complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

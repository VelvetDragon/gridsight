"""Cost of a power outage per customer-hour, for Dominion Energy SC and Georgia Power.

Output: public/data/response/outage-cost.json (one file for every storm)

    {
      "dollarYear": 2023,
      "utilities": {
        "DESC" | "GPC": {
          "state": "SC" | "GA",
          "customers": {"residential": int, "nonResidential": int, "total": int},
          "stateShare": number,            // utility customers / all customers in the state
          "residentialKwh": number,        // average annual kWh per customer
          "nonResidentialKwh": number,
          "residentialUsdPerHour": number, // one more hour of an outage already 8+ h long
          "nonResidentialUsdPerHour": number,
          "usdPerCustomerHour": number     // weighted by the utility's customer mix
        }
      },
      "sources": [{"label": str, "url": str}],
      "assumptions": [str]
    }

Method
  Interruption cost per event (2023$) from the LBNL ICE Calculator 2.0 Phase 1 report
  (Tables 3.5 and 4.6): residential and non-residential, at 8 and 24 hours. The storm
  outages here last longer than 8 hours, so an extra hour of outage is priced at the
  8-to-24-hour slope, (cost 24 h - cost 8 h) / 16.

  Location enters three ways, all from EIA-861 (2024) for each utility:
    * customer mix: residential vs commercial + industrial customers;
    * usage: average kWh per customer, scaled with the usage elasticity implied by the
      report's 5th / 95th percentile examples at 24 hours (ICE 2.0 uses annual kWh as an
      input; its coefficients are not published, so the elasticity is read off those points);
    * state share: the utility's share of all customers in its state, used by the web app
      to turn a state's predicted outages into the utility's customers.
  Season: hurricanes hit in ICE's "summer" season, so residential cost is scaled by the
  report's summer / average ratio at 24 hours (49.46 / 54.52).
"""

from __future__ import annotations

import math
import zipfile

import pandas as pd

from gridsight.config import RESPONSE_OUT
from gridsight.response.common import RAW_DIR, write_json

EIA861_URL = "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip"
EIA861_SHEET = "Sales_Ult_Cust_2024.xlsx"
ICE_REPORT_URL = "https://eta-publications.lbl.gov/sites/default/files/2025-06/ice_2.0_phase_i_final_report_29may2025.pdf"
EIA_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"}

UTILITIES = {"DESC": {"eia_id": 17539, "state": "SC"}, "GPC": {"eia_id": 7140, "state": "GA"}}

# ICE 2.0 Phase 1 final report (2023$). Table 3.5 (residential) and Table 4.6 (non-residential):
# cost per event and cost per unserved kWh.
ICE = {
    "residential": {"event8h": 25.55, "event24h": 54.52, "perKwh24h": 1.86,
                    # Figure 3.7: 5th / 95th percentile usage and 24-hour cost
                    "p5": (1959, 52.19), "p95": (23653, 57.82)},
    "nonResidential": {"event8h": 6172.0, "event24h": 12646.0, "perKwh24h": 38.0,
                       # Figure 4.8
                       "p5": (3518, 1552.0), "p95": (9273992, 187690.0)},
}
SUMMER_FACTOR = 49.46 / 54.52  # Figure 3.8: 24-hour summer cost / average cost (residential)


def eia_download(dest):
    """EIA blocks non-browser user agents, so the zip is fetched with a browser one."""
    import requests

    if dest.exists() and zipfile.is_zipfile(dest):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(EIA861_URL, headers=EIA_UA, timeout=600)
    r.raise_for_status()
    dest.write_bytes(r.content)
    if not zipfile.is_zipfile(dest):
        dest.unlink()
        raise SystemExit(f"EIA-861 download did not return a zip: {EIA861_URL}")
    return dest


def eia861() -> pd.DataFrame:
    path = eia_download(RAW_DIR / "f8612024.zip")
    with zipfile.ZipFile(path) as z, z.open(EIA861_SHEET) as fh:
        df = pd.read_excel(fh, header=[0, 1, 2])
    df.columns = [" | ".join(str(x) for x in c if "Unnamed" not in str(x)) for c in df.columns]
    out = pd.DataFrame({
        "id": pd.to_numeric(df["Utility Characteristics | Utility Number"], errors="coerce"),
        "state": df["Utility Characteristics | State"],
        "part": df["Utility Characteristics | Part"],
    })
    for cls in ("RESIDENTIAL", "COMMERCIAL", "INDUSTRIAL", "TRANSPORTATION", "TOTAL"):
        out[f"{cls}_cust"] = pd.to_numeric(df[f"{cls} | Customers | Count"], errors="coerce").fillna(0)
        out[f"{cls}_mwh"] = pd.to_numeric(df[f"{cls} | Sales | Megawatthours"], errors="coerce").fillna(0)
    return out


def elasticity(c: dict) -> float:
    (k5, c5), (k95, c95) = c["p5"], c["p95"]
    return math.log(c95 / c5) / math.log(k95 / k5)


def average_kwh(c: dict) -> float:
    """Average annual kWh behind the ICE averages: 24-h cost / cost per unserved kWh = kWh in 24 h."""
    return c["event24h"] / c["perKwh24h"] * 365


def usd_per_hour(c: dict, kwh: float, season: float = 1.0) -> float:
    slope = (c["event24h"] - c["event8h"]) / 16.0
    return slope * (kwh / average_kwh(c)) ** elasticity(c) * season


def build() -> dict:
    df = eia861()
    # Customers per state: bundled (A) + delivery-only (C) service, so choice customers count once.
    state_total = df[df.part.isin(["A", "C"])].groupby("state")["TOTAL_cust"].sum()
    utils = {}
    for key, u in UTILITIES.items():
        r = df[(df.id == u["eia_id"]) & (df.state == u["state"])].sum(numeric_only=True)
        res = int(r["RESIDENTIAL_cust"])
        nonres = int(r["COMMERCIAL_cust"] + r["INDUSTRIAL_cust"] + r["TRANSPORTATION_cust"])
        res_kwh = r["RESIDENTIAL_mwh"] * 1000 / max(res, 1)
        non_kwh = (r["COMMERCIAL_mwh"] + r["INDUSTRIAL_mwh"] + r["TRANSPORTATION_mwh"]) * 1000 / max(nonres, 1)
        res_h = usd_per_hour(ICE["residential"], res_kwh, SUMMER_FACTOR)
        non_h = usd_per_hour(ICE["nonResidential"], non_kwh)
        total = res + nonres
        utils[key] = {
            "state": u["state"],
            "customers": {"residential": res, "nonResidential": nonres, "total": total},
            "stateShare": round(total / float(state_total[u["state"]]), 3),
            "residentialKwh": round(res_kwh),
            "nonResidentialKwh": round(non_kwh),
            "residentialUsdPerHour": round(res_h, 2),
            "nonResidentialUsdPerHour": round(non_h, 1),
            "usdPerCustomerHour": round((res * res_h + nonres * non_h) / total, 2),
        }
    er, en = elasticity(ICE["residential"]), elasticity(ICE["nonResidential"])
    return {
        "dollarYear": 2023,
        "utilities": utils,
        "sources": [
            {"label": "LBNL ICE Calculator 2.0 Phase 1 final report (2025), Tables 3.5 and 4.6, Figures 3.7, 3.8, 4.8", "url": ICE_REPORT_URL},
            {"label": "EIA-861 2024, Sales to Ultimate Customers (customers and MWh by class)", "url": EIA861_URL},
        ],
        "assumptions": [
            "Cost of one more hour without power = ICE 2.0 cost per event at 24 h minus 8 h, divided by 16 (storm outages last longer than 8 hours; ICE does not estimate past 24 hours).",
            f"Residential: ${ICE['residential']['event8h']} (8 h) and ${ICE['residential']['event24h']} (24 h) per event, scaled to summer (x {SUMMER_FACTOR:.3f}, hurricane season).",
            f"Non-residential: ${ICE['nonResidential']['event8h']:,.0f} (8 h) and ${ICE['nonResidential']['event24h']:,.0f} (24 h) per event (commercial, industrial and transportation customers).",
            f"Location: each utility's customer mix and average annual kWh from EIA-861 (2024); cost scales with usage^{er:.3f} (residential) and usage^{en:.3f} (non-residential), read off the report's 5th/95th percentile examples.",
            "ICE 2.0 Phase 1 surveyed eight utilities' customers, including Dominion Energy and Duke Energy; no Georgia utility took part.",
            "2023 dollars, not adjusted for inflation.",
        ],
    }


def main() -> None:
    out = build()
    for k, u in out["utilities"].items():
        print(f"{k} ({u['state']}): ${u['usdPerCustomerHour']}/customer-hour "
              f"(residential ${u['residentialUsdPerHour']}, non-residential ${u['nonResidentialUsdPerHour']}), "
              f"{u['customers']['total']:,} customers, {u['stateShare']:.0%} of the state")
    write_json("outage-cost.json", out, RESPONSE_OUT)


if __name__ == "__main__":
    main()

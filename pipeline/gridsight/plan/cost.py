"""Rough, fully documented savings estimate for one overlap (bonus).

Components
----------
landSavingsUsd       sharedAcres x state farm real estate value per acre, only when
                     one of the two projects is a new line (co-locating avoids
                     buying that strip once). Rebuilds reuse their own right-of-way.
mobilizationSavingsUsd  MOBILIZATION_SHARE x DESC project cost x SHARED_FRACTION when
                     build windows overlap (one mobilisation serves both). Georgia
                     Power costs are redacted in its public filings, so only the
                     DESC side is counted.
yardSavingsUsd       YARD_COST_USD when the projects are within the logistics tier
                     (<= 8 km) and build windows overlap (one laydown yard instead
                     of two).
"""

from __future__ import annotations

from shapely.geometry import LineString

# USDA NASS, Land Values 2025 Summary (August 2025), Farm Real Estate Average
# Value per Acre, 2025, page 9: Georgia $4,720, South Carolina $4,740.
NASS_URL = "https://www.nass.usda.gov/Publications/Todays_Reports/reports/land0825.pdf"
LAND_VALUE = {"GA": 4720.0, "SC": 4740.0}

# Typical cross-country easement widths, Georgia Transmission Corp. fact sheet
# "Transmission Line Heights and Easement Widths" (2017): 115 kV 100 ft,
# 230 kV 100-125 ft, 500 kV 150-180 ft. We take the low end. 46 kV is not listed:
# 50 ft is our assumption.
GTC_URL = "https://www.gatransmission.com/wp-content/uploads/2017/09/GTC_PoleHeightsFactSheet.pdf"
ROW_FT = [(500, 150.0), (230, 100.0), (115, 100.0), (0, 50.0)]

MOBILIZATION_SHARE = 0.03  # assumption: mobilisation/demobilisation ~3% of construction cost
SHARED_FRACTION = 0.5  # assumption: sharing one mobilisation saves half of it
YARD_COST_USD = 150_000.0  # assumption: one laydown/staging yard (lease, prep, security, restoration)
ROW_SHARE_KM = 1.6
ACRES_PER_SQ_M = 1 / 4046.8564224
FT = 0.3048


def row_width_ft(kv: list[int]) -> float:
    v = max(kv) if kv else 0
    for limit, ft in ROW_FT:
        if v >= limit:
            return ft
    return 50.0


def shared_corridor_km(desc_geom, gpc_geom) -> float:
    """Length of the DESC line within 1.6 km of the GPC geometry (metric CRS)."""
    if not isinstance(desc_geom, LineString) or not isinstance(gpc_geom, LineString):
        return 0.0  # a corridor is only shared between two lines
    part = desc_geom.intersection(gpc_geom.buffer(ROW_SHARE_KM * 1000))
    return round(part.length / 1000.0, 2)


def estimate(desc: dict, gpc: dict, tier: str, months: float) -> dict:
    assumptions: list[str] = []
    shared_km = shared_corridor_km(desc["_metric"], gpc["_metric"])
    new_line = [p for p in (desc, gpc) if p["kind"] == "line" and p["action"] == "new"]
    width_ft = row_width_ft(new_line[0]["voltageKv"]) if new_line else row_width_ft(desc["voltageKv"])
    acres = shared_km * 1000 * width_ft * FT * ACRES_PER_SQ_M if new_line else 0.0
    state = new_line[0]["state"] if new_line else desc["state"]
    land_value = LAND_VALUE[state]
    land = acres * land_value
    assumptions.append(
        f"Shared corridor = length of the DESC line within {ROW_SHARE_KM} km of the Georgia Power project "
        f"({shared_km} km)."
    )
    if new_line and shared_km > 0:
        assumptions.append(
            f"Right-of-way width {width_ft:.0f} ft for {max(new_line[0]['voltageKv'] or [0])} kV "
            f"(Georgia Transmission Corp. typical easement widths, {GTC_URL})."
        )
        assumptions.append(
            f"Land value ${land_value:,.0f}/acre = USDA NASS 2025 average farm real estate value for {state} "
            f"({NASS_URL}, p. 9); co-locating the new line avoids buying the shared strip once."
        )
    elif new_line:
        assumptions.append("No land saving: the two projects do not run within 1.6 km of each other as lines.")
    else:
        assumptions.append("No land saving: neither project is a new line, so both reuse existing right-of-way.")
    mob = 0.0
    if months > 0 and desc.get("costUsd"):
        mob = desc["costUsd"] * MOBILIZATION_SHARE * SHARED_FRACTION
        assumptions.append(
            f"Mobilization ~{MOBILIZATION_SHARE:.0%} of the DESC project cost (${desc['costUsd'] / 1e6:,.1f}M), "
            f"half saved by mobilizing once (assumption). Georgia Power costs are redacted in its public "
            f"filings, so its side is not counted."
        )
    elif months <= 0:
        assumptions.append("No mobilization saving: build windows do not overlap.")
    yard = 0.0
    if tier in ("crossing", "row", "logistics") and months > 0:
        yard = YARD_COST_USD
        assumptions.append(f"One shared laydown yard avoids a second one: ${YARD_COST_USD:,.0f} (assumption).")
    total = land + mob + yard
    return {
        "sharedCorridorKm": shared_km,
        "sharedAcres": round(acres, 1),
        "landValuePerAcreUsd": land_value,
        "landSavingsUsd": round(land),
        "mobilizationSavingsUsd": round(mob),
        "yardSavingsUsd": round(yard),
        "totalUsd": round(total),
        "assumptions": assumptions,
    }

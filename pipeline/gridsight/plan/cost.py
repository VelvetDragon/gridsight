"""Coordination savings for one overlap, as a low / central / high range with sources.

`totalUsd` in overlaps.json is the central estimate; the first line of
`cost.assumptions` states the range, and public/data/plan/insights/cost-ranges.json
carries every component's low / central / high value:

    // public/data/plan/insights/cost-ranges.json
    interface CostRange {
      overlapId: string;
      lowUsd: number; centralUsd: number; highUsd: number;
      components: Record<"land" | "permits" | "mobilization" | "yard", { low: number; central: number; high: number }>;
    }
    type CostRangesFile = CostRange[];

Components and sources
----------------------
land          Only when one project is a NEW line and the two lines run within
              1.6 km (co-locating avoids buying that strip once).
              acres = shared corridor length x easement width (Georgia Transmission
              Corp. fact sheet: 115 kV 100 ft, 230 kV 100-125 ft, 500 kV 150-180 ft).
              low     = acres x USDA NASS 2025 farm real estate $/acre (GA $4,720, SC $4,740)
              central = acres x (NASS value + MISO acquisition cost $14,247/acre)
              high    = acres x (3 x NASS value + $14,247)  (MISO: cropland = 3x pasture)
              MISO Transmission Cost Estimation Guide for MTEP24, section 2.1 and Table 2.1.
permits       Same shared acres x MISO regulatory and permitting cost $2,968/acre
              (Table 2.1); low = half (one joint filing still costs something).
mobilization  One mobilisation/demobilisation avoided when build windows overlap:
              the smaller of the two projects' MISO unit costs (MTEP 2018 guide:
              line 69-115 kV $100k, 138-161 kV $150k, 230 kV $200k, 345 kV $250k,
              500 kV $300k, section 4.1.1.3; substation new site $262,660, existing
              site $157,590, section 4.2.1.2). These are 2018 dollars.
              low = 50% (only part of the crew moves once), central = 100%,
              high = escalated to 2025 dollars at 5%/yr (the escalation rate MISO
              states in the MTEP24 guide, p. 1).
yard          Team assumption (no published unit cost found; MISO folds laydown
              yards into material delivery costs): one laydown yard avoided when the
              projects are within 8 km and build windows overlap. $50k / $150k / $300k.

Neither utility's budget is used: Georgia Power does not publish project costs
(its SERTP entries carry none), so the estimate relies on unit costs by voltage
and would grow with the actual scopes.
"""

from __future__ import annotations

from shapely.geometry import LineString

NASS_URL = "https://www.nass.usda.gov/Publications/Todays_Reports/reports/land0825.pdf"
LAND_VALUE = {"GA": 4720.0, "SC": 4740.0}  # USDA NASS Land Values 2025 Summary, p. 9

GTC_URL = "https://www.gatransmission.com/wp-content/uploads/2017/09/GTC_PoleHeightsFactSheet.pdf"
ROW_FT = [(500, 150.0), (230, 100.0), (115, 100.0), (0, 50.0)]  # 46-69 kV: 50 ft team assumption

MISO24_URL = ("https://cdn.misoenergy.org/20240501%20PSC%20Item%2004%20MISO%20Transmission%20Cost%20"
              "Estimation%20Guide%20for%20MTEP24632680.pdf")
MISO18_URL = "https://cdn.misoenergy.org/Transmission-and-Substation-Project-Cost-Estimation-Guide-for-MTEP-2018144804.pdf"
ACQUISITION_PER_ACRE = 14247.0  # MTEP24 Table 2.1
PERMITTING_PER_ACRE = 2968.0  # MTEP24 Table 2.1 (all states except MN, ND, SD, WI)
CROP_MULTIPLIER = 3.0  # MTEP24 section 2.1
MOB_LINE = [(500, 300_000.0), (345, 250_000.0), (230, 200_000.0), (138, 150_000.0), (0, 100_000.0)]  # MTEP 2018 4.1.1.3
MOB_SUB_NEW, MOB_SUB_EXISTING = 262_660.0, 157_590.0  # MTEP 2018 4.2.1.2
ESCALATION = 1.05 ** 7  # 2018 -> 2025 at MISO's 5%/yr
YARD = (50_000.0, 150_000.0, 300_000.0)  # team assumption

ROW_SHARE_KM = 1.6
ACRES_PER_SQ_M = 1 / 4046.8564224
FT = 0.3048


def row_width_ft(kv: list[int]) -> float:
    v = max(kv) if kv else 0
    for limit, ft in ROW_FT:
        if v >= limit:
            return ft
    return 50.0


def mobilization_unit(p: dict) -> float:
    if p["kind"] == "substation":
        return MOB_SUB_NEW if p["action"] == "new" else MOB_SUB_EXISTING
    v = max(p["voltageKv"]) if p["voltageKv"] else 0
    for limit, usd in MOB_LINE:
        if v >= limit:
            return usd
    return 100_000.0


def shared_corridor_km(desc_geom, gpc_geom) -> float:
    """Length of the DESC line within 1.6 km of the Georgia Power line (metric CRS)."""
    if not isinstance(desc_geom, LineString) or not isinstance(gpc_geom, LineString):
        return 0.0  # a corridor is only shared between two lines
    part = desc_geom.intersection(gpc_geom.buffer(ROW_SHARE_KM * 1000))
    return round(part.length / 1000.0, 2)


def _usd(x: float) -> str:
    return f"${x:,.0f}"


def estimate(desc: dict, gpc: dict, tier: str, months: float) -> tuple[dict, dict]:
    """(CostEstimate for overlaps.json, low/central/high components for cost-ranges.json)."""
    notes: list[str] = []
    shared_km = shared_corridor_km(desc["_metric"], gpc["_metric"])
    new_line = [p for p in (desc, gpc) if p["kind"] == "line" and p["action"] == "new"]
    acres = 0.0
    land = permits = (0.0, 0.0, 0.0)
    value = LAND_VALUE[desc["state"]]
    if new_line and shared_km > 0:
        width = row_width_ft(new_line[0]["voltageKv"])
        value = LAND_VALUE[new_line[0]["state"]]
        acres = shared_km * 1000 * width * FT * ACRES_PER_SQ_M
        land = (acres * value, acres * (value + ACQUISITION_PER_ACRE),
                acres * (CROP_MULTIPLIER * value + ACQUISITION_PER_ACRE))
        permits = (0.5 * acres * PERMITTING_PER_ACRE, acres * PERMITTING_PER_ACRE, acres * PERMITTING_PER_ACRE)
        notes.append(
            f"Shared corridor {shared_km} km x {width:.0f} ft easement (Georgia Transmission Corp. typical easement "
            f"widths, {GTC_URL}) = {acres:.1f} acres that one co-located new line does not have to buy."
        )
        notes.append(
            f"Land: USDA NASS 2025 farm real estate value {_usd(value)}/acre ({NASS_URL}, p. 9) plus MISO right-of-way "
            f"acquisition cost {_usd(ACQUISITION_PER_ACRE)}/acre; high case uses MISO's cropland multiplier (3x) "
            f"(MISO Transmission Cost Estimation Guide for MTEP24, section 2.1 and Table 2.1, {MISO24_URL})."
        )
        notes.append(
            f"Permits: MISO regulatory and permitting cost {_usd(PERMITTING_PER_ACRE)}/acre (MTEP24 Table 2.1) on the "
            f"shared acres; included in the land figure. Low case assumes half is saved by filing jointly."
        )
    elif new_line:
        notes.append("No land saving: the new line does not run within 1.6 km of the other project's line.")
    else:
        notes.append("No land saving: neither project is a new line, so both reuse existing right-of-way (MISO "
                     "assumes no new right-of-way for rebuilds, MTEP24 section 2.1).")

    mob = (0.0, 0.0, 0.0)
    if months > 0:
        unit = min(mobilization_unit(desc), mobilization_unit(gpc))
        mob = (0.5 * unit, unit, unit * ESCALATION)
        notes.append(
            f"Mobilization: one mobilization/demobilization avoided, {_usd(unit)} = the smaller of the two projects' "
            f"MISO unit costs (MTEP 2018 guide, sections 4.1.1.3 and 4.2.1.2, 2018 dollars, {MISO18_URL}); low 50%, "
            f"high escalated to 2025 at MISO's 5%/yr."
        )
    else:
        notes.append("No mobilization saving: the estimated build windows do not overlap.")

    yard = (0.0, 0.0, 0.0)
    if tier in ("crossing", "row", "logistics") and months > 0:
        yard = YARD
        notes.append(
            f"Yard: one shared laydown yard, {_usd(YARD[0])} to {_usd(YARD[2])} (team assumption; no published unit "
            f"cost found, MISO folds laydown yards into material delivery)."
        )
    notes.append(
        "Counts no utility budget: Georgia Power does not publish its project costs, so its share of the savings "
        "would add more; DESC's disclosed costs are not needed for these unit-cost components."
    )
    low = land[0] + permits[0] + mob[0] + yard[0]
    central = land[1] + permits[1] + mob[1] + yard[1]
    high = land[2] + permits[2] + mob[2] + yard[2]
    notes.insert(0, f"Range: {_usd(low)}–{_usd(high)} (central {_usd(central)}; low/high assumptions below).")
    est = {
        "sharedCorridorKm": shared_km,
        "sharedAcres": round(acres, 1),
        "landValuePerAcreUsd": value,
        "landSavingsUsd": round(land[1] + permits[1]),
        "mobilizationSavingsUsd": round(mob[1]),
        "yardSavingsUsd": round(yard[1]),
        "totalUsd": round(central),
        "assumptions": notes,
    }
    comp = {
        "lowUsd": round(low), "centralUsd": round(central), "highUsd": round(high),
        "components": {
            name: {"low": round(v[0]), "central": round(v[1]), "high": round(v[2])}
            for name, v in (("land", land), ("permits", permits), ("mobilization", mob), ("yard", yard))
        },
    }
    return est, comp

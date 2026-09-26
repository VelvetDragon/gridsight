"""Georgia Power projects that are published on web pages rather than in a table.

Each record below is transcribed from the cited public page; the quoted facts are
the only inputs. Nothing here is estimated except where a field says so
(build windows without a published in-service date use the typical build time
from overlap.BUILD_MONTHS and are flagged in the description).
"""

from __future__ import annotations

from gridsight.plan.records import RawProject

GP = "https://www.georgiapower.com/about/grid-reliability/grid-improvements/grid-projects"
SERTP_Q2 = "https://www.southeasternrtp.com/docs/general/2026/2026_SERTP_2nd_Qtr_Presentation.pdf"
PRESS = (
    "https://www.georgiapower.com/news-hub/press-releases/"
    "georgia-power-requests-certification-of-approximately-9900-mw-of-new-resources-from-the-georgia-psc.html"
)


def records() -> list[RawProject]:
    return [
        RawProject(
            id="gpc-web-callaway-thomson",
            utility="GPC",
            owner="GPC",
            name="Callaway Road – Thomson Primary 500 kV Area Transmission Project",
            kind="line",
            action="new",
            description=(
                "New 500/230 kV Callaway Road Substation in Columbia County and about 17 miles of new 500 kV "
                "line (Callaway Road–Thomson #1 about 10 mi, #2 about 7 mi) in McDuffie and Columbia counties, "
                "to serve a large-load customer. Published timeline: substation construction begins Spring 2027, "
                "line clearing and construction Summer 2027. No in-service date is published; the Callaway Road "
                "site is not public, so the project is drawn at the Thomson Primary end with a 10-mile "
                "uncertainty radius."
            ),
            voltage_kv=[500, 230],
            miles=17.0,
            places=["Callaway Road", "Thomson Primary"],
            route=["Thomson Primary"],
            in_service=None,
            cost_usd=None,
            status="Planning (Georgia Power project page)",
            state="GA",
            source_document="Georgia Power: Callaway Road – Thomson Primary 500 kV Area Transmission Project",
            source_url=f"{GP}/transmission-projects/callaway-thomson.html",
            source_page=None,
            build_window=("2027-03-20", None),  # construction start from the page; end estimated later
            notes=["Anchored at Thomson Primary; exact route and Callaway Road site not public."],
        ),
        RawProject(
            id="gpc-web-effingham-500",
            utility="GPC",
            owner="GPC",
            name="Effingham County 500 kV Area Transmission Project",
            kind="substation",
            action="new",
            description=(
                "New 500/230 kV Effingham County Substation, new 500 kV transmission infrastructure and "
                "associated facilities to serve a large-load customer. Published timeline: substation clearing "
                "and grading Spring 2027, substation construction begins Fall 2027. Georgia Power states that a "
                "project map is not yet available, so the project is placed at the Effingham County centroid "
                "(county-level location only)."
            ),
            voltage_kv=[500, 230],
            miles=None,
            places=["Effingham County"],
            route=[],
            in_service=None,
            cost_usd=None,
            status="Planning (Georgia Power project page)",
            state="GA",
            source_document="Georgia Power: Effingham County 500 kV Area Transmission Project",
            source_url=f"{GP}/transmission-projects/effingham-county.html",
            source_page=None,
            build_window=("2027-09-22", None),
            county="Effingham",
        ),
        RawProject(
            id="gpc-web-thomson-vogtle",
            utility="GPC",
            owner="GPC",
            name="Thomson – Vogtle 500 kV Transmission Line",
            kind="line",
            action="new",
            description=(
                "55-mile 500 kV line from Plant Vogtle (Burke County) to Thomson Primary substation (McDuffie "
                "County) through Burke, Jefferson, Warren and McDuffie counties, built to support Vogtle Units 3 "
                "and 4. Georgia Power's page lists line construction January 2014 to December 2017 and "
                "'Line in service: 2018'. This is a completed line, not future construction; it is included only "
                "because Sperry named it, and it has no build-window overlap with any DESC plan."
            ),
            voltage_kv=[500],
            miles=55.0,
            places=["Thomson Primary", "Vogtle"],
            route=["Vogtle", "Thomson Primary"],
            in_service="2018-06-01",
            cost_usd=None,
            status="Completed (in service 2018)",
            state="GA",
            source_document="Georgia Power: Thomson-Vogtle Reliability Project",
            source_url=f"{GP}/thomson-vogtle.html",
            source_page=None,
            build_window=("2014-01-01", "2017-12-31"),
        ),
        RawProject(
            id="gpc-gen-mcintosh-expansion",
            utility="GPC",
            owner="SOCO",
            name="Plant McIntosh expansion (McIntosh 12 combined cycle + McIntosh BESS)",
            kind="substation",
            action="new",
            description=(
                "Generation additions at Georgia Power's Plant McIntosh (Effingham County): the SERTP 2026 Q2 "
                "generation tables list 'McIntosh 12' (natural gas, 744 MW from 2031) and 'McIntosh BESS' "
                "(battery, 250 MW from 2031), alongside uprates of McIntosh CTs 1-8 and units 10 & 11. Georgia "
                "Power's July 31, 2025 certification request lists one 757 MW combined cycle and a 250 MW BESS at "
                "Plant McIntosh. Both connect at the plant switchyard, so the project is drawn at the plant. "
                "In-service is the first summer-peak year in the SERTP table (2031); the 36-month build window "
                "is an assumption for combined-cycle construction."
            ),
            voltage_kv=[500, 230],
            miles=None,
            places=["McIntosh"],
            route=["McIntosh"],
            in_service="2031-06-01",
            cost_usd=None,
            status="Planned generation (SERTP 2026 generation assumptions)",
            state="GA",
            source_document="SERTP 2026 Q2: Southern Company Generation Assumptions (slides 67 and 70)",
            source_url=SERTP_Q2,
            source_page=67,
            build_window=("2028-06-01", "2031-06-01"),
            notes=[f"Also: Georgia Power certification request, July 31, 2025 ({PRESS})."],
        ),
    ]

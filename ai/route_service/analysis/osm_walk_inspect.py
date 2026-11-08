"""Region definitions of the five Busan survey areas (single source of truth for runway_routing and analysis/).

Originally a read-only OSM tag survey; the survey commands (fetch / relations / stats / export / compare) were removed
when the Route service was split out (Jira S15P31E105-381). What remains is what the engine imports:
REGIONS / Region (centers, 3 km boxes), ROOT (data root), SURVEY_TAGS and PED_TYPES (runway_walk_filter).
The region centers and boxes are unchanged (they feed the fast-graph self-test and the env layer bbox).
"""
import os
from dataclasses import dataclass
from pathlib import Path

import osmnx as ox

# data root (data/osm/..., reports/...): RUNWAY_DATA_DIR, default the code root (runway_routing.data.DATA_ROOT와 같은 규칙)
ROOT = Path(os.environ["RUNWAY_DATA_DIR"]).resolve() if os.environ.get("RUNWAY_DATA_DIR") else Path(__file__).resolve().parents[1]

DIST_M = 1500


@dataclass(frozen=True)
class Region:
    key: str
    label: str
    geocode_query: str
    center: tuple[float, float]
    note: str = ""

    @property
    def out(self) -> Path:
        return ROOT / "reports" / f"_osm_{self.key}_work"

    @property
    def cache(self) -> Path:
        return self.out / "overpass_cache"

    @property
    def graph_path(self) -> Path:
        return self.out / "walk_graph_unsimplified.graphml"

    @property
    def features_path(self) -> Path:
        return self.out / "highway_ways_all_tags.geojson"

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        """(west, south, east, north)"""
        return tuple(float(x) for x in ox.utils_geo.bbox_from_point(self.center, dist=DIST_M))


# Centers are fixed Nominatim results (2026-10-22) so reruns do not depend on the geocoder.
REGIONS = {r.key: r for r in [
    Region("gwangalli", "광안리해수욕장", "광안리해수욕장", (35.1508879, 129.1167806)),
    Region("haeundae", "해운대해수욕장", "Haeundae Beach, Busan", (35.1577809, 129.1581318),
           note='"해운대해수욕장" geocodes to (-62.238, -58.767) in Antarctica, so the English name is used'),
    Region("centum", "수영강·센텀시티", "영화의전당", (35.1702867, 129.1278183),
           note="영화의전당 sits between the Suyeong River and the Centum City core"),
    Region("citizenpark", "부산시민공원·서면", "midpoint of 부산시민공원 and 서면역", (35.1635572, 129.0583945),
           note="부산시민공원 (35.1689195, 129.0573380) and 서면역 (35.1581948, 129.0594510)"),
    Region("hwangnyeongsan", "황령산", "황령산", (35.1573354, 129.0819088),
           note="금련산 (35.1497, 129.1110) is ~530 m from the Gwangalli center, so 황령산 was chosen"),
]}

# Tags the request asks about, plus subtags that matter in Korean OSM
# (separately mapped sidewalks are footway=sidewalk, not sidewalk=* on the road).
TARGET_TAGS = ["highway", "name", "surface", "foot", "access", "sidewalk", "lit",
               "smoothness", "maxspeed", "bridge", "tunnel"]
# `oneway` is left out on purpose: OSMnx sets oneway=False on every walk edge,
# so the graph value is not OSM data (the raw key shows up in the key inventory).
EXTRA_TAGS = ["footway", "sidewalk:both", "sidewalk:left", "sidewalk:right", "width",
              "est_width", "incline", "bicycle", "segregated", "lanes",
              "service", "layer", "covered", "crossing", "wheelchair", "step_count",
              "motor_vehicle", "tracktype", "name:en", "expressway", "motorroad", "toll",
              "sac_scale", "handrail"]
SURVEY_TAGS = TARGET_TAGS + EXTRA_TAGS

# Groupings used by the Gwangalli report (section 1: "보행 전용 계열").
PED_TYPES = ["footway", "path", "pedestrian", "steps", "living_street", "track"]

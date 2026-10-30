"""Read-only survey of OpenStreetMap walk-network tags for RunWay course recommendation.

Scope: check which OSM way tags actually exist in Korean OSM data before any
course-recommendation feature or scoring code is written. Nothing is imputed:
a tag that OSM does not carry stays missing.

Every region uses the same 3 km x 3 km bbox (dist=1500 m, dist_type="bbox")
around a fixed center, the same OSMnx walk network and the same metric
definitions. Gwangalli (reports/osm_gwangalli_walk_audit.md) was the first
region; its center, output folder and file names are unchanged.

Environment: OSMnx is not in the locked project .venv, so this runs from a
separate venv (`pip install osmnx==2.1.1 folium==0.20.0`; checked with
geopandas 1.2.0).

Usage (run from the RunWay root, isolated mode; regions default to all):
    <osm-venv>/Scripts/python.exe -I analysis/osm_walk_inspect.py fetch [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/osm_walk_inspect.py relations [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/osm_walk_inspect.py stats [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/osm_walk_inspect.py export [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/osm_walk_inspect.py all [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/osm_walk_inspect.py compare
Regions: gwangalli, haeundae, centum, citizenpark, hwangnyeongsan
Option: --overpass-url=<url> (e.g. https://gall.openstreetmap.de/api, one of the
overpass-api.de backends) when the default endpoint times out.
"""
import itertools
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import folium
import geopandas as gpd
import osmnx as ox
import pandas as pd
import requests
from shapely.geometry import box
from shapely.ops import linemerge

ROOT = Path(__file__).resolve().parents[1]
COMPARISON_CSV = ROOT / "reports" / "osm_region_comparison.csv"
COMPARE_OUT = ROOT / "reports" / "_osm_multi_region_work"

DIST_M = 1500
SEED = 42


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
ROUTE_TYPES = ["hiking", "foot", "running", "fitness_trail", "walking", "bicycle"]

# Groupings used by the Gwangalli report (section 1: "보행 전용 계열").
PED_TYPES = ["footway", "path", "pedestrian", "steps", "living_street", "track"]
MAJOR_ROAD_TYPES = ["primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"]
MINOR_ROAD_TYPES = ["residential", "service", "unclassified"]
NOT_RUNNABLE_TYPES = ["trunk", "trunk_link", "motorway", "motorway_link"]
MISSING_TAGS = ["surface", "sidewalk", "lit", "smoothness", "maxspeed", "foot",
                "name", "access", "bridge", "tunnel", "footway"]
SIDEWALK_KEYS = ["sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right"]


def _setup() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ox.settings.use_cache = True
    ox.settings.log_console = False
    ox.settings.useful_tags_way = sorted(set(ox.settings.useful_tags_way) | set(SURVEY_TAGS))


def _use(r: Region) -> None:
    r.out.mkdir(parents=True, exist_ok=True)
    ox.settings.cache_folder = r.cache


def _present(v) -> bool:
    if isinstance(v, list):
        return any(_present(x) for x in v)
    return v is not None and not (isinstance(v, float) and pd.isna(v)) and str(v) != ""


def _col(df: pd.DataFrame, c: str) -> pd.Series:
    return df[c].astype("object") if c in df.columns else pd.Series(None, index=df.index, dtype="object")


def _not_runnable(ways: pd.DataFrame) -> pd.Series:
    """Ways a runner cannot use even though the OSMnx walk filter keeps them."""
    return (ways["highway"].isin(NOT_RUNNABLE_TYPES) | (_col(ways, "expressway") == "yes")
            | (_col(ways, "toll") == "yes") | (_col(ways, "motorroad") == "yes"))


def _osm_base_stamps(r: Region) -> list[str]:
    stamps = set()
    for f in r.cache.glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and "osm3s" in data:
            stamps.add(data["osm3s"].get("timestamp_osm_base"))
    return sorted(s for s in stamps if s)


def fetch(r: Region) -> None:
    G = ox.graph_from_point(r.center, dist=DIST_M, dist_type="bbox", network_type="walk",
                            simplify=False, retain_all=True)
    ox.save_graphml(G, r.graph_path)
    print("walk graph (directed, unsimplified):", len(G.nodes), "nodes |", len(G.edges), "edges")
    print("wrote", r.graph_path)

    # Every highway=* way with all its tags, to inventory keys OSMnx would not keep
    # and to see which ways the walk filter dropped.
    feats = ox.features_from_point(r.center, tags={"highway": True}, dist=DIST_M)
    ways = feats.loc[feats.index.get_level_values("element") == "way"].reset_index()
    ways = ways.rename(columns={"id": "osmid"})
    for c in ways.columns:
        if c != "geometry" and ways[c].map(lambda x: isinstance(x, list)).any():
            ways[c] = ways[c].map(lambda x: json.dumps(x) if isinstance(x, list) else x)
    ways.to_file(r.features_path, driver="GeoJSON")
    print("highway ways (all tags):", len(ways), "| columns:", ways.shape[1])
    print("wrote", r.features_path)
    print("overpass timestamp_osm_base:", _osm_base_stamps(r))
    (r.out / "fetch_meta.json").write_text(json.dumps({"overpass_url": ox.settings.overpass_url}), encoding="utf-8")


def relations(r: Region) -> None:
    """Route relations (tags only) in the same bbox: is there a mapped course such as 갈맷길?"""
    west, south, east, north = r.bbox
    q = f"[out:json][timeout:60];rel({south},{west},{north},{east})[route];out tags;"
    resp = requests.post(ox.settings.overpass_url + "/interpreter", data={"data": q}, timeout=90,
                         headers={"User-Agent": ox.settings.http_user_agent, "Referer": ox.settings.http_referer})
    resp.raise_for_status()
    data = resp.json()
    (r.out / "route_relations_tags.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    rel = pd.DataFrame([{"id": e["id"]} | {k: e["tags"].get(k) for k in ("route", "name", "network", "ref")}
                        for e in data["elements"]])
    print("overpass timestamp_osm_base:", data["osm3s"]["timestamp_osm_base"], "| route relations:", len(rel))
    if len(rel):
        print(rel.groupby("route").size().to_string())
        print("running-relevant (", ", ".join(ROUTE_TYPES), "):",
              int(rel["route"].isin(ROUTE_TYPES).sum()))
        print(rel[~rel["route"].isin(["bus", "subway", "train", "tram", "ferry"])].to_string(index=False))


def _load_ways(r: Region) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Undirected unsimplified edges -> one row per edge and one row per OSM way."""
    G = ox.load_graphml(r.graph_path)
    Gu = ox.convert.to_undirected(G)
    edges = ox.convert.graph_to_gdfs(Gu, nodes=False).reset_index()
    for t in SURVEY_TAGS:
        if t not in edges.columns:
            edges[t] = None
    # Unsimplified edges carry exactly one osmid each.
    assert not edges["osmid"].map(lambda x: isinstance(x, list)).any()
    agg = {"length": "sum", "u": "size"} | {t: "first" for t in SURVEY_TAGS}
    ways = edges.groupby("osmid").agg(agg).rename(columns={"u": "n_edges"}).reset_index()
    return edges, ways


def _pct(num: float, den: float) -> float:
    return round(100.0 * num / den, 1) if den else 0.0


def stats(reg: Region) -> None:
    OUT = reg.out
    edges, ways = _load_ways(reg)
    total_km = edges["length"].sum() / 1000
    print(f"undirected edges: {len(edges)} | OSM ways: {len(ways)} | total length: {total_km:.2f} km")

    # 1. highway distribution
    hw = (edges.groupby("highway")
          .agg(edges=("u", "size"), km=("length", lambda s: s.sum() / 1000))
          .join(ways.groupby("highway").size().rename("ways")))
    hw["pct_km"] = (100 * hw["km"] / total_km).round(1)
    hw["pct_ways"] = (100 * hw["ways"] / len(ways)).round(1)
    hw = hw[["ways", "pct_ways", "edges", "km", "pct_km"]].sort_values("km", ascending=False)
    hw["km"] = hw["km"].round(2)
    hw.to_csv(OUT / "highway_distribution.csv", encoding="utf-8")
    print("\n=== highway distribution ===")
    print(hw.to_string())

    # 2. tag coverage (present = any non-empty value), by way count and by length
    rows = []
    for t in SURVEY_TAGS:
        w = ways[t].map(_present)
        e = edges[t].map(_present)
        rows.append({"tag": t, "requested": t in TARGET_TAGS,
                     "ways_present": int(w.sum()), "pct_ways": _pct(w.sum(), len(ways)),
                     "pct_edges": _pct(e.sum(), len(edges)),
                     "km_present": round(edges.loc[e, "length"].sum() / 1000, 2),
                     "pct_km": _pct(edges.loc[e, "length"].sum() / 1000, total_km)})
    cov = pd.DataFrame(rows)
    cov["pct_ways_missing"] = (100 - cov["pct_ways"]).round(1)
    cov["pct_km_missing"] = (100 - cov["pct_km"]).round(1)
    cov.to_csv(OUT / "tag_coverage.csv", index=False, encoding="utf-8")
    print("\n=== tag coverage (walk network) ===")
    print(cov.to_string(index=False))

    # 3. coverage per highway type (% of length) — where a tag lives matters
    by_hw = {}
    for h, grp in edges.groupby("highway"):
        L = grp["length"].sum()
        by_hw[h] = {t: _pct(grp.loc[grp[t].map(_present), "length"].sum(), L)
                    for t in SURVEY_TAGS if t != "highway"}
    by_hw = pd.DataFrame(by_hw).T
    by_hw.insert(0, "km", (edges.groupby("highway")["length"].sum() / 1000).round(2))
    by_hw = by_hw.sort_values("km", ascending=False)
    by_hw.to_csv(OUT / "tag_coverage_by_highway.csv", encoding="utf-8")
    print("\n=== % of length with tag present, per highway type ===")
    cols = ["km", "name", "surface", "foot", "access", "sidewalk", "lit", "smoothness",
            "maxspeed", "bridge", "tunnel", "footway", "width", "incline"]
    print(by_hw[cols].to_string())

    # 4. value distributions (per way)
    vals = []
    for t in SURVEY_TAGS:
        if t == "name":
            continue
        vc = ways[t].dropna().astype(str).value_counts()
        for v, c in vc.items():
            vals.append({"tag": t, "value": v, "ways": int(c)})
    vals = pd.DataFrame(vals)
    vals.to_csv(OUT / "tag_values.csv", index=False, encoding="utf-8")
    print("\n=== tag values (ways) ===")
    for t in SURVEY_TAGS:
        if t in ("name", "highway"):
            continue
        sub = vals[vals["tag"] == t]
        if len(sub):
            print(f"{t:14s}", ", ".join(f"{r.value}={r.ways}" for r in sub.head(12).itertuples()))

    # 5. full key inventory over walk-network ways (all OSM tags, not just useful_tags_way)
    allw = gpd.read_file(reg.features_path)
    in_walk = allw[allw["osmid"].isin(ways["osmid"])]
    meta = {"osmid", "element", "geometry", "nodes"}
    keys = [c for c in in_walk.columns if c not in meta]
    inv = pd.DataFrame({"key": keys,
                        "ways_present": [int(in_walk[k].notna().sum()) for k in keys]})
    inv["pct_ways"] = (100 * inv["ways_present"] / len(in_walk)).round(1)
    inv = inv[inv["ways_present"] > 0].sort_values("ways_present", ascending=False)
    inv.to_csv(OUT / "key_inventory_walk_ways.csv", index=False, encoding="utf-8")
    print(f"\n=== all OSM keys on walk-network ways ({len(in_walk)} matched of {len(ways)}) ===")
    print(inv.head(45).to_string(index=False))

    # 6. highway ways in the bbox that the walk filter dropped, and why
    out_walk = allw[~allw["osmid"].isin(ways["osmid"])].copy()

    def reason(r) -> str:
        rs = []
        hwv = str(r.get("highway"))
        if hwv == "cycleway":
            rs.append("highway=cycleway")
        if "motor" in hwv:
            rs.append(f"highway={hwv}")
        # Same values as the OSMnx 2.1.1 walk filter regex.
        if hwv in ("construction", "proposed", "platform", "bus_guideway", "abandoned", "rest_area", "services",
                   "no", "planned", "raceway", "razed"):
            rs.append(f"highway={hwv}")
        for k in ("sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right"):
            if str(r.get(k)) == "separate":
                rs.append(f"{k}=separate")
        if str(r.get("foot")) == "no":
            rs.append("foot=no")
        if str(r.get("access")) == "private":
            rs.append("access=private")
        if str(r.get("service")) == "private":
            rs.append("service=private")
        if str(r.get("area")) == "yes":
            rs.append("area=yes")
        if rs:
            return "; ".join(rs)
        return "crosses bbox edge (truncated)" if r["frac_inside"] < 1 else "unexplained"

    west, south, east, north = reg.bbox
    bbox_poly = box(west, south, east, north)
    out_walk["frac_inside"] = (out_walk.geometry.intersection(bbox_poly).length
                               / out_walk.geometry.length).round(2)
    out_walk["reason"] = out_walk.apply(reason, axis=1)
    is_line = out_walk.geom_type.isin(["LineString", "MultiLineString"])
    out_walk["length_m"] = out_walk.to_crs(out_walk.estimate_utm_crs()).length.round(1).where(is_line)
    out_walk.loc[~is_line, "reason"] += " [area geometry, length not counted]"
    # length_m is the whole way (it can run far outside the bbox); this is the part inside.
    clipped = gpd.GeoSeries(out_walk.geometry.intersection(bbox_poly), crs=out_walk.crs)
    out_walk["length_in_bbox_m"] = clipped.to_crs(out_walk.estimate_utm_crs()).length.round(1).where(is_line)
    ex = (out_walk.groupby(["reason"])
          .agg(ways=("osmid", "size"), km=("length_m", lambda s: round(s.sum() / 1000, 2)))
          .sort_values("km", ascending=False))
    ex.to_csv(OUT / "excluded_by_walk_filter.csv", encoding="utf-8")
    keep = ["osmid", "highway", "name", "sidewalk", "sidewalk:right", "foot", "bicycle", "access",
            "frac_inside", "reason", "length_m"]
    out_walk[[c for c in keep if c in out_walk.columns]].to_csv(
        OUT / "excluded_ways.csv", index=False, encoding="utf-8")
    print(f"\n=== highway ways NOT in walk network: {len(out_walk)} ===")
    print(ex.to_string())
    xh = out_walk.groupby("highway")["length_m"].agg(["size", "sum"])
    xh["sum"] = (xh["sum"] / 1000).round(2)
    print(xh.rename(columns={"size": "ways", "sum": "km"}).sort_values("km", ascending=False).to_string())
    shared = out_walk[(out_walk["highway"] == "cycleway") & _col(out_walk, "foot").isin(["yes", "designated"])]
    print(f"cycleway with foot=yes/designated dropped by walk filter: {len(shared)} ways, "
          f"{shared['length_m'].sum() / 1000:.2f} km", shared["name"].fillna("(no name)").tolist())

    # 7. ways kept by the walk filter that a runner cannot use (expressway / toll / trunk)
    risky = ways[_not_runnable(ways)]
    risky = risky[["osmid", "highway", "name", "expressway", "toll", "bridge", "layer", "foot", "length"]].copy()
    risky["length"] = risky["length"].round(1)
    risky.to_csv(OUT / "walk_ways_not_runnable.csv", index=False, encoding="utf-8")
    print(f"\n=== walk-network ways on trunk / expressway / toll roads: {len(risky)} ways, "
          f"{risky['length'].sum() / 1000:.2f} km ===")
    print(risky.fillna("·").to_string(index=False))

    # 8. stratified random sample of edges (no cherry-picking): 20-30 edges, >=1 per type
    shares = edges["highway"].value_counts(normalize=True)
    target = 25
    while True:
        n_per = (shares * target).round().clip(lower=1).astype(int)
        if n_per.sum() <= 30:
            break
        target -= 1
    parts = [edges[edges["highway"] == h].sample(min(n, (edges["highway"] == h).sum()), random_state=SEED)
             for h, n in n_per.items()]
    show = ["osmid", "length"] + TARGET_TAGS + ["footway", "width", "incline", "lanes", "sac_scale"]
    sample = pd.concat(parts)[show].copy()
    sample["length"] = sample["length"].round(1)
    sample.to_csv(OUT / "sample_edges.csv", index=False, encoding="utf-8")
    print(f"\n=== sample edges ({len(sample)}, stratified random by highway, seed={SEED}) ===")
    with pd.option_context("display.width", 250, "display.max_columns", 30):
        print(sample.fillna("·").to_string(index=False))

    # 9. best case: random edges among those carrying >=2 requested tags besides highway/name
    rich_cols = [t for t in TARGET_TAGS if t not in ("highway", "name")]
    n_tags = edges[rich_cols].map(_present).sum(axis=1)
    rich = edges[n_tags >= 2]
    rich = rich.drop_duplicates("osmid").sample(min(10, rich["osmid"].nunique()), random_state=SEED)[show].copy()
    rich["length"] = rich["length"].round(1)
    rich.to_csv(OUT / "sample_edges_tag_rich.csv", index=False, encoding="utf-8")
    print(f"\n=== tag-rich edges: {int((n_tags >= 2).sum())} of {len(edges)} edges have >=2 of {rich_cols}; "
          f"{len(rich)} random distinct ways shown ===")
    with pd.option_context("display.width", 250, "display.max_columns", 30):
        print(rich.fillna("·").to_string(index=False))

    # 10. one-row summary for the multi-region comparison
    summary = _summary(reg, edges, ways, hw, cov, allw, out_walk, len(sample), int((n_tags >= 2).sum()))
    (OUT / "region_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n=== region summary ===")
    for k, v in summary.items():
        print(f"{k:40s} {v}")


def _summary(r: Region, edges, ways, hw, cov, allw, out_walk, sample_n: int, rich_edges: int) -> dict:
    total_km = edges["length"].sum() / 1000
    west, south, east, north = r.bbox
    s = {"region": r.key, "label": r.label, "geocode_query": r.geocode_query,
         "center_lat": r.center[0], "center_lon": r.center[1],
         "bbox_west": round(west, 6), "bbox_south": round(south, 6),
         "bbox_east": round(east, 6), "bbox_north": round(north, 6),
         "osm_base_network": ";".join(_osm_base_stamps(r)),
         # Regions fetched before fetch_meta.json existed used the OSMnx default endpoint.
         "overpass_url": (json.loads((r.out / "fetch_meta.json").read_text(encoding="utf-8"))["overpass_url"]
                          if (r.out / "fetch_meta.json").exists() else "https://overpass-api.de/api"),
         "highway_ways_in_bbox": len(allw), "walk_ways": len(ways),
         "walk_edges_undirected": len(edges), "walk_km": round(total_km, 2)}

    def km_of(mask) -> float:
        return edges.loc[mask, "length"].sum() / 1000

    groups = {"ped_dedicated": PED_TYPES, "major_road": MAJOR_ROAD_TYPES,
              "minor_road": MINOR_ROAD_TYPES, "trunk_motorway": NOT_RUNNABLE_TYPES}
    for g, types in groups.items():
        km = km_of(edges["highway"].isin(types))
        s[f"{g}_km"], s[f"{g}_pct_km"] = round(km, 2), _pct(km, total_km)
    road = ~edges["highway"].isin(PED_TYPES)
    s["road_total_km"], s["road_total_pct_km"] = round(km_of(road), 2), _pct(km_of(road), total_km)
    grouped = sum(groups.values(), [])
    other = edges.loc[~edges["highway"].isin(grouped), "highway"]
    s["other_hw_km"], s["other_hw_types"] = round(km_of(other.index), 2), "|".join(sorted(other.unique()))

    for t in MISSING_TAGS:
        row = cov.set_index("tag").loc[t]
        s[f"{t}_missing_pct_km"], s[f"{t}_missing_pct_ways"] = row["pct_km_missing"], row["pct_ways_missing"]
    # Where the tags live: dedicated paths vs roads.
    ped = edges["highway"].isin(PED_TYPES)
    for t in ("surface", "lit"):
        has = edges[t].map(_present)
        s[f"{t}_present_pct_km_ped"] = _pct(km_of(ped & has), km_of(ped))
        s[f"{t}_present_pct_km_road"] = _pct(km_of(road & has), km_of(road))
    s["sidewalk_present_pct_km_road"] = _pct(km_of(road & edges["sidewalk"].map(_present)), km_of(road))
    s["footway_sidewalk_km"] = round(km_of(edges["footway"] == "sidewalk"), 2)
    s["footway_crossing_ways"] = int((ways["footway"] == "crossing").sum())

    steps = hw.loc["steps"] if "steps" in hw.index else None
    s["steps_ways"] = int(steps["ways"]) if steps is not None else 0
    s["steps_km"] = float(steps["km"]) if steps is not None else 0.0

    nr = ways[_not_runnable(ways)]
    s["not_runnable_ways"], s["not_runnable_km"] = len(nr), round(nr["length"].sum() / 1000, 2)
    s["not_runnable_names"] = "|".join(sorted(nr["name"].dropna().astype(str).unique()))
    # Supplementary checks (not part of the Gwangalli definition above).
    tun = ways[ways["tunnel"].map(_present) & (ways["tunnel"] != "building_passage")
               & ~ways["highway"].isin(PED_TYPES) & ~_not_runnable(ways)]
    s["road_tunnel_ways"], s["road_tunnel_km"] = len(tun), round(tun["length"].sum() / 1000, 2)
    s["road_tunnel_names"] = "|".join(sorted(tun["name"].dropna().astype(str).unique()))
    # OSMnx only drops access=private; access=no stays unless foot=* grants access.
    foot_ok = ways["foot"].isin(["yes", "designated", "permissive"])
    restricted = ways[((ways["access"] == "no") & ~foot_ok) | (ways["foot"] == "private")]
    s["access_restricted_ways"] = len(restricted)
    s["access_restricted_km"] = round(restricted["length"].sum() / 1000, 2)

    ow = out_walk
    ohw, ofoot = ow["highway"], _col(ow, "foot")
    sep = pd.concat([_col(ow, k) == "separate" for k in SIDEWALK_KEYS], axis=1).any(axis=1)
    excl = {"cycleway_foot_yes_designated": (ohw == "cycleway") & ofoot.isin(["yes", "designated"]),
            "cycleway_no_foot_tag": (ohw == "cycleway") & ofoot.isna(),
            "cycleway_foot_no": (ohw == "cycleway") & (ofoot == "no"),
            "sidewalk_separate_road": sep,
            "foot_no_non_cycleway": (ohw != "cycleway") & (ofoot == "no"),
            "private": (_col(ow, "access") == "private") | (_col(ow, "service") == "private"),
            "area_geometry": ow["length_m"].isna(),
            "truncated_at_bbox": ow["reason"] == "crosses bbox edge (truncated)",
            "unexplained": ow["reason"] == "unexplained"}
    s["excluded_ways"], s["excluded_km"] = len(ow), round(ow["length_m"].sum() / 1000, 2)
    s["excluded_km_in_bbox"] = round(ow["length_in_bbox_m"].sum() / 1000, 2)
    for k, m in excl.items():
        s[f"excl_{k}_ways"], s[f"excl_{k}_km"] = int(m.sum()), round(ow.loc[m, "length_m"].sum() / 1000, 2)
        s[f"excl_{k}_km_in_bbox"] = round(ow.loc[m, "length_in_bbox_m"].sum() / 1000, 2)
    s["excl_cycleway_foot_yes_designated_names"] = "|".join(
        sorted(ow.loc[excl["cycleway_foot_yes_designated"], "name"].dropna().astype(str).unique()))
    s["excl_area_geometry_highways"] = "|".join(sorted(ow.loc[excl["area_geometry"], "highway"].astype(str)))

    rel_path = r.out / "route_relations_tags.json"
    if rel_path.exists():
        data = json.loads(rel_path.read_text(encoding="utf-8"))
        routes = [e["tags"].get("route") for e in data["elements"]]
        s["osm_base_relations"] = data["osm3s"]["timestamp_osm_base"]
        s["route_relations_total"] = len(routes)
        for t in ROUTE_TYPES:
            s[f"route_{t}"] = routes.count(t)
        rel_run = [e for e in data["elements"] if e["tags"].get("route") in ROUTE_TYPES]
        s["route_running_relevant"] = len(rel_run)
        s["route_running_relevant_names"] = "|".join(
            f'{e["tags"].get("route")}:{e["tags"].get("name", "(no name)")}' for e in rel_run)

    s["sample_edges"] = sample_n
    s["tag_rich_edges"], s["tag_rich_pct_edges"] = rich_edges, _pct(rich_edges, len(edges))
    for h, row in hw.iterrows():
        s[f"hw_{h}_ways"], s[f"hw_{h}_km"], s[f"hw_{h}_pct_km"] = int(row["ways"]), row["km"], row["pct_km"]
    return s


HW_COLORS = {"footway": "#1f77b4", "pedestrian": "#9467bd", "path": "#2ca02c", "steps": "#d62728",
             "residential": "#7f7f7f", "service": "#bcbd22", "living_street": "#17becf",
             "unclassified": "#8c564b", "tertiary": "#ff7f0e", "secondary": "#e377c2",
             "secondary_link": "#e377c2", "primary": "#000000", "trunk": "#8b0000",
             "trunk_link": "#8b0000", "track": "#556b2f"}


def export(r: Region) -> None:
    OUT = r.out
    edges, ways = _load_ways(r)
    edges_gdf = gpd.GeoDataFrame(edges, geometry="geometry", crs="EPSG:4326")
    geoms = edges_gdf.groupby("osmid")["geometry"].apply(lambda g: linemerge(list(g)))
    out = gpd.GeoDataFrame(ways.set_index("osmid").join(geoms), geometry="geometry", crs="EPSG:4326")
    out = out.reset_index()
    out["length"] = out["length"].round(1)
    for t in SURVEY_TAGS:
        out[t] = out[t].astype("string")  # GeoJSON-friendly, keeps missing as null
    out = out[["osmid", "length", "n_edges"] + SURVEY_TAGS + ["geometry"]]
    path = OUT / f"{r.key}_walk_ways.geojson"
    out.to_file(path, driver="GeoJSON")
    print("wrote", path, "|", len(out), "ways")

    allw = gpd.read_file(r.features_path)
    excl = allw[~allw["osmid"].isin(ways["osmid"])]
    excl_keep = [c for c in ["osmid", "highway", "name", "sidewalk", "sidewalk:both", "foot", "bicycle", "geometry"]
                 if c in excl.columns]
    excl = excl[excl_keep]
    excl = excl[excl.geom_type.isin(["LineString", "MultiLineString"])]
    xpath = OUT / f"{r.key}_excluded_highways.geojson"
    excl.to_file(xpath, driver="GeoJSON")
    print("wrote", xpath, "|", len(excl), "ways")

    m = folium.Map(location=r.center, zoom_start=15, tiles="OpenStreetMap")
    tip = ["osmid", "highway", "name", "surface", "sidewalk", "lit", "footway", "foot", "bridge", "length"]

    def style(f):
        h = f["properties"].get("highway") or ""
        return {"color": HW_COLORS.get(h, "#444444"), "weight": 3, "opacity": 0.85}

    folium.GeoJson(out[tip + ["geometry"]].to_json(na="null"), name="walk network (by highway)",
                   style_function=style,
                   tooltip=folium.GeoJsonTooltip(fields=tip)).add_to(m)
    for t, color in (("surface", "#e31a1c"), ("lit", "#ff7f00"), ("sidewalk", "#6a3d9a")):
        sub = out[out[t].notna()]
        if sub.empty:
            continue
        folium.GeoJson(sub[tip + ["geometry"]].to_json(na="null"), name=f"{t} present ({len(sub)} ways)",
                       style_function=lambda f, c=color: {"color": c, "weight": 6, "opacity": 0.9},
                       tooltip=folium.GeoJsonTooltip(fields=tip), show=False).add_to(m)
    risky = out[_not_runnable(out)]
    if not risky.empty:
        folium.GeoJson(risky[tip + ["geometry"]].to_json(na="null"),
                       name=f"in walk network but not runnable: trunk/expressway/toll ({len(risky)} ways)",
                       style_function=lambda f: {"color": "#ff0000", "weight": 7, "opacity": 0.9},
                       tooltip=folium.GeoJsonTooltip(fields=tip), show=False).add_to(m)
    xtip = [c for c in excl_keep if c != "geometry"]
    if not excl.empty:
        folium.GeoJson(excl.to_json(na="null"), name=f"excluded by walk filter ({len(excl)} ways)",
                       style_function=lambda f: {"color": "#ff00ff", "weight": 2, "dashArray": "4 4"},
                       tooltip=folium.GeoJsonTooltip(fields=xtip), show=False).add_to(m)
    legend = "".join(f'<div><span style="display:inline-block;width:14px;height:4px;background:{c};'
                     f'margin-right:6px;vertical-align:middle"></span>{h}</div>' for h, c in HW_COLORS.items())
    m.get_root().html.add_child(folium.Element(
        '<div style="position:fixed;bottom:24px;left:12px;z-index:9999;background:white;padding:8px 10px;'
        f'border:1px solid #999;font:12px sans-serif">{legend}</div>'))
    folium.LayerControl(collapsed=False).add_to(m)
    hpath = OUT / f"{r.key}_walk_map.html"
    m.save(hpath)
    print("wrote", hpath)


def compare(regions: list[Region]) -> None:
    """Stack every region_summary.json into one CSV and check how much the regions overlap."""
    COMPARE_OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for r in regions:
        p = r.out / "region_summary.json"
        if not p.exists():
            raise SystemExit(f"missing {p}; run `stats {r.key}` first")
        rows.append(json.loads(p.read_text(encoding="utf-8")))
    df = pd.DataFrame(rows)
    hw_cols = [c for c in df.columns if c.startswith("hw_")]
    df[hw_cols] = df[hw_cols].fillna(0)  # a highway type absent from a region has 0 ways / 0 km
    df[[c for c in hw_cols if c.endswith("_ways")]] = df[[c for c in hw_cols if c.endswith("_ways")]].astype(int)
    types = sorted({c[3:].rsplit("_", 2 if c.endswith("_pct_km") else 1)[0] for c in hw_cols},
                   key=lambda h: -df[f"hw_{h}_km"].sum())
    hw_cols = [f"hw_{h}_{m}" for h in types for m in ("ways", "km", "pct_km")]
    df = df[[c for c in df.columns if not c.startswith("hw_")] + hw_cols]
    df.to_csv(COMPARISON_CSV, index=False, encoding="utf-8-sig")  # BOM so Excel shows Korean labels
    print("wrote", COMPARISON_CSV, "|", df.shape)
    long_text = [c for c in df.columns if c.endswith(("_names", "_types", "_highways", "osm_base_network"))]
    with pd.option_context("display.width", 250, "display.max_rows", 400):
        print(df.drop(columns=long_text).set_index("region").T.to_string())

    # Neighbouring 3 km boxes can overlap; quantify it so shared ways are not mistaken for agreement.
    full_ways = {r.key: _load_ways(r)[1] for r in regions}
    loaded = {k: w.set_index("osmid")["length"] for k, w in full_ways.items()}
    ov = []
    for a, b in itertools.combinations(regions, 2):
        ba, bb = box(*a.bbox), box(*b.bbox)
        shared = loaded[a.key].index.intersection(loaded[b.key].index)
        ov.append({"region_a": a.key, "region_b": b.key,
                   "bbox_overlap_pct": _pct(ba.intersection(bb).area, ba.area),
                   "shared_walk_ways": len(shared),
                   "shared_pct_of_a_km": _pct(loaded[a.key].loc[shared].sum(), loaded[a.key].sum()),
                   "shared_pct_of_b_km": _pct(loaded[b.key].loc[shared].sum(), loaded[b.key].sum())})
    ov = pd.DataFrame(ov)
    ov.to_csv(COMPARE_OUT / "region_overlap.csv", index=False, encoding="utf-8")
    print("\n=== region overlap ===")
    print(ov[ov["shared_walk_ways"] > 0].to_string(index=False) if (ov["shared_walk_ways"] > 0).any()
          else "no shared walk ways")

    # Robustness: the same core metrics on ways no other region contains.
    rob = []
    for r in regions:
        w = full_ways[r.key]
        others = set().union(*(set(full_ways[o.key]["osmid"]) for o in regions if o.key != r.key))
        for subset, sub in (("all", w), ("unique", w[~w["osmid"].isin(others)])):
            rob.append({"region": r.key, "subset": subset, "ways": len(sub)} | _core_metrics(sub))
    rob = pd.DataFrame(rob)
    rob.to_csv(COMPARE_OUT / "region_unique_metrics.csv", index=False, encoding="utf-8")
    print("\n=== core metrics: all ways vs ways not shared with another region ===")
    print(rob.to_string(index=False))


def _core_metrics(ways: pd.DataFrame) -> dict:
    """Length-weighted metrics from way rows (tags are constant within a way)."""
    L = ways["length"].sum()

    def pct(mask) -> float:
        return _pct(ways.loc[mask, "length"].sum(), L)

    m = {"walk_km": round(L / 1000, 2), "ped_dedicated_pct_km": pct(ways["highway"].isin(PED_TYPES))}
    for t in ("surface", "sidewalk", "lit", "smoothness", "maxspeed", "foot", "name"):
        m[f"{t}_missing_pct_km"] = round(100 - pct(ways[t].map(_present)), 1)
    m["not_runnable_km"] = round(ways.loc[_not_runnable(ways), "length"].sum() / 1000, 2)
    return m


def main(argv: list[str]) -> None:
    _setup()
    # --overpass-url=https://gall.openstreetmap.de/api pins one overpass-api.de backend
    # when the other one is unreachable from the local network.
    for a in [a for a in argv if a.startswith("--overpass-url=")]:
        ox.settings.overpass_url = a.split("=", 1)[1].rstrip("/")
        argv.remove(a)
    cmd = argv[0] if argv else "all"
    keys = argv[1:] or list(REGIONS)
    unknown = [k for k in keys if k not in REGIONS]
    if unknown:
        raise SystemExit(f"unknown region(s) {unknown}; use {list(REGIONS)}")
    regions = [REGIONS[k] for k in keys]
    if cmd == "compare":
        compare(regions)
        return
    steps = {"fetch": [fetch], "relations": [relations], "stats": [stats], "export": [export],
             "all": [fetch, relations, stats, export]}
    if cmd not in steps:
        raise SystemExit(f"unknown command {cmd!r}; use one of {sorted(steps) + ['compare']}")
    for r in regions:
        _use(r)
        print(f"\n##### {r.key} ({r.label}) center={r.center} #####")
        for step in steps[cmd]:
            step(r)


if __name__ == "__main__":
    main(sys.argv[1:])

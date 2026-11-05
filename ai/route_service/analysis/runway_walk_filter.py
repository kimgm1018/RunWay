"""RunWay custom walk filter: classify every OSM highway edge as RUNNABLE / EXCLUDED / UNCERTAIN.

Scope: graph cleaning only. No scoring, preference weights, ranking or route generation.
"RUNNABLE" means "may stay in the routing graph", not "good for running".

Input: the cached Overpass responses that analysis/osm_walk_inspect.py already downloaded
(every highway=* way in the region bbox, with node coordinates). No new download, so the
filter sees the same OSM snapshot as the survey. Survey outputs are only read, never written.

Tag priority (every matching rule is recorded in runway_reason; status = EXCLUDED if any
exclusion rule matched, else UNCERTAIN if any uncertainty rule matched, else RUNNABLE):
  0. not a usable linear way: area=yes, lifecycle/non-path highway values      -> EXCLUDED
  1. explicit foot: foot=no/private/use_sidepath                                -> EXCLUDED
                    foot=yes/designated/permissive grants pedestrian access
  2. access=no/private without a foot grant                                     -> EXCLUDED
  3. highway type:
       motorway*, raceway, bus_guideway, expressway/motorroad/toll=yes          -> EXCLUDED (never overridden)
       trunk*, busway                                                           -> EXCLUDED, UNCERTAIN with a foot grant
       cycleway with a foot grant -> RUNNABLE; cycleway without foot tag        -> UNCERTAIN
       corridor (indoor), unknown highway values                                -> UNCERTAIN
       pedestrian and ordinary road types                                       -> RUNNABLE
  4. auxiliary: sidewalk*=separate on a road (its sidewalk is its own way)      -> EXCLUDED, UNCERTAIN with a foot grant
                road tunnel without sidewalk/foot information                   -> UNCERTAIN
                sidewalk=no on a road is recorded but does not change the status

Usage (run from the RunWay root, isolated mode; regions default to all five):
    <osm-venv>/Scripts/python.exe -I analysis/runway_walk_filter.py selftest
    <osm-venv>/Scripts/python.exe -I analysis/runway_walk_filter.py apply [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/runway_walk_filter.py compare
    <osm-venv>/Scripts/python.exe -I analysis/runway_walk_filter.py cases
"""
import json
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from pathlib import Path

import folium
import geopandas as gpd
import networkx as nx
import osmnx as ox
import pandas as pd
from shapely.geometry import Point, box
from shapely.ops import linemerge

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir from sys.path
from osm_walk_inspect import PED_TYPES, REGIONS, ROOT, SURVEY_TAGS, Region  # noqa: E402

COMPARISON_CSV = ROOT / "reports" / "runway_custom_walk_filter_comparison.csv"
WORK = ROOT / "reports" / "_runway_filter_work"
SEED = 42

RUNNABLE, EXCLUDED, UNCERTAIN = "RUNNABLE", "EXCLUDED", "UNCERTAIN"

FOOT_GRANT = {"yes", "designated", "permissive"}
FOOT_DENY = {"no": "foot_no", "private": "foot_private", "use_sidepath": "foot_use_sidepath"}
ACCESS_DENY = {"no", "private"}
NOT_A_PATH = {"proposed", "planned", "construction", "razed", "abandoned", "disused", "no",
              "rest_area", "services", "platform"}
HARD_EXCLUDE_HW = {"motorway", "motorway_link", "raceway", "bus_guideway"}
VEHICLE_HW = {"trunk", "trunk_link", "busway"}
WALK_HW = set(PED_TYPES) | {"bridleway"}
ROAD_HW = {"residential", "service", "unclassified", "living_street",
           "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link"}
SIDEWALK_KEYS = ["sidewalk", "sidewalk:both", "sidewalk:left", "sidewalk:right"]
SIDEWALK_PRESENT = {"both", "left", "right", "yes"}
RULE_TAGS = ["highway", "area", "foot", "access", "service", "tunnel", "expressway", "motorroad",
             "toll", "indoor", "covered", "bicycle", "segregated"] + SIDEWALK_KEYS
EDGE_PROPS = ["osmid", "u", "v", "highway", "name", "length", "foot", "access", "bridge", "tunnel",
              "sidewalk", "layer", "service", "expressway", "toll", "motorroad", "bicycle",
              "surface", "footway", "runway_status", "runway_reason", "runway_reason_primary",
              "in_osmnx_walk", "recovered"]


def _v(tags: Mapping, key: str) -> str | None:
    """Tag value as a plain string, or None when the tag is absent."""
    x = tags.get(key)
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return None
    x = str(x).strip()
    return x or None


def classify(tags: Mapping) -> tuple[str, list[str]]:
    """Status and reasons for one OSM way. Only explicit tags are used; nothing is inferred."""
    hw = _v(tags, "highway") or ""
    foot, access = _v(tags, "foot"), _v(tags, "access")
    granted = foot in FOOT_GRANT
    excl, unc, ok = [], [], []
    typ = []  # the plain highway type; reported only when it is what makes the edge RUNNABLE

    # 0. not a usable linear way
    if not hw:  # outline of a highway=* multipolygon relation, not a way of its own
        excl.append("no_highway_tag")
    if _v(tags, "area") == "yes":
        excl.append("area_polygon")
    if hw in NOT_A_PATH:
        excl.append(f"highway_{hw}")

    # 1. explicit foot
    if foot in FOOT_DENY:
        excl.append(FOOT_DENY[foot])

    # 2. access, unless foot explicitly grants it
    if access in ACCESS_DENY:
        if granted:
            ok.append(f"foot_{foot}_overrides_access_{access}")
        else:
            excl.append(f"access_{access}")

    # 3. highway type
    if hw in HARD_EXCLUDE_HW:
        excl.append(f"highway_{hw}")
    if hw in VEHICLE_HW:
        (unc.append(f"highway_{hw}_with_foot_{foot}") if granted else excl.append(f"highway_{hw}"))
    elif hw == "cycleway":
        if granted:
            ok.append(f"cycleway_foot_{foot}")
        elif foot is None:
            unc.append("cycleway_without_foot_tag")
    elif hw == "corridor":
        unc.append("indoor_corridor")
    elif hw in WALK_HW or hw in ROAD_HW:
        typ.append(hw)
    elif hw and hw not in NOT_A_PATH | HARD_EXCLUDE_HW:
        unc.append(f"highway_{hw}_unhandled")
    for k in ("expressway", "motorroad", "toll"):  # car-only roads; never overridden by foot
        if _v(tags, k) == "yes":
            excl.append(f"{k}_yes")

    # 4. auxiliary tags on ordinary roads
    if hw in ROAD_HW - {"living_street"}:
        if any(_v(tags, k) == "separate" for k in SIDEWALK_KEYS):
            # explicit foot permission ranks above the "sidewalk is its own way" hint
            (unc.append(f"sidewalk_separate_with_foot_{foot}") if granted else excl.append("sidewalk_separate"))
        tunnel = _v(tags, "tunnel")
        if tunnel and tunnel != "building_passage":
            if any(_v(tags, k) in SIDEWALK_PRESENT for k in SIDEWALK_KEYS):
                ok.append("road_tunnel_with_sidewalk")
            elif granted:
                ok.append(f"road_tunnel_foot_{foot}")
            else:
                unc.append("road_tunnel_without_foot_info")
        if _v(tags, "sidewalk") == "no":
            ok.append("sidewalk_no")

    status = EXCLUDED if excl else UNCERTAIN if unc else RUNNABLE
    return status, excl + unc + (typ if status == RUNNABLE else []) + ok


SELFTEST_CASES = [
    ({"highway": "footway"}, RUNNABLE, "footway"),
    ({"highway": "residential", "sidewalk": "no"}, RUNNABLE, "residential"),
    ({"highway": "trunk", "expressway": "yes", "toll": "yes", "bridge": "yes"}, EXCLUDED, "highway_trunk"),
    ({"highway": "trunk", "foot": "yes", "expressway": "yes"}, EXCLUDED, "expressway_yes"),
    ({"highway": "secondary", "motorroad": "yes"}, EXCLUDED, "motorroad_yes"),
    ({"highway": "trunk_link"}, EXCLUDED, "highway_trunk_link"),
    ({"highway": "trunk", "foot": "yes"}, UNCERTAIN, "highway_trunk_with_foot_yes"),
    ({"highway": "motorway", "foot": "yes"}, EXCLUDED, "highway_motorway"),
    ({"highway": "busway"}, EXCLUDED, "highway_busway"),
    ({"highway": "busway", "access": "no"}, EXCLUDED, "access_no"),
    ({"highway": "footway", "access": "no", "foot": "yes"}, RUNNABLE, "foot_yes_overrides_access_no"),
    ({"highway": "service", "access": "private"}, EXCLUDED, "access_private"),
    ({"highway": "footway", "foot": "no"}, EXCLUDED, "foot_no"),
    ({"highway": "cycleway", "foot": "designated"}, RUNNABLE, "cycleway_foot_designated"),
    ({"highway": "cycleway", "foot": "yes"}, RUNNABLE, "cycleway_foot_yes"),
    ({"highway": "cycleway", "foot": "no"}, EXCLUDED, "foot_no"),
    ({"highway": "cycleway"}, UNCERTAIN, "cycleway_without_foot_tag"),
    ({"highway": "secondary", "tunnel": "yes"}, UNCERTAIN, "road_tunnel_without_foot_info"),
    ({"highway": "secondary", "tunnel": "yes", "sidewalk": "no"}, UNCERTAIN, "sidewalk_no"),
    ({"highway": "secondary", "tunnel": "yes", "sidewalk": "both"}, RUNNABLE, "road_tunnel_with_sidewalk"),
    ({"highway": "secondary", "tunnel": "yes", "foot": "yes"}, RUNNABLE, "road_tunnel_foot_yes"),
    ({"highway": "footway", "tunnel": "yes"}, RUNNABLE, "footway"),
    ({"highway": "service", "tunnel": "building_passage"}, RUNNABLE, "service"),
    ({"highway": "tertiary", "sidewalk:right": "separate"}, EXCLUDED, "sidewalk_separate"),
    ({"highway": "tertiary", "sidewalk:right": "separate", "foot": "yes"}, UNCERTAIN, "sidewalk_separate_with_foot_yes"),
    ({"highway": "pedestrian", "area": "yes"}, EXCLUDED, "area_polygon"),
    ({"highway": "corridor", "indoor": "yes"}, UNCERTAIN, "indoor_corridor"),
    ({"highway": "construction"}, EXCLUDED, "highway_construction"),
    ({"highway": "raceway"}, EXCLUDED, "highway_raceway"),
    ({"highway": "road"}, UNCERTAIN, "highway_road_unhandled"),
    ({}, EXCLUDED, "no_highway_tag"),
    ({"area": "yes"}, EXCLUDED, "no_highway_tag"),
]


def selftest() -> None:
    fails = 0
    for tags, want_status, want_reason in SELFTEST_CASES:
        status, reasons = classify(tags)
        good = status == want_status and want_reason in reasons
        fails += not good
        print(f"{'ok  ' if good else 'FAIL'} {status:9s} {';'.join(reasons):60s} <- {tags}")
    print(f"{len(SELFTEST_CASES) - fails}/{len(SELFTEST_CASES)} passed")
    if fails:
        raise SystemExit(1)


def _features_response(r: Region) -> dict:
    """The cached Overpass response of the all-highway features query (not the walk-network one)."""
    ids = set(gpd.read_file(r.features_path)["osmid"])
    hits = []
    for f in sorted(r.cache.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        ways = {e["id"] for e in data.get("elements", []) if e["type"] == "way"}
        if ways >= ids:
            hits.append(data)
    if len(hits) != 1:
        raise SystemExit(f"{r.key}: expected one cached features response, found {len(hits)}")
    return hits[0]


def _graph_from_response(data: dict, r: Region) -> nx.MultiDiGraph:
    """Build the all-highway graph through the public OSMnx XML loader, truncated like the survey graph."""
    root = ET.Element("osm", version="0.6", generator="runway_walk_filter")
    for e in data["elements"]:
        if e["type"] == "node":
            el = ET.SubElement(root, "node", id=str(e["id"]), lat=str(e["lat"]), lon=str(e["lon"]))
        elif e["type"] == "way":
            el = ET.SubElement(root, "way", id=str(e["id"]))
            for ref in e["nodes"]:
                ET.SubElement(el, "nd", ref=str(ref))
        else:
            continue
        for k, v in e.get("tags", {}).items():
            ET.SubElement(el, "tag", k=k, v=str(v))
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / f"{r.key}_highways.osm"
        ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)
        G = ox.graph_from_xml(path, bidirectional=True, simplify=False, retain_all=True)
    G = ox.truncate.truncate_graph_polygon(G, box(*r.bbox), truncate_by_edge=False)
    G.remove_nodes_from([n for n in list(G.nodes) if G.degree(n) == 0])
    return G


def _edge_key(u, v, osmid) -> tuple:
    return (min(u, v), max(u, v), int(osmid))


def _undirected_edges(G: nx.MultiDiGraph) -> gpd.GeoDataFrame:
    e = ox.convert.graph_to_gdfs(ox.convert.to_undirected(G), nodes=False).reset_index()
    assert not e["osmid"].map(lambda x: isinstance(x, list)).any()
    return e


def _component_ids(edges: pd.DataFrame) -> pd.Series:
    """Connected-component id per edge (0 = longest component) of an undirected edge set."""
    H = nx.Graph()
    H.add_edges_from(edges[["u", "v"]].itertuples(index=False))
    node_comp = {n: i for i, c in enumerate(nx.connected_components(H)) for n in c}
    comp = edges["u"].map(node_comp)
    order = edges.groupby(comp)["length"].sum().sort_values(ascending=False).index
    return comp.map({c: i for i, c in enumerate(order)})


def _components(edges: pd.DataFrame) -> dict:
    """Connected components of an undirected edge set, by length."""
    comp_km = edges.groupby(_component_ids(edges))["length"].sum().sort_index()
    total = comp_km.sum()
    return {"components": len(comp_km),
            "largest_component_pct_km": round(100 * comp_km.iloc[0] / total, 1) if total else 0.0,
            "components_over_1km": int((comp_km >= 1000).sum())}


def apply(r: Region) -> None:
    out = r.out
    ox.settings.useful_tags_way = sorted(set(SURVEY_TAGS) | set(RULE_TAGS))
    G = _graph_from_response(_features_response(r), r)
    edges = _undirected_edges(G)
    for t in set(SURVEY_TAGS) | set(RULE_TAGS):
        if t not in edges.columns:
            edges[t] = None

    # Edge membership in the survey's OSMnx walk graph (same snapshot, same truncation).
    base = _undirected_edges(ox.load_graphml(r.graph_path))
    base_keys = {_edge_key(u, v, o) for u, v, o in base[["u", "v", "osmid"]].itertuples(index=False)}
    keys = [_edge_key(u, v, o) for u, v, o in edges[["u", "v", "osmid"]].itertuples(index=False)]
    edges["in_osmnx_walk"] = [k in base_keys for k in keys]
    missing = base_keys - set(keys)
    print(f"all-highway graph: {G.number_of_nodes()} nodes | undirected edges {len(edges)} | "
          f"OSMnx walk edges {len(base)} | walk edges not rebuilt: {len(missing)}")
    if missing:
        raise SystemExit(f"{r.key}: rebuilt graph lacks {len(missing)} OSMnx walk edges; comparison would be invalid")

    cls = edges.apply(lambda row: classify(row), axis=1)
    edges["runway_status"] = [c[0] for c in cls]
    edges["runway_reason"] = [";".join(c[1]) for c in cls]
    edges["runway_reason_primary"] = [c[1][0] if c[1] else "" for c in cls]
    edges["recovered"] = (edges["runway_status"] == RUNNABLE) & ~edges["in_osmnx_walk"]

    km = lambda m: edges.loc[m, "length"].sum() / 1000  # noqa: E731
    pct = lambda a, b: round(100 * a / b, 1) if b else 0.0  # noqa: E731
    is_run, is_exc, is_unc = (edges["runway_status"] == s for s in (RUNNABLE, EXCLUDED, UNCERTAIN))
    inb = edges["in_osmnx_walk"]
    all_km, base_km = km(edges.index == edges.index), km(inb)
    assert abs(base_km - base["length"].sum() / 1000) < 1e-6
    s = {"region": r.key, "label": r.label,
         "all_highway_ways": int(edges["osmid"].nunique()), "all_highway_km": round(all_km, 2),
         "osmnx_walk_ways": int(edges.loc[inb, "osmid"].nunique()), "osmnx_walk_km": round(base_km, 2),
         "runnable_km": round(km(is_run), 2), "excluded_km": round(km(is_exc), 2), "uncertain_km": round(km(is_unc), 2),
         "runnable_pct_all": pct(km(is_run), all_km), "excluded_pct_all": pct(km(is_exc), all_km),
         "uncertain_pct_all": pct(km(is_unc), all_km),
         "runnable_pct_of_osmnx_walk": pct(km(is_run & inb), base_km),
         "excluded_pct_of_osmnx_walk": pct(km(is_exc & inb), base_km),
         "uncertain_pct_of_osmnx_walk": pct(km(is_unc & inb), base_km),
         "strict_graph_km": round(km(is_run), 2), "lenient_graph_km": round(km(is_run | is_unc), 2),
         "removed_from_osmnx_strict_km": round(km(inb & ~is_run), 2),
         "removed_from_osmnx_strict_pct": pct(km(inb & ~is_run), base_km),
         "removed_from_osmnx_lenient_km": round(km(inb & is_exc), 2),
         "removed_from_osmnx_lenient_pct": pct(km(inb & is_exc), base_km),
         "recovered_km": round(km(edges["recovered"]), 2),
         "recovered_shared_cycleway_km": round(km(edges["recovered"] & (edges["highway"] == "cycleway")), 2),
         "recovered_other_km": round(km(edges["recovered"] & (edges["highway"] != "cycleway")), 2),
         "not_in_osmnx_uncertain_km": round(km(~inb & is_unc), 2)}
    s["strict_vs_osmnx_pct_change"] = pct(s["strict_graph_km"] - base_km, base_km)
    for name, m in (("osmnx", inb), ("strict", is_run), ("lenient", is_run | is_unc)):
        s |= {f"{name}_{k}": v for k, v in _components(edges[m]).items()}
    # Recovered cycleways only help routing if they join the rest of the strict graph.
    strict = edges[is_run].assign(comp=_component_ids(edges[is_run]))
    joined = strict.groupby("comp")["recovered"].transform(lambda x: (~x).any())
    rec = strict[strict["recovered"]]
    s["recovered_connected_km"] = round(rec.loc[joined[rec.index], "length"].sum() / 1000, 2)
    s["recovered_in_largest_component_km"] = round(rec.loc[rec["comp"] == 0, "length"].sum() / 1000, 2)

    # By highway type: what OSMnx kept and what RunWay keeps.
    by_hw = []
    for h, g in edges.groupby("highway"):
        L = lambda m: round(g.loc[m, "length"].sum() / 1000, 2)  # noqa: E731
        st, b = g["runway_status"], g["in_osmnx_walk"]
        by_hw.append({"highway": h, "all_km": L(g.index == g.index), "osmnx_walk_km": L(b),
                      "runnable_km": L(st == RUNNABLE), "excluded_km": L(st == EXCLUDED), "uncertain_km": L(st == UNCERTAIN),
                      "removed_from_osmnx_km": L(b & (st != RUNNABLE)), "recovered_km": L(~b & (st == RUNNABLE)),
                      "ways": int(g["osmid"].nunique())})
    by_hw = pd.DataFrame(by_hw).sort_values("all_km", ascending=False)
    by_hw.insert(0, "region", r.key)
    by_hw.to_csv(out / "runway_status_by_highway.csv", index=False, encoding="utf-8")

    # Every reason with its km (an edge counts once per reason it carries).
    rs = edges[["runway_status", "runway_reason", "length", "in_osmnx_walk"]].copy()
    rs["reason"] = rs["runway_reason"].str.split(";")
    rs = rs.explode("reason").reset_index(drop=True)
    rs["length_in_osmnx_walk"] = rs["length"].where(rs["in_osmnx_walk"], 0.0)
    reasons = (rs.groupby(["runway_status", "reason"])
               .agg(edges=("length", "size"), km=("length", "sum"), km_in_osmnx_walk=("length_in_osmnx_walk", "sum"))
               .reset_index().sort_values(["runway_status", "km"], ascending=[True, False]))
    reasons[["km", "km_in_osmnx_walk"]] = (reasons[["km", "km_in_osmnx_walk"]] / 1000).round(2)
    reasons.insert(0, "region", r.key)
    reasons.to_csv(out / "runway_reason_summary.csv", index=False, encoding="utf-8")
    prim = edges.groupby("runway_reason_primary")["length"].sum() / 1000
    s |= {f"primary_{k}_km": round(v, 2) for k, v in prim.items()}

    (out / "runway_summary.json").write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    _export(r, G, edges)
    _verification_sample(r, edges)

    print("\n=== summary ===")
    for k, v in s.items():
        if not k.startswith("primary_"):
            print(f"{k:38s} {v}")
    print("\n=== by highway ===")
    print(by_hw.drop(columns="region").to_string(index=False))
    print("\n=== reasons ===")
    print(reasons.drop(columns="region").to_string(index=False))


def _export(r: Region, G: nx.MultiDiGraph, edges: gpd.GeoDataFrame) -> None:
    out = r.out
    # Directed graph with every highway edge and its status; the next step filters RUNNABLE.
    status = {k: v for k, v in zip((_edge_key(u, v, o) for u, v, o in edges[["u", "v", "osmid"]].itertuples(index=False)),
                                  edges[["runway_status", "runway_reason", "in_osmnx_walk"]].itertuples(index=False))}
    for u, v, d in G.edges(data=True):
        st = status[_edge_key(u, v, d["osmid"])]
        d["runway_status"], d["runway_reason"], d["in_osmnx_walk"] = st.runway_status, st.runway_reason, st.in_osmnx_walk
    ox.save_graphml(G, out / "runway_walk_graph_classified.graphml")

    gdf = gpd.GeoDataFrame(edges[EDGE_PROPS + ["geometry"]].copy(), geometry="geometry", crs="EPSG:4326")
    gdf["length"] = gdf["length"].round(1)
    for c in EDGE_PROPS:
        if gdf[c].dtype == object:
            gdf[c] = gdf[c].astype("string")
    gdf.to_file(out / "runway_walk_graph.geojson", driver="GeoJSON")

    # Map: one feature per (way, status, membership) so the HTML stays small.
    grp = ["osmid", "runway_status", "in_osmnx_walk", "recovered"]
    first = ["highway", "name", "foot", "access", "tunnel", "bridge", "sidewalk", "runway_reason"]
    m_ways = edges.groupby(grp).agg(**{c: (c, "first") for c in first}, length=("length", "sum"),
                                    geometry=("geometry", lambda g: linemerge(list(g)))).reset_index()
    m_ways = gpd.GeoDataFrame(m_ways, geometry="geometry", crs="EPSG:4326")
    m_ways["length"] = m_ways["length"].round(1)
    tip = ["osmid", "highway", "name", "runway_status", "runway_reason", "foot", "access", "tunnel", "sidewalk", "length"]
    m = folium.Map(location=r.center, zoom_start=15, tiles="OpenStreetMap")
    layers = [("RUNNABLE", m_ways["runway_status"] == RUNNABLE, {"color": "#1a9850", "weight": 3}, True),
              ("EXCLUDED", m_ways["runway_status"] == EXCLUDED, {"color": "#d73027", "weight": 4}, True),
              ("UNCERTAIN", m_ways["runway_status"] == UNCERTAIN, {"color": "#fd8d3c", "weight": 5}, True),
              ("RECOVERED (not in OSMnx walk)", m_ways["recovered"], {"color": "#2166ac", "weight": 7}, False),
              ("REMOVED from OSMnx walk", m_ways["in_osmnx_walk"] & (m_ways["runway_status"] != RUNNABLE),
               {"color": "#7b3294", "weight": 7, "dashArray": "6 4"}, False)]
    for name, mask, style, show in layers:
        sub = m_ways[mask]
        if sub.empty:
            continue
        folium.GeoJson(sub[tip + ["geometry"]].to_json(na="null"),
                       name=f"{name} ({sub['length'].sum() / 1000:.2f} km)",
                       style_function=lambda f, st=style: st | {"opacity": 0.85},
                       tooltip=folium.GeoJsonTooltip(fields=tip), show=show).add_to(m)
    folium.LayerControl(collapsed=False).add_to(m)
    m.save(out / "runway_walk_map.html")
    print("wrote", out / "runway_walk_graph_classified.graphml", "|", out / "runway_walk_graph.geojson",
          "|", out / "runway_walk_map.html")


# Representative edges per type for manual review: random within each type (seed), not hand-picked.
CATEGORIES = [
    ("near_center_walkway", lambda e: e["highway"].isin(["footway", "pedestrian", "path"]), "nearest"),
    ("shared_cycleway", lambda e: e["highway"] == "cycleway", "random"),
    ("park_or_mountain_path", lambda e: e["highway"].isin(["path", "track"]), "random"),
    ("major_road", lambda e: e["highway"].isin(["primary", "secondary", "tertiary"]) & ~e["runway_reason"].str.contains("tunnel"), "random"),
    ("road_tunnel", lambda e: e["runway_reason"].str.contains("road_tunnel"), "longest"),
    ("steps", lambda e: e["highway"] == "steps", "random"),
    ("trunk_or_expressway", lambda e: e["highway"].isin(["trunk", "trunk_link"]), "random"),
    ("busway", lambda e: e["highway"] == "busway", "random"),
    ("sidewalk_separate_road", lambda e: e["runway_reason"].str.contains("sidewalk_separate"), "random"),
    ("access_override_or_restricted", lambda e: e["runway_reason"].str.contains("access"), "random"),
    ("residential_or_service", lambda e: e["highway"].isin(["residential", "service"]), "random"),
    ("uncertain_other", lambda e: (e["runway_status"] == UNCERTAIN) & ~e["runway_reason"].str.contains("road_tunnel"), "random"),
    ("area_polygon", lambda e: e["runway_reason"].str.contains("area_polygon"), "random"),
]


def _verification_sample(r: Region, edges: gpd.GeoDataFrame, per_cat: int = 2) -> None:
    ways = edges.groupby("osmid").agg(highway=("highway", "first"), name=("name", "first"),
                                      runway_status=("runway_status", "first"), runway_reason=("runway_reason", "first"),
                                      in_osmnx_walk=("in_osmnx_walk", "max"), length=("length", "sum"),
                                      foot=("foot", "first"), access=("access", "first"), tunnel=("tunnel", "first"),
                                      sidewalk=("sidewalk", "first"), surface=("surface", "first"),
                                      geometry=("geometry", lambda g: linemerge(list(g)))).reset_index()
    ways = gpd.GeoDataFrame(ways, geometry="geometry", crs="EPSG:4326")
    utm = ways.estimate_utm_crs()
    center = gpd.GeoSeries([Point(r.center[1], r.center[0])], crs="EPSG:4326").to_crs(utm).iloc[0]
    ways["dist_center_m"] = ways.to_crs(utm).distance(center).round(0)
    picked, rows = set(), []
    for cat, rule, how in CATEGORIES:
        cand = ways[rule(ways) & ~ways["osmid"].isin(picked)]
        if cand.empty:
            continue
        if how == "nearest":
            cand = cand.nsmallest(per_cat, "dist_center_m")
        elif how == "longest":
            cand = cand.nlargest(per_cat, "length")
        else:
            cand = cand.sample(min(per_cat, len(cand)), random_state=SEED)
        picked |= set(cand["osmid"])
        rows.append(cand.assign(category=cat))
    v = pd.concat(rows).drop(columns="geometry")
    v["length"] = v["length"].round(1)
    v["osm_url"] = "https://www.openstreetmap.org/way/" + v["osmid"].astype(str)
    v.insert(0, "region", r.key)
    path = r.out / "runway_verification_edges.csv"
    v.to_csv(path, index=False, encoding="utf-8")
    print("wrote", path, "|", len(v), "ways")


def compare(regions: list[Region]) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    rows = [json.loads((r.out / "runway_summary.json").read_text(encoding="utf-8")) for r in regions]
    df = pd.DataFrame(rows)
    prim = sorted(c for c in df.columns if c.startswith("primary_"))
    df[prim] = df[prim].fillna(0.0)
    df = df[[c for c in df.columns if not c.startswith("primary_")] + prim]
    df.to_csv(COMPARISON_CSV, index=False, encoding="utf-8-sig")
    print("wrote", COMPARISON_CSV, "|", df.shape)
    with pd.option_context("display.width", 250, "display.max_rows", 300):
        print(df.set_index("region").T.to_string())
    for name in ("runway_status_by_highway.csv", "runway_reason_summary.csv", "runway_verification_edges.csv"):
        allr = pd.concat([pd.read_csv(r.out / name) for r in regions])
        allr.to_csv(WORK / name.replace(".csv", "_all_regions.csv"), index=False, encoding="utf-8")
    print("wrote", WORK)


# Known problem cases from reports/osm_multi_region_audit.md, looked up by explicit tags/names.
KNOWN_CASES = [
    ("광안대교 (광안대로)", "gwangalli", lambda e: e["name"] == "광안대로"),
    ("번영로", "gwangalli", lambda e: e["name"] == "번영로"),
    ("광안해변로54번길 겸용 cycleway", "gwangalli", lambda e: (e["highway"] == "cycleway") & (e["foot"] == "designated")),
    ("광안리 해변 산책로", "gwangalli", lambda e: e["osmid"] == 1565666785),
    ("민락수변로 (sidewalk:right=separate)", "gwangalli", lambda e: e["name"] == "민락수변로"),
    ("센텀 trunk·trunk_link 전체", "centum", lambda e: e["highway"].isin(["trunk", "trunk_link"])),
    ("센텀시티지하도로 (trunk 터널)", "centum", lambda e: e["name"] == "센텀시티지하도로"),
    ("센텀 busway (access 없음)", "centum", lambda e: (e["highway"] == "busway") & e["access"].isna()),
    ("센텀 busway + access=no", "centum", lambda e: (e["highway"] == "busway") & (e["access"] == "no")),
    ("수영강 자전거길 foot=designated", "centum", lambda e: (e["name"] == "수영강 자전거길") & (e["foot"] == "designated")),
    ("수영강 자전거길 foot=no", "centum", lambda e: (e["name"] == "수영강 자전거길") & (e["foot"] == "no")),
    ("센텀 cycleway, foot 태그 없음", "centum", lambda e: (e["highway"] == "cycleway") & e["foot"].isna()),
    ("해운대 실내 corridor", "haeundae", lambda e: e["highway"] == "corridor"),
    ("시민공원·서면 겸용 cycleway", "citizenpark", lambda e: (e["highway"] == "cycleway") & (e["foot"] == "designated")),
    ("시민공원로 터널 (sidewalk=both)", "citizenpark", lambda e: (e["name"] == "시민공원로") & (e["tunnel"] == "yes")),
    ("부산시민공원 말굽거리 (access=no, foot=yes)", "citizenpark", lambda e: e["name"] == "부산시민공원 말굽거리"),
    ("시민공원·서면 고가 trunk_link", "citizenpark", lambda e: e["highway"] == "trunk_link"),
    ("황령터널 (황령대로 tunnel=yes)", "hwangnyeongsan", lambda e: (e["name"] == "황령대로") & (e["tunnel"] == "yes")),
    ("번영로 (황령산)", "hwangnyeongsan", lambda e: e["name"] == "번영로"),
    ("황령산둘레길", "hwangnyeongsan", lambda e: e["name"] == "황령산둘레길"),
]


def cases() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    loaded, rows = {}, []
    for label, key, sel in KNOWN_CASES:
        if key not in loaded:
            loaded[key] = gpd.read_file(REGIONS[key].out / "runway_walk_graph.geojson")
        e = loaded[key]
        hit = e[sel(e)]
        if hit.empty:
            rows.append({"case": label, "region": key, "ways": 0})
            continue
        inb = hit["in_osmnx_walk"].astype(bool)
        rows.append({"case": label, "region": key, "ways": hit["osmid"].nunique(),
                     "km": round(hit["length"].sum() / 1000, 2),
                     "osmnx_walk": "포함" if inb.all() else "제외" if not inb.any() else
                     f"일부 포함 ({hit.loc[inb, 'length'].sum() / 1000:.2f} km)",
                     "runway": " / ".join(f"{s} {g['length'].sum() / 1000:.2f} km"
                                          for s, g in hit.groupby("runway_status")),
                     "reasons": " | ".join(sorted(hit["runway_reason"].unique())),
                     "osmids": " ".join(str(o) for o in sorted(hit["osmid"].unique())[:12])})
    df = pd.DataFrame(rows)
    df.to_csv(WORK / "known_cases.csv", index=False, encoding="utf-8")
    with pd.option_context("display.width", 250, "display.max_colwidth", 90):
        print(df.drop(columns="osmids").to_string(index=False))


def main(argv: list[str]) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ox.settings.log_console = False
    cmd = argv[0] if argv else "selftest"
    keys = argv[1:] or list(REGIONS)
    unknown = [k for k in keys if k not in REGIONS]
    if unknown:
        raise SystemExit(f"unknown region(s) {unknown}; use {list(REGIONS)}")
    if cmd == "selftest":
        selftest()
    elif cmd == "apply":
        for k in keys:
            print(f"\n##### {k} ({REGIONS[k].label}) #####")
            apply(REGIONS[k])
    elif cmd == "compare":
        compare([REGIONS[k] for k in keys])
    elif cmd == "cases":
        cases()
    else:
        raise SystemExit(f"unknown command {cmd!r}; use selftest, apply, compare or cases")


if __name__ == "__main__":
    main(sys.argv[1:])

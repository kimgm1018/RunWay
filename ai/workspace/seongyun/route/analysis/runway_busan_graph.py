"""Busan-wide OSM extract -> start-centred RUNNABLE graph for the round-trip route generator.

Scope: graph range only. Builds the routing graph around any start point from a local Busan
highway extract (Geofabrik PBF), applies the RunWay Custom Walk Filter (classify() from
analysis/runway_walk_filter.py, unchanged) and reruns the round-trip generator
(analysis/runway_route_generator.py, unchanged) on it. No scoring, preference or ranking.

Radius: every point of a closed route of length L lies within network distance L / 2 of the
start, so a disk of radius (1 + tolerance) * L / 2 = 0.55 L holds every valid candidate. The
`sweep` command checks this empirically: each region is generated on a large reference graph
(0.55 L + 2 km) and on truncated copies of it, and every seed's route is compared.

Data: data/osm/geofabrik/<geofabrik pbf> (read only) -> data/osm/busan/busan_highways_<date>.osm.pbf

Usage (run from the RunWay root, isolated mode):
    <osm-venv>/Scripts/python.exe -I analysis/runway_busan_graph.py extract
    <osm-venv>/Scripts/python.exe -I analysis/runway_busan_graph.py validate
    <osm-venv>/Scripts/python.exe -I analysis/runway_busan_graph.py sweep [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/runway_busan_graph.py run <target_m> [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/runway_busan_graph.py compare
"""
import hashlib
import json
import math
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

import folium
import geopandas as gpd
import networkx as nx
import numpy as np
import osmium
import osmnx as ox
import pandas as pd
from pyproj import Transformer
from shapely.geometry import LineString, Point, box
from shapely.ops import transform as shp_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir from sys.path
import runway_route_generator as rrg  # noqa: E402
from osm_walk_inspect import REGIONS, ROOT, SURVEY_TAGS  # noqa: E402
from runway_walk_filter import RULE_TAGS, RUNNABLE, classify  # noqa: E402

GEOFABRIK_DIR = ROOT / "data" / "osm" / "geofabrik"
BUSAN_DIR = ROOT / "data" / "osm" / "busan"
WORK = ROOT / "reports" / "_route_busan_work"
COMPARISON_CSV = ROOT / "reports" / "runway_route_busan_graph_comparison.csv"
SWEEP_CSV = WORK / "radius_sweep.csv"

# Busan Metropolitan City plus a ~3 km margin (neighbouring cities' streets at the border are kept).
BUSAN_BBOX = (128.73, 34.85, 129.35, 35.42)  # west, south, east, north
UTM = "EPSG:32652"
TOLERANCE = rrg.TOLERANCE
REF_EXTRA_M = 2000          # reference graph: 0.55 L + 2 km
SWEEP = [(0.30, 0), (0.35, 0), (0.40, 0), (0.45, 0), (0.50, 0), (0.55, 0), (0.55, 250), (0.55, 500), (0.55, 1000)]
SWEEP_LONG = [(0.40, 0), (0.45, 0), (0.50, 0), (0.55, 0), (0.55, 250), (0.55, 500)]  # targets above 5 km
# Chosen from the sweeps (reports/runway_route_busan_graph_audit.md): 0.55 L alone already gave every
# reference route at 5 and 10 km; the buffer covers the gap between the input point (disk centre) and the
# snapped start node, which was at most 72 m (+27.5 m main-component shift) in the five test starts.
WORK_BUFFER_M = 250
TO_UTM = Transformer.from_crs("EPSG:4326", UTM, always_xy=True)
TO_LL = Transformer.from_crs(UTM, "EPSG:4326", always_xy=True)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _source_pbf() -> Path:
    files = sorted(GEOFABRIK_DIR.glob("south-korea-*.osm.pbf"))
    if len(files) != 1:
        raise SystemExit(f"expected one Geofabrik PBF in {GEOFABRIK_DIR}, found {len(files)}")
    return files[0]


def _busan_pbf() -> Path:
    files = sorted(BUSAN_DIR.glob("busan_highways_*.osm.pbf"))
    if len(files) != 1:
        raise SystemExit(f"expected one Busan extract in {BUSAN_DIR}, found {len(files)}; run `extract`")
    return files[0]


def extract() -> None:
    """One pass over the Korea PBF: highway ways with any node inside BUSAN_BBOX, with their nodes."""
    src = _source_pbf()
    t0 = time.time()
    w0, s0, e0, n0 = BUSAN_BBOX
    header = osmium.io.Reader(str(src), osmium.osm.osm_entity_bits.NOTHING).header()
    stamp = header.get("osmosis_replication_timestamp", "")
    ways, nodes = {}, {}
    seen = 0
    fp = (osmium.FileProcessor(str(src)).with_locations()
          .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
          .with_filter(osmium.filter.KeyFilter("highway")))
    for w in fp:
        seen += 1
        pts = [(n.ref, n.lon, n.lat) for n in w.nodes if n.location.valid()]
        if len(pts) != len(w.nodes):
            continue  # a node outside the Korea extract; not in Busan anyway
        if not any(w0 <= x <= e0 and s0 <= y <= n0 for _, x, y in pts):
            continue
        ways[w.id] = ([p[0] for p in pts], dict(w.tags))
        for ref, x, y in pts:
            nodes[ref] = (x, y)
    BUSAN_DIR.mkdir(parents=True, exist_ok=True)
    date = stamp[:10] if stamp else time.strftime("%Y-%m-%d")
    out = BUSAN_DIR / f"busan_highways_{date}.osm.pbf"
    hdr = osmium.io.Header()
    hdr.set("generator", "RunWay analysis/runway_busan_graph.py")
    if stamp:
        hdr.set("osmosis_replication_timestamp", stamp)
    with osmium.SimpleWriter(str(out), header=hdr, overwrite=True) as wr:
        for nid in sorted(nodes):
            wr.add_node(osmium.osm.mutable.Node(id=nid, location=nodes[nid]))
        for wid in sorted(ways):
            refs, tags = ways[wid]
            wr.add_way(osmium.osm.mutable.Way(id=wid, nodes=refs, tags=tags))
    meta = {"source_file": src.name, "source_bytes": src.stat().st_size, "source_sha256": _sha256(src),
            "source_url": "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf",
            "source_license": "ODbL 1.0, (c) OpenStreetMap contributors",
            "osm_data_timestamp": stamp, "busan_bbox_wsen": BUSAN_BBOX,
            "highway_ways_scanned": seen, "highway_ways_kept": len(ways), "nodes_kept": len(nodes),
            "extract_file": out.name, "extract_bytes": out.stat().st_size, "extract_sha256": _sha256(out),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "seconds": round(time.time() - t0, 1)}
    (BUSAN_DIR / "EXTRACT.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, v in meta.items():
        print(f"{k:24s} {v}")


class BusanSource:
    """The Busan extract held in memory: way tags, node refs and node coordinates (UTM)."""

    def __init__(self, path: Path | None = None):
        path = path or _busan_pbf()
        self.path = path
        self.ways, coords = {}, {}
        for o in osmium.FileProcessor(str(path)).with_locations():
            if o.is_way():
                self.ways[o.id] = ([n.ref for n in o.nodes], dict(o.tags))
            elif o.is_node():
                coords[o.id] = (o.lon, o.lat)
        self.node_ids = np.fromiter(coords.keys(), dtype=np.int64)
        ll = np.array(list(coords.values()))
        self.lonlat = dict(zip(self.node_ids.tolist(), map(tuple, ll.tolist())))  # plain floats for the XML
        x, y = TO_UTM.transform(ll[:, 0], ll[:, 1])
        self.xy = np.column_stack([x, y])
        self.pos = {int(n): i for i, n in enumerate(self.node_ids)}

    def disk_graph(self, lat: float, lon: float, radius_m: float) -> tuple[nx.MultiDiGraph, object]:
        """Classified all-highway graph of the disk, truncated like the survey graphs (node inside)."""
        cx, cy = TO_UTM.transform(lon, lat)
        inside = ((self.xy[:, 0] - cx) ** 2 + (self.xy[:, 1] - cy) ** 2) <= radius_m ** 2
        keep_nodes = set(self.node_ids[inside].tolist())
        root = ET.Element("osm", version="0.6", generator="runway_busan_graph")
        used = set()
        sel = [(wid, refs, tags) for wid, (refs, tags) in self.ways.items() if any(r in keep_nodes for r in refs)]
        for _, refs, _ in sel:
            used.update(refs)
        for nid in used:
            x, y = self.lonlat[nid]
            ET.SubElement(root, "node", id=str(nid), lat=repr(y), lon=repr(x))
        for wid, refs, tags in sel:
            el = ET.SubElement(root, "way", id=str(wid))
            for r in refs:
                ET.SubElement(el, "nd", ref=str(r))
            for k, v in tags.items():
                ET.SubElement(el, "tag", k=k, v=str(v))
        ox.settings.useful_tags_way = sorted(set(SURVEY_TAGS) | set(RULE_TAGS))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "disk.osm"
            ET.ElementTree(root).write(p, encoding="utf-8", xml_declaration=True)
            G = ox.graph_from_xml(p, bidirectional=True, simplify=False, retain_all=True)
        disk_ll = _disk_ll(cx, cy, radius_m)
        G = ox.truncate.truncate_graph_polygon(G, disk_ll, truncate_by_edge=False)
        G.remove_nodes_from([n for n in list(G.nodes) if G.degree(n) == 0])
        for _, _, d in G.edges(data=True):
            st, reasons = classify(d)
            d["runway_status"], d["runway_reason"] = st, ";".join(reasons)
        return G, disk_ll


def _disk_ll(cx: float, cy: float, r: float):
    return shp_transform(TO_LL.transform, Point(cx, cy).buffer(r, quad_segs=128))


def truncate_disk(G: nx.MultiDiGraph, lat: float, lon: float, radius_m: float):
    cx, cy = TO_UTM.transform(lon, lat)
    disk_ll = _disk_ll(cx, cy, radius_m)
    H = ox.truncate.truncate_graph_polygon(G, disk_ll, truncate_by_edge=False)
    H.remove_nodes_from([n for n in list(H.nodes) if H.degree(n) == 0])
    return H, disk_ll


def route_graph(G: nx.MultiDiGraph, boundary_ll, region) -> rrg.RouteGraph:
    """Same assembly as runway_route_generator.load_graph, from an in-memory classified graph."""
    Gp = ox.project_graph(G, to_crs=UTM)
    full_status = defaultdict(set)
    H = nx.Graph()
    for u, v, d in Gp.edges(data=True):
        full_status[(min(u, v), max(u, v))].add(d["runway_status"])
        if d["runway_status"] != RUNNABLE:
            continue
        if H.has_edge(u, v) and H[u][v]["length"] <= d["length"]:
            continue
        H.add_edge(u, v, **{k: d.get(k) for k in rrg.EDGE_ATTRS})
    for n in H.nodes:
        H.nodes[n]["x"], H.nodes[n]["y"] = Gp.nodes[n]["x"], Gp.nodes[n]["y"]
    comps = sorted(nx.connected_components(H),
                   key=lambda c: -sum(d["length"] for *_, d in H.subgraph(c).edges(data=True)))
    comp = {n: i for i, c in enumerate(comps) for n in c}
    comp_km = [sum(d["length"] for *_, d in H.subgraph(c).edges(data=True)) / 1000 for c in comps]
    nodes = np.array(list(H.nodes))
    xy = np.array([(H.nodes[n]["x"], H.nodes[n]["y"]) for n in nodes])
    boundary = gpd.GeoSeries([boundary_ll], crs="EPSG:4326").to_crs(UTM).iloc[0]
    rg = rrg.RouteGraph(region, H, UTM, full_status, nodes, xy, comp, comp_km, boundary)
    pool = np.array([i for i, n in enumerate(nodes) if comp[n] == 0 and H.degree(n) >= 3])
    rg.wp_nodes, rg.wp_xy = nodes[pool], xy[pool]
    return rg


def generate_on(rg: rrg.RouteGraph, lat: float, lon: float, target: float, attempts: int = rrg.ATTEMPTS) -> dict:
    """runway_route_generator.generate() on a given graph (same seeds, same steps)."""
    snap = rrg.snap_start(rg, lat, lon)
    start = snap["start_node"]
    rows = []
    for i in range(attempts):
        c = rrg.make_candidate(rg, start, target, rrg.SEED0 + i)
        if c["failure"]:
            rows.append(c)
            continue
        f = rrg.route_features(rg, c.pop("path"), target)
        rows.append({**{k: v for k, v in c.items() if k != "err"}, **f})
    ok = [c for c in rows if not c["failure"]]
    valid = [c for c in ok if c["valid"]]
    good = [c for c in valid if c["quality_ok"]]
    final, dup_of = rrg.dedupe(good, rrg.DEDUP_OVERLAP)
    for n, c in enumerate(final, 1):
        c["final_label"] = f"Candidate {n}"
    for c in rows:
        c.setdefault("final_label", "")
        c["status"] = ("failed" if c["failure"] else "final" if c["final_label"] else
                       f"duplicate_of_{dup_of[c['seed']]}" if c["seed"] in dup_of else
                       "quality_flagged" if c.get("valid") else "invalid")
    s = rrg._summary(rg.region, rg, snap, target, rows, ok, valid, good, final)
    s["graph_covers_required_disk_pct"] = s.pop("cached_bbox_covers_required_disk_pct")
    return {"summary": s, "rows": rows, "final": final, "snap": snap}


def _sig(c: dict) -> frozenset:
    return frozenset(c["edge_keys"]) if "edge_keys" in c else frozenset()


def _graph_stats(G, rg) -> dict:
    st = Counter(d["runway_status"] for *_, d in G.edges(data=True))
    return {"graph_nodes": G.number_of_nodes(), "graph_edges_directed": G.number_of_edges(),
            "runnable_edges_directed": st.get(RUNNABLE, 0), "excluded_edges_directed": st.get("EXCLUDED", 0),
            "uncertain_edges_directed": st.get("UNCERTAIN", 0), "runnable_km": round(sum(rg.comp_km), 2),
            "runnable_main_component_km": round(rg.comp_km[0], 2)}


def sweep(keys: list[str], target: float = rrg.TARGET_M) -> None:
    """Same 40 seeds on a large reference graph and on smaller disks cut from it."""
    WORK.mkdir(parents=True, exist_ok=True)
    src = BusanSource()
    rows = []
    for k in keys:
        r = REGIONS[k]
        lat, lon = r.center
        ref_r = 0.55 * target + REF_EXTRA_M
        t0 = time.time()
        G_ref, disk_ref = src.disk_graph(lat, lon, ref_r)
        t_build = time.time() - t0
        plan = SWEEP if target <= rrg.TARGET_M else SWEEP_LONG
        tests = [(f"ref_0.55L+{REF_EXTRA_M}", ref_r)] + [(f"{f:.2f}L+{b}", f * target + b) for f, b in plan]
        ref_sig = None
        for label, rad in tests:
            t1 = time.time()
            G, disk = (G_ref, disk_ref) if rad == ref_r else truncate_disk(G_ref, lat, lon, rad)
            rg = route_graph(G, disk, r)
            res = generate_on(rg, lat, lon, target)
            sig = {c["seed"]: _sig(c) for c in res["rows"]}
            if ref_sig is None:
                ref_sig = sig
            s = res["summary"]
            same = sum(sig[sd] == ref_sig[sd] for sd in sig)
            rows.append({"region": k, "target_m": target, "radius_label": label, "radius_m": round(rad),
                         "radius_over_L": round(rad / target, 3), **_graph_stats(G, rg),
                         "seeds_identical_to_reference": same, "seeds": len(sig),
                         **{c: s[c] for c in ("valid", "final_after_dedupe", "valid_abs_error_mean_pct",
                                              "non_runnable_edges_total", "removed_highway_edges_total",
                                              "valid_touching_bbox_edge", "final_touching_bbox_edge",
                                              "final_bbox_edge_hug_m_max", "final_bbox_edge_hug_m_sum",
                                              "valid_max_dist_from_start_max_m", "start_in_main_component",
                                              "shift_to_main_m", "graph_covers_required_disk_pct")},
                         "seconds_generate": round(time.time() - t1, 1),
                         "seconds_build_reference": round(t_build, 1)})
            print(k, label, rows[-1]["graph_nodes"], "identical", same, "/", len(sig), "valid", s["valid"],
                  "final", s["final_after_dedupe"], "touch", s["valid_touching_bbox_edge"],
                  "hug", s["final_bbox_edge_hug_m_max"], f"{rows[-1]['seconds_generate']}s", flush=True)
    df = pd.DataFrame(rows)
    out = SWEEP_CSV if target == rrg.TARGET_M else WORK / f"radius_sweep_{int(target)}.csv"
    if out.exists():  # keep other regions' rows from earlier calls
        old = pd.read_csv(out)
        df = pd.concat([old[~old["region"].isin(keys)], df])
    df.to_csv(out, index=False, encoding="utf-8")
    print("wrote", out)


def working_radius(target: float) -> float:
    return (1 + TOLERANCE) * target / 2 + WORK_BUFFER_M


def run(target: float, keys: list[str]) -> None:
    src = BusanSource()
    for k in keys:
        r = REGIONS[k]
        lat, lon = r.center
        rad = working_radius(target)
        t0 = time.time()
        G, disk = src.disk_graph(lat, lon, rad)
        t_graph = time.time() - t0
        rg = route_graph(G, disk, r)
        t1 = time.time()
        res = generate_on(rg, lat, lon, target)
        t_gen = time.time() - t1
        # The disk must lie inside the extract; otherwise the graph is cut at the extract edge again.
        ext = gpd.GeoSeries([box(*BUSAN_BBOX)], crs="EPSG:4326").to_crs(UTM).iloc[0]
        margin = ext.exterior.distance(Point(TO_UTM.transform(lon, lat))) - rad
        s = res["summary"] | _graph_stats(G, rg) | {
            "graph_source": _busan_pbf().name, "working_radius_m": round(rad),
            "radius_rule": f"(1 + {TOLERANCE}) * L / 2 + {WORK_BUFFER_M} m",
            "disk_inside_extract_bbox": bool(margin > 0), "disk_margin_to_extract_edge_m": round(margin),
            "seconds_graph": round(t_graph, 1), "seconds_generate": round(t_gen, 1)}
        if margin <= 0:
            print(f"WARNING {k}: working disk crosses the extract bbox by {-margin:.0f} m; extend the extract")
        out = ROOT / "reports" / f"_route_busan_{k}_{int(target)}_work"
        rrg._export(r, rg, res["snap"], target, res["rows"], res["final"], s, out)
        _map(rg, res["snap"], res["final"], out, rad)
        print(f"\n##### {k} target={int(target)} radius={round(rad)} m nodes={G.number_of_nodes()} "
              f"graph {t_graph:.1f}s generate {t_gen:.1f}s #####")
        for key in ("valid", "final_after_dedupe", "valid_abs_error_mean_pct", "non_runnable_edges_total",
                    "removed_highway_edges_total", "valid_touching_bbox_edge", "final_bbox_edge_hug_m_max",
                    "valid_max_dist_from_start_max_m", "start_in_main_component", "shift_to_main_m"):
            print(f"{key:34s} {s[key]}")


def _map(rg, snap, final, out: Path, rad: float) -> None:
    """Same layers as the cached-bbox maps; the dashed line is the working-graph disk."""
    gdf = gpd.read_file(out / "candidates.geojson")
    sx, sy = rg.H.nodes[snap["start_node"]]["x"], rg.H.nodes[snap["start_node"]]["y"]
    slon, slat = TO_LL.transform(sx, sy)
    m = folium.Map(location=(slat, slon), zoom_start=13, tiles="OpenStreetMap")
    ring = gpd.GeoSeries([LineString(rg.bbox_poly.exterior.coords)], crs=UTM).to_crs("EPSG:4326").iloc[0]
    folium.GeoJson({"type": "Feature", "properties": {}, "geometry": ring.__geo_interface__},
                   name=f"working graph disk (r = {round(rad)} m)",
                   style_function=lambda f: {"color": "#333", "weight": 1, "dashArray": "6 6"}).add_to(m)
    fields = [("distance_m", "거리 (m)"), ("distance_error_pct", "목표 거리 오차 (%)"),
              ("walk_dedicated_ratio", "보행 전용 비율"), ("major_road_ratio", "major road 비율"),
              ("steps_count", "계단 (way 수)"), ("intersection_per_km", "교차로/km"),
              ("repeated_edge_ratio", "반복 edge 비율"), ("out_and_back_ratio", "왕복 비율"),
              ("route_shape", "형태"), ("flags", "flags")]
    for i, c in enumerate(final):
        row = gdf[gdf["seed"] == c["seed"]].iloc[0]
        html = f"<b>{c['final_label']}</b> (seed {c['seed']})<table>" + "".join(
            f"<tr><td>{lab}</td><td style='padding-left:8px'>{row[k]}</td></tr>" for k, lab in fields) + "</table>"
        fg = folium.FeatureGroup(name=f"{c['final_label']}: {row['distance_m'] / 1000:.2f} km", show=i < 3)
        folium.GeoJson({"type": "Feature", "properties": {}, "geometry": row.geometry.__geo_interface__},
                       style_function=lambda f, col=rrg.COLORS[i % len(rrg.COLORS)]: {"color": col, "weight": 5, "opacity": 0.8},
                       popup=folium.Popup(html, max_width=320), tooltip=c["final_label"]).add_to(fg)
        fg.add_to(m)
    folium.Marker((slat, slon), tooltip=f"start (snap {snap['snap_node_dist_m']} m)",
                  icon=folium.Icon(color="black", icon="play")).add_to(m)
    folium.LayerControl(collapsed=False).add_to(m)
    m.save(out / "route_map.html")


def validate() -> None:
    """Extract vs the survey's cached Overpass data inside each 3 km survey bbox."""
    WORK.mkdir(parents=True, exist_ok=True)
    src = BusanSource()
    rows = []
    for k, r in REGIONS.items():
        lat, lon = r.center
        cached = gpd.read_file(r.out / "runway_walk_graph.geojson")
        G, _ = src.disk_graph(lat, lon, 1500 * math.sqrt(2) + 200)  # covers the whole 3 km box
        Gb = ox.truncate.truncate_graph_polygon(G, box(*r.bbox))
        e = ox.convert.graph_to_gdfs(ox.convert.to_undirected(Gb), nodes=False).reset_index()
        e["key"] = [(min(u, v), max(u, v), int(o)) for u, v, o in e[["u", "v", "osmid"]].itertuples(index=False)]
        c_key = {(min(u, v), max(u, v), int(o)): s for u, v, o, s in
                 cached[["u", "v", "osmid", "runway_status"]].itertuples(index=False)}
        n_key = dict(zip(e["key"], e["runway_status"]))
        both = c_key.keys() & n_key.keys()
        same_status = sum(c_key[x] == n_key[x] for x in both)
        km = lambda df, st: round(df.loc[df["runway_status"] == st, "length"].sum() / 1000, 2)  # noqa: E731
        rows.append({"region": k, "cached_edges": len(c_key), "extract_edges": len(n_key), "common_edges": len(both),
                     "common_pct_of_cached": round(100 * len(both) / len(c_key), 2),
                     "same_status_pct_of_common": round(100 * same_status / len(both), 2),
                     "cached_runnable_km": km(cached, RUNNABLE), "extract_runnable_km": km(e, RUNNABLE),
                     "cached_excluded_km": km(cached, "EXCLUDED"), "extract_excluded_km": km(e, "EXCLUDED"),
                     "cached_uncertain_km": km(cached, "UNCERTAIN"), "extract_uncertain_km": km(e, "UNCERTAIN")})
        print(rows[-1], flush=True)
    pd.DataFrame(rows).to_csv(WORK / "extract_vs_cached_validation.csv", index=False, encoding="utf-8")


def compare() -> None:
    """Cached 3 km bbox runs vs Busan-extract runs (5 km), plus the 10 km runs."""
    rows = []
    for k in REGIONS:
        old = json.loads((ROOT / "reports" / f"_route_{k}_work" / "summary.json").read_text(encoding="utf-8"))
        old_c = pd.read_csv(ROOT / "reports" / f"_route_{k}_work" / "candidates.csv")
        for target in (5000, 10000):
            p = ROOT / "reports" / f"_route_busan_{k}_{target}_work"
            if not (p / "summary.json").exists():
                continue
            new = json.loads((p / "summary.json").read_text(encoding="utf-8"))
            row = {"region": k, "label": REGIONS[k].label, "target_m": target}
            if target == 5000:
                new_c = pd.read_csv(p / "candidates.csv")
                same = (old_c.set_index("seed")["distance_m"].round(1) == new_c.set_index("seed")["distance_m"].round(1))
                row["seeds_same_distance_as_cached"] = int(same.sum())
                for key in ("valid", "final_after_dedupe", "valid_abs_error_mean_pct", "final_abs_error_mean_pct",
                            "valid_touching_bbox_edge", "final_touching_bbox_edge", "final_bbox_edge_hug_m_max",
                            "final_bbox_edge_hug_m_sum", "valid_max_dist_from_start_max_m",
                            "valid_repeated_edge_ratio_mean", "final_walk_dedicated_ratio_mean",
                            "final_major_road_ratio_mean", "final_pairwise_overlap_mean",
                            "non_runnable_edges_total", "removed_highway_edges_total"):
                    row[f"cached_{key}"] = old.get(key)
            for key, v in new.items():
                if key not in ("region", "label", "target_m") and not key.startswith(("start_", "nearest_")):
                    row[f"busan_{key}"] = v
            rows.append(row)
    df = pd.DataFrame(rows)
    df.to_csv(COMPARISON_CSV, index=False, encoding="utf-8-sig")
    print("wrote", COMPARISON_CSV, df.shape)
    with pd.option_context("display.width", 250, "display.max_rows", 300):
        print(df.set_index(["region", "target_m"]).T.to_string())


def main(argv: list[str]) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ox.settings.log_console = False
    cmd = argv[0] if argv else ""
    if cmd == "extract":
        extract()
    elif cmd == "validate":
        validate()
    elif cmd == "sweep":
        target = float(argv[1]) if len(argv) > 1 and argv[1].isdigit() else rrg.TARGET_M
        keys = [a for a in argv[1:] if not a.isdigit()] or list(REGIONS)
        sweep(keys, target)
    elif cmd == "run":
        target = float(argv[1])
        run(target, argv[2:] or list(REGIONS))
    elif cmd == "compare":
        compare()
    else:
        raise SystemExit("use extract, validate, sweep [target] [region ...], run <target_m> [region ...], compare")


if __name__ == "__main__":
    main(sys.argv[1:])

"""Busan-wide OSM extract -> start-centred RUNNABLE graph for the round-trip route generator.

Scope: graph range only. Builds the routing graph around any start point from a local Busan
highway extract (Geofabrik PBF), applies the RunWay Custom Walk Filter (classify() from
analysis/runway_walk_filter.py, unchanged) and reruns the round-trip generator
(analysis/runway_route_generator.py, unchanged) on it. No scoring, preference or ranking.

Radius: every point of a closed route of length L lies within network distance L / 2 of the
start, so a disk of radius (1 + tolerance) * L / 2 = 0.55 L holds every valid candidate (checked
empirically by the former `sweep` command, reports/runway_route_busan_graph_audit.md).

Data: data/osm/geofabrik/<geofabrik pbf> (read only) -> data/osm/busan/busan_highways_<date>.osm.pbf

Usage (run from the RunWay root, isolated mode):
    <route-venv>/Scripts/python.exe -I analysis/runway_busan_graph.py extract
(validate / sweep / run / compare were removed with the Route service split, S15P31E105-381.)
"""
import hashlib
import json
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import networkx as nx
import numpy as np
import osmium
import osmnx as ox
from pyproj import Transformer
from shapely.geometry import Point
from shapely.ops import transform as shp_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir from sys.path
import runway_route_generator as rrg  # noqa: E402
from osm_walk_inspect import ROOT, SURVEY_TAGS  # noqa: E402
from runway_walk_filter import RULE_TAGS, RUNNABLE, classify  # noqa: E402

GEOFABRIK_DIR = ROOT / "data" / "osm" / "geofabrik"
BUSAN_DIR = ROOT / "data" / "osm" / "busan"

# Busan Metropolitan City plus a ~3 km margin (neighbouring cities' streets at the border are kept).
BUSAN_BBOX = (128.73, 34.85, 129.35, 35.42)  # west, south, east, north
UTM = "EPSG:32652"
TOLERANCE = rrg.TOLERANCE
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


def working_radius(target: float) -> float:
    return (1 + TOLERANCE) * target / 2 + WORK_BUFFER_M


def main(argv: list[str]) -> None:
    """Data build only: `extract` cuts the Busan highway extract from the Geofabrik PBF."""
    sys.stdout.reconfigure(encoding="utf-8")
    if argv[:1] != ["extract"]:
        raise SystemExit("use: extract")
    ox.settings.log_console = False
    extract()


if __name__ == "__main__":
    main(sys.argv[1:])

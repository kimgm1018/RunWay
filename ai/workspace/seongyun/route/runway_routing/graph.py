"""Per-request routing graph: cut the working disk from the extract and turn it into the arrays every later step reads.

요약: 요청 위치 주변 working disk를 extract에서 잘라 routing graph와 edge 배열을 만든다. LRU cache 기본 4개
(RUNWAY_GRAPH_CACHE_SIZE).
위치: pipeline의 data 다음, snap/후보 생성 전.
주의: fast builder는 canonical builder와 node/edge 순서까지 같아야 한다(시작 시 self-test). RouteCSR은 이웃 순서를 보존한다.

    G, rg   = FastGraphRouteGenerator._graph(...)      canonical classified disk graph (all statuses, WGS84
                                                       MultiDiGraph) + canonical RouteGraph (RUNNABLE, UTM)
    cg      = build_request_graph(...)                 CanonicalRoutingGraph: G in node-index space with RUNNABLE routing
                                                       edges (redges), env distances / near flags, edge arrays (ea),
                                                       DEM node elevations and stats
    levels  = traffic_node_distance + edge_levels      Running Suitability edge traffic levels (once per graph)

Two LRU caches exist and are kept as they are (keys unchanged; both sizes = GRAPH_CACHE_SIZE, default 4, env
RUNWAY_GRAPH_CACHE_SIZE): the canonical generator's (G, rg) cache and the pipeline's cg cache.
Key = (round(lat, 6), round(lon, 6), round(working radius)): a start moved by more than ~0.1 m is a new graph.
A cached cg keeps its G alive (cg.full) after the generator cache evicts it.

Fast builder determinism: build_fast reproduces canonical's disk_graph + route_graph node and edge order exactly (way
order, the Python set of int node ids iterated as canonical iterates it, osmnx 2.1.1 internals). It is used only when
osmnx is VERIFIED_OSMNX and the start-up self-test finds the fast graph identical to canonical's; otherwise canonical's
builder runs and status()["graph_builder"] says why.
"""
import os
import time
from collections import OrderedDict, defaultdict
from importlib.metadata import version as pkg_version
from itertools import groupby, pairwise

import geopandas as gpd
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
import pyproj
import shapely
from osmnx import distance, utils_geo
from osmnx._errors import InsufficientResponseError
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree
from shapely.geometry import Point, box
from shapely.ops import transform

from . import network_store, source_snapshot
from .data import ENV_CLASSES, REGIONS, RUNNABLE, UTM_CRS, _Segments, api, edge_distances, edge_flags

busan, rrg = api.busan, api.rrg


def cache_size_env(name: str, default: int = 4) -> int:
    """LRU 칸 수 환경변수(import 시 1회 읽음). 없으면 default, 있으면 1 이상의 10진 정수만 허용한다.
    잘못된 값(빈 문자열·0·음수·소수·문자)은 기동 단계에서 ValueError로 멈춘다(조용히 기본값으로 바꾸지 않는다).
    칸 수는 메모리와 반복 요청 속도만 바꾸고 추천 결과는 바꾸지 않는다(cache는 결과에 영향 없음)."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    v = raw.strip()
    if not (v.isascii() and v.isdigit()) or int(v) < 1:
        raise ValueError(f"{name} must be an integer >= 1 (got {raw!r}); unset it to use the default {default}")
    return int(v)


# 요청 graph LRU 칸 수. RUNWAY_GRAPH_CACHE_SIZE(기본 4)가 이것과 generator의 (G, rg) LRU(gen._cache_size,
# pipeline이 생성자에 넘김)를 함께 정한다. 배포 컨테이너(1 worker, 1.5 GiB)는 2.
GRAPH_CACHE_SIZE = cache_size_env("RUNWAY_GRAPH_CACHE_SIZE")
EDGE_TAGS = ["highway", "name", "osmid", "foot", "access", "bicycle", "bridge", "tunnel", "footway",
             "sidewalk", "layer", "service", "surface", "runway_status", "runway_reason", "in_osmnx_walk"]
MAJOR = {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"}
WALK_DEDICATED = {"footway", "pedestrian", "path", "track", "steps", "bridleway", "cycleway"}
STREET_FOOTWAY = {"sidewalk", "crossing", "traffic_island", "access_aisle", "link"}
NOT_A_TUNNEL = {"no", "building_passage"}  # building passages are short covered walkways, not road tunnels
ENV_FLAGS = ["river_near", "water_near", "coastal_near", "beach_near", "waterfront_near", "park_near", "green_near"]
USEFUL = sorted(set(busan.SURVEY_TAGS) | set(busan.RULE_TAGS))   # ox.settings.useful_tags_way in disk_graph
VERIFIED_OSMNX = "2.1.1"     # osmnx internals reproduced here (_convert_path, _add_paths, graph_from_gdfs)
SELF_TEST = ("haeundae", 5000)
# rollback 환경변수(import 시 읽음, 0이면 기존 경로; 결과는 같다):
#   RUNWAY_ENV_PREPARED=0          attach_env: inner polygon을 요청마다 만들고 within(segs, inner)
#   RUNWAY_ADAPTER_LEAN_ROUTING=0  _build_routing: 읽는 곳이 없는 CSR/components/KD-tree도 만든다
#   RUNWAY_NETWORK_STORE=0         extract를 압축 도로망 view 대신 S1 snapshot(또는 PBF) dict로 들고 있는다(network_store.py)
ENV_PREPARED = os.environ.get("RUNWAY_ENV_PREPARED", "1") != "0"
LEAN_ROUTING = os.environ.get("RUNWAY_ADAPTER_LEAN_ROUTING", "1") != "0"


def _s(v):
    """Graph attribute as a plain string or None (lists from merged ways are joined)."""
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    if isinstance(v, list):
        return ";".join(str(x) for x in v)
    v = str(v).strip()
    return v or None


# ------------------------------------------------------------------ request graph (adapter layout)
class CanonicalRoutingGraph:
    """The canonical classified disk graph (all statuses, WGS84 MultiDiGraph) in node-index layout.

    _build_routing is the PoC RoutingGraph's. With RUNWAY_ADAPTER_LEAN_ROUTING (default) it keeps only what production
    reads (redges, pair_to_eid); =0 also builds the unread CSR matrix, components and KD-tree as before."""

    def __init__(self, G, coverage_wgs):
        self._to_utm = pyproj.Transformer.from_crs("EPSG:4326", UTM_CRS, always_xy=True)
        self._to_wgs = pyproj.Transformer.from_crs(UTM_CRS, "EPSG:4326", always_xy=True)
        self._source, self._coverage = G, coverage_wgs
        self._load()
        self._build_routing()

    def _load(self) -> None:
        """RoutingGraph._load without the five-region merge: same node / edge tables from one graph."""
        if hasattr(self._source, "populate_adapter"):
            self._source.populate_adapter(self)
            return
        M = self._source
        self.full = M
        node_ids = np.array(list(M.nodes), dtype=np.int64)
        self.node_ids = node_ids
        self.node_index = {int(n): i for i, n in enumerate(node_ids)}
        self.lon = np.array([M.nodes[n]["x"] for n in node_ids], dtype=float)
        self.lat = np.array([M.nodes[n]["y"] for n in node_ids], dtype=float)
        self.x, self.y = self._to_utm.transform(self.lon, self.lat)
        self.node_highway = np.array([_s(M.nodes[n].get("highway")) for n in node_ids], dtype=object)

        rows = {}
        for u, v, d in M.edges(data=True):
            a, b = (u, v) if u < v else (v, u)
            k = (a, b, d["osmid"])
            if k in rows:
                continue
            r = {t: _s(d.get(t)) for t in EDGE_TAGS}
            ia, ib = self.node_index[a], self.node_index[b]
            if ia > ib:
                ia, ib, a, b = ib, ia, b, a
            r.update(u=ia, v=ib, osm_u=a, osm_v=b, length=float(d["length"]))
            rows[k] = r
        e = pd.DataFrame(list(rows.values()))
        e["osmid"] = e["osmid"].astype("int64")
        e["recovered"] = False  # needs in_osmnx_walk (survey graphs only); feature reported as None
        self.edges_all = e.reset_index(drop=True)
        pairs = pd.unique(np.concatenate([e["u"].to_numpy() * 10**7 + e["v"].to_numpy()]))
        deg = np.zeros(len(node_ids), dtype=np.int32)
        np.add.at(deg, pairs // 10**7, 1)
        np.add.at(deg, pairs % 10**7, 1)
        self.full_degree = deg

        self.coverage_wgs = self._coverage
        self.coverage_utm = transform(self._to_utm.transform, self._coverage)
        self.coverage_boundary_utm = self.coverage_utm.boundary

    def _build_routing(self) -> None:
        e = self.edges_all
        run = e[e["runway_status"] == RUNNABLE].copy()
        # Simple graph: per node pair keep the shortest RUNNABLE way segment (74 pairs have parallels).
        run = run.sort_values("length").drop_duplicates(["u", "v"], keep="first")
        run = run.sort_values(["u", "v"]).reset_index().rename(columns={"index": "all_idx"})
        run["length"] = run["length"].clip(lower=0.1)  # csgraph drops zero-weight arcs
        self.redges = run  # routing edges; row index = eid
        E, N = len(run), len(self.node_ids)
        u, v = run["u"].to_numpy(), run["v"].to_numpy()
        if LEAN_ROUTING:
            # 아래 arc 배열·CSR·components·KD-tree는 읽는 곳이 없다(grep: runway_routing/analysis/route_demo/tools).
            self.pair_to_eid = {(int(a), int(b)): i for i, (a, b) in enumerate(zip(u, v))}
            return
        self.arc_src = np.concatenate([u, v])
        self.arc_dst = np.concatenate([v, u])
        self.arc_eid = np.concatenate([np.arange(E), np.arange(E)])
        self.arc_fwd = np.concatenate([np.ones(E, bool), np.zeros(E, bool)])  # True: u -> v
        A = csr_matrix((np.arange(1, 2 * E + 1, dtype=float), (self.arc_src, self.arc_dst)), shape=(N, N))
        self._csr_template = A
        self._csr_arc = A.data.astype(np.int64) - 1  # arc id at each CSR storage slot
        self.pair_to_eid = {(int(a), int(b)): i for i, (a, b) in enumerate(zip(u, v))}

        # RUNNABLE connected components (by edge length).
        ncomp, lab = connected_components(A, directed=False)
        self.node_comp = lab
        on_run = np.zeros(N, bool)
        on_run[u] = on_run[v] = True
        self.on_runnable = on_run
        comp_len = np.zeros(ncomp)
        np.add.at(comp_len, lab[u], run["length"].to_numpy())
        self.comp_len_m = comp_len
        self.run_nodes = np.flatnonzero(on_run)
        self.kdtree = cKDTree(np.c_[self.x[self.run_nodes], self.y[self.run_nodes]])

    def dist_to_coverage_edge_m(self, nodes) -> np.ndarray:
        """Distance of each node to the coverage boundary (how close a route runs to missing data)."""
        import shapely
        pts = shapely.points(self.x[nodes], self.y[nodes])
        return shapely.distance(pts, self.coverage_boundary_utm)


def attach_env(cg: CanonicalRoutingGraph, env: dict, thresholds: dict, cache=None) -> dict | None:
    """Env distances / near flags for every routing edge, plus cg.env_covered: the edge lies inside the layer extent
    shrunk by the largest threshold (its flags are complete). Distances come from the env edge cache when one is
    given (edges missing from it are computed exactly as without it); the cache path returns its counters."""
    e = cg.redges
    stats = None
    if cache is not None:
        d, missing = cache.lookup(e)
        if missing.any():  # not in the cache: compute exactly as before
            sub = _Segments(cg.x, cg.y, e["u"].to_numpy()[missing], e["v"].to_numpy()[missing])
            d[missing] = edge_distances(sub, env["layers"])[[f"{c}_dist_m" for c in ENV_CLASSES]].to_numpy()
        for j, cls in enumerate(ENV_CLASSES):
            e[f"{cls}_dist_m"] = d[:, j]
        stats = {"env_source": "cache", "env_cached_edges": int((~missing).sum()),
                 "env_computed_edges": int(missing.sum())}
    elif env["layers"] is None:
        for cls in ENV_CLASSES:
            e[f"{cls}_dist_m"] = np.inf
        cg.env_covered = np.zeros(len(e), bool)
    else:
        dist = edge_distances(cg, env["layers"])
        for c in dist.columns:
            e[c] = dist[c].to_numpy()
    if cache is not None or env["layers"] is not None:
        u, v = e["u"].to_numpy(), e["v"].to_numpy()
        segs = shapely.linestrings(np.stack([np.c_[cg.x[u], cg.y[u]], np.c_[cg.x[v], cg.y[v]]], axis=1))
        if ENV_PREPARED:
            # within(segs, inner) == contains(inner, segs) (DE-9IM 정의). prepared 가속은 첫 인자에만 걸리므로 순서를 바꾼다.
            cg.env_covered = shapely.contains(_env_inner(cg, env, thresholds), segs)
        else:
            ext = transform(cg._to_utm.transform, box(*env["extent_wsen"]))
            inner = ext.buffer(-max(thresholds[c] for c in ENV_CLASSES))
            cg.env_covered = shapely.within(segs, inner)
    flags = edge_flags(e, thresholds)
    for c in flags.columns:
        e[c] = flags[c].to_numpy()
    return stats


_ENV_INNER: dict = {}


def _env_inner(cg, env: dict, thresholds: dict):
    """The env extent (UTM) shrunk by the largest threshold, built and prepared once per (extent, threshold).
    Same expression as the per-request path (fresh WGS84->UTM transformer of the same CRS: same coordinates)."""
    key = (tuple(env["extent_wsen"]), max(thresholds[c] for c in ENV_CLASSES))
    inner = _ENV_INNER.get(key)
    if inner is None:
        inner = transform(cg._to_utm.transform, box(*key[0])).buffer(-key[1])
        shapely.prepare(inner)
        _ENV_INNER[key] = inner
    return inner


def prepare_edge_arrays(graph) -> None:
    """Per routing edge numpy arrays used by features, generation bias and scoring."""
    e = graph.redges
    hw = e["highway"].fillna("").to_numpy()
    fw = e["footway"].to_numpy()
    tun = e["tunnel"].to_numpy()
    br = e["bridge"].to_numpy()
    A = {"length": e["length"].to_numpy(float), "u": e["u"].to_numpy(), "osmid": e["osmid"].to_numpy()}
    for h in ("footway", "pedestrian", "path", "track", "steps", "cycleway", "residential", "service",
              "unclassified", "living_street", "tertiary", "secondary", "primary"):
        A[f"hw_{h}"] = np.isin(hw, [h, f"{h}_link"])
    A["major"] = np.isin(hw, list(MAJOR))
    A["walk_dedicated"] = np.isin(hw, list(WALK_DEDICATED))
    A["trail"] = (np.isin(hw, ["path", "track", "pedestrian"])
                  | ((hw == "footway") & ~np.isin(fw, list(STREET_FOOTWAY))))
    A["bridge"] = (pd.notna(br) & (br != "no")).astype(bool)
    A["tunnel"] = (pd.notna(tun) & ~np.isin(tun.astype(str), list(NOT_A_TUNNEL))).astype(bool)
    A["recovered"] = e["recovered"].to_numpy(bool)
    for f in ENV_FLAGS:
        A[f] = e[f].to_numpy(bool) if f in e.columns else np.zeros(len(e), bool)
    graph.ea = A

def attach_elevation(graph, dem) -> None:
    graph.node_z = dem.sample(graph.lon, graph.lat) if dem is not None else None


def build_request_graph(gen, lat: float, lon: float, target_m: float, env: dict, thresholds: dict, dem,
                        cache=None) -> CanonicalRoutingGraph:
    """The request's CanonicalRoutingGraph: canonical subgraph -> adapter layout -> env -> edge arrays -> DEM -> stats.
    stats keys and order are part of the API response (debug.graph): env_s and the cache counters only on the cache path."""
    rad = gen.working_radius_m(target_m)
    t0 = time.perf_counter()
    G = gen.subgraph(lat, lon, target_m)
    cx, cy = api.busan.TO_UTM.transform(lon, lat)
    disk = transform(api.busan.TO_LL.transform, Point(cx, cy).buffer(rad, quad_segs=128))
    cg = CanonicalRoutingGraph(G, disk)
    t_env = time.perf_counter()
    env_stats = attach_env(cg, env, thresholds, cache)
    t_env = time.perf_counter() - t_env
    prepare_edge_arrays(cg)
    attach_elevation(cg, dem)
    L = cg.ea["length"]
    cg.stats = {"nodes": int(len(cg.node_ids)), "routing_edges": int(len(cg.redges)),
                "runnable_km": round(float(L.sum()) / 1000, 2),
                "env_covered_pct_km": round(100 * float(L[cg.env_covered].sum() / L.sum()), 1),
                "network_share": {f: round(float(L[cg.ea[f]].sum() / L.sum()), 4)
                                  for f in ("river_near", "coastal_near", "green_near", "trail", "walk_dedicated", "major")},
                "dem_nodes_pct": (round(100 * float(np.isfinite(cg.node_z).mean()), 1)
                                  if cg.node_z is not None else None),
                "build_s": round(time.perf_counter() - t0, 2)}
    if env_stats is not None:
        cg.stats |= {"env_s": round(t_env, 3), **env_stats}
    return cg


# ------------------------------------------------------------------ Running Suitability edge levels (once per graph)
def traffic_node_distance(cg, cfg: dict) -> np.ndarray:
    """Distance (m) from every graph node to the nearest traffic centreline (all statuses)."""
    e = cg.edges_all
    t = e[e["highway"].isin(cfg["traffic"]["traffic_highway"])]
    if t.empty:
        return np.full(len(cg.node_ids), np.inf)
    u, v = t["u"].to_numpy(), t["v"].to_numpy()
    tree = shapely.STRtree(shapely.linestrings(np.stack([np.c_[cg.x[u], cg.y[u]], np.c_[cg.x[v], cg.y[v]]], axis=1)))
    idx, dist = tree.query_nearest(shapely.points(cg.x, cg.y), return_distance=True, all_matches=False)
    d = np.full(len(cg.node_ids), np.inf)
    d[idx[0]] = dist
    return d

def edge_levels(cg, node_dist: np.ndarray, cfg: dict) -> dict:
    """Per routing edge: on / beside flags and the traffic level."""
    tr = cfg["traffic"]
    e = cg.redges
    on = e["highway"].isin(tr["major_highway"]).to_numpy()
    u, v = e["u"].to_numpy(), e["v"].to_numpy()
    beside = ~on & (np.maximum(node_dist[u], node_dist[v]) <= tr["beside_m"])
    lv = tr["levels"]
    level = np.where(on, lv["on"], np.where(beside, lv["beside"], lv["away"]))
    return {"on": on, "beside": beside, "level": level}


# ------------------------------------------------------------------ fast builder (same graph as canonical)
class Sidecar:
    """Static per-extract arrays, built once from the loaded extract.

    way_status / way_reason: classify() 결과를 way 위치 순서로 둔 list(cls[wid]와 같은 값). 압축 도로망(network_store)이면
    refs / attrs / cls는 배열에서 그때그때 만드는 view이고 값·순서는 dict 경로와 같다."""

    def __init__(self, src):
        t0 = time.perf_counter()
        self.src = src
        if getattr(src, "net", None) is not None:
            self._init_compact(src)
            self.build_s = round(time.perf_counter() - t0, 2)
            return
        self.way_ids = list(src.ways)
        self.refs = [src.ways[w][0] for w in self.way_ids]
        lens = np.fromiter((len(r) for r in self.refs), np.int64, len(self.refs))
        self.ptr = np.r_[0, np.cumsum(lens)]
        flat = np.fromiter((r for refs in self.refs for r in refs), np.int64, int(lens.sum()))
        order = np.argsort(src.node_ids)
        self.ref_pos = order[np.searchsorted(src.node_ids, flat, sorter=order)]
        self.attrs, self.cls = [], {}
        for wid in self.way_ids:
            tags = src.ways[wid][1]
            a = {"osmid": wid}
            for t in USEFUL:                       # osmnx _convert_path: useful tags in settings order
                if t in tags:
                    a[t] = str(tags[t])
            self.attrs.append(a)
            st, reasons = busan.classify(a)        # classify reads only tag keys (RULE_TAGS)
            self.cls[wid] = (st, ";".join(reasons))
        self.way_status = [self.cls[w][0] for w in self.way_ids]
        self.way_reason = [self.cls[w][1] for w in self.way_ids]
        self.build_s = round(time.perf_counter() - t0, 2)

    def _init_compact(self, src):
        """Same fields from the store's arrays: no per-way dict is kept (views build them on access)."""
        net = src.net
        self.way_ids = net["way_ids"].tolist()
        self.ptr, self.ref_pos = net["ref_ptr"], net["ref_pos"]
        self.refs = network_store.RefsView(net)
        self.attrs = network_store.AttrsView(net, src.strings, USEFUL, self.way_ids)
        status, reason, seen = [], [], {}
        for i in range(len(self.way_ids)):
            st, reasons = busan.classify(self.attrs[i])
            r = ";".join(reasons)
            r = seen.setdefault(r, r)              # one str object per distinct reason
            status.append(st)
            reason.append(r)
        self.way_status, self.way_reason = status, reason
        self.cls = network_store.ClsView(net["way_ids"], status, reason)

def build_fast(sc: Sidecar, lat: float, lon: float, radius: float, region):
    """(G, RouteGraph) equal to disk_graph(lat, lon, radius) + route_graph(G, disk, region)."""
    src = sc.src
    cx, cy = busan.TO_UTM.transform(lon, lat)
    inside = ((src.xy[:, 0] - cx) ** 2 + (src.xy[:, 1] - cy) ** 2) <= radius ** 2
    sel = np.flatnonzero(np.logical_or.reduceat(inside[sc.ref_pos], sc.ptr[:-1]))
    if len(sel) == 0:  # canonical: osmnx _create_graph on an empty selection
        raise InsufficientResponseError("No data elements in server response. Check query location/filters and log.")
    used = set()
    for i in sel:
        used.update(sc.refs[i])
    used_list = list(used)
    disk = busan._disk_ll(cx, cy, radius)
    ll = np.array([src.lonlat[n] for n in used_list])
    gs = gpd.GeoSeries(gpd.points_from_xy(ll[:, 0], ll[:, 1]), index=used_list, crs="EPSG:4326")
    keep = set(utils_geo._intersect_index_quadrats(gs, disk))   # truncate_graph_polygon's predicate
    if not keep:
        raise ValueError("Found no graph nodes within the requested polygon.")
    G = nx.MultiDiGraph(crs=ox.settings.default_crs)
    G.add_nodes_from((n, {"y": src.lonlat[n][1], "x": src.lonlat[n][0]}) for n in used_list if n in keep)
    for i in sel:
        nodes = [g[0] for g in groupby(sc.refs[i])]               # osmnx drops consecutive duplicates
        fwd = [(a, b) for a, b in pairwise(nodes) if a in keep and b in keep]
        if fwd:                                                    # osmnx _add_paths, bidirectional
            G.add_edges_from(fwd, **sc.attrs[i], oneway=False, reversed=False)
            G.add_edges_from([(b, a) for a, b in fwd], **sc.attrs[i], oneway=False, reversed=True)
    uvk = list(G.edges(keys=True))
    if uvk:                                                        # osmnx add_edge_lengths
        y, x = G.nodes(data="y"), G.nodes(data="x")
        c = np.array([(y[u], x[u], y[v], x[v]) for u, v, k in uvk])
        dists = distance.great_circle(c[:, 0], c[:, 1], c[:, 2], c[:, 3])
        dists[np.isnan(dists)] = 0
        nx.set_edge_attributes(G, values=dict(zip(uvk, dists, strict=True)), name="length")
    G.remove_nodes_from([n for n in list(G.nodes) if G.degree(n) == 0])
    for _, _, d in G.edges(data=True):
        d["runway_status"], d["runway_reason"] = sc.cls[d["osmid"]]
    return G, route_graph_fast(G, disk, region)

def _projected_edge_order(G):
    """Edge order of ox.project_graph's output: graph_from_gdfs adds edges first (G.edges order), so nodes
    appear in order of first appearance as u or v; each node's out-edges keep G's adjacency order."""
    order, seen = [], set()
    for u, v in G.edges():
        for n in (u, v):
            if n not in seen:
                seen.add(n)
                order.append(n)
    return ((u, v, d) for u in order for v, kd in G._adj[u].items() for d in kd.values())

def route_graph_fast(G, boundary_ll, region):
    """runway_busan_graph.route_graph without the GeoDataFrame round trip (same H, components, arrays)."""
    ids = list(G.nodes)
    lon = np.fromiter((G._node[n]["x"] for n in ids), float, len(ids))
    lat = np.fromiter((G._node[n]["y"] for n in ids), float, len(ids))
    proj = gpd.GeoSeries(gpd.points_from_xy(lon, lat), crs=G.graph.get("crs", "EPSG:4326")).to_crs(busan.UTM)
    xy_of = dict(zip(ids, zip(proj.x.tolist(), proj.y.tolist())))
    full_status = defaultdict(set)
    H = nx.Graph()
    for u, v, d in _projected_edge_order(G):
        full_status[(min(u, v), max(u, v))].add(d["runway_status"])
        if d["runway_status"] != busan.RUNNABLE:
            continue
        length = float(d["length"])                                # Python float, as after the DataFrame round trip
        if H.has_edge(u, v) and H[u][v]["length"] <= length:
            continue
        H.add_edge(u, v, **{k: (length if k == "length" else d.get(k)) for k in rrg.EDGE_ATTRS})
    for n in H.nodes:
        H.nodes[n]["x"], H.nodes[n]["y"] = xy_of[n]
    raw = list(nx.connected_components(H))
    km = [sum(d["length"] for *_, d in H.subgraph(c).edges(data=True)) for c in raw]  # canonical's expression, once
    order = sorted(range(len(raw)), key=lambda i: -km[i])                          # stable, as sorted(comps, key=)
    comps = [raw[i] for i in order]
    comp = {n: i for i, c in enumerate(comps) for n in c}
    comp_km = [km[i] / 1000 for i in order]
    nodes = np.array(list(H.nodes))
    xy = np.array([(H.nodes[n]["x"], H.nodes[n]["y"]) for n in nodes])
    boundary = gpd.GeoSeries([boundary_ll], crs="EPSG:4326").to_crs(busan.UTM).iloc[0]
    rg = rrg.RouteGraph(region, H, busan.UTM, full_status, nodes, xy, comp, comp_km, boundary)
    pool = np.array([i for i, n in enumerate(nodes) if comp[n] == 0 and H.degree(n) >= 3])
    rg.wp_nodes, rg.wp_xy = nodes[pool], xy[pool]
    return rg

def graph_sig(G) -> tuple:
    return (list(G.nodes(data=True)), list(G.edges(keys=True, data=True)))

def routegraph_sig(rg) -> tuple:
    return (list(rg.H.nodes(data=True)), list(rg.H.edges(data=True)), rg.nodes.tolist(), rg.xy.tolist(),
            list(rg.comp.items()), rg.comp_km, rg.wp_nodes.tolist(), rg.wp_xy.tolist(),
            sorted((k, sorted(v)) for k, v in rg.full_status.items()), rg.bbox_poly.wkt)


class FastGraphRouteGenerator(api.RouteGenerator):
    """Canonical RouteGenerator whose per-request graph comes from build_fast (canonical's otherwise)."""

    def __init__(self, *args, fast: bool = True, self_test: bool = True, **kwargs):
        self.source_snapshot = {}   # S1: the parsed extract from a validated snapshot when its key matches (else the PBF)
        self.network_store = {}     # H21: the compact store (views, no dicts) when its key matches (else S1 / the PBF)
        with source_snapshot.source_from_snapshot(busan, self.source_snapshot):
            with network_store.source_from_store(busan, self.network_store):
                super().__init__(*args, **kwargs)
        self.sidecar, self.fast_status = None, {"fast": False, "reason": "disabled"}
        if not fast:
            return
        osmnx_v = pkg_version("osmnx")
        if osmnx_v != VERIFIED_OSMNX:
            self.fast_status = {"fast": False, "reason": f"osmnx {osmnx_v} != verified {VERIFIED_OSMNX}"}
            return
        sc = Sidecar(self.source)
        st = {"fast": True, "reason": "", "sidecar_build_s": sc.build_s}
        if self_test:
            key, target = SELF_TEST
            lat, lon = REGIONS[key].center
            rad = self.working_radius_m(target)
            t0 = time.perf_counter()
            G0, disk = self.source.disk_graph(lat, lon, rad)
            rg0 = busan.route_graph(G0, disk, api._region(lat, lon))
            G1, rg1 = build_fast(sc, lat, lon, rad, api._region(lat, lon))
            same = graph_sig(G0) == graph_sig(G1) and routegraph_sig(rg0) == routegraph_sig(rg1)
            st |= {"self_test": f"{key} {target} m", "self_test_identical": same,
                   "self_test_s": round(time.perf_counter() - t0, 2)}
            if not same:
                st |= {"fast": False, "reason": "start-up self-test: fast graph differs from canonical"}
                self.fast_status = st
                return
        self.sidecar, self.fast_status = sc, st

    def _graph(self, lat: float, lon: float, radius: float, region) -> tuple:
        """RouteGenerator._graph with the build step replaced (same cache key and eviction)."""
        if self.sidecar is None:
            return super()._graph(lat, lon, radius, region)
        key = (round(lat, 6), round(lon, 6), round(radius))
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key] + (True,)
        G, rg = build_fast(self.sidecar, lat, lon, radius, region)
        self._cache[key] = (G, rg)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return G, rg, False


def first_osmid(v):
    """OSM attribute that may be a list (merged ways) -> its first value as int."""
    return int(v[0]) if isinstance(v, list) else int(v)


def disk(gen, lat: float, lon: float, target_m: float) -> tuple:
    """(G, rg) of the canonical working disk for a target of target_m around (lat, lon) (generator cache, same key);
    raises api.OutOfCoverageError outside the extract."""
    rad = gen.working_radius_m(target_m)
    gen._check_coverage(lat, lon, rad)
    G, rg, _ = gen._graph(lat, lon, rad, api._region(lat, lon))
    return G, rg


class GraphStore:
    """The pipeline's request-graph cache: LRU of GRAPH_CACHE_SIZE graphs, key = (round(lat, 6), round(lon, 6),
    round(working radius)). A miss builds the graph and its Running Suitability levels once."""

    def __init__(self, gen, data):
        self.gen, self.data = gen, data
        self._graphs: OrderedDict = OrderedDict()

    def get(self, lat: float, lon: float, target_m: float) -> CanonicalRoutingGraph:
        rad = self.gen.working_radius_m(target_m)
        key = (round(lat, 6), round(lon, 6), round(rad))
        if key in self._graphs:
            self._graphs.move_to_end(key)
            return self._graphs[key]
        d = self.data
        cg = build_request_graph(self.gen, lat, lon, target_m, d.env, d.thresholds, d.dem, d.cache)
        self._graphs[key] = cg
        while len(self._graphs) > GRAPH_CACHE_SIZE:
            self._graphs.popitem(last=False)
        cg.rs_node_dist = traffic_node_distance(cg, d.rs_cfg)
        cg.rs_levels = edge_levels(cg, cg.rs_node_dist, d.rs_cfg)
        return cg


# ------------------------------------------------------------------ flat arrays for the shortest-path kernel
class RouteCSR:
    """rg.H (the RUNNABLE routing graph) as flat lists for shortest_path.bidirectional.

    Nodes are indexed in H._adj order and each node's neighbours are listed in H._adj[node] order -- exactly the order
    networkx relaxes in, which the D-exact kernel must keep. Edge ids follow first appearance in that scan; length is
    the same Python float networkx reads from the edge data. Plain lists (scalar indexing in pure Python is faster than
    numpy).

    이웃 순서를 정렬하거나 바꾸면 길이가 같은 경로 중 다른 것이 뽑혀 후보와 TOP3가 바뀐다(D-exact tie-break의 전제).
    rg 객체에 붙여 한 번만 만든다(route_csr). graph와 수명이 같다."""

    def __init__(self, rg):
        H = rg.H
        self.ids = list(H._adj)                                   # node index -> OSM node id
        self.index = {n: i for i, n in enumerate(self.ids)}
        eid, length, ptr, nbr, ned = {}, [], [0], [], []
        for n in self.ids:
            for m, d in H._adj[n].items():
                k = rrg._key(n, m)
                if k not in eid:
                    eid[k] = len(length)
                    length.append(d["length"])
                nbr.append(self.index[m])
                ned.append(eid[k])
            ptr.append(len(nbr))
        self.eid, self.keys, self.length = eid, list(eid), length   # eid: rrg._key(u, v) -> edge id
        self.ptr, self.nbr, self.ned = ptr, nbr, ned

    def mult_array(self, mult: dict) -> list:
        """Per-edge multiplier from a {rrg._key: mult} dict; 1.0 where the dict has no key (route_through's default)."""
        return [mult.get(k, 1.0) for k in self.keys]


def route_csr(rg) -> RouteCSR:
    """RouteCSR of rg, built once and stored ON rg (same lifetime as the graph: no global cache)."""
    csr = getattr(rg, "_route_csr", None)
    if csr is None:
        csr = rg._route_csr = RouteCSR(rg)
    return csr

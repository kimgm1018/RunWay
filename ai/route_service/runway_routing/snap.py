"""Start and end snapping: which graph node a user's point becomes. Rules, not data access.

요약: 사용자 좌표를 달릴 수 있는 graph node로 옮기는 규칙(start, P2P 도착 PE1/PE4/PE5).
위치: graph 다음, 후보 생성 전. P2P의 app-max disk 2개는 기본값으로 substrate.py가 대신 계산한다.
주의: P2P는 한 번 snap한 node id를 끝까지 재사용한다(다시 snap하지 않는다).

LOOP / OUT_AND_BACK start  start = canonical rrg.snap_start (analysis, unchanged): nearest RUNNABLE node; when that
                           node is not on the main component, the nearest main-component node (shift_to_main_m). No PE
                           rule applies to a start. The app refuses a start more than 250 m from the network.
POINT_TO_POINT endpoints   p2p_endpoints (ug-v2 N1 + E-I3 B3): snap start AND destination ONCE on the app-maximum disk
                           (built at the user-point midpoint), then measure d_min on the app-maximum disk centred at the
                           midpoint of the SNAPPED nodes (radius 1.1 x 15 km / 2 + 250 m = 8.5 km, independent of T),
                           reusing the same node ids for generation. Snapping again on the smaller generation disk could
                           pick different nodes, so it must not happen.
P2P destination (end)      candidates = main-component RUNNABLE nodes within PE1's 250 m, nearest first;
                           PE4: skip a node incident to a forbidden edge (trunk / motorway (+link), EXCLUDED / UNCERTAIN,
                           road tunnel); PE5: skip a node when the straight user point -> node segment crosses a blocking
                           road or river / water / coast (usability_gate.pe5_blocked, the same function the Gate re-check
                           uses); first node that passes wins. None -> code PE5 if any candidate failed PE5, else PE4 if
                           any failed PE4, else PE1 -- fixed precedence, independent of candidate order.
OUT_AND_BACK turnaround    pe4_forbidden_nodes is also the turnaround filter (PE4 applies, PE5 does not).
"""
import math

import geopandas as gpd
import numpy as np
import networkx as nx
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, Point

from . import usability_gate as UG
from .data import ROAD_HW, UTM_CRS, api
from .gate import build_context
from .graph import NOT_A_TUNNEL, disk, first_osmid

rrg = api.rrg
pe5_blocked = UG.pe5_blocked
TO_UTM = Transformer.from_crs("EPSG:4326", UTM_CRS, always_xy=True)   # = runway_busan_graph.TO_UTM
TO_LL = Transformer.from_crs(UTM_CRS, "EPSG:4326", always_xy=True)


# ------------------------------------------------------------------ start (canonical rule, graph-level index)
def _edge_index(rg) -> tuple:
    """snap_start's per-edge LineStrings + STRtree, built once per RouteGraph object (same construction, same edge order)
    and stored ON the graph: it lives exactly as long as rg (generator LRU / a cached request graph), nothing global."""
    idx = getattr(rg, "_snap_edge_index", None)
    if idx is None:
        endpoints = getattr(rg, "_array_snap_endpoints", None)
        if endpoints is not None:
            lines = list(shapely.linestrings(np.stack(endpoints, axis=1)))
        else:
            lines = [LineString([(rg.H.nodes[a]["x"], rg.H.nodes[a]["y"]), (rg.H.nodes[b]["x"], rg.H.nodes[b]["y"])])
                     for a, b in rg.H.edges]
        idx = rg._snap_edge_index = (lines, shapely.STRtree(lines))
    return idx


def main_component_mask(rg) -> np.ndarray:
    """Boolean mask over rg.nodes: node on the main (longest) RUNNABLE component. Once per RouteGraph object."""
    m = getattr(rg, "_main_mask", None)
    if m is None:
        m = rg._main_mask = np.array([rg.comp[int(n)] == 0 for n in rg.nodes])
    return m


def start(rg, lat: float, lon: float) -> dict:
    """analysis/runway_route_generator.snap_start, unchanged rule and output, with the edge index and the main-component
    mask taken from the graph-level cache instead of being rebuilt on every call. Used for OUT_AND_BACK / P2P starts and,
    through candidates.loop, inside the canonical LOOP generator."""
    p = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(rg.crs).iloc[0]
    i, d_node = rrg._nearest(rg.xy, (p.x, p.y))
    near = rg.nodes[i]
    lines, tree = _edge_index(rg)
    d_edge = float(lines[int(tree.nearest(p))].distance(p))
    info = {"start_lat": lat, "start_lon": lon, "nearest_node": int(near), "snap_node_dist_m": round(d_node, 1),
            "snap_edge_dist_m": round(d_edge, 1), "nearest_node_component": rg.comp[near],
            "nearest_node_component_km": round(rg.comp_km[rg.comp[near]], 2),
            "start_in_main_component": rg.comp[near] == 0}
    if rg.comp[near] == 0:
        info["start_node"], info["shift_to_main_m"] = int(near), 0.0
    else:
        main = main_component_mask(rg)
        j, d_main = rrg._nearest(rg.xy[main], (p.x, p.y))
        info["start_node"], info["shift_to_main_m"] = int(rg.nodes[main][j]), round(d_main, 1)
    sx, sy = rg.H.nodes[info["start_node"]]["x"], rg.H.nodes[info["start_node"]]["y"]
    info["start_dist_to_bbox_edge_m"] = round(rg.bbox_poly.exterior.distance(Point(sx, sy)), 1)
    return info


# ------------------------------------------------------------------ P2P destination
def to_utm(lon: float, lat: float) -> tuple:
    return TO_UTM.transform(lon, lat)

def _s(v) -> str:
    if isinstance(v, list):
        return ";".join(map(str, v))
    return "" if v is None else str(v)

def _hw(d) -> set:
    v = d.get("highway")
    return set(map(str, v)) if isinstance(v, list) else {str(v)}

def _road_tunnel(d) -> bool:
    t = _s(d.get("tunnel"))
    return bool(_hw(d) & ROAD_HW) and t not in ("", "nan", "None") and t not in NOT_A_TUNNEL

def pe4_forbidden_nodes(G, ug2: dict) -> set:
    """Nodes incident to a PE4-forbidden edge of G. One full edge scan per graph object: the result is stored on G
    (read-only for callers) together with the rule it was computed for."""
    rule = ug2["end_point_rules"]["PE4"]["forbidden_incident_edges"]
    cached = getattr(G, "_runway_pe4_nodes", None)
    if cached is not None and cached[0] is rule:
        return cached[1]
    hws, sts = set(rule["highways"]), set(rule["status"])
    if getattr(G, "_is_array_graph", False):
        # 배열 G(H21 R1): 같은 판정을 way 단위로 한 번 하고(way의 모든 간선이 같은 tag·status), G의 선분 양 끝 node를 모은다.
        S = G.source.S
        flags = _way_pe4_flags(S, rule)
        m = flags[S.seg_w[G.seg]]
        bad = set(S.ids[G.a[m]].tolist()) | set(S.ids[G.b[m]].tolist())
        G._runway_pe4_nodes = (rule, bad)
        return bad
    bad = set()
    for u, v, d in G.edges(data=True):
        if _hw(d) & hws or _s(d.get("runway_status")) in sts or _road_tunnel(d):
            bad.update((u, v))
    G._runway_pe4_nodes = (rule, bad)
    return bad


def _way_pe4_flags(S, rule) -> np.ndarray:
    """Per way of the substrate: pe4_forbidden_nodes' edge test on the way's G edge data (useful tags + status; the other
    edge keys oneway / reversed / length / runway_reason are not read). Once per (substrate, rule object)."""
    cached = getattr(S, "_runway_pe4_ways", None)
    if cached is not None and cached[0] is rule:
        return cached[1]
    hws, sts = set(rule["highways"]), set(rule["status"])
    sc = S.sc
    flags = np.array([bool(_hw(d) & hws or _s(d.get("runway_status")) in sts or _road_tunnel(d))
                      for d in ({**sc.attrs[i], "runway_status": sc.cls[w][0]} for i, w in enumerate(sc.way_ids))], bool)
    S._runway_pe4_ways = (rule, flags)
    return flags

def pe5_blockers(G, ug2: dict) -> list:
    """Blocking road segments (trunk / motorway (+link) or EXCLUDED) of G as WGS84 lines. Once per graph object
    (stored on G with its rule, read-only for callers)."""
    rule = ug2["end_point_rules"]["PE5"]["blocking_edges"]
    cached = getattr(G, "_runway_pe5_lines", None)
    if cached is not None and cached[0] is rule:
        return cached[1]
    hws, sts = set(rule["highways"]), set(rule["status"])
    segs = []
    for u, v, d in G.edges(data=True):
        if _hw(d) & hws or _s(d.get("runway_status")) in sts:
            segs.append(shapely.LineString([(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])]))
    G._runway_pe5_lines = (rule, segs)
    return segs

def near(geoms, lon: float, lat: float, deg: float = 0.004) -> tuple:
    """Geometries within ~deg of the point (pre-selection for the Gate's RouteInput pe5_* fields; 0.004 deg > 250 m)."""
    box = shapely.box(lon - deg, lat - deg, lon + deg, lat + deg)
    return tuple(g for g in geoms if g.intersects(box))

def snap_end(rg, G, lat: float, lon: float, ug2: dict, env_lines=(), env_polys=(), is_bridge=None) -> dict:
    """P2P 도착 snap: main component node를 가까운 순서로(거리 동점은 stable) 보며, PE4/PE5를 통과한 첫 node.
    반환 {node, snap_m, code, rejected, pe5_inputs}. 실패 code는 PE5 > PE4 > PE1 고정 우선순위(후보 순서와 무관).
    pe5_inputs는 Gate의 PE5 재검사에 그대로 넘긴다. substrate.DiskMask.snap_end가 같은 규칙을 배열로 구현한다."""
    max_m = ug2["end_point_rules"]["PE1"]["max_destination_snap_m"]
    px, py = to_utm(lon, lat)
    main = main_component_mask(rg)
    nodes, xy = rg.nodes[main], rg.xy[main]
    d = np.hypot(xy[:, 0] - px, xy[:, 1] - py)
    order = np.argsort(d, kind="stable")
    forbidden = pe4_forbidden_nodes(G, ug2)
    edges = near(pe5_blockers(G, ug2), lon, lat)
    lines, polys = near(env_lines, lon, lat), near(env_polys, lon, lat)
    is_bridge = is_bridge or (lambda n: False)
    rejected = []
    for i in order:
        if d[i] > max_m:
            break
        n = int(nodes[i])
        if n in forbidden:
            rejected.append(("PE4", n))
            continue
        node_ll = (G.nodes[n]["x"], G.nodes[n]["y"]) if n in G.nodes else _ll_of(rg, n)
        if pe5_blocked((lon, lat), node_ll, edges, polys, lines, end_is_bridge=is_bridge(n)):
            rejected.append(("PE5", n))
            continue
        return {"node": n, "snap_m": float(d[i]), "code": None, "rejected": rejected,
                "pe5_inputs": {"edge_lines": edges, "env_polys": polys, "env_lines": lines}}
    codes = {c for c, _ in rejected}
    code = "PE5" if "PE5" in codes else "PE4" if "PE4" in codes else "PE1"
    return {"node": None, "snap_m": None, "code": code, "rejected": rejected,
            "pe5_inputs": {"edge_lines": edges, "env_polys": polys, "env_lines": lines}}

def _ll_of(rg, n) -> tuple:
    i = int(np.flatnonzero(rg.nodes == n)[0])
    return TO_LL.transform(*rg.xy[i])


def env_geoms(env: dict, classes: list) -> tuple:
    """(lines, polygons) of the env layer classes PE5 blocks on (river / water / coast)."""
    lay = env.get("layers") if isinstance(env, dict) else None
    if lay is None:
        return [], []
    g = lay.loc[lay["env_class"].isin(classes)].geometry
    polys = [x for x in g if x.geom_type in ("Polygon", "MultiPolygon")]
    lines = [x for x in g if x.geom_type not in ("Polygon", "MultiPolygon")]
    return lines, polys


def end(rg, G, end_lat, end_lon, ug2: dict, env: dict, source) -> dict:
    """PE1/PE2/PE4/PE5 snap of the destination; the bridge test is usability_gate.end_node_on_bridge on G."""
    lines, polys = env_geoms(env, ug2["end_point_rules"]["PE5"]["blocking_env_classes"])
    ctx = getattr(G, "_runway_gate_ctx", None)   # GateContext over G's edges: once per graph object
    if ctx is None:
        ctx = G._runway_gate_ctx = build_context(source, ((u, v, first_osmid(d["osmid"])) for u, v, d in G.edges(data=True)
                                                          if d.get("osmid") is not None))
    return snap_end(rg, G, end_lat, end_lon, ug2, env_lines=lines, env_polys=polys,
                    is_bridge=lambda n: UG.end_node_on_bridge(ctx, n))


def p2p_endpoints(gen, clat, clon, lat, lon, end_lat, end_lon, info: dict, shape_cfg: dict, ug2: dict, env: dict):
    """ug-v2 N1 + E-I3 B3: snap start and destination ONCE on the app-max disk (built at the user-point midpoint),
    then d_min on the app-max disk centred at the midpoint of those SNAPPED nodes (radius 1.1 x 15 / 2 + 250 m =
    8.5 km, independent of T), reusing the same node ids. No path inside -> OUT_OF_APP_RANGE (sentinel above
    16.5 km). None + info['_issues'] when the destination cannot be snapped."""
    app_max_m = shape_cfg["app_km"]["max"] * 1000
    tol = shape_cfg["tolerance"]["value"]
    G, rg = disk(gen, clat, clon, app_max_m)
    snap = start(rg, lat, lon)
    s = int(snap["start_node"])
    e = end(rg, G, end_lat, end_lon, ug2, env, gen.source)
    info["start"] = {"node": s, "snap_node_dist_m": snap["snap_node_dist_m"],
                     "shift_to_main_m": snap["shift_to_main_m"]}
    info["end"] = {"node": e["node"], "snap_m": e["snap_m"], "rejected": e["rejected"]}
    info["start_node"], info["end_node"] = s, e["node"]
    if e["node"] is None:
        info["_issues"] = [{"code": f"END_SNAP_{e['code']}",
                       "message": "도착지 근처에서 달릴 수 있는 안전한 길을 찾지 못했어요.", "blocking": True}]
        return None
    t = int(e["node"])
    info["_pe5"] = e["pe5_inputs"]
    (sx, sy), (tx, ty) = (rg.H.nodes[s]["x"], rg.H.nodes[s]["y"]), (rg.H.nodes[t]["x"], rg.H.nodes[t]["y"])
    m_lon, m_lat = TO_LL.transform((sx + tx) / 2, (sy + ty) / 2)
    if math.hypot(*np.subtract(to_utm(m_lon, m_lat), to_utm(clon, clat))) > 1.0:
        G, rg = disk(gen, m_lat, m_lon, app_max_m)
    info["d_min_disk"] = {"centre_lat": m_lat, "centre_lon": m_lon,
                          "radius_m": gen.working_radius_m(app_max_m)}
    if s not in rg.H or t not in rg.H:
        info["d_min_m"] = None
        return (1 + tol) * app_max_m * 1.0001
    try:
        p = nx.shortest_path_length(rg.H, s, t, weight="length")
    except nx.NetworkXNoPath:
        info["d_min_m"] = None
        return (1 + tol) * app_max_m * 1.0001   # no path within the 8.5 km disk -> OUT_OF_APP_RANGE
    info["d_min_m"] = float(p)
    return float(p)

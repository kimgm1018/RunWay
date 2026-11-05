"""RunWay round-trip route generator: the canonical LOOP algorithm (PoC origin).

Scope: from a start point and a target distance only, build several different closed running
routes on the RUNNABLE edges of the custom walk filter graph. No scoring, preference, ranking or
personalisation here.

Used by the service through analysis/runway_route_api.py, analysis/runway_busan_graph.py and runway_routing/
(RouteGraph, snap_start, make_candidate, trim_spurs, route_features, dedupe and the constants below).
The old PoC command line (run / route / compare over the cached 3 km survey graphs
reports/_osm_<region>_work/runway_walk_graph_classified.graphml, with CSV / GeoJSON / folium map reports) was removed
in S15P31E105-441: those survey graphs are not part of the data bundle. It stays in git history before that commit.

Generator (waypoint loop): for each seed, k waypoints (2-4) sit on a circle that passes through
the start, facing a random direction. Legs are shortest paths on the RUNNABLE graph; edges the
route already used cost more, so the way back prefers other streets. a -> b -> a dead-end
detours are trimmed, and the circle is rescaled until the route length is close to the target.

Graph range: every point of a closed route of length L lies within network distance L/2 of the
start, so a graph holding everything within (1 + tolerance) * L / 2 of the start is enough for
any candidate.
"""
import math
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import geopandas as gpd
import networkx as nx
import numpy as np
import shapely
from shapely.geometry import LineString, Point, box
from shapely.ops import polygonize, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir from sys.path
from osm_walk_inspect import Region  # noqa: E402

TARGET_M = 5000
TOLERANCE = 0.10          # valid candidate: |distance error| <= 10 %
ATTEMPTS = 40             # generation requests per start point
MAX_ITER = 6              # circle rescaling steps per attempt
ITER_STOP = 0.03          # stop rescaling once within 3 %
CIRCUITY0 = 1.3           # first guess of network / straight-line distance
REUSE_PENALTY = 4.0       # an edge already in the route costs (1 + 4 * uses) x its length
DEDUP_OVERLAP = 0.6       # shared length / shorter route >= 0.6 -> near-duplicate
EDGE_MARGIN_M = 100       # route node closer than this to the cached bbox edge -> flag
REPEATED_MAX = 0.20       # quality: at most 20 % of the length on edges used twice
OUT_AND_BACK_MAX = 0.30   # flag: more than 30 % of the length run there and back
MINOR_TURNS_PER_KM_MAX = 8
SELF_CROSSING_MAX = 3     # flag: the route crosses itself more than 3 times
SEED0 = 1000

RUNNABLE = "RUNNABLE"
FORBIDDEN_HW = {"trunk", "trunk_link", "motorway", "motorway_link", "busway", "raceway", "bus_guideway"}
WALK_DEDICATED = {"footway", "pedestrian", "path", "steps", "living_street", "track", "cycleway", "bridleway"}
MAJOR = {"primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link"}
MINOR = {"residential", "service", "unclassified"}
EDGE_ATTRS = ["length", "highway", "osmid", "name", "bridge", "tunnel", "runway_status", "runway_reason",
              "expressway", "toll", "motorroad", "foot", "access"]


def _present(v) -> bool:
    return v is not None and not (isinstance(v, float) and math.isnan(v)) and str(v) not in ("", "no")


@dataclass
class RouteGraph:
    region: Region
    H: nx.Graph                      # undirected RUNNABLE graph, projected (metres)
    crs: object
    full_status: dict                # (a, b) -> {status, ...} of every parallel edge in the classified graph
    nodes: np.ndarray                # node ids
    xy: np.ndarray                   # node coordinates, same order
    comp: dict                       # node -> component rank (0 = longest)
    comp_km: list
    bbox_poly: object                # cached survey bbox, projected
    wp_nodes: np.ndarray = field(default=None)   # waypoint pool: main-component intersections
    wp_xy: np.ndarray = field(default=None)


def _nearest(xy: np.ndarray, p: tuple) -> tuple[int, float]:
    d2 = ((xy - np.asarray(p)) ** 2).sum(axis=1)
    i = int(d2.argmin())
    return i, float(math.sqrt(d2[i]))


def snap_start(rg: RouteGraph, lat: float, lon: float) -> dict:
    """Nearest RUNNABLE node / edge; moves the start onto the main component if needed."""
    p = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(rg.crs).iloc[0]
    i, d_node = _nearest(rg.xy, (p.x, p.y))
    near = rg.nodes[i]
    lines = [LineString([(rg.H.nodes[a]["x"], rg.H.nodes[a]["y"]), (rg.H.nodes[b]["x"], rg.H.nodes[b]["y"])])
             for a, b in rg.H.edges]
    tree = shapely.STRtree(lines)
    d_edge = float(lines[int(tree.nearest(p))].distance(p))
    info = {"start_lat": lat, "start_lon": lon, "nearest_node": int(near), "snap_node_dist_m": round(d_node, 1),
            "snap_edge_dist_m": round(d_edge, 1), "nearest_node_component": rg.comp[near],
            "nearest_node_component_km": round(rg.comp_km[rg.comp[near]], 2),
            "start_in_main_component": rg.comp[near] == 0}
    if rg.comp[near] == 0:
        info["start_node"], info["shift_to_main_m"] = int(near), 0.0
    else:
        main = np.array([rg.comp[n] == 0 for n in rg.nodes])
        j, d_main = _nearest(rg.xy[main], (p.x, p.y))
        info["start_node"], info["shift_to_main_m"] = int(rg.nodes[main][j]), round(d_main, 1)
    sx, sy = rg.H.nodes[info["start_node"]]["x"], rg.H.nodes[info["start_node"]]["y"]
    info["start_dist_to_bbox_edge_m"] = round(rg.bbox_poly.exterior.distance(Point(sx, sy)), 1)
    return info


def _key(a, b) -> tuple:
    return (min(a, b), max(a, b))


def _route_through(rg: RouteGraph, seq: list) -> list | None:
    used = Counter()

    def w(u, v, d):
        return d["length"] * (1 + REUSE_PENALTY * used[_key(u, v)])

    path = [seq[0]]
    for a, b in zip(seq[:-1], seq[1:]):
        try:
            leg = nx.shortest_path(rg.H, a, b, weight=w)
        except nx.NetworkXNoPath:
            return None
        for x, y in zip(leg[:-1], leg[1:]):
            used[_key(x, y)] += 1
        path += leg[1:]
    return path


def trim_spurs(path: list) -> tuple[list, int]:
    """Drop a -> b -> a dead-end detours (a waypoint just off the line); start and end stay put."""
    path, n = list(path), 0
    i = 1
    while i < len(path) - 1:
        if path[i - 1] == path[i + 1] and len(path) > 3:
            del path[i:i + 2]
            n += 1
            i = max(1, i - 1)
        else:
            i += 1
    return path, n


def _length(rg: RouteGraph, path: list) -> float:
    return sum(rg.H[a][b]["length"] for a, b in zip(path[:-1], path[1:]))


def make_candidate(rg: RouteGraph, start: int, target: float, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    k = (2, 3, 4)[seed % 3]
    theta = rng.uniform(0, 2 * math.pi)
    jitter = rng.uniform(-0.35, 0.35, size=k) * (2 * math.pi / (k + 1))
    sx, sy = rg.H.nodes[start]["x"], rg.H.nodes[start]["y"]
    rho = target / (2 * math.pi * CIRCUITY0)
    best, tries = None, 0
    for _ in range(MAX_ITER):
        tries += 1
        cx, cy = sx + rho * math.cos(theta), sy + rho * math.sin(theta)
        wps = []
        for j in range(1, k + 1):
            a = theta + math.pi + j * 2 * math.pi / (k + 1) + jitter[j - 1]
            n = int(rg.wp_nodes[_nearest(rg.wp_xy, (cx + rho * math.cos(a), cy + rho * math.sin(a)))[0]])
            if n != start and (not wps or wps[-1] != n):
                wps.append(n)
        if not wps:
            rho *= 1.3
            continue
        path = _route_through(rg, [start] + wps + [start])
        if path is None:
            return {"seed": seed, "k": k, "failure": "no_path", "iterations": tries}
        path, spurs = trim_spurs(path)
        d = _length(rg, path)
        err = (d - target) / target
        if best is None or abs(err) < abs(best["err"]):
            best = {"path": path, "err": err, "waypoints": wps, "rho_m": rho, "spurs_trimmed": spurs}
        if abs(err) <= ITER_STOP:
            break
        rho *= (target / d) ** 0.9
    if best is None:
        return {"seed": seed, "k": k, "failure": "no_waypoint", "iterations": tries}
    return {"seed": seed, "k": k, "theta_deg": round(math.degrees(theta) % 360, 1), "iterations": tries,
            "failure": "", **best}


def _heading(p, q) -> float:
    return math.atan2(q[1] - p[1], q[0] - p[0])


def route_features(rg: RouteGraph, path: list, target: float) -> dict:
    H = rg.H
    pts = [(H.nodes[n]["x"], H.nodes[n]["y"]) for n in path]
    steps = list(zip(path[:-1], path[1:]))
    connected = all(H.has_edge(a, b) for a, b in steps)
    ed = [H[a][b] for a, b in steps]
    lens = np.array([e["length"] for e in ed])
    total = float(lens.sum())
    keys = [_key(a, b) for a, b in steps]
    uses, dirs = Counter(keys), defaultdict(set)
    for (a, b), k in zip(steps, keys):
        dirs[k].add((a, b))
    klen = {k: H[k[0]][k[1]]["length"] for k in uses}
    unique_len = sum(klen.values())
    oab_len = sum(klen[k] * uses[k] for k in uses if len(dirs[k]) == 2)
    hw = [str(e["highway"]) for e in ed]

    def ratio(types) -> float:
        return round(float(lens[[h in types for h in hw]].sum()) / total, 3) if total else 0.0

    interior = path[1:-1]
    deg3 = sum(1 for n in interior if H.degree(n) >= 3)
    revisits = sum(c - 1 for c in Counter(interior).values() if c > 1) + sum(1 for n in interior if n == path[0])
    # A crossing is two passes through one node that share no edge; running a stem out and back
    # (or the junction of a lollipop) shares an edge and is not counted.
    passes = defaultdict(list)
    for i in range(1, len(path) - 1):
        passes[path[i]].append({_key(path[i - 1], path[i]), _key(path[i], path[i + 1])})
    crossings = sum(1 for v in passes.values() for i in range(len(v)) for j in range(i + 1, len(v)) if not v[i] & v[j])
    uturns = sum(1 for i in range(1, len(path) - 1) if path[i - 1] == path[i + 1])
    turns = minor_turns = 0
    for i in range(1, len(path) - 1):
        a = _heading(pts[i - 1], pts[i])
        b = _heading(pts[i], pts[i + 1])
        ang = abs((b - a + math.pi) % (2 * math.pi) - math.pi)
        if ang >= math.radians(60):
            turns += 1
            if hw[i - 1] in MINOR and hw[i] in MINOR:
                minor_turns += 1
    line = LineString(pts)
    polys = list(polygonize(unary_union(line)))
    area = unary_union(polys).area if polys else 0.0
    start_pt = Point(pts[0])
    node_pts = shapely.points(np.array(pts))
    near_edge = shapely.distance(node_pts, rg.bbox_poly.exterior) < EDGE_MARGIN_M
    edge_dist = float(shapely.distance(node_pts, rg.bbox_poly.exterior).min())
    # length run along the cached bbox edge, where the graph is cut and the route may turn only because of that
    hug = float(sum(lens[i] for i in range(len(steps)) if near_edge[i] and near_edge[i + 1]))
    bad_status = sum(1 for (a, b), e in zip(steps, ed)
                     if e["runway_status"] != RUNNABLE or RUNNABLE not in rg.full_status.get(_key(a, b), set()))
    bad_hw = sum(1 for e in ed if str(e["highway"]) in FORBIDDEN_HW
                 or any(str(e.get(t)) == "yes" for t in ("expressway", "toll", "motorroad")))
    km = total / 1000 if total else float("nan")
    f = {"distance_m": round(total, 1), "distance_error_pct": round(100 * (total - target) / target, 2),
         "node_count": len(path) - 1, "edge_count": len(steps), "unique_edge_count": len(uses),
         "footway_ratio": ratio({"footway"}), "pedestrian_ratio": ratio({"pedestrian"}), "path_ratio": ratio({"path"}),
         "residential_ratio": ratio({"residential"}), "service_ratio": ratio({"service"}),
         "tertiary_ratio": ratio({"tertiary", "tertiary_link"}), "secondary_ratio": ratio({"secondary", "secondary_link"}),
         "major_road_ratio": ratio(MAJOR), "trail_ratio": ratio({"path", "track"}),
         "walk_dedicated_ratio": ratio(WALK_DEDICATED), "cycleway_ratio": ratio({"cycleway"}),
         "steps_count": len({e["osmid"] for e in ed if str(e["highway"]) == "steps"}),
         "steps_length_m": round(float(lens[[h == "steps" for h in hw]].sum()), 1),
         "intersection_count": deg3, "intersection_per_km": round(deg3 / km, 2),
         "bridge_length_m": round(float(sum(e["length"] for e in ed if _present(e.get("bridge")))), 1),
         "tunnel_length_m": round(float(sum(e["length"] for e in ed if _present(e.get("tunnel")))), 1),
         "unique_edge_ratio": round(min(1.0, unique_len / total), 3),
         "repeated_edge_ratio": round(max(0.0, 1 - unique_len / total), 3),
         "out_and_back_ratio": round(oab_len / total, 3),
         "loop_compactness": round(4 * math.pi * area / total ** 2, 3), "enclosed_area_km2": round(area / 1e6, 3),
         "node_revisit_count": revisits, "self_crossing_count": crossings, "uturn_count": uturns,
         "turns_per_km": round(turns / km, 2),
         "minor_road_turns_per_km": round(minor_turns / km, 2),
         "max_dist_from_start_m": round(max(Point(p).distance(start_pt) for p in pts), 1),
         "min_dist_to_bbox_edge_m": round(edge_dist, 1), "bbox_edge_hug_m": round(hug, 1),
         "closed": path[0] == path[-1], "connected": connected,
         "non_runnable_edges": bad_status, "removed_highway_edges": bad_hw}
    oab = f["out_and_back_ratio"]
    f["route_shape"] = "loop" if oab < 0.15 else "out_and_back" if oab >= 0.6 else "lollipop"
    flags = []
    if abs(f["distance_error_pct"]) > 100 * TOLERANCE:
        flags.append("distance_off")
    if f["repeated_edge_ratio"] > REPEATED_MAX:
        flags.append("repeated_edges")
    if oab > OUT_AND_BACK_MAX:
        flags.append("out_and_back_heavy")
    if uturns:
        flags.append("uturn")
    if f["minor_road_turns_per_km"] > MINOR_TURNS_PER_KM_MAX:
        flags.append("alley_zigzag")
    if crossings > SELF_CROSSING_MAX:
        flags.append("self_intersection_heavy")
    if not f["closed"]:
        flags.append("not_closed")
    if not connected:
        flags.append("disconnected")
    if bad_status:
        flags.append("non_runnable_edge")
    if bad_hw:
        flags.append("removed_highway_edge")
    if edge_dist < EDGE_MARGIN_M:
        flags.append("touches_bbox_edge")
    f["flags"] = ";".join(flags)
    f["valid"] = f["closed"] and connected and not bad_status and not bad_hw and "distance_off" not in flags
    f["quality_ok"] = f["valid"] and f["repeated_edge_ratio"] <= REPEATED_MAX and uturns == 0
    f["geometry"] = line
    f["edge_keys"] = {k: klen[k] for k in uses}
    return f


def overlap(a: dict, b: dict) -> float:
    """Shared length / length of the shorter route, on unique undirected edges (direction ignored)."""
    shared = sum(a[k] for k in a.keys() & b.keys())
    return shared / min(sum(a.values()), sum(b.values()))


def dedupe(cands: list[dict], threshold: float) -> tuple[list[dict], dict]:
    """Greedy: closest to the target distance first (an objective tie-break, not a preference)."""
    kept, dup_of = [], {}
    for c in sorted(cands, key=lambda c: (abs(c["distance_error_pct"]), c["seed"])):
        hit = next((k for k in kept if overlap(c["edge_keys"], k["edge_keys"]) >= threshold), None)
        if hit is None:
            kept.append(c)
        else:
            dup_of[c["seed"]] = hit["seed"]
    return sorted(kept, key=lambda c: c["seed"]), dup_of


"""RunWay dynamic round-trip route generator (PoC).

Scope: from a start point and a target distance only, build several different closed running
routes on the RUNNABLE edges of the custom walk filter graph. No scoring, preference, ranking or
personalisation: final candidates are numbered in generation order, not ordered by quality.

Input: reports/_osm_<region>_work/runway_walk_graph_classified.graphml (read only).
EXCLUDED / UNCERTAIN edges are dropped before routing, and every route is checked again
against the full classified graph.

Generator (waypoint loop): for each seed, k waypoints (2-4) sit on a circle that passes through
the start, facing a random direction. Legs are shortest paths on the RUNNABLE graph; edges the
route already used cost more, so the way back prefers other streets. a -> b -> a dead-end
detours are trimmed, and the circle is rescaled until the route length is close to the target.

Graph range: every point of a closed route of length L lies within network distance L/2 of the
start, so a graph holding everything within (1 + tolerance) * L / 2 of the start is enough for
any candidate. The cached survey boxes (3 km x 3 km) are smaller than that for 5 km, so routes
that come close to the box edge are flagged.

Usage (run from the RunWay root, isolated mode):
    <osm-venv>/Scripts/python.exe -I analysis/runway_route_generator.py run [region ...]
    <osm-venv>/Scripts/python.exe -I analysis/runway_route_generator.py route <region> <lat> <lon> <target_m>
    <osm-venv>/Scripts/python.exe -I analysis/runway_route_generator.py compare
"""
import json
import math
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import folium
import geopandas as gpd
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd
import shapely
from shapely.geometry import LineString, Point, box
from shapely.ops import polygonize, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir from sys.path
from osm_walk_inspect import REGIONS, ROOT, Region  # noqa: E402

COMPARISON_CSV = ROOT / "reports" / "runway_route_generation_comparison.csv"

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
COLORS = ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#a65628", "#f781bf", "#17becf",
          "#666666", "#bcbd22", "#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02"]


def _out(r: Region) -> Path:
    return ROOT / "reports" / f"_route_{r.key}_work"


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


def load_graph(r: Region) -> RouteGraph:
    G = ox.project_graph(ox.load_graphml(r.out / "runway_walk_graph_classified.graphml"))
    full_status = defaultdict(set)
    H = nx.Graph()
    for u, v, d in G.edges(data=True):
        key = (min(u, v), max(u, v))
        full_status[key].add(d["runway_status"])
        if d["runway_status"] != RUNNABLE:
            continue
        if H.has_edge(u, v) and H[u][v]["length"] <= d["length"]:
            continue
        H.add_edge(u, v, **{k: d.get(k) for k in EDGE_ATTRS})
    for n in H.nodes:
        H.nodes[n]["x"], H.nodes[n]["y"] = G.nodes[n]["x"], G.nodes[n]["y"]
    comps = sorted(nx.connected_components(H),
                   key=lambda c: -sum(d["length"] for *_, d in H.subgraph(c).edges(data=True)))
    comp = {n: i for i, c in enumerate(comps) for n in c}
    comp_km = [sum(d["length"] for *_, d in H.subgraph(c).edges(data=True)) / 1000 for c in comps]
    nodes = np.array(list(H.nodes))
    xy = np.array([(H.nodes[n]["x"], H.nodes[n]["y"]) for n in nodes])
    bbox_poly = gpd.GeoSeries([box(*r.bbox)], crs="EPSG:4326").to_crs(G.graph["crs"]).iloc[0]
    rg = RouteGraph(r, H, G.graph["crs"], full_status, nodes, xy, comp, comp_km, bbox_poly)
    pool = np.array([i for i, n in enumerate(nodes) if comp[n] == 0 and H.degree(n) >= 3])
    rg.wp_nodes, rg.wp_xy = nodes[pool], xy[pool]
    return rg


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


def generate(r: Region, lat: float, lon: float, target: float = TARGET_M, attempts: int = ATTEMPTS,
             out: Path | None = None) -> dict:
    rg = load_graph(r)
    snap = snap_start(rg, lat, lon)
    start = snap["start_node"]
    rows = []
    for i in range(attempts):
        c = make_candidate(rg, start, target, SEED0 + i)
        if c["failure"]:
            rows.append(c)
            continue
        f = route_features(rg, c.pop("path"), target)
        rows.append({**{k: v for k, v in c.items() if k != "err"}, **f})
    ok = [c for c in rows if not c["failure"]]
    valid = [c for c in ok if c["valid"]]
    good = [c for c in valid if c["quality_ok"]]
    final, dup_of = dedupe(good, DEDUP_OVERLAP)
    for n, c in enumerate(final, 1):
        c["final_label"] = f"Candidate {n}"
    for c in rows:
        c.setdefault("final_label", "")
        c["status"] = ("failed" if c["failure"] else "final" if c["final_label"] else
                       f"duplicate_of_{dup_of[c['seed']]}" if c["seed"] in dup_of else
                       "quality_flagged" if c.get("valid") else "invalid")
    s = _summary(r, rg, snap, target, rows, ok, valid, good, final)
    if out is not None:
        _export(r, rg, snap, target, rows, final, s, out)
    return {"summary": s, "rows": rows, "final": final}


def _summary(r, rg, snap, target, rows, ok, valid, good, final) -> dict:
    def mean(cs, k):
        return round(float(np.mean([c[k] for c in cs])), 3) if cs else None

    need_r = (1 + TOLERANCE) * target / 2
    sx, sy = rg.H.nodes[snap["start_node"]]["x"], rg.H.nodes[snap["start_node"]]["y"]
    disk = Point(sx, sy).buffer(need_r, quad_segs=64)
    err = np.array([abs(c["distance_error_pct"]) for c in valid]) if valid else np.array([np.nan])
    fails = Counter(c["failure"] for c in rows if c["failure"])
    pair = [overlap(a["edge_keys"], b["edge_keys"]) for i, a in enumerate(final) for b in final[i + 1:]]
    s = {"region": r.key, "label": r.label, "target_m": target, **snap,
         "runnable_main_component_pct_km": round(100 * rg.comp_km[0] / sum(rg.comp_km), 1),
         "runnable_components": len(rg.comp_km),
         "required_graph_radius_m": round(need_r), "cached_bbox_covers_required_disk_pct":
             round(100 * disk.intersection(rg.bbox_poly).area / disk.area, 1),
         "requests": len(rows), "generated": len(ok), "failures": sum(fails.values()),
         "failure_reasons": ";".join(f"{k}:{v}" for k, v in fails.items()),
         "closed": sum(c["closed"] for c in ok), "connected": sum(c["connected"] for c in ok),
         "non_runnable_edges_total": sum(c["non_runnable_edges"] for c in ok),
         "removed_highway_edges_total": sum(c["removed_highway_edges"] for c in ok),
         "within_5pct": sum(abs(c["distance_error_pct"]) <= 5 for c in ok),
         "within_10pct": sum(abs(c["distance_error_pct"]) <= 10 for c in ok),
         "valid": len(valid), "quality_ok": len(good), "final_after_dedupe": len(final),
         "valid_abs_error_mean_pct": round(float(np.nanmean(err)), 2),
         "valid_abs_error_median_pct": round(float(np.nanmedian(err)), 2),
         "valid_abs_error_p90_pct": round(float(np.nanpercentile(err, 90)), 2),
         "valid_abs_error_max_pct": round(float(np.nanmax(err)), 2),
         "final_abs_error_mean_pct": round(float(np.mean([abs(c["distance_error_pct"]) for c in final])), 2) if final else None,
         "valid_repeated_edge_ratio_mean": mean(valid, "repeated_edge_ratio"),
         "final_repeated_edge_ratio_mean": mean(final, "repeated_edge_ratio"),
         "valid_out_and_back_ratio_mean": mean(valid, "out_and_back_ratio"),
         "valid_shape_loop": sum(c["route_shape"] == "loop" for c in valid),
         "valid_shape_lollipop": sum(c["route_shape"] == "lollipop" for c in valid),
         "valid_shape_out_and_back": sum(c["route_shape"] == "out_and_back" for c in valid),
         "final_footway_path_ratio_mean": round(float(np.mean([c["footway_ratio"] + c["path_ratio"] for c in final])), 3) if final else None,
         "final_walk_dedicated_ratio_mean": mean(final, "walk_dedicated_ratio"),
         "final_major_road_ratio_mean": mean(final, "major_road_ratio"),
         "final_loop_compactness_mean": mean(final, "loop_compactness"),
         "final_pairwise_overlap_mean": round(float(np.mean(pair)), 3) if pair else None,
         "final_pairwise_overlap_max": round(float(np.max(pair)), 3) if pair else None,
         "valid_touching_bbox_edge": sum("touches_bbox_edge" in c["flags"] for c in valid),
         "final_touching_bbox_edge": sum("touches_bbox_edge" in c["flags"] for c in final),
         "final_bbox_edge_hug_m_max": round(float(max([c["bbox_edge_hug_m"] for c in final], default=0)), 1),
         "final_bbox_edge_hug_m_sum": round(float(sum(c["bbox_edge_hug_m"] for c in final)), 1),
         "valid_max_dist_from_start_median_m": round(float(np.median([c["max_dist_from_start_m"] for c in valid])), 1) if valid else None,
         "valid_max_dist_from_start_max_m": round(float(np.max([c["max_dist_from_start_m"] for c in valid])), 1) if valid else None}
    for flag in ("repeated_edges", "out_and_back_heavy", "uturn", "alley_zigzag", "self_intersection_heavy",
                 "touches_bbox_edge", "distance_off"):
        s[f"flag_{flag}"] = sum(flag in c["flags"].split(";") for c in ok)
    for t in (0.5, 0.6, 0.7, 0.8):
        s[f"final_if_overlap_{int(t * 100)}"] = len(dedupe(good, t)[0])
    return s


def _export(r, rg, snap, target, rows, final, s, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    keep = [c for c in rows if not c["failure"]]
    cols = [k for k in keep[0] if k not in ("geometry", "edge_keys", "waypoints")] if keep else []
    df = pd.DataFrame([{k: c.get(k) for k in ["seed", "k", "failure", "status", "final_label"] + cols} for c in rows])
    df = df.loc[:, ~df.columns.duplicated()]
    df["waypoints"] = [" ".join(map(str, c.get("waypoints", []))) for c in rows]
    df.to_csv(out / "candidates.csv", index=False, encoding="utf-8")

    ok = df[df["seed"].isin({c["seed"] for c in keep})].copy()  # same order as keep
    gdf = gpd.GeoDataFrame(ok, geometry=[c["geometry"] for c in keep], crs=rg.crs).to_crs("EPSG:4326")
    for c in gdf.columns:
        if gdf[c].dtype == bool:
            gdf[c] = gdf[c].astype(int)
    gdf.to_file(out / "candidates.geojson", driver="GeoJSON")

    pair = pd.DataFrame([[round(overlap(a["edge_keys"], b["edge_keys"]), 3) for b in final] for a in final],
                        index=[c["final_label"] for c in final], columns=[c["final_label"] for c in final])
    pair.to_csv(out / "final_overlap_matrix.csv", encoding="utf-8")
    (out / "summary.json").write_text(json.dumps(s, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    _map(r, rg, snap, final, gdf, out / "route_map.html")


def _feature(geom) -> dict:
    return {"type": "Feature", "properties": {}, "geometry": geom.__geo_interface__}


def _map(r, rg, snap, final, gdf, path: Path) -> None:
    start = gpd.GeoSeries([Point(rg.H.nodes[snap["start_node"]]["x"], rg.H.nodes[snap["start_node"]]["y"])],
                          crs=rg.crs).to_crs("EPSG:4326").iloc[0]
    m = folium.Map(location=(start.y, start.x), zoom_start=14, tiles="OpenStreetMap")
    bb = gpd.GeoSeries([rg.bbox_poly], crs=rg.crs).to_crs("EPSG:4326").iloc[0]
    folium.GeoJson(_feature(LineString(bb.exterior.coords)), name="cached graph bbox (3 km x 3 km)",
                   style_function=lambda f: {"color": "#333", "weight": 1, "dashArray": "6 6"}).add_to(m)
    fields = [("distance_m", "거리 (m)"), ("distance_error_pct", "목표 거리 오차 (%)"),
              ("walk_dedicated_ratio", "보행 전용 비율"), ("major_road_ratio", "major road 비율"),
              ("steps_count", "계단 (way 수)"), ("steps_length_m", "계단 길이 (m)"),
              ("intersection_per_km", "교차로/km"), ("repeated_edge_ratio", "반복 edge 비율"),
              ("out_and_back_ratio", "왕복 비율"), ("loop_compactness", "loop compactness"),
              ("route_shape", "형태"), ("flags", "flags")]
    for i, c in enumerate(final):
        g = gdf[gdf["seed"] == c["seed"]]
        row = g.iloc[0]
        html = f"<b>{c['final_label']}</b> (seed {c['seed']})<table>" + "".join(
            f"<tr><td>{lab}</td><td style='padding-left:8px'>{row[k]}</td></tr>" for k, lab in fields) + "</table>"
        fg = folium.FeatureGroup(name=f"{c['final_label']}: {row['distance_m'] / 1000:.2f} km", show=i < 3)
        folium.GeoJson(_feature(g.geometry.iloc[0]),
                       style_function=lambda f, col=COLORS[i % len(COLORS)]: {"color": col, "weight": 5, "opacity": 0.8},
                       popup=folium.Popup(html, max_width=320), tooltip=c["final_label"]).add_to(fg)
        fg.add_to(m)
    folium.Marker((start.y, start.x), tooltip=f"start (snap {snap['snap_node_dist_m']} m)",
                  icon=folium.Icon(color="black", icon="play")).add_to(m)
    folium.LayerControl(collapsed=False).add_to(m)
    m.save(path)


def run(keys: list[str]) -> None:
    for k in keys:
        r = REGIONS[k]
        print(f"\n##### {k} ({r.label}) start={r.center} target={TARGET_M} m #####")
        res = generate(r, r.center[0], r.center[1], TARGET_M, ATTEMPTS, out=_out(r))
        for key, v in res["summary"].items():
            print(f"{key:40s} {v}")
        show = ["seed", "k", "status", "distance_m", "distance_error_pct", "route_shape", "repeated_edge_ratio",
                "out_and_back_ratio", "loop_compactness", "walk_dedicated_ratio", "major_road_ratio", "flags"]
        df = pd.DataFrame([{c: row.get(c) for c in show} for row in res["rows"]])
        with pd.option_context("display.width", 250, "display.max_rows", 100):
            print(df.to_string(index=False))


def compare(keys: list[str]) -> None:
    df = pd.DataFrame([json.loads((_out(REGIONS[k]) / "summary.json").read_text(encoding="utf-8")) for k in keys])
    df.to_csv(COMPARISON_CSV, index=False, encoding="utf-8-sig")
    print("wrote", COMPARISON_CSV, df.shape)
    with pd.option_context("display.width", 250, "display.max_rows", 200):
        print(df.set_index("region").T.to_string())


def main(argv: list[str]) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ox.settings.log_console = False
    cmd = argv[0] if argv else "run"
    if cmd == "route":
        key, lat, lon, target = argv[1], float(argv[2]), float(argv[3]), float(argv[4])
        res = generate(REGIONS[key], lat, lon, target, ATTEMPTS)
        print(json.dumps(res["summary"], ensure_ascii=False, indent=1, default=str))
        return
    keys = argv[1:] or list(REGIONS)
    unknown = [k for k in keys if k not in REGIONS]
    if unknown:
        raise SystemExit(f"unknown region(s) {unknown}; use {list(REGIONS)}")
    if cmd == "run":
        run(keys)
    elif cmd == "compare":
        compare(keys)
    else:
        raise SystemExit(f"unknown command {cmd!r}; use run, route or compare")


if __name__ == "__main__":
    main(sys.argv[1:])

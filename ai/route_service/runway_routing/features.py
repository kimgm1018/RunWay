"""Route features, validity and Running Suitability components: one route (a node walk on the request graph) ->
the numbers that scoring, the gate and the explanation read. No scoring and no ranking here.

요약: 후보 경로 하나에서 거리, 도로 종류, 환경, 모양, 고도, 러닝 적합도 성분을 계산하고 유효성(±10 % 등)을 판정한다.
위치: 후보 생성 다음, scorer 전.
주의: 유효성 수치는 Gate(ug F5/F6)도 따로 검사한다. 한쪽만 바꾸면 안 된다.

  features_for_osm_route / route_features   distances, highway shares, env shares, shape (repeat / out-and-back),
                                            coverage, DEM profile, verify_runnable (EXCLUDED / UNCERTAIN / unknown use)
  adapter_features                          canonical candidate -> features + env coverage + unavailable features
  loop_pool / shape_pool                    pool records (+ invalid_reason) in the order the API debug and log expect
  loop_invalid_reason                       LOOP validity: closed, RUNNABLE only, |error| <= 10 %, repeated <= 0.20,
                                            out-and-back <= 0.30. The Usability Gate re-checks the same numbers on
                                            its own (ug-v1 F5 / F6): intentional defence in depth, keep both.
  shape_invalid_reason                      OUT_AND_BACK / POINT_TO_POINT validity from ug-v2's type matrix (F6)
  route_components                          Running Suitability V1 (config/running_suitability_config.json)

Distance rule (+-10 %, TOLERANCE): a route is valid only when |distance - target| <= 10 % of the target. It is the
app contract for every shape (P2P: length in [0.9 T, 1.1 T]) and the scorer's distance_fit goes to 0 at the same edge.
"""
from collections import Counter
from types import SimpleNamespace

import numpy as np

from .data import RUNNABLE
from .graph import first_osmid

LOOP = "LOOP"
SHAPE_LOOP_MAX_OAB = 0.15        # out_and_back_ratio below this -> LOOP
SHAPE_LOLLIPOP_MAX_OAB = 0.60    # below this -> LOLLIPOP, otherwise OUT_AND_BACK
COVERAGE_EDGE_M = 100.0

# Same validity rules as the PoC generator for LOOP requests (runway_route_generator.GeneratorConfig).
# ±10 %는 사용자 결정 3번(목표 T에 대해 [0.9T, 1.1T])이다. 모든 shape에 같은 계약이고, scorer의 distance_fit도 이 경계에서
# 0이 되며, Gate(ug F5)도 같은 수치로 다시 검사한다. 한 곳만 바꾸면 "생성은 통과했는데 Gate가 FAIL" 같은 불일치가 생긴다
# (같은 값이 있는 곳: config/CONFIG_NOTES.md).
TOLERANCE = 0.10
MAX_REPEATED_RATIO = 0.20
MAX_OAB_LOOP = 0.30
# Features the canonical extract cannot provide (left None, not 0):
#   in_osmnx_walk exists only for the survey graphs -> recovered_cycleway_ratio
#   the extract keeps no node tags -> crossing / traffic signal counts
UNAVAILABLE_FEATURES = ("recovered_cycleway_ratio", "crossing_node_count", "traffic_signals_count")
ELEVATION_KEYS = ("elevation_gain_m", "elevation_loss_m", "elevation_min_m", "elevation_max_m", "avg_grade_pct",
                  "max_grade_pct", "steep_segment_ratio", "gain_per_km", "profile_m")
TERM = "running_suitability"
LABEL = "러닝 적합도"
RESAMPLE_M = 20.0
SMOOTH_MEDIAN_N = 5      # samples (100 m)
SMOOTH_MEAN_N = 3        # samples (60 m)
GRADE_WINDOW_M = 100.0
STEEP_GRADE_PCT = 6.0


# ------------------------------------------------------------------ route features
def classify_shape(oab: float) -> str:
    return "LOOP" if oab < SHAPE_LOOP_MAX_OAB else "LOLLIPOP" if oab < SHAPE_LOLLIPOP_MAX_OAB else "OUT_AND_BACK"

def route_features(graph, nodes: list[int], eids: list[int], target_m: float) -> dict:
    A = graph.ea
    eids_a = np.asarray(eids, dtype=np.int64)
    L = A["length"][eids_a]
    dist = float(L.sum())
    f = {"distance_m": round(dist, 1),
         "distance_error_pct": round(100 * (dist - target_m) / target_m, 2),
         "node_count": len(nodes), "edge_count": len(eids)}
    share = lambda mask: round(float(L[mask[eids_a]].sum() / dist), 4) if dist > 0 else 0.0  # noqa: E731

    for h in ("footway", "pedestrian", "path", "track", "residential", "service", "tertiary", "secondary",
              "primary", "cycleway"):
        f[f"{h}_ratio"] = share(A[f"hw_{h}"])
    f["shared_cycleway_ratio"] = f.pop("cycleway_ratio")
    f["major_road_ratio"] = share(A["major"])
    f["walk_dedicated_ratio"] = share(A["walk_dedicated"])
    f["trail_ratio"] = share(A["trail"])

    # structure
    steps = A["hw_steps"][eids_a]
    f["steps_length_m"] = round(float(L[steps].sum()), 1)
    f["steps_count"] = int(np.sum(steps & ~np.r_[False, steps[:-1]]))  # contiguous runs of steps
    f["steps_per_km"] = round(f["steps_count"] / (dist / 1000), 3) if dist else 0.0
    inner = np.asarray(nodes[1:-1], dtype=np.int64)
    f["intersection_count"] = int((graph.full_degree[inner] >= 3).sum())
    f["intersection_per_km"] = round(f["intersection_count"] / (dist / 1000), 2) if dist else 0.0
    nh = graph.node_highway[inner]
    f["crossing_node_count"] = int((nh == "crossing").sum())
    f["traffic_signals_count"] = int((nh == "traffic_signals").sum())
    f["bridge_length_m"] = round(float(L[A["bridge"][eids_a]].sum()), 1)
    f["tunnel_length_m"] = round(float(L[A["tunnel"][eids_a]].sum()), 1)
    f["tunnel_ratio"] = round(f["tunnel_length_m"] / dist, 4) if dist else 0.0

    # shape: repeats and both-direction use
    cnt = Counter(eids)
    dirs = {}
    for a, eid in zip(nodes[:-1], eids):
        dirs.setdefault(eid, set()).add(a == A["u"][eid])
    uniq = np.fromiter(cnt.keys(), dtype=np.int64)
    times = np.fromiter(cnt.values(), dtype=np.int64)
    uL = A["length"][uniq]
    both = np.array([len(dirs[e]) == 2 for e in uniq])
    f["unique_edge_ratio"] = round(float(uL.sum() / dist), 4) if dist else 0.0
    f["repeated_edge_ratio"] = round(float((uL * (times - 1)).sum() / dist), 4) if dist else 0.0
    f["out_and_back_ratio"] = round(float((uL * times)[both].sum() / dist), 4) if dist else 0.0
    f["shape"] = classify_shape(f["out_and_back_ratio"])
    f["closed"] = bool(nodes[0] == nodes[-1])
    sx, sy = graph.x[nodes[0]], graph.y[nodes[0]]
    f["max_dist_from_start_m"] = round(float(np.hypot(graph.x[nodes] - sx, graph.y[nodes] - sy).max()), 1)
    dcov = graph.dist_to_coverage_edge_m(np.asarray(nodes))
    f["min_dist_to_coverage_edge_m"] = round(float(dcov.min()), 1)
    f["touches_coverage_edge"] = bool(dcov.min() < COVERAGE_EDGE_M)

    # environment
    f["river_ratio"] = share(A["river_near"])
    f["water_ratio"] = share(A["water_near"])
    f["coastal_ratio"] = share(A["coastal_near"])
    f["beach_ratio"] = share(A["beach_near"])
    f["waterfront_ratio"] = share(A["waterfront_near"])
    f["park_ratio"] = share(A["park_near"])
    f["green_ratio"] = share(A["green_near"])
    f["recovered_cycleway_ratio"] = share(A["recovered"])

    # elevation (optional)
    if getattr(graph, "node_z", None) is not None:
        flat = A["bridge"][eids_a] | A["tunnel"][eids_a]
        f.update(profile_features(graph.node_z[np.asarray(nodes)], L, flat))
    else:
        f["elevation_available"] = False

    f.update(verify_runnable(graph, nodes, eids))
    return f

def features_for_osm_route(graph, osm_nodes: list[int], target_m: float) -> dict:
    """Generator-independent entry: features of any route given as an OSM node id sequence.

    This is the hook for the canonical generator (analysis/runway_route_generator.py, owned by
    another workstream): its node sequences can be scored here without using this PoC generator.
    Consecutive nodes must be joined by a RUNNABLE edge of the merged five-region graph; a pair
    that is not (other graph, non-RUNNABLE edge, missing data) is reported, not silently skipped."""
    idx = [graph.node_index.get(int(n)) for n in osm_nodes]
    missing_nodes = sum(i is None for i in idx)
    eids, missing_pairs = [], 0
    for a, b in zip(idx[:-1], idx[1:]):
        eid = None if a is None or b is None else graph.pair_to_eid.get((a, b) if a < b else (b, a))
        if eid is None:
            missing_pairs += 1
        else:
            eids.append(eid)
    if missing_nodes or missing_pairs:
        return {"ok": False, "missing_nodes": missing_nodes, "pairs_without_runnable_edge": missing_pairs,
                "message": "route is not fully on the RUNNABLE graph of the five survey boxes"}
    return {"ok": True, **route_features(graph, idx, eids, target_m)}

def verify_runnable(graph, nodes: list[int], eids: list[int]) -> dict:
    """Independent check against the merged classified graph (all statuses), not the routing arrays."""
    bad = Counter()
    full = graph.full
    for a, b, eid in zip(nodes[:-1], nodes[1:], eids):
        oa, ob = int(graph.node_ids[a]), int(graph.node_ids[b])
        osmid = int(graph.ea["osmid"][eid])
        data = full.get_edge_data(oa, ob) or {}
        st = [d["runway_status"] for d in data.values() if int(d["osmid"]) == osmid]
        if not st:
            bad["missing_in_classified_graph"] += 1
        elif st[0] != RUNNABLE:
            bad[st[0]] += 1
    return {"excluded_edges_used": int(bad.get("EXCLUDED", 0)),
            "uncertain_edges_used": int(bad.get("UNCERTAIN", 0)),
            "unknown_edges_used": int(bad.get("missing_in_classified_graph", 0))}


def _rolling(a: np.ndarray, n: int, fn) -> np.ndarray:
    if n <= 1 or len(a) < n:
        return a
    pad = n // 2
    p = np.pad(a, pad, mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(p, n)
    return fn(win, axis=1)[: len(a)]

def profile_features(node_z: np.ndarray, seg_len: np.ndarray, seg_flat: np.ndarray) -> dict:
    """Elevation features of one route.

    node_z: DEM elevation of the route nodes (len n); seg_len: segment lengths (n-1);
    seg_flat: True where the segment is a bridge or tunnel (interpolated, not sampled)."""
    z = node_z.astype(float).copy()
    cum = np.r_[0.0, np.cumsum(seg_len)]
    # bridge/tunnel runs: interpolate interior nodes between the run's first and last node
    i, n = 0, len(seg_flat)
    while i < n:
        if seg_flat[i]:
            j = i
            while j < n and seg_flat[j]:
                j += 1
            a, b = i, j  # node indices of run start/end
            if np.isfinite(z[a]) and np.isfinite(z[b]) and b - a > 1:
                z[a + 1:b] = np.interp(cum[a + 1:b], [cum[a], cum[b]], [z[a], z[b]])
            i = j
        else:
            i += 1
    good = np.isfinite(z)
    if good.sum() < 2 or cum[-1] < 2 * GRADE_WINDOW_M:
        return {"elevation_available": False}
    xs = np.arange(0.0, cum[-1] + 1e-9, RESAMPLE_M)
    zs = np.interp(xs, cum[good], z[good])
    zs = _rolling(zs, SMOOTH_MEDIAN_N, np.median)
    zs = _rolling(zs, SMOOTH_MEAN_N, np.mean)
    d = np.diff(zs)
    gain, loss = float(d[d > 0].sum()), float(-d[d < 0].sum())
    k = max(1, int(round(GRADE_WINDOW_M / RESAMPLE_M)))
    gw = (zs[k:] - zs[:-k]) / (k * RESAMPLE_M) * 100 if len(zs) > k else np.array([0.0])
    return {"elevation_available": True,
            "elevation_gain_m": round(gain, 1), "elevation_loss_m": round(loss, 1),
            "elevation_min_m": round(float(zs.min()), 1), "elevation_max_m": round(float(zs.max()), 1),
            "avg_grade_pct": round(100 * (gain + loss) / cum[-1], 2),
            "max_grade_pct": round(float(np.abs(gw).max()), 1),
            "steep_segment_ratio": round(float((np.abs(gw) >= STEEP_GRADE_PCT).mean()), 3),
            "gain_per_km": round(gain / (cum[-1] / 1000), 1),
            "profile_m": [round(float(v), 1) for v in zs[:: max(1, len(zs) // 120)]]}


def uturns(path: list) -> int:
    return sum(1 for i in range(1, len(path) - 1) if path[i - 1] == path[i + 1])


# ------------------------------------------------------------------ canonical / shape candidates -> pool records
def _route_index(cg, osm_nodes):
    """Node indices and routing edge ids of an OSM node walk (None when a pair has no RUNNABLE edge)."""
    idx = [cg.node_index.get(int(n)) for n in osm_nodes]
    if any(i is None for i in idx):
        return None, None
    eids = [cg.pair_to_eid.get((a, b) if a < b else (b, a)) for a, b in zip(idx[:-1], idx[1:])]
    return (idx, eids) if all(x is not None for x in eids) else (None, None)


def adapter_features(cg, c, target_m, env_name):
    f = features_for_osm_route(cg, c.node_sequence, target_m)
    if not f.pop("ok"):
        return f, None, None
    idx, eids = _route_index(cg, c.node_sequence)
    L = cg.ea["length"][np.asarray(eids)]
    f["env_layer"] = env_name
    f["env_layer_covered_ratio"] = round(float(L[cg.env_covered[eids]].sum() / L.sum()), 4) if L.sum() else 0.0
    for k in UNAVAILABLE_FEATURES:
        f[k] = None
    if f.get("elevation_available"):
        z = cg.node_z[np.asarray(idx)]
        if not np.isfinite(z).all():  # route leaves the DEM clip: interpolated gaps would be invented
            for k in ELEVATION_KEYS:
                f.pop(k, None)
            f["elevation_available"] = False
            f["elevation_note"] = f"{int((~np.isfinite(z)).sum())} route nodes outside the DEM clip"
    # Parallel RUNNABLE ways between one node pair: both sides keep the shortest, ties may differ.
    mism = [{"u": e["u"], "v": e["v"], "canonical_way": e["osm_way_id"], "canonical_highway": e["highway"],
             "canonical_length_m": e["length_m"], "adapter_way": int(cg.ea["osmid"][eid]),
             "adapter_highway": cg.redges.at[eid, "highway"], "adapter_length_m": round(float(cg.ea["length"][eid]), 2)}
            for e, eid in zip(c.edge_sequence, eids) if int(cg.ea["osmid"][eid]) != e["osm_way_id"]]
    f["osmid_mismatch_edges"] = len(mism)
    f["_osmid_mismatches"] = mism
    return f, idx, eids


def loop_invalid_reason(f: dict, route_type: str) -> str | None:
    """runway_route_generator.generate() validity, applied to canonical routes."""
    if not f["closed"]:
        return "not_closed"
    if f["excluded_edges_used"] or f["uncertain_edges_used"] or f["unknown_edges_used"]:
        return "forbidden_edge_used"
    if abs(f["distance_error_pct"]) > 100 * TOLERANCE:
        return "distance_out_of_tolerance"
    if route_type == LOOP and f["repeated_edge_ratio"] > MAX_REPEATED_RATIO:
        return "too_repetitive"
    if route_type == LOOP and f["out_and_back_ratio"] > MAX_OAB_LOOP:
        return "not_a_loop"
    return None


def shape_invalid_reason(shape, f, path, s, t, target_m, tol: float, F6: dict) -> str | None:
    """OUT_AND_BACK / POINT_TO_POINT validity (ug-v2 type matrix F6; tol = shape_config tolerance)."""
    if f["excluded_edges_used"] or f["uncertain_edges_used"] or f["unknown_edges_used"]:
        return "forbidden_edge_used"
    if abs(f["distance_error_pct"]) > 100 * tol:
        return "distance_out_of_tolerance"
    if shape == "out_and_back":
        r = F6["OUT_AND_BACK"]
        if not f["closed"] or path[0] != s or path != path[::-1]:
            return "not_out_and_back"
        if uturns(path) != r["exact_immediate_uturns"]:
            return "uturn_count"
        if f["out_and_back_ratio"] < r["min_out_and_back_ratio"] or f["repeated_edge_ratio"] > r["max_repeated_edge_ratio"]:
            return "not_out_and_back"
        return None
    r = F6["POINT_TO_POINT"]
    if f["closed"] or path[0] != s or path[-1] != t:
        return "endpoints"
    if f["repeated_edge_ratio"] > r["max_repeated_edge_ratio"]:
        return "too_repetitive"
    if f["out_and_back_ratio"] > r["max_out_and_back_ratio"]:
        return "too_much_backtracking"
    if uturns(path) > r["max_immediate_uturns"]:
        return "uturn_count"
    return None


def loop_pool(cg, candidates: list, target_m: float, env_name) -> list:
    """Canonical candidates -> pool records (key order is the debug / log contract)."""
    pool = []
    for c in candidates:
        f, idx, eids = adapter_features(cg, c, target_m, env_name)
        rec = {"candidate_id": c.candidate_id, "canonical_label": c.label, "canonical_flags": c.flags,
               "generation": c.generation, "canonical_features": c.features,
               "osmid_mismatches": f.pop("_osmid_mismatches", []), "features": f, "nodes": idx, "eids": eids}
        if idx is None:
            rec["invalid_reason"] = "not_on_canonical_runnable_graph"
        else:
            rec["invalid_reason"] = loop_invalid_reason(f, LOOP)
            rec["coords"] = [[round(float(cg.lat[n]), 6), round(float(cg.lon[n]), 6)] for n in idx]
        pool.append(rec)
    return pool


def shape_pool(cg, rg, generated: list, shape: str, s, t, target_m, env_name, tol: float, F6: dict) -> list:
    """OUT_AND_BACK / POINT_TO_POINT generator output -> pool records (same features as LOOP; t None for OAB)."""
    pool = []
    for g in generated:
        path = g["path"]
        es = [{"u": int(a), "v": int(b), "osm_way_id": first_osmid(rg.H[a][b]["osmid"]),
               "highway": rg.H[a][b].get("highway"), "length_m": float(rg.H[a][b]["length"])}
              for a, b in zip(path[:-1], path[1:])]
        c = SimpleNamespace(node_sequence=[int(n) for n in path], edge_sequence=es, candidate_id=int(g["seed"]),
                            label=f"{shape} {g['seed']}", flags=[], features={},
                            generation={k: v for k, v in g.items() if k != "path"})
        f, idx, eids = adapter_features(cg, c, target_m, env_name)
        rec = {"candidate_id": c.candidate_id, "canonical_label": c.label, "canonical_flags": [],
               "generation": c.generation, "canonical_features": {}, "features": f, "nodes": idx, "eids": eids,
               "osmid_mismatches": f.pop("_osmid_mismatches", [])}
        if idx is None:
            rec["invalid_reason"] = "not_on_canonical_runnable_graph"
        else:
            rec["invalid_reason"] = shape_invalid_reason(shape, f, path, s, t, target_m, tol, F6)
            rec["coords"] = [[round(float(cg.lat[n]), 6), round(float(cg.lon[n]), 6)] for n in idx]
        pool.append(rec)
    return pool


# ------------------------------------------------------------------ Running Suitability V1 components
def route_components(cg, levels: dict, eids, features: dict, cfg: dict) -> dict:
    """Route-level components; every number needed to explain the score."""
    ei = np.asarray(eids, dtype=np.int64)
    L = cg.ea["length"][ei]
    tot = float(L.sum())
    if tot <= 0:
        return {}
    on = float(L[levels["on"][ei]].sum() / tot)
    beside = float(L[levels["beside"][ei]].sum() / tot)
    traffic = float((L * levels["level"][ei]).sum() / tot)
    spk = float(features.get("steps_per_km") or 0.0)
    obstacle = max(0.0, 1.0 - spk / cfg["obstacle"]["steps_runs_per_km_zero"])
    c = cfg["combine"]
    s = c["traffic"] * traffic + c["obstacle"] * obstacle
    return {TERM: round(s, 4), "rs_traffic_score": round(traffic, 4), "rs_obstacle_score": round(obstacle, 4),
            "rs_on_major_ratio": round(on, 4), "rs_beside_major_ratio": round(beside, 4),
            "rs_away_ratio": round(1 - on - beside, 4), "rs_steps_runs_per_km": round(spk, 3),
            "rs_version": cfg["version"]}


def add_running_suitability(valid: list, cg, rs_cfg: dict) -> None:
    """route_components into every valid record's features (cg.rs_levels is built once per graph)."""
    for r in valid:
        r["features"].update(route_components(cg, cg.rs_levels, r["eids"], r["features"], rs_cfg))

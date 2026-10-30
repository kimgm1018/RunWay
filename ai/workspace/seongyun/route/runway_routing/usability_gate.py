"""Route Usability Gate (IMPL-1 P1): pure rule functions over one generated route. No I/O except load_config.

Configs (frozen, pre-registered): config/ug-v1.json (LOOP, Design B) and config/ug-v2.json (course types, PE rules).
The caller (pipeline wrapper) supplies:
  GateContext  read-only views of the request graph: way(osmid) -> (refs, tags) from BusanSource.ways,
               lonlat(node) -> (lon, lat), incident(node) -> [(neighbour, osmid)] over ALL statuses (cg.edges_all),
               classify = analysis/runway_walk_filter.classify imported unchanged
  RouteInput   one route: OSM node walk, adapter way per traversal (+ optional canonical way), stored lengths, request
Rule codes: F1-F7 (hard), R1_MOTORWAY / R1_TRUNK / R2 / R3 / R4_FAIL / R4_REVIEW / R5_ALPINE / R5_DEMANDING / R6, PE1-PE6.
Levels come from the config (Design B). REVIEW never changes ranking; the caller logs review_segments.
"""
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

R_EARTH = 6371009.0  # osmnx great_circle radius (RunWay edge lengths)
TYPES = ("LOOP", "MIXED", "OUT_AND_BACK", "POINT_TO_POINT")
CLOSED_TYPES = ("LOOP", "MIXED", "OUT_AND_BACK")
NOT_A_TUNNEL = {"no", "building_passage"}


# ------------------------------------------------------------------ inputs / outputs
@dataclass(frozen=True)
class GateContext:
    way: Callable[[int], tuple | None]
    lonlat: Callable[[int], tuple | None]
    incident: Callable[[int], list]
    classify: Callable[[dict], tuple]


@dataclass(frozen=True)
class RouteInput:
    request_type: str
    nodes: tuple
    ways: tuple
    lengths_m: tuple
    target_m: float
    start_node: int
    start_snap_m: float
    start_in_extract: bool = True
    canonical_ways: tuple | None = None
    payload_latlon: tuple | None = None
    min_dist_to_area_edge_m: float | None = None
    end_node: int | None = None
    dest_snap_m: float | None = None
    dest_in_extract: bool | None = None
    dest_lonlat: tuple | None = None
    same_component: bool | None = None
    pe5_edge_lines: tuple = ()
    pe5_env_polys: tuple = ()
    pe5_env_lines: tuple = ()


@dataclass
class GateResult:
    verdict: str
    fail_codes: list
    review_codes: list
    review_segments: list = field(default_factory=list)
    fail_segments: list = field(default_factory=list)      # tag-based FAIL hits (review_queue, action candidate_removed)
    incident_segments: list = field(default_factory=list)  # structural FAIL detail (incidents log; must stay empty)
    alt_way_review: list = field(default_factory=list)
    observations: dict = field(default_factory=dict)
    gate_version: dict | None = None

    def to_dict(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------ config / version
def load_config(path_v1, path_v2=None) -> dict:
    v1 = json.loads(Path(path_v1).read_text(encoding="utf-8"))
    v2 = json.loads(Path(path_v2).read_text(encoding="utf-8")) if path_v2 else None
    return {"v1": v1, "v2": v2}


def rule_levels(cfg: dict) -> dict:
    r = cfg["v1"]["rules"]
    lv = {f"F{i}": r[f"F{i}"]["level"] for i in range(1, 8)}
    lv["R1_MOTORWAY"] = r["R1"]["classes"]["motorway"]["level"]
    lv["R1_TRUNK"] = r["R1"]["classes"]["trunk"]["level"]
    lv["R2"], lv["R3"], lv["R6"] = r["R2"]["level"], r["R3"]["level"], r["R6"]["level"]
    lv["R4_FAIL"], lv["R4_REVIEW"] = r["R4"]["sets"]["fail"]["level"], r["R4"]["sets"]["review"]["level"]
    lv["R5_ALPINE"], lv["R5_DEMANDING"] = r["R5"]["sets"]["fail"]["level"], r["R5"]["sets"]["review"]["level"]
    if cfg.get("v2"):
        for k in ("PE1", "PE2", "PE3", "PE4", "PE5", "PE6"):
            lv[k] = cfg["v2"]["end_point_rules"][k]["level"]
    return lv


def config_sha256(cfg: dict) -> str:
    """Canonical-JSON hash of the loaded configs (the file sha256 is recorded separately by the caller)."""
    return hashlib.sha256(json.dumps(cfg, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def make_gate_version(cfg: dict, config_sha: str, classify_sha: str, pbf_sha: str, osm_data_timestamp: str) -> dict:
    ver = cfg["v1"]["version"] + ("+" + cfg["v2"]["version"] if cfg.get("v2") else "")
    return {"config_version": ver, "config_sha256": config_sha, "classify_file_sha256": classify_sha,
            "pbf_sha256": pbf_sha, "osm_data_timestamp": osm_data_timestamp}


# ------------------------------------------------------------------ geometry helpers
def great_circle_m(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(h)))


def _heading(ctx, n, m) -> float:
    (x0, y0), (x1, y1) = ctx.lonlat(n), ctx.lonlat(m)
    return math.atan2(y1 - y0, (x1 - x0) * math.cos(math.radians((y0 + y1) / 2)))


def _in_arc(a, start, end) -> bool:
    two = 2 * math.pi
    return 0 < (a - start) % two < (end - start) % two


def _layer(v) -> float:
    try:
        return float(str(v).split(";")[0]) if v not in (None, "") else 0.0
    except ValueError:
        return 0.0


class _Cache:
    """Per-evaluation memo of way lookups, classify results and consecutive node pairs."""

    def __init__(self, ctx):
        self.ctx, self._cls, self._pairs = ctx, {}, {}

    def tags(self, w) -> dict | None:
        x = self.ctx.way(w)
        return x[1] if x else None

    def status(self, w):
        if w not in self._cls:
            t = self.tags(w)
            self._cls[w] = None if t is None else self.ctx.classify(t)
        return self._cls[w]

    def pairs(self, w) -> set:
        if w not in self._pairs:
            x = self.ctx.way(w)
            self._pairs[w] = set() if x is None else {(min(a, b), max(a, b)) for a, b in zip(x[0][:-1], x[0][1:])}
        return self._pairs[w]


# ------------------------------------------------------------------ shape metrics
def shape_metrics(route: RouteInput) -> dict:
    n, L = route.nodes, route.lengths_m
    total = float(sum(L))
    keys = [(min(a, b), max(a, b)) for a, b in zip(n[:-1], n[1:])]
    cnt, dirs, klen = Counter(keys), defaultdict(set), {}
    for (a, b), k, le in zip(zip(n[:-1], n[1:]), keys, L):
        dirs[k].add(a < b)
        klen[k] = le
    uniq = sum(klen.values())
    oab = sum(klen[k] * cnt[k] for k in cnt if len(dirs[k]) == 2) / total if total else 0.0
    rep = max(0.0, 1 - uniq / total) if total else 0.0
    uturns = [i for i in range(1, len(n) - 1) if n[i - 1] == n[i + 1]]
    closed = len(n) > 1 and n[0] == n[-1]
    shape = "POINT_TO_POINT" if not closed else "LOOP" if oab < 0.15 else "MIXED" if oab < 0.60 else "OUT_AND_BACK"
    # stems: connected components of both-direction edges
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    both = [k for k in cnt if len(dirs[k]) == 2]
    for a, b in both:
        parent[find(a)] = find(b)
    comp = defaultdict(list)
    for k in both:
        comp[find(k[0])].append(k)
    stems = [(sum(klen[k] for k in ks), n[0] in {x for k in ks for x in k}) for ks in comp.values()]
    return {"distance_m": round(total, 1), "closed": closed, "out_and_back_ratio": round(oab, 4),
            "repeated_edge_ratio": round(rep, 4), "immediate_uturns": len(uturns), "uturn_indices": uturns,
            "result_shape": shape, "longest_stem_m": round(max((s for s, _ in stems), default=0.0), 1),
            "longest_start_stem_m": round(max((s for s, st in stems if st), default=0.0), 1),
            "longest_spur_m": round(max((s for s, st in stems if not st), default=0.0), 1)}


# ------------------------------------------------------------------ F rules (structural)
def _f_rules(route, cache, cfg, shape) -> list:
    r1, v2 = cfg["v1"]["rules"], cfg.get("v2")
    t = route.request_type
    n, W, L = route.nodes, route.ways, route.lengths_m
    fails = []
    if len(W) != len(n) - 1 or len(L) != len(W) or (route.canonical_ways is not None and len(route.canonical_ways) != len(W)):
        return ["F3"]
    # F1 / F2 on the adapter way and the canonical way
    f1 = f2 = False
    for i, (a, b) in enumerate(zip(n[:-1], n[1:])):
        for w in {W[i]} | ({route.canonical_ways[i]} if route.canonical_ways else set()):
            st = cache.status(w)
            if st is None or st[0] not in r1["F1"]["allowed_status"]:
                f1 = True
            if (min(a, b), max(a, b)) not in cache.pairs(w):
                f2 = True
    fails += ["F1"] * f1 + ["F2"] * f2
    # F3 (type-specific closure / end)
    if t in CLOSED_TYPES:
        f3 = not (n[0] == n[-1] == route.start_node)
    else:
        f3 = not (n[0] == route.start_node and route.end_node is not None and n[-1] == route.end_node and n[0] != n[-1])
    fails += ["F3"] * f3
    # F4 geometry integrity
    tol = r1["F4"]
    f4 = False
    for (a, b), le in zip(zip(n[:-1], n[1:]), L):
        pa, pb = route_ctx_lonlat(cache, a), route_ctx_lonlat(cache, b)
        if pa is None or pb is None or abs(great_circle_m(*pa, *pb) - le) > tol["max_length_vs_great_circle_m"]:
            f4 = True
            break
    if not f4 and route.payload_latlon is not None:
        if len(route.payload_latlon) != len(n):
            f4 = True
        else:
            for (lat, lon), x in zip(route.payload_latlon, n):
                plon, plat = route_ctx_lonlat(cache, x)
                if abs(lat - plat) > tol["max_payload_coord_diff_deg"] or abs(lon - plon) > tol["max_payload_coord_diff_deg"]:
                    f4 = True
                    break
    fails += ["F4"] * f4
    # F5 distance
    if t == "POINT_TO_POINT":
        lo, hi = v2["type_matrix"]["F5"]["POINT_TO_POINT"]["accepted_length_window_of_target"]
        f5 = not (lo * route.target_m <= shape["distance_m"] <= hi * route.target_m)
    else:
        tolr = (v2["type_matrix"]["F5"][t]["max_abs_distance_error_ratio"] if t != "LOOP" else
                r1["F5"]["max_abs_distance_error_ratio"])
        f5 = abs(shape["distance_m"] - route.target_m) > tolr * route.target_m
    fails += ["F5"] * f5
    # F6 shape limits
    oab, rep, ut = shape["out_and_back_ratio"], shape["repeated_edge_ratio"], shape["immediate_uturns"]
    if t == "LOOP":
        c = r1["F6"]
        f6 = rep > c["max_repeated_edge_ratio"] or oab > c["max_out_and_back_ratio"] or ut > c["max_immediate_uturns"]
    else:
        c = v2["type_matrix"]["F6"][t]
        if t == "MIXED":
            f6 = (not c["min_out_and_back_ratio"] <= oab < c["max_out_and_back_ratio_exclusive"]
                  or rep > c["max_repeated_edge_ratio"] or ut > c["max_immediate_uturns"])
        elif t == "OUT_AND_BACK":
            f6 = oab < c["min_out_and_back_ratio"] or rep > c["max_repeated_edge_ratio"] or ut != c["exact_immediate_uturns"]
        else:
            f6 = rep > c["max_repeated_edge_ratio"] or oab > c["max_out_and_back_ratio"] or ut > c["max_immediate_uturns"]
    fails += ["F6"] * f6
    # F7 start (request level)
    c = r1["F7"]
    if route.start_snap_m > c["max_start_snap_m"] or (c["start_inside_extract"] and not route.start_in_extract):
        fails.append("F7")
    return fails


def route_ctx_lonlat(cache, node):
    return cache.ctx.lonlat(node)


# ------------------------------------------------------------------ R rules (tags / geometry)
def _edge_flags(tags: dict, status, cfg) -> dict:
    """Which per-edge R rule a way matches (route-level minimum lengths are applied by the caller)."""
    r = cfg["v1"]["rules"]
    hw = tags.get("highway")
    out = {}
    if hw in r["R2"]["highways"] and any(tags.get(k) == v for k, v in r["R2"]["sidewalk_no_tags"].items()):
        out["R2"] = True
    if hw in r["R3"]["highways"] and ((_layer(tags.get("layer")) < 0 and tags.get("tunnel") in (None, "", "no"))
                                      or tags.get("ford") == "yes"):
        out["R3"] = True
    override = status is not None and any("overrides_access" in x for x in status[1])
    if status is not None and status[0] in r["R4"]["only_status"] and not (r["R4"]["exclude_foot_override"] and override):
        acc = tags.get(r["R4"]["tag"])
        if acc in r["R4"]["sets"]["fail"]["values"]:
            out["R4_FAIL"] = True
        elif acc in r["R4"]["sets"]["review"]["values"]:
            out["R4_REVIEW"] = True
    sac = tags.get(r["R5"]["tag"])
    if sac in r["R5"]["sets"]["fail"]["values"]:
        out["R5_ALPINE"] = True
    elif sac in r["R5"]["sets"]["review"]["values"]:
        out["R5_DEMANDING"] = True
    return out


def _min_len(code, cfg) -> float:
    r = cfg["v1"]["rules"]
    return {"R2": r["R2"]["min_route_len_m"], "R3": r["R3"]["min_route_len_m"], "R4_FAIL": r["R4"]["min_route_len_m"],
            "R4_REVIEW": r["R4"]["min_route_len_m"], "R5_ALPINE": r["R5"]["min_route_len_m"],
            "R5_DEMANDING": r["R5"]["min_route_len_m"]}[code]


def _runs(route, flags_per_traversal, code) -> list:
    """Contiguous runs of traversals on the same way that carry `code` -> segment dicts."""
    segs, i, n, W, L = [], 0, route.nodes, route.ways, route.lengths_m
    while i < len(W):
        if code not in flags_per_traversal[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(W) and W[j + 1] == W[i] and code in flags_per_traversal[j + 1]:
            j += 1
        segs.append({"reason_code": code, "osm_way_id": W[i], "node_id": None, "seg_start_idx": i, "seg_end_idx": j + 1,
                     "seg_start_node": n[i], "seg_end_node": n[j + 1], "seg_length_m": round(float(sum(L[i:j + 1])), 1)})
        i = j + 1
    return segs


def _r1_events(route, cache, cfg) -> list:
    r1 = cfg["v1"]["rules"]["R1"]
    cls = {k: set(v["highways"]) for k, v in r1["classes"].items()}
    acc = r1["crossing_tags_accepted"]
    n, W = route.nodes, route.ways
    closed = len(n) > 1 and n[0] == n[-1]
    idx = range(len(n) - 1) if closed else range(1, len(n) - 1)
    out = []
    for i in idx:
        node, p, q = n[i], (n[i - 1] if i > 0 else n[-2]), n[i + 1]
        if p == q:
            continue
        tp, tq = _heading(cache.ctx, node, p), _heading(cache.ctx, node, q)
        side = {k: [False, False] for k in cls}
        crossed = {k: [] for k in cls}
        for c, w in cache.ctx.incident(node):
            if c in (p, q):
                continue
            t = cache.tags(w) or {}
            for k, hws in cls.items():
                if t.get("highway") in hws:
                    side[k][0 if _in_arc(_heading(cache.ctx, node, c), tp, tq) else 1] = True
                    crossed[k].append(w)
        route_ways = {W[i - 1] if i > 0 else W[-1], W[i]}
        tagged = any((cache.tags(w) or {}).get("footway") in acc["footway"]
                     or (cache.tags(w) or {}).get("crossing") not in (None, "", "no") for w in route_ways)
        for k in cls:
            if side[k][0] and side[k][1]:
                exempt = r1["classes"][k]["tagged_crossing_exempt"] and tagged
                if not exempt:
                    out.append({"class": k, "index": i, "node": node, "crossed_way": sorted(set(crossed[k]))[0], "tagged": tagged})
    return out


# ------------------------------------------------------------------ PE rules
def _pe_rules(route, cache, cfg, shape, r_hits) -> tuple:
    v2 = cfg.get("v2")
    t = route.request_type
    fails, reviews, segs = [], [], []
    if v2 is None or t == "LOOP":
        return fails, reviews, segs
    pe = v2["end_point_rules"]
    n, W, L = route.nodes, route.ways, route.lengths_m
    road_hw = set(cfg["v1"]["rules"]["R3"]["highways"])
    if t == "POINT_TO_POINT":
        c = pe["PE1"]
        if (route.dest_snap_m is None or route.dest_snap_m > c["max_destination_snap_m"]
                or (c["destination_inside_extract"] and not route.dest_in_extract)):
            fails.append("PE1")
        if route.same_component is False:
            fails.append("PE2")
        focus, focus_edges = n[-1], [len(W) - 1]
    elif t == "OUT_AND_BACK":
        ut = shape["uturn_indices"]
        if len(ut) != 1:
            return fails, reviews, segs  # F6 already fails; no single turnaround to inspect
        focus, focus_edges = n[ut[0]], [ut[0] - 1, ut[0]]
    else:
        return fails, reviews, segs
    # PE4 forbidden contact at the end / turnaround node
    c = pe["PE4"]["forbidden_incident_edges"]
    for _, w in cache.ctx.incident(focus):
        tg, st = cache.tags(w) or {}, cache.status(w)
        road_tunnel = tg.get("highway") in road_hw and tg.get("tunnel") not in (None, "") and tg.get("tunnel") not in NOT_A_TUNNEL
        if tg.get("highway") in c["highways"] or (st is not None and st[0] in c["status"]) or road_tunnel or st is None:
            fails.append("PE4")
            segs.append({"reason_code": "PE4", "osm_way_id": w, "node_id": focus, "seg_start_idx": None, "seg_end_idx": None,
                         "seg_start_node": focus, "seg_end_node": focus, "seg_length_m": 0.0})
            break
    # PE5 far-bank snap (P2P only); shared with the generator snap step (pe5_blocked, ug-v2 N2 rev3)
    if t == "POINT_TO_POINT" and route.dest_lonlat is not None:
        if pe5_blocked(route.dest_lonlat, cache.ctx.lonlat(focus), route.pe5_edge_lines, route.pe5_env_polys,
                       route.pe5_env_lines, end_is_bridge=end_node_on_bridge(cache.ctx, focus)):
            fails.append("PE5")
    # PE3 end / turnaround safety
    c = pe["PE3"]
    pe3 = []
    deg = {nb for nb, _ in cache.ctx.incident(focus)}
    access_sets = set(cfg["v1"]["rules"]["R4"]["sets"]["fail"]["values"]) | set(cfg["v1"]["rules"]["R4"]["sets"]["review"]["values"])
    for i in focus_edges:
        tg = cache.tags(W[i]) or {}
        if len(deg) == c["a_dead_end"]["node_degree_all_status"] and (
                tg.get("highway") in c["a_dead_end"]["way_highway"] or tg.get("access") in access_sets):
            pe3.append("a")
        if tg.get("bridge") not in (None, "", "no"):
            pe3.append("b")
        if tg.get("highway") in road_hw and _layer(tg.get("layer")) < 0:
            pe3.append("b")
        if tg.get("tunnel") not in (None, "") and tg.get("tunnel") not in NOT_A_TUNNEL:
            pe3.append("b")
        if t == "OUT_AND_BACK" and tg.get("highway") in c["d_turnaround_on_major"]["highways"]:
            pe3.append("d")
    if pe3:
        reviews.append("PE3")
        segs.append({"reason_code": "PE3", "osm_way_id": W[focus_edges[0]], "node_id": focus, "seg_start_idx": min(focus_edges),
                     "seg_end_idx": max(focus_edges) + 1, "seg_start_node": n[min(focus_edges)], "seg_end_node": n[max(focus_edges) + 1],
                     "seg_length_m": round(float(sum(L[i] for i in focus_edges)), 1), "detail": "".join(sorted(set(pe3)))})
    # PE6 hazards in the approach window
    c = pe["PE6"]
    win = c["window_m"]
    if t == "POINT_TO_POINT":
        acc, window = 0.0, set()
        for i in range(len(W) - 1, -1, -1):
            window.add(i)
            acc += L[i]
            if acc >= win:
                break
        win_nodes = {n[i] for i in window} | {n[-1]}
    else:
        k = shape["uturn_indices"][0]
        window = set()
        acc = 0.0
        for i in range(k - 1, -1, -1):
            window.add(i)
            acc += L[i]
            if acc >= win:
                break
        acc = 0.0
        for i in range(k, len(W)):
            window.add(i)
            acc += L[i]
            if acc >= win:
                break
        win_nodes = {n[i] for i in window} | {n[i + 1] for i in window}
    haz = set(c["hazard_rules"])
    hit = any(code.split("_")[0] in haz and i in window for i, codes in enumerate(r_hits["per_edge"]) for code in codes)
    hit = hit or any(ev["node"] in win_nodes for ev in r_hits["r1"] if "R1" in haz)
    if hit:
        reviews.append("PE6")
    return fails, reviews, segs


def pe5_blocked(dest_lonlat, node_lonlat, edge_lines=(), env_polys=(), env_lines=(), end_is_bridge=False, cfg=None) -> bool:
    """PE5 far-bank test (ug-v2 rev4, env-terrain ruling ei1_rev3_ruling.md), shared by the generator snap step and the
    Gate re-check. P = destination point, N = snapped end node, S = straight segment P -> N.
    edge_lines: blocking road segments (trunk/motorway(+link) or EXCLUDED, within 250 m): block unless S meets the edge
                exactly in {P} (the user clicked on that road; no tolerance). Contact at N or any crossing blocks.
    env_polys:  river / water / coast polygons: block iff S's interior meets the polygon interior AND NOT both P and N
                are covered by that polygon. This gives: pass-through (both outside) -> block; exactly one inside -> block;
                both covered (incl. boundary) -> allow; waterline click (P on the boundary, S landward) -> allow.
                Bridge exemption, per polygon: a polygon is skipped when P is covered by THAT polygon and end_is_bridge.
    env_lines:  coast / river lines: block if S crosses them; a touch only at P or N does not block. No bridge exemption.
    end_is_bridge: N is incident to a RUNNABLE way with bridge present and != no (end_node_on_bridge). cfg: symmetry only."""
    from shapely.geometry import LineString, Point
    seg, p, q = LineString([dest_lonlat, node_lonlat]), Point(dest_lonlat), Point(node_lonlat)

    def meets_beyond_dest(g) -> bool:
        if not seg.intersects(g):
            return False
        return not seg.intersection(g).difference(p).is_empty

    if any(meets_beyond_dest(g) for g in edge_lines):
        return True

    def poly_blocks(g) -> bool:
        cp, cq = g.covers(p), g.covers(q)
        if end_is_bridge and cp:
            return False                                       # bridge exemption, this polygon only
        return seg.relate_pattern(g, "T********") and not (cp and cq)

    if any(poly_blocks(g) for g in env_polys):
        return True
    return any(seg.intersects(g) and not seg.touches(g) for g in env_lines)


def end_node_on_bridge(ctx: GateContext, node) -> bool:
    """End node incident to a RUNNABLE way whose bridge tag is present and != 'no' (decidable at snap time)."""
    for _, w in ctx.incident(node):
        x = ctx.way(w)
        if x is None:
            continue
        if x[1].get("bridge") not in (None, "", "no") and ctx.classify(x[1])[0] == "RUNNABLE":
            return True
    return False


def fail_code_classes(cfg: dict) -> dict:
    """structural vs tag-based FAIL codes (ug-v2 fail_code_classes, lead decision): tag-based FAILs go to the
    review_queue, structural ones to the incidents log."""
    c = cfg["v2"]["fail_code_classes"] if cfg.get("v2") else None
    if c is None:
        return {"structural": ["F1", "F2", "F3", "F4", "F5", "F6", "F7"],
                "tag_based": ["R1_MOTORWAY", "R1_TRUNK", "R3", "R4_FAIL", "R5_ALPINE"]}
    return {"structural": list(c["structural"]), "tag_based": list(c["tag_based"])}


def build_context(ways: dict, lonlat: dict, edge_triples, classify) -> GateContext:
    """GateContext from plain tables: ways {osmid: (refs, tags)}, lonlat {node: (lon, lat)}, all-status edge triples
    (osm_u, osm_v, osmid) e.g. zip(cg.edges_all.osm_u, cg.edges_all.osm_v, cg.edges_all.osmid)."""
    adj = defaultdict(list)
    for a, b, w in edge_triples:
        a, b, w = int(a), int(b), int(w)
        if a != b:
            adj[a].append((b, w))
            adj[b].append((a, w))
    return GateContext(way=ways.get, lonlat=lonlat.get, incident=lambda n: adj.get(n, []), classify=classify)


TAGS_USED = {"R1_MOTORWAY": ("highway",), "R1_TRUNK": ("highway",), "R2": ("highway", "sidewalk", "sidewalk:both"),
             "R3": ("highway", "layer", "tunnel", "ford"), "R4_FAIL": ("access", "foot"), "R4_REVIEW": ("access", "foot"),
             "R5_ALPINE": ("sac_scale",), "R5_DEMANDING": ("sac_scale",),
             "PE3": ("highway", "bridge", "tunnel", "layer", "access", "service"), "PE4": ("highway", "tunnel", "access", "foot")}


def _decorate(seg: dict, cache) -> dict:
    """Add segment end coordinates and the tags the rule read (review_queue fields)."""
    a, b = cache.ctx.lonlat(seg["seg_start_node"]), cache.ctx.lonlat(seg["seg_end_node"])
    seg["seg_start_lat"], seg["seg_start_lon"] = (a[1], a[0]) if a else (None, None)
    seg["seg_end_lat"], seg["seg_end_lon"] = (b[1], b[0]) if b else (None, None)
    t = cache.tags(seg["osm_way_id"]) or {}
    seg["tags_used"] = {k: t[k] for k in TAGS_USED.get(seg["reason_code"], ()) if t.get(k) is not None}
    return seg


# ------------------------------------------------------------------ evaluation
def evaluate(route: RouteInput, ctx: GateContext, cfg: dict, gate_version: dict | None = None) -> GateResult:
    if route.request_type not in TYPES:
        raise ValueError(f"request_type must be one of {TYPES}")
    cache = _Cache(ctx)
    lv = rule_levels(cfg)
    shape = shape_metrics(route) if len(route.lengths_m) == len(route.nodes) - 1 else {
        "distance_m": float(sum(route.lengths_m)), "out_and_back_ratio": 0.0, "repeated_edge_ratio": 0.0,
        "immediate_uturns": 0, "uturn_indices": [], "result_shape": None}
    fails = _f_rules(route, cache, cfg, shape)
    reviews, review_segs, fail_segs, alt = [], [], [], []
    if "F3" in fails and len(route.ways) != len(route.nodes) - 1:
        return GateResult("FAIL", sorted(set(fails)), [], observations=_obs(shape), gate_version=gate_version)
    # R2-R5 on adapter ways (per traversal), route-level minimum lengths
    per_edge = []
    for w in route.ways:
        tg, st = cache.tags(w), cache.status(w)
        per_edge.append(set(_edge_flags(tg, st, cfg)) if tg is not None else set())
    for code in ("R2", "R3", "R4_FAIL", "R4_REVIEW", "R5_ALPINE", "R5_DEMANDING"):
        segs = _runs(route, per_edge, code)
        if segs and sum(s["seg_length_m"] for s in segs) >= _min_len(code, cfg):
            for s in segs:
                s["level"] = lv[code]
            (fails if lv[code] == "FAIL" else reviews).append(code)
            (fail_segs if lv[code] == "FAIL" else review_segs).extend(segs)
    # canonical-way R results (logged only)
    if route.canonical_ways is not None:
        alt_codes = set()
        for w, cw in zip(route.ways, route.canonical_ways):
            if cw != w and cache.tags(cw) is not None:
                alt_codes |= set(_edge_flags(cache.tags(cw), cache.status(cw), cfg))
        alt = sorted(alt_codes)
    # R1 at-grade crossings
    ev = _r1_events(route, cache, cfg)
    for e in ev:
        code = "R1_MOTORWAY" if e["class"] == "motorway" else "R1_TRUNK"
        seg = {"reason_code": code, "level": lv[code], "osm_way_id": e["crossed_way"], "node_id": e["node"],
               "seg_start_idx": e["index"], "seg_end_idx": e["index"], "seg_start_node": e["node"], "seg_end_node": e["node"],
               "seg_length_m": 0.0}
        (fail_segs if lv[code] == "FAIL" else review_segs).append(seg)
        (fails if lv[code] == "FAIL" else reviews).append(code)
    # R6 working-area edge
    if route.min_dist_to_area_edge_m is not None and \
            route.min_dist_to_area_edge_m < cfg["v1"]["rules"]["R6"]["min_dist_to_area_edge_m"]:
        reviews.append("R6")
    # PE rules (non-LOOP types only)
    if not set(fails) & {"F3"}:
        pf, pr, ps = _pe_rules(route, cache, cfg, shape, {"per_edge": per_edge, "r1": ev})
        fails += pf
        reviews += pr
        for s in ps:
            s["level"] = lv[s["reason_code"]]
            (review_segs if s["level"] == "REVIEW" else fail_segs).append(s)
    fails, reviews = sorted(set(fails)), sorted(set(reviews))
    structural = set(fail_code_classes(cfg)["structural"])
    incident_segs = [_decorate(s, cache) for s in fail_segs if s["reason_code"] in structural]
    fail_segs = [_decorate(s, cache) for s in fail_segs if s["reason_code"] not in structural]
    review_segs = [_decorate(s, cache) for s in review_segs]
    verdict = "FAIL" if fails else "REVIEW" if reviews else "PASS"
    return GateResult(verdict, fails, reviews, review_segs, fail_segs, incident_segs, alt, _obs(shape, route, cache, cfg),
                      gate_version)


def _obs(shape, route=None, cache=None, cfg=None) -> dict:
    o = {k: v for k, v in shape.items() if k != "uturn_indices"}
    if route is None or cache is None:
        return o
    oc = cfg["v1"]["observations"]
    pat = re.compile("|".join(map(re.escape, oc["closure_name_patterns"])))
    pier = oc["pier_breakwater"]
    m = Counter()
    for w, le in zip(route.ways, route.lengths_m):
        t = cache.tags(w) or {}
        if t.get("bridge") not in (None, "", "no"):
            m["bridge_m"] += le
        if t.get("tunnel") not in (None, "") and t.get("tunnel") not in NOT_A_TUNNEL:
            m["tunnel_m"] += le
        if pat.search(t.get("name") or ""):
            m["closure_name_m"] += le
        if t.get("man_made") in pier["man_made"] or any(s in (t.get("name") or "") for s in pier["name_contains"]):
            m["pier_breakwater_m"] += le
        if t.get("highway") == "service" and t.get("service") in ("parking_aisle", "driveway", "drive-through"):
            m["service_parking_driveway_m"] += le
    o.update({k: round(v, 1) for k, v in m.items()})
    o["osmid_mismatch_edges"] = (sum(1 for a, b in zip(route.ways, route.canonical_ways) if a != b)
                                 if route.canonical_ways is not None else None)
    o["max_segment_m"] = round(max(route.lengths_m), 1) if route.lengths_m else 0.0
    # hairpins >= hairpin_deg between two different edges
    n, hp = route.nodes, 0
    closed = len(n) > 1 and n[0] == n[-1]
    for i in (range(len(n) - 1) if closed else range(1, len(n) - 1)):
        p, x, q = (n[i - 1] if i > 0 else n[-2]), n[i], n[i + 1]
        if p == q:
            continue
        a1, a2 = _heading(cache.ctx, p, x), _heading(cache.ctx, x, q)
        hp += math.degrees(abs((a2 - a1 + math.pi) % (2 * math.pi) - math.pi)) >= oc["hairpin_deg"]
    o["hairpins_ge_150deg"] = hp
    return o


def stage_b(route: RouteInput, ctx: GateContext, cfg: dict) -> list:
    """F1-F4 re-check of a shown route (payload coords included when given). [] = pass."""
    cache = _Cache(ctx)
    shape = shape_metrics(route) if len(route.lengths_m) == len(route.nodes) - 1 else {"distance_m": 0.0}
    if len(route.ways) != len(route.nodes) - 1:
        return ["F3"]
    rules = set(cfg["v1"]["stage_b"]["rules"])
    return [c for c in _f_rules(route, cache, cfg, shape) if c in rules]


def p2p_precheck(d_min_m: float, target_m: float, cfg: dict) -> dict | None:
    """User decision 3: None if feasible, else DESTINATION_TOO_FAR / OUT_OF_APP_RANGE with min_target_km."""
    c = cfg["v2"]["type_matrix"]["F5"]["POINT_TO_POINT"]
    hi = c["accepted_length_window_of_target"][1]
    if d_min_m <= hi * target_m:
        return None
    step = c["target_step_km"]
    n_km = math.ceil(round(d_min_m / 1000 / hi / step, 9)) * step
    n_km = round(n_km, 3)
    if n_km > c["app_target_km_range"][1]:
        return {"code": "OUT_OF_APP_RANGE", "min_target_km": n_km}
    return {"code": "DESTINATION_TOO_FAR", "min_target_km": n_km}

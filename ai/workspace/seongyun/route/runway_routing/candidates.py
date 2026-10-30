"""Candidate generation for the three course shapes. Every generator is deterministic in (graph, start, target, seed).

요약: LOOP / OUT_AND_BACK / POINT_TO_POINT 후보 경로를 만든다. P2P 거리 규칙(distance_rule)도 여기 있다.
위치: snap 다음, features 전. 경로의 각 구간은 route_through → shortest_path로 찾는다.
주의: seed와 RNG 사용 순서가 결과를 정한다. LOOP는 analysis canonical generator에 hook만 끼운다.

LOOP           canonical generator (analysis/runway_route_api + runway_route_generator, read only): snap the start,
               24 attempts with attempt seed = request seed + i, k = (2, 3, 4)[seed % 3] waypoints on a circle,
               legs by shortest path with a reuse penalty, spur trim, circle rescaling, canonical validity / quality
               and seed-order dedupe. loop() swaps rrg.make_candidate for make_candidate_biased (under _PATCH_LOCK,
               always restored) to add two things: the optional weak preference bias (DEFAULT_BIAS = edge_b04) and a
               request-local LegMemo. The builder consumes the SAME RNG stream as canonical's (k / theta / jitter
               match) and with NeutralBias it is canonical's make_candidate exactly.
OUT_AND_BACK   shortest-path tree from the snapped start; turnaround = a node whose real path length is within
               oab_window of T/2, one per bearing sector, junctions preferred, PE4 nodes never; route = path + reverse
               (a palindrome with exactly one U-turn, at the turnaround).
POINT_TO_POINT s -> 1-2 waypoints on an ellipse with foci s, t -> t; the semi-major axis is rescaled until the length
               is within iter_stop of T (canonical's circle rescaling on an ellipse).
distance_rule  user decision 3 for P2P, before any generation: d_min <= 1.1 T -> OK; else DESTINATION_TOO_FAR with
               min_target_km = ceil_0.5(d_min / 1.1), or OUT_OF_APP_RANGE when that exceeds the app maximum.
Parameters for OAB / P2P: config/shape_config.json (existing code constants or user decisions, no new tuning).
Shapes in requests: LOOP_SHAPES / NEW_SHAPES.
"""
import math
import threading
from collections import Counter
from dataclasses import dataclass

import networkx as nx
import numpy as np

from . import shortest_path, snap
from .data import api
from .graph import route_csr
from .scorer import Preferences

rrg = api.rrg  # the canonical algorithm module (analysis/runway_route_generator.py)
LOOP_SHAPES = (None, "loop", "auto", "LOOP")
NEW_SHAPES = {"out_and_back": "OUT_AND_BACK", "point_to_point": "POINT_TO_POINT"}
MAX_RETURN = 1000          # ask the canonical API for every distinct candidate it finds
POC_DEFAULT_ATTEMPTS = 24
PREF_FLAG = {"river": "river_near", "beach": "coastal_near", "park": "green_near", "trail": "trail",
             "pedestrian": "walk_dedicated"}
AVOID_FLAG = {"major_road": "major", "steps": "hw_steps", "tunnel": "tunnel"}
M_MIN, M_MAX = 0.4, 4.0
_PATCH_LOCK = threading.Lock()


@dataclass(frozen=True)
class BiasSpec:
    """Strength of the generation bias. Preferences scale it (0-5 -> 0-1); unchecked items add nothing.
    waypoint_a stays in the dataclass because LOOP responses carry asdict(spec) (request.generation_bias); it is 0."""
    name: str
    waypoint_a: float = 0.0
    beta: float = 0.0          # preferred-flag reward in the edge cost
    gamma: float = 0.0         # avoided-flag penalty in the edge cost


# 선호 반영은 edge 비용 배수 하나뿐이다: cost = length x clip(exp(-beta x 선호) x (1 + gamma x 회피), 0.4, 4.0).
# 실험에서 고른 arm(edge_b04)이며, scoring_config.json에는 이 값이 없다(그 파일을 바꿔도 생성은 바뀌지 않는다).
DEFAULT_BIAS = BiasSpec("edge_b04", beta=0.4, gamma=1.0)


class GenerationBias:
    """Per-request edge multipliers, keyed by OSM ids of the canonical graph."""

    def __init__(self, prefs: Preferences, cg, spec: BiasSpec):
        self.spec = spec
        A = cg.ea
        E = len(A["length"])
        pref = np.zeros(E)
        avoid_mult = np.ones(E)
        for k, flag in PREF_FLAG.items():
            p = getattr(prefs, k) / 5
            if p > 0:
                pref += p * A[flag]
        for k, flag in AVOID_FLAG.items():
            a = getattr(prefs, f"avoid_{k}") / 5
            if a > 0:
                avoid_mult *= 1 + spec.gamma * a * A[flag]
        m = np.clip(np.exp(-spec.beta * pref) * avoid_mult, M_MIN, M_MAX)
        ou, ov = cg.redges["osm_u"].to_numpy(), cg.redges["osm_v"].to_numpy()
        self.edge_mult = {rrg._key(int(a), int(b)): float(x) for a, b, x in zip(ou, ov, m) if x != 1.0}
        self.biased_edge_share = round(float(A["length"][m != 1.0].sum() / A["length"].sum()), 4)

    def waypoint(self, rg, p, rho: float) -> int:
        """Canonical's waypoint: the nearest pool node (rrg._nearest's expression); the bias acts on edge costs only."""
        d2 = ((rg.wp_xy - np.asarray(p)) ** 2).sum(axis=1)
        return int(rg.wp_nodes[int(d2.argmin())])


class LegMemo:
    """Request-local memo of route_through legs (one generator call; never shared between requests).

    Key = the waypoint-sequence prefix seq[:i + 2]. route_through is deterministic in (graph, multipliers, penalty,
    seq): the reuse counts that weight leg i come only from legs 0..i-1, which depend only on seq[:i + 1], and
    networkx's shortest_path returns the same path for the same graph and the same weights. So a stored leg is exactly
    the leg the search would return, ties included. The memo binds to the first (graph, multiplier dict, penalty) it
    sees; a call with any other graph / dict / penalty runs without it. Failed searches (no path) are not stored.

    key가 (a, b) 한 쌍이 아니라 waypoint 열의 prefix인 이유: leg 비용에 "이미 지난 edge" 재사용 penalty가 붙는다.
    같은 a -> b라도 앞에서 어떤 길을 지났는지(reuse 상태)에 따라 최단 경로가 달라진다. 그 상태는 seq[:i + 1]이 정하므로
    prefix가 같을 때만 재사용해야 결과가 memo 없이 계산한 것과 똑같다. 요청 사이 공유는 금지다(graph, bias가 다르다)."""

    def __init__(self):
        self.bound = None
        self.legs = {}
        self.mult_array = None     # the bound multiplier dict as a RouteCSR array (D-exact kernel), built once
        self.hits = self.searches = 0

    def usable(self, rg, mult, reuse_penalty) -> bool:
        if self.bound is None:
            self.bound = (rg, mult, reuse_penalty)
        return self.bound[0] is rg and self.bound[1] is mult and self.bound[2] == reuse_penalty


def route_through(rg, seq: list, mult: dict, reuse_penalty: float, memo: LegMemo | None = None) -> list | None:
    """Legs seq[i] -> seq[i+1] by shortest path; leg cost = length x mult(edge) x (1 + reuse_penalty x uses so far).
    One implementation for the LOOP builder and the OAB / P2P generators. mult = {} and reuse_penalty =
    rrg.REUSE_PENALTY give canonical rrg._route_through's cost exactly. A leg with a == b is skipped; only the shape
    generators can produce one (the LOOP builder never repeats a node back to back nor puts the start inside).
    With a memo, a leg already searched for the same sequence prefix in this request is reused (LegMemo).
    The search is shortest_path.bidirectional (networkx's algorithm ported exactly) unless the backend is "nx"."""
    if shortest_path.BACKEND != "nx":
        return _route_through_exact(rg, seq, mult, reuse_penalty, memo)
    use = memo is not None and memo.usable(rg, mult, reuse_penalty)
    used = Counter()

    def w(u, v, d):
        k = rrg._key(u, v)
        return d["length"] * mult.get(k, 1.0) * (1 + reuse_penalty * used[k])

    path = [seq[0]]
    for i, (a, b) in enumerate(zip(seq[:-1], seq[1:])):
        if a == b:   # waypoint가 출발/도착과 같은 node로 snap된 경우: 길이 0 leg는 건너뛴다(경로에 node 중복 없음)
            continue
        key = tuple(seq[:i + 2]) if use else None
        leg = memo.legs.get(key) if use else None
        if leg is None:
            try:
                leg = nx.shortest_path(rg.H, a, b, weight=w)
            except nx.NetworkXNoPath:
                return None
            if use:
                memo.legs[key] = leg
                memo.searches += 1
        else:
            memo.hits += 1
        for x, y in zip(leg[:-1], leg[1:]):
            used[rrg._key(x, y)] += 1
        path += leg[1:]
    return path


def _route_through_exact(rg, seq: list, mult: dict, reuse_penalty: float, memo: LegMemo | None) -> list | None:
    """route_through on the D-exact kernel: the same legs, memo keys and reuse counts, with arrays instead of the
    networkx callback (used[edge id] == the Counter's used[rrg._key]; mult array == mult.get(key, 1.0))."""
    use = memo is not None and memo.usable(rg, mult, reuse_penalty)
    csr = route_csr(rg)
    if use:
        if memo.mult_array is None:
            memo.mult_array = csr.mult_array(mult)
        M = memo.mult_array
    else:
        M = csr.mult_array(mult)
    used = [0] * len(csr.length)
    index, ids, eid = csr.index, csr.ids, csr.eid
    path = [seq[0]]
    for i, (a, b) in enumerate(zip(seq[:-1], seq[1:])):
        if a == b:
            continue
        key = tuple(seq[:i + 2]) if use else None
        leg = memo.legs.get(key) if use else None
        if leg is None:
            if a not in index:                      # networkx's own errors for unknown nodes
                raise nx.NodeNotFound(f"Source {a} is not in G")
            if b not in index:
                raise nx.NodeNotFound(f"Target {b} is not in G")
            nodes = shortest_path.bidirectional(csr, index[a], index[b], M, used, reuse_penalty)
            if nodes is None:                       # networkx: NetworkXNoPath -> no candidate
                return None
            leg = [ids[n] for n in nodes]
            if use:
                memo.legs[key] = leg
                memo.searches += 1
        else:
            memo.hits += 1
        for x, y in zip(leg[:-1], leg[1:]):
            used[eid[rrg._key(x, y)]] += 1
        path += leg[1:]
    return path


# ------------------------------------------------------------------ LOOP
def make_candidate_biased(rg, start: int, target: float, seed: int, bias, memo: LegMemo | None = None) -> dict:
    """rrg.make_candidate with the two hooks; same RNG stream, so k / theta / jitter match canonical."""
    rng = np.random.default_rng(seed)
    k = (2, 3, 4)[seed % 3]
    theta = rng.uniform(0, 2 * math.pi)
    jitter = rng.uniform(-0.35, 0.35, size=k) * (2 * math.pi / (k + 1))
    sx, sy = rg.H.nodes[start]["x"], rg.H.nodes[start]["y"]
    rho = target / (2 * math.pi * rrg.CIRCUITY0)
    best, tries = None, 0
    for _ in range(rrg.MAX_ITER):
        tries += 1
        cx, cy = sx + rho * math.cos(theta), sy + rho * math.sin(theta)
        wps = []
        for j in range(1, k + 1):
            a = theta + math.pi + j * 2 * math.pi / (k + 1) + jitter[j - 1]
            n = bias.waypoint(rg, (cx + rho * math.cos(a), cy + rho * math.sin(a)), rho)
            if n != start and (not wps or wps[-1] != n):
                wps.append(n)
        if not wps:
            rho *= 1.3
            continue
        path = route_through(rg, [start] + wps + [start], bias.edge_mult, rrg.REUSE_PENALTY, memo)
        if path is None:
            return {"seed": seed, "k": k, "failure": "no_path", "iterations": tries}
        path, spurs = rrg.trim_spurs(path)
        d = rrg._length(rg, path)
        err = (d - target) / target
        if best is None or abs(err) < abs(best["err"]):
            best = {"path": path, "err": err, "waypoints": wps, "rho_m": rho, "spurs_trimmed": spurs}
        if abs(err) <= rrg.ITER_STOP:
            break
        rho *= (target / d) ** 0.9
    if best is None:
        return {"seed": seed, "k": k, "failure": "no_waypoint", "iterations": tries}
    return {"seed": seed, "k": k, "theta_deg": round(math.degrees(theta) % 360, 1), "iterations": tries,
            "failure": "", **best}


class NeutralBias:
    """No preference: canonical's waypoint choice (nearest pool node, rrg._nearest's expression) and no edge multiplier.
    make_candidate_biased with it IS canonical rrg.make_candidate (length x 1.0 is exact in floating point)."""
    edge_mult: dict = {}

    def waypoint(self, rg, p, rho: float) -> int:
        d2 = ((rg.wp_xy - np.asarray(p)) ** 2).sum(axis=1)
        return int(rg.wp_nodes[int(d2.argmin())])


def loop(gen, lat: float, lon: float, target_m: float, seed: int, attempts: int, bias: GenerationBias | None = None):
    """Canonical RouteGenerator.generate (every distinct candidate). For this call only, rrg.make_candidate is swapped
    for make_candidate_biased with a request-local LegMemo (NeutralBias when bias is None) and rrg.snap_start for
    snap.start (the same rule with a graph-level edge index)."""
    b = NeutralBias() if bias is None else bias
    memo = LegMemo()
    with _PATCH_LOCK:
        original = rrg.make_candidate
        original_snap = rrg.snap_start
        rrg.make_candidate = lambda rg, start, target, seed: make_candidate_biased(rg, start, target, seed, b, memo)
        rrg.snap_start = snap.start   # same rule, graph-level edge index
        try:
            return gen.generate(lat, lon, target_m, seed=seed, candidate_count=MAX_RETURN, max_attempts=attempts)
        finally:
            rrg.make_candidate = original
            rrg.snap_start = original_snap


# ------------------------------------------------------------------ OUT_AND_BACK / POINT_TO_POINT
def _v(cfg: dict, k: str):
    return cfg[k]["value"]

def ceil_half(x: float) -> float:
    """Round UP to the app's 0.5 km input step (a value already on a step stays)."""
    return math.ceil(x * 2 - 1e-9) / 2

def distance_rule(d_min_m: float, target_m: float, cfg: dict) -> dict:
    """P2P 거리 규칙(후보 생성 전): 출발·도착 사이 최단 거리 d_min과 목표 T로 OK / DESTINATION_TOO_FAR / OUT_OF_APP_RANGE.
    min_target_km = d_min / 1.1을 0.5 km 단위로 올린 값(사용자에게 "최소 N km"로 안내)."""
    # P2P도 ±10 %: 코스 길이는 [0.9T, 1.1T]여야 하므로 d_min > 1.1T면 어떤 우회로도 T에 맞출 수 없다.
    tol = _v(cfg, "tolerance")
    app_max = cfg["app_km"]["max"]
    out = {"window_m": [(1 - tol) * target_m, (1 + tol) * target_m], "d_min_m": d_min_m,
           "min_target_km": None, "alternatives_from_km": None}
    if d_min_m <= (1 + tol) * target_m + 1e-9:
        return {**out, "status": "OK"}
    n = ceil_half(d_min_m / (1 + tol) / 1000)
    if n > app_max:
        return {**out, "status": "OUT_OF_APP_RANGE", "min_target_km": n}
    alt = ceil_half(d_min_m / 1000)
    return {**out, "status": "DESTINATION_TOO_FAR", "min_target_km": n,
            "alternatives_from_km": alt if alt <= app_max else None}


def length(rg, path: list) -> float:
    return float(rrg._length(rg, path))


def _nearest_wp(rg, p) -> int:
    return int(rg.wp_nodes[rrg._nearest(rg.wp_xy, p)[0]])


def _xy(rg, n) -> np.ndarray:
    return np.array([rg.H.nodes[n]["x"], rg.H.nodes[n]["y"]])


def oab_candidates(rg, start: int, target: float, seed: int, cfg: dict, mult: dict | None = None,
                   forbidden: set | None = None) -> list[dict]:
    """OUT_AND_BACK 후보: 출발점에서 실제 경로 길이가 T/2 ± oab_window인 반환점을 방위 sector마다 골라 갔다 같은 길로 온다.
    반환점은 seed로 정한 sector 순서대로 attempts번 뽑고, 교차로(degree >= 3)를 우선한다. 결과는 (rg, start, T, seed)로 결정된다.
    forbidden: turnaround nodes excluded at generation (PE4, snap.pe4_forbidden_nodes)."""
    mult, forbidden = mult or {}, forbidden or set()
    half = target / 2
    win = _v(cfg, "oab_window") * half
    mmax = max([1.0] + list(mult.values()))

    def w(u, v, d):
        return d["length"] * mult.get(rrg._key(u, v), 1.0)

    _, paths = nx.single_source_dijkstra(rg.H, start, cutoff=(half + win) * mmax, weight=w)
    real = {n: length(rg, p) for n, p in paths.items()}
    cand = sorted(n for n, d in real.items() if abs(d - half) <= win and n not in forbidden)
    if not cand:
        return []
    s = _xy(rg, start)
    nsec = _v(cfg, "oab_sectors")
    sector = {n: int((math.degrees(math.atan2(*(_xy(rg, n) - s)[::-1])) % 360) // (360 / nsec)) for n in cand}
    secs = sorted(set(sector.values()))
    order = list(np.random.default_rng([seed, 99]).permutation(secs))
    mind = _v(cfg, "oab_turnaround_min_degree")
    out, used = [], set()
    for i in range(_v(cfg, "attempts")):
        sec = order[i % len(order)]
        pool = [n for n in cand if sector[n] == sec and n not in used]
        junc = [n for n in pool if rg.H.degree(n) >= mind]
        pick_from = junc or pool
        if not pick_from:
            continue
        t = int(np.random.default_rng([seed, i]).choice(pick_from))
        used.add(t)
        p = paths[t]
        out.append({"path": p + p[-2::-1], "turnaround": t, "sector": int(sec), "attempt": i, "seed": seed + i,
                    "junction_turnaround": rg.H.degree(t) >= mind, "half_m": real[t]})
    return out


def p2p_candidates(rg, s: int, t: int, target: float, seed: int, cfg: dict, mult: dict | None = None) -> list[dict]:
    """POINT_TO_POINT 후보: s, t를 초점으로 하는 타원 위 waypoint 1–2개를 지나 s → t. 길이가 T에 iter_stop 이내가 될 때까지
    타원 장축을 다시 잡는다. attempt i는 seed + i의 RNG만 쓴다. 같은 경로는 한 번만 남긴다(경로 node 열 기준).
    s, t는 snap 단계에서 정한 node를 그대로 받는다. leg는 route_through + 요청 단위 LegMemo로 찾는다."""
    mult = mult or {}
    ps, pt = _xy(rg, s), _xy(rg, t)
    c = float(np.hypot(*(pt - ps))) / 2
    centre, ux = (ps + pt) / 2, (pt - ps) / max(2 * c, 1e-9)
    uy = np.array([-ux[1], ux[0]])
    ks = _v(cfg, "p2p_waypoints")
    out, seen = [], set()
    memo = LegMemo()   # request-local
    for i in range(_v(cfg, "attempts")):
        sd = seed + i
        rng = np.random.default_rng(sd)
        k = ks[sd % len(ks)]
        side = 1.0 if rng.uniform() < 0.5 else -1.0
        phis = [math.pi * (1 - (j + 1) / (k + 1)) + rng.uniform(-0.35, 0.35) * math.pi / (k + 1) for j in range(k)]
        a = max(target / (2 * _v(cfg, "circuity0")), c * 1.0001)
        best = None
        for _ in range(_v(cfg, "max_iter")):
            b = math.sqrt(max(a * a - c * c, 0.0))
            wps = []
            for ph in phis:
                p = centre + ux * a * math.cos(ph) + uy * side * b * math.sin(ph)
                n = _nearest_wp(rg, p)
                if n not in (s, t) and (not wps or wps[-1] != n):
                    wps.append(n)
            path = route_through(rg, [s] + wps + [t], mult, _v(cfg, "reuse_penalty"), memo)
            if path is None:
                break
            path = rrg.trim_spurs(path)[0]
            d = length(rg, path)
            err = (d - target) / target
            if best is None or abs(err) < abs(best["err"]):
                best = {"path": path, "err": err, "waypoints": wps, "a_m": a}
            if abs(err) <= _v(cfg, "iter_stop"):
                break
            a = max(a * (target / max(d, 1.0)) ** 0.9, c * 1.0001)
        if best is None:
            continue
        key = tuple(best["path"])
        if key in seen:
            continue
        seen.add(key)
        out.append({**best, "attempt": i, "seed": sd, "k": k})
    return out

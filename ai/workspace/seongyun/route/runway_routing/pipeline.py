"""RunWay course recommendation backend: one request -> ranked routes. Start reading here.

요약: Route backend의 진입점. 요청 하나를 받아 graph → snap → 후보 생성 → feature → 점수/순위 → Gate까지 순서대로 부른다.
위치: route_demo/app_runway.py 바로 아래. 다른 모든 모듈은 여기서 호출된다.
주의: out dict의 key와 순서는 API/Gate 로그 계약이다. 같은 요청은 항상 같은 결과를 내야 한다(golden).

    p = RoutePipeline("wide", mode="enforce", fast=True)     # start-up: extract, env layer, DEM, caches, gate
    with p.lock:
        out = p.run(lat, lon, target_m, seed=1, attempts=24, prefs=Preferences(...),
                    shape=None | "out_and_back" | "point_to_point", end_lat=None, end_lon=None)

Every shape runs the same steps; only generation (and P2P's snapping) differs:
    data      data.py        external files (extract, env layer, env cache, DEM, configs), loaded once at start-up
    graph     graph.py       working disk around the start -> request graph (LRU cache, 4 graphs; RUNWAY_GRAPH_CACHE_SIZE)
    snap      snap.py        user point(s) -> graph nodes
    generate  candidates.py  LOOP: canonical generator + weak preference bias / OUT_AND_BACK / POINT_TO_POINT
    features  features.py    route features + validity (+-10 % distance, shape rules) + Running Suitability components
    score     scorer.py      rule-based score + suitability term -> rank (score order, 0.6 overlap dedupe)
    gate      gate.py        Usability Gate: FAIL removed before dedupe (enforce), REVIEW logged only, Stage B on TOP3
The API layer (route_demo/app_runway.py) serves out["preference"] or out["baseline"] [:3] and explains it (explain.py).

`out` is the contract with the API layer and the gate log; its keys and their order are kept as they were:
    request, issues, canonical, graph, counts, pool, baseline, preference, [runtime_s], running_suitability (LOOP),
    shape (OUT_AND_BACK / POINT_TO_POINT), usability
LOOP backward compatibility: a LOOP request runs exactly the LOOP steps it ran before the course shapes existed; no
shape field appears in a LOOP result. Determinism: same request + same data -> the same out (seeds, RNG streams,
tie-breaks and rounding are fixed). Not thread-safe: callers hold p.lock for the whole request, as the app does.
"""
import math
import os
import threading
import time
from dataclasses import asdict

import networkx as nx
import pandas as pd

from . import candidates, features, scorer, snap
from . import graph as graph_mod
from .data import RunwayData, api
from .gate import Gate
from .graph import GraphStore, disk
from .scorer import Preferences
from .substrate import Substrate
from .array_graph import ArrayLoopGenerator, ArraySource

LOOP = features.LOOP


def _issue(code: str, message: str, blocking: bool, **extra) -> dict:
    return {"code": code, "message": message, "blocking": blocking, **extra}


class RoutePipeline:
    """추천 backend 하나. 시작 시 extract, env layer, DEM, config, Gate, P2P substrate를 한 번 읽고 들고 있는다.

    보유 상태: gen(canonical generator + fast graph builder, (G, rg) LRU), graphs(요청 graph LRU),
    data(정적 데이터), gate(Gate 설정·버전), substrate(P2P app-max mask LRU. rollback 시 None), lock.
    LRU 칸 수: gen·graphs = RUNWAY_GRAPH_CACHE_SIZE, mask = RUNWAY_MASK_CACHE_SIZE(둘 다 기본 4, import 시 읽음).
    cache는 결과를 바꾸지 않는다(어느 cache를 비워도 같은 요청은 같은 out). thread-safe가 아니므로 호출자는
    요청 전체 동안 lock을 잡는다. mode("enforce" / "shadow")와 fast는 생성자 인자다(app이 환경변수로 정한다).
    주의: 생성자 기본값은 mode="shadow"다. 서비스(app)는 기본 "enforce"를 넘긴다. 직접 만들 때는 mode를 명시한다."""

    def __init__(self, env_layer: str = "wide", mode: str = "shadow", fast: bool = True, self_test: bool = True):
        # extract + verified legacy fast-graph self-test. (G, rg) LRU 칸 수 = 요청 graph LRU와 같은 GRAPH_CACHE_SIZE
        self.gen = ArrayLoopGenerator(fast=fast, self_test=self_test, graph_cache_size=graph_mod.GRAPH_CACHE_SIZE)
        api.busan.ox.settings.log_console = False
        self.data = RunwayData(env_layer)
        self.graphs = GraphStore(self.gen, self.data)
        self.rs_cfg = self.data.rs_cfg
        self.rs_weight = self.rs_cfg["ranking"]["weight"]
        if self.rs_weight is None:
            raise ValueError("running_suitability_config.json ranking.weight is not set")
        self.gate = Gate(mode, self.gen.source.path, self.gen.extract.get("osm_data_timestamp"))
        self.shape_cfg = self.data.shape_cfg
        self.ug2 = self.gate.cfg["v2"]
        # P2P's two app-max disks as array masks (same sets and results as the networkx graphs, ~10x cheaper);
        # RUNWAY_P2P_SUBSTRATE=0 rolls back to snap.p2p_endpoints on networkx graphs.
        # rollback 환경변수(프로세스 시작 시 읽음, 바꾸면 서버 재시작):
        #   RUNWAY_ARRAY_LOOP=0     LOOP 배열 view -> 기존 G/H 생성, 추천 결과는 유지
        #   RUNWAY_SP_ENGINE=python  Numba kernel -> 기존 Python D-exact
        #   RUNWAY_P2P_SUBSTRATE=0  여기서 읽음. P2P app-max disk를 networkx로            -> 결과 동일, P2P cold 느려짐
        #   RUNWAY_SP_KERNEL=nx     shortest_path import 시 읽음. 최단 경로를 networkx로    -> 결과 동일, 생성 느려짐
        #   RUNWAY_FAST_GRAPH=0     app_runway가 읽어 fast=False로 전달. canonical builder -> 결과 동일, cold 느려짐
        #   RUNWAY_USABILITY_GATE=shadow  app_runway가 읽어 mode로 전달. Gate가 기록만 함  -> FAIL 경로가 남을 수 있음
        # 앞의 셋은 같은 결과를 내도록 검증된 느린 경로이고, shadow만 추천 결과가 달라질 수 있는 비상용 스위치다.
        self.substrate = Substrate(self.gen, self.ug2) if os.environ.get("RUNWAY_P2P_SUBSTRATE", "1") != "0" else None
        #   RUNWAY_ARRAY_SHAPES=0   여기서 읽음. OUT_AND_BACK / P2P 생성 disk를 networkx G/H로   -> 결과 동일, cold 느려짐
        flag = os.environ.get("RUNWAY_ARRAY_SHAPES", "1")
        if flag not in ("0", "1"):
            raise ValueError("RUNWAY_ARRAY_SHAPES must be 0 or 1")
        self.array_shapes = flag == "1"
        if self.gen.array_enabled:
            self.gen.array_source = ArraySource(self.substrate if self.substrate is not None else Substrate(self.gen, self.ug2))
        self.lock = threading.Lock()

    def status(self) -> dict:
        d, lay = self.data, self.data.env["layers"]
        return {"generator": "analysis/runway_route_api.py (canonical, schema %s)" % api.SCHEMA,
                "extract": self.gen.extract, "env_layer": d.env["name"], "env_layer_path": d.env["path"],
                "env_extent_wsen": d.env["extent_wsen"], "env_note": d.env["note"],
                "env_layer_counts": lay["env_class"].value_counts().to_dict() if lay is not None else None,
                "dem": d.dem_path, "load_seconds": d.load_seconds, "env_cache": d.env_cache_status(),
                "graph_builder": self.gen.fast_status}

    def graph(self, lat: float, lon: float, target_m: float):
        return self.graphs.get(lat, lon, target_m)

    def run(self, lat: float, lon: float, target_m: float, seed: int = 1, attempts: int | None = None,
            prefs: Preferences | dict | None = None, shape: str | None = None, end_lat: float | None = None,
            end_lon: float | None = None) -> dict:
        """요청 하나 → out dict(모듈 docstring의 key 순서). shape None/"loop"는 LOOP, "out_and_back", "point_to_point".

        순서: 생성 → features + 유효성 → 점수 + 러닝 적합도 → rank(dedupe) → Gate(FAIL 제거 후 재정렬, Stage B).
        API는 out["preference"](선호가 있을 때) 또는 out["baseline"]의 앞 3개를 TOP3로 쓴다.
        막힌 요청(extract 밖, P2P 거리 규칙, snap 실패, 후보 없음)은 out["issues"]의 blocking issue로 돌려준다.
        예외: 알 수 없는 shape/도착 좌표 누락은 ValueError, 주변에 길이 전혀 없으면 osmnx InsufficientResponseError
        (app이 NO_ROAD_NEARBY로 바꾼다). side effect: graph·mask LRU가 채워진다(결과에는 영향 없음)."""
        prefs = prefs if isinstance(prefs, Preferences) else Preferences.from_dict(prefs)
        if shape in candidates.LOOP_SHAPES:
            active = self.gen.array_active
            self.gen.array_active = True
            try:
                return self._loop(lat, lon, target_m, seed, candidates.POC_DEFAULT_ATTEMPTS if attempts is None else attempts,
                                  prefs)
            finally:
                self.gen.array_active = active
        if shape not in candidates.NEW_SHAPES:
            raise ValueError(f"unknown shape {shape!r}")
        if shape == "point_to_point" and (end_lat is None or end_lon is None):
            raise ValueError("point_to_point needs end_lat / end_lon")
        active = self.gen.array_active
        self.gen.array_active = self.array_shapes   # OAB/P2P 생성 disk도 배열 graph(H21 R1); 끄면 기존 NetworkX
        try:
            out = self._shape(shape, lat, lon, target_m, end_lat, end_lon, seed, attempts, prefs)
        finally:
            self.gen.array_active = active
        info = out["shape"]
        if "graph_centre" not in info or "start_node" not in info:
            out["usability"] = self.gate.skipped("no route generated")
            return out
        c = info["graph_centre"]
        start = {"node": info["start_node"], "snap_m": info["start"]["snap_node_dist_m"]}
        return self._gate(out, info["route_type"], c["lat"], c["lon"], target_m, start, info.get("gate_p2p"))

    # ------------------------------------------------------------------ LOOP
    def _loop(self, lat, lon, target_m, seed, attempts, prefs) -> dict:
        bias = None
        if not prefs.is_neutral():   # weak preference bias for generation, built on the request graph (edge_b04)
            try:
                bias = candidates.GenerationBias(prefs, self.graph(lat, lon, target_m), candidates.DEFAULT_BIAS)
            except api.OutOfCoverageError:
                pass                 # generation reports OUTSIDE_CANONICAL_EXTRACT
        out = self._loop_routes(lat, lon, target_m, seed, attempts, prefs, bias)
        out["request"]["generation_bias"] = (None if bias is None else
                                             {**asdict(bias.spec), "biased_edge_share": bias.biased_edge_share})
        if bias is not None:
            out["issues"].append({"code": "CANONICAL_PREF_GENERATION", "blocking": False,
                                  "message": f"선호를 후보 생성에 약하게 반영했습니다({bias.spec.name}). "
                                             "최종 순위는 기존 scorer가 정합니다."})
        self._running_suitability(out, lat, lon, target_m)
        st = (out.get("canonical") or {}).get("start")
        start = None if st is None else {"node": st["node_id"], "snap_m": st["snap_node_dist_m"]}
        return self._gate(out, LOOP, lat, lon, target_m, start)

    def _loop_routes(self, lat, lon, target_m, seed, attempts, prefs, bias) -> dict:
        """Generate -> features + validity -> score -> rank (scores without the suitability term)."""
        t0 = time.perf_counter()
        out = {"request": {"lat": lat, "lon": lon, "target_m": target_m, "seed": seed, "attempts": attempts,
                           "route_type": LOOP, "preferences": prefs.__dict__.copy(), "generator": "canonical"},
               "issues": [], "canonical": None, "graph": None, "counts": {}, "pool": [],
               "baseline": [], "preference": None}
        try:
            res = candidates.loop(self.gen, lat, lon, target_m, seed, attempts, bias)   # snaps the start itself
        except api.OutOfCoverageError as exc:
            out["issues"].append(_issue("OUTSIDE_CANONICAL_EXTRACT", str(exc), True))
            return out
        out["canonical"] = {k: v for k, v in res.to_dict().items() if k != "candidates"}
        out["issues"] += [_issue("CANONICAL_WARNING", w, False) for w in res.warnings]
        cg = self.graph(lat, lon, target_m)
        out["graph"] = cg.stats
        out["pool"] = features.loop_pool(cg, res.candidates, target_m, self.data.env["name"])
        valid = [r for r in out["pool"] if r["invalid_reason"] is None]
        scorer.score_loop(valid, prefs, self.data.scfg)
        out["baseline"] = scorer.rank(valid, "baseline_score", cg.ea["length"])
        if not prefs.is_neutral():
            out["preference"] = scorer.rank(valid, "preference_score", cg.ea["length"])
        # counts.final_* are the lengths of THIS ranking (before Running Suitability re-ranks): API debug contract
        reasons = pd.Series([r["invalid_reason"] for r in out["pool"] if r["invalid_reason"]]).value_counts().to_dict()
        pool_f = [r["features"] for r in out["pool"] if r["nodes"] is not None]
        out["counts"] = {**res.counts, "on_graph": len(pool_f), "loop_valid": len(valid),
                         "final_baseline": len(out["baseline"]),
                         "final_preference": None if out["preference"] is None else len(out["preference"]),
                         "invalid_reasons": reasons,
                         "excluded_edges_used_total": sum(f["excluded_edges_used"] for f in pool_f),
                         "uncertain_edges_used_total": sum(f["uncertain_edges_used"] for f in pool_f),
                         "unknown_edges_used_total": sum(f["unknown_edges_used"] for f in pool_f),
                         "osmid_mismatch_edges_total": sum(f["osmid_mismatch_edges"] for f in pool_f)}
        out["runtime_s"] = round(time.perf_counter() - t0, 2)
        issue = out["issues"].append
        if not valid:
            issue(_issue("NO_CANDIDATE_IN_TOLERANCE", f"canonical 후보 {len(res.candidates)}개 중 LOOP 조건(±10%, 반복 ≤20%, "
                         f"왕복 ≤30%)을 통과한 후보가 없습니다. 이유: {reasons}", True))
        if out["counts"]["excluded_edges_used_total"] or out["counts"]["uncertain_edges_used_total"]:
            issue(_issue("FORBIDDEN_EDGE_USED", "EXCLUDED/UNCERTAIN edge가 canonical 경로에 들어갔습니다 (버그).", True))
        if self.data.env["note"]:
            issue(_issue("ENV_LAYER_FALLBACK", self.data.env["note"], False))
        partial = sum(1 for r in valid if r["features"]["env_layer_covered_ratio"] < 1.0)
        if partial:
            issue(_issue("ENV_LAYER_PARTIAL", f"유효 후보 {len(valid)}개 중 {partial}개가 환경 레이어 범위 밖을 지납니다 "
                         "(그 구간은 강·해변·녹지가 '없음'으로 계산됨).", False))
        return out

    def _running_suitability(self, out: dict, lat, lon, target_m) -> None:
        """LOOP: add the Running Suitability term to both scores and re-rank (generation and pool unchanged)."""
        out["running_suitability"] = {"version": self.rs_cfg["version"], "weight": self.rs_weight}
        valid = [r for r in out["pool"] if r["invalid_reason"] is None]
        if not valid:
            return
        cg = self.graph(lat, lon, target_m)
        features.add_running_suitability(valid, cg, self.rs_cfg)
        scorer.add_suitability(valid, self.rs_weight)
        out["baseline"] = scorer.rank(valid, "baseline_score", cg.ea["length"])
        if out["preference"] is not None:
            out["preference"] = scorer.rank(valid, "preference_score", cg.ea["length"])

    # ------------------------------------------------------------------ OUT_AND_BACK / POINT_TO_POINT
    def _shape(self, shape, lat, lon, target_m, end_lat, end_lon, seed, attempts, prefs) -> dict:
        route_type = candidates.NEW_SHAPES[shape]
        cfg = dict(self.shape_cfg)
        if attempts is not None:
            cfg["attempts"] = {**cfg["attempts"], "value": attempts}
        out = {"request": {"lat": lat, "lon": lon, "target_m": target_m, "seed": seed,
                           "attempts": cfg["attempts"]["value"], "route_type": route_type, "shape": shape,
                           "end_lat": end_lat, "end_lon": end_lon, "preferences": prefs.__dict__.copy(),
                           # 옛 모듈 이름이 남은 label이지만 응답과 Gate 로그 계약(golden)에 들어 있어 그대로 둔다
                           "generator": "shape_core (staging IMPL-1)"},
               "issues": [], "canonical": None, "graph": None, "counts": {}, "pool": [], "baseline": [],
               "preference": None, "shape": {"shape": shape, "route_type": route_type}}
        info = out["shape"]
        # 1. graph + snapped endpoints
        try:
            if shape == "out_and_back":
                clat, clon = lat, lon
                G, rg = disk(self.gen, clat, clon, target_m)
            else:   # P2P: snap both ends once on the app-max disk, distance rule BEFORE any generation
                sx, sy = snap.to_utm(lon, lat)
                ex, ey = snap.to_utm(end_lon, end_lat)
                info["straight_m"] = float(math.hypot(ex - sx, ey - sy))
                clon, clat = snap.TO_LL.transform((sx + ex) / 2, (sy + ey) / 2)
                if self.substrate is None:   # rollback 경로(app-max disk를 networkx로)는 배열 graph를 쓰지 않는다
                    active, self.gen.array_active = self.gen.array_active, False
                    try:
                        d = snap.p2p_endpoints(self.gen, clat, clon, lat, lon, end_lat, end_lon, info, self.shape_cfg,
                                               self.ug2, self.data.env)
                    finally:
                        self.gen.array_active = active
                else:
                    d = self.substrate.p2p_endpoints(self.gen, clat, clon, lat, lon, end_lat, end_lon, info,
                                                     self.shape_cfg, self.ug2, self.data.env)
                if d is None:
                    return out | {"issues": out["issues"] + info.pop("_issues")}
                rule = candidates.distance_rule(d, target_m, cfg)
                info["rule"] = rule
                if rule["status"] != "OK":
                    msg = (f"이 목적지까지는 최소 {rule['min_target_km']} km가 필요합니다."
                           if rule["status"] == "DESTINATION_TOO_FAR" else "현재 앱 범위를 벗어난 목적지입니다.")
                    out["issues"].append(_issue(rule["status"], msg, True, min_target_km=rule["min_target_km"],
                                                alternatives_from_km=rule["alternatives_from_km"]))
                    return out
                # generation disk for T at the SNAPPED midpoint (every s-t route <= 1.1 T lies inside it); the
                # start / end nodes snapped once on the app-max disk are REUSED (E-I3 B3)
                # snap 재사용: 생성 disk에서 다시 snap하면 disk 경계가 달라 다른 node가 뽑힐 수 있다. 그러면 d_min을 잰 node와
                # 경로를 만든 node가 달라진다. 그래서 app-max disk에서 한 번 정한 node id를 끝까지 쓰고, 생성 graph에
                # 없으면 다시 snap하지 않고 SNAP_NODE_NOT_IN_GENERATION_GRAPH로 멈춘다.
                clat, clon = info["d_min_disk"]["centre_lat"], info["d_min_disk"]["centre_lon"]
                G, rg = disk(self.gen, clat, clon, target_m)
                s, t = info["start_node"], info["end_node"]
                if s not in rg.H or t not in rg.H:
                    out["issues"].append(_issue("SNAP_NODE_NOT_IN_GENERATION_GRAPH",
                                                "출발·도착 지점을 경로 그래프에서 찾지 못했어요.", True))
                    return out
        except api.OutOfCoverageError as exc:
            out["issues"].append(_issue("OUTSIDE_CANONICAL_EXTRACT", str(exc), True))
            return out
        if shape == "out_and_back":
            st = snap.start(rg, lat, lon)
            s = int(st["start_node"])
            info["start_node"] = s
            info["start"] = {"node": s, "snap_node_dist_m": st["snap_node_dist_m"], "shift_to_main_m": st["shift_to_main_m"]}
        else:
            try:
                d_gen = (candidates.path_length(rg, s, t) if candidates._array_rg(rg)
                         else nx.shortest_path_length(rg.H, s, t, weight="length"))
            except nx.NetworkXNoPath:   # PE2 on the generation disk
                out["issues"].append(_issue("END_SNAP_PE2", "도착지가 출발지와 이어진 길에 있지 않아요.", True))
                return out
            info["d_min_equal_on_generation_disk"] = bool(abs(d_gen - info["d_min_m"]) <= 1.0)
            info["return_straight_m"] = info["straight_m"]
            info["return_runnable_m"] = info["d_min_m"]
            pe5 = info.pop("_pe5")
            info["gate_p2p"] = {"end_node": t, "dest_snap_m": info["end"]["snap_m"], "dest_in_extract": True,
                                "dest_lonlat": (end_lon, end_lat), "same_component": True,
                                "pe5_edge_lines": pe5["edge_lines"], "pe5_env_polys": pe5["env_polys"],
                                "pe5_env_lines": pe5["env_lines"]}
        info["graph_centre"] = {"lat": clat, "lon": clon}
        cg = self.graph(clat, clon, target_m)
        out["graph"] = cg.stats
        # 2. generate (preference bias = the LOOP's edge multipliers)
        mult = {}
        if not prefs.is_neutral():
            mult = candidates.GenerationBias(prefs, cg, candidates.DEFAULT_BIAS).edge_mult
            out["request"]["generation_bias"] = candidates.DEFAULT_BIAS.name
        if shape == "out_and_back":
            gen = candidates.oab_candidates(rg, s, target_m, seed, cfg, mult, snap.pe4_forbidden_nodes(G, self.ug2))
        else:
            gen = candidates.p2p_candidates(rg, s, t, target_m, seed, cfg, mult)
        # 3. features + validity, 4. score (with the suitability term) + rank
        out["pool"] = features.shape_pool(cg, rg, gen, shape, s, t if shape == "point_to_point" else None, target_m,
                                          self.data.env["name"], self.shape_cfg["tolerance"]["value"],
                                          self.ug2["type_matrix"]["F6"])
        valid = [r for r in out["pool"] if r["invalid_reason"] is None]
        features.add_running_suitability(valid, cg, self.rs_cfg)
        scorer.score_shape(valid, prefs, route_type, self.data.scfg, self.rs_weight)
        out["baseline"] = scorer.rank(valid, "baseline_score", cg.ea["length"])
        if not prefs.is_neutral():
            out["preference"] = scorer.rank(valid, "preference_score", cg.ea["length"])
        out["counts"] = {"generated": len(gen), "loop_valid": len(valid), "final_baseline": len(out["baseline"]),
                         "final_preference": None if out["preference"] is None else len(out["preference"]),
                         "invalid_reasons": _count(r["invalid_reason"] for r in out["pool"] if r["invalid_reason"])}
        if shape == "out_and_back":
            info["turnarounds"] = {r["candidate_id"]: r["generation"]["turnaround"] for r in valid}
        if not valid:
            out["issues"].append(_issue("NO_CANDIDATE_IN_TOLERANCE", "조건에 맞는 코스를 만들지 못했어요.", True))
        return out

    # ------------------------------------------------------------------ Usability Gate (every shape)
    def _gate(self, out, request_type, glat, glon, target_m, start, p2p=None) -> dict:
        return self.gate.apply(out, request_type, lambda: self.graph(glat, glon, target_m), target_m, start,
                               self.gen.source, scorer.rank, p2p)


def _count(it) -> dict:
    out = {}
    for x in it:
        out[x] = out.get(x, 0) + 1
    return out

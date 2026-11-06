"""RunWay Route 서비스: 출발 위치 + 목표 거리 + 조건 -> 코스 TOP3. 백엔드(Spring) 전용 내부 API.

엔진은 runway_routing.pipeline.RoutePipeline이다. 계약은 BE Route 내부 계약(MR !183)과 API.md:
  POST /internal/v1/routes/recommendations   성공 200 {routes[rank, coords, distance_m, summary, reasons, caveats,
                                              score, score_terms], notices, next_seed}
  GET  /internal/v1/ready                    200 {"ready": true, ...} / 503 {"ready": false, ...}
  GET  /health/live                          프로세스 생존
오류는 non-2xx + {code, message, details}(errors.py). 판단 순서·코드·문구는 예전 데모(/api/recommend)와 같다.
ROUTE_DEBUG=1이면 성공 응답이 예전 데모의 전체 필드(고도·경사 값 제외) + debug가 되고, 오류에도 debug가 붙는다.
고도·경사 값(elevation_profile_m, features의 고도 key, details의 누적 상승·평균 경사)은 어느 모드에서도 보내지 않는다.
경사는 백엔드가 계산한다. 엔진은 DEM을 "평지 위주(flat)" 선호에만 쓴다. 같은 입력 + 같은 seed = 같은 결과.

동시성: pipeline.lock(엔진은 thread-safe가 아님)을 최대 1초 기다리고 못 잡으면 503 BUSY. 요청 헤더
X-Request-Deadline(epoch ms)이 있으면 계산 시작 직전에 확인해 이미 지났으면 503 TIMEOUT. 시작한 계산은 끊지 않는다.

준비 순서: 프로세스 시작(live) -> 엔진 로드 -> 예열 요청 1회(ROUTE_WARMUP=0이면 생략) -> ready.
ready 전 추천 요청은 503 NOT_READY, 로드·예열 실패는 503 UNAVAILABLE.

실행(ai/route_service에서):  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
"""
import json
import logging
import math
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Header, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from runway_routing.data import REGIONS
from runway_routing.explain import ENV_KEYS as SHAPE_ENV_KEYS, FILTER_LABEL, details, explain, explain_shape
from runway_routing.features import ELEVATION_KEYS
from runway_routing.scorer import Preferences
from runway_routing.snap import start_distance_m, to_utm

from . import reroll
from .ai_logging import log_ai_error
from .config import Settings, load_settings
from .errors import REROLL_NO_ROUTE_MESSAGE, SHAPE_FAIL, fail
from .schemas import SEED_MAX, Filters, RecommendRequest

log = logging.getLogger("runway.ai")

ATTEMPTS = 24            # seed 하나당 후보 시도 수; "다른 코스 추천" -> next_seed = seed + ATTEMPTS
TOP_K = 3
MIN_KM, MAX_KM = 1.0, 15.0
MAX_SNAP_M = 250         # 요청 위치 -> 실제 출발 node(snap.start_distance_m) 상한. canonical start_far_from_network 경고 거리와 같은 값
ENV_FILTERS = ["river", "beach", "park", "trail"]
FEATURE_OF = {"river": "river_ratio", "beach": "coastal_ratio", "park": "green_ratio", "trail": "trail_ratio"}
# 응답에서 빼는 고도·경사 값 (엔진 내부와 Gate 로그에는 그대로 있다)
DROP_FEATURE_KEYS = frozenset(ELEVATION_KEYS) | {"elevation_available", "elevation_note"}
DROP_DETAIL_LABELS = frozenset({"누적 상승", "평균 경사"})
RECOMMEND = "/internal/v1/routes/recommendations"
READY = "/internal/v1/ready"
DEADLINE_HEADER = "X-Request-Deadline"   # epoch ms, 선택. 계산 시작 직전에 지났으면 503 TIMEOUT
LOCK_WAIT_S = 1.0                        # 실행 슬롯 대기 상한. 넘으면 503 BUSY
SLIM_ROUTE_KEYS = ("rank", "coords", "distance_m", "summary", "reasons", "caveats", "score", "score_terms")


def _default_pipeline_factory(settings: Settings):
    from runway_routing.pipeline import RoutePipeline
    return RoutePipeline("wide", mode=settings.gate_mode, fast=settings.fast_graph)


def warmup_request() -> RecommendRequest:
    """예열 요청: 광안리 중심, 순환 5 km, 조건 없음, seed 1 (Numba·graph 첫 호출 비용을 ready 전에 치른다)."""
    lat, lon = REGIONS["gwangalli"].center
    return RecommendRequest(lat=lat, lon=lon, distance_km=5.0)


class Engine:
    """엔진 상태: phase = loading -> warming -> ready | failed."""

    def __init__(self, settings: Settings, factory):
        self.settings, self.factory = settings, factory
        self.pipeline = None
        self.phase, self.error = "loading", None
        self.load_s = self.warmup_s = None
        # 재추천 제외용 코스 결과 cache(S15P31E105-383, app/reroll.py). ROUTE_REROLL_EXCLUDE=0이면 None = 예전 동작
        self.reroll = reroll.ShownCache(settings.reroll_cache_size) if settings.reroll_exclude else None

    def start(self) -> None:
        try:
            t0 = time.perf_counter()
            self.pipeline = self.factory(self.settings)
            self.load_s = round(time.perf_counter() - t0, 1)
            log.info("Route 엔진 로드 %.1f초", self.load_s)
        # SystemExit: analysis/runway_busan_graph._busan_pbf()가 PBF 0개·여러 개일 때 내는 CLI식 종료를 시작 실패로 바꾼다.
        # KeyboardInterrupt 등 다른 BaseException은 잡지 않는다(종료 신호를 삼키지 않음).
        except (Exception, SystemExit) as exc:
            self.phase, self.error = "failed", f"{type(exc).__name__}: {exc}"
            log_ai_error("ROUTE_ENGINE_LOAD_FAILED", "startup", exc)
            return
        if self.settings.warmup:
            self.phase = "warming"
            t0 = time.perf_counter()
            try:
                res = recommend_core(self, warmup_request(), gate_log=False, lock_wait_s=None, remember=False)
                # 441 R13: 예열은 늘 코스가 나오는 고정 요청(광안리 순환 5 km)이다. 200(코스 1개 이상)이 아니면 4xx라도
                # 데이터·엔진 문제(잘못된 bundle → OUT_OF_AREA, Gate·생성 고장 → NO_ROUTE 등)로 보고 시작 실패로 둔다.
                status = getattr(res, "status_code", 200)
                if status != 200:
                    code = json.loads(res.body).get("code") if hasattr(res, "body") else None
                    raise RuntimeError(f"warm-up HTTP {status} {code}")
            except (Exception, SystemExit) as exc:
                self.phase, self.error = "failed", f"warm-up {type(exc).__name__}: {exc}"
                log_ai_error("ROUTE_WARMUP_FAILED", "startup", exc)
                return
            self.warmup_s = round(time.perf_counter() - t0, 1)
            log.info("Route 예열 완료 %.1f초", self.warmup_s)
        self.phase = "ready"


def create_app(settings: Settings | None = None, pipeline_factory=None, *, background: bool = True) -> FastAPI:
    settings = settings or load_settings()
    engine = Engine(settings, pipeline_factory or _default_pipeline_factory)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if background:   # live는 바로, ready는 로드·예열 후
            threading.Thread(target=engine.start, name="route-engine-start", daemon=True).start()
        else:
            engine.start()
        yield

    app = FastAPI(title="RunWay Route", version="1.0.0", lifespan=lifespan,
                  description="백엔드 서버 전용 내부 API. 러닝 코스 TOP3를 만든다.")
    app.state.engine = engine

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        fields = [{"name": ".".join(str(p) for p in err["loc"][1:]) or "body",
                   "reason": err["msg"].removeprefix("Value error, ")} for err in e.errors()]
        return fail("VALIDATION_ERROR", details={"fields": fields})

    # probe는 계산 없이 상태만 읽으므로 async: 추천 요청이 thread pool을 다 써도 바로 답한다(R9)
    @app.get("/health/live")
    async def live():
        return {"status": "UP"}

    @app.get(READY)
    async def ready():
        body = {"ready": engine.phase == "ready", "phase": engine.phase,
                "load_s": engine.load_s, "warmup_s": engine.warmup_s}
        return body if body["ready"] else JSONResponse(body, status_code=503)

    @app.post(RECOMMEND)
    def recommend(req: RecommendRequest, deadline: str | None = Header(None, alias=DEADLINE_HEADER)):
        if engine.phase == "failed":
            return fail("UNAVAILABLE", debug=engine.error, include_debug=settings.debug)
        if engine.phase != "ready":
            return fail("NOT_READY")
        deadline_ms = None
        if deadline is not None:
            try:
                deadline_ms = int(deadline)
            except ValueError:
                return fail("VALIDATION_ERROR", details={"fields": [
                    {"name": DEADLINE_HEADER, "reason": "epoch milliseconds integer"}]})
        return recommend_core(engine, req, deadline_ms=deadline_ms)

    return app


def _prefs(f: Filters) -> Preferences:
    d = {k: 5 for k in ("river", "beach", "park", "trail", "pedestrian", "avoid_major_road", "avoid_steps", "avoid_tunnel")
         if getattr(f, k)}
    return Preferences.from_dict({**d, "difficulty": "flat" if f.flat else "any"})


def next_seed(seed: int) -> int:
    """다음 "다시 추천" seed = seed + ATTEMPTS. 허용 범위(1~SEED_MAX)를 넘으면 1부터 다시 센다(R12, API.md 2절).
    seed <= SEED_MAX - ATTEMPTS인 보통 요청은 seed + ATTEMPTS 그대로다."""
    return (seed + ATTEMPTS - 1) % SEED_MAX + 1


# 441 R7: 엔진이 "작업 영역에 달릴 수 있는(RUNNABLE) 길이나 waypoint 후보가 하나도 없음"일 때 내는 예외(정확한 문구로만 판단).
#   IndexError  array_graph.build_array_pair / busan.route_graph: 빈 RUNNABLE·waypoint 배열(float dtype)로 index
#   ValueError  substrate.DiskMask / snap: 빈 RUNNABLE 집합의 argmax; disk 안에 node가 없음
# 엔진 코드(H23 소유 build_array_pair 포함)는 그대로 두고 서비스 경계에서 422로 바꾼다. 다른 IndexError/ValueError는 500 그대로.
NO_USABLE_ROAD_ERRORS = {
    IndexError: ("arrays used as indices must be of integer (or boolean) type",),
    ValueError: ("attempt to get argmax of an empty sequence", "Found no graph nodes within the requested polygon"),
}


def _no_usable_road(exc: BaseException) -> bool:
    return any(type(exc) is t and str(exc).startswith(msgs) for t, msgs in NO_USABLE_ROAD_ERRORS.items())


def _expired(deadline_ms: int | None) -> bool:
    return deadline_ms is not None and time.time() * 1000 >= deadline_ms


def recommend_core(engine: Engine, req: RecommendRequest, gate_log: bool = True,
                   lock_wait_s: float | None = LOCK_WAIT_S, deadline_ms: int | None = None, remember: bool = True):
    """데모 /api/recommend와 같은 판단 순서. 반환: 성공 dict 또는 JSONResponse(오류).
    lock_wait_s=None은 끝까지 기다린다(시작 시 예열만 쓴다). remember=False면 재추천 cache에 넣지 않는다(예열).
    재추천(seed >= 25): 이전 1~2개 응답의 TOP3와 0.6 이상 겹치는 후보를 뺀다(app/reroll.py). seed 1~24는 예전과 같다."""
    p, settings = engine.pipeline, engine.settings
    dbg = settings.debug

    def _fail(code, message=None, debug=None, details=None):
        return fail(code, message, details=details, debug=debug, include_debug=dbg)

    if not (MIN_KM <= req.distance_km <= MAX_KM):
        return _fail("DISTANCE_RANGE", f"거리는 {MIN_KM:g}~{MAX_KM:g} km 사이로 정해 주세요.")
    if req.shape == "point_to_point" and (req.end_lat is None or req.end_lon is None):
        return _fail("DESTINATION_REQUIRED")
    if req.shape == "point_to_point" and _straight_m(req) > _p2p_out_of_range_m(p):
        return _fail("OUT_OF_APP_RANGE")
    loop = req.shape == "loop"
    target_m = round(req.distance_km * 1000)
    filters = req.filters.model_dump()
    prefs = _prefs(req.filters)
    t0 = time.perf_counter()
    # LOOP는 shape 인자를 넘기지 않는다: RoutePipeline.run(shape=None) = IMPL-1 이전부터 같은 LOOP 경로
    shape_kw = {} if loop else {"shape": req.shape, "end_lat": req.end_lat, "end_lon": req.end_lon}
    if _expired(deadline_ms):
        return _fail("TIMEOUT")
    if not p.lock.acquire(timeout=-1 if lock_wait_s is None else lock_wait_s):
        return _fail("BUSY")
    cache = engine.reroll
    depth = reroll.depth(req.seed, ATTEMPTS) if cache is not None else 0
    rr = None
    try:
        if _expired(deadline_ms):   # 슬롯을 기다리는 동안 지났으면 계산하지 않는다
            return _fail("TIMEOUT")
        if depth:
            cond = reroll.condition_key(req, target_m)
            shown, rr = _lookback(p, cache, cond, req, target_m, prefs, shape_kw, depth)
            out = _run_excluding(p, req, req.seed, target_m, prefs, shape_kw, shown)
        else:   # 첫 요청(seed 1~24) 또는 ROUTE_REROLL_EXCLUDE=0: 예전과 같은 호출
            out = p.run(req.lat, req.lon, target_m, seed=req.seed, attempts=ATTEMPTS, prefs=prefs, **shape_kw)
        if cache is not None and remember:   # 실제로 응답한 요청만 넣는다
            cache.put((reroll.condition_key(req, target_m), req.seed, depth), reroll.pack(_served(out, loop)))
        if loop:
            cg = p.graph(req.lat, req.lon, target_m) if out["canonical"] is not None else None
        else:
            centre = out["shape"].get("graph_centre")   # OAB: 출발점, P2P: snap된 두 끝의 중점
            cg = p.graph(centre["lat"], centre["lon"], target_m) if centre else None
        if gate_log:
            _log_usability(settings, req, out, getattr(getattr(p, "gate", None), "files", None))
    except Exception as exc:
        if type(exc).__name__ == "InsufficientResponseError":  # osmnx: 작업 disk 안에 길이 전혀 없음
            return _fail("NO_ROAD_NEARBY", debug=f"{type(exc).__name__}: {exc}")
        if _no_usable_road(exc):   # 441 R7: 길은 있지만 달릴 수 있는 길·waypoint 교차로가 하나도 없음
            log_ai_error("NO_USABLE_ROAD", RECOMMEND, exc, level=logging.WARNING)
            return _fail("NO_ROAD_NEARBY", debug=f"{type(exc).__name__}: {exc}")
        log_ai_error("INTERNAL", RECOMMEND, exc)
        return _fail("INTERNAL", debug=f"{type(exc).__name__}: {exc}")
    finally:
        p.lock.release()
    try:   # 응답 조립(설명·edge·점수 읽기·JSON 변환)의 예외도 같은 INTERNAL 경계에서 처리한다(R6)
        reroll_debug = None if rr is None else {"depth": depth, **(out.get("reroll") or {}), "cache": rr}
        res = _respond(req, out, cg, prefs, filters, loop, target_m, t0, dbg, _fail, reroll_debug)
        # 성공 dict를 여기서 JSON으로 만든다(FastAPI 기본 경로와 같은 jsonable_encoder + JSONResponse = 같은 byte).
        # NaN 같은 직렬화 실패도 이 try 안에서 INTERNAL이 된다.
        return res if isinstance(res, JSONResponse) else JSONResponse(jsonable_encoder(res))
    except Exception as exc:
        log_ai_error("INTERNAL", RECOMMEND, exc)
        return _fail("INTERNAL", debug=f"{type(exc).__name__}: {exc}")


def _respond(req: RecommendRequest, out: dict, cg, prefs: Preferences, filters: dict, loop: bool, target_m: int,
             t0: float, dbg: bool, _fail, reroll_debug: dict | None = None):
    """pipeline 결과 -> 성공 dict 또는 업무 오류 JSONResponse. 판단 순서는 데모 /api/recommend와 같다."""
    codes = {i["code"] for i in out["issues"]}
    info = out.get("shape") or {}
    if loop:
        debug = {"seed": req.seed, "attempts": ATTEMPTS, "counts": out["counts"], "graph": out["graph"],
                 "issues": out["issues"], "generation_bias": out["request"].get("generation_bias"),
                 "canonical_timings_s": (out.get("canonical") or {}).get("timings_s"),
                 "running_suitability": out.get("running_suitability"), "preferences": prefs.__dict__}
    else:
        debug = _shape_debug(req, out, prefs)
    if reroll_debug is not None:   # 재추천에만 붙는다(첫 요청 debug는 예전과 같음)
        debug["reroll"] = reroll_debug
    if "OUTSIDE_CANONICAL_EXTRACT" in codes:
        return _fail("OUT_OF_AREA", debug=debug)
    # 441 R8: 실제 출발 node(주 연결망으로 옮긴 뒤)까지의 거리로 판단한다
    snap_m = start_distance_m(out["canonical"]["start"] if loop else (info.get("start") or {"snap_node_dist_m": 0}))
    if snap_m > MAX_SNAP_M:
        return _fail("NO_ROAD_NEARBY", f"고른 위치에서 달릴 수 있는 길까지 {round(snap_m)} m나 떨어져 있어요. "
                     "길 가까이를 눌러 출발 위치를 다시 골라 주세요.", debug=debug)
    if "DESTINATION_TOO_FAR" in codes:   # 코스 없이 필요한 최소 목표 거리를 안내한다
        i = next(i for i in out["issues"] if i["code"] == "DESTINATION_TOO_FAR")
        return _fail("DESTINATION_TOO_FAR", f"이 목적지까지는 최소 {i['min_target_km']:g} km가 필요합니다.",
                     details={"min_target_km": i["min_target_km"], "alternatives_from_km": i["alternatives_from_km"]},
                     debug=debug)
    for code in SHAPE_FAIL:
        if code in codes:
            return _fail(code, debug=debug)
    if "FORBIDDEN_EDGE_USED" in codes:  # 안전망(테스트에서 나온 적 없음)
        return _fail("SAFETY_CHECK", debug=debug)
    ranked = _served(out, loop)   # 위 검사를 통과했으므로 = 순위표의 앞 TOP_K개
    if not ranked:
        if "USABILITY_GATE_ALL_FAILED" in codes:
            return _fail("USABILITY_GATE_ALL_FAILED", debug=debug)
        if (out.get("reroll") or {}).get("all_excluded"):
            return _fail("NO_ROUTE", REROLL_NO_ROUTE_MESSAGE, debug=debug)
        return _fail("NO_ROUTE", debug=debug)
    mode = "preference" if out["preference"] is not None else "baseline"
    routes = []
    for rank, r in enumerate(ranked, 1):
        f = r["features"]
        ex = explain(f, filters) if loop else explain_shape(f, filters, req.shape, info)
        keys = [f"{min(a, b)}-{max(a, b)}" for a, b in zip(cg.redges["osm_u"].to_numpy()[r["eids"]],
                                                            cg.redges["osm_v"].to_numpy()[r["eids"]])]
        route = {"rank": rank, "distance_m": f["distance_m"], "distance_km": round(f["distance_m"] / 1000, 2),
                 "error_pct": f["distance_error_pct"], "summary": ex["summary"], "reasons": ex["reasons"],
                 "caveats": ex["caveats"],
                 "details": [d for d in details(f, target_m) if d["label"] not in DROP_DETAIL_LABELS],
                 "coords": r["coords"],
                 "edges": [[k, round(float(x), 1)] for k, x in zip(keys, cg.ea["length"][r["eids"]])],
                 "features": {k: v for k, v in f.items() if k not in DROP_FEATURE_KEYS},
                 "score": r[f"{mode}_score"]["score"], "score_terms": r[f"{mode}_score"]["terms"],
                 "candidate_id": r["candidate_id"]}
        if not loop:   # 새 모양만: LOOP 경로는 예전 필드 그대로
            route["shape_notes"] = ex["notes"]
        if req.shape == "out_and_back":   # 회문 경로: 가운데 좌표가 반환점
            route["turnaround"] = r["coords"][(len(r["coords"]) - 1) // 2]
        routes.append(route)
    c = out["counts"]
    if loop:
        s = out["canonical"]["start"]
        start = {"lat": req.lat, "lon": req.lon, "node_lat": s["node_lat"], "node_lon": s["node_lon"],
                 "snap_m": s["snap_node_dist_m"]}
    else:   # 모든 경로가 snap된 같은 출발 node에서 시작한다
        start = {"lat": req.lat, "lon": req.lon, "node_lat": ranked[0]["coords"][0][0],
                 "node_lon": ranked[0]["coords"][0][1], "snap_m": info["start"]["snap_node_dist_m"]}
    res = {"ok": True, "seed": req.seed, "next_seed": next_seed(req.seed), "target_m": target_m,
           "filters": filters, "mode": mode, "start": start,
           "generation": {"attempts": c["attempts"] if loop else out["request"]["attempts"],
                          "generated": c["generated"], "distinct": c["distinct"] if loop else None,
                          "candidates": c["loop_valid"], "seconds": round(time.perf_counter() - t0, 1),
                          "preference_bias": out["request"].get("generation_bias") is not None},
           "routes": routes, "notices": _notices(out, filters, routes)}
    if not dbg:   # 운영 응답: BE 계약의 최소 필드만
        return {"routes": [{k: r[k] for k in SLIM_ROUTE_KEYS} for r in routes], "notices": res["notices"],
                "next_seed": res["next_seed"]}
    res["debug"] = debug
    if not loop:   # LOOP 응답은 예전 필드 그대로
        res["shape"] = req.shape
    if req.shape == "point_to_point":   # 모든 경로가 snap된 같은 도착 node에서 끝난다
        res["end"] = {"lat": req.end_lat, "lon": req.end_lon, "node_lat": ranked[0]["coords"][-1][0],
                      "node_lon": ranked[0]["coords"][-1][1], "snap_m": info["end"]["snap_m"]}
        res["return_trip"] = {"straight_m": round(info["return_straight_m"]),
                              "runnable_m": round(info["return_runnable_m"])}
    return res


def _served(out: dict, loop: bool) -> list:
    """이 out으로 응답하면 사용자가 보는 TOP3(오류 응답이면 빈 목록). recommend_core의 오류 판단과 같아야 한다.
    재추천 cache에 넣는 값과 miss 때 다시 계산하는 값이 둘 다 이 함수에서 나오므로 hit/miss 결과가 같다."""
    codes = {i["code"] for i in out["issues"]}
    if "OUTSIDE_CANONICAL_EXTRACT" in codes:
        return []
    info = out.get("shape") or {}
    # _respond와 같은 판단(441 R8: 실제 출발 node까지 거리)
    snap_m = start_distance_m(out["canonical"]["start"] if loop else (info.get("start") or {"snap_node_dist_m": 0}))
    if (snap_m > MAX_SNAP_M or "DESTINATION_TOO_FAR" in codes or codes & SHAPE_FAIL.keys()
            or "FORBIDDEN_EDGE_USED" in codes):
        return []
    return (out["preference"] if out["preference"] is not None else out["baseline"])[:TOP_K]


def _run_excluding(p, req: RecommendRequest, seed: int, target_m: int, prefs: Preferences, shape_kw: dict, shown: list):
    """이전 TOP3(shown)를 빼고 계산한다. 모두 제외되면 빈 결과를 유지하고 all_excluded로 표시한다.
    뺄 코스가 없으면(이전 응답이 오류였거나 depth 0) 첫 요청과 같은 호출이다."""
    if not shown:
        return p.run(req.lat, req.lon, target_m, seed=seed, attempts=ATTEMPTS, prefs=prefs, **shape_kw)
    out = p.run(req.lat, req.lon, target_m, seed=seed, attempts=ATTEMPTS, prefs=prefs, shown=shown, **shape_kw)
    rr = out.get("reroll")
    if rr and rr["excluded"] and not (out["preference"] if out["preference"] is not None else out["baseline"]):
        out["reroll"] = {**rr, "all_excluded": True}
    return out


def _lookback(p, cache, cond: tuple, req: RecommendRequest, target_m: int, prefs: Preferences, shape_kw: dict,
              depth: int):
    """seed s 요청이 뺄 이전 TOP3 edge 배열들 = (s-24, depth-1)과 (s-48, depth-2) 응답의 TOP3. cache miss면 같은 규칙으로
    다시 계산한다(그 묶음의 이전 묶음도 재귀로, 이 요청 안에서는 memo). 다시 계산한 값은 cache에 넣지 않는다."""
    memo, st = {}, {"hits": 0, "misses": 0, "recomputed_runs": 0}

    def prior(seed: int, d: int) -> list:
        return [a for j in range(1, d + 1) for a in batch(seed - j * ATTEMPTS, d - j)]

    def batch(seed: int, d: int) -> tuple:
        if (seed, d) in memo:
            return memo[seed, d]
        v = cache.get((cond, seed, d))
        if v is None:
            st["misses"] += 1
            v = reroll.pack(_served(_run_excluding(p, req, seed, target_m, prefs, shape_kw, prior(seed, d)),
                                    req.shape == "loop"))
            st["recomputed_runs"] += 1
        else:
            st["hits"] += 1
        memo[seed, d] = v
        return v

    return prior(req.seed, depth), st


def _notices(out: dict, filters: dict, routes: list) -> list:
    """pipeline issue와 결과에서 만든 사용자 안내 문장(개발 용어 없음)."""
    notes = []
    shape = out.get("shape") or {}   # 새 모양만 있다. LOOP는 canonical의 start를 읽는다
    start = (out.get("canonical") or {}).get("start") or shape.get("start") or {}
    if start.get("snap_node_dist_m", 0) > 60:
        notes.append(f"고른 위치에서 가장 가까운 달릴 수 있는 길까지 {round(start['snap_node_dist_m'])} m 떨어져 있어서, 그 길에서 출발해요.")
    if start.get("shift_to_main_m"):
        notes.append(f"고른 위치 바로 옆 길은 주변 길과 이어지지 않아서, {round(start['shift_to_main_m'])} m 떨어진 연결된 길에서 출발해요.")
    end = shape.get("end") or {}
    if (end.get("snap_m") or 0) > 60:
        notes.append(f"도착 위치에서 가장 가까운 달릴 수 있는 길까지 {round(end['snap_m'])} m 떨어져 있어서, 그 길에서 끝나요.")
    codes = {i["code"] for i in out["issues"]}
    if "ENV_LAYER_PARTIAL" in codes or "ENV_LAYER_FALLBACK" in codes:
        notes.append("이 주변은 강·바다·공원 정보가 일부만 있어서, 환경 조건 판단이 덜 정확할 수 있어요.")
    # env layer 밖의 새 모양: explain_shape가 경로별로 "판단 못 함"을 말하므로 여기서 "거의 없어요"를 쓰지 않는다
    env_judged = not shape or all(_env_covered(r["features"]) >= 1.0 for r in routes)
    for k in ENV_FILTERS:
        if k in SHAPE_ENV_KEYS and not env_judged:
            continue
        if filters.get(k) and routes and all((r["features"].get(FEATURE_OF[k]) or 0) < 0.05 for r in routes):
            notes.append(f"이 주변에는 {FILTER_LABEL[k]} 구간이 거의 없어요. 나머지 조건으로 추천했어요.")
    if 0 < len(routes) < TOP_K:
        notes.append(f"조건에 맞는 서로 다른 코스를 {len(routes)}개만 찾았어요. 거리나 출발 위치를 바꾸면 더 나올 수 있어요.")
    return notes


def _straight_m(req: RecommendRequest) -> float:
    """출발-도착 직선거리(UTM m; pipeline이 straight_m로 기록하는 값과 같은 계산)."""
    (sx, sy), (ex, ey) = to_utm(req.lon, req.lat), to_utm(req.end_lon, req.end_lat)
    return math.hypot(ex - sx, ey - sy)


def _p2p_out_of_range_m(p) -> float:
    """17 km 사전 거절: 출발·도착이 각각 최대 250 m 옮겨져 snap되므로, 직선거리가 1.1 x 15 km + 2 x 250 m = 17.0 km를
    넘으면 어떤 snap 결과로도 15 km 코스를 만들 수 없다. 이때는 graph를 만들기 전에 "앱 범위 밖"으로 답한다.
    이 검사가 없으면 8.5 km app-max disk가 먼 쪽 끝을 담지 못해 엉뚱한 "근처에 길이 없음" 오류가 난다."""
    c = p.shape_cfg
    return (1 + c["tolerance"]["value"]) * c["app_km"]["max"] * 1000 + 2 * c["snap_max_m"]["value"]


def _env_covered(f: dict) -> float:
    v = f.get("env_layer_covered_ratio")
    return 1.0 if v is None else v   # explain.explain_shape와 같은 해석


def _shape_debug(req: RecommendRequest, out: dict, prefs: Preferences) -> dict:
    """새 모양의 debug: 허용한 필드만(후보 pool·좌표·Gate 결과 없음)."""
    info = out["shape"]
    return {"seed": req.seed, "attempts": ATTEMPTS, "shape": req.shape, "counts": out["counts"], "graph": out["graph"],
            "issues": [{k: i.get(k) for k in ("code", "message", "blocking")} for i in out["issues"]],
            "generation_bias": out["request"].get("generation_bias"), "preferences": prefs.__dict__,
            "shape_info": {k: info.get(k) for k in ("start_node", "end_node", "straight_m", "d_min_m", "d_min_disk",
                                                    "rule", "d_min_equal_on_generation_disk")}}


def _jsonable(o):
    return o.item() if hasattr(o, "item") else str(o)   # numpy scalar -> Python 숫자


def _log_usability(settings: Settings, req: RecommendRequest, out: dict, gate_files: dict | None = None) -> None:
    """서버 쪽 검토 로그(응답에는 넣지 않음): 요청마다 Gate 결과 JSON 한 줄(REVIEW 구간, FAIL 제거, incident).
    p.lock 안에서 실행한다. 쓰기 실패는 응답을 막지 않는다.
    gate_files_sha256 = Gate 규칙 파일(ug-v1.json, ug-v2.json, usability_gate.py)의 sha256(gate.Gate.files). gate_version에는
    usability_gate.py 해시가 없어서 로그만으로 규칙 코드를 확인할 수 있게 함께 남긴다(R10, 데모 로그에는 없던 key)."""
    u = out.get("usability")
    if u is None:
        return
    active = out["preference"] if out["preference"] is not None else out["baseline"]
    rec = {"ts": datetime.now().isoformat(timespec="seconds"), "request": req.model_dump(),
           "gate_version": u.get("gate_version"), "gate_files_sha256": gate_files, "mode": u.get("mode"),
           "request_type": u.get("request_type"),
           "skipped": u.get("skipped"), "counts": u.get("counts"), "removed": u.get("removed", []),
           "stage_b_removed": u.get("stage_b_removed", []),
           "top3": [r["candidate_id"] for r in (active or [])[:TOP_K]],
           "review_queue": u.get("review_queue", []), "incidents": u.get("incidents", [])}
    try:
        settings.usability_log_dir.mkdir(parents=True, exist_ok=True)
        with open(settings.usability_log_dir / f"usability_gate_{rec['ts'][:10]}.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False, default=_jsonable) + "\n")
    except OSError as exc:
        log_ai_error("USABILITY_LOG_WRITE_FAILED", RECOMMEND, exc, level=logging.WARNING)


app = create_app()

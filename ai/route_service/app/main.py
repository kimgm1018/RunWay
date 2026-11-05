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
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from runway_routing.data import REGIONS
from runway_routing.explain import ENV_KEYS as SHAPE_ENV_KEYS, FILTER_LABEL, details, explain, explain_shape
from runway_routing.features import ELEVATION_KEYS
from runway_routing.scorer import Preferences
from runway_routing.snap import to_utm

from .ai_logging import log_ai_error
from .config import Settings, load_settings
from .errors import SHAPE_FAIL, fail
from .schemas import Filters, RecommendRequest

log = logging.getLogger("runway.ai")

ATTEMPTS = 24            # seed 하나당 후보 시도 수; "다른 코스 추천" -> next_seed = seed + ATTEMPTS
TOP_K = 3
MIN_KM, MAX_KM = 1.0, 15.0
MAX_SNAP_M = 250         # = canonical의 start_far_from_network 경고 거리
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

    def start(self) -> None:
        try:
            t0 = time.perf_counter()
            self.pipeline = self.factory(self.settings)
            self.load_s = round(time.perf_counter() - t0, 1)
            log.info("Route 엔진 로드 %.1f초", self.load_s)
        except Exception as exc:
            self.phase, self.error = "failed", f"{type(exc).__name__}: {exc}"
            log_ai_error("ROUTE_ENGINE_LOAD_FAILED", "startup", exc)
            return
        if self.settings.warmup:
            self.phase = "warming"
            t0 = time.perf_counter()
            try:
                res = recommend_core(self, warmup_request(), gate_log=False, lock_wait_s=None)
                if getattr(res, "status_code", 200) >= 500:
                    raise RuntimeError(f"warm-up HTTP {res.status_code}")
            except Exception as exc:
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

    @app.get("/health/live")
    def live():
        return {"status": "UP"}

    @app.get(READY)
    def ready():
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


def _expired(deadline_ms: int | None) -> bool:
    return deadline_ms is not None and time.time() * 1000 >= deadline_ms


def recommend_core(engine: Engine, req: RecommendRequest, gate_log: bool = True,
                   lock_wait_s: float | None = LOCK_WAIT_S, deadline_ms: int | None = None):
    """데모 /api/recommend와 같은 판단 순서. 반환: 성공 dict 또는 JSONResponse(오류).
    lock_wait_s=None은 끝까지 기다린다(시작 시 예열만 쓴다)."""
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
    try:
        if _expired(deadline_ms):   # 슬롯을 기다리는 동안 지났으면 계산하지 않는다
            return _fail("TIMEOUT")
        out = p.run(req.lat, req.lon, target_m, seed=req.seed, attempts=ATTEMPTS, prefs=prefs, **shape_kw)
        if loop:
            cg = p.graph(req.lat, req.lon, target_m) if out["canonical"] is not None else None
        else:
            centre = out["shape"].get("graph_centre")   # OAB: 출발점, P2P: snap된 두 끝의 중점
            cg = p.graph(centre["lat"], centre["lon"], target_m) if centre else None
        if gate_log:
            _log_usability(settings, req, out)
    except Exception as exc:
        if type(exc).__name__ == "InsufficientResponseError":  # osmnx: 작업 disk 안에 길이 전혀 없음
            return _fail("NO_ROAD_NEARBY", debug=f"{type(exc).__name__}: {exc}")
        log_ai_error("INTERNAL", RECOMMEND, exc)
        return _fail("INTERNAL", debug=f"{type(exc).__name__}: {exc}")
    finally:
        p.lock.release()
    codes = {i["code"] for i in out["issues"]}
    info = out.get("shape") or {}
    if loop:
        debug = {"seed": req.seed, "attempts": ATTEMPTS, "counts": out["counts"], "graph": out["graph"],
                 "issues": out["issues"], "generation_bias": out["request"].get("generation_bias"),
                 "canonical_timings_s": (out.get("canonical") or {}).get("timings_s"),
                 "running_suitability": out.get("running_suitability"), "preferences": prefs.__dict__}
    else:
        debug = _shape_debug(req, out, prefs)
    if "OUTSIDE_CANONICAL_EXTRACT" in codes:
        return _fail("OUT_OF_AREA", debug=debug)
    snap_m = out["canonical"]["start"]["snap_node_dist_m"] if loop else (info.get("start") or {}).get("snap_node_dist_m", 0)
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
    ranked = (out["preference"] if out["preference"] is not None else out["baseline"])[:TOP_K]
    if not ranked:
        if "USABILITY_GATE_ALL_FAILED" in codes:
            return _fail("USABILITY_GATE_ALL_FAILED", debug=debug)
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
    res = {"ok": True, "seed": req.seed, "next_seed": req.seed + ATTEMPTS, "target_m": target_m,
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


def _log_usability(settings: Settings, req: RecommendRequest, out: dict) -> None:
    """서버 쪽 검토 로그(응답에는 넣지 않음): 요청마다 Gate 결과 JSON 한 줄(REVIEW 구간, FAIL 제거, incident).
    p.lock 안에서 실행한다. 쓰기 실패는 응답을 막지 않는다."""
    u = out.get("usability")
    if u is None:
        return
    active = out["preference"] if out["preference"] is not None else out["baseline"]
    rec = {"ts": datetime.now().isoformat(timespec="seconds"), "request": req.model_dump(),
           "gate_version": u.get("gate_version"), "mode": u.get("mode"), "request_type": u.get("request_type"),
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

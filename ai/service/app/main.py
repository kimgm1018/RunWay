"""RunWay AI 추론 서버 (FastAPI). 백엔드 서버만 부르는 내부 API다.

실행: uvicorn app.main:app --host 0.0.0.0 --port 8000   (ai/service/에서)
"""
import logging
import math
import os
import re
import sys
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import anyio
import numpy as np
from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import SERVICE_DIR, load_settings
from app.ai_logging import log_ai_error
from app.models import HRModel, load_model
from app.inference import (ApiError, check_sufficient, error_body, free_run_warnings, future_grade_used,
                           load_free_run_grade_policy, to_batch)
from app.schemas import ErrorResponse, HealthResponse, ModelInfoResponse, PredictRequest, PredictResponse, Prediction
from app.decide.loader import load_policy
from app.decide.policy_port import PacePolicy
from app.decide.schemas import DecideRequest, DecideResponse
from app.decide.service import run_decide
from app.demo.auth import require_bearer
from app.demo.config import DemoSettings, load_demo_settings
from app.demo.recorder import new_demo_state, record_trace
from app.demo.stream import build_stream_router
from app.demo.inlet import build_inlet_router
from app.models.ode.runtime import DEFAULT_VALIDATED_HORIZON_SEC, load_ode_runtime
from app.ode_schemas import PersonalizeRequest, PlanRequest
from app.personalization import compute_personalization
from app.planner import prerun_planner as planner_v1
from app.personal_plan import (OdeBalancedPaceOptimizer, PersonalPlanRequest, PersonalPlanResponse,
                               build_personal_plan, personal_plan_enabled)
from app.population_bundle import load_population_bundle, load_population_mode
from app.db_lookup import (DbCourseLookup, DbUserPersonalizationLookup, ElevationProfileStoredGradeSource,
                            default_db_factory)
from app.runner_baseline import DbRunnerProfileLookup, load_blend_k
from app.gru_personalization import (CachedDbGruPersonalizationLookup, GRU_PERSONALIZATION_SCHEMA_VERSION,
                                    UNAVAILABLE_WARNING, compute_gru_personalization,
                                    lookup_user_personalization)
from app.hr_threshold_lookup import CachedDbHrThresholdLookup
from app.policy.hr_reference import personal_hr_thresholds
from app.bpm_cue import CueBpmCalculator, UnavailableCueBpm
from app.bpm_lookup import CachedDbBpmLookup, UnavailableBpmLookup


log = logging.getLogger("runway.ai")


# 무거운 요청 대기열은 두 줄이다. 개인화(AI06, 약 25초)가 앞에 있어도 계획(AI05·AI09)이 기다리지 않게 나눈다.
#   plan        : AI05 /v1/pace/plan, AI09 /v1/pace/personal-plan  → HEAVY_MAX_CONCURRENCY(기본 1)
#   personalize : AI06 /v1/hr/personalize                           → HEAVY_PERSONALIZE_MAX_CONCURRENCY(기본 1)
# 대기 한도(HEAVY_QUEUE_WAIT_SEC)와 넘으면 503 AI_BUSY + Retry-After는 두 줄 모두 같다.
_HEAVY_POOLS = {
    "plan": ("heavy_limiter", "heavy_max_concurrency"),
    "personalize": ("heavy_personalize_limiter", "heavy_personalize_max_concurrency"),
}


async def _run_heavy(request: Request, endpoint: str, operation: Callable[[], object], *, pool: str = "plan"):
    started = time.perf_counter()
    limiter_attr, concurrency_attr = _HEAVY_POOLS[pool]
    limiter = getattr(request.app.state, limiter_attr, None)
    if limiter is None:
        limiter = anyio.CapacityLimiter(getattr(request.app.state, concurrency_attr))
        setattr(request.app.state, limiter_attr, limiter)
    try:
        with anyio.fail_after(request.app.state.heavy_queue_wait_sec):
            await limiter.acquire()
    except TimeoutError as exc:
        waited_ms = max(0, round((time.perf_counter() - started) * 1000))
        request.state.queue_wait_ms = waited_ms
        retry_after = max(1, math.ceil(request.app.state.heavy_queue_wait_sec))
        log_ai_error("AI_BUSY", endpoint, exc, level=logging.WARNING)
        raise ApiError(503, "AI_BUSY", "요청이 몰려 처리 중입니다. 잠시 후 다시 시도해 주세요.",
                       headers={"Retry-After": str(retry_after)}) from None

    request.state.queue_wait_ms = max(0, round((time.perf_counter() - started) * 1000))
    try:
        return await anyio.to_thread.run_sync(operation)
    finally:
        limiter.release()


DEADLINE_HEADER = "X-Request-Deadline"


def _parse_request_deadline(request: Request) -> int | None:
    """선택 헤더 X-Request-Deadline을 epoch milliseconds 정수로 읽는다(Route 연동과 같은 형식)."""
    value = request.headers.get(DEADLINE_HEADER)
    if value is None:
        return None
    if re.fullmatch(r"[+-]?[0-9]{1,19}", value.strip()) is None:
        raise ApiError(400, "VALIDATION_ERROR", "요청 값이 유효하지 않습니다.",
                       [{"name": DEADLINE_HEADER, "reason": "epoch milliseconds 정수 문자열이어야 합니다."}])
    return int(value.strip())


def _raise_if_deadline_exceeded(request: Request, deadline_ms: int | None, endpoint: str) -> None:
    """마감이 지났으면 계산하지 않고 503 DEADLINE_EXCEEDED. 이미 시작한 계산은 중단하지 않는다."""
    if deadline_ms is None:
        return
    now_ms = int(request.app.state.clock().timestamp() * 1000)
    if deadline_ms <= now_ms:
        log_ai_error("DEADLINE_EXCEEDED", endpoint, Warning(), level=logging.WARNING)
        raise ApiError(503, "DEADLINE_EXCEEDED", "요청 마감 시각이 지나 계산을 시작하지 않았습니다.",
                       [{"name": DEADLINE_HEADER, "reason": "계산 시작 전에 마감 시각이 지났습니다."}])


def default_loader() -> HRModel:
    return load_model(load_settings())


def default_policy_loader() -> PacePolicy | None:
    return load_policy(load_settings())


def default_ode_loader():
    return load_ode_runtime()


def _enabled(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


def _positive_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _nonnegative_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _nonnegative_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
        return value if math.isfinite(value) and value >= 0 else default
    except (TypeError, ValueError):
        return default


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def create_app(loader: Callable[[], HRModel] = default_loader,
               policy_loader: Callable[[], PacePolicy | None] = default_policy_loader,
               clock: Callable[[], datetime] = utc_now,
               demo_loader: Callable[[], DemoSettings] = load_demo_settings,
               demo_rate_per_sec: int = 2,
               ode_loader: Callable[[], object | None] = default_ode_loader,
               personal_plan_course_lookup=None,
               personal_plan_user_lookup=None,
               personal_plan_optimizer=None,
               personal_plan_population_lookup=None,
               gru_personalization_lookup=None,
               db_factory: Callable[[str], object] = default_db_factory,
               hr_threshold_lookup=None,
               runner_profile_lookup=None,
               cue_bpm_loader: Callable[[], object] | None = CueBpmCalculator, bpm_lookup=None) -> FastAPI:
    try:
        free_run_grade_policy = load_free_run_grade_policy()   # 잘못된 값이면 시작 시 실패
    except Exception as exc:
        log_ai_error("FREE_RUN_POLICY_LOAD_FAILED", "startup", exc)
        raise
    # 신규 사용자 평균 묶음: 모드가 off가 아니고 경로가 있으면 시작 시 sha256·형식 검사(다르면 시작 실패).
    try:
        population_mode = load_population_mode()
    except Exception as exc:
        log_ai_error("POPULATION_MODE_LOAD_FAILED", "startup", exc)
        raise
    # S15P31E105-403 혼합 강도 k(env). 잘못된 값이면 시작 시 실패한다.
    try:
        runner_blend_k = load_blend_k()
    except Exception as exc:
        log_ai_error("RUNNER_BASELINE_K_LOAD_FAILED", "startup", exc)
        raise
    population_bundle = None
    bundle_path =os.getenv("ODEV21_POPULATION_BUNDLE_PATH", "").strip()
    if population_mode != "off" and bundle_path:
        try:
            population_bundle = load_population_bundle(bundle_path, os.getenv("ODEV21_POPULATION_BUNDLE_SHA256", ""))
        except Exception as exc:
            log_ai_error("POPULATION_BUNDLE_LOAD_FAILED", "startup", exc)
            raise
    ai_db = None
    db_url = os.getenv("AI_DB_URL", "").strip()
    # health components.aiDb: 설정 여부와 시작 시 조회기 초기화 실패만 알린다(실제 DB probe 없음, URL 비노출).
    ai_db_status = "CONFIGURED" if db_url else "NOT_CONFIGURED"
    needs_personal_plan_db = (personal_plan_course_lookup is None and personal_plan_user_lookup is None)
    needs_gru_personalization_db = gru_personalization_lookup is None
    needs_hr_threshold_db = hr_threshold_lookup is None
    needs_runner_profile_db = runner_profile_lookup is None
    needs_bpm_db = bpm_lookup is None
    if db_url and (needs_personal_plan_db or needs_gru_personalization_db or needs_hr_threshold_db
                   or needs_runner_profile_db or needs_bpm_db):
        # 읽기 전용 팀 DB 조회. URL·비밀번호는 로그에 남기지 않는다.
        try:
            ai_db = db_factory(db_url)
            if needs_personal_plan_db:
                personal_plan_course_lookup = DbCourseLookup(
                    ai_db, stored_grade_source=ElevationProfileStoredGradeSource())
                personal_plan_user_lookup = DbUserPersonalizationLookup(ai_db)
                personal_plan_optimizer = personal_plan_optimizer or OdeBalancedPaceOptimizer()
            if needs_gru_personalization_db:
                gru_personalization_lookup = CachedDbGruPersonalizationLookup(
                    ai_db,
                    ttl_sec=_nonnegative_float("GRU_PERSONALIZATION_CACHE_TTL_SEC", 300),
                    empty_ttl_sec=_nonnegative_float("GRU_PERSONALIZATION_EMPTY_CACHE_TTL_SEC", 60),
                    max_users=_nonnegative_int("GRU_PERSONALIZATION_CACHE_MAX_USERS", 1024),
                    timeout_ms=_positive_int("GRU_PERSONALIZATION_DB_TIMEOUT_MS", 300),
                )
            if needs_hr_threshold_db:
                hr_threshold_lookup = CachedDbHrThresholdLookup(ai_db)
            if needs_runner_profile_db:
                # S15P31E105-403: AI09 신규 사용자 첫 계획 기준(user_profiles, 읽기 전용).
                runner_profile_lookup = DbRunnerProfileLookup(ai_db)
            if needs_bpm_db:
                # S15P31E105-438: AI04 목표 BPM 개인 기록(측정값·BPM 변경 기록, 읽기 전용).
                bpm_lookup = CachedDbBpmLookup(ai_db)
        except Exception as exc:
            log_ai_error("AI_DB_UNAVAILABLE", "startup", exc, level=logging.WARNING)
            ai_db = None
            ai_db_status = "CONNECT_FAILED"
    if db_url and bpm_lookup is None:
        bpm_lookup = UnavailableBpmLookup()   # DB를 켰는데 연결 실패: 평균 BPM + BPM_RECORDS_UNAVAILABLE
    # v6_8_1: "설정상 꺼짐/없음"과 "켰는데 DB 연결·조회 실패"를 구분한다.
    #   - GRU 개인화 꺼짐: userId가 와도 조회·응답 경고·호출별 로그 없이 기본 GRU를 쓴다(시작 로그 한 번).
    #   - 학습 심박 기준: AI_DB_URL이 없고 주입된 조회기도 없으면 조용히 모집단 기준을 쓴다(시작 로그 한 번).
    #     AI_DB_URL이 있는데 시작 연결이 실패했거나 조회가 실패하면 지금처럼 HR_THRESHOLD_LOOKUP_UNAVAILABLE.
    gru_personalization_requested = _enabled("GRU_PERSONALIZATION_ENABLED", False)
    hr_threshold_lookup_configured = hr_threshold_lookup is not None or bool(db_url)
    if not gru_personalization_requested:
        log.info("GRU 개인화 꺼짐(GRU_PERSONALIZATION_ENABLED=false): userId가 와도 기본 GRU로 예측한다")
    if not hr_threshold_lookup_configured:
        log.info("AI_DB_URL이 없어 학습 심박 기준을 조회하지 않고 모집단 기준을 쓴다")
    # 목표 BPM(ai/bpm). 못 불러와도 서비스는 켜고, 응답마다 cueBpm=null + CUE_BPM_UNAVAILABLE을 붙인다.
    cue_bpm_calc = None
    if cue_bpm_loader is not None:
        try:
            cue_bpm_calc = cue_bpm_loader()
        except Exception as exc:
            log_ai_error("CUE_BPM_LOAD_FAILED", "startup", exc, level=logging.WARNING)
            cue_bpm_calc = UnavailableCueBpm()

    demo_settings = demo_loader()
    demo_state = (new_demo_state(demo_settings, rate_per_sec=demo_rate_per_sec, now=clock)
                  if demo_settings.enabled else None)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.model = None
        app.state.policy = None
        app.state.ode_model = None
        app.state.heavy_limiter = anyio.CapacityLimiter(app.state.heavy_max_concurrency)
        app.state.heavy_personalize_limiter = anyio.CapacityLimiter(app.state.heavy_personalize_max_concurrency)
        app.state.clock = clock
        app.state.demo = demo_state
        try:
            t = time.perf_counter()
            app.state.model = loader()
            log.info("모델 로드: %s (%.1f초)", app.state.model.info.model_version, time.perf_counter() - t)
        except Exception as exc:
            log_ai_error("GRU_MODEL_LOAD_FAILED", "startup", exc)
        try:
            app.state.policy = policy_loader()
        except Exception as exc:
            log_ai_error("POLICY_LOAD_FAILED", "startup", exc, level=logging.WARNING)
        try:
            app.state.ode_model = ode_loader()
            if app.state.ode_model is not None:
                log.info("ODE 모델 준비: %s", app.state.ode_model.info.model_version)
                if _enabled("ODEV21_WARMUP_ENABLED", True):
                    warmup = getattr(app.state.ode_model, "warmup_adam", None)
                    if callable(warmup):
                        warmup_started = time.perf_counter()
                        try:
                            warmup()
                        except Exception as exc:
                            log_ai_error("ODE_ADAM_WARMUP_FAILED", "startup", exc,
                                         level=logging.WARNING)
                        else:
                            log.info("ODE Adam 예열 완료 duration_ms=%.1f",
                                     (time.perf_counter() - warmup_started) * 1000.0)
            else:
                log.info("ODE 모델 파일이 없어 ODE 예측 기능은 준비되지 않음")
        except Exception as exc:
            log_ai_error("ODE_MODEL_LOAD_FAILED", "startup", exc, level=logging.WARNING)
        if (population_bundle is not None and app.state.ode_model is not None
                and population_bundle.model_version != app.state.ode_model.info.model_version):
            log_ai_error("POPULATION_BUNDLE_VERSION_MISMATCH", "startup", ValueError())
            raise RuntimeError("평균 묶음 modelVersion이 ODE runtime과 다릅니다: "
                               f"{population_bundle.model_version} != {app.state.ode_model.info.model_version}")
        yield
        if ai_db is not None and hasattr(ai_db, "close"):
            ai_db.close()

    app = FastAPI(title="RunWay AI Inference", version="0.1.0", lifespan=lifespan,
                  description="백엔드 서버 전용 내부 API. HR 예측 모델 추론 결과를 반환한다.")
    app.state.heavy_max_concurrency = _positive_int("HEAVY_MAX_CONCURRENCY", 1)
    app.state.heavy_personalize_max_concurrency = _positive_int("HEAVY_PERSONALIZE_MAX_CONCURRENCY", 1)
    app.state.heavy_queue_wait_sec = _nonnegative_float("HEAVY_QUEUE_WAIT_SEC", 30.0)
    app.state.free_run_grade_policy = free_run_grade_policy
    app.state.personal_plan_course_lookup = personal_plan_course_lookup
    app.state.personal_plan_user_lookup = personal_plan_user_lookup
    app.state.personal_plan_optimizer = personal_plan_optimizer
    app.state.personal_plan_population_lookup = personal_plan_population_lookup
    app.state.gru_personalization_lookup = gru_personalization_lookup
    app.state.hr_threshold_lookup = hr_threshold_lookup
    app.state.runner_profile_lookup = runner_profile_lookup
    app.state.runner_blend_k = runner_blend_k
    app.state.hr_threshold_lookup_configured = hr_threshold_lookup_configured
    app.state.cue_bpm_calc = cue_bpm_calc
    app.state.ai_db_status = ai_db_status
    app.state.bpm_lookup = bpm_lookup
    # requested = 설정 스위치만, enabled = 스위치와 AI_DB_URL이 모두 있음(조회기를 넘길 수 있음).
    app.state.gru_personalization_requested = gru_personalization_requested
    app.state.gru_personalization_enabled = gru_personalization_requested and bool(db_url)
    app.state.population_bundle = population_bundle
    app.state.population_mode = population_mode

    @app.exception_handler(ApiError)
    async def api_error(request: Request, e: ApiError):
        if e.status >= 500 and request.url.path in {"/v1/hr/predict", "/v1/pace/decide"}:
            cause = e.__cause__ or e.__context__ or e
            log_ai_error(e.code, request.url.path, cause)
            request.state.ai_500_logged = True
        return JSONResponse(status_code=e.status, content=error_body(e.code, e.message, e.fields), headers=e.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        fields = [{"name": ".".join(str(p) for p in err["loc"][1:]) or "body",
                   "reason": err["msg"].removeprefix("Value error, ")} for err in e.errors()]
        return JSONResponse(status_code=400, content=error_body("VALIDATION_ERROR", "요청 값이 유효하지 않습니다.", fields))

    @app.middleware("http")
    async def observe_response(request: Request, call_next):
        try:
            response = await call_next(request)
        except Exception as exc:
            if request.url.path in {"/v1/hr/predict", "/v1/pace/decide"}:
                code = "PREDICTION_FAILED" if request.url.path == "/v1/hr/predict" else "DECISION_FAILED"
                log_ai_error(code, request.url.path, exc)
            raise
        if (response.status_code >= 500
                and request.url.path in {"/v1/hr/predict", "/v1/pace/decide"}
                and not getattr(request.state, "ai_500_logged", False)):
            code = "PREDICTION_FAILED" if request.url.path == "/v1/hr/predict" else "DECISION_FAILED"
            log_ai_error(code, request.url.path, "InternalServerError")
            request.state.ai_500_logged = True
        waited_ms = getattr(request.state, "queue_wait_ms", None)
        if waited_ms is not None:
            response.headers["X-RunWay-Queue-Wait-Ms"] = str(waited_ms)
        return response

    def get_model(request: Request) -> HRModel:
        model = request.app.state.model
        if model is None:
            raise ApiError(503, "MODEL_NOT_READY", "모델이 로드되지 않았습니다.")
        return model

    @app.get("/health", response_model=HealthResponse, tags=["AI01"], summary="AI01 준비 상태",
             responses={503: {"model": HealthResponse}})
    def health(request: Request):
        model = request.app.state.model
        ode = request.app.state.ode_model
        models = {
            "gru": {"status": "UP" if model is not None else "DOWN",
                    "modelVersion": model.info.model_version if model is not None else None},
            "ode": {"status": "UP" if ode is not None else "DOWN",
                    "modelVersion": ode.info.model_version if ode is not None else None},
        }
        cue_bpm = request.app.state.cue_bpm_calc
        if cue_bpm is None:
            cue_bpm_status = "DISABLED"
        elif isinstance(cue_bpm, UnavailableCueBpm):
            cue_bpm_status = "DOWN"
        else:
            cue_bpm_status = "UP"
        # 진단 전용. status·modelLoaded·HTTP 200/503 판정에는 쓰지 않는다.
        components = {
            "gru": models["gru"]["status"],
            "ode": models["ode"]["status"],
            "aiDb": request.app.state.ai_db_status,
            "personalPlan": {
                "enabled": personal_plan_enabled(),
                "populationMode": request.app.state.population_mode,
                "populationBundleLoaded": request.app.state.population_bundle is not None,
            },
            "cueBpm": cue_bpm_status,
        }
        if model is None:
            return JSONResponse(status_code=503, content=HealthResponse(
                status="DOWN", model_loaded=False, models=models, components=components).model_dump(by_alias=True))
        return HealthResponse(status="UP", model_loaded=True, model_version=model.info.model_version,
                              models=models, components=components)

    @app.get("/v1/model-info", response_model=ModelInfoResponse, tags=["AI02"], summary="AI02 모델 정보",
             responses={503: {"model": ErrorResponse}})
    def model_info(request: Request):
        model = get_model(request)
        info = model.info
        ode = request.app.state.ode_model
        predictor = getattr(model, "predictor", None)
        personalization_supported = (info.model_type == "gru" and predictor is not None
                                     and {"main", "nograde"}.issubset(getattr(predictor, "models", {})))
        personalization_enabled = (personalization_supported and request.app.state.gru_personalization_enabled
                                   and request.app.state.gru_personalization_lookup is not None)
        models = {
            "gru": {"status": "UP", "modelType": info.model_type, "modelVersion": info.model_version,
                    "windowSec": info.window_sec, "requiredMetrics": list(info.required_metrics),
                    "horizonsSec": list(info.horizons_sec),
                    "personalizationSupported": personalization_supported,
                    "personalizationEnabled": personalization_enabled,
                    "personalizationSchemaVersion": GRU_PERSONALIZATION_SCHEMA_VERSION},
            "ode": ({"status": "UP", "modelType": ode.info.model_type, "modelVersion": ode.info.model_version,
                     "variant": ode.info.variant, "checkpointSha256": ode.info.checkpoint_sha256,
                     "summaryFeatureCount": ode.info.summary_feature_count, "hr0Head": ode.info.hr0_head,
                     "device": ode.info.device, "validatedHorizonSec": ode.info.validated_horizon_sec,
                     "sampleIntervalSec": ode.info.sample_interval_sec,
                     "horizonsSec": list(ode.info.horizons_sec)} if ode is not None else
                    {"status": "NOT_READY", "validatedHorizonSec": int(os.getenv("ODEV21_VALIDATED_HORIZON_SEC", str(DEFAULT_VALIDATED_HORIZON_SEC)))}),
        }
        return ModelInfoResponse(model_type=info.model_type, model_version=info.model_version, window_sec=info.window_sec,
                                 required_metrics=list(info.required_metrics), min_samples=info.min_samples,
                                 missing_policy=info.missing_policy,
                                 policy_version=request.app.state.policy.policy_version if request.app.state.policy else None,
                                 models=models)

    @app.post("/v1/pace/decide", response_model=DecideResponse, tags=["AI04"], summary="AI04 러닝 중 페이스 결정",
              responses={400: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
                         503: {"model": ErrorResponse}, 500: {"model": ErrorResponse}})
    def decide(body: DecideRequest, request: Request):
        model = get_model(request)
        policy = request.app.state.policy
        if policy is None:
            raise ApiError(503, "MODEL_NOT_READY", "정책이 로드되지 않았습니다.")
        received_at = request.app.state.clock()
        outcome = run_decide(body, model, policy, received_at=received_at, now=request.app.state.clock,
                             free_run_grade_policy=request.app.state.free_run_grade_policy,
                             user_personalization_lookup=(request.app.state.gru_personalization_lookup
                                                          if request.app.state.gru_personalization_enabled else None),
                             gru_personalization_enabled=request.app.state.gru_personalization_requested,
                             hr_threshold_lookup=request.app.state.hr_threshold_lookup,
                             hr_threshold_lookup_configured=request.app.state.hr_threshold_lookup_configured, cue_bpm_calc=request.app.state.cue_bpm_calc,
                             bpm_lookup=request.app.state.bpm_lookup)
        demo = request.app.state.demo
        if demo is not None:
            stage, _ = demo.profile_for(body.context.session_id)
            trace_id = record_trace(demo, outcome, stage=stage, replay_speed=None, grade_source="SAMPLE")
            if trace_id is not None and outcome.response is not None:
                outcome.response.trace_id = trace_id
        if outcome.error is not None:
            raise outcome.error
        response = outcome.response
        if body.include_forecast:
            response.forecast = _running_forecast(body, response, request.app.state.ode_model)
        return response.model_dump(by_alias=True, mode="json")

    @app.post("/v1/pace/plan", response_model=dict, tags=["AI05"], summary="AI05 출발 전 페이스 계획 미리보기",
              responses={400: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
                         500: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
    async def plan(body: PlanRequest, request: Request):
        def run_plan():
            payload = body.model_dump(by_alias=True, exclude_none=True)
            personalization = payload.pop("personalization", None)
            support_hr = payload.pop("supportStartHrMedianBpm", None)
            payload.pop("userId", None)
            # AI05는 측정 HR0를 받지 않으며, HR0 없는 예측기를 쓴다.
            ode = request.app.state.ode_model
            predictor = None
            if _enabled("ODE_PREVIEW_ENABLED") and ode is not None:
                predictor = ode.pre_run_predictor(personalization=personalization,
                                                  support_start_hr_median_bpm=support_hr)
            status, result = planner_v1.plan_api(payload, predictor=predictor, config=planner_v1.API_CONFIG)
            if status >= 400:
                return JSONResponse(status_code=status, content=result)
            if _enabled("ODE_PREVIEW_ENABLED") and ode is None and result.get("hrPreview") is not None:
                result.setdefault("warnings", []).append({
                    "code": "ODE_MODEL_NOT_READY",
                    "message": "ODE 모델이 준비되지 않아 HR 미리보기 없이 페이스 계획만 반환했습니다.",
                })
            return result

        return await _run_heavy(request, "/v1/pace/plan", run_plan)

    @app.post("/v1/pace/personal-plan", response_model=PersonalPlanResponse, tags=["AI09"],
              summary="AI09 개인 페이스 계획",
              responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse},
                         422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
    async def personal_plan(body: PersonalPlanRequest, request: Request):
        """개인 계획 요청을 공용 무거운 요청 대기열에서 처리한다.

        X-Request-Deadline(epoch ms, 선택)이 대기열 진입 전이나 슬롯을 얻은 뒤 계산 시작 직전에 지났으면
        계산하지 않고 503 DEADLINE_EXCEEDED. 시작한 계산은 중단하지 않는다.
        """
        deadline_ms = _parse_request_deadline(request)
        _raise_if_deadline_exceeded(request, deadline_ms, "/v1/pace/personal-plan")

        def build_plan():
            _raise_if_deadline_exceeded(request, deadline_ms, "/v1/pace/personal-plan")
            return build_personal_plan(
                body,
                course_lookup=request.app.state.personal_plan_course_lookup,
                personalization_lookup=request.app.state.personal_plan_user_lookup,
                optimizer=request.app.state.personal_plan_optimizer,
                population_lookup=request.app.state.personal_plan_population_lookup,
                ode_runtime=request.app.state.ode_model,
                free_run_grade_policy=request.app.state.free_run_grade_policy,
                population_bundle=request.app.state.population_bundle,
                population_mode=request.app.state.population_mode,
                runner_profile_lookup=request.app.state.runner_profile_lookup,
                runner_blend_k=request.app.state.runner_blend_k,
            )

        return await _run_heavy(request, "/v1/pace/personal-plan", build_plan)

    @app.post("/v1/hr/personalize", response_model=dict, tags=["AI06"], summary="AI06 HR 개인화 계산",
              responses={400: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
                         500: {
                             "description": "예기치 못한 오류. 현재 본문은 detail과 AI06 진단 필드를 포함하며 공통 오류 형식과 다릅니다.",
                             "content": {"application/json": {
                                 "schema": {
                                     "type": "object",
                                     "properties": {
                                         "detail": {"type": "string"},
                                         "gruPersonalization": {"anyOf": [{"type": "object"}, {"type": "null"}]},
                                         "warnings": {"type": "array", "items": {"type": "string"}},
                                         "hrDangerBpm": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                                         "hrSustainBpm": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                                         "hrThresholdRunCount": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                                     },
                                     "required": ["detail", "gruPersonalization", "warnings", "hrDangerBpm",
                                                  "hrSustainBpm", "hrThresholdRunCount"],
                                 },
                             }},
                         },
                         503: {"model": ErrorResponse}})
    async def personalize(body: PersonalizeRequest, request: Request):
        def compute():
            learned_hr = personal_hr_thresholds(body.sessions)
            ode = request.app.state.ode_model
            gru_payload = None
            gru_warnings = []
            if _enabled("GRU_PERSONALIZATION_ENABLED", False):
                try:
                    gru_payload, gru_warnings = compute_gru_personalization(body, request.app.state.model)
                except ApiError:
                    gru_warnings = ["GRU_PERSONALIZATION_INVALID"]
                    log_ai_error("GRU_PERSONALIZATION_INVALID", "/v1/hr/personalize",
                                 Warning(), level=logging.WARNING)
                except Exception as exc:
                    log_ai_error("GRU_PERSONALIZATION_UNAVAILABLE", "/v1/hr/personalize", exc,
                                 level=logging.WARNING)
                    gru_warnings = [UNAVAILABLE_WARNING]
            else:
                gru_warnings = ["GRU_PERSONALIZATION_DISABLED"]
                log_ai_error("GRU_PERSONALIZATION_DISABLED", "/v1/hr/personalize", Warning(),
                             level=logging.WARNING)

            def partial_error(error: ApiError):
                content = error_body(error.code, error.message, error.fields)
                content["gruPersonalization"] = gru_payload
                content["warnings"] = list(gru_warnings)
                content["hrDangerBpm"] = learned_hr.hr_danger_bpm
                content["hrSustainBpm"] = learned_hr.hr_sustain_bpm
                content["hrThresholdRunCount"] = learned_hr.hr_threshold_run_count
                return JSONResponse(status_code=error.status, content=content, headers=error.headers)

            if ode is None:
                return partial_error(ApiError(503, "MODEL_NOT_READY", "ODE 개인화 모델이 준비되지 않았습니다."))
            try:
                result = compute_personalization(body, ode, now=request.app.state.clock())
            except ApiError as error:
                return partial_error(error)
            except Exception as exc:
                # ODE 오류 응답은 유지하고 GRU 계산 결과를 함께 돌려준다.
                log_ai_error("PERSONALIZATION_FAILED", "/v1/hr/personalize", exc,
                             level=logging.WARNING)
                content = {"detail": "Internal Server Error", "gruPersonalization": gru_payload,
                           "warnings": list(gru_warnings),
                           "hrDangerBpm": learned_hr.hr_danger_bpm,
                           "hrSustainBpm": learned_hr.hr_sustain_bpm,
                           "hrThresholdRunCount": learned_hr.hr_threshold_run_count}
                return JSONResponse(status_code=500, content=content)
            result["gruPersonalization"] = gru_payload
            result["warnings"] = list(result.get("warnings", [])) + list(gru_warnings)
            result["hrDangerBpm"] = learned_hr.hr_danger_bpm
            result["hrSustainBpm"] = learned_hr.hr_sustain_bpm
            result["hrThresholdRunCount"] = learned_hr.hr_threshold_run_count
            return result

        return await _run_heavy(request, "/v1/hr/personalize", compute, pool="personalize")

    @app.post("/v1/hr/predict", response_model=PredictResponse, tags=["AI03"], summary="AI03 2분 HR 예측",
              responses={400: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
                         500: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
    def predict(body: PredictRequest, request: Request, response: Response):
        model = get_model(request)
        free_run_policy = request.app.state.free_run_grade_policy
        check_sufficient(body, model.info.min_samples, free_run_policy)
        batch = to_batch(body, free_run_policy)
        t = time.perf_counter()
        personalization_warning = None
        personalization_version = None
        personalized = False
        hr = None
        # 개인화가 설정상 꺼져 있으면 조회·경고·로그 없이 기본 GRU로 예측한다(hrPersonalized=false).
        if body.user_id is not None and request.app.state.gru_personalization_requested:
            if request.app.state.gru_personalization_enabled:
                personalization = lookup_user_personalization(
                    request.app.state.gru_personalization_lookup, body.user_id, model,
                    endpoint="/v1/hr/predict")
            else:
                personalization = None
                personalization_warning = UNAVAILABLE_WARNING
                log_ai_error(UNAVAILABLE_WARNING, "/v1/hr/predict", Warning(),
                             level=logging.WARNING)
            if personalization is not None:
                personalization_warning = personalization.warning
                personalization_version = personalization.personalization_version
                if personalization.state is not None:
                    predict_with_state = getattr(model, "predict_with_state", None)
                    if callable(predict_with_state):
                        try:
                            candidate_hr = np.asarray(predict_with_state(batch, personalization.state), dtype=float)
                            if candidate_hr.shape != (len(body.candidates), 3) or not np.isfinite(candidate_hr).all():
                                raise ValueError("GRU 개인화 출력이 올바르지 않습니다.")
                            hr = candidate_hr
                            personalized = True
                        except Exception as exc:
                            log_ai_error("GRU_PERSONALIZATION_UNAVAILABLE", "/v1/hr/predict", exc,
                                         level=logging.WARNING)
                            personalization_warning = UNAVAILABLE_WARNING
                            personalization_version = None
                    else:
                        log_ai_error(UNAVAILABLE_WARNING, "/v1/hr/predict", Warning(),
                                     level=logging.WARNING)
                        personalization_warning = UNAVAILABLE_WARNING
        if hr is None:
            hr = model.predict(batch)
        log.debug("predict %d개 %.1fms", len(body.candidates), (time.perf_counter() - t) * 1000)
        if hr.shape != (len(body.candidates), 3) or not np.isfinite(hr).all():
            raise ApiError(500, "PREDICTION_FAILED", "모델 출력이 올바르지 않습니다.")
        warnings = free_run_warnings(body, free_run_policy)
        if personalization_warning:
            warnings.append(personalization_warning)
        if warnings:
            # AI03 JSON 계약은 그대로 두고 경고는 헤더로만 알린다.
            response.headers["X-RunWay-Warnings"] = ",".join(warnings)
        return PredictResponse(model_version=model.info.model_version, predictions=[
            Prediction(hr_bpm=[round(float(v), 2) for v in row], future_grade_used=used)
            for row, used in zip(hr, future_grade_used(body, free_run_policy))],
            hr_personalized=personalized if body.user_id is not None else None,
            hr_personalization_version=personalization_version if personalized else None)

    if demo_state is not None:
        app.include_router(build_stream_router(demo_state))
        app.include_router(build_inlet_router(demo_state))
        app.mount("/demo", StaticFiles(directory=SERVICE_DIR / "app" / "static" / "demo", html=True), name="demo")
    else:
        disabled_demo = APIRouter()

        @disabled_demo.get(
            "/v1/demo/sessions/{session_ref}/events", tags=["AI07"], summary="AI07 시연 이벤트 스트림",
            responses={401: {"model": ErrorResponse}, 404: {"model": ErrorResponse},
                       429: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
        )
        def demo_events_disabled(session_ref: str):
            raise ApiError(503, "DEMO_DISABLED", "AI 시연 기능이 비활성화되어 있습니다.")

        @disabled_demo.post(
            "/v1/demo/sessions/{session_id}/batches", response_model=dict,
            tags=["AI08"], summary="AI08 W07 시연 batch 수신",
            responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse},
                       404: {"model": ErrorResponse}, 409: {"model": ErrorResponse},
                       413: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
                       429: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
        )
        def demo_batches_disabled(session_id: int):
            raise ApiError(503, "DEMO_DISABLED", "AI 시연 기능이 비활성화되어 있습니다.")

        app.include_router(disabled_demo)
    return app


def _running_forecast(body: DecideRequest, response: DecideResponse, ode) -> dict:
    if not _enabled("DECIDE_FORECAST_ENABLED"):
        return {"status": "DISABLED", "modelName": "ODE-v2.1"}
    if ode is None:
        raise ApiError(503, "MODEL_NOT_READY", "ODE 완주 예측 모델이 준비되지 않았습니다.")
    context = body.context
    target_distance = context.goal.target_distance_m
    if target_distance is None and context.plan:
        target_distance = max(segment.end_m for segment in context.plan)
    if target_distance is None and context.goal.target_duration_sec and context.goal.target_pace_sec_per_km:
        target_distance = context.goal.target_duration_sec / context.goal.target_pace_sec_per_km * 1000.0
    if target_distance is None:
        return {"status": "INPUT_INSUFFICIENT", "modelName": "ODE-v2.1"}
    progress = context.route_progress_m if context.route_progress_m is not None else context.distance_m
    remaining = max(0.0, float(target_distance) - float(progress))
    chosen_pace = (response.decision.recommended_pace_sec_per_km if response.decision else
                   context.current_guide_pace_sec_per_km or context.anchor_pace_sec_per_km)
    pace = max(1.0, float(chosen_pace))
    eta_remaining = 0.0
    if context.plan:
        for segment in context.plan:
            lo, hi = max(float(progress), segment.start_m), min(float(target_distance), segment.end_m)
            if hi > lo:
                seg_pace = context.goal.target_pace_sec_per_km or pace
                eta_remaining += (hi - lo) * seg_pace * segment.ratio / 1000.0
    if eta_remaining <= 0 and remaining > 0:
        eta_remaining = remaining * pace / 1000.0
    sample_hr = body.history.hr_bpm[-1]
    if sample_hr is None:
        return {"status": "INPUT_INSUFFICIENT", "modelName": "ODE-v2.1",
                "remainingDistanceM": round(remaining, 2)}
    speed = next((v for v in reversed(body.history.speed_mps) if v is not None and v > 0), 1000.0 / pace)
    grade = next((v for v in reversed(body.history.grade_pct) if v is not None), 0.0)
    eta_cap = min(max(30, int(math.ceil(eta_remaining))), ode.info.validated_horizon_sec)
    try:
        hr_forecast = ode.forecast_running(current_hr_bpm=sample_hr, speed_mps=speed,
                                           grade_percent=grade, horizon_sec=eta_cap)
    except Exception as exc:  # optional forecast failure must not reject the GRU/policy decision
        log_ai_error("ODE_FORECAST_FAILED", "/v1/pace/decide", exc, level=logging.WARNING)
        return {"status": "FAILED", "modelName": "ODE-v2.1"}
    from datetime import timedelta
    predicted_finish = context.input_as_of + timedelta(seconds=eta_remaining)
    return {"status": "PREDICTED", "modelName": ode.info.model_type,
            "modelVersion": ode.info.model_version, "remainingDistanceM": round(remaining, 2),
            "remainingPaceSecPerKm": round(pace, 2), "predictedFinishSec": int(round(context.active_sec + eta_remaining)),
            "predictedFinishAtUtc": predicted_finish.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "hrForecast": hr_forecast}


logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
app = create_app()

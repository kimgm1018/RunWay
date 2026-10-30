"""RunWay AI 추론 서버 (FastAPI). 백엔드 서버만 부르는 내부 API다.

실행: uvicorn app.main:app --host 0.0.0.0 --port 8000   (ai/service/에서)
"""
import logging
import time
from collections.abc import Callable
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import load_settings
from app.models import HRModel, load_model
from app.models.base import FUTURE_STEPS
from app.schemas import (ErrorResponse, HealthResponse, ModelInfoResponse, PredictRequest, PredictResponse,
                         Prediction)

log = logging.getLogger("runway.ai")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: list[dict] | None = None):
        self.status, self.code, self.message, self.fields = status, code, message, fields


def error_body(code: str, message: str, fields: list[dict] | None = None) -> dict:
    return ErrorResponse(code=code, message=message, details={"fields": fields} if fields else None).model_dump()


def default_loader() -> HRModel:
    return load_model(load_settings())


def create_app(loader: Callable[[], HRModel] = default_loader) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.model = None
        try:
            t = time.perf_counter()
            app.state.model = loader()
            log.info("모델 로드: %s (%.1f초)", app.state.model.info.model_version, time.perf_counter() - t)
        except Exception:
            log.exception("모델을 불러오지 못했습니다. /health는 503을 반환합니다")
        yield

    app = FastAPI(title="RunWay AI Inference", version="0.1.0", lifespan=lifespan,
                  description="백엔드 서버 전용 내부 API. HR 예측 모델 추론 결과를 반환한다.")

    @app.exception_handler(ApiError)
    async def api_error(_: Request, e: ApiError):
        return JSONResponse(status_code=e.status, content=error_body(e.code, e.message, e.fields))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        fields = [{"name": ".".join(str(p) for p in err["loc"][1:]) or "body",
                   "reason": err["msg"].removeprefix("Value error, ")} for err in e.errors()]
        return JSONResponse(status_code=400, content=error_body("VALIDATION_ERROR", "요청 값이 유효하지 않습니다.", fields))

    def get_model(request: Request) -> HRModel:
        model = request.app.state.model
        if model is None:
            raise ApiError(503, "MODEL_NOT_READY", "모델이 로드되지 않았습니다.")
        return model

    @app.get("/health", response_model=HealthResponse, responses={503: {"model": HealthResponse}})
    def health(request: Request):
        model = request.app.state.model
        if model is None:
            return JSONResponse(status_code=503, content=HealthResponse(status="DOWN", model_loaded=False).model_dump(by_alias=True))
        return HealthResponse(status="UP", model_loaded=True, model_version=model.info.model_version)

    @app.get("/v1/model-info", response_model=ModelInfoResponse, responses={503: {"model": ErrorResponse}})
    def model_info(request: Request):
        info = get_model(request).info
        return ModelInfoResponse(model_type=info.model_type, model_version=info.model_version, window_sec=info.window_sec,
                                 required_metrics=list(info.required_metrics), min_samples=info.min_samples,
                                 missing_policy=info.missing_policy)

    @app.post("/v1/hr/predict", response_model=PredictResponse,
              responses={400: {"model": ErrorResponse}, 422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
    def predict(body: PredictRequest, request: Request):
        model = get_model(request)
        check_sufficient(body, model.info.min_samples)
        batch = to_batch(body)
        t = time.perf_counter()
        hr = model.predict(batch)
        log.debug("predict %d개 %.1fms", len(body.candidates), (time.perf_counter() - t) * 1000)
        if hr.shape != (len(body.candidates), 3) or not np.isfinite(hr).all():
            raise ApiError(500, "PREDICTION_FAILED", "모델 출력이 올바르지 않습니다.")
        return PredictResponse(model_version=model.info.model_version, predictions=[
            Prediction(hr_bpm=[round(float(v), 2) for v in row], future_grade_used=c.grade_known)
            for row, c in zip(hr, body.candidates)])

    return app


def check_sufficient(body: PredictRequest, min_samples: int) -> None:
    """가짜 값으로 채우지 않는다. t0 심박이나 쓸 수 있는 과거 칸이 부족하면 INPUT_INSUFFICIENT."""
    h = body.history
    if h.hr_bpm[-1] is None:
        raise ApiError(422, "INPUT_INSUFFICIENT", "t0 심박이 없습니다.",
                       [{"name": "history.hrBpm", "reason": "마지막 칸(t0) 심박이 필요합니다"}])
    seg = h.segment_id
    complete = sum(1 for i, row in enumerate(zip(h.hr_bpm, h.speed_mps, h.grade_pct))
                   if None not in row and (seg is None or seg[i] == seg[-1]))
    if complete < min_samples:
        raise ApiError(422, "INPUT_INSUFFICIENT", "심박·속도·경사가 모두 있는 칸이 부족합니다.",
                       [{"name": "history", "reason": f"t0와 같은 구간에 {min_samples}칸 이상 필요합니다 (현재 {complete}칸)"}])


def to_batch(body: PredictRequest) -> dict:
    """요청 → 모델 공통 batch(후보 N개). 후보마다 과거는 같고 미래 계획만 다르다."""
    n = len(body.candidates)
    h = body.history

    def series(values):
        return np.tile(np.array([np.nan if v is None else v for v in values], np.float32), (n, 1))

    future_grade = np.full((n, FUTURE_STEPS), np.nan, np.float32)
    for i, c in enumerate(body.candidates):
        if c.grade_known:
            future_grade[i] = c.future_grade_pct
    start = body.session_started_at.timestamp() if body.session_started_at else None
    return {
        "hr": series(h.hr_bpm), "speed": series(h.speed_mps), "grade": series(h.grade_pct),
        "segment": np.tile(np.array(h.segment_id), (n, 1)) if h.segment_id is not None else None,
        "elapsed_s": np.full(n, body.elapsed_sec, np.float32),
        "future_speed": np.array([c.future_speed_mps for c in body.candidates], np.float32),
        "future_grade": future_grade,
        "session_start_s": np.full(n, start) if start is not None else None,
    }


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = create_app()

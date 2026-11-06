"""W07 시연 batch를 병합하고 같은 decide 파이프라인에 넣는다."""
import logging
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.demo.auth import reject_query_token, require_bearer
from app.demo.candidates import build_candidates, choose_anchor, goal_pace
from app.demo.recorder import DemoState, record_trace
from app.demo.samples import InletInputs, Insufficient, SessionSamples
from app.demo.trace import delivery_for
from app.demo.w07 import GpsPoint, MetricSample, parse_batch
from app.decide.schemas import DecideRequest
from app.inference import ApiError
from app.decide.service import run_decide
from app.schemas import ErrorResponse

log = logging.getLogger("runway.ai")
RATE_PER_SEC = 2
REPLAY_SPEED_HEADER = "X-Demo-Replay-Speed"


@dataclass
class GuideState:
    pace_sec_per_km: float | None = None
    set_at: datetime | None = None


def build_inlet_request(session_id: int, profile, inputs: InletInputs, guide: GuideState,
                        *, follows_guide: bool = True) -> DecideRequest | None:
    anchor = choose_anchor(goal_pace(profile.goal), guide.pace_sec_per_km,
                           inputs.actual_pace_60s_sec_per_km, follows_guide=follows_guide)
    if anchor is None:
        return None
    body = {
        "elapsedSec": inputs.elapsed_sec,
        "history": inputs.history,
        "candidates": build_candidates(anchor, inputs.distance_m, profile.course),
        "context": {
            "sessionId": session_id, "stateVersion": 1, "runState": "RUNNING", "mode": profile.mode,
            "goal": profile.goal, "goalPreference": profile.goal_preference, "plan": profile.plan,
            "anchorPaceSecPerKm": anchor, "currentGuidePaceSecPerKm": guide.pace_sec_per_km,
            "guidePaceSetAt": guide.set_at, "activeSec": inputs.elapsed_sec,
            "distanceM": inputs.distance_m, "routeProgressM": inputs.route_progress_m,
            "inputAsOf": inputs.input_as_of, "hrReference": profile.hr_reference,
            "lastCoaching": None, "resumedAt": None,
        },
    }
    return DecideRequest.model_validate(body)


def build_inlet_router(state: DemoState) -> APIRouter:
    router = APIRouter()
    samples: dict[int, SessionSamples] = {}
    guides: dict[int, GuideState] = {}
    locks: dict[int, threading.Lock] = {}
    idempotency: dict[tuple[int, str], tuple[str, dict]] = {}
    request_times: dict[int, deque[float]] = defaultdict(deque)
    rate_lock = threading.Lock()

    @router.post(
        "/v1/demo/sessions/{session_id}/batches", response_model=dict,
        tags=["AI08"], summary="AI08 W07 시연 batch 수신",
        responses={
            400: {"model": ErrorResponse},
            401: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            409: {"model": ErrorResponse},
            413: {"model": ErrorResponse},
            422: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    async def receive(session_id: int, request: Request):
        reject_query_token(request)
        require_bearer(request, state.settings.ingest_token)
        if not state.buffer.allowed(session_id):
            raise ApiError(404, "SESSION_NOT_FOUND", "시연 세션이 없습니다.")
        now_mono = time.monotonic()
        with rate_lock:
            times = request_times[session_id]
            while times and now_mono - times[0] >= 1.0:
                times.popleft()
            if len(times) >= state.rate_per_sec:
                raise ApiError(429, "TOO_MANY_REQUESTS", "요청이 너무 잦습니다.", headers={"Retry-After": "1"})
            times.append(now_mono)
        batch = parse_batch(await request.body(),
                            skip_hash_device_ids=state.config.skip_payload_hash_device_ids)
        if batch.sessionId != session_id:
            raise ApiError(422, "INVALID_BATCH", "본문 sessionId가 경로와 다릅니다.",
                           [{"name": "sessionId", "reason": "본문 sessionId가 경로와 다릅니다"}])
        key = (batch.deviceId, batch.id)
        old = idempotency.get(key)
        ack = {"status": "COMMITTED", "batchId": batch.id, "acceptedCount": len(batch.items)}
        if old is not None:
            if old[0] != batch.payloadHash:
                raise ApiError(409, "BATCH_HASH_CONFLICT", "같은 batch ID에 다른 본문이 들어왔습니다.")
            return old[1]
        idempotency[key] = (batch.payloadHash, ack)

        session_samples = samples.setdefault(session_id, SessionSamples())
        metric_items = [item for item in batch.items if isinstance(item, MetricSample)]
        gps_items = [item for item in batch.items if isinstance(item, GpsPoint)]
        if gps_items:
            state.buffer.append_route_points(session_id, gps_items)
        session_samples.add(metric_items)
        lock = locks.setdefault(session_id, threading.Lock())
        if not lock.acquire(blocking=False):
            return ack
        try:
            stage, profile = state.profile_for(session_id)
            model = request.app.state.model
            policy = request.app.state.policy
            if model is None or policy is None:
                return ack
            inputs = session_samples.build_inputs(n_cells=model.info.window_sec // 5 + 12,
                                                  course=profile.course)
            if isinstance(inputs, Insufficient):
                return ack
            guide = guides.setdefault(session_id, GuideState())
            body = build_inlet_request(session_id, profile, inputs, guide,
                                       follows_guide=delivery_for(stage) == "WATCH")
            if body is None:
                return ack
            if stage == "L3":
                raw_speed = request.headers.get(REPLAY_SPEED_HEADER, "1")
                try:
                    replay_speed = max(1, min(8, int(raw_speed)))
                except ValueError:
                    replay_speed = 1
                now = inputs.data_now
            else:
                replay_speed = None
                now = request.app.state.clock()
            try:
                outcome = await run_in_threadpool(run_decide, body, model, policy,
                                                  received_at=now, now=lambda: now)
            except ApiError as exc:
                log.warning("시연 판단 실패: %s", exc.code)
                return ack
            if outcome.error is not None and outcome.status not in {"INPUT_INSUFFICIENT"}:
                log.warning("시연 판단 실패: %s", outcome.error.code)
                return ack
            if (outcome.response and outcome.response.publish_suggested and outcome.response.decision
                    and outcome.response.decision.recommended_pace_sec_per_km is not None):
                guide.pace_sec_per_km = outcome.response.decision.recommended_pace_sec_per_km
                guide.set_at = outcome.decided_at
            record_trace(state, outcome, stage=stage, replay_speed=replay_speed,
                         grade_source=inputs.grade_source)
        finally:
            lock.release()
        return JSONResponse(status_code=200, content=ack)

    return router

"""메모리 버퍼를 SNAPSHOT·MPC_TRACE·HEARTBEAT SSE로 보낸다."""
import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.demo.auth import reject_query_token, require_bearer
from app.demo.recorder import DemoState
from app.inference import ApiError
from app.schemas import ErrorResponse

HEARTBEAT_SEC = 15.0
POLL_SEC = 0.2


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


async def event_stream(buffer, session_id: int, *, snapshot: dict, sleep=asyncio.sleep,
                       monotonic=time.monotonic, server_time: Callable[[], str] = lambda: "",
                       is_disconnected: Callable[[], Awaitable[bool]] = lambda: asyncio.sleep(0, result=False),
                       max_loops: int | None = None,
                       initial_course_version: int | None = None) -> AsyncIterator[str]:
    last_seq = 0
    last_course_version = initial_course_version
    if last_course_version is None:
        last_course_version = buffer.course_state(session_id)[0] if hasattr(buffer, "course_state") else 0
    last_send = monotonic()
    try:
        payload = dict(snapshot)
        if hasattr(buffer, "snapshot"):
            traces, last_seq = buffer.snapshot(session_id)
            payload["traces"] = traces
        else:
            payload.setdefault("traces", buffer.traces(session_id))
        yield sse("SNAPSHOT", payload)
        loops = 0
        while max_loops is None or loops < max_loops:
            loops += 1
            if await is_disconnected():
                return
            await sleep(POLL_SEC)
            if hasattr(buffer, "course_state"):
                course_version, course = buffer.course_state(session_id)
                if course_version > last_course_version:
                    yield sse("COURSE_UPDATE", {"course": course})
                    last_course_version = course_version
            for seq, trace in buffer.since(session_id, last_seq):
                yield sse("MPC_TRACE", trace)
                last_seq = max(last_seq, seq)
                last_send = monotonic()
            current = monotonic()
            if current - last_send >= HEARTBEAT_SEC:
                yield sse("HEARTBEAT", {"bootId": buffer.boot_id, "serverTime": server_time()})
                last_send = current
    finally:
        buffer.unsubscribe(session_id)


def build_stream_router(state: DemoState) -> APIRouter:
    router = APIRouter()

    @router.get(
        "/v1/demo/sessions/{session_ref}/events", tags=["AI07"], summary="AI07 시연 이벤트 스트림",
        responses={
            200: {"description": "시연 이벤트 SSE", "content": {"text/event-stream": {"schema": {"type": "string"}}}},
            400: {"model": ErrorResponse},
            401: {"model": ErrorResponse},
            404: {"model": ErrorResponse},
            429: {"model": ErrorResponse},
            503: {"model": ErrorResponse},
        },
    )
    async def events(session_ref: str, request: Request):
        reject_query_token(request)
        require_bearer(request, state.settings.view_token)
        if session_ref == "latest":
            session_id = state.buffer.latest_session()
        else:
            try:
                session_id = int(session_ref)
            except ValueError:
                session_id = None
        if session_id is None or not state.buffer.allowed(session_id):
            raise ApiError(404, "SESSION_NOT_FOUND", "시연 세션이 없습니다.")
        try:
            stage, profile = state.profile_for(session_id)
        except KeyError:
            raise ApiError(404, "SESSION_NOT_FOUND", "시연 세션이 없습니다.") from None
        if not state.buffer.subscribe(session_id):
            raise ApiError(429, "TOO_MANY_CONNECTIONS", "이 세션의 화면 연결이 이미 2개입니다.")
        course_version, route_course = state.buffer.course_state(session_id)
        course = route_course or (profile.course.summary() if profile.course else None)
        snapshot = {"bootId": state.buffer.boot_id, "serverTime": request.app.state.clock().isoformat(),
                    "stage": stage, "label": profile.label,
                    "course": course,
                    "traces": state.buffer.traces(session_id)}
        max_loops = getattr(request.app.state, "demo_stream_max_loops", None)
        body = event_stream(state.buffer, session_id, snapshot=snapshot,
                            server_time=lambda: request.app.state.clock().isoformat(),
                            is_disconnected=request.is_disconnected, max_loops=max_loops,
                            initial_course_version=course_version)
        return StreamingResponse(body, media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return router

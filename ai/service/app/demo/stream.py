"""메모리 버퍼를 SNAPSHOT·MPC_TRACE·COURSE_UPDATE·HEARTBEAT SSE로 보낸다. 실제 경로(722)도 COURSE_UPDATE에 싣는다."""
import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.demo.auth import reject_query_token, require_bearer
from app.demo.recorder import DemoState
from app.inference import ApiError
from app.schemas import ErrorResponse

HEARTBEAT_SEC = 15.0
POLL_SEC = 0.2
SESSIONS_EVERY_SEC = 5.0        # 738: '이전 기록' 목록이 바뀌었는지 보는 간격
MAX_HISTORY_TRACES = 1500       # 738: 다시 보기 한 번에 보내는 기록 상한(넘으면 고르게 솎고 마지막은 남김)


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n"


async def event_stream(buffer, session_id: int, *, snapshot: dict, sleep=asyncio.sleep,
                       monotonic=time.monotonic, server_time: Callable[[], str] = lambda: "",
                       is_disconnected: Callable[[], Awaitable[bool]] = lambda: asyncio.sleep(0, result=False),
                       max_loops: int | None = None,
                       initial_course_version: int | None = None,
                       routes=None, initial_route_version: int = 0,
                       sessions: Callable[[], list] | None = None) -> AsyncIterator[str]:
    last_seq = 0
    last_course_version = initial_course_version
    if last_course_version is None:
        last_course_version = buffer.course_state(session_id)[0] if hasattr(buffer, "course_state") else 0
    last_route_version = initial_route_version
    last_sessions_key = None
    last_sessions_check = float("-inf")
    last_send = monotonic()
    try:
        payload = dict(snapshot)
        if hasattr(buffer, "snapshot"):
            traces, last_seq = buffer.snapshot(session_id)
            payload["traces"] = traces
        else:
            payload.setdefault("traces", buffer.traces(session_id))
        if "sessions" in payload:
            last_sessions_key = _sessions_key(payload["sessions"])
            last_sessions_check = monotonic()
        yield sse("SNAPSHOT", payload)
        loops = 0
        while max_loops is None or loops < max_loops:
            loops += 1
            if await is_disconnected():
                return
            await sleep(POLL_SEC)
            course_changed, route_changed = False, False
            course = None
            if hasattr(buffer, "course_state"):
                course_version, course = buffer.course_state(session_id)
                if course_version > last_course_version:
                    course_changed, last_course_version = True, course_version
            route_list = None
            if routes is not None:
                # 722: 구독 중일 때만, 버퍼에 기록이 있는(대상 회원) 세션만 DB에서 새 좌표를 읽는다
                if routes.due(session_id) and buffer.traces(session_id):
                    await run_in_threadpool(routes.refresh, session_id)
                route_version, route_list = routes.state(session_id)
                if route_version > last_route_version:
                    route_changed, last_route_version = True, route_version
            if course_changed or route_changed:
                payload = {"course": course} if course_changed else {}
                if route_changed:
                    payload["routes"] = route_list   # 실제 경로가 바뀌었을 때만 싣는다(기존 콘솔은 이 키를 무시)
                yield sse("COURSE_UPDATE", payload)
            if sessions is not None and monotonic() - last_sessions_check >= SESSIONS_EVERY_SEC:
                last_sessions_check = monotonic()
                rows = sessions()
                key = _sessions_key(rows)
                if key != last_sessions_key:
                    last_sessions_key = key
                    yield sse("SESSIONS", {"sessions": rows})
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


def _sessions_key(rows) -> tuple:
    return tuple((r.get("sessionId"), r.get("traceCount"), r.get("live")) for r in rows or ())


def _thin(traces: list[dict], limit: int) -> list[dict]:
    if len(traces) <= limit:
        return traces
    step = (len(traces) - 1) / (limit - 1)
    return [traces[round(i * step)] for i in range(limit)]


async def _one(event: str, data: dict, release: Callable[[], None]) -> AsyncIterator[str]:
    try:
        yield sse(event, data)
    finally:
        release()


def session_rows(state: DemoState) -> list[dict]:
    """738 '이전 기록' 목록: 버퍼 목록에 화면 이름(label)만 붙인다. 회원 ID·좌표는 없다."""
    rows = []
    for row in state.buffer.sessions():
        try:
            _, profile = state.profile_for(row["sessionId"])
            label = profile.label
        except KeyError:
            label = None
        rows.append({**row, "label": label})
    return rows


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
        history = session_ref.startswith("h") and session_ref[1:].isdigit()
        if session_ref == "latest":
            session_id = state.buffer.latest_session()
        elif history:                       # 738: 'h<id>' = 지난 기록 전체를 한 번 보내고 닫는다
            session_id = int(session_ref[1:])
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
        routes = state.routes
        route_version, route_list = 0, []
        if routes is not None:
            if state.buffer.traces(session_id):
                await run_in_threadpool(routes.refresh, session_id)
            route_version, route_list = routes.state(session_id)
        snapshot = {"bootId": state.buffer.boot_id, "serverTime": request.app.state.clock().isoformat(),
                    "stage": stage, "label": profile.label,
                    "course": course, "routes": route_list,
                    "traces": state.buffer.traces(session_id),
                    "sessionId": session_id, "sessions": session_rows(state)}
        if history:
            snapshot["traces"] = _thin(state.buffer.all_traces(session_id), MAX_HISTORY_TRACES)
            snapshot["history"] = True
            return StreamingResponse(_one("SNAPSHOT", snapshot, lambda: state.buffer.unsubscribe(session_id)),
                                     media_type="text/event-stream",
                                     headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        max_loops = getattr(request.app.state, "demo_stream_max_loops", None)
        body = event_stream(state.buffer, session_id, snapshot=snapshot,
                            server_time=lambda: request.app.state.clock().isoformat(),
                            is_disconnected=request.is_disconnected, max_loops=max_loops,
                            initial_course_version=course_version,
                            routes=routes, initial_route_version=route_version,
                            sessions=lambda: session_rows(state))
        return StreamingResponse(body, media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return router

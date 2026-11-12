"""시연 콘솔 '이전 기록'(S15P31E105-738): 러닝 전체 보관, 목록, 'h<id>' 다시 보기."""
import asyncio
import json
from datetime import timedelta

from app.demo.stream import MAX_HISTORY_TRACES, _thin, event_stream
from demo_fakes import T, VIEW, _false, demo_client, new_buffer


def _trace(sec):
    at = (T + timedelta(seconds=sec)).isoformat().replace("+00:00", "Z")
    return {"traceId": f"b:{sec:06d}", "inputAsOf": at, "decidedAt": at, "elapsedSec": sec}


def _events(text):
    out = []
    for block in text.strip().split("\n\n"):
        name = block.split("\n")[0].removeprefix("event: ")
        out.append((name, json.loads(block.split("data: ", 1)[1])))
    return out


def test_history_ref_sends_whole_run_once_and_live_stays_10_min(tmp_path):
    with demo_client(tmp_path) as c:
        for sec in range(0, 1800, 30):
            c.app.state.demo.buffer.append(201, _trace(sec))
        c.app.state.demo_stream_max_loops = 0
        live = _events(c.get("/v1/demo/sessions/201/events", headers=VIEW).text)
        history = _events(c.get("/v1/demo/sessions/h201/events", headers=VIEW).text)
    assert live[0][0] == "SNAPSHOT" and len(live[0][1]["traces"]) == 21              # 라이브는 그대로 최근 10분
    assert [name for name, _ in history] == ["SNAPSHOT"]                             # 다시 보기는 한 번 보내고 끝
    snap = history[0][1]
    assert snap["history"] is True and len(snap["traces"]) == 60 and snap["traces"][0]["elapsedSec"] == 0
    rows = snap["sessions"]
    assert rows[0]["sessionId"] == 201 and rows[0]["kind"] == "PERSONAL" and rows[0]["durationSec"] == 1770
    assert rows[0]["label"] == "러너 A"


def test_history_requires_token_and_known_session(tmp_path):
    with demo_client(tmp_path) as c:
        c.app.state.demo.buffer.append(201, _trace(0))
        assert c.get("/v1/demo/sessions/h201/events").status_code == 401
        assert c.get("/v1/demo/sessions/h999/events", headers=VIEW).status_code == 200    # 비어 있는 세션: 빈 기록
        assert c.get("/v1/demo/sessions/hx/events", headers=VIEW).status_code == 404


def test_history_respects_session_allowlist(tmp_path):
    with demo_client(tmp_path, allow=frozenset({7})) as c:
        assert c.get("/v1/demo/sessions/h201/events", headers=VIEW).status_code == 404


def test_sessions_event_when_list_changes():
    b = new_buffer(); b.subscribe(1); b.append(1, _trace(0))
    clock = {"t": 0.0}
    calls = {"n": 0}

    def rows():
        calls["n"] += 1
        return b.sessions()

    async def sleep(seconds):
        clock["t"] += seconds
        if abs(clock["t"] - 2.0) < 1e-9:
            b.append(2, _trace(10))

    async def run():
        return [e async for e in event_stream(b, 1, snapshot={"bootId": "b", "sessions": b.sessions()}, sleep=sleep,
                                              monotonic=lambda: clock["t"], is_disconnected=_false, max_loops=60,
                                              sessions=rows)]

    events = [e.split("\n")[0] for e in asyncio.run(run())]
    assert events.count("event: SESSIONS") == 1                                       # 새 세션이 생겼을 때만
    assert calls["n"] <= 3                                                            # 5초 간격으로만 확인


def test_thin_keeps_first_and_last():
    rows = list(range(4000))
    thin = _thin(rows, MAX_HISTORY_TRACES)
    assert len(thin) == MAX_HISTORY_TRACES and thin[0] == 0 and thin[-1] == 3999
    assert _thin(rows[:10], MAX_HISTORY_TRACES) == rows[:10]

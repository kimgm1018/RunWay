"""시연 콘솔 지도용 실제 경로(S15P31E105-722): 구독 중·대상 세션만 읽고 SSE로 보낸다."""
import asyncio
import json
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.demo.buffer import group_key
from app.demo.routes import DbDemoRouteSource, DemoRoutes
from app.demo.stream import event_stream
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T, VIEW, FakeModel5, FakePolicy, _false, decide_body, demo_settings, fixed_clock, flat_table, new_buffer, tr
from test_group_pace_ai10 import GroupModel, body, participant


class FakeRouteSource:
    """running session id -> 좌표 목록. userId -> 진행 중 세션."""

    def __init__(self, routes=None, sessions=None, fail=False):
        self.routes = routes or {}
        self.sessions = sessions or {}
        self.fail = fail
        self.calls = []

    def running_session(self, user_id):
        self.calls.append(("session", user_id))
        if self.fail:
            raise RuntimeError("db down")
        return self.sessions.get(user_id)

    def points_after(self, session_id, after):
        self.calls.append(("points", session_id))
        if self.fail:
            raise RuntimeError("db down")
        return [p for p in self.routes.get(session_id, []) if after is None or p[0] > after]


def _line(n, lat=37.5, lon=127.0):
    return [(T + timedelta(seconds=5 * i), lat + i * 1e-4, lon + i * 1e-4) for i in range(n)]


def _client(tmp_path, source, users=None, model=None, policy=None):
    settings = demo_settings(tmp_path)
    if users is not None:
        settings = replace(settings, config=replace(settings.config, user_allowlist=users))
    app = create_app(model or (lambda: FakeModel5()), policy or (lambda: FakePolicy()), clock=fixed_clock(3.0),
                     demo_loader=lambda: settings, demo_rate_per_sec=1000, demo_route_source=source)
    return TestClient(app)


def _snapshot(c, ref):
    c.app.state.demo_stream_max_loops = 0
    r = c.get(f"/v1/demo/sessions/{ref}/events", headers=VIEW)
    assert r.status_code == 200
    first = r.text.split("\n\n")[0]
    assert first.startswith("event: SNAPSHOT")
    return json.loads(first.split("data: ", 1)[1])


@pytest.fixture(autouse=True)
def group_enabled(monkeypatch):
    monkeypatch.setenv("GROUP_PACE_ENABLED", "true")


def test_personal_route_sent_in_snapshot_only_when_subscribed(tmp_path):
    source = FakeRouteSource(routes={201: _line(4)})
    with _client(tmp_path, source, users=frozenset({11})) as c:
        data = decide_body(); data["userId"] = 11
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        assert source.calls == []                                   # 콘솔 연결이 없으면 DB를 읽지 않는다
        snap = _snapshot(c, 201)
    assert [r["label"] for r in snap["routes"]] == ["러너"]
    assert snap["routes"][0]["points"][0] == [37.5, 127.0] and len(snap["routes"][0]["points"]) == 4


def test_session_without_records_is_not_read(tmp_path):
    source = FakeRouteSource(routes={202: _line(4)})
    with _client(tmp_path, source, users=frozenset({11})) as c:
        data = decide_body(sessionId=202); data["userId"] = 12        # 대상이 아니라 버퍼에 기록되지 않음
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        snap = _snapshot(c, 202)
    assert snap["routes"] == [] and source.calls == []


def test_stream_requires_token(tmp_path):
    with _client(tmp_path, FakeRouteSource()) as c:
        assert c.get("/v1/demo/sessions/201/events").status_code == 401


def test_group_routes_follow_participant_order(tmp_path):
    source = FakeRouteSource(routes={501: _line(3), 502: _line(5, lat=37.6)}, sessions={1: 501, 2: 502})
    policy = lambda: MpcPolicy(load_policy_config(), flat_table(0))
    with _client(tmp_path, source, users=frozenset({1, 2}), model=lambda: GroupModel(), policy=policy) as c:
        r = c.post("/v1/group/pace", json=body(participants=[participant(1), participant(2)]))
        assert r.status_code == 200 and "routes" not in r.json()
        snap = _snapshot(c, group_key(3))
    assert [(x["label"], len(x["points"])) for x in snap["routes"]] == [("러너 1", 3), ("러너 2", 5)]
    assert "userId" not in json.dumps(snap["routes"])                # 회원 ID는 내보내지 않는다


def test_nothing_is_read_without_user_allowlist(tmp_path):
    # 718 userAllowlist가 null(전체)이면 경로 기능이 꺼진다
    source = FakeRouteSource(routes={201: _line(4)})
    with _client(tmp_path, source, users=None) as c:
        data = decide_body(); data["userId"] = 11
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        assert c.app.state.demo.routes is None
        snap = _snapshot(c, 201)
    assert snap["routes"] == [] and source.calls == []


def test_group_draws_only_allowed_members(tmp_path):
    source = FakeRouteSource(routes={501: _line(3), 502: _line(5)}, sessions={1: 501, 2: 502})
    policy = lambda: MpcPolicy(load_policy_config(), flat_table(0))
    with _client(tmp_path, source, users=frozenset({2}), model=lambda: GroupModel(), policy=policy) as c:
        assert c.post("/v1/group/pace", json=body(participants=[participant(1), participant(2)])).status_code == 200
        snap = _snapshot(c, group_key(3))
    assert [r["label"] for r in snap["routes"]] == ["러너 2"]
    assert ("session", 1) not in source.calls                        # 대상이 아닌 회원은 세션도 찾지 않는다


def test_new_points_arrive_in_course_update_and_poll_is_throttled():
    clock = {"t": 0.0}
    source = FakeRouteSource(routes={1: _line(2)})
    routes = DemoRoutes(source, allowed_users=frozenset({1, 2}), monotonic=lambda: clock["t"], poll_sec=3.0)
    b = new_buffer(); b.subscribe(1); b.append(1, tr(0))

    async def sleep(seconds):
        clock["t"] += seconds
        if abs(clock["t"] - 1.0) < 1e-9:
            source.routes[1] = _line(6)

    async def run():
        return [e async for e in event_stream(b, 1, snapshot={"bootId": "b"}, sleep=sleep, monotonic=lambda: clock["t"],
                                              is_disconnected=_false, max_loops=20, routes=routes)]

    events = asyncio.run(run())
    updates = [json.loads(e.split("data: ", 1)[1]) for e in events if e.startswith("event: COURSE_UPDATE")]
    assert all("course" not in u for u in updates)                     # 경로만 바뀌면 코스는 건드리지 않는다
    assert [len(u["routes"][0]["points"]) for u in updates] == [2, 6]
    assert len([c for c in source.calls if c[0] == "points"]) == 2     # 4초 동안 3초 간격으로 두 번만


def test_new_running_session_restarts_line():
    source = FakeRouteSource(routes={501: _line(3), 777: _line(2, lat=38.0)}, sessions={1: 501})
    clock = {"t": 0.0}
    routes = DemoRoutes(source, allowed_users=frozenset({1, 2}), monotonic=lambda: clock["t"], poll_sec=0.0)
    key = group_key(3)
    routes.set_group_members(key, [1])
    routes.refresh(key)
    source.sessions[1] = 777
    clock["t"] += 31.0
    routes.refresh(key)
    _, state = routes.state(key)
    assert state[0]["points"] == [[38.0, 127.0], [38.0001, 127.0001]]


def test_db_failure_keeps_stream_alive():
    routes = DemoRoutes(FakeRouteSource(fail=True), allowed_users=frozenset({1}), poll_sec=0.0)
    routes.set_group_members(group_key(3), [1])
    routes.refresh(group_key(3))
    routes.refresh(5)
    assert routes.state(group_key(3)) == (0, []) and routes.state(5) == (0, [])


def test_long_route_is_thinned_for_sse():
    routes = DemoRoutes(FakeRouteSource(routes={1: _line(4000)}), allowed_users=frozenset({1}), poll_sec=0.0)
    routes.refresh(1)
    _, state = routes.state(1)
    points = state[0]["points"]
    assert len(points) == 1500 and points[0] == [37.5, 127.0] and points[-1] == [round(37.5 + 3999e-4, 6), round(127.0 + 3999e-4, 6)]


class RecordingDb:
    def __init__(self):
        self.calls = []

    def fetch_all_with_timeout(self, sql, params, timeout_ms):
        self.calls.append((sql, params, timeout_ms))
        return [{"id": 9}] if "running_sessions" in sql else [{"measured_at": T, "lat": 37.5, "lon": 127.0}]


def test_db_source_reads_only_granted_columns_with_parameters():
    db = RecordingDb()
    source = DbDemoRouteSource(db)
    # 진행 중 세션 조건은 V8 부분 유니크 인덱스와 같아야 인덱스를 탄다
    assert source.running_session(7) == 9
    assert source.points_after(9, None) == [(T, 37.5, 127.0)]
    points_sql = db.calls[1][0]
    assert "accuracy" not in points_sql and "altitude" not in points_sql and "device_id" not in points_sql
    assert "status IN ('READY', 'RUNNING', 'PAUSED') AND state_version >= 1 AND deleted_at IS NULL" in db.calls[0][0]
    assert "ORDER BY measured_at" in points_sql and "measured_at > %(after)s" in points_sql
    assert db.calls[0][1] == {"user_id": 7} and db.calls[1][1]["session_id"] == 9
    assert all(timeout == 800 for *_, timeout in db.calls)


def test_total_route_points_cap_clears_oldest_session_first():
    import app.demo.routes as routes_mod
    clock = {"t": 0.0}
    source = FakeRouteSource(routes={1: _line(6), 2: _line(6)})
    routes = DemoRoutes(source, allowed_users=frozenset({1}), monotonic=lambda: clock["t"], poll_sec=0.0)
    old = routes_mod.MAX_TOTAL_POINTS
    routes_mod.MAX_TOTAL_POINTS = 8
    try:
        routes.refresh(1)
        clock["t"] += 10
        routes.refresh(2)
        assert routes.state(1)[1] == [] and len(routes.state(2)[1][0]["points"]) == 6
        source.routes[2] = _line(12)
        clock["t"] += 10
        routes.refresh(2)
        assert len(routes.state(2)[1][0]["points"]) == 8                              # 혼자 남으면 앞부분만 덜어냄
    finally:
        routes_mod.MAX_TOTAL_POINTS = old

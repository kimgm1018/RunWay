"""시연 콘솔 실시간 측정값(S15P31E105-912): 켜져 있고 구독 중·대상 회원 세션만 읽어 LIVE_METRICS로 보낸다."""
import asyncio
import json
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.demo.buffer import group_key
from app.demo.config import load_demo_config
from app.demo.live_metrics import DbDemoMetricSource, DemoLiveMetrics, summarize
from app.demo.stream import event_stream
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T, VIEW, FakeModel5, FakePolicy, _false, decide_body, demo_settings, fixed_clock, flat_table, new_buffer, tr
from test_demo_routes import FakeRouteSource
from test_group_pace_ai10 import GroupModel, body, participant


def _row(sec, hr=150.0, speed=3.0, distance=None, measured=True):
    """DB 행 모양(최신이 먼저가 되도록 호출자가 뒤집는다). psycopg는 NUMERIC을 Decimal로 준다."""
    return {"measured_at": T + timedelta(seconds=sec), "elapsed_duration": sec,
            "heart_rate": Decimal(str(hr)) if hr is not None else None, "is_hr_measured": measured,
            "speed": Decimal(str(speed)) if speed is not None else None,
            "total_distance": Decimal(str(distance if distance is not None else sec * 3.0))}


def _rows(end, step=5, **kw):
    return [_row(s, **kw) for s in range(end, -1, -step)]          # 최신이 먼저


class FakeMetricSource:
    """running session id -> 최신이 먼저인 행 목록. owners: running session id -> 소유 회원(없으면 None)."""

    def __init__(self, rows=None, fail=False, owners=None, owner_fail=False, fail_sessions=()):
        self.rows = rows or {}
        self.fail = fail
        self.owners = owners or {}
        self.owner_fail = owner_fail
        self.fail_sessions = set(fail_sessions)
        self.calls = []
        self.owner_calls = []

    def owner(self, session_id):
        self.owner_calls.append(session_id)
        if self.owner_fail:
            raise RuntimeError("db down")
        return self.owners.get(session_id)

    def recent(self, session_id):
        self.calls.append(session_id)
        if self.fail or session_id in self.fail_sessions:
            raise RuntimeError("db down")
        return list(self.rows.get(session_id, []))


def _settings(tmp_path, users=frozenset({11}), live_sec=5.0):
    settings = demo_settings(tmp_path)
    return replace(settings, config=replace(settings.config, user_allowlist=users, live_metrics_sec=live_sec))


def _client(tmp_path, metrics, routes=None, users=frozenset({11}), live_sec=5.0, model=None, policy=None):
    settings = _settings(tmp_path, users, live_sec)
    app = create_app(model or (lambda: FakeModel5()), policy or (lambda: FakePolicy()), clock=fixed_clock(3.0),
                     demo_loader=lambda: settings, demo_rate_per_sec=1000,
                     demo_route_source=routes if routes is not None else FakeRouteSource(),
                     demo_metric_source=metrics)
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


# --- 값 만들기 ---------------------------------------------------------------------------------------

def test_summary_uses_latest_hr_60s_mean_speed_and_latest_distance():
    rows = [_row(100, hr=162, speed=4.0, distance=410.0)] + [_row(s, hr=140, speed=2.0) for s in range(95, -1, -5)]
    # 60초 창(41~100초) 안 12행: 4.0 한 번 + 2.0 열한 번
    out = summarize(rows)
    mean = (4.0 + 2.0 * 11) / 12
    expected_at = (T + timedelta(seconds=100)).isoformat().replace("+00:00", "Z")
    assert out == {"hrBpm": 162.0, "speedMps": round(mean, 3), "paceSecPerKm": round(1000 / mean, 1),
                   "distanceM": 410.0, "elapsedSec": 100, "measuredAt": expected_at}


def test_summary_hides_unmeasured_or_stale_hr_and_stopped_pace():
    stale = [_row(100, hr=None, measured=False), _row(95, hr=150, measured=False), _row(80, hr=155)]
    assert summarize(stale)["hrBpm"] is None                    # 15초 안에 측정된 심박이 없다(80초는 20초 전)
    fresh = [_row(100, hr=None, measured=False), _row(90, hr=155)]
    assert summarize(fresh)["hrBpm"] == 155.0                   # 10초 전 측정값은 쓴다
    stopped = summarize([_row(10, speed=0.0)])
    assert stopped["speedMps"] == 0.0 and stopped["paceSecPerKm"] is None
    assert summarize([]) is None


class RecordingDb:
    def __init__(self):
        self.calls = []

    def fetch_all_with_timeout(self, sql, params, timeout_ms):
        self.calls.append((sql, params, timeout_ms))
        return _rows(10)


def test_db_source_reads_only_granted_columns_with_parameters():
    db = RecordingDb()
    rows = DbDemoMetricSource(db).recent(9)
    sql, params, timeout = db.calls[0]
    select = sql.split("FROM", 1)[0]
    for column in ("measured_at", "elapsed_duration", "heart_rate", "is_hr_measured", "speed", "total_distance"):
        assert column in select
    for column in ("grade", "route_progress", "device_id", "cadence"):
        assert column not in sql
    assert " id" not in sql.replace("running_session_id", "")    # id 칸 권한은 없다(정렬에도 쓰지 않는다)
    assert "ORDER BY measured_at DESC" in sql and "%(session_id)s" in sql and "%(limit)s" in sql
    assert params == {"session_id": 9, "limit": 120} and timeout == 800 and len(rows) == 3


# --- 설정 ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("value, ok", [(None, True), (3, True), (5, True), (30, True), (2.9, False), (31, False),
                                       (True, False), ("5", False)])
def test_live_metrics_sec_range(tmp_path, value, ok):
    base = demo_settings(tmp_path)
    raw = json.loads((tmp_path / "demo.json").read_text(encoding="utf-8"))
    if value is not None:
        raw["liveMetricsSec"] = value
    path = tmp_path / "demo2.json"
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    if ok:
        assert load_demo_config(path).live_metrics_sec == (float(value) if value is not None else None)
    else:
        with pytest.raises(ValueError):
            load_demo_config(path)
    assert base.config.live_metrics_sec is None                  # 기본은 꺼짐


# --- SSE ----------------------------------------------------------------------------------------------

def test_emits_on_interval_only_when_values_change_and_carries_no_ids():
    clock = {"t": 0.0}
    source = FakeMetricSource(rows={1: _rows(100)}, owners={1: 1})
    live = DemoLiveMetrics(source, targets=lambda key: [("러너", key)], every_sec=5.0, monotonic=lambda: clock["t"],
                           allowed_users=frozenset({1}))
    b = new_buffer(); b.subscribe(1); b.append(1, tr(0))

    async def sleep(seconds):
        clock["t"] += seconds
        if abs(clock["t"] - 6.0) < 1e-9:
            source.rows[1] = _rows(105, hr=160)                    # 6초째 새 업로드, 11초째는 그대로
        if abs(clock["t"] - 12.0) < 1e-9:
            source.rows[1] = _rows(110, hr=161)

    async def run():
        return [e async for e in event_stream(b, 1, snapshot={"bootId": "b"}, sleep=sleep, monotonic=lambda: clock["t"],
                                              is_disconnected=_false, max_loops=90, live=live)]

    events = asyncio.run(run())
    live_events = [json.loads(e.split("data: ", 1)[1]) for e in events if e.startswith("event: LIVE_METRICS")]
    assert [r["runners"][0]["elapsedSec"] for r in live_events] == [100, 105, 110]
    assert [r["runners"][0]["hrBpm"] for r in live_events] == [150.0, 160.0, 161.0]
    assert len(source.calls) == 4                                  # 18초 동안 5초 간격(0·5·10·15초)
    keys = set(live_events[0]["runners"][0])
    assert keys == {"label", "hrBpm", "speedMps", "paceSecPerKm", "distanceM", "elapsedSec", "measuredAt"}
    assert "userId" not in json.dumps(live_events) and "sessionId" not in json.dumps(live_events)
    # 판단 기록은 버퍼에 있던 것만, 측정값 때문에 늘지 않는다
    assert sum(e.startswith("event: MPC_TRACE") for e in events) == 0


def test_session_without_trace_is_not_read():
    source = FakeMetricSource(rows={1: _rows(10)}, owners={1: 1})
    live = DemoLiveMetrics(source, targets=lambda key: [("러너", key)], every_sec=5.0, allowed_users=frozenset({1}))
    b = new_buffer(); b.subscribe(1)                                # 버퍼 기록 없음 = 대상 회원 규칙 미통과

    async def sleep(_):
        return None

    async def run():
        return [e async for e in event_stream(b, 1, snapshot={"bootId": "b"}, sleep=sleep,
                                              is_disconnected=_false, max_loops=3, live=live)]

    events = asyncio.run(run())
    assert source.calls == [] and not any(e.startswith("event: LIVE_METRICS") for e in events)


def test_source_failure_keeps_stream_and_traces_alive(caplog):
    clock = {"t": 0.0}
    source = FakeMetricSource(fail=True, owners={1: 1})
    live = DemoLiveMetrics(source, targets=lambda key: [("러너", key)], every_sec=5.0, monotonic=lambda: clock["t"],
                           allowed_users=frozenset({1}))
    b = new_buffer(); b.subscribe(1); b.append(1, tr(0))

    async def sleep(seconds):
        clock["t"] += seconds
        if abs(clock["t"] - 1.0) < 1e-9:
            b.append(1, tr(30))

    async def run():
        return [e async for e in event_stream(b, 1, snapshot={"bootId": "b"}, sleep=sleep, monotonic=lambda: clock["t"],
                                              is_disconnected=_false, max_loops=60, live=live)]

    with caplog.at_level("WARNING", logger="runway.ai"):
        events = asyncio.run(run())
    assert sum(e.startswith("event: MPC_TRACE") for e in events) == 1
    assert not any(e.startswith("event: LIVE_METRICS") for e in events)
    warnings = [r for r in caplog.records if "실시간 측정값" in r.getMessage()]
    assert len(warnings) == 1 and "150" not in warnings[0].getMessage()
    assert live.state(1) == (0, [])


# --- 앱 배선 ------------------------------------------------------------------------------------------

def test_personal_snapshot_carries_live_metrics_only_when_subscribed(tmp_path):
    metrics = FakeMetricSource(rows={201: _rows(60, hr=158)}, owners={201: 11})
    with _client(tmp_path, metrics) as c:
        data = decide_body(); data["userId"] = 11
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        assert metrics.calls == []                                  # 콘솔 연결이 없으면 DB를 읽지 않는다
        snap = _snapshot(c, 201)
    assert [(r["label"], r["hrBpm"]) for r in snap["liveMetrics"]] == [("러너", 158.0)]
    assert metrics.calls == [201]


def test_disabled_by_default_keeps_snapshot_unchanged_and_never_reads(tmp_path):
    metrics = FakeMetricSource(rows={201: _rows(60)}, owners={201: 11})
    with _client(tmp_path, metrics, live_sec=None) as c:
        data = decide_body(); data["userId"] = 11
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        assert c.app.state.demo.live_metrics is None
        snap = _snapshot(c, 201)
    assert "liveMetrics" not in snap and metrics.calls == []


def test_null_user_allowlist_turns_feature_off(tmp_path):
    metrics = FakeMetricSource(rows={201: _rows(60)}, owners={201: 11})
    with _client(tmp_path, metrics, users=None) as c:
        data = decide_body(); data["userId"] = 11
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        assert c.app.state.demo.live_metrics is None
        snap = _snapshot(c, 201)
    assert "liveMetrics" not in snap and metrics.calls == []


def test_non_target_member_personal_run_is_not_read(tmp_path):
    metrics = FakeMetricSource(rows={202: _rows(60)}, owners={202: 12})
    with _client(tmp_path, metrics) as c:
        data = decide_body(sessionId=202); data["userId"] = 12        # 대상이 아니라 버퍼에 기록되지 않음
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        snap = _snapshot(c, 202)
    assert snap["liveMetrics"] == [] and metrics.calls == []


def test_group_reads_only_allowed_members_with_map_labels(tmp_path):
    routes = FakeRouteSource(sessions={1: 501, 2: 502})
    metrics = FakeMetricSource(rows={501: _rows(60, hr=170), 502: _rows(60, hr=150)})
    policy = lambda: MpcPolicy(load_policy_config(), flat_table(0))
    with _client(tmp_path, metrics, routes=routes, users=frozenset({2}), model=lambda: GroupModel(), policy=policy) as c:
        r = c.post("/v1/group/pace", json=body(participants=[participant(1), participant(2)]))
        assert r.status_code == 200 and "liveMetrics" not in r.json()
        snap = _snapshot(c, group_key(3))
    assert [(x["label"], x["hrBpm"]) for x in snap["liveMetrics"]] == [("러너 2", 150.0)]
    assert metrics.calls == [502] and ("session", 1) not in routes.calls
    assert "userId" not in json.dumps(snap["liveMetrics"])


def test_history_snapshot_has_no_live_metrics(tmp_path):
    metrics = FakeMetricSource(rows={201: _rows(60)}, owners={201: 11})
    with _client(tmp_path, metrics) as c:
        data = decide_body(); data["userId"] = 11
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        snap = _snapshot(c, "h201")
    assert "liveMetrics" not in snap and metrics.calls == []


# --- 리뷰 반영(A-1, A-3, A-4, A-6, A-7, A-5, B-11) -------------------------------------------------------

def test_inlet_recorded_session_of_non_target_owner_is_never_read(tmp_path):
    # A-1: AI08 inlet은 회원 확인 없이 버퍼에 기록한다. 그 세션 ID가 목록 밖 회원의 실제 세션이면 심박을 읽지 않는다
    metrics = FakeMetricSource(rows={777: _rows(60, hr=190), 201: _rows(60, hr=158)}, owners={777: 99, 201: 11})
    with _client(tmp_path, metrics) as c:
        c.app.state.demo.buffer.append(777, tr(0))              # decide 경로를 거치지 않은 기록
        snap = _snapshot(c, 777)
        assert snap["liveMetrics"] == [] and metrics.calls == []        # 목록 밖 회원: 심박 조회 0회
        assert metrics.owner_calls == [777]
        _snapshot(c, 777)
        assert metrics.owner_calls == [777]                              # 소유자 확인 결과는 기억한다
        c.app.state.demo.buffer.append(201, tr(1))
        assert [r["hrBpm"] for r in _snapshot(c, 201)["liveMetrics"]] == [158.0]    # 대상 회원 세션은 읽는다


def test_owner_lookup_failure_or_unknown_owner_does_not_read_and_retries():
    clock = {"t": 0.0}
    metrics = FakeMetricSource(rows={1: _rows(60)}, owners={1: 1}, owner_fail=True)
    live = DemoLiveMetrics(metrics, targets=lambda key: [("러너", key)], every_sec=5.0, monotonic=lambda: clock["t"],
                           allowed_users=frozenset({1}))
    live.refresh(1)
    assert live.state(1) == (0, []) and metrics.calls == []          # 소유자를 확인하지 못하면 읽지 않는다
    metrics.owner_fail = False
    clock["t"] += 6.0
    live.refresh(1)
    assert len(live.state(1)[1]) == 1                                # 실패는 기억하지 않아 다음 주기에 다시 확인한다
    unknown = FakeMetricSource(rows={1: _rows(60)}, owners={})       # 세션이 없다
    live2 = DemoLiveMetrics(unknown, targets=lambda key: [("러너", key)], every_sec=5.0, allowed_users=frozenset({1}))
    live2.refresh(1)
    assert live2.state(1) == (0, []) and unknown.calls == []


def test_latest_public_stream_carries_live_metrics_without_sessions_and_traces_still_flow(tmp_path):
    # A-7: 토큰 없는 latest(D-2). live를 켜도 판단 SNAPSHOT·이전 기록 목록 규칙은 그대로
    metrics = FakeMetricSource(rows={201: _rows(60, hr=158)}, owners={201: 11})
    with _client(tmp_path, metrics) as c:
        data = decide_body(); data["userId"] = 11
        assert c.post("/v1/pace/decide", json=data).status_code == 200
        c.app.state.demo_stream_max_loops = 0
        public = c.get("/v1/demo/sessions/latest/events")
        assert public.status_code == 200
        snap = json.loads(public.text.split("\n\n")[0].split("data: ", 1)[1])
        assert snap["sessionId"] == 201 and "sessions" not in snap
        assert [r["hrBpm"] for r in snap["liveMetrics"]] == [158.0] and len(snap["traces"]) == 1
        assert "userId" not in public.text


def test_live_events_keep_traces_and_heartbeat_flowing():
    # A-7·B-11: 측정값이 5초마다 바뀌어도 판단 이벤트와 HEARTBEAT(15초)는 그대로 나간다
    clock = {"t": 0.0}
    source = FakeMetricSource(rows={1: _rows(100)}, owners={1: 1})
    live = DemoLiveMetrics(source, targets=lambda key: [("러너", key)], every_sec=5.0, monotonic=lambda: clock["t"],
                           allowed_users=frozenset({1}))
    b = new_buffer(); b.subscribe(1); b.append(1, tr(0))

    async def sleep(seconds):
        clock["t"] += seconds
        if abs(clock["t"] - 20.0) < 1e-9:
            b.append(1, tr(30))
        step = int(clock["t"] // 5)
        source.rows[1] = _rows(100 + step * 5, hr=150 + step)         # 5초마다 새 업로드

    async def run():
        return [e async for e in event_stream(b, 1, snapshot={"bootId": "b"}, sleep=sleep, monotonic=lambda: clock["t"],
                                              is_disconnected=_false, max_loops=160, live=live)]

    events = asyncio.run(run())
    names = [e.split("\n", 1)[0] for e in events]
    assert names.count("event: LIVE_METRICS") >= 5 and names.count("event: MPC_TRACE") == 1
    assert names.count("event: HEARTBEAT") >= 1


def test_distance_does_not_flicker_when_latest_row_has_no_distance():
    # A-3: 칸 하나만 있는 행(거리 NULL)이 최신이어도 직전 거리를 쓴다
    rows = [{**_row(104), "total_distance": None}, _row(100, distance=300.0)]
    assert summarize(rows)["distanceM"] == 300.0
    old = [{**_row(104), "total_distance": None}, _row(60, distance=180.0)]          # 30초보다 오래되면 비운다
    assert summarize(old)["distanceM"] is None


def test_one_runner_failure_keeps_the_others_and_stale_labels_are_dropped():
    # A-4: 한 명 조회 실패가 다른 러너를 막지 않는다. A-6: 이번 대상에서 사라진 라벨은 지운다
    clock = {"t": 0.0}
    source = FakeMetricSource(rows={501: _rows(60, hr=170), 502: _rows(60, hr=150), 503: _rows(60, hr=140)})
    targets = {"now": [("러너 1", 501), ("러너 2", 502), ("러너 3", 503)]}
    live = DemoLiveMetrics(source, targets=lambda key: list(targets["now"]), every_sec=5.0,
                           monotonic=lambda: clock["t"], allowed_users=frozenset({1}))
    key = group_key(3)
    live.refresh(key)
    assert [(r["label"], r["hrBpm"]) for r in live.state(key)[1]] == [("러너 1", 170.0), ("러너 2", 150.0), ("러너 3", 140.0)]
    clock["t"] += 6.0
    source.fail_sessions = {502}
    source.rows[501] = _rows(65, hr=171)
    live.refresh(key)
    assert [(r["label"], r["hrBpm"]) for r in live.state(key)[1]] == [("러너 1", 171.0), ("러너 2", 150.0), ("러너 3", 140.0)]
    clock["t"] += 6.0
    source.fail_sessions = set()
    targets["now"] = [("러너 1", 501), ("러너 2", 503)]              # 참가자 하나가 빠지고 순서가 바뀜
    live.refresh(key)
    assert [(r["label"], r["hrBpm"]) for r in live.state(key)[1]] == [("러너 1", 171.0), ("러너 2", 140.0)]
    clock["t"] += 6.0
    targets["now"] = [("러너 1", 501), ("러너 2", None)]            # 진행 중 세션이 없어진 러너는 지운다
    live.refresh(key)
    assert [r["label"] for r in live.state(key)[1]] == ["러너 1"]


def test_db_reads_share_one_slot_with_route_reads():
    # A-5: 시연 조회(지도·측정값)는 공유 풀 중 연결 1개만 쓴다
    from app.demo.routes import DEMO_DB_SLOT, DbDemoRouteSource

    class Db:
        def __init__(self):
            self.free_while_reading = []

        def fetch_all_with_timeout(self, sql, params, timeout_ms):
            got = DEMO_DB_SLOT.acquire(blocking=False)        # 조회 중에는 슬롯이 잡혀 있어야 한다
            self.free_while_reading.append(got)
            if got:
                DEMO_DB_SLOT.release()
            return [{"user_id": 1, "id": 1}] if "running_sessions" in sql else []

    db = Db()
    DbDemoMetricSource(db).recent(1)
    DbDemoMetricSource(db).owner(1)
    DbDemoRouteSource(db).running_session(1)
    assert db.free_while_reading == [False, False, False]
    assert DEMO_DB_SLOT.acquire(blocking=False)                 # 끝나면 돌려준다
    DEMO_DB_SLOT.release()


def test_owner_query_uses_running_sessions_user_id_only_with_parameters():
    db = RecordingDb()
    DbDemoMetricSource(db).owner(9)
    sql, params, timeout = db.calls[0]
    assert "FROM running_sessions" in sql and "user_id" in sql and params == {"session_id": 9} and timeout == 800


def test_busy_db_slot_gives_up_within_the_wait_limit_and_keeps_last_values(monkeypatch):
    # R-1: 슬롯을 다른 조회가 잡고 있으면(DB가 느림·걸림) 제한 시간 안에 포기하고 그 주기를 건너뛴다. 스레드를 붙잡지 않는다
    import time
    from app.demo import routes
    from app.demo.routes import DEMO_DB_SLOT, DbDemoRouteSource, DbSlotBusy

    monkeypatch.setattr(routes, "SLOT_WAIT_SEC", 0.05)
    db = RecordingDb()
    assert DEMO_DB_SLOT.acquire(blocking=False)                     # 다른 조회가 슬롯을 쥐고 있다
    try:
        for call in (lambda: DbDemoMetricSource(db).recent(1), lambda: DbDemoMetricSource(db).owner(1),
                     lambda: DbDemoRouteSource(db).running_session(1)):
            started = time.monotonic()
            with pytest.raises(DbSlotBusy):
                call()
            assert time.monotonic() - started < 1.0
        assert db.calls == []                                       # DB까지 가지 않았다
        # 러너 한 명의 슬롯 대기 실패는 그 러너만 건너뛰고 마지막 값을 둔다(A-4와 같은 경로)
        clock = {"t": 0.0}
        source = FakeMetricSource(rows={501: _rows(60, hr=170)})
        live = DemoLiveMetrics(source, targets=lambda key: [("러너 1", 501)], every_sec=5.0,
                               monotonic=lambda: clock["t"], allowed_users=frozenset({1}))
        live.refresh(group_key(3))
        assert [r["hrBpm"] for r in live.state(group_key(3))[1]] == [170.0]
        clock["t"] += 6.0
        source.fail_sessions = {501}                                # 이후 조회가 실패(슬롯 대기 실패와 같은 처리)
        live.refresh(group_key(3))
        assert [r["hrBpm"] for r in live.state(group_key(3))[1]] == [170.0]
    finally:
        DEMO_DB_SLOT.release()
    DbDemoMetricSource(db).recent(1)                                # 풀리면 다시 읽는다
    assert len(db.calls) == 1


def test_full_ops_file_reads_913_keys_and_live_metrics_sec_together(tmp_path):
    # 913(시연 계정 설정)과 912(liveMetricsSec)를 합친 운영 demo_config 전체 모양: 두 묶음이 모두, 제 자리에 들어간다
    from test_demo_account_settings_913 import BASE, OPS_EXAMPLE, OVERRIDES
    raw = {**BASE, **OPS_EXAMPLE, "speedUpWarmupSec": 60, "liveMetricsSec": 5}
    path = tmp_path / "ops.json"
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    config = load_demo_config(path)
    assert config.live_metrics_sec == 5.0
    assert config.hr_threshold_overrides == OVERRIDES
    assert (config.speed_up_step_sec, config.speed_up_calm_sec, config.speed_up_margin_bpm) == (30, 30.0, 10.0)
    assert config.speed_up_warmup_sec == 60.0 and config.user_allowlist == frozenset({2, 11, 12})
    # liveMetricsSec가 없으면 꺼짐이고 913 값은 그대로
    path.write_text(json.dumps({k: v for k, v in raw.items() if k != "liveMetricsSec"}), encoding="utf-8")
    off = load_demo_config(path)
    assert off.live_metrics_sec is None and off.hr_threshold_overrides == OVERRIDES
    # 잘못된 liveMetricsSec는 913 키가 있어도 설정 전체를 거부한다(문서에 적은 동작)
    path.write_text(json.dumps({**raw, "liveMetricsSec": 2}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_demo_config(path)


def test_app_wires_live_metrics_from_full_ops_file(tmp_path, monkeypatch):
    # 설정 파일에서 읽은 값으로 앱이 실시간 측정값을 켜는지(DemoSettings 경유)
    from test_demo_account_settings_913 import BASE, OPS_EXAMPLE
    from app.demo.config import DemoSettings
    path = tmp_path / "ops.json"
    path.write_text(json.dumps({**BASE, **OPS_EXAMPLE, "liveMetricsSec": 5}), encoding="utf-8")
    settings = DemoSettings(True, "v" * 32, "i" * 32, load_demo_config(path))
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0), demo_loader=lambda: settings,
                     demo_rate_per_sec=1000, demo_route_source=FakeRouteSource(), demo_metric_source=FakeMetricSource())
    with TestClient(app) as c:
        assert c.app.state.demo.live_metrics is not None

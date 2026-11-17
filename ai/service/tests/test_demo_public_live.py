"""S15P31E105-900: 토큰 없는 latest 라이브, 진행 중 러닝 따라가기(자동 전환), 탈락 후보 선택 이유."""
import asyncio
import json
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.demo.buffer import DemoBuffer, group_key
from app.demo.stream import event_stream, waiting_stream
from app.demo.trace import build_trace
from app.main import create_app
from demo_fakes import (T, FakeModel5, FakePolicy, VIEW, decide_body, demo_settings, fixed_clock, outcome_for, tr)

WRONG = {"Authorization": "Bearer " + "x" * 32}


def _client(tmp_path, users):
    settings = demo_settings(tmp_path)
    settings = replace(settings, config=replace(settings.config, user_allowlist=users))
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0),
                     demo_loader=lambda: settings, demo_rate_per_sec=1000)
    client = TestClient(app)
    client.app.state.demo_stream_max_loops = 0
    return client


def _decide(user_id, session_id=201):
    data = decide_body(sessionId=session_id)
    data["userId"] = user_id
    return data


def _snapshot(text: str) -> dict:
    assert text.startswith("event: SNAPSHOT")
    return json.loads(text.split("data: ", 1)[1].splitlines()[0])


# ── 공개 범위 ──────────────────────────────────────────

def test_latest_is_public_only_with_user_allowlist(tmp_path):
    with _client(tmp_path, frozenset({11})) as c:
        assert c.post("/v1/pace/decide", json=_decide(11)).json()["traceId"] is not None
        public = c.get("/v1/demo/sessions/latest/events")
        assert public.status_code == 200
        snap = _snapshot(public.text)
        assert snap["sessionId"] == 201 and "sessions" not in snap        # 공개 스트림에는 이전 기록 목록 없음
        assert "userId" not in public.text                                 # 회원 ID는 SSE로 나가지 않는다
        with_token = _snapshot(c.get("/v1/demo/sessions/latest/events", headers=VIEW).text)
        assert isinstance(with_token["sessions"], list)                    # 토큰이 있으면 기존처럼 목록
        assert c.get("/v1/demo/sessions/latest/events", headers=WRONG).status_code == 401   # 틀린 토큰은 통과 안 함
        assert c.app.state.demo.buffer.subscriber_count(201) == 0             # 연결이 끝나면 칸을 돌려준다


@pytest.mark.parametrize("users", [None, frozenset()])
def test_latest_needs_token_without_user_allowlist(tmp_path, users):
    with _client(tmp_path, users) as c:
        assert c.get("/v1/demo/sessions/latest/events").status_code == 401
        assert c.get("/v1/demo/sessions/latest/events", headers=VIEW).status_code == 200


def test_other_refs_still_need_token(tmp_path):
    with _client(tmp_path, frozenset({11})) as c:
        c.post("/v1/pace/decide", json=_decide(11))
        for ref in ("201", "h201", str(group_key(3))):
            assert c.get(f"/v1/demo/sessions/{ref}/events").status_code == 401, ref
        assert c.get("/v1/demo/sessions/201/events", headers=VIEW).status_code == 200
        assert c.get("/v1/demo/sessions/h201/events", headers=VIEW).status_code == 200
        assert c.get("/v1/demo/sessions/latest/events?token=x").status_code == 400   # URL 토큰 거절은 그대로


def test_public_latest_waits_when_nothing_is_live(tmp_path):
    with _client(tmp_path, frozenset({11})) as c:
        r = c.get("/v1/demo/sessions/latest/events")
        assert r.status_code == 200
        snap = _snapshot(r.text)
        assert snap["waiting"] is True and snap["sessionId"] is None and snap["traces"] == []
        assert "sessions" not in snap
        from app.demo.stream import WAITING_KEY
        assert c.app.state.demo.buffer.subscriber_count(WAITING_KEY) == 0


def test_router_follows_only_latest_and_hides_sessions_without_token(tmp_path, monkeypatch):
    import app.demo.stream as stream
    monkeypatch.setattr(stream, "FOLLOW_EVERY_SEC", 0.0)
    monkeypatch.setattr(stream, "SESSIONS_EVERY_SEC", 0.0)
    with _client(tmp_path, frozenset({11})) as c:
        c.post("/v1/pace/decide", json=_decide(11))
        c.post("/v1/pace/decide", json=_decide(11, session_id=202))
        c.app.state.demo_stream_max_loops = 3
        buffer = c.app.state.demo.buffer
        calls = iter([201] + [202] * 20)                                  # 연결 때 201, 그 뒤 새 러닝 202
        monkeypatch.setattr(buffer, "live_target", lambda: next(calls))
        public = c.get("/v1/demo/sessions/latest/events").text
        assert "event: SESSION_SWITCH" in public and '"sessionId":202' in public.split("SESSION_SWITCH", 1)[1]
        assert "event: SESSIONS" not in public                              # 공개 스트림은 목록 이벤트도 없음
        direct = c.get("/v1/demo/sessions/201/events", headers=VIEW).text
        assert "SESSION_SWITCH" not in direct                               # 직접 지정은 자동 전환 안 함
        assert buffer.subscriber_count(201) == 0 and buffer.subscriber_count(202) == 0


# ── 진행 중 러닝 고르기 ────────────────────────────────

def _buffer():
    clock = {"t": T}
    return DemoBuffer("b", allowlist=None, now=lambda: clock["t"]), clock


def _add(buffer, sid, sec):
    buffer.append(sid, tr(sec))


def test_live_target_prefers_group_then_latest_start():
    b, clock = _buffer()
    assert b.live_target() is None
    _add(b, 101, 0)
    assert b.live_target() == 101
    clock["t"] += timedelta(seconds=5); _add(b, 102, 5)
    assert b.live_target() == 102                                 # 더 늦게 시작한 개인 러닝
    _add(b, 101, 6)
    assert b.live_target() == 102                                 # 101이 새 판단을 내도 시작 시각은 그대로
    clock["t"] += timedelta(seconds=5); _add(b, group_key(3), 10)
    clock["t"] += timedelta(seconds=5); _add(b, 103, 15)
    assert b.live_target() == group_key(3)                         # 그룹런 우선


def test_live_target_drops_finished_runs():
    import app.demo.buffer as buf
    b, clock = _buffer()
    _add(b, 101, 0)
    clock["t"] += timedelta(seconds=buf.PERSONAL_END_AFTER_SEC - 1)
    assert b.live_target() == 101
    clock["t"] += timedelta(seconds=2)
    assert b.live_target() is None                                 # 개인 30초 무판단 = 끝
    _add(b, group_key(3), 40)
    clock["t"] += timedelta(seconds=buf.PERSONAL_END_AFTER_SEC + 5)
    assert b.live_target() == group_key(3)                         # 그룹은 판단 간격이 길어 더 기다린다
    clock["t"] += timedelta(seconds=buf.GROUP_END_AFTER_SEC)
    assert b.live_target() is None
    assert b.traces(101) and b.latest_session() is not None        # 끝나도 보관 기록은 그대로(토큰 경로용)


def _events(chunks):
    return [chunk.split("\n", 1)[0].removeprefix("event: ") for chunk in chunks]


def test_stream_switches_when_target_changes():
    b, clock = _buffer()
    _add(b, 101, 0)
    assert b.subscribe(101)
    target = {"v": 101}
    t = {"v": 0.0}

    async def sleep(seconds):
        t["v"] += seconds
        if t["v"] >= 2.0:
            target["v"] = 102

    async def run():
        return [x async for x in event_stream(b, 101, snapshot={"bootId": "b"}, sleep=sleep, monotonic=lambda: t["v"],
                                              server_time=lambda: "Z", max_loops=100, follow=lambda: target["v"])]
    out = asyncio.run(run())
    assert _events(out)[0] == "SNAPSHOT" and _events(out)[-1] == "SESSION_SWITCH"
    assert json.loads(out[-1].split("data: ", 1)[1]) == {"sessionId": 102}
    assert b.subscriber_count(101) == 0                            # 끝나면 구독 칸을 돌려준다


def test_stream_reports_end_with_null_switch():
    b, _ = _buffer()
    _add(b, 101, 0)
    t = {"v": 0.0}

    async def sleep(seconds): t["v"] += seconds

    async def run():
        return [x async for x in event_stream(b, 101, snapshot={"bootId": "b"}, sleep=sleep, monotonic=lambda: t["v"],
                                              server_time=lambda: "Z", max_loops=20, follow=lambda: None)]
    out = asyncio.run(run())
    assert json.loads(out[-1].split("data: ", 1)[1]) == {"sessionId": None}


def test_stream_without_follow_never_switches():
    b, _ = _buffer()
    _add(b, 101, 0)
    t = {"v": 0.0}

    async def sleep(seconds): t["v"] += seconds

    async def run():
        return [x async for x in event_stream(b, 101, snapshot={"bootId": "b"}, sleep=sleep, monotonic=lambda: t["v"],
                                              server_time=lambda: "Z", max_loops=20)]
    assert "SESSION_SWITCH" not in _events(asyncio.run(run()))     # ?session=/?group= 직접 지정 화면


def test_waiting_stream_switches_to_new_run_and_releases():
    released = []
    t = {"v": 0.0}
    found = {"v": None}

    async def sleep(seconds):
        t["v"] += seconds
        if t["v"] >= 3.0:
            found["v"] = 205

    async def run():
        return [x async for x in waiting_stream(snapshot={"waiting": True, "sessionId": None}, target=lambda: found["v"],
                                                acquire=lambda: True,
                                                release=lambda: released.append(1), boot_id="b", sleep=sleep,
                                                monotonic=lambda: t["v"], server_time=lambda: "Z", max_loops=100)]
    out = asyncio.run(run())
    assert _events(out) == ["SNAPSHOT", "SESSION_SWITCH"]
    assert json.loads(out[-1].split("data: ", 1)[1]) == {"sessionId": 205}
    assert released == [1]


def test_waiting_slot_is_taken_only_when_body_starts():
    acquired, released = [], []

    async def run(ok):
        return [x async for x in waiting_stream(snapshot={"waiting": True}, target=lambda: 1,
                                                acquire=lambda: acquired.append(ok) or ok,
                                                release=lambda: released.append(1), boot_id="b", max_loops=0)]
    assert asyncio.run(run(False)) == [] and released == []           # 그 사이 가득 찼으면 보내지 않고 닫음
    assert len(asyncio.run(run(True))) == 1 and released == [1]


def test_waiting_connections_share_the_screen_cap(tmp_path):
    from app.demo.buffer import MAX_SUBSCRIBERS
    from app.demo.stream import WAITING_KEY
    with _client(tmp_path, frozenset({11})) as c:
        for _ in range(MAX_SUBSCRIBERS):
            c.app.state.demo.buffer.subscribe(WAITING_KEY)
        assert c.get("/v1/demo/sessions/latest/events").status_code == 429


# ── 탈락 후보 선택 이유(콘솔 칩) ───────────────────────

def test_trace_carries_selector_reason():
    outcome = outcome_for()
    traced = build_trace(replace(outcome, policy=replace(outcome.policy, selector_reason="WARMUP_CAP")),
                         boot_id="b", seq=1, stage="L1A", replay_speed=None, grade_source="SAMPLE", previous=[])
    assert traced["selectorReason"] == "WARMUP_CAP"
    plain = build_trace(outcome, boot_id="b", seq=1, stage="L1A", replay_speed=None, grade_source="SAMPLE", previous=[])
    assert "selectorReason" not in plain                            # FakePolicy처럼 이유가 없으면 키도 없다(기존 형식)


def test_mpc_policy_reports_selector_reason():
    from app.policy.config import load_policy_config
    from app.policy.mpc_policy import MpcPolicy
    from demo_fakes import flat_table, policy_input
    policy = MpcPolicy(load_policy_config(), flat_table(4.0))
    hot = {3: (150, 152, 159)}                                             # 안내 그대로는 허용선 통과 못 함
    floor = policy.decide(policy_input(pred={i: (150, 152, 159) for i in range(9)}, guidePaceSetAt=None))
    assert floor.selector_reason == "FLOOR" and floor.verdicts[floor.chosen_index].passed is False
    warm = policy.decide(policy_input(pred={**hot, 4: (150, 152, 159), 5: (150, 152, 159)}, activeSec=100,
                                      guidePaceSetAt=None))
    assert warm.selector_reason == "WARMUP_CAP" and warm.verdicts[warm.chosen_index].passed is False
    ok = policy.decide(policy_input(guidePaceSetAt=None))
    assert ok.selector_reason == "SMALL_CHANGE"

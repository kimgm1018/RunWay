"""시연 모니터링 대상 회원(userAllowlist)만 기록하는지 확인한다(S15P31E105-718)."""
import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.demo.buffer import group_key
from app.demo.config import load_demo_config
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import FakeModel5, FakePolicy, decide_body, demo_settings, fixed_clock, flat_table
from test_group_pace_ai10 import GroupModel, body, participant


def _decide(user_id=None):
    data = decide_body()
    if user_id is not None:
        data["userId"] = user_id
    return data


def _settings(tmp_path, users):
    settings = demo_settings(tmp_path)
    return replace(settings, config=replace(settings.config, user_allowlist=users))


def _decide_client(tmp_path, users):
    settings = _settings(tmp_path, users)
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0),
                     demo_loader=lambda: settings, demo_rate_per_sec=1000)
    return TestClient(app)


def _group_client(tmp_path, users):
    settings = _settings(tmp_path, users)
    app = create_app(lambda: GroupModel(), lambda: MpcPolicy(load_policy_config(), flat_table(0)),
                     clock=fixed_clock(3.0), demo_loader=lambda: settings)
    return TestClient(app)


@pytest.fixture(autouse=True)
def group_enabled(monkeypatch):
    monkeypatch.setenv("GROUP_PACE_ENABLED", "true")


def test_config_reads_user_allowlist(tmp_path):
    path = tmp_path / "demo.json"
    base = {"live": {"label": "live", "mode": "FREE", "goal": {}}}
    path.write_text(json.dumps({**base, "userAllowlist": [11, 12]}), encoding="utf-8")
    assert load_demo_config(path).user_allowlist == frozenset({11, 12})
    path.write_text(json.dumps(base), encoding="utf-8")
    assert load_demo_config(path).user_allowlist is None                       # 없으면 전체(기존 동작)
    for bad in (["abc"], [0], [True], "11"):
        path.write_text(json.dumps({**base, "userAllowlist": bad}), encoding="utf-8")
        with pytest.raises(ValueError):
            load_demo_config(path)


def test_decide_records_only_allowed_user(tmp_path):
    with _decide_client(tmp_path, frozenset({11})) as c:
        mine = c.post("/v1/pace/decide", json=_decide(11))
        assert mine.status_code == 200 and mine.json()["traceId"] is not None
        other = c.post("/v1/pace/decide", json=_decide(12))
        assert other.status_code == 200 and other.json()["traceId"] is None          # 응답은 그대로, 기록만 안 함
        anonymous = c.post("/v1/pace/decide", json=_decide())
        assert anonymous.json()["traceId"] is None                                 # userId 없으면 기록 안 함
        assert len(c.app.state.demo.buffer.traces(201)) == 1


def test_decide_records_everyone_without_user_allowlist(tmp_path):
    with _decide_client(tmp_path, None) as c:
        assert c.post("/v1/pace/decide", json=_decide(12)).json()["traceId"] is not None


def test_group_recorded_when_any_participant_is_allowed(tmp_path):
    with _group_client(tmp_path, frozenset({2})) as c:
        assert c.post("/v1/group/pace", json=body(participants=[participant(1), participant(2)])).status_code == 200
        assert len(c.app.state.demo.buffer.traces(group_key(3))) == 1


def test_group_without_allowed_participant_is_not_recorded(tmp_path):
    with _group_client(tmp_path, frozenset({9})) as c:
        r = c.post("/v1/group/pace", json=body(participants=[participant(1), participant(2)]))
        assert r.status_code == 200 and "groupPaceSecPerKm" in r.json()             # AI10 응답은 그대로
        assert c.app.state.demo.buffer.traces(group_key(3)) == []
        assert c.app.state.demo.buffer.latest_session() is None

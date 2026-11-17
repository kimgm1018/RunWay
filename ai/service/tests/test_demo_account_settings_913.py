"""시연 계정 전용 설정(S15P31E105-913): 회원별 허용선 고정, 그룹 여유 가속 시연 값, 잘못된 값 거부."""
import json
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.demo.config import load_demo_config
from app.demo.overrides import HrOverride
from app.group_pace.ahead import AheadSettings, ahead_for_group, ahead_wait
from app.group_pace.schemas import GroupPaceRequest
from app.group_pace.service import recommend_group_pace
from app.hr_threshold_lookup import HrThresholdLookupResult
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, FakeModel5, decide_body, demo_settings, fixed_clock, flat_table
from test_group_pace_ai10 import GroupModel, body, participant

BASE = {"live": {"label": "live", "mode": "FREE", "goal": {}}, "userAllowlist": [11, 12]}
OPS_EXAMPLE = {
    "userAllowlist": [2, 11, 12],
    "hrThresholdOverrides": {"11": {"sustainBpm": 163, "dangerBpm": 178},
                             "12": {"sustainBpm": 168, "dangerBpm": 183}},
    "speedUpStepSec": 30, "speedUpCalmSec": 30, "speedUpMarginBpm": 10,
}
OVERRIDES = {11: HrOverride(163.0, 178.0), 12: HrOverride(168.0, 183.0)}


def _load(tmp_path, **extra):
    path = tmp_path / "demo.json"
    path.write_text(json.dumps({**BASE, **extra}), encoding="utf-8")
    return load_demo_config(path)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("GROUP_PACE_ENABLED", "true")


# ---------------------------------------------------------------- 설정 읽기 (AC-1, AC-6, AC-7)
def test_default_config_has_no_overrides(tmp_path):
    config = _load(tmp_path)
    assert config.hr_threshold_overrides == {}
    assert (config.speed_up_step_sec, config.speed_up_calm_sec, config.speed_up_margin_bpm) == (None, None, None)


def test_ops_example_json_loads(tmp_path):
    # 문서의 운영 JSON 조각 그대로(userAllowlist [2,11,12] 포함)
    config = _load(tmp_path, **OPS_EXAMPLE)
    assert config.user_allowlist == frozenset({2, 11, 12})
    assert config.hr_threshold_overrides == OVERRIDES
    assert (config.speed_up_step_sec, config.speed_up_calm_sec, config.speed_up_margin_bpm) == (30, 30.0, 10.0)
    # 위험선을 생략하면 허용선 + 15
    omitted = _load(tmp_path, hrThresholdOverrides={"11": {"sustainBpm": 163}})
    assert omitted.hr_threshold_overrides == {11: HrOverride(163.0, 178.0)}


def test_full_ops_file_with_other_demo_keys_loads(tmp_path):
    """운영 파일 전체 모양: 913 키 + speedUpWarmupSec + 912 liveMetricsSec 같은 다른 시연 키가 한 파일에 있어도 읽힌다.
    DemoConfig는 키워드 인자로 만들어 다른 작업의 필드가 합쳐져도 913 값이 엉뚱한 자리로 들어가지 않는다."""
    config = _load(tmp_path, **OPS_EXAMPLE, speedUpWarmupSec=60, liveMetricsSec=5)
    assert config.hr_threshold_overrides == OVERRIDES
    assert (config.speed_up_step_sec, config.speed_up_calm_sec, config.speed_up_margin_bpm) == (30, 30.0, 10.0)
    assert config.speed_up_warmup_sec == 60.0 and config.user_allowlist == frozenset({2, 11, 12})


def test_startup_logs_applied_account_settings_without_user_ids(tmp_path, monkeypatch, caplog):
    path = tmp_path / "demo.json"
    path.write_text(json.dumps({**BASE, **OPS_EXAMPLE}), encoding="utf-8")
    monkeypatch.setenv("DEMO_STREAM_ENABLED", "true")
    monkeypatch.setenv("DEMO_VIEW_TOKEN", "v" * 32)
    monkeypatch.setenv("DEMO_INGEST_TOKEN", "i" * 32)
    monkeypatch.setenv("DEMO_CONFIG_PATH", str(path))
    from app.demo.config import load_demo_settings
    with caplog.at_level("INFO", logger="runway.ai"):
        assert load_demo_settings().enabled is True
    line = next(r.getMessage() for r in caplog.records if "시연 계정 설정" in r.getMessage())
    assert line == "시연 계정 설정: 고정 2명, 가속 폭 30·확인 30·여유 10·대기 60"
    assert "11" not in line and "163" not in line


@pytest.mark.parametrize("extra", [
    {"speedUpStepSec": 5}, {"speedUpStepSec": 15}, {"speedUpStepSec": 31}, {"speedUpStepSec": 40},
    {"speedUpStepSec": True}, {"speedUpStepSec": "30"}, {"speedUpStepSec": None},
    {"speedUpCalmSec": 29}, {"speedUpCalmSec": 301}, {"speedUpCalmSec": True}, {"speedUpCalmSec": "60"},
    {"speedUpMarginBpm": -1}, {"speedUpMarginBpm": 41}, {"speedUpMarginBpm": True}, {"speedUpMarginBpm": "10"},
    {"hrThresholdOverrides": "11"}, {"hrThresholdOverrides": [11]}, {"hrThresholdOverrides": None},
    {"hrThresholdOverrides": {"abc": {"sustainBpm": 163}}},
    {"hrThresholdOverrides": {"0": {"sustainBpm": 163}}},
    {"hrThresholdOverrides": {"011": {"sustainBpm": 163}}},
    {"hrThresholdOverrides": {" 11": {"sustainBpm": 163}}},
    {"hrThresholdOverrides": {"-11": {"sustainBpm": 163}}},
    {"hrThresholdOverrides": {"11": 163}},
    {"hrThresholdOverrides": {"11": {"dangerBpm": 178}}},
    {"hrThresholdOverrides": {"11": {"sustainBpm": 34, "dangerBpm": 178}}},
    {"hrThresholdOverrides": {"11": {"sustainBpm": 163, "dangerBpm": 221}}},
    {"hrThresholdOverrides": {"11": {"sustainBpm": 206}}},              # 위험선 기본값 221이 범위 밖
    {"hrThresholdOverrides": {"11": {"sustainBpm": 170, "dangerBpm": 170}}},
    {"hrThresholdOverrides": {"11": {"sustainBpm": 180, "dangerBpm": 170}}},
    {"hrThresholdOverrides": {"11": {"sustainBpm": True, "dangerBpm": 178}}},
    {"hrThresholdOverrides": {"11": {"sustainBpm": "163", "dangerBpm": 178}}},
    {"hrThresholdOverrides": {"11": {"sustainBpm": float("nan"), "dangerBpm": 178}}},
    {"hrThresholdOverrides": {"11": {"sustainBpm": 163, "dangerBpm": 178, "x": 1}}},
])
def test_invalid_values_are_rejected(tmp_path, extra):
    with pytest.raises(ValueError):
        _load(tmp_path, **extra)


@pytest.mark.parametrize("extra", [
    {"userAllowlist": [11, 12], "hrThresholdOverrides": {"99": {"sustainBpm": 163}}},   # 목록 밖
    {"userAllowlist": None, "hrThresholdOverrides": {"11": {"sustainBpm": 163}}},        # 목록 null
    {"userAllowlist": [], "hrThresholdOverrides": {"11": {"sustainBpm": 163}}},          # 빈 목록
])
def test_override_for_user_outside_allowlist_is_rejected(tmp_path, extra):
    with pytest.raises(ValueError):
        _load(tmp_path, **extra)


# ---------------------------------------------------------------- AI04
class Row:
    """DB 행: 학습값이 121로 낮다(리허설을 거듭한 상태)."""
    def __init__(self, value=121.0):
        self.result = HrThresholdLookupResult(value, value, 5)

    def get_for_user(self, _user_id):
        return self.result


class LowReadiness:
    def score_for(self, user_id, day):
        return 45.0, None


def _decide(tmp_path, monkeypatch, overrides, user_id=11, users=frozenset({11, 12}), readiness=True):
    monkeypatch.setenv("READINESS_ADJUST_ENABLED", "true" if readiness else "false")
    base = demo_settings(tmp_path)
    settings = replace(base, config=replace(base.config, user_allowlist=users, hr_threshold_overrides=overrides))
    data = decide_body()
    data["userId"] = user_id
    policy = MpcPolicy(load_policy_config(), flat_table(0.0))
    app = create_app(lambda: FakeModel5(), lambda: policy, clock=fixed_clock(3.0), demo_loader=lambda: settings,
                     demo_rate_per_sec=1000, hr_threshold_lookup=Row(),
                     readiness_lookup=LowReadiness() if readiness else None)
    with TestClient(app) as client:
        response = client.post("/v1/pace/decide", json=data)
        assert response.status_code == 200
        return response.json(), client.app.state.demo.buffer.traces(201)


def test_decide_without_override_is_identical(tmp_path, monkeypatch):
    base, _ = _decide(tmp_path, monkeypatch, {}, users=frozenset({99}))
    for other in ({11: HrOverride(163.0, 178.0)},):
        # 고정 맵이 있어도 그 회원이 아니면(userId 73) 같은 응답이다
        data, _ = _decide(tmp_path, monkeypatch, other, user_id=73, users=frozenset({99}))
        assert data == base
    assert base["pacing"]["hrSustainBpm"] != 163.0


def test_decide_fixed_member_ignores_db_and_readiness(tmp_path, monkeypatch):
    base, _ = _decide(tmp_path, monkeypatch, {}, users=frozenset({99}))
    assert base["pacing"].get("readinessAdjustBpm") == pytest.approx(3.75)     # 보정이 켜져 있는 상태
    fixed, _ = _decide(tmp_path, monkeypatch, OVERRIDES)
    pacing = fixed["pacing"]
    assert (pacing["hrSustainBpm"], pacing["hrDangerBpm"]) == (163.0, 178.0)
    assert pacing["hrThresholdSource"] == "PERSONAL" and pacing["hrThresholdWeight"] == 1.0
    assert all(pacing.get(key) is None for key in ("readinessAdjustBpm", "readinessScore", "readinessWeight"))
    other, _ = _decide(tmp_path, monkeypatch, OVERRIDES, user_id=12)
    assert (other["pacing"]["hrSustainBpm"], other["pacing"]["hrDangerBpm"]) == (168.0, 183.0)


def test_decide_trace_reference_uses_fixed_values(tmp_path, monkeypatch):
    _, traces = _decide(tmp_path, monkeypatch, OVERRIDES)
    assert len(traces) == 1
    reference = traces[0]["reference"]
    assert (reference["hrSustainBpm"], reference["hrDangerBpm"]) == (163.0, 178.0)
    assert 163.0 <= reference["allowBpm"] <= 178.0
    assert "readiness" not in traces[0]


def test_decide_one_cell_plan_hold_uses_fixed_values():
    """기록이 한 칸뿐인 PLAN_HOLD 경로도 고정 기준을 쓴다. 심박 177은 모집단 위험선(178) 아래라 계획 유지이고,
    고정 위험선 170이면 SAFETY다."""
    from app.decide.schemas import DecideRequest
    from app.decide.service import run_decide
    from datetime import datetime, timezone
    data = decide_body(plan=[{"startM": 0, "endM": 5000, "ratio": 1.0}], activeSec=10,
                       history={"hrBpm": [177.0], "speedMps": [3.0], "gradePct": [0.0]})
    data["userId"] = 11
    data["history"] = {"hrBpm": [177.0], "speedMps": [3.0], "gradePct": [0.0]}
    now = datetime(2026, 11, 5, 5, 16, 36, tzinfo=timezone.utc)
    request = DecideRequest.model_validate(data)
    policy = MpcPolicy(load_policy_config(), flat_table(0.0))
    kwargs = dict(received_at=now, now=lambda: now, hr_threshold_lookup=None, hr_threshold_lookup_configured=False)
    plain = run_decide(request, FakeModel5(), policy, **kwargs).response
    fixed = run_decide(request, FakeModel5(), policy, hr_overrides={11: HrOverride(150.0, 170.0)}, **kwargs).response
    assert "HISTORY_TOO_SHORT_PLAN_HOLD" in plain.warnings and "HISTORY_TOO_SHORT_PLAN_HOLD" in fixed.warnings
    assert plain.status == "OK" and plain.pacing.hr_danger_bpm == 178.0
    assert fixed.status == "SAFETY" and (fixed.pacing.hr_sustain_bpm, fixed.pacing.hr_danger_bpm) == (150.0, 170.0)
    other = run_decide(request, FakeModel5(), policy, hr_overrides={12: HrOverride(150.0, 170.0)}, **kwargs).response
    assert other == plain


# ---------------------------------------------------------------- AI10
class PerUserRow:
    def __init__(self, value=121.0):
        self.value = value

    def get_for_user(self, _user_id):
        return HrThresholdLookupResult(self.value, self.value, 5)


def _group(data, *, overrides=None, config=None, model=None, readiness=None, lookup=None, ahead=None,
           detail=None):
    """main.py의 /v1/group/pace와 같은 순서로 시연 설정을 적용한다."""
    request = GroupPaceRequest.model_validate(data)
    wait, demo_wait = (None, False)
    if ahead is not None:
        wait, demo_wait = ahead_wait(ahead, config, request.participants)
        ahead = ahead_for_group(ahead, config, request.participants)
    if config is not None:
        overrides = config.hr_threshold_overrides
    return recommend_group_pace(
        request, model or GroupModel(), MpcPolicy(load_policy_config(), flat_table(0)),
        hr_threshold_lookup=lookup, hr_threshold_lookup_configured=lookup is not None, detail=detail,
        readiness_lookup=readiness, ahead=ahead, ahead_wait_sec=wait, ahead_demo_wait=demo_wait,
        hr_overrides=overrides)


def _members(*ids, hr=150.0):
    return [participant(i, pace=340, hr=hr) for i in ids]


def test_group_without_override_is_identical():
    data = body(participants=_members(11, 12, 5), progressRatio=0.0)
    results = []
    for overrides in (None, {}, {99: HrOverride(150.0, 160.0)}):
        detail = {}
        results.append((_group(data, overrides=overrides, lookup=PerUserRow(), detail=detail).model_dump(), detail))
    assert results[0] == results[1] == results[2]


def test_group_fixed_members_use_their_own_lines():
    data = body(participants=_members(11, 12, 5), progressRatio=0.0)
    off = {}
    _group(data, lookup=PerUserRow(), readiness=LowReadiness(), detail=off)
    on = {}
    _group(data, overrides=OVERRIDES, lookup=PerUserRow(), readiness=LowReadiness(), detail=on)
    first, second, third = on["members"]
    assert (first["allow"], first["danger"]) == (163.0, 178.0)
    assert (second["allow"], second["danger"]) == (168.0, 183.0)
    assert first["readiness"] is None and second["readiness"] is None          # 준비도 보정 무시
    assert off["members"][0]["allow"] < 163.0                                   # 고정이 없으면 DB 121 + 보정으로 낮다
    # 고정 대상이 아닌 회원은 기존 값 그대로(허용선·위험선·준비도 기록)
    assert third == off["members"][2]
    assert third["readiness"]["adjustBpm"] > 0


def test_group_trace_shows_fixed_allow_line():
    from app.demo.group_trace import build_group_trace
    data = body(participants=_members(11, 12), progressRatio=0.0)
    detail = {}
    response = _group(data, overrides=OVERRIDES, lookup=PerUserRow(), detail=detail)
    trace = build_group_trace(GroupPaceRequest.model_validate(data), response, detail, boot_id="b", seq=1,
                              stage="L1A", label="시연", policy_version="p", decided_at=T0, decide_ms=1.0)
    members = trace["group"]["members"]
    assert [(m["allowBpm"], m["dangerBpm"]) for m in members] == [(163.0, 178.0), (168.0, 183.0)]
    assert trace["reference"]["allowBpm"] in (163.0, 168.0)


# ---------------------------------------------------------------- 여유 가속 시연 값
CALM = GroupModel(lambda pace, hr: [120.0] * 3)
ON = AheadSettings()


def _demo_config(tmp_path):
    return _load(tmp_path, **OPS_EXAMPLE)


def _ahead_request(ids=(11, 12), hrs=(150, 155), pace=320, **overrides):
    members = [participant(i, pace=pace, hr=hr, n=24) for i, hr in zip(ids, hrs)]
    data = dict(currentGroupPaceSecPerKm=pace, goalPaceSecPerKm=None, startRecommendedPaceSecPerKm=320,
                elapsedSec=60, participants=members, progressRatio=0.0)
    data.update(overrides)
    return body(**data)


def test_demo_group_ahead_30_after_60s(tmp_path):
    config = _demo_config(tmp_path)
    detail = {}
    result = _group(_ahead_request(), config=config, model=CALM, ahead=ON, detail=detail)
    assert (result.group_pace_sec_per_km, result.direction, result.reason) == (290, "FAST", "AHEAD")
    info = detail["ahead"]
    assert (info["applied"], info["stepSec"], info["steadySec"], info["marginBpm"]) == (True, 30, 30, 10.0)
    assert info["waitSec"] == 60.0 and info["demoWait"] is True
    # 기본 여유 기준 15였다면(163-15=148 < 심박 150) 같은 입력은 가속하지 않는다
    plain = {}
    base = _group(_ahead_request(), config=replace(config, speed_up_margin_bpm=None, speed_up_calm_sec=None,
                                                    speed_up_step_sec=None),
                  model=CALM, ahead=ON, detail=plain)
    assert base.group_pace_sec_per_km == 320 and plain["ahead"]["blockedBy"] == "NOT_STEADY"


@pytest.mark.parametrize("request_changes,blocked", [
    (dict(elapsedSec=59), "WAITING"),
    (dict(lastChange={"direction": "FAST", "changedAt": (T0 - timedelta(seconds=60)).isoformat()}), "COOLDOWN"),
    (dict(currentGroupPaceSecPerKm=290, participants=[participant(11, pace=290, hr=150, n=24),
                                                      participant(12, pace=290, hr=155, n=24)]), "AT_MAX"),
])
def test_demo_group_ahead_guards(tmp_path, request_changes, blocked):
    config = _demo_config(tmp_path)
    detail = {}
    result = _group(_ahead_request(**request_changes), config=config, model=CALM, ahead=ON, detail=detail)
    assert detail["ahead"]["blockedBy"] == blocked
    assert result.reason != "AHEAD"


def test_demo_group_ahead_needs_calm_30s_below_allow_minus_10(tmp_path):
    config = _demo_config(tmp_path)
    shaky = participant(12, pace=320, hr=155, n=24)
    shaky["history"]["hrBpm"][-3] = 159                 # 15초 전 한 칸이 168−10=158 위
    detail = {}
    result = _group(_ahead_request(participants=[participant(11, pace=320, hr=150, n=24), shaky]),
                    config=config, model=CALM, ahead=ON, detail=detail)
    assert result.group_pace_sec_per_km == 320 and detail["ahead"]["blockedBy"] == "NOT_STEADY"
    old = participant(12, pace=320, hr=155, n=24)
    old["history"]["hrBpm"][-8] = 170                   # 30초보다 오래전이면 상관없다
    assert _group(_ahead_request(participants=[participant(11, pace=320, hr=150, n=24), old]),
                  config=config, model=CALM, ahead=ON).group_pace_sec_per_km == 290


def test_non_demo_group_keeps_defaults(tmp_path):
    config = _demo_config(tmp_path)
    others = dict(ids=(5, 6), hrs=(130, 130))
    waiting = {}
    assert _group(_ahead_request(**others), config=config, model=CALM, ahead=ON,
                  detail=waiting).group_pace_sec_per_km == 320
    assert waiting["ahead"]["blockedBy"] == "WAITING" and waiting["ahead"]["waitSec"] == 180.0
    detail = {}
    result = _group(_ahead_request(elapsedSec=300, **others), config=config, model=CALM, ahead=ON, detail=detail)
    assert result.group_pace_sec_per_km == 310                                  # 한 번에 10초
    info = detail["ahead"]
    assert (info["stepSec"], info["steadySec"], info["marginBpm"], info["demoWait"]) == (10, 60, 15.0, False)


def test_ahead_for_group_keeps_settings_when_no_demo_member(tmp_path):
    config = _demo_config(tmp_path)
    request = GroupPaceRequest.model_validate(_ahead_request(ids=(5, 6)))
    assert ahead_for_group(ON, config, request.participants) is ON
    assert ahead_for_group(ON, None, request.participants) is ON
    with_demo = GroupPaceRequest.model_validate(_ahead_request(ids=(5, 12)))
    tuned = ahead_for_group(ON, config, with_demo.participants)
    assert (tuned.step_sec, tuned.calm_window_sec, tuned.margin_bpm) == (30, 30.0, 10.0)
    assert (ON.step_sec, ON.calm_window_sec, ON.margin_bpm) == (10, 60.0, 15.0)    # 원본은 그대로
    # 시연 값이 일부만 있으면 나머지는 기본(환경변수 값)
    partial = replace(config, speed_up_step_sec=None, speed_up_calm_sec=None)
    kept = ahead_for_group(ON, partial, with_demo.participants)
    assert (kept.step_sec, kept.calm_window_sec, kept.margin_bpm) == (10, 60.0, 10.0)

"""시연 그룹 강제 여유 가속(S15P31E105-915): speedUpForceAfterSec 이후 출발 페이스 − 30으로 한 번 올린다.
출발 추천 540초/km, 회원 11·12(허용·위험 심박 163/178, 168/183 고정)."""
import json
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.demo.buffer import group_key
from app.demo.config import load_demo_config
from app.group_pace.ahead import AheadSettings, ahead_for_group, ahead_wait, force_ahead_for_group
from app.group_pace.schemas import GroupPaceRequest
from app.group_pace.service import recommend_group_pace
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, demo_settings, fixed_clock, flat_table
from test_group_pace_ai10 import GroupModel, body, participant

OPS = {
    "live": {"label": "live", "mode": "FREE", "goal": {}},
    "userAllowlist": [2, 11, 12],
    "hrThresholdOverrides": {"11": {"sustainBpm": 163, "dangerBpm": 178},
                             "12": {"sustainBpm": 168, "dangerBpm": 183}},
    "speedUpWarmupSec": 60, "speedUpStepSec": 30, "speedUpCalmSec": 30, "speedUpMarginBpm": 0,
}
CALM = GroupModel(lambda pace, hr: [120.0] * 3)
HOT = GroupModel(lambda pace, hr: [190.0] * 3)      # 예측이 허용선을 넘어 평소라면 감속한다


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("GROUP_PACE_ENABLED", "true")


def _config(tmp_path, **extra):
    path = tmp_path / "demo.json"
    path.write_text(json.dumps({**OPS, **extra}), encoding="utf-8")
    return load_demo_config(path)


def _members(ids=(11, 12), hrs=(150, 155), pace=540):
    return [participant(i, pace=pace, hr=hr, n=24) for i, hr in zip(ids, hrs)]


def _request(elapsed=70, pace=540, **overrides):
    data = dict(currentGroupPaceSecPerKm=pace, goalPaceSecPerKm=None, startRecommendedPaceSecPerKm=540,
                elapsedSec=elapsed, participants=_members(pace=pace), progressRatio=0.0)
    data.update(overrides)
    return body(**data)


def _ago(seconds, direction="SLOW"):
    return {"direction": direction, "changedAt": (T0 - timedelta(seconds=seconds)).isoformat()}


def _run(data, config, *, model=CALM, ahead=None, detail=None):
    """main.py의 /v1/group/pace와 같은 순서로 시연 설정을 적용한다."""
    request = GroupPaceRequest.model_validate(data)
    wait, demo_wait = (None, False)
    if ahead is not None:
        wait, demo_wait = ahead_wait(ahead, config, request.participants)
        ahead = ahead_for_group(ahead, config, request.participants)
    return recommend_group_pace(
        request, model, MpcPolicy(load_policy_config(), flat_table(0)), hr_threshold_lookup=None,
        hr_threshold_lookup_configured=False, detail=detail, ahead=ahead, ahead_wait_sec=wait,
        ahead_demo_wait=demo_wait, hr_overrides=config.hr_threshold_overrides,
        force_ahead=force_ahead_for_group(config, request.participants))


# ---------------------------------------------------------------- 설정 읽기
def test_force_key_defaults_to_off_and_null_is_off(tmp_path):
    assert _config(tmp_path).speed_up_force_after_sec is None
    assert _config(tmp_path, speedUpForceAfterSec=None).speed_up_force_after_sec is None
    assert _config(tmp_path, speedUpForceAfterSec=60).speed_up_force_after_sec == 60.0
    assert _config(tmp_path, speedUpForceAfterSec=0).speed_up_force_after_sec == 0.0
    assert _config(tmp_path, speedUpForceAfterSec=600).speed_up_force_after_sec == 600.0


@pytest.mark.parametrize("value", [-1, 601, True, "60", float("nan")])
def test_force_key_rejects_invalid_values(tmp_path, value):
    with pytest.raises(ValueError):
        _config(tmp_path, speedUpForceAfterSec=value)


# ---------------------------------------------------------------- 회귀: 꺼짐·시연 회원 없음·GOAL
def test_off_without_setting_is_identical(tmp_path):
    config = _config(tmp_path)
    plain = recommend_group_pace(GroupPaceRequest.model_validate(_request()), CALM,
                                 MpcPolicy(load_policy_config(), flat_table(0)), hr_threshold_lookup=None,
                                 hr_threshold_lookup_configured=False, hr_overrides=config.hr_threshold_overrides)
    assert _run(_request(), config) == plain
    assert plain.reason != "AHEAD" and plain.group_pace_sec_per_km == 540
    detail = {}
    _run(_request(), config, detail=detail)
    assert "forceAhead" not in detail


def test_group_without_demo_member_is_not_forced(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    request = _request(participants=_members(ids=(5, 6)))
    result = _run(request, config)
    assert result.reason != "AHEAD" and result.group_pace_sec_per_km == 540
    assert force_ahead_for_group(config, GroupPaceRequest.model_validate(request).participants) is None
    assert force_ahead_for_group(None, GroupPaceRequest.model_validate(request).participants) is None


def test_goal_mode_is_not_forced(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    result = _run(_request(paceMode="GOAL", goalPaceSecPerKm=540), config)
    assert result.reason != "AHEAD" and result.group_pace_sec_per_km == 540


def test_no_start_pace_is_not_forced(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    result = _run(_request(startRecommendedPaceSecPerKm=None), config)
    assert result.reason != "AHEAD"


# ---------------------------------------------------------------- 시연 그룹 강제 가속
def test_before_the_set_time_nothing_is_forced(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    detail = {}
    result = _run(_request(elapsed=59), config, detail=detail)
    assert result.reason != "AHEAD" and result.group_pace_sec_per_km == 540
    assert detail["forceAhead"]["applied"] is False and detail["forceAhead"]["blockedBy"] == "WAITING"


def test_first_judgment_after_the_set_time_goes_540_to_510(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    detail = {}
    result = _run(_request(elapsed=69), config, detail=detail)
    assert (result.group_pace_sec_per_km, result.changed, result.direction, result.reason) == (510, True, "FAST", "AHEAD")
    assert detail["forceAhead"] == {"afterSec": 60.0, "stepSec": 30, "applied": True, "blockedBy": None}
    assert detail["ahead"]["forced"] is True and detail["ahead"]["applied"] is True
    assert detail["chosen"] == detail["paces"].index(510)
    # 응답 계약은 기존 AHEAD와 같은 모양이다(필드 추가 없음)
    assert set(result.model_dump()) == set(_run(_request(elapsed=69), _config(tmp_path)).model_dump())


def test_forced_even_when_the_ahead_switch_is_on_and_blocked(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    detail = {}
    result = _run(_request(elapsed=69, participants=_members(hrs=(162, 167))), config, ahead=AheadSettings(),
                  detail=detail)                         # 허용선 163/168 코앞이라 평소 여유 가속은 NOT_STEADY/NO_MARGIN
    assert (result.group_pace_sec_per_km, result.reason) == (510, "AHEAD")
    assert detail["ahead"]["forced"] is True


def test_forced_when_heart_rate_is_missing(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    members = [participant(11, pace=540, hr=150, n=24), participant(12, pace=540, hr=None, n=24)]
    result = _run(_request(participants=members), config, ahead=AheadSettings())
    assert (result.group_pace_sec_per_km, result.reason) == (510, "AHEAD")      # 기존이면 NOT_ALL_HR


def test_forced_when_there_is_no_margin_and_a_slowdown_would_be_chosen(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    plain = _run(_request(), replace(config, speed_up_force_after_sec=None), model=HOT)
    assert plain.direction == "SLOW"                                            # 강제가 없으면 감속이다
    result = _run(_request(), config, model=HOT)
    assert (result.group_pace_sec_per_km, result.direction, result.reason) == (510, "FAST", "AHEAD")


def test_forced_during_cooldown(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    # 출발 38초에 한 번 늦춰졌다(지금은 32초 전). 쿨다운 120초 안이지만 강제 시각(60초) 전의 변경이다
    request = _request(elapsed=70, pace=550, lastChange=_ago(32), participants=_members(pace=550))
    result = _run(request, config, ahead=AheadSettings())
    assert (result.group_pace_sec_per_km, result.direction, result.reason) == (510, "FAST", "AHEAD")


def test_slowed_start_state_still_targets_start_minus_30(tmp_path):
    """출발 직후 HR_LIMIT 감속으로 560이 된 상태에서도 목표는 출발 540 − 30 = 510이다(후보에 없는 −50)."""
    config = _config(tmp_path, speedUpForceAfterSec=60)
    for current in (550, 560, 570):
        request = _request(elapsed=70, pace=current, lastChange=_ago(32), participants=_members(pace=current))
        detail = {}
        result = _run(request, config, detail=detail)
        assert (result.group_pace_sec_per_km, result.direction, result.reason) == (510, "FAST", "AHEAD"), current
        assert result.struggling_count >= 0 and detail["ahead"]["forced"] is True


def test_not_forced_again_once_accelerated(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    detail = {}
    result = _run(_request(elapsed=100, pace=510, lastChange=_ago(31, "FAST"), participants=_members(pace=510)),
                  config, detail=detail)
    assert result.reason != "AHEAD" and result.changed is False and result.group_pace_sec_per_km == 510
    assert detail["forceAhead"]["blockedBy"] == "ALREADY_FAST"


def test_safety_slowdown_after_forcing_is_not_overridden(tmp_path):
    """510으로 올린 뒤 안전 감속(520)이 나왔다면 같은 강제를 다시 내서 감속과 싸우지 않는다."""
    config = _config(tmp_path, speedUpForceAfterSec=60)
    detail = {}
    result = _run(_request(elapsed=100, pace=520, lastChange=_ago(20), participants=_members(pace=520)),
                  config, detail=detail)
    assert result.reason != "AHEAD"
    assert detail["forceAhead"]["blockedBy"] == "ALREADY_FORCED"


def test_not_forced_when_a_member_is_at_the_danger_line(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    for hrs in ((178, 150), (150, 183), (190, 150)):            # 회원 11은 178, 12는 183이 위험선
        detail = {}
        result = _run(_request(participants=_members(hrs=hrs)), config, detail=detail)
        assert result.reason != "AHEAD", hrs
        assert detail["forceAhead"]["applied"] is False and detail["forceAhead"]["blockedBy"] == "DANGER_HR"
    just_below = _run(_request(participants=_members(hrs=(177, 182))), config)
    assert (just_below.group_pace_sec_per_km, just_below.reason) == (510, "AHEAD")


def test_danger_uses_the_latest_measured_value(tmp_path):
    config = _config(tmp_path, speedUpForceAfterSec=60)
    spiked = participant(11, pace=540, hr=150, n=24)
    spiked["history"]["hrBpm"][-2] = 179                        # 한 칸 전 순간 상승은 지금 심박이 아니다
    result = _run(_request(participants=[spiked, participant(12, pace=540, hr=155, n=24)]), config)
    assert (result.group_pace_sec_per_km, result.reason) == (510, "AHEAD")
    spiked["history"]["hrBpm"][-1] = 179                        # 지금 심박이 위험선 이상이면 막힌다
    blocked = _run(_request(participants=[spiked, participant(12, pace=540, hr=155, n=24)]), config)
    assert blocked.reason != "AHEAD"


# ---------------------------------------------------------------- 콘솔 기록
def test_console_trace_shows_a_normal_ahead_card_with_forced_marker(tmp_path):
    from app.demo.group_trace import build_group_trace
    config = _config(tmp_path, speedUpForceAfterSec=60)
    data = _request(elapsed=69)
    detail = {}
    response = _run(data, config, detail=detail)
    trace = build_group_trace(GroupPaceRequest.model_validate(data), response, detail, boot_id="b", seq=1,
                              stage="L1A", label="시연", policy_version="p", decided_at=T0, decide_ms=1.0)
    decision = trace["decision"]
    assert (decision["reasonCode"], decision["direction"], decision["recommendedPaceSecPerKm"]) == ("AHEAD", "FAST", 510.0)
    # 915 후속: 화면 문구는 일반 여유 가속과 같다. 시연 설정 여부는 trace의 group.ahead.forced에만 남는다.
    assert "시연 설정" not in decision["reasonText"] and "심박 여유" in decision["reasonText"]
    assert trace["group"]["ahead"]["forced"] is True


# ---------------------------------------------------------------- /v1/group/pace 연결
def test_endpoint_applies_force_only_to_demo_groups(tmp_path):
    base = demo_settings(tmp_path)
    config = replace(base.config, user_allowlist=frozenset({2, 11, 12}), speed_up_force_after_sec=60.0,
                     speed_up_step_sec=None)
    settings = replace(base, config=config)
    app = create_app(lambda: CALM, lambda: MpcPolicy(load_policy_config(), flat_table(0)),
                     clock=fixed_clock(3.0), demo_loader=lambda: settings)
    with TestClient(app) as client:
        mine = client.post("/v1/group/pace", json=_request(elapsed=69))
        assert mine.status_code == 200
        assert (mine.json()["groupPaceSecPerKm"], mine.json()["reason"], mine.json()["direction"]) == (510, "AHEAD", "FAST")
        trace = client.app.state.demo.buffer.traces(group_key(3))[-1]
        assert trace["group"]["ahead"]["forced"] is True
        other = client.post("/v1/group/pace", json=_request(elapsed=69, participants=_members(ids=(5, 6))))
        assert other.json()["reason"] != "AHEAD" and other.json()["groupPaceSecPerKm"] == 540
        early = client.post("/v1/group/pace", json=_request(elapsed=40))
        assert early.json()["reason"] != "AHEAD"

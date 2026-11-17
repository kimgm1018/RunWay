"""AI10 여유 가속(S15P31E105-728). 기본 회원의 출발 허용 심박은 163 bpm, 여유선은 163 − 15 = 148 bpm이다."""
from datetime import timedelta
from types import SimpleNamespace

import pytest

from app.group_pace.ahead import AheadSettings, ahead_wait, load_ahead_settings
from demo_fakes import T0
from test_group_pace_ai10 import GroupModel, body, participant, run as run_ai10

ON = AheadSettings()
CALM = GroupModel(lambda pace, hr: [120.0] * 3)


def calm(user_id=1, hr=130, **kw):
    return participant(user_id, pace=320, hr=hr, n=24, **kw)


def request(**overrides):
    data = dict(currentGroupPaceSecPerKm=320, goalPaceSecPerKm=None, startRecommendedPaceSecPerKm=320,
                elapsedSec=300, participants=[calm(1), calm(2)])
    data.update(overrides)
    return body(**data)


def run(data, model=CALM, ahead=ON, wait=None, detail=None):
    from app.group_pace.schemas import GroupPaceRequest
    from app.group_pace.service import recommend_group_pace
    from app.policy.config import load_policy_config
    from app.policy.mpc_policy import MpcPolicy
    from demo_fakes import flat_table

    return recommend_group_pace(GroupPaceRequest.model_validate(data), model,
                                MpcPolicy(load_policy_config(), flat_table(0)), hr_threshold_lookup=None,
                                hr_threshold_lookup_configured=False, detail=detail, ahead=ahead,
                                ahead_wait_sec=wait)


def test_switch_off_is_bit_identical():
    assert run(request(), ahead=None) == run_ai10(request(), CALM)
    assert run(request(), ahead=None).group_pace_sec_per_km == 320


def test_all_calm_speeds_up_one_step_past_the_start_pace():
    detail = {}
    result = run(request(), detail=detail)
    assert (result.group_pace_sec_per_km, result.direction, result.reason) == (310, "FAST", "AHEAD")
    assert detail["ahead"]["applied"] is True and detail["ahead"]["fastestPace"] == 290


def test_goal_mode_keeps_the_goal_as_the_cap():
    detail = {}
    result = run(request(paceMode="GOAL", goalPaceSecPerKm=320), detail=detail)
    assert result.group_pace_sec_per_km == 320 and detail["ahead"]["blockedBy"] == "GOAL_MODE"


@pytest.mark.parametrize("members", [
    [calm(1), dict(calm(2), userId=None)],          # 속도만(미동의)
    [calm(1), dict(calm(2), active=False)],         # 제외
])
def test_everyone_must_be_judged_by_heart_rate(members):
    detail = {}
    assert run(request(participants=members), detail=detail).group_pace_sec_per_km == 320
    assert detail["ahead"]["blockedBy"] == "NOT_ALL_HR"


def test_prediction_must_stay_15_bpm_under_the_allowed_line():
    detail = {}
    result = run(request(), model=GroupModel(lambda pace, hr: [150.0] * 3), detail=detail)
    assert result.group_pace_sec_per_km == 320 and detail["ahead"]["blockedBy"] == "NO_MARGIN"


def test_the_margin_must_have_held_for_the_last_minute_of_measured_heart_rate():
    detail = {}
    shaky = calm(2)
    shaky["history"]["hrBpm"][-3] = 150                     # 15초 전 한 칸이 여유선 위
    assert run(request(participants=[calm(1), shaky]), detail=detail).group_pace_sec_per_km == 320
    assert detail["ahead"]["blockedBy"] == "NOT_STEADY"
    old = calm(2)
    old["history"]["hrBpm"][-13] = 150                      # 1분보다 오래전이면 상관없다
    assert run(request(participants=[calm(1), old])).group_pace_sec_per_km == 310


@pytest.mark.parametrize("current,expected", [(300, 290), (290, 290)])
def test_at_most_30_s_per_km_faster_than_the_start_pace(current, expected):
    assert run(request(currentGroupPaceSecPerKm=current,
                       participants=[participant(1, pace=current, hr=130),
                                     participant(2, pace=current, hr=130)])).group_pace_sec_per_km == expected


def test_waits_after_the_start_and_a_shorter_demo_wait_applies():
    assert run(request(elapsedSec=100)).group_pace_sec_per_km == 320
    assert run(request(elapsedSec=100), wait=60).group_pace_sec_per_km == 310


def test_cooldown_after_a_change_still_applies():
    change = {"direction": "FAST", "changedAt": (T0 - timedelta(seconds=60)).isoformat()}
    assert run(request(lastChange=change)).group_pace_sec_per_km == 320


def test_demo_wait_only_for_groups_with_a_demo_member(monkeypatch):
    config = SimpleNamespace(user_allowlist=frozenset({7}), speed_up_warmup_sec=60.0)
    with_demo = [SimpleNamespace(user_id=7), SimpleNamespace(user_id=8)]
    others = [SimpleNamespace(user_id=8), SimpleNamespace(user_id=None)]
    assert ahead_wait(ON, config, with_demo) == (60.0, True)
    assert ahead_wait(ON, config, others) == (180.0, False)
    assert ahead_wait(ON, SimpleNamespace(user_allowlist=None, speed_up_warmup_sec=60.0), with_demo) == (180.0, False)
    assert ahead_wait(ON, None, with_demo) == (180.0, False)


def test_settings_come_from_env(monkeypatch):
    monkeypatch.setenv("GROUP_PACE_AHEAD_MARGIN_BPM", "10")
    monkeypatch.setenv("GROUP_PACE_AHEAD_STREAK", "3")
    monkeypatch.setenv("GROUP_PACE_AHEAD_WAIT_SEC", "90")
    assert load_ahead_settings() == AheadSettings(margin_bpm=10.0, streak=3, wait_sec=90.0)
    monkeypatch.setenv("GROUP_PACE_AHEAD_WAIT_SEC", "nope")
    assert load_ahead_settings().wait_sec == 180.0


def test_console_trace_names_the_ahead_step_and_the_demo_wait():
    from app.demo.group_trace import build_group_trace
    from app.group_pace.schemas import GroupPaceRequest

    detail = {}
    data = request(elapsedSec=100)
    response = run(data, wait=60, detail=detail)
    detail["ahead"]["demoWait"] = True       # main이 시연 대상 그룹에 넘기는 값
    trace = build_group_trace(GroupPaceRequest.model_validate(data), response, detail, boot_id="b", seq=1,
                              stage="L1A", label="시연", policy_version="p", decided_at=T0, decide_ms=1.0)
    assert trace["decision"]["reasonCode"] == "AHEAD"
    assert trace["decision"]["reasonLabel"] == "여유 가속"
    assert "시연 설정" not in trace["decision"]["reasonText"]      # 915 후속: 화면 문구에 시연 설정을 드러내지 않는다
    assert "심박 여유" in trace["decision"]["reasonText"]
    assert trace["group"]["ahead"]["demoWait"] is True               # 시연 설정 여부는 trace에만 남는다
    assert trace["group"]["ahead"]["applied"] is True

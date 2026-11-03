"""러닝 초반 계획 유지 → MPC 넘겨주기(plan_hold_sec / plan_blend_end_sec) 테스트."""
from dataclasses import replace

import pytest

from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy, progress
from demo_fakes import flat_table, policy_input

C = load_policy_config()
ON = MpcPolicy(replace(C, plan_hold_sec=60.0, plan_blend_end_sec=180.0), flat_table(4.0))
OFF = MpcPolicy(replace(C, plan_hold_sec=0.0, plan_blend_end_sec=0.0), flat_table(4.0))
PLAN = [{"startM": 0, "endM": 5000, "ratio": 1.0}]
# 자유러닝: 계획 없음, 목표 pace 350(MPC는 350 쪽), 현재 안내 pace 370.
FREE = dict(plan=None, goal={"targetDistanceM": None, "targetDurationSec": None, "targetPaceSecPerKm": 350},
            currentGuidePaceSecPerKm=370, distanceM=0)


def _planned(active_sec):
    # 계획 구간 목표 pace가 363초/km가 되도록 목표 시간을 맞춘다: (시간 − t) / 5 km = 363.
    goal = {"targetDistanceM": 5000, "targetDurationSec": int(363 * 5 + active_sec), "targetPaceSecPerKm": None}
    return dict(plan=PLAN, goal=goal, activeSec=active_sec, distanceM=0)


def _nearest(paces, target):
    return min(paces, key=lambda p: (abs(p - target), -p))


def _strip(output):
    return replace(output, handover_phase=None, plan_weight=None)


def test_defaults_are_60_and_180_seconds():
    assert (C.plan_hold_sec, C.plan_blend_end_sec) == (60.0, 180.0)


@pytest.mark.parametrize("active_sec", [0, 30])
def test_plan_hold_picks_the_candidate_nearest_the_plan_pace(active_sec):
    inp = policy_input(**_planned(active_sec))
    plan_pace = progress(inp.context, inp.pace_now_sec_per_km, C).pace_req_sec_per_km
    o = ON.decide(inp)

    assert plan_pace == pytest.approx(363.0)
    assert o.handover_phase == "PLAN_HOLD" and o.plan_weight == 1.0
    assert o.recommended_pace_sec_per_km == 365 and o.chosen_index == 3
    assert o.reason == "PLAN_HOLD"
    assert OFF.decide(inp).recommended_pace_sec_per_km == 360     # MPC 단독이면 다른 후보


def test_goal_unreachable_is_deferred_during_plan_handover():
    goal = {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": 263.9}
    inp = policy_input(plan=PLAN, goal=goal, activeSec=0, anchorPaceSecPerKm=314,
                       currentGuidePaceSecPerKm=263.9, speed_now=1000 / 314, pace_now=314)

    assert progress(inp.context, inp.pace_now_sec_per_km, C).goal_unreachable is False
    result = ON.decide(inp)

    assert result.handover_phase == "PLAN_HOLD"
    assert result.reason == "PLAN_HOLD"


@pytest.mark.parametrize("active_sec", [0, 30, 55])
def test_actual_314_pace_keeps_the_263_9_guide_plan_during_hold(active_sec):
    # anchor는 현재 안내 pace이고 실제 측정 pace는 314초/km인 시연 상황이다.
    # 거리는 실제 314초/km로 달린 만큼이다(0초 = 0 m). 처음 입력은 distanceM을 빼먹어 기본값 2500 m가 들어가
    # "0초에 2.5 km"가 되었고, 계획 pace(남은 시간 ÷ 남은 거리 × ratio)가 527.8로 계산됐다(코드가 아니라 입력 오류).
    goal = {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": 263.9}
    inp = policy_input(plan=PLAN, goal=goal, activeSec=active_sec, distanceM=active_sec / 314 * 1000,
                       anchorPaceSecPerKm=263.9, currentGuidePaceSecPerKm=263.9,
                       speed_now=1000 / 314, pace_now=314)

    plan = progress(inp.context, inp.pace_now_sec_per_km, C)
    result = ON.decide(inp)

    # 314로 느리게 출발해도 목표 도달 불가로 보지 않는다(넘겨주기 동안 판단 미룸). 계획 pace는 263.9 근처다.
    assert plan.goal_unreachable is False
    assert plan.pace_req_sec_per_km == pytest.approx(263.9, abs=2.0)
    assert result.handover_phase == "PLAN_HOLD" and result.reason == "PLAN_HOLD"
    assert result.recommended_pace_sec_per_km == pytest.approx(263.9)

    # 시연처럼 anchor에 실제 pace 314를 넣으면 후보가 304~324뿐이다. 그래도 계획 쪽(가장 빠른 304)을 고르고
    # 목표 도달 불가로 계획을 버리지 않는다. 넘겨주기를 끄면(MPC 단독) 옛 동작처럼 GOAL_UNREACHABLE이 된다.
    actual_anchor = policy_input(plan=PLAN, goal=goal, activeSec=active_sec, distanceM=active_sec / 314 * 1000,
                                 anchorPaceSecPerKm=314, currentGuidePaceSecPerKm=263.9,
                                 speed_now=1000 / 314, pace_now=314)
    held = ON.decide(actual_anchor)
    assert (held.reason, held.recommended_pace_sec_per_km) == ("PLAN_HOLD", 304)
    assert OFF.decide(actual_anchor).reason == "GOAL_UNREACHABLE"


def test_actual_314_pace_blends_with_the_263_9_plan_after_hold():
    # 120초 동안 314초/km로 달려 382 m에 있다(처음 입력은 distanceM 기본값 2500 m였다 → 위 HOLD 테스트 주석).
    goal = {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": 263.9}
    inp = policy_input(plan=PLAN, goal=goal, activeSec=120, distanceM=120 / 314 * 1000,
                       anchorPaceSecPerKm=263.9, currentGuidePaceSecPerKm=263.9,
                       speed_now=1000 / 314, pace_now=314)

    plan = progress(inp.context, inp.pace_now_sec_per_km, C)
    mpc_pace = OFF.decide(inp).recommended_pace_sec_per_km
    result = ON.decide(inp)
    blended_target = 0.5 * plan.pace_req_sec_per_km + 0.5 * mpc_pace
    expected = _nearest([candidate.pace_sec_per_km for candidate in inp.candidates], blended_target)

    # 계획 pace = 남은 시간 1199.5초 ÷ 남은 4.618 km = 259.7(늦게 출발한 만큼 조금 당긴다).
    assert plan.goal_unreachable is False
    assert plan.pace_req_sec_per_km == pytest.approx((263.9 * 5 - 120) / (5 - 120 / 314))
    assert result.handover_phase == "PLAN_BLEND" and result.plan_weight == pytest.approx(0.5)
    assert result.reason == "PLAN_BLEND"
    assert result.recommended_pace_sec_per_km == expected


def test_plan_blend_at_120_seconds_is_half_plan_half_mpc():
    inp = policy_input(activeSec=120, **FREE)
    mpc = OFF.decide(inp).recommended_pace_sec_per_km
    o = ON.decide(inp)

    assert mpc == 350
    assert o.handover_phase == "PLAN_BLEND" and o.plan_weight == pytest.approx(0.5)
    paces = [c.pace_sec_per_km for c in inp.candidates]
    assert o.recommended_pace_sec_per_km == _nearest(paces, 0.5 * 370 + 0.5 * mpc) == 360
    assert o.reason == "PLAN_BLEND"


def test_blend_tie_goes_to_the_slower_candidate():
    # 135초: w = 1 − 75/120 = 0.375 → 0.375×370 + 0.625×350 = 357.5 → 355와 360이 같은 거리 → 느린 360.
    inp = policy_input(activeSec=135, **FREE)
    o = ON.decide(inp)

    assert o.plan_weight == pytest.approx(0.375)
    assert o.recommended_pace_sec_per_km == 360


@pytest.mark.parametrize("active_sec", [180, 200, 900])
def test_after_blend_end_the_result_is_the_existing_mpc_result(active_sec):
    for kw in (_planned(active_sec), dict(FREE, activeSec=active_sec), {"activeSec": active_sec}):
        inp = policy_input(**kw)
        o = ON.decide(inp)
        assert o.handover_phase == "MPC" and o.plan_weight == 0.0
        assert _strip(o) == OFF.decide(inp)


def test_hr_gate_wins_over_plan_hold():
    # 옛 허용선 161.6(HRR 80%)에서는 158(상한 162)이 SLOW_ONLY였다. 새 허용선은 모집단 P85 163이라
    # 같은 상황을 만들려고 159(상한 163)로 올린다.
    hot = {2: (150, 152, 159)}                                   # baseline 상한 ≥ 허용 → SLOW_ONLY
    inp = policy_input(activeSec=30, pred=hot, **dict(FREE, currentGuidePaceSecPerKm=350))
    o = ON.decide(inp)
    assert o.gate == "SLOW_ONLY" and o.reason == "SLOW_DOWN_HR"
    assert _strip(o) == OFF.decide(inp)
    assert o.handover_phase == "PLAN_HOLD"

    warm = {2: (150, 152, 156)}                                  # HOLD_OR_SLOW: 계획이 빠르게를 원해도 가속 금지
    o = ON.decide(policy_input(activeSec=30, pred=warm, **dict(FREE, currentGuidePaceSecPerKm=350)))
    assert o.gate == "HOLD_OR_SLOW" and o.recommended_pace_sec_per_km == 360

    inp = policy_input(activeSec=30, hr_now=178, **FREE)       # 위험 기준 = 모집단 P98 175 + 3 = 178
    safety = ON.decide(inp)
    assert (safety.status, safety.action, safety.reason) == ("SAFETY", "EASE_OFF", "SAFETY")
    assert safety.handover_phase == "PLAN_HOLD" and _strip(safety) == OFF.decide(inp)


def test_plan_hold_does_not_bypass_accel_rejections():
    from datetime import timedelta
    from demo_fakes import T0
    inp = policy_input(activeSec=30, guidePaceSetAt=T0 - timedelta(seconds=30),
                       **dict(FREE, currentGuidePaceSecPerKm=350))
    o = ON.decide(inp)
    assert o.verdicts[0].reject_reason == "ACCEL_IN_HOLD"
    assert o.recommended_pace_sec_per_km >= 360


def test_free_run_without_plan_holds_the_current_guide_pace():
    o = ON.decide(policy_input(activeSec=30, **FREE))
    assert o.handover_phase == "PLAN_HOLD" and o.recommended_pace_sec_per_km == 370

    no_guide = ON.decide(policy_input(activeSec=30, **dict(FREE, currentGuidePaceSecPerKm=None)))
    assert no_guide.recommended_pace_sec_per_km == 360            # 안내 pace가 없으면 anchor


@pytest.mark.parametrize("active_sec", [0, 30, 60, 120, 179, 180, 900])
def test_zero_zero_config_is_the_existing_mpc_behaviour(active_sec):
    for kw in (_planned(active_sec), dict(FREE, activeSec=active_sec)):
        o = OFF.decide(policy_input(**kw))
        assert o.handover_phase is None and o.plan_weight is None
        passed = [i for i, v in enumerate(o.verdicts) if v.passed and v.score is not None]
        inp = policy_input(**kw)
        best = min(passed, key=lambda i: (o.verdicts[i].score, abs(inp.candidates[i].delta_sec_per_km),
                                          -inp.candidates[i].delta_sec_per_km))
        assert o.chosen_index == best and o.reason not in ("PLAN_HOLD", "PLAN_BLEND")


def test_config_requires_hold_not_after_blend_end(tmp_path):
    import json
    base = json.loads(open("app/policy/policy_v03.json", encoding="utf-8").read())
    for bad in ({**base, "plan_hold_sec": 200.0}, {**base, "plan_hold_sec": -1.0}):
        path = tmp_path / "c.json"
        path.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(ValueError):
            load_policy_config(path)
    path = tmp_path / "off.json"
    path.write_text(json.dumps({**base, "plan_hold_sec": 0.0, "plan_blend_end_sec": 0.0}), encoding="utf-8")
    assert load_policy_config(path).plan_blend_end_sec == 0.0


class _PhasePolicy:
    """FakePolicy 결과에 계획 단계만 붙인다."""
    policy_version = "fake-policy-1"
    input_insufficient_sec = 20.0

    def __init__(self, phase, weight):
        from demo_fakes import FakePolicy
        self.inner, self.phase, self.weight = FakePolicy(), phase, weight

    def decide(self, inp):
        return replace(self.inner.decide(inp), handover_phase=self.phase, plan_weight=self.weight)


def _pacing(policy):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from demo_fakes import FakeModel5, decide_body, fixed_clock
    with TestClient(create_app(lambda: FakeModel5(), lambda: policy, clock=fixed_clock(3.0))) as client:
        response = client.post("/v1/pace/decide", json=decide_body())
    assert response.status_code == 200
    return response.json()["pacing"]


def test_api_pacing_reports_the_phase_only_when_the_feature_is_on():
    assert _pacing(_PhasePolicy("PLAN_BLEND", 0.5))["handoverPhase"] == "PLAN_BLEND"
    assert _pacing(_PhasePolicy("PLAN_BLEND", 0.5))["planWeight"] == 0.5
    assert set(_pacing(_PhasePolicy(None, None))) == {
        "actualMinusGuideSecPerKm", "etaSec", "etaMinusGoalSec",
        "hrDangerBpm", "hrSustainBpm", "hrThresholdSource", "hrThresholdWeight",
    }

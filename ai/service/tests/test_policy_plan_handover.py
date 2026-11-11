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


def _strip(output):
    return replace(output, handover_phase=None, plan_weight=None)


def test_defaults_are_60_and_180_seconds():
    assert (C.plan_hold_sec, C.plan_blend_end_sec) == (60.0, 180.0)


@pytest.mark.parametrize("active_sec", [0, 30, 60, 120, 179, 180, 200, 900])
def test_phase_is_reported_but_does_not_change_the_pick(active_sec):
    # S15P31E105-624: 페이스 선택은 AI10과 같은 규칙이고 출발 초반은 워밍업 규칙(180초 +10초/km 감속 상한)이 맡는다.
    # 계획 넘겨주기 단계(PLAN_HOLD/PLAN_BLEND/MPC)는 pacing에 알리기만 하고 고르는 후보는 바꾸지 않는다.
    for kw in (_planned(active_sec), dict(FREE, activeSec=active_sec), {"activeSec": active_sec}):
        inp = policy_input(**kw)
        o = ON.decide(inp)
        expected_phase = "PLAN_HOLD" if active_sec < 60 else "PLAN_BLEND" if active_sec < 180 else "MPC"
        assert o.handover_phase == expected_phase
        assert _strip(o) == OFF.decide(inp)
        assert o.reason not in ("PLAN_HOLD", "PLAN_BLEND")


def test_goal_unreachable_is_deferred_during_plan_handover():
    goal = {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": 263.9}
    inp = policy_input(plan=PLAN, goal=goal, activeSec=0, anchorPaceSecPerKm=314,
                       currentGuidePaceSecPerKm=263.9, speed_now=1000 / 314, pace_now=314)
    assert progress(inp.context, inp.pace_now_sec_per_km, C).goal_unreachable is False


def test_hr_gate_and_safety_during_plan_hold():
    hot = {3: (150, 152, 159)}                                   # 안내 그대로 상한 ≥ 허용 → SLOW_ONLY
    o = ON.decide(policy_input(activeSec=30, pred=hot, **dict(FREE, currentGuidePaceSecPerKm=350)))
    assert (o.gate, o.reason, o.recommended_pace_sec_per_km) == ("SLOW_ONLY", "SLOW_DOWN_HR", 370)
    inp = policy_input(activeSec=30, hr_now=178, **FREE)       # 위험 기준 = 모집단 P98 175 + 3 = 178
    safety = ON.decide(inp)
    assert (safety.status, safety.action, safety.reason) == ("SAFETY", "EASE_OFF", "SAFETY")
    assert safety.handover_phase == "PLAN_HOLD" and _strip(safety) == OFF.decide(inp)


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

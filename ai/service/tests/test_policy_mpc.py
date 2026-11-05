import pytest
from datetime import timedelta
from app.policy import build_policy
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy, progress
from demo_fakes import policy_input, flat_table, write_margin_table, T0
C = load_policy_config()
P = MpcPolicy(C, flat_table(4.0))
def run(**kw): return P.decide(policy_input(**kw))
def pace(o): return o.recommended_pace_sec_per_km


def test_baseline_hold():
    o = run()
    assert (o.status, o.action, o.chosen_index, o.gate, o.reason) == ("OK", "GUIDE_PACE", 2, "ALL", "HOLD")
    # 나이·RHR 계산을 빼고 모집단 P85 163과 P98 175를 사용한다. 위험 기준은 P98 + 3 = 178(v6_8 (b)).
    assert o.reason_text == "현재 pace 유지. 상한 158 < 허용 163" and o.publish_suggested is False
    assert o.allow_bpm == pytest.approx(163.0)
    assert (o.hr_danger_bpm, o.hr_sustain_bpm, o.hr_threshold_source, o.hr_threshold_weight) == (
        178.0, 163.0, "POPULATION", 0.0)


def test_t5_gate_boundaries():
    p0 = MpcPolicy(C, flat_table(0.0)); a = p0.decide(policy_input()).allow_bpm
    gate = lambda v: p0.decide(policy_input(pred={2: (150, 152, v)})).gate
    assert (gate(a), gate(a - 3.0), gate(a - 3.0 - 0.01)) == ("SLOW_ONLY", "HOLD_OR_SLOW", "ALL")


def test_t3_safety():
    # 옛 기준(나이 30·RHR 60의 HRR 90% = 171.7)이면 hr_now 175로 SAFETY였다.
    # v6_8 위험 기준은 모집단 P98 175 + 3 = 178이라 실측 178, 예측 상한 175+4(margin) = 179로 맞춘다.
    for o in (run(hr_now=178), run(pred={2: (150, 152, 175)})):
        assert (o.status, o.action, o.chosen_index, pace(o), o.reason) == ("SAFETY", "EASE_OFF", None, 390, "SAFETY")
        assert all(v.reject_reason == "SAFETY" for v in o.verdicts) and o.publish_suggested is True
    assert run(hr_now=177.9).status == "OK"                     # 위험 기준 178 바로 아래는 SAFETY가 아니다
    assert "WALK_ADVISED" in run(hr_now=178, currentGuidePaceSecPerKm=390).warnings


def test_t4_sprint_only_near_finish_and_ignores_after_finish():
    hot = {2: (150, 152, 200)}
    o = run(distanceM=4700, pred=hot)
    assert o.status == "OK" and o.verdicts[2].upper_hr_bpm[2] is None
    # 마지막 400m에는 위험 기준(175 + 3 = 178)에 정책의 추가 5 bpm을 더한 183까지를 안전 한계로 본다.
    # 허용선(allow)은 옛 정책처럼 위험 기준 178 그대로다(옛 정책: allow = hard, 안전 한계 = HRmax).
    assert o.hard_eff_bpm == 183.0 and o.allow_bpm == 178.0
    between = run(distanceM=4700, pred={2: (176, 177, 200)})     # 상한 181: 허용선 178 이상, 안전 한계 183 미만
    assert between.status == "OK" and between.gate == "SLOW_ONLY"
    assert run(distanceM=4500, pred=hot).status == "SAFETY"
    no_dist = {"targetDistanceM": None, "targetDurationSec": 1800, "targetPaceSecPerKm": None}
    assert run(goal=no_dist, distanceM=4700, pred=hot).status == "SAFETY"


def test_t1_less_remaining_same_or_faster():
    dist_only = {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": None}
    # 예측 158 + margin 4 = 162는 옛 허용선 161.6(HRR 80%)을 넘었지만 새 허용선(모집단 P85 163)보다 낮다.
    # "상한 ≥ 허용 → SLOW_ONLY" 상황을 유지하려고 예측을 159(상한 163)로 올린다.
    hot = {i: (150, 152, 159) for i in range(5)}
    assert pace(run(goal=dist_only, pred=hot)) == 365
    assert pace(run(goal=dist_only, distanceM=4550, pred=hot)) <= 365


def test_t2_preference_order():
    paces = [pace(run(activeSec=910, goalPreference=g)) for g in (0.0, 0.5, 1.0)]
    assert paces == [360, 355, 355] and paces[2] <= paces[1] <= paces[0]


def test_t6_t9_stale_and_hold_block_accel_only():
    behind = dict(activeSec=925)
    assert pace(run(**behind)) == 350
    o = run(input_age_sec=21, **behind)
    assert o.status == "HR_STALE" and pace(o) >= 360 and o.verdicts[0].reject_reason == "HR_STALE"
    assert run(guidePaceSetAt=T0 - timedelta(seconds=30), **behind).verdicts[0].reject_reason == "ACCEL_IN_HOLD"
    assert pace(run(guidePaceSetAt=T0 - timedelta(seconds=61), **behind)) == 350
    assert run(resumedAt=T0 - timedelta(seconds=10), **behind).verdicts[0].reject_reason == "ACCEL_IN_HOLD"
    # 옛 허용선 161.6 기준의 158(상한 162)을 새 허용선 163 기준의 159(상한 163)로 바꾼다. 위험 기준은 178.
    hold_hot = run(guidePaceSetAt=T0 - timedelta(seconds=30), pred={i: (150, 152, 159) for i in range(5)})
    assert pace(hold_hot) == 365
    assert run(guidePaceSetAt=T0 - timedelta(seconds=30), hr_now=178).action == "EASE_OFF"


def test_t7_goal_unreachable_never_accelerates():
    inp = dict(activeSec=1900)
    for _ in range(10):
        o = run(**inp)
        assert o.reason == "GOAL_UNREACHABLE" and pace(o) >= inp.get("anchorPaceSecPerKm", 360)
        inp = dict(activeSec=inp["activeSec"] + 5, anchorPaceSecPerKm=pace(o), currentGuidePaceSecPerKm=pace(o))
    assert run(activeSec=1800 - 320 * 2.5).reason == "GOAL_UNREACHABLE"


@pytest.mark.parametrize("goal, extra, expect", [
    ({"targetDistanceM": 5000, "targetDurationSec": 1800, "targetPaceSecPerKm": None}, {}, (0.5, 360.0, 1800.0, 0.0, True)),
    ({"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": 360}, {}, (0.5, 360.0, 1800.0, 0.0, True)),
    ({"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": None}, {}, (0.5, None, 1800.0, None, True)),
    ({"targetDistanceM": None, "targetDurationSec": 1800, "targetPaceSecPerKm": None}, {}, (0.5, None, None, None, False)),
    ({"targetDistanceM": None, "targetDurationSec": None, "targetPaceSecPerKm": 355}, {}, (0.0, 355.0, None, None, False)),
    ({"targetDistanceM": None, "targetDurationSec": None, "targetPaceSecPerKm": None}, {}, (0.0, None, None, None, False)),
    ({"targetDistanceM": 5000, "targetDurationSec": 1800, "targetPaceSecPerKm": None}, {"distanceM": 5200}, (1.0, None, 900.0, -900.0, True)),
])
def test_t8_goal_combinations(goal, extra, expect):
    g = progress(policy_input(goal=goal, **extra).context, 360, C)
    assert (g.p, g.pace_req_sec_per_km, g.eta_sec, g.eta_minus_goal_sec, g.distance_goal) == expect


def test_t8_plan_ratio():
    plan = [{"startM": 0, "endM": 2500, "ratio": 1.0}, {"startM": 2500, "endM": 5000, "ratio": 1.1}]
    g = progress(policy_input(plan=plan, distanceM=2000, activeSec=700).context, 360, C)
    assert g.pace_req_sec_per_km == pytest.approx(1100 / 3.25)


def test_t10_no_goal_keeps_actual():
    none = {"targetDistanceM": None, "targetDurationSec": None, "targetPaceSecPerKm": None}
    o = run(goal=none); assert (o.chosen_index, o.reason) == (2, "HOLD")


def test_t13_deterministic():
    assert run(activeSec=910) == run(activeSec=910)


def test_t15_publish():
    assert run(currentGuidePaceSecPerKm=365).publish_suggested is True
    assert run(currentGuidePaceSecPerKm=362).publish_suggested is False
    assert run(currentGuidePaceSecPerKm=None).publish_suggested is True
    assert run(speed_now=1.4).publish_suggested is False


def test_t16_stale_window_and_not_running():
    # 팀 명세 20초 정렬(S15P31E105-413): 15~20초는 HR_STALE가 아니고, 20초를 넘으면 HR_STALE다.
    for age in (15, 17, 19.9, 20):
        assert run(input_age_sec=age).status == "OK", age
    for age in (20.1, 25):
        assert run(input_age_sec=age).status == "HR_STALE", age
    o = run(speed_now=1.4); assert (o.status, o.action, o.chosen_index, o.verdicts) == ("NOT_RUNNING", "NOT_RUNNING", None, ())


def test_pac_outputs_and_warnings():
    o = run(pace_now=370, currentGuidePaceSecPerKm=360)
    assert o.actual_minus_guide_sec_per_km == 10 and o.eta_sec == pytest.approx(900 + 2.5 * 370)
    assert "GRADE_UNKNOWN" in run(future_grade=None).warnings
    assert "PACE_DROP" in run(recent_cells=((150, 1000 / 380),) * 12).warnings


def test_t11_decel_downhill_raises_upper():
    p = MpcPolicy(C, flat_table(4.0, cells={(120, "DECEL", "DOWN"): 8.0}))
    o = p.decide(policy_input(recent_cells=((150, 3.0),) * 12, future_grade=-3.0))
    assert o.verdicts[4].upper_hr_bpm[2] == 154 + 8.0 and o.verdicts[0].upper_hr_bpm[2] == 154 + 4.0


def test_build_policy(tmp_path):
    with pytest.raises(FileNotFoundError): build_policy(None, "gru")
    path = write_margin_table(tmp_path, model="GRU")
    assert build_policy(path, "gru").policy_version == "mpc-v0.4.1"
    with pytest.raises(ValueError): build_policy(path, "tf")

"""S15P31E105-624: AI04 개인 코칭의 페이스 선택을 그룹 페이스 AI10과 같은 규칙(app.pace_selector)으로 한다.

- 후보: 안내 G + (−30, −20, −10, 0, +10, +20, +30, +45, +60)초/km. 10초/km 미만 변화는 유지.
- 통과: 상한 < 허용선. 늦추는 후보의 상한은 2분 예측 + 감속 여유(경사 칸별 FLAT 4.89 / UP 5.98 / DOWN 6.65 /
  모름 7.46), 유지·빠른 후보는 세 지평선의 예측 + 잔차 여유 표 최대. 빨라지기는 허용 − 3 bpm도 통과해야 한다.
- 지금 안내가 통과 못 하면 통과하는 가장 빠른 느린 후보, 없으면 가장 느린 후보.
- 빨라지기는 목표 페이스까지, 30초/km까지. 목표가 없거나 닿을 수 없거나 입력이 늦으면 올리지 않는다.
- 안내 변경(guidePaceSetAt, 없으면 lastCoaching.appliedAt)·재개 뒤 120초는 바꾸지 않는다(위험 심박 감속은 예외).
- 출발 180초 동안은 +10초/km까지만 늦춘다.
- AI04 전용은 그대로: SAFETY(EASE_OFF), 안내 미준수, 걷기 하한 DANGER, HR_STALE, 개인 기준, 응답 모양.
기본 입력(demo_fakes.policy_input): 안내 360, 허용선 163, 위험 기준 178, 잔차 여유 4, 예측 (150, 152, 154).
후보 위치: 0=330 1=340 2=350 3=360(안내) 4=370 5=380 6=390 7=405 8=420.
"""
import json
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

import pytest

from app.decide.schemas import DecideRequest
from app.decide.service import run_decide
from app.group_pace import service as group_service
from app.pace_selector import DELTAS, PaceSelector
from app.policy import config as config_module
from app.policy import mpc_policy
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, FakeModel5, decide_body, flat_table, policy_input

P = MpcPolicy(load_policy_config(), flat_table(4.0))
HOT = {3: (150, 152, 159)}                 # 안내 그대로 상한 159 + 4 = 163 = 허용선 → 통과 못 함
BEHIND = dict(activeSec=925)              # 목표에 필요한 페이스 (1800 − 925) / 2.5 = 350


def run(**kw):
    kw.setdefault("guidePaceSetAt", None)
    return P.decide(policy_input(**kw))


def pace(o):
    return o.recommended_pace_sec_per_km


def applied(sec_ago):
    return {"coachingId": 1, "appliedAt": T0 - timedelta(seconds=sec_ago)}


def test_ai04_and_ai10_share_one_selector_and_one_candidate_grid():
    assert mpc_policy.PaceSelector is PaceSelector and group_service.PaceSelector is PaceSelector
    assert group_service.DELTAS == DELTAS == (-30, -20, -10, 0, 10, 20, 30, 45, 60)
    assert [c.delta_sec_per_km for c in policy_input().candidates] == list(DELTAS)


def test_hold_when_guide_passes_and_no_goal_lag():
    o = run()
    assert (o.chosen_index, pace(o), o.reason, o.gate, o.coaching_level) == (3, 360, "HOLD", "ALL", "OK")
    assert o.publish_suggested is False and len(o.verdicts) == 9


# ---- 늦추기

def test_slowdown_picks_fastest_passing_slower_candidate():
    o = run(pred=HOT)                                                   # 370: 154 + 4.89 = 158.89 < 163
    assert (o.gate, o.reason, o.chosen_index, pace(o)) == ("SLOW_ONLY", "SLOW_DOWN_HR", 4, 370)
    assert o.reason_text.endswith("10초 느리게") and o.publish_suggested is True
    hotter = {**HOT, 4: (150, 152, 159), 5: (150, 152, 158.2)}         # 370·380 탈락, 390 통과
    o = run(pred=hotter)
    assert (o.chosen_index, pace(o)) == (6, 390)
    assert [v.passed for v in o.verdicts[3:7]] == [False, False, False, True]
    assert o.verdicts[4].reject_reason == "UPPER_OVER_ALLOW"


def test_slowdown_uses_slowest_candidate_when_none_passes():
    o = run(pred={i: (150, 152, 159) for i in range(9)})
    assert (o.chosen_index, pace(o), o.reason) == (8, 420, "SLOW_DOWN_HR")


def test_slow_margin_depends_on_grade():
    pred = {**HOT, 4: (150, 152, 157.5)}
    assert pace(run(pred=pred)) == 370                                  # 평지 157.5 + 4.89 = 162.39 < 163
    assert pace(run(pred=pred, future_grade=5.0)) == 380                # 오르막 157.5 + 5.98 = 163.48
    assert pace(run(pred=pred, future_grade=None)) == 380               # 모름 7.46


def test_warmup_caps_slowdown_at_ten():
    pred = {**HOT, 4: (150, 152, 159), 5: (150, 152, 159)}             # +30(390)이 필요
    assert pace(run(pred=pred, activeSec=100)) == 370
    assert pace(run(pred=pred, activeSec=180)) == 390


def test_walk_floor_turns_into_danger():
    hot = {i: (150, 152, 159) for i in range(3, 6)}                     # 640·650·660 탈락, 670 통과
    o = run(pred=hot, anchorPaceSecPerKm=640, currentGuidePaceSecPerKm=640, pace_now=640.0, speed_now=1000 / 640)
    assert o.reason == "SLOW_DOWN_HR" and o.coaching_level == "DANGER" and o.chosen_index is None
    assert pace(o) == pytest.approx(1000 / 1.5)
    assert o.chosen_pred_hr_bpm == (150.0, 152.0, 154.0)


# ---- 쿨다운

@pytest.mark.parametrize("ctx, expect", [
    ({}, 370),
    ({"guidePaceSetAt": T0 - timedelta(seconds=119)}, 360),
    ({"guidePaceSetAt": T0 - timedelta(seconds=120)}, 370),
    ({"lastCoaching": applied(60)}, 360),                              # guidePaceSetAt가 없으면 마지막 적용 시각
    ({"lastCoaching": applied(121)}, 370),
    ({"resumedAt": T0 - timedelta(seconds=10)}, 360),                  # 재개도 변경으로 본다
])
def test_cooldown_after_guide_change(ctx, expect):
    o = run(pred=HOT, **ctx)
    assert pace(o) == expect
    if expect == 360:
        assert o.reason == "HOLD" and o.reason_text.startswith("심박 반응 대기") and o.coaching_level == "CAUTION"


def test_danger_slowdown_is_not_held_by_cooldown():
    # 위험 심박은 정책 앞단의 SAFETY(EASE_OFF)가 쿨다운과 무관하게 먼저 낸다.
    o = run(hr_now=178, guidePaceSetAt=T0 - timedelta(seconds=30))
    assert (o.action, o.status, o.coaching_level) == ("EASE_OFF", "SAFETY", "DANGER")


# ---- 빨라지기

def test_speed_up_to_goal_pace_in_one_step():
    o = run(**BEHIND)
    assert (o.reason, o.chosen_index, pace(o)) == ("SPEED_UP_GOAL", 2, 350)
    assert pace(run(activeSec=950)) == 340                              # 목표 340
    assert pace(run(activeSec=975)) == 330                              # 목표 330 = 30초/km 한도
    assert run(activeSec=1000).reason == "GOAL_UNREACHABLE"             # 목표 320 < 360 − 30


def test_speed_up_needs_three_bpm_room():
    o = run(activeSec=950, pred={1: (150, 152, 156.5)})                 # 340: 160.5 ≥ 163 − 3
    assert pace(o) == 350
    assert o.verdicts[1].passed is False and o.verdicts[2].passed is True


@pytest.mark.parametrize("ctx", [
    {"input_age_sec": 21},                                              # HR_STALE
    {"guidePaceSetAt": T0 - timedelta(seconds=60)},                     # 쿨다운
    {"goal": {"targetDistanceM": None, "targetDurationSec": None, "targetPaceSecPerKm": None}},
])
def test_no_speed_up_when_stale_cooling_down_or_without_goal(ctx):
    assert pace(run(**BEHIND, **ctx)) == 360


def test_never_slows_down_just_because_ahead_of_goal():
    o = run(activeSec=850)                                              # 필요 페이스 380, 심박 여유
    assert (o.reason, pace(o)) == ("HOLD", 360)


# ---- 안내 미준수 (AI04 전용, 그대로)

def test_runner_not_following_gets_same_guide_and_higher_level():
    for guide_set in (None, T0 - timedelta(seconds=90)):
        o = run(pred=HOT, pace_now=345.0, speed_now=1000 / 345, guidePaceSetAt=guide_set)
        assert (o.reason, pace(o), o.coaching_level) == ("SLOW_DOWN_HR", 360, "DANGER")
        assert "GUIDE_NOT_FOLLOWED" in o.warnings and o.publish_suggested is True
        assert o.reason_text.startswith("안내를 따르지 않음")


def test_runner_slightly_faster_is_still_following():
    o = run(pred=HOT, pace_now=352.0, speed_now=1000 / 352)
    assert (pace(o), o.coaching_level) == (370, "CAUTION") and "GUIDE_NOT_FOLLOWED" not in o.warnings


# ---- 설정 (감속 여유 표는 계속 쓴다. 옛 폭 목록 키는 호환을 위해 검증만 유지)

def _raw():
    return json.loads(Path(config_module.__file__).with_name("policy_v03.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("key, bad", [
    ("hr_slow_steps_sec_per_km", []), ("hr_slow_steps_sec_per_km", [10, 5]), ("speed_up_steps_sec_per_km", [0, 5]),
    ("hr_slow_margin_120_bpm", {"FLAT": 4.89}), ("hr_slow_margin_120_bpm", {"FLAT": 1, "UP": 1, "DOWN": 1, "UNKNOWN": -1}),
    ("hr_slow_cooldown_sec", -1), ("early_slow_cap_sec_per_km", 0), ("not_following_sec_per_km", 0),
])
def test_config_is_validated(tmp_path, key, bad):
    path = tmp_path / "p.json"
    path.write_text(json.dumps({**_raw(), key: bad}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_policy_config(path)


# ---- 서비스 경로

def _api(last=None, hr=165.0):
    at = T0 + timedelta(seconds=3)
    body = decide_body(guidePaceSetAt=None, history={"hrBpm": [hr] * 80},
                       lastCoaching=None if last is None else {"coachingId": "7", "appliedAt": (at - timedelta(seconds=last)).isoformat()})
    policy = MpcPolicy(replace(load_policy_config(), actual_pace_check_enabled=False), flat_table(0.0))
    model = FakeModel5()
    response = run_decide(DecideRequest.model_validate(body), model, policy, received_at=at, now=lambda: at).response
    return response, model


def test_api_predicts_nine_candidates_in_one_call():
    response, model = _api()
    assert [len(b["future_speed"]) for b in model.batches] == [9]       # 두 번째 GRU 호출 없음
    d = response.decision
    # 가짜 모델 2분 예측 = 165 + (속도 − 3) × 8, 감속 여유 4.89(평지): +60(400)까지 모두 부족 → 가장 느린 후보
    assert (d.recommended_pace_sec_per_km, d.chosen_index, d.reason) == (400, 8, "SLOW_DOWN_HR")
    assert d.predicted_hr_120_bpm == pytest.approx(165 + (1000 / 400 - 3) * 8)
    assert len(response.candidates) == 9 and response.candidates[3].pace_sec_per_km == 340


# 2분 예측 164.5 ≥ 허용 163(위험)이라 쿨다운 중(61초)에도 늦춘다(수정 2).
@pytest.mark.parametrize("last, expect", [(None, 400), (61, 400), (121, 400)])
def test_api_reads_last_coaching_for_cooldown(last, expect):
    response, _ = _api(last)
    assert response.decision.recommended_pace_sec_per_km == pytest.approx(expect)


# ---- 리뷰 반영(A-1/B-1·B-2, A-4, A-6)

@pytest.mark.parametrize("distance", [4700, 4750, 4850])   # 4600은 2분 안에 결승에 닿지 않아 SAFETY
def test_final_stretch_ignores_post_finish_prediction(distance):
    # 결승 400 m 안: 결승 뒤 지평선(None)은 빼고 허용선은 위험 기준(178)이다. 이전(v0.4.3)처럼 늦추지 않는다.
    for pred in ({3: (150, 152, 200)}, {i: (150, 152, 200) for i in range(9)}):
        o = run(distanceM=distance, pred=pred)
        assert o.status == "OK" and o.reason in ("HOLD", "SPRINT", "SPEED_UP_GOAL"), (distance, o.reason)
        assert pace(o) <= 360 and o.coaching_level == "OK"


def test_final_stretch_still_slows_when_remaining_horizons_are_hot():
    o = run(distanceM=4700, pred={3: (176, 177, 200)})        # 30·60초 상한 181 ≥ 178, 안전 한계 183 미만
    assert o.status == "OK" and o.gate == "SLOW_ONLY" and o.reason == "SLOW_DOWN_HR" and pace(o) == 370


def test_stale_marks_faster_candidates_not_passed():
    o = run(input_age_sec=21, **BEHIND)
    assert [v.reject_reason for v in o.verdicts[:3]] == ["HR_STALE"] * 3
    assert all(not v.passed for v in o.verdicts[:3])


def test_runner_gets_60_sec_to_follow_a_new_guide():
    o = run(pred=HOT, pace_now=345.0, speed_now=1000 / 345, guidePaceSetAt=T0 - timedelta(seconds=30))
    assert (o.reason, pace(o), o.coaching_level) == ("HOLD", 360, "CAUTION")      # 쿨다운 중, 미준수 판단 전
    assert "GUIDE_NOT_FOLLOWED" not in o.warnings


def test_run_start_has_no_cooldown_like_ai10():
    # 첫 적용 전에는 guidePaceSetAt·lastCoaching·resumedAt가 없어 쿨다운이 없다(AI10의 lastChange=null과 같음).
    # 출발 180초 동안은 워밍업 상한(+10초/km)만 건다. 리드 결정 대기 항목(리뷰 A-3/B-3).
    o = run(pred={**HOT, 4: (150, 152, 159)}, activeSec=15)
    assert pace(o) == 370 and o.publish_suggested is True


# ---- 리드 수정 3건(2026-11-10): AI04 전용, AI10 기본값 그대로

def test_fix1_slowdown_is_built_from_actual_pace_when_runner_is_slower():
    from app.decide.policy_port import PolicyCandidate
    rows = tuple(PolicyCandidate(int(round(380 + d - 360)), 380 + d, 1000 / (380 + d), (150.0, 152.0, 154.0), (0.0,) * 24)
                 for d in (10, 20, 30, 45, 60))
    o = P.decide(replace(policy_input(pred=HOT, pace_now=380.0, speed_now=1000 / 380, guidePaceSetAt=None),
                         slow_rows=rows))
    assert (o.reason, pace(o), o.chosen_index) == ("SLOW_DOWN_HR", 390, None)   # 실측 380 + 10, 안내 360 + 10 아님
    assert o.chosen_pred_hr_bpm == (150.0, 152.0, 154.0) and len(o.verdicts) == 9


def test_fix1_service_adds_slow_rows_only_when_runner_is_slower():
    at = T0 + timedelta(seconds=3)
    policy = MpcPolicy(replace(load_policy_config(), actual_pace_check_enabled=False), flat_table(0.0))
    for speed, rows in ((1000 / 360, 14), (1000 / 340, 9)):      # 안내 340: 실측 360이면 느린 행 5개를 덧붙임
        model = FakeModel5()
        body = decide_body(guidePaceSetAt=None, history={"hrBpm": [150.0] * 80, "speedMps": [speed] * 80})
        run_decide(DecideRequest.model_validate(body), model, policy, received_at=at, now=lambda: at)
        assert [len(b["future_speed"]) for b in model.batches] == [rows]


def test_fix2_warmup_cap_is_lifted_when_prediction_itself_is_over_allow():
    pred = {**HOT, 4: (150, 152, 159), 5: (150, 152, 159)}             # 상한만 넘음: 워밍업 +10 그대로
    assert pace(run(pred=pred, activeSec=100)) == 370
    danger = {3: (150, 152, 163.5), 4: (150, 152, 159), 5: (150, 152, 159)}   # 예측 자체 ≥ 163
    assert pace(run(pred=danger, activeSec=100)) == 390


def test_fix2_same_danger_bypasses_cooldown_but_plain_overshoot_waits():
    recent = T0 - timedelta(seconds=60)
    assert pace(run(pred=HOT, guidePaceSetAt=recent)) == 360                  # 예측 159 < 163
    assert pace(run(pred={3: (150, 152, 163.5)}, guidePaceSetAt=recent)) == 370

"""S15P31E105-506: 넘친 만큼 늦추기·빨라지기, 감속 쿨다운, 안내 미준수(인계 I-23, 팀 검토 2026-11-06).

- 심박 때문에 늦출 때(SLOW_ONLY): 느린 페이스 max(안내, 실측) + 5~60초/km마다 "2분 뒤 예측 + 감속 전용 여유분
  (경사 칸별 FLAT 4.89 / UP 5.98 / DOWN 6.65 / 모름 7.46)"을 상한으로 보고, 허용선 아래가 되는 가장 작은 폭.
  없으면 가장 큰 폭이고, 걷기 경계(11:07) 하한에 닿으면 DANGER. 출발 3분 동안은 10초까지만.
- 안내를 바꾼 뒤 120초 동안은 더 늦추지 않는다. 빨라지기는 60초 동안 막는다. 시각은 guidePaceSetAt, 없으면 lastCoaching.appliedAt.
- 빨라질 때(목표보다 늦음): 안내 − 5~60초 중 상한이 허용선 − 3 아래이고 목표 페이스보다 빠르지 않은 가장 빠른 폭으로 한 번에.
- 러너가 안내보다 10초/km 이상 빠르면(안내 미준수) 더 늦추지 않고 같은 안내를 다시 알리며 단계만 올린다.
- 위험 심박 감속 권고(EASE_OFF)는 기다리지 않는다.
"""
import json
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

import pytest

from app.decide.policy_port import PolicyCandidate
from app.decide.schemas import DecideRequest
from app.decide.service import run_decide
from app.policy import config as config_module
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, FakeModel5, decide_body, flat_table, policy_input

P = MpcPolicy(load_policy_config(), flat_table(4.0))    # 허용선 163, 여유 표 4, 감속 여유(평지) 4.89
HOT = {i: (150, 152, 159) for i in range(5)}            # 상한 163 = 허용선 → SLOW_ONLY
BEHIND = dict(activeSec=925)                            # 목표보다 늦어 빨라지라는 상황(필요 페이스 350)


def rows(base, hr120_by_step):
    """안에서 덧붙인 페이스 (base + step, 2분 예측). 안내 360 기준 delta."""
    return tuple(PolicyCandidate(int(round(base + d - 360)), base + d, 1000 / (base + d), (150.0, 152.0, hr), (0.0,) * 24)
                 for d, hr in hr120_by_step)


def slow(hr_by_step=None, base=360):
    steps = range(5, 65, 5)
    hr_by_step = hr_by_step or {}
    return rows(base, [(d, hr_by_step.get(d, 159.0)) for d in steps])


def run(extra_slow=(), extra_fast=(), **kw):
    kw.setdefault("guidePaceSetAt", None)
    return P.decide(replace(policy_input(**kw), extra_slow=extra_slow, extra_fast=extra_fast))


def applied(sec_ago):
    return {"coachingId": 1, "appliedAt": T0 - timedelta(seconds=sec_ago)}


# ---- 넘친 만큼 늦추기

def test_picks_smallest_slowdown_that_brings_two_minute_upper_under_allow():
    o = run(pred=HOT, extra_slow=slow({15: 158.0, 20: 157.0}))           # 158 + 4.89 = 162.89 < 163
    assert (o.gate, o.reason, o.recommended_pace_sec_per_km) == ("SLOW_ONLY", "SLOW_DOWN_HR", 375)
    assert o.chosen_index is None and o.chosen_pred_hr_bpm == (150.0, 152.0, 158.0)
    assert o.reason_text.endswith("15초 느리게") and o.publish_suggested is True


def test_uses_largest_slowdown_when_none_is_enough():
    o = run(pred=HOT, extra_slow=slow())
    assert (o.reason, o.recommended_pace_sec_per_km, o.coaching_level) == ("SLOW_DOWN_HR", 420, "CAUTION")


def test_slow_margin_depends_on_grade():
    # 오르막(5.98)이면 158 + 5.98 ≥ 163이라 157.0인 +20이 첫 통과
    o = run(pred=HOT, future_grade=5.0, extra_slow=slow({15: 158.0, 20: 157.0}))
    assert o.recommended_pace_sec_per_km == 380
    # 경사 모름(7.46)
    o = run(pred=HOT, future_grade=None, extra_slow=slow({15: 158.0, 20: 157.0, 25: 155.5}))
    assert o.recommended_pace_sec_per_km == 385


def test_slow_base_is_actual_pace_when_runner_is_slower_than_guide():
    # 러너가 380(안내 360보다 느림)이면 감속은 380 + 폭에서 고른다
    o = run(pred=HOT, pace_now=380.0, speed_now=1000 / 380, extra_slow=slow({5: 158.0}, base=380))
    assert o.recommended_pace_sec_per_km == 385


def test_without_extra_rows_it_chooses_among_request_candidates():
    assert run(pred=HOT).recommended_pace_sec_per_km == 370            # +5, +10 모두 부족 → 가장 큰 +10


def test_early_minutes_cap_slowdown_at_10_sec():
    o = run(pred=HOT, activeSec=100, extra_slow=slow({30: 150.0}))     # +30이면 충분하지만 출발 3분은 10초까지
    assert (o.reason, o.recommended_pace_sec_per_km) == ("SLOW_DOWN_HR", 370)
    assert run(pred=HOT, activeSec=200, extra_slow=slow({30: 150.0})).recommended_pace_sec_per_km == 390


def test_floor_turns_into_danger():
    pred = {i: (150, 152, 170) for i in range(5)}
    extra = tuple(PolicyCandidate(d, 640 + d, 1000 / (640 + d), (150.0, 152.0, 170.0), (0.0,) * 24)
                  for d in range(5, 65, 5))
    o = run(pred=pred, extra_slow=extra, anchorPaceSecPerKm=640, currentGuidePaceSecPerKm=640, pace_now=640.0,
            speed_now=1000 / 640, recent_cells=((150.0, 1000 / 640),) * 12)
    assert o.reason == "SLOW_DOWN_HR" and o.coaching_level == "DANGER"
    assert o.recommended_pace_sec_per_km == pytest.approx(1000 / 1.5)


# ---- 쿨다운

def test_hr_slow_down_waits_after_guide_change():
    o = run(guidePaceSetAt=T0 - timedelta(seconds=30), pred=HOT, extra_slow=slow({5: 150.0}))
    assert (o.gate, o.reason, o.recommended_pace_sec_per_km) == ("SLOW_ONLY", "HOLD", 360)
    assert o.coaching_level == "CAUTION" and o.publish_suggested is False
    assert [v.reject_reason for v in o.verdicts[3:]] == ["SLOW_IN_HOLD", "SLOW_IN_HOLD"]
    assert o.reason_text.startswith("심박 반응 대기")


def test_wait_ends_after_cooldown():
    assert run(guidePaceSetAt=T0 - timedelta(seconds=119), pred=HOT).recommended_pace_sec_per_km == 360
    assert run(guidePaceSetAt=T0 - timedelta(seconds=120), pred=HOT).reason == "SLOW_DOWN_HR"


def test_last_coaching_time_is_used_for_the_wait():
    assert run(lastCoaching=applied(30), pred=HOT).recommended_pace_sec_per_km == 360
    assert run(lastCoaching=applied(121), pred=HOT).reason == "SLOW_DOWN_HR"
    assert run(guidePaceSetAt=T0 - timedelta(seconds=150), lastCoaching=applied(30), pred=HOT).reason == "SLOW_DOWN_HR"


def test_danger_does_not_wait():
    o = run(lastCoaching=applied(10), hr_now=178)
    assert (o.action, o.coaching_level) == ("EASE_OFF", "DANGER")


def test_goal_slow_down_also_waits():
    o = run(lastCoaching=applied(30))
    assert o.gate == "ALL"
    assert [v.reject_reason for v in o.verdicts[3:]] == ["SLOW_IN_HOLD", "SLOW_IN_HOLD"]


# ---- 넘친 만큼 빨라지기

def fast(hr_by_step=None):
    hr_by_step = hr_by_step or {}
    return tuple(PolicyCandidate(-d, 360 - d, 1000 / (360 - d), (150.0, 152.0, hr_by_step.get(d, 150.0)), (0.0,) * 24)
                 for d in range(5, 65, 5))


def test_speed_up_jumps_to_fastest_pace_with_room_but_not_past_goal():
    o = run(activeSec=960, extra_fast=fast())                          # 필요 페이스 336 → 340(−20)까지
    assert (o.reason, o.recommended_pace_sec_per_km, o.chosen_index) == ("SPEED_UP_GOAL", 340, None)
    assert o.reason_text.startswith("목표보다 늦어 20초 빠르게")


def test_speed_up_stops_where_upper_reaches_allow_minus_band():
    o = run(activeSec=960, extra_fast=fast({15: 157.0, 20: 157.0}))     # 157 + 4 = 161 ≥ 160
    assert o.recommended_pace_sec_per_km == 350                        # 요청 후보 −10 그대로


def test_speed_up_waits_60_sec_after_guide_change():
    o = run(lastCoaching=applied(30), activeSec=960, extra_fast=fast())
    assert o.recommended_pace_sec_per_km == 360 and o.verdicts[0].reject_reason == "ACCEL_IN_HOLD"
    assert run(lastCoaching=applied(61), activeSec=960, extra_fast=fast()).recommended_pace_sec_per_km == 340


# ---- 안내 미준수

def test_runner_not_following_gets_same_guide_and_higher_level():
    for guide_set in (None, T0 - timedelta(seconds=90)):                # 따라올 시간(60초) 뒤에는 쿨다운 중에도 같다
        o = run(pred=HOT, pace_now=345.0, speed_now=1000 / 345, guidePaceSetAt=guide_set, extra_slow=slow({5: 150.0}))
        assert (o.reason, o.recommended_pace_sec_per_km, o.coaching_level) == ("SLOW_DOWN_HR", 360, "DANGER")
        assert "GUIDE_NOT_FOLLOWED" in o.warnings and o.publish_suggested is True
        assert o.reason_text.startswith("안내를 따르지 않음")


def test_runner_gets_60_sec_to_follow_a_new_guide():
    o = run(pred=HOT, pace_now=345.0, speed_now=1000 / 345, guidePaceSetAt=T0 - timedelta(seconds=30))
    assert (o.reason, o.recommended_pace_sec_per_km, o.coaching_level) == ("HOLD", 360, "CAUTION")
    assert "GUIDE_NOT_FOLLOWED" not in o.warnings


def test_runner_slightly_faster_is_still_following():
    o = run(pred=HOT, pace_now=352.0, speed_now=1000 / 352, extra_slow=slow({5: 150.0}))
    assert (o.recommended_pace_sec_per_km, o.coaching_level) == (365, "CAUTION")
    assert "GUIDE_NOT_FOLLOWED" not in o.warnings


# ---- 설정

def _raw():
    return json.loads(Path(config_module.__file__).with_name("policy_v03.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("key, bad", [
    ("hr_slow_steps_sec_per_km", []), ("hr_slow_steps_sec_per_km", [10, 5]), ("hr_slow_steps_sec_per_km", [5, 121]),
    ("hr_slow_steps_sec_per_km", [5, True]), ("speed_up_steps_sec_per_km", [0, 5]), ("speed_up_steps_sec_per_km", "5"),
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


def test_api_predicts_slow_rows_in_a_second_call_only_when_slowing():
    response, model = _api()
    assert [len(b["future_speed"]) for b in model.batches] == [5, 12]      # 요청 후보 5 → 느린 폭 12
    # 느린 쪽 기준 = max(안내 340, 실측 333.3) = 340
    assert model.batches[1]["future_speed"][:, 0] == pytest.approx([1000.0 / (340 + d) for d in range(5, 65, 5)])
    held, model = _api(last=61)                                             # 쿨다운 중이면 두 번째 호출 없음
    assert [len(b["future_speed"]) for b in model.batches] == [5]
    d = response.decision
    # 가짜 모델 2분 예측 = 165 + (속도 − 3) × 8, 감속 여유 4.89(평지): 400(+60)까지 부족 → 가장 큰 폭
    assert (d.recommended_pace_sec_per_km, d.chosen_index, d.reason) == (400, None, "SLOW_DOWN_HR")
    assert d.predicted_hr_120_bpm == pytest.approx(165 + (1000 / 400 - 3) * 8)
    assert len(response.candidates) == 5                                    # 응답 후보는 요청 그대로


@pytest.mark.parametrize("last, expect", [(None, 400), (61, 340), (121, 400)])
def test_api_reads_last_coaching(last, expect):
    response, _ = _api(last)
    assert response.decision.recommended_pace_sec_per_km == pytest.approx(expect)


class _FailSecond(FakeModel5):
    def predict(self, batch):
        if self.batches:
            self.batches.append(batch)
            raise RuntimeError("두 번째 호출 실패")
        return super().predict(batch)


def test_second_call_failure_falls_back_to_first_decision():
    at = T0 + timedelta(seconds=3)
    body = decide_body(guidePaceSetAt=None, history={"hrBpm": [165.0] * 80})
    policy = MpcPolicy(replace(load_policy_config(), actual_pace_check_enabled=False), flat_table(0.0))
    response = run_decide(DecideRequest.model_validate(body), _FailSecond(), policy,
                          received_at=at, now=lambda: at).response
    assert (response.decision.reason, response.decision.recommended_pace_sec_per_km) == ("SLOW_DOWN_HR", 350)

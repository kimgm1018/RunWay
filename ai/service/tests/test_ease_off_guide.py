"""위험 심박 감속 권고(EASE_OFF) = max(안내, min(실측 + 30, 걷기 경계)).

- S15P31E105-497: 권고는 지금 안내보다 빨라지지 않는다. 불변식: action == EASE_OFF이고 안내가 있으면 추천 ≥ 안내.
- S15P31E105-506: 실측 기준이다. 러너가 안내를 따르지 않고 빠르게 달리면 권고가 안내에 머문다(같은 안내를 다시 알림).
  예전(max(실측, 안내) + 30)은 무시하는 동안 30초마다 안내만 30초씩 느려졌다.
실측이 안내보다 빠른 경우, 느린·같은 경우, 기록 한 칸 경로, 안내 없음을 본다.
"""
from datetime import timedelta

import pytest

from app.decide.schemas import DecideRequest
from app.decide.service import run_decide
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, FakeModel5, decide_body, flat_table

CFG = load_policy_config()
STEP = CFG.ease_off_sec_per_km
DANGER_HR = 190.0          # 모집단 위험 기준(178)보다 높다


def decide(guide, actual, *, hr=DANGER_HR, cells=80):
    body = decide_body(anchorPaceSecPerKm=guide or 330, currentGuidePaceSecPerKm=guide,
                       history={"hrBpm": [hr] * cells, "speedMps": [1000.0 / actual] * cells,
                                "gradePct": [0.0] * cells})
    if cells == 1:                               # 기록 한 칸 경로(_too_short_plan_hold)
        body["context"].update(activeSec=5, distanceM=10.0, routeProgressM=10.0)
    at = T0 + timedelta(seconds=3)
    out = run_decide(DecideRequest.model_validate(body), FakeModel5(), MpcPolicy(CFG, flat_table(0.0)),
                     received_at=at, now=lambda: at)
    return out.response


@pytest.mark.parametrize("cells", [80, 1])
@pytest.mark.parametrize("guide,actual,expected", [
    (330, 300, 330),     # 실측이 안내보다 30초 빠름(따르지 않음): 같은 안내 다시(단계 DANGER로 알림)
    (330, 290, 330),     # 40초 빠름: 실측 + 30 = 320이 안내보다 빨라 안내 그대로
    (360, 335, 365),     # 감속 뒤에도 빨리 달림: 실측 + 30
    (330, 330, 360),     # 실측 = 안내: 안내 + 30
    (330, 360, 390),     # 실측이 안내보다 느림: 실측 + 30
])
def test_ease_off_follows_actual_pace_and_is_never_faster_than_guide(cells, guide, actual, expected):
    response = decide(guide, actual, cells=cells)
    decision = response.decision
    assert response.status == "SAFETY" and decision.action == "EASE_OFF" and decision.coaching_level == "DANGER"
    assert decision.recommended_pace_sec_per_km == pytest.approx(expected)
    assert decision.recommended_pace_sec_per_km >= guide


@pytest.mark.parametrize("cells", [80, 1])
def test_without_guide_ease_off_still_uses_actual_pace(cells):
    decision = decide(None, 300, cells=cells).decision
    assert decision.action == "EASE_OFF"
    assert decision.recommended_pace_sec_per_km == pytest.approx(300 + STEP)


@pytest.mark.parametrize("cells", [80, 1])
def test_no_walk_advised_warning(cells):
    """S15P31E105-504: 걷기·멈춤 권고는 두지 않으므로 WALK_ADVISED 경고를 내지 않는다."""
    for guide, actual in ((330, 290), (330, 330), (650, 650)):
        assert "WALK_ADVISED" not in decide(guide, actual, cells=cells).warnings


WALK_PACE = 1000.0 / CFG.walk_speed_mps     # 1.5 m/s = 666.7초/km(11:07)


@pytest.mark.parametrize("cells", [80, 1])
@pytest.mark.parametrize("guide,actual,expected", [
    (600, 600, 630),           # 10:00 + 30 = 10:30: 하한 전이라 그대로
    (650, 650, WALK_PACE),     # 10:50 + 30 = 11:20 → 걷기 경계 11:07에서 멈춤
    (640, 620, 650),           # 실측 620 + 30 = 650: 하한 전
    (660, 650, WALK_PACE),     # 실측 650 + 30 = 680 → 666.7
    (700, 600, 700),           # 안내가 이미 걷기 경계보다 느림: 안내보다 빨라지지 않게 안내 그대로
])
def test_ease_off_stops_at_walking_boundary(cells, guide, actual, expected):
    """S15P31E105-504: 감속 권고가 이어져도 걷기 경계보다 느려지지 않고, 안내보다 빨라지지도 않는다."""
    decision = decide(guide, actual, cells=cells).decision
    assert decision.action == "EASE_OFF" and decision.coaching_level == "DANGER"
    assert decision.recommended_pace_sec_per_km == pytest.approx(expected)
    assert decision.recommended_pace_sec_per_km >= guide

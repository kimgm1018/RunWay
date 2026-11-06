"""S15P31E105-497: 위험 심박 감속 권고(EASE_OFF)는 지금 안내보다 빨라지지 않는다.

불변식: action == EASE_OFF이고 안내가 있으면 추천 ≥ 안내 + ease_off(30초/km).
실측이 안내보다 빠른 경우(예전에는 안내와 같거나 더 빨랐다), 느린·같은 경우, 기록 한 칸 경로, 안내 없음을 본다.
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
    (330, 300, 360),     # 실측이 안내보다 30초 빠름: 예전 330(안내와 같아 발행 안 됨) → 안내 + 30
    (330, 290, 360),     # 40초 빠름: 예전 320(안내보다 빨라짐) → 안내 + 30
    (360, 335, 390),     # 감속 뒤에도 빨리 달림: 예전 365(10초 미만이라 발행 안 됨) → 안내 + 30
    (330, 330, 360),     # 실측 = 안내: 그대로
    (330, 360, 390),     # 실측이 안내보다 느림: 그대로(실측 + 30)
])
def test_ease_off_is_never_faster_than_guide_plus_step(cells, guide, actual, expected):
    response = decide(guide, actual, cells=cells)
    decision = response.decision
    assert response.status == "SAFETY" and decision.action == "EASE_OFF"
    assert decision.recommended_pace_sec_per_km == pytest.approx(expected)
    assert decision.recommended_pace_sec_per_km >= guide + STEP


@pytest.mark.parametrize("cells", [80, 1])
def test_without_guide_ease_off_still_uses_actual_pace(cells):
    decision = decide(None, 300, cells=cells).decision
    assert decision.action == "EASE_OFF"
    assert decision.recommended_pace_sec_per_km == pytest.approx(300 + STEP)


@pytest.mark.parametrize("cells", [80, 1])
def test_walk_advised_condition_is_unchanged(cells):
    """WALK_ADVISED 뜻 재정의는 P0-2에서 정한다. 지금은 실측 + 30 ≤ 안내일 때 그대로 붙는다."""
    assert "WALK_ADVISED" in decide(330, 290, cells=cells).warnings
    assert "WALK_ADVISED" not in decide(330, 330, cells=cells).warnings

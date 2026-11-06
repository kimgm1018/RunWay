"""S15P31E105-504: AI04 코칭 단계(coachingLevel) OK / CAUTION / DANGER.

- OK: 막지 않음. 러너가 안내보다 빨라도 실측 속도 예측 심박이 허용선 아래면 안내 그대로이고,
  목표보다 앞서 있어도 늦추라고 하지 않는다(인계 I-12).
- CAUTION: 실측 속도로 계속 가면 허용선 이상, 과속 감지(OVERPACE), 또는 안내 페이스로도 허용선 이상.
- DANGER: 위험 심박(SAFETY).
가짜 모델: 예측 = 마지막 심박 + (미래 속도 평균 − 3.0) × (2, 4, 8). 여유 표는 0.
"""
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.decide.schemas import DecideRequest
from app.decide.service import run_decide
from app.main import create_app
from app.policy.config import ACTUAL_PACE_CHECK_ENV, load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, FakeModel5, decide_body, fixed_clock, flat_table

RISING = [140.0] * 68 + [140.0 + i for i in range(12)]          # 최근 1분 동안 1분에 12 bpm 오름
AHEAD = {"goal": {"targetDistanceM": 5000, "targetDurationSec": 2400, "targetPaceSecPerKm": None}}


def policy(check=True):
    return MpcPolicy(replace(load_policy_config(), actual_pace_check_enabled=check), flat_table(0.0))


def decide(guide, actual, hr, *, check=True, **ctx):
    history = {"hrBpm": hr if isinstance(hr, list) else [hr] * 80, "speedMps": [1000.0 / actual] * 80,
               "gradePct": [0.0] * 80}
    body = decide_body(anchorPaceSecPerKm=guide, currentGuidePaceSecPerKm=guide, history=history, **ctx)
    at = T0 + timedelta(seconds=3)
    model = FakeModel5()
    out = run_decide(DecideRequest.model_validate(body), model, policy(check), received_at=at, now=lambda: at)
    return out.response, model


def test_ok_when_running_at_guide_or_a_bit_faster_with_room():
    for actual in (330, 300):
        response, _ = decide(330, actual, 140.0)
        assert response.decision.coaching_level == "OK"
        assert response.decision.recommended_pace_sec_per_km == pytest.approx(330)     # 안내 그대로


def test_caution_when_actual_pace_would_cross_allow_line():
    response, model = decide(330, 220, 155.0)
    assert response.decision.coaching_level == "CAUTION"
    assert response.decision.recommended_pace_sec_per_km == pytest.approx(330)         # 안내로 돌아오라는 뜻
    assert model.batches[-1]["future_speed"].shape[0] == 6                             # 후보 5 + 실측 1행
    assert model.batches[-1]["future_speed"][-1] == pytest.approx(1000.0 / 220)


def test_actual_pace_check_can_be_turned_off():
    response, model = decide(330, 220, 155.0, check=False)
    assert response.decision.coaching_level == "OK"
    assert model.batches[-1]["future_speed"].shape[0] == 5                             # 덧붙인 행 없음


def test_overpace_is_caution_even_when_check_is_off():
    for check in (True, False):
        response, _ = decide(330, 300, RISING, check=check)
        assert "OVERPACE" in response.warnings and response.decision.coaching_level == "CAUTION"


def test_ok_does_not_slow_down_for_goal_but_caution_still_can():
    ok, _ = decide(340, 340, 140.0, **AHEAD)                                          # 목표보다 앞섬, 심박 여유
    assert ok.decision.coaching_level == "OK"
    assert ok.decision.reason == "HOLD" and ok.decision.recommended_pace_sec_per_km == pytest.approx(340)
    caution, _ = decide(340, 310, RISING, **AHEAD)
    assert caution.decision.coaching_level == "CAUTION"
    assert caution.decision.reason == "SLOW_DOWN_GOAL"                                 # 기존 동작 유지


def test_danger_on_dangerous_heart_rate():
    response, _ = decide(330, 330, 190.0)
    assert (response.decision.action, response.decision.coaching_level) == ("EASE_OFF", "DANGER")


@pytest.mark.parametrize("hr,level", [(120.0, "OK"), (190.0, "DANGER")])
def test_one_cell_path_sets_level(hr, level):
    body = decide_body(plan=[{"startM": 0, "endM": 5000, "ratio": 1.0}], activeSec=5, distanceM=10.0,
                       routeProgressM=10.0, history={"hrBpm": [hr], "speedMps": [2.8], "gradePct": [0.0]})
    at = T0 + timedelta(seconds=3)
    response = run_decide(DecideRequest.model_validate(body), FakeModel5(), policy(), received_at=at,
                          now=lambda: at).response
    assert response.decision.coaching_level == level


def test_api_returns_coaching_level_in_camel_case():
    app = create_app(lambda: FakeModel5(), lambda: policy(), clock=fixed_clock(3.0))
    with TestClient(app) as client:
        body = client.post("/v1/pace/decide", json=decide_body()).json()
    assert body["decision"]["coachingLevel"] in {"OK", "CAUTION", "DANGER"}


def test_env_override_for_actual_pace_check(monkeypatch):
    monkeypatch.setenv(ACTUAL_PACE_CHECK_ENV, "false")
    assert load_policy_config().actual_pace_check_enabled is False
    monkeypatch.setenv(ACTUAL_PACE_CHECK_ENV, "maybe")
    with pytest.raises(ValueError):
        load_policy_config()

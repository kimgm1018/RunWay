"""dev 캡처와 비교해 보행 예측 생략과 기존 종료 순서를 확인한다."""
import copy
import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import Mock

import pytest

from app.decide.schemas import DecideRequest
from app.decide.service import run_decide
from app.gru_personalization import GruPersonalizationResult, UNAVAILABLE_WARNING
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, FakeModel5, decide_body, flat_table


DEV_RESPONSES = json.loads(
    (Path(__file__).parent / "fixtures/ai04_505/dev_responses.json").read_text(encoding="utf-8")
)
WALK_CASES = {
    "walk_1_2", "walk_user_personalization", "walk_user_no_personalization",
    "speed_none_recent", "speed_just_below_1_5",
}


def case_inputs():
    # capture_dev.py와 같은 합성 입력·시각·설정을 사용한다.
    walk = {"speedMps": [1.2] * 80}
    plan = [{"startM": 0, "endM": 5000, "ratio": 1.0}]
    return {
        "walk_1_2": (decide_body(history=walk), 3.0, {}),
        "walk_user_personalization": (dict(decide_body(history=walk), userId=7), 3.0, {}),
        "walk_user_no_personalization": (
            dict(decide_body(history=walk), userId=7), 3.0,
            {"gru_personalization_enabled": False, "hr_threshold_lookup_configured": False},
        ),
        "speed_none_recent": (
            decide_body(history={"speedMps": [3.0] * 68 + [None] * 12}), 3.0, {},
        ),
        "speed_exactly_1_5": (decide_body(history={"speedMps": [1.5] * 80}), 3.0, {}),
        "speed_just_below_1_5": (decide_body(history={"speedMps": [1.49] * 80}), 3.0, {}),
        "running": (decide_body(), 3.0, {}),
        "running_user": (dict(decide_body(), userId=7), 3.0, {}),
        "running_safety": (
            decide_body(history={"hrBpm": [150.0] * 77 + [186.0] * 3}), 3.0, {},
        ),
        "paused_walking": (decide_body(runState="PAUSED", history=walk), 3.0, {}),
        "stale_walking": (decide_body(history=walk), 20.0, {}),
        "single_cell_plan_walking": (
            decide_body(plan=plan, activeSec=30,
                        history={"hrBpm": [150.0], "speedMps": [1.2], "gradePct": [0.0]}),
            3.0, {},
        ),
        "t0_hr_missing_walking": (
            decide_body(history={"speedMps": [1.2] * 80, "hrBpm": [150.0] * 79 + [None]}),
            3.0, {},
        ),
    }


@pytest.mark.parametrize("name", list(case_inputs()))
def test_dev_response_and_predict_calls(name):
    body, after, kwargs = case_inputs()[name]
    model = FakeModel5()
    model.predict = Mock(wraps=model.predict)
    model.predict_with_state = Mock(side_effect=AssertionError("개인화 예측을 호출하면 안 됩니다"))
    policy = MpcPolicy(load_policy_config(), flat_table(4.0))
    policy.decide = Mock(wraps=policy.decide)
    lookup = Mock()
    lookup.get_for_model.return_value = GruPersonalizationResult(warning=UNAVAILABLE_WARNING)
    if name == "walk_user_personalization":
        kwargs["user_personalization_lookup"] = lookup
    at = T0 + timedelta(seconds=after)

    outcome = run_decide(DecideRequest.model_validate(body), model, policy,
                         received_at=at, now=lambda: at, **kwargs)

    expected = copy.deepcopy(DEV_RESPONSES[name])
    if name in WALK_CASES:
        expected["response"]["candidates"] = []
        if name == "walk_user_personalization":
            expected["response"]["warnings"].remove(UNAVAILABLE_WARNING)
        model.predict.assert_not_called()
        policy.decide.assert_not_called()
        lookup.get_for_model.assert_not_called()
        assert outcome.policy is None
        assert outcome.pred_hr is None
        assert outcome.model_ms is None
        assert outcome.error is None
        assert all(value is None for value in vars(outcome.response.pacing).values())
        assert outcome.response.hr_personalized is (False if body.get("userId") is not None else None)
        assert outcome.response.hr_personalization_version is None
    else:
        assert model.predict.call_count == expected["predict_calls"]
    model.predict_with_state.assert_not_called()
    assert len(model.batches) == (0 if name in WALK_CASES else expected["predict_calls"])
    assert outcome.status == expected["status"]
    assert (None if outcome.error is None else [outcome.error.status, outcome.error.code]) == expected["error"]
    assert json.loads(outcome.response.model_dump_json(by_alias=True)) == expected["response"]

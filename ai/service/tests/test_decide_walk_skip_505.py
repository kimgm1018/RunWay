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
    # S15P31E105-506에서 바뀐 값만 맞춘다: 정책 버전(mpc-v0.4.3)과 위험 감속 권고 공식
    # max(안내, 실측 + 30)(캡처는 497의 max(실측, 안내) + 30 = 370). 이 경우 안내 340, 실측 3.0 m/s(333.3).
    expected["response"]["policyVersion"] = policy.policy_version   # 624에서 mpc-v0.5.0
    if name == "running_safety":
        expected["response"]["decision"]["recommendedPaceSecPerKm"] = max(340.0, 1000.0 / 3.0 + 30.0)
    if name not in WALK_CASES and expected["response"]["candidates"]:
        # S15P31E105-624: 후보가 5개(−10~+10)에서 AI10과 같은 9개(−30~+60)로 바뀌었다. 안내 그대로 후보는 dev 캡처
        # 2번 → 3번이고 예측·상한·통과는 같다. score는 "선택 상한 − 허용선"(표시용)으로 바뀌어 비교하지 않는다.
        old_base = expected["response"]["candidates"][2]
        actual = json.loads(outcome.response.model_dump_json(by_alias=True))
        assert len(actual["candidates"]) == 9
        new_base = dict(actual["candidates"][3])
        assert {k: v for k, v in new_base.items() if k != "score"} == {k: v for k, v in old_base.items() if k != "score"}
        expected["response"]["candidates"] = actual["candidates"]
        if expected["response"]["decision"]["chosenIndex"] == 2:
            expected["response"]["decision"]["chosenIndex"] = 3
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

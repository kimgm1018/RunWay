from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.decide.schemas import DecideRequest
from app.main import create_app
from app.ode_schemas import PersonalizeRequest, PlanRequest, SupportSample, SupportSession
from app.personalization import compute_personalization
from demo_fakes import FakeModel5, FakePolicy, decide_body


MAX_INT64 = (1 << 63) - 1


def client():
    return TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: None))


def support_session(session_id=1):
    return {
        "sessionId": session_id,
        "sessionStartedAt": "2026-11-02T00:00:00Z",
        "samples": [
            {
                "elapsedSec": 5 * i,
                "hrBpm": 120,
                "speedMps": 3,
                "gradePercent": 0,
                "hrQuality": "GOOD",
                "speedQuality": "GOOD",
                "gradeQuality": "GOOD",
            }
            for i in range(25)
        ],
    }


def validate_server_id(kind, value):
    if kind == "courseId":
        return PlanRequest.model_validate({"courseId": value}).course_id
    if kind == "ai05UserId":
        return PlanRequest.model_validate({"userId": value}).user_id
    if kind == "ai06UserId":
        body = PersonalizeRequest.model_validate({"userId": value, "sessions": [support_session()]})
        return body.user_id
    if kind == "ai06SessionId":
        return SupportSession.model_validate(support_session(value)).session_id
    if kind == "ai04SessionId":
        body = decide_body()
        body["context"]["sessionId"] = value
        return DecideRequest.model_validate(body).context.session_id
    raise AssertionError(kind)


@pytest.mark.parametrize(
    "kind",
    ["courseId", "ai05UserId", "ai06UserId", "ai06SessionId", "ai04SessionId"],
)
@pytest.mark.parametrize("value", [1, MAX_INT64])
def test_server_id_logical_int64_boundaries(kind, value):
    assert validate_server_id(kind, value) == value


@pytest.mark.parametrize(
    "kind",
    ["courseId", "ai05UserId", "ai06UserId", "ai06SessionId", "ai04SessionId"],
)
@pytest.mark.parametrize("value", ["1", str(MAX_INT64)])
def test_decimal_string_id_compatibility_normalizes_to_int(kind, value):
    assert validate_server_id(kind, value) == int(value)


@pytest.mark.parametrize(
    "kind",
    ["courseId", "ai05UserId", "ai06UserId", "ai06SessionId", "ai04SessionId"],
)
@pytest.mark.parametrize("value", [0, -1, MAX_INT64 + 1, True, 1.0, "runner-1"])
def test_server_id_rejects_invalid_logical_values(kind, value):
    with pytest.raises(ValidationError):
        validate_server_id(kind, value)


def test_ai04_goal_preference_is_fixed_at_public_boundary():
    body = decide_body()
    body["context"]["goalPreference"] = 0.5
    assert DecideRequest.model_validate(body).context.goal_preference == 0.5

    for value in (0.0, 0.25, 1.0):
        invalid = decide_body()
        invalid["context"]["goalPreference"] = value
        with pytest.raises(ValidationError):
            DecideRequest.model_validate(invalid)


@pytest.mark.parametrize(
    "updates",
    [
        {"targetDistanceM": 0},
        {"targetDistanceM": -1},
        {"targetDistanceM": 45001},
        {"targetDistanceM": 5000.0},
        {"targetDistanceM": 5000.5},
        {"targetDurationSec": 0},
        {"targetDurationSec": 1800.0},
        {"targetDurationSec": 1800.5},
        {"targetPaceSecPerKm": -1},
        {"targetPaceSecPerKm": 300.001},
        {"targetPaceSecPerKm": 360},
    ],
    ids=["zero-distance", "negative-distance", "over-45km", "distance-integer-float",
         "fractional-distance", "zero-duration", "duration-integer-float",
         "fractional-duration", "negative-pace", "pace-precision", "all-three-even-when-consistent"],
)
def test_ai04_goal_shared_contract_errors_remain_400(updates):
    body = decide_body()
    body["context"]["goal"].update(updates)

    with client() as c:
        response = c.post("/v1/pace/decide", json=body)

    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_ai04_huge_duration_is_rejected_as_request_validation_not_decision_failure():
    body = decide_body()
    body["context"]["goal"]["targetDurationSec"] = 10**400

    with client() as c:
        response = c.post("/v1/pace/decide", json=body)

    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_ai04_goal_rejects_non_finite_pace():
    from app.decide.schemas import Goal

    with pytest.raises(ValidationError):
        Goal.model_validate(
            {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": float("nan")}
        )


def test_ai04_goal_rejects_boolean_pace():
    from app.decide.schemas import Goal

    with pytest.raises(ValidationError):
        Goal.model_validate(
            {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": True}
        )


def test_ai04_goal_accepts_integer_json_pace():
    from app.decide.schemas import Goal

    goal = Goal.model_validate(
        {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": 360}
    )

    assert goal.target_pace_sec_per_km == 360


def test_ai04_goal_rejects_numeric_string_pace():
    from app.decide.schemas import Goal

    with pytest.raises(ValidationError):
        Goal.model_validate(
            {"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": "360"}
        )


@pytest.mark.parametrize(
    "payload",
    [
        {"targetDistanceM": 5000, "targetPaceSecPerKm": True},
        {"targetDurationSec": 1800, "averagePaceSecPerKm": True},
        {
            "courseId": 7,
            "gradeProfile": [{"startDistanceM": 0, "endDistanceM": 1000, "gradePercent": True}],
            "targetDurationSec": 300,
        },
    ],
    ids=["target-pace", "average-pace", "grade-profile"],
)
def test_ai05_numeric_boolean_is_not_coerced_to_one(payload):
    with client() as c:
        response = c.post("/v1/pace/plan", json=payload)

    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "payload",
    [
        {"targetDistanceM": 5000, "targetPaceSecPerKm": "300"},
        {"targetDurationSec": 1800, "averagePaceSecPerKm": "300"},
        {
            "courseId": 7,
            "gradeProfile": [{"startDistanceM": 0, "endDistanceM": 1000, "gradePercent": "0"}],
            "targetDurationSec": 300,
        },
    ],
    ids=["target-pace", "average-pace", "grade-profile"],
)
def test_ai05_numeric_strings_are_not_coerced_to_numbers(payload):
    with client() as c:
        response = c.post("/v1/pace/plan", json=payload)

    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize("field", ["elapsedSec", "hrBpm", "speedMps", "gradePercent"])
def test_ai06_sample_numeric_booleans_are_rejected(field):
    sample = {"elapsedSec": 5, "hrBpm": 120, "speedMps": 3, "gradePercent": 0}
    sample[field] = True

    with pytest.raises(ValidationError):
        SupportSample.model_validate(sample)


@pytest.mark.parametrize("field", ["elapsedSec", "hrBpm", "speedMps", "gradePercent"])
def test_ai06_sample_numeric_strings_are_rejected(field):
    sample = {"elapsedSec": 5, "hrBpm": 120, "speedMps": 3, "gradePercent": 0}
    sample[field] = "5"

    with pytest.raises(ValidationError):
        SupportSample.model_validate(sample)


def test_ai06_sample_integer_json_numbers_remain_valid():
    sample = SupportSample.model_validate({"elapsedSec": 5, "hrBpm": 120, "speedMps": 3, "gradePercent": 0})

    assert sample.elapsed_sec == 5
    assert sample.hr_bpm == 120
    assert sample.speed_mps == 3
    assert sample.grade_percent == 0


@pytest.mark.parametrize("field", ["targetDistanceM", "targetDurationSec"])
def test_ai05_huge_integer_goals_return_goal_error_not_internal_server_error(field):
    with client() as c:
        response = c.post("/v1/pace/plan", json={field: 10**400})

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_GOAL"


def test_ai05_rejects_goal_preference_other_than_v0_value():
    payload = {"targetDistanceM": 5000, "targetDurationSec": 1650, "goalPreference": 0.5}
    with client() as c:
        valid = c.post("/v1/pace/plan", json=payload)
        invalid = c.post("/v1/pace/plan", json={**payload, "goalPreference": 0.25})

    assert valid.status_code == 200
    assert valid.json()["goalPreference"] == 0.5
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "VALIDATION_ERROR"


def test_ai05_shared_goal_rules_use_distinct_contract_errors():
    all_three = {
        "targetDistanceM": 5000,
        "targetDurationSec": 1500,
        "targetPaceSecPerKm": 300,
    }
    over_distance = {"targetDistanceM": 45001, "targetDurationSec": 15000}
    too_precise_pace = {"targetDistanceM": 5000, "targetPaceSecPerKm": 300.001}
    with client() as c:
        three_response = c.post("/v1/pace/plan", json=all_three)
        distance_response = c.post("/v1/pace/plan", json=over_distance)
        pace_response = c.post("/v1/pace/plan", json=too_precise_pace)

    assert three_response.status_code == 422
    assert three_response.json()["code"] == "INVALID_GOAL"
    assert distance_response.status_code == 422
    assert distance_response.json()["code"] == "INVALID_GOAL"
    assert pace_response.status_code == 400
    assert pace_response.json()["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "field",
    ["targetDistanceM", "targetDurationSec", "targetPaceSecPerKm"],
)
@pytest.mark.parametrize("value", [0, -1])
def test_ai05_nonpositive_goal_values_are_semantic_422(field, value):
    with client() as c:
        response = c.post("/v1/pace/plan", json={field: value})

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_GOAL"


def test_ai05_explicit_goal_distance_accepts_exact_45km_cap():
    with client() as c:
        response = c.post(
            "/v1/pace/plan",
            json={"targetDistanceM": 45000, "targetDurationSec": 18000},
        )

    assert response.status_code == 200
    assert response.json()["targetDistanceM"] == 45000


def test_ai05_long_course_without_explicit_goal_distance_is_not_rejected_by_goal_cap():
    course = {
        "courseId": 7,
        "gradeProfile": [{"startDistanceM": 0, "endDistanceM": 46000, "gradePercent": 0}],
        "targetDurationSec": 13800,
    }
    with client() as c:
        response = c.post("/v1/pace/plan", json=course)

    assert response.status_code == 200
    assert response.json()["planStatus"] == "PLANNED"
    assert response.json()["targetDistanceM"] == 46000
    # The session API's one-stored-segment fallback belongs to backend persistence;
    # AI05 retains its richer 1km preview response.


def test_personalization_accepts_int_user_id_with_real_support_samples_and_string_model_key():
    body = PersonalizeRequest.model_validate(
        {
            "userId": 27,
            "sessions": [support_session(314)],
        }
    )

    class FitModule:
        observed_group = None
        observed_seed = None

        @staticmethod
        def fit_items(records, contexts, seed):
            FitModule.observed_group = records[0].group
            FitModule.observed_seed = seed
            return []

    runtime = SimpleNamespace(
        info=SimpleNamespace(summary_feature_count=27, model_version="test-ode"),
        fit_module=FitModule,
        device="cpu",
        model=None,
        stats=None,
    )
    result = compute_personalization(body, runtime, now=datetime(2026, 11, 2, tzinfo=timezone.utc))

    assert result["userId"] == 27
    assert isinstance(result["userId"], int)
    assert FitModule.observed_group == "27"
    assert isinstance(FitModule.observed_seed, int)


def test_personalization_converts_nonempty_p4_user_mapping_key_to_string():
    body = PersonalizeRequest.model_validate(
        {"userId": 27, "sessions": [support_session(314)]}
    )

    class FitModule:
        observed_keys = None

        @staticmethod
        def fit_items(records, contexts, seed):
            return [{"supportSessionId": records[0].session_id}]

        @staticmethod
        def fit_p4(model, fit_items_by_group, stats, *, lr, lam, steps, per_step, seed, device):
            FitModule.observed_keys = set(fit_items_by_group)
            return {steps[0]: {"27": [1.0, 2.0, 3.0, 4.0]}}

    runtime = SimpleNamespace(
        info=SimpleNamespace(summary_feature_count=27, model_version="test-ode"),
        fit_module=FitModule,
        device="cpu",
        model=object(),
        stats=object(),
    )
    result = compute_personalization(body, runtime, now=datetime(2026, 11, 2, tzinfo=timezone.utc))

    assert FitModule.observed_keys == {"27"}
    assert result["p4"] == [1.0, 2.0, 3.0, 4.0]
    assert result["userId"] == 27


def test_ai03_grade_pct_and_validation_error_contract_remain_unchanged():
    payload = {
        "elapsedSec": 995,
        "history": {"hrBpm": [150] * 80, "speedMps": [3] * 80, "gradePct": [0] * 80},
        "candidates": [{"futureSpeedMps": [3] * 24, "futureGradePct": [0] * 24}],
    }
    invalid_grade_name = {
        **payload,
        "history": {
            "hrBpm": [150] * 80,
            "speedMps": [3] * 80,
            "gradePercent": [0] * 80,
        },
    }
    with client() as c:
        valid = c.post("/v1/hr/predict", json=payload)
        invalid = c.post("/v1/hr/predict", json=invalid_grade_name)

    assert valid.status_code == 200
    assert valid.json()["predictions"][0]["futureGradeUsed"] is True
    assert invalid.status_code == 400
    assert invalid.json()["code"] == "VALIDATION_ERROR"
    assert isinstance(invalid.json()["details"], dict)
    assert any(field["name"] == "history.gradePct" for field in invalid.json()["details"]["fields"])


def test_internal_prerun_planner_keeps_experimental_preference_range():
    from app.planner.prerun_planner import CourseSegment, PreRunPlanner, PreRunRequest

    for preference in (0.0, 1.0):
        request = PreRunRequest(
            target_distance_m=1000,
            target_pace_sec_per_km=300,
            goal_preference=preference,
            course_segments=(CourseSegment(0, 1000, 0, 1.0),),
        )
        result = PreRunPlanner().plan(request)
        assert result.goal_preference == preference

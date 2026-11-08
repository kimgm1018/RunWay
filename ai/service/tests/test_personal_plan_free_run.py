"""AI09 자유러닝(코스 없음, 목표 거리만) 평지 계획(S15P31E105-486)."""
from decimal import ROUND_HALF_UP, Decimal

from fastapi.testclient import TestClient
import pytest

from app.main import create_app
from app.personal_plan import FREE_RUN_FLAT_GRADE, OdeBalancedPaceOptimizer
from demo_fakes import FakeModel5, FakePolicy
from test_personal_plan_ode import RecordingOdeRuntime, _bundle
from test_personal_plan_service import PersonalLookup, PopulationLookup, _configure_average_bundle

FLAT_WARNINGS = [FREE_RUN_FLAT_GRADE, "FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL", "ODE_GRADE_FILLED_0"]


class NoCourseLookup:
    """자유러닝은 코스를 조회하지 않아야 한다."""

    def __init__(self):
        self.calls = []

    def get_course(self, course_id):
        self.calls.append(course_id)
        raise AssertionError("자유러닝 요청에서 코스를 조회했습니다")


def _post(body, *, personal=None, runtime=None, optimizer=None, population=None, monkeypatch=None,
          policy="flat0", course_lookup=None):
    monkeypatch.setenv("FREE_RUN_GRADE_POLICY", policy)
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: runtime,
                     personal_plan_course_lookup=course_lookup or NoCourseLookup(),
                     personal_plan_user_lookup=PersonalLookup(personal),
                     personal_plan_optimizer=optimizer, personal_plan_population_lookup=population)
    with TestClient(app) as client:
        return client.post("/v1/pace/personal-plan", json=body)


def _personal(monkeypatch, body, **kwargs):
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    return _post(body, personal=_bundle(), runtime=RecordingOdeRuntime(), optimizer=OdeBalancedPaceOptimizer(),
                 monkeypatch=monkeypatch, **kwargs)


def _assert_ratio_contract(body):
    lengths = [Decimal(str(s["lengthM"])) for s in body["segments"]]
    ratios = [Decimal(str(s["paceRatio"])) for s in body["segments"]]
    assert all(Decimal("0.85") <= ratio <= Decimal("1.20") for ratio in ratios)
    assert abs(sum(l * r for l, r in zip(lengths, ratios)) / sum(lengths) - 1) <= Decimal("1e-6")


def test_free_run_with_distance_only_returns_a_flat_personal_plan(monkeypatch):
    lookup = NoCourseLookup()
    response = _personal(monkeypatch, {"userId": 73, "selectedGoal": {"targetDistanceM": 5000}},
                         course_lookup=lookup)

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["courseId"] is None and body["courseVersion"] is None
    assert body["planStatus"] == "EXPERIMENTAL" and body["personalized"] is True
    assert body["targetDistanceM"] == 5000
    assert [s["endDistanceM"] for s in body["segments"]] == [1000, 2000, 3000, 4000, 5000]
    assert body["warnings"][:3] == FLAT_WARNINGS
    assert body["predictedFinishSec"] > 0
    _assert_ratio_contract(body)
    assert lookup.calls == []
    # 기존 계산 그대로: 속도 보정 s=1.45, 목표 심박 보정 경고가 붙는다.
    assert "ODE_SPEED_CALIB_SCALE=1.45" in body["warnings"]
    assert any(w.startswith("TARGET_HR_CALIB_K=") for w in body["warnings"])


def test_free_run_flat_grade_reaches_the_ode_as_zero_percent(monkeypatch):
    runtime = RecordingOdeRuntime()
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    response = _post({"userId": 73, "selectedGoal": {"targetDistanceM": 3500}}, personal=_bundle(),
                     runtime=runtime, optimizer=OdeBalancedPaceOptimizer(), monkeypatch=monkeypatch)

    assert response.status_code == 200
    assert runtime.requests
    assert all(grade == 0.0 for request in runtime.requests for row in request.future_grade_pct for grade in row)
    assert [s["lengthM"] for s in response.json()["segments"]] == [1000, 1000, 1000, 500]


def test_free_run_with_distance_and_duration_keeps_the_goal_time(monkeypatch):
    response = _personal(monkeypatch, {"userId": 73, "selectedGoal": {"targetDistanceM": 5000,
                                                                       "targetDurationSec": 1800}})

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["predictedFinishSec"] == 1800
    assert body["targetPaceSecPerKm"] == 360.0
    _assert_ratio_contract(body)
    for segment in body["segments"]:
        backend = (Decimal("360") * Decimal(str(segment["paceRatio"]))).quantize(Decimal("0.01"), ROUND_HALF_UP)
        assert abs(backend - Decimal(str(segment["paceSecPerKm"]))) <= Decimal("0.01")


def test_free_run_without_user_id_uses_the_average_bundle(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    response = _post({"selectedGoal": {"targetDistanceM": 5000}}, runtime=RecordingOdeRuntime(),
                     optimizer=OdeBalancedPaceOptimizer(), monkeypatch=monkeypatch)

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["planStatus"] == "AVERAGE_BASED" and body["personalized"] is False
    assert body["userId"] is None and body["courseId"] is None
    assert FREE_RUN_FLAT_GRADE in body["warnings"] and "USER_ID_NOT_PROVIDED" in body["warnings"]


def test_free_run_does_not_use_the_course_conditional_population_mean(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "false")
    response = _post({"userId": 73, "selectedGoal": {"targetDistanceM": 5000}}, population=PopulationLookup(),
                     monkeypatch=monkeypatch)

    assert response.status_code == 503
    assert response.json()["code"] == "PERSONAL_PLAN_NOT_READY"


@pytest.mark.parametrize("body", [
    {"userId": 73},
    {"userId": 73, "courseId": None},
    {"userId": 73, "selectedGoal": None},
    {"userId": 73, "selectedGoal": {"targetDurationSec": 1800}},
    {"userId": 73, "selectedGoal": {"targetPaceSecPerKm": 345.5}},
])
def test_free_run_without_course_or_distance_is_still_rejected(monkeypatch, body):
    response = _personal(monkeypatch, body)

    assert response.status_code == 400
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert response.json()["details"]["fields"][0]["name"] == "selectedGoal"


@pytest.mark.parametrize("distance", [0, -1000, 45001])
def test_free_run_distance_outside_the_plan_range_is_invalid(monkeypatch, distance):
    response = _personal(monkeypatch, {"userId": 73, "selectedGoal": {"targetDistanceM": distance}})

    assert response.status_code == 422
    assert response.json()["code"] == "INVALID_GOAL"


def test_free_run_respects_reject_grade_policy(monkeypatch):
    response = _personal(monkeypatch, {"userId": 73, "selectedGoal": {"targetDistanceM": 5000}}, policy="reject")

    assert response.status_code == 422
    assert response.json()["code"] == "COURSE_GRADE_UNAVAILABLE"


def test_invalid_course_id_reports_only_the_course_id_error(monkeypatch):
    response = _personal(monkeypatch, {"userId": 73, "courseId": 0})

    assert response.status_code == 400
    assert [field["name"] for field in response.json()["details"]["fields"]] == ["courseId"]

"""코스 AI09 요청 회귀(S15P31E105-486): 자유러닝(코스 없음) 지원 전후로 코스 요청 응답이 같아야 한다.

fixtures/ai09_course_regression_487.json은 486 변경 전 코드(S15P31E105-487 브랜치 1c0ad6f)에서 만든 응답이다.
다시 만들기: AI09_REGRESSION_REGENERATE=1 pytest tests/test_personal_plan_course_regression.py
(의도한 계약 변경일 때만. 다시 만든 이유를 커밋에 적는다.)
"""
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.ode_schemas import PlanGradeSegment
from app.personal_plan import CoursePlanSnapshot, OdeBalancedPaceOptimizer
from demo_fakes import FakeModel5, FakePolicy
from test_personal_plan_ode import RecordingOdeRuntime, _bundle
from test_personal_plan_service import (
    CourseLookup,
    PersonalLookup,
    PopulationLookup,
    _configure_average_bundle,
)

FIXTURE = Path(__file__).parent / "fixtures" / "ai09_course_regression_487.json"


class MissingGradeCourseLookup:
    def get_course(self, course_id):
        return CoursePlanSnapshot(
            course_id=course_id, distance_m=3000.0,
            grade_profile=(PlanGradeSegment(startDistanceM=0, endDistanceM=3000, gradePercent=0),),
            version="course-missing-grade-v1", grade_source="MISSING",
        )


def _post(body, *, personal=None, runtime=None, optimizer=None, population=None, course_lookup=None):
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: runtime,
                     personal_plan_course_lookup=course_lookup or CourseLookup(),
                     personal_plan_user_lookup=PersonalLookup(personal),
                     personal_plan_optimizer=optimizer, personal_plan_population_lookup=population)
    with TestClient(app) as client:
        response = client.post("/v1/pace/personal-plan", json=body)
    return {"status": response.status_code, "body": response.json()}


def _course_responses(monkeypatch, tmp_path):
    monkeypatch.setenv("FREE_RUN_GRADE_POLICY", "flat0")
    results = {}
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    for name, goal in (("none", None), ("duration", {"targetDurationSec": 840}),
                       ("pace", {"targetPaceSecPerKm": 345.5}), ("distance_only", {"targetDistanceM": 2346})):
        body = {"userId": 73, "courseId": 297}
        if goal is not None:
            body["selectedGoal"] = goal
        results[f"personal_ode_{name}"] = _post(body, personal=_bundle(), runtime=RecordingOdeRuntime(),
                                                optimizer=OdeBalancedPaceOptimizer())
    results["personal_ode_missing_grade"] = _post(
        {"userId": 73, "courseId": 301}, personal=_bundle(), runtime=RecordingOdeRuntime(),
        optimizer=OdeBalancedPaceOptimizer(), course_lookup=MissingGradeCourseLookup())
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "false")
    results["population_mean_none"] = _post({"userId": 73, "courseId": 297}, population=PopulationLookup())
    results["population_mean_duration"] = _post(
        {"userId": 73, "courseId": 297, "selectedGoal": {"targetDurationSec": 840}}, population=PopulationLookup())
    results["not_ready"] = _post({"userId": 73, "courseId": 297})
    results["mismatched_distance"] = _post(
        {"userId": 73, "courseId": 297, "selectedGoal": {"targetDistanceM": 5000}}, population=PopulationLookup())
    _configure_average_bundle(monkeypatch, tmp_path)
    results["average_bundle_no_user"] = _post({"courseId": 297}, runtime=RecordingOdeRuntime(),
                                              optimizer=OdeBalancedPaceOptimizer())
    return results


def test_course_requests_match_the_pre_free_run_responses(monkeypatch, tmp_path):
    actual = _course_responses(monkeypatch, tmp_path)
    if os.getenv("AI09_REGRESSION_REGENERATE") == "1":
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
                           encoding="utf-8")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))

    assert set(actual) == set(expected)
    for name in expected:
        assert actual[name] == expected[name], name

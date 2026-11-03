from fastapi.testclient import TestClient

from app.main import create_app
from app.personal_plan import (
    CoursePlanSnapshot,
    OdeBalancedPaceOptimizer,
    PopulationMeanPlanSnapshot,
)
from app.ode_schemas import PlanGradeSegment
from demo_fakes import FakeModel5, FakePolicy
from test_personal_plan_ode import RecordingOdeRuntime, _bundle


class CourseLookup:
    def get_course(self, course_id):
        return CoursePlanSnapshot(
            course_id=course_id, distance_m=2345.678,
            grade_profile=(PlanGradeSegment(startDistanceM=0, endDistanceM=1200, gradePercent=0),
                           PlanGradeSegment(startDistanceM=1200, endDistanceM=2345.678, gradePercent=5)),
            version="course-snapshot-v3",
        )


class PersonalLookup:
    def __init__(self, value):
        self.value = value

    def get_personalization(self, user_id):
        return self.value


class PopulationLookup:
    def get_population_mean_plan(self, course):
        return PopulationMeanPlanSnapshot(
            course_id=course.course_id,
            course_version=course.version,
            segment_paces_sec_per_km=(330.0, 340.0, 350.0),
            dataset_version="synthetic-test-fixture-v1",
            train_subject_count=2,
            train_run_count=3,
            course_coverage=0.94,
            source_scope="SYNTHETIC_TEST_FIXTURE_NOT_TRAIN_DATA",
        )


def _client(*, personal, runtime, population=None, optimizer=None):
    return TestClient(create_app(
        lambda: FakeModel5(), lambda: FakePolicy(),
        ode_loader=lambda: runtime,
        personal_plan_course_lookup=CourseLookup(),
        personal_plan_user_lookup=PersonalLookup(personal),
        personal_plan_optimizer=optimizer,
        personal_plan_population_lookup=population,
    ))


def test_external_request_with_only_user_and_course_runs_personal_ode_plan(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    runtime = RecordingOdeRuntime()
    user = _bundle()
    with _client(personal=user, runtime=runtime, optimizer=OdeBalancedPaceOptimizer()) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 200
    body = response.json()
    assert body["personalized"] is True
    assert body["planSource"] == "PERSONAL_ODE_HR_BALANCE"
    assert body["policyValidated"] is False
    assert body["hr0Used"] is False
    assert [segment["endDistanceM"] for segment in body["segments"]] == [1000, 2000, 2345.678]
    weighted_mean = sum(s["lengthM"] * s["paceSecPerKm"] for s in body["segments"]) / 2345.678
    assert all(abs(s["paceRatio"] - round(s["paceSecPerKm"] / weighted_mean, 2)) < 1e-9
               for s in body["segments"])


def test_person_without_ode_bundle_uses_explicit_average_fixture_and_is_not_personalized():
    with _client(personal=None, runtime=None, population=PopulationLookup()) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 200
    body = response.json()
    assert body["personalized"] is False
    assert body["planStatus"] == "AVERAGE_BASED"
    assert body["planSource"] == "SYNTHETIC_TEST_FIXTURE_NOT_TRAIN_DATA"
    assert body["modelVersion"] == "train-mean:synthetic-test-fixture-v1"
    assert "AVERAGE_BASED_RECOMMENDATION" in body["warnings"]
    assert "TRAIN_SUBJECTS=2" in body["warnings"]
    assert [segment["endDistanceM"] for segment in body["segments"]] == [1000, 2000, 2345.678]


def test_no_personalization_and_no_real_population_mean_does_not_invent_fallback():
    with _client(personal=None, runtime=None) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 503
    assert response.json()["code"] == "PERSONAL_PLAN_NOT_READY"
    assert response.json()["details"]["fields"][0]["reason"] == "POPULATION_MEAN_MODEL_NOT_CONFIGURED"




def test_existing_bundle_with_feature_flag_off_reports_disabled_instead_of_population(monkeypatch):
    monkeypatch.delenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", raising=False)
    with _client(personal=_bundle(), runtime=RecordingOdeRuntime(),
                 optimizer=OdeBalancedPaceOptimizer()) as client:
        response = client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})

    assert response.status_code == 503
    assert response.json()["details"]["fields"][0]["reason"] == "PERSONAL_PLAN_EXPERIMENTAL_DISABLED"

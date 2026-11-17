import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient

from app.main import create_app
from app.ode_schemas import PlanRequest
from app.planner.prerun_planner import CourseSegment, PreRunPlanner, PreRunRequest, _segment_difficulty_ratios
from demo_fakes import FakeModel5, FakePolicy


def client():
    return TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: None))


def test_ai05_course_and_free_run_follow_plan_contract():
    route = [{"startDistanceM": i * 1000, "endDistanceM": (i + 1) * 1000,
              "gradePercent": (i % 3) - 1, "basePaceRatio": 1.0}
             for i in range(10)]
    with client() as c:
        course = c.post("/v1/pace/plan", json={"courseId": 7, "gradeProfile": route,
                                               "targetDurationSec": 3600}).json()
        free = c.post("/v1/pace/plan", json={"targetDistanceM": 5000,
                                             "targetDurationSec": 1650}).json()
    assert course["planStatus"] == "PLANNED"
    assert len(course["segments"]) == 10
    assert course["segmentDifficultyRatios"] == [1.0] * 10
    assert course["hrPreview"]["points"] == []
    assert free["planStatus"] == "PLANNED"
    assert free["segments"][-1]["endDistanceM"] == 5000
    assert free["segmentDifficultyRatios"] == []


def test_ai05_returns_goal_independent_course_difficulty_ratios_on_km_splits():
    route = [
        {"startDistanceM": 0, "endDistanceM": 600, "gradePercent": 1, "basePaceRatio": 1.2},
        {"startDistanceM": 600, "endDistanceM": 1600, "gradePercent": 0, "basePaceRatio": 0.8},
        {"startDistanceM": 1600, "endDistanceM": 2500, "gradePercent": -1, "basePaceRatio": 1.4},
    ]
    ratios_by_preference = []
    for preference in (0.0, 1.0):
        plan = PreRunPlanner().plan(PreRunRequest(
            target_distance_m=2500,
            target_pace_sec_per_km=360,
            goal_preference=preference,
            course_segments=tuple(
                CourseSegment(
                    segment["startDistanceM"],
                    segment["endDistanceM"],
                    segment["gradePercent"],
                    segment["basePaceRatio"],
                )
                for segment in route
            ),
        ))
        ratios_by_preference.append(_segment_difficulty_ratios(plan.segments, 2500))
    ratios = ratios_by_preference[0]
    assert len(ratios) == 3
    assert ratios == ratios_by_preference[1]
    assert all(value > 0 for value in ratios)
    assert abs(sum(value * length for value, length in zip(ratios, (1000, 1000, 500))) / 2500 - 1.0) < 1e-5


def test_ai05_rejects_hr0_and_uses_common_error_shape():
    with client() as c:
        response = c.post("/v1/pace/plan", json={"targetDistanceM": 5000,
                                                 "targetDurationSec": 1650, "hr0Bpm": 90})
    assert response.status_code == 400
    assert set(response.json()) == {"code", "message", "details"}


def test_ai05_grade_profile_accepts_450_and_rejects_451_segments():
    profile = [{"startDistanceM": i, "endDistanceM": i + 1, "gradePercent": 0}
               for i in range(450)]

    assert len(PlanRequest.model_validate({"gradeProfile": profile}).grade_profile) == 450
    with pytest.raises(ValidationError):
        PlanRequest.model_validate({"gradeProfile": profile + [
            {"startDistanceM": 450, "endDistanceM": 451, "gradePercent": 0}
        ]})


def test_ai06_returns_not_ready_when_ode_checkpoint_is_absent():
    with client() as c:
        response = c.post("/v1/hr/personalize", json={"userId": 1, "sessions": []})
    assert response.status_code in (400, 422)
    with client() as c:
        response = c.post("/v1/hr/personalize", json={"userId": 1, "sessions": [{
            "sessionId": 101, "sessionStartedAt": "2026-10-30T08:00:00Z",
            "samples": [{"elapsedSec": 5 * i, "hrBpm": 120, "speedMps": 3,
                         "gradePercent": 0, "hrQuality": "GOOD", "speedQuality": "GOOD",
                         "gradeQuality": "GOOD"} for i in range(25)]}]})
    assert response.status_code == 503
    assert response.json()["code"] == "MODEL_NOT_READY"


def test_ai06_disabled_gru_skips_head_calculation_and_returns_learned_thresholds(monkeypatch):
    monkeypatch.delenv("GRU_PERSONALIZATION_ENABLED", raising=False)
    monkeypatch.setattr("app.main.compute_gru_personalization",
                        lambda *_args, **_kwargs: pytest.fail("꺼진 GRU 출력층을 계산하면 안 됩니다"))
    body = {"userId": 73, "sessions": [{
        "sessionId": 101,
        "sessionStartedAt": "2026-10-30T08:00:00Z",
        # S15P31E105-901: 허용선 계산은 이동 10분·1 km 이상 러닝만 쓰므로 10분(121표본)으로 둔다.
        "samples": [{"elapsedSec": 5 * i, "hrBpm": 100 + i % 25, "speedMps": 3,
                     "gradePercent": 0, "hrQuality": "GOOD", "speedQuality": "GOOD",
                     "gradeQuality": "GOOD"} for i in range(121)],
    }]}

    with client() as c:
        response = c.post("/v1/hr/personalize", json=body)

    payload = response.json()
    assert response.status_code == 503 and payload["code"] == "MODEL_NOT_READY"
    assert payload["gruPersonalization"] is None
    assert "GRU_PERSONALIZATION_DISABLED" in payload["warnings"]
    assert (payload["hrDangerBpm"], payload["hrSustainBpm"], payload["hrThresholdRunCount"]) == (124, 120, 1)


def test_health_reports_both_model_readiness_states():
    with client() as c:
        response = c.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "UP"
    assert response.json()["modelLoaded"] is True
    assert response.json()["models"]["gru"]["status"] == "UP"
    assert response.json()["models"]["ode"]["status"] == "DOWN"


def test_ai05_keeps_pace_plan_and_warns_when_requested_ode_preview_is_unavailable(monkeypatch):
    monkeypatch.setenv("ODE_PREVIEW_ENABLED", "true")
    with client() as c:
        response = c.post("/v1/pace/plan", json={"targetDistanceM": 5000,
                                                 "targetDurationSec": 1650})
    assert response.status_code == 200
    payload = response.json()
    assert payload["planStatus"] == "PLANNED"
    assert payload["segments"]
    assert payload["hrPreview"]["points"] == []
    assert "ODE_MODEL_NOT_READY" in [warning["code"] for warning in payload["warnings"]]

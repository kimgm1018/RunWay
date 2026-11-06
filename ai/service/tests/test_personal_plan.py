from decimal import Decimal

from fastapi.testclient import TestClient
import pytest

from app.inference import ApiError
from app.main import create_app
from app.ode_schemas import PlanGradeSegment
from app.personal_plan import (
    CoursePlanSnapshot,
    PersonalPlanSegment,
    SelectedGoal,
    finalize_personal_segments,
    finish_sec_from_segments,
    resolve_selected_goal,
    split_distance_1km,
)
from demo_fakes import FakeModel5, FakePolicy


def _client():
    return TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: None))


def test_personal_plan_is_explicitly_not_ready_when_server_lookups_are_unconfigured():
    with _client() as client:
        response = client.post(
            "/v1/pace/personal-plan",
            json={
                "userId": 73,
                "courseId": 297,
                "selectedGoal": {"targetDurationSec": 1500},
            },
        )

    assert response.status_code == 503
    assert response.json()["code"] == "PERSONAL_PLAN_NOT_READY"
    assert response.json()["details"]["fields"][0]["name"] == "readiness"


def test_goal_resolution_rejects_route_profile_that_disagrees_with_course_distance():
    course = CoursePlanSnapshot(
        course_id=297,
        distance_m=5000,
        grade_profile=(PlanGradeSegment(startDistanceM=0, endDistanceM=4000, gradePercent=0),),
        version="route-v1",
    )

    with pytest.raises(ApiError) as error:
        resolve_selected_goal(SelectedGoal(targetDurationSec=1500), course)

    assert error.value.code == "COURSE_DATA_MISMATCH"


def test_goal_resolution_uses_course_and_selected_duration_without_habitual_pace():
    course = CoursePlanSnapshot(
        course_id=297,
        distance_m=5000,
        grade_profile=(PlanGradeSegment(startDistanceM=0, endDistanceM=5000, gradePercent=0),),
        version="route-v1",
    )

    goal = resolve_selected_goal(SelectedGoal(targetDurationSec=1500), course)

    assert goal.distance_m == Decimal("5000.0")
    assert goal.target_pace_sec_per_km == Decimal("300.0")
    assert goal.target_pace_source == "TARGET_DURATION"


def test_existing_ai05_plan_route_keeps_its_current_course_contract():
    with _client() as client:
        response = client.post(
            "/v1/pace/plan",
            json={
                "courseId": 297,
                "gradeProfile": [{
                    "startDistanceM": 0,
                    "endDistanceM": 5000,
                    "gradePercent": 0,
                    "basePaceRatio": 1,
                }],
                "targetDurationSec": 1500,
            },
        )

    assert response.status_code == 200
    assert response.json()["planStatus"] == "PLANNED"
    assert response.json()["targetPaceSecPerKm"] == 300.0
    assert response.json()["goalPreference"] == 0.5


def test_split_distance_preserves_exact_last_remainder():
    assert split_distance_1km(2345.678) == (
        (Decimal("0"), Decimal("1000")),
        (Decimal("1000"), Decimal("2000")),
        (Decimal("2000"), Decimal("2345.678")),
    )


def test_final_segments_round_pace_and_ratio_but_keep_exact_remainder():
    segments = finalize_personal_segments(
        2345.678,
        300,
        (290, 310, 300),
        preserve_goal_duration=False,
    )

    assert [segment.end_distance_m for segment in segments] == [1000, 2000, 2345.678]
    assert [segment.pace_sec_per_km for segment in segments] == [290, 310, 300]
    assert [segment.pace_ratio for segment in segments] == [0.966667, 1.033333, 1.0]


def test_final_segments_normalize_only_when_goal_duration_policy_is_explicit():
    segments = finalize_personal_segments(
        2000,
        310,
        (280, 320),
        preserve_goal_duration=True,
    )

    assert [segment.pace_sec_per_km for segment in segments] == [289.33, 330.67]
    assert [segment.pace_ratio for segment in segments] == [0.933333, 1.066667]


def test_personal_plan_finish_uses_the_finalized_segment_paces():
    segments = (
        PersonalPlanSegment(1, 0, 1000, 1000, 330, 1.1),
        PersonalPlanSegment(2, 1000, 2000, 1000, 350, 1.17),
    )

    assert finish_sec_from_segments(segments) == 680



def test_distance_only_goal_equal_to_course_is_the_no_goal_plan_not_a_habitual_pace_request():
    course = CoursePlanSnapshot(
        course_id=297,
        distance_m=5000,
        grade_profile=(PlanGradeSegment(startDistanceM=0, endDistanceM=5000, gradePercent=0),),
        version="route-v1",
    )

    goal = resolve_selected_goal(SelectedGoal(targetDistanceM=5000), course)

    assert goal.target_pace_sec_per_km is None
    assert goal.target_finish_sec is None
    assert goal.target_pace_source == "NO_GOAL_ODE_HR_REFERENCE"

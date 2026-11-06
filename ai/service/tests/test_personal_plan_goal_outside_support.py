"""AI09 accepts real goals beyond the ODE study's pace-search support."""
from dataclasses import replace
from decimal import Decimal, ROUND_HALF_UP

import pytest

from app.personal_plan import (
    GOAL_OUTSIDE_VALIDATED_PACE_RANGE,
    OdeBalancedPaceOptimizer,
    ResolvedGoal,
    _search_goal_within_support,
)
from test_personal_plan_course_regression import _post
from test_personal_plan_ode import RecordingOdeRuntime, _bundle
from test_personal_plan_service import _configure_average_bundle


@pytest.fixture(autouse=True)
def _enable_personal_plan(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    monkeypatch.setenv("FREE_RUN_GRADE_POLICY", "flat0")


@pytest.mark.parametrize("pace", [210, 240, 570, 720])
@pytest.mark.parametrize("free_run", [False, True], ids=["course", "free_run"])
@pytest.mark.parametrize("duration_goal", [False, True], ids=["pace", "duration"])
def test_outside_support_goal_preserves_time_and_segment_ratios(pace, free_run, duration_goal):
    distance = Decimal("5000") if free_run else Decimal("2345.678")
    goal = {"targetDistanceM": 5000} if free_run else {}
    if duration_goal:
        duration = 5 * pace if free_run else round(2.345678 * pace)
        goal["targetDurationSec"] = duration
        # AI05 derives pace using the full course length, then rounds to 2dp.
        expected_pace = round(duration / (float(distance) / 1000.0), 2)
    else:
        goal["targetPaceSecPerKm"] = pace
        duration = int((distance * Decimal(pace) / 1000).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP))
        expected_pace = pace
    request = {"userId": 73, "selectedGoal": goal}
    if not free_run:
        request["courseId"] = 297

    result = _post(request, personal=_bundle(), runtime=RecordingOdeRuntime(),
                   optimizer=OdeBalancedPaceOptimizer())

    assert result["status"] == 200, result
    body = result["body"]
    assert body["warnings"].count(GOAL_OUTSIDE_VALIDATED_PACE_RANGE) == 1
    assert body["predictedFinishSec"] == duration
    assert body["targetPaceSecPerKm"] == expected_pace
    segments = body["segments"]
    assert segments
    total_length = sum(s["lengthM"] for s in segments)
    assert total_length == pytest.approx(body["targetDistanceM"])
    assert abs(sum(s["lengthM"] * s["paceRatio"] for s in segments) / total_length - 1) <= 1e-6
    for segment in segments:
        assert 0.85 <= segment["paceRatio"] <= 1.20
        backend_pace = (Decimal(str(expected_pace)) * Decimal(str(segment["paceRatio"]))).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP)
        assert abs(backend_pace - Decimal(str(segment["paceSecPerKm"]))) <= Decimal("0.01")
    band_warning = "HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN"
    assert body["warnings"].count(band_warning) == int(not body["hrReferenceBandSatisfied"])


def test_average_bundle_also_accepts_outside_support_goal(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    result = _post({"courseId": 297, "selectedGoal": {"targetPaceSecPerKm": 210}},
                   runtime=RecordingOdeRuntime(), optimizer=OdeBalancedPaceOptimizer())

    assert result["status"] == 200, result
    body = result["body"]
    assert body["planStatus"] == "AVERAGE_BASED"
    assert body["targetPaceSecPerKm"] == 210
    assert body["predictedFinishSec"] == 493
    assert body["warnings"].count(GOAL_OUTSIDE_VALIDATED_PACE_RANGE) == 1


def test_in_range_goal_has_no_outside_support_warning():
    result = _post({"userId": 73, "courseId": 297, "selectedGoal": {"targetPaceSecPerKm": 300}},
                   personal=_bundle(), runtime=RecordingOdeRuntime(), optimizer=OdeBalancedPaceOptimizer())

    assert result["status"] == 200, result
    assert GOAL_OUTSIDE_VALIDATED_PACE_RANGE not in result["body"]["warnings"]


@pytest.mark.parametrize("pace", [None, Decimal("250"), Decimal("300"), Decimal("560")])
def test_search_goal_within_support_returns_same_object(pace):
    goal = ResolvedGoal(distance_m=Decimal("5000"), target_pace_sec_per_km=pace,
                        predicted_finish_sec=None, target_pace_source="TEST")

    search_goal, outside = _search_goal_within_support(goal)

    assert search_goal is goal
    assert outside is False


def test_search_goal_without_goal_is_unchanged():
    assert _search_goal_within_support(None) == (None, False)


@pytest.mark.parametrize("pace, boundary_pace", [(210, "285.06"), (720, "472.46")])
def test_search_goal_uses_nearest_boundary_rounded_inside_support(pace, boundary_pace):
    goal = ResolvedGoal(distance_m=Decimal("5000"), target_pace_sec_per_km=Decimal(pace),
                        predicted_finish_sec=5 * pace, target_pace_source="TARGET_PACE",
                        target_finish_sec=5 * pace)

    search_goal, outside = _search_goal_within_support(goal)

    assert outside is True
    assert search_goal is not goal
    assert search_goal == replace(goal, target_pace_sec_per_km=Decimal(boundary_pace))
    assert Decimal("1.7638") <= Decimal(1000) / search_goal.target_pace_sec_per_km <= Decimal("4.1272")
    assert goal.target_pace_sec_per_km == Decimal(pace)

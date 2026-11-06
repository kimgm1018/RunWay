"""Exact comparisons with the pre-optimization Python implementation."""
import math

import numpy as np
import pytest

from app.inference import ApiError
from app.ode_schemas import PlanGradeSegment
from app.personal_plan import (
    CoursePlanSnapshot, OdeBalancedPaceOptimizer, _CourseGradeIndex, split_distance_1km,
)
from app.plan_profile_fast import forward_profile, grades_over


def _reference(course, paces, grade_index=None):
    grade_index = grade_index or _CourseGradeIndex(course)
    splits = split_distance_1km(course.distance_m)
    duration = sum(float(end - start) * float(pace) / 1000.0
                   for (start, end), pace in zip(splits, paces))
    if not math.isfinite(duration) or duration <= 0:
        raise ApiError(422, "PERSONAL_PLAN_PREDICTION_INVALID", "invalid duration")
    steps = max(1, int(math.ceil(duration / 30.0)))
    speeds, grades = [], []
    for index in range(steps):
        start_t, end_t = index * 30.0, (index + 1) * 30.0
        start_m = OdeBalancedPaceOptimizer._distance_at_time(start_t, splits, paces)
        end_m = OdeBalancedPaceOptimizer._distance_at_time(min(end_t, duration), splits, paces)
        if end_m <= start_m:
            end_m = min(float(course.distance_m), start_m + 1e-6)
        active_sec = max(1e-9, min(end_t, duration) - start_t)
        if active_sec >= 30.0 - 1e-9:
            speeds.append((end_m - start_m) / 30.0)
        else:
            pace_index = min(len(splits) - 1, max(0, int(start_m // 1000)))
            speeds.append(1000.0 / float(paces[pace_index]))
        grades.append(OdeBalancedPaceOptimizer._grade_over(course, start_m, end_m, grade_index))
    return tuple(speeds), tuple(grades), duration


def _course(distance, mode):
    edges = [0.0, distance * 0.23, distance * 0.61, distance]
    segments = [PlanGradeSegment(startDistanceM=a, endDistanceM=b, gradePercent=g)
                for a, b, g in zip(edges, edges[1:], (2.25, -3.5, 0.125))]
    if mode == "linear":
        segments.reverse()  # Complete coverage, deliberately unsorted: linear_fallback.
    if mode == "flat":
        segments = [PlanGradeSegment(startDistanceM=0, endDistanceM=distance, gradePercent=0)]
    return CoursePlanSnapshot(1, distance, tuple(segments), "test")


@pytest.mark.parametrize("mode", ["flat", "indexed", "linear"])
def test_random_profiles_are_exactly_equal(mode):
    rng = np.random.default_rng(488)
    distances = [500.0, 1000.0, 1000.000000001, 1097.5, 10000.0, 21097.5]
    distances.extend(rng.uniform(500, 21097.5, 30))
    for distance in distances:
        course = _course(float(distance), mode)
        grade_index = _CourseGradeIndex(course)
        assert grade_index.linear_fallback == (mode == "linear")
        paces = tuple(rng.uniform(150, 700, len(split_distance_1km(distance))))
        expected = _reference(course, paces, grade_index)
        assert forward_profile(course, paces, grade_index) == expected
        assert OdeBalancedPaceOptimizer._forward_profile(course, paces) == expected
        actual = forward_profile(course, paces, grade_index)
        assert all(type(v) is float for row in actual[:2] for v in row)
        assert type(actual[2]) is float


@pytest.mark.parametrize("paces", [(300.0, 450.0), (300.0 + 5e-10, 450.0),
                                    (300.0 - 5e-10, 450.0), (150.0, 700.0)])
def test_split_boundaries_epsilon_break_and_short_tail(paces):
    course = _course(1097.5, "indexed")
    assert forward_profile(course, paces) == _reference(course, paces)


@pytest.mark.parametrize("pace", [float("nan"), float("inf"), 0.0, -1.0])
def test_invalid_duration_keeps_existing_error(pace):
    with pytest.raises(ApiError) as error:
        forward_profile(_course(500.0, "flat"), (pace,))
    assert error.value.code == "PERSONAL_PLAN_PREDICTION_INVALID"


@pytest.mark.parametrize("mode", ["flat", "indexed", "linear"])
def test_vector_grades_match_scalar_at_boundaries(mode):
    index = _CourseGradeIndex(_course(1000.0, mode))
    intervals = [(0.0, 230.0), (230.0, 610.0), (610.0, 1000.0),
                 (50.0, 100.0), (100.0, 400.0), (100.0, 900.0),
                 (0.0, 1000.0), (230.0, 230.0), (1000.0, 1000.0),
                 (900.0, 1200.0), (1200.0, 1300.0), (-10.0, 100.0),
                 (300.0, 200.0), (1000.0, 0.0)]
    starts, ends = zip(*intervals)
    expected = tuple(index.grade_over(a, b) for a, b in intervals)
    actual = grades_over(index, starts, ends)
    assert actual == expected
    assert all(type(value) is float for value in actual)


@pytest.mark.parametrize("mode", ["flat", "indexed", "linear"])
def test_random_vector_grades_are_exact(mode):
    index = _CourseGradeIndex(_course(21097.5, mode))
    rng = np.random.default_rng(488)
    starts = rng.uniform(-100, 22000, 1000)
    ends = starts + rng.uniform(-100, 5000, 1000)
    assert grades_over(index, starts, ends) == tuple(
        index.grade_over(float(a), float(b)) for a, b in zip(starts, ends))
    assert grades_over(index, [], []) == ()


@pytest.mark.parametrize("interval", [(50.0, 250.0), (100.0, 200.0), (150.0, 150.0)])
def test_vector_grades_preserve_gap_error(interval):
    course = CoursePlanSnapshot(1, 300.0, (
        PlanGradeSegment(startDistanceM=0, endDistanceM=100, gradePercent=2),
        PlanGradeSegment(startDistanceM=200, endDistanceM=300, gradePercent=-3),
    ), "test")
    index = _CourseGradeIndex(course)
    with pytest.raises(ApiError) as expected:
        index.grade_over(*interval)
    with pytest.raises(ApiError) as actual:
        grades_over(index, [0.0, interval[0]], [50.0, interval[1]])
    assert actual.value.code == expected.value.code == "COURSE_DATA_MISMATCH"
    assert str(actual.value) == str(expected.value)


def test_vector_grades_fall_back_only_for_unindexable_elements(monkeypatch):
    # A sub-millimetre uncovered head is allowed by the scalar tolerance.
    course = CoursePlanSnapshot(1, 1000.0, (
        PlanGradeSegment(startDistanceM=0.0005, endDistanceM=1000, gradePercent=2),
    ), "test")
    index = _CourseGradeIndex(course)
    intervals = [(0.0, 100.0), (100.0, 200.0), (500.0, 900.0)]
    expected = tuple(index.grade_over(a, b) for a, b in intervals)
    original = index.grade_over
    calls = []
    def observe(a, b):
        calls.append((a, b))
        return original(a, b)
    monkeypatch.setattr(index, "grade_over", observe)
    assert grades_over(index, *zip(*intervals)) == expected
    assert calls == [intervals[0]]


def test_vector_grades_preserve_adjacent_and_interior_addition_order():
    course = CoursePlanSnapshot(1, 400.0, tuple(
        PlanGradeSegment(startDistanceM=a, endDistanceM=b, gradePercent=g)
        for a, b, g in [(0, 100, 1e12), (100, 200, 0.001),
                        (200, 300, -1e12), (300, 400, -0.0)]
    ), "test")
    index = _CourseGradeIndex(course)
    intervals = [(50.0, 150.0), (50.0, 250.0), (50.0, 350.0), (300.0, 400.0)]
    expected = tuple(index.grade_over(a, b) for a, b in intervals)
    actual = grades_over(index, *zip(*intervals))
    assert actual == expected
    assert [math.copysign(1, v) for v in actual] == [math.copysign(1, v) for v in expected]

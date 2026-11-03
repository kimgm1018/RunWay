"""누적 경사 인덱스가 기존 선형 계산과 같은 값을 내는지 확인한다."""
import numpy as np
import pytest

from app.ode_schemas import PlanGradeSegment
from app.personal_plan import CoursePlanSnapshot, OdeBalancedPaceOptimizer, _CourseGradeIndex


def _reference_grade_over(course, start_m, end_m):
    """기존 구현을 그대로 보관해 새 경사 계산의 비교 기준으로 쓴다."""
    lo, hi = max(0.0, start_m), min(float(course.distance_m), end_m)
    if hi <= lo:
        lo = min(float(course.distance_m) - 1e-6, max(0.0, lo))
        hi = min(float(course.distance_m), lo + 1e-6)
    weighted = 0.0
    covered = 0.0
    for segment in course.grade_profile:
        overlap = max(0.0, min(hi, float(segment.end_distance_m))
                      - max(lo, float(segment.start_distance_m)))
        if overlap:
            weighted += overlap * float(segment.grade_percent)
            covered += overlap
    if covered <= 0 or abs(covered - (hi - lo)) > 1e-3:
        raise ValueError("기준 구현에서 경사 구간이 끊겼다")
    return weighted / covered


def test_grade_index_matches_reference_for_random_courses_and_ranges():
    rng = np.random.default_rng(20261102)
    optimizer = OdeBalancedPaceOptimizer()
    segment_counts = [1, 2, 3, 50, 255, 256, 422, 450]
    segment_counts.extend(int(value) for value in rng.integers(1, 451, size=96))

    for course_id, count in enumerate(segment_counts, start=1):
        lengths = rng.uniform(1.0, 100.0, size=count)
        bounds = np.concatenate(([0.0], np.cumsum(lengths)))
        grades = rng.uniform(-35.0, 35.0, size=count)
        course = CoursePlanSnapshot(
            course_id=course_id,
            distance_m=float(bounds[-1]),
            grade_profile=tuple(
                PlanGradeSegment(startDistanceM=float(bounds[i]), endDistanceM=float(bounds[i + 1]),
                                 gradePercent=float(grades[i]))
                for i in range(count)
            ),
            version="random-reference",
        )
        index = _CourseGradeIndex(course)
        ranges = [
            (float(rng.uniform(-100.0, course.distance_m + 100.0)),
             float(rng.uniform(-100.0, course.distance_m + 100.0)))
            for _ in range(4)
        ]
        ranges.extend(((0.0, course.distance_m), (course.distance_m, course.distance_m)))

        for start_m, end_m in ranges:
            expected = _reference_grade_over(course, start_m, end_m)
            actual = optimizer._grade_over(course, start_m, end_m, index)
            assert actual == pytest.approx(expected, abs=1e-9, rel=0.0)

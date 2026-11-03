"""courses.elevation_profile → 100 m 경사 구간 변환 테스트."""
import math

import pytest

from app.course_grade import MAX_STORED_GRADE_SEGMENTS, elevation_to_grade_profile
from app.ode_schemas import PlanGradeSegment, PlanRequest


def _grades(profile):
    return [segment.grade_percent for segment in profile]


def test_flat_number_array_gives_zero_grade_100m_segments():
    profile = elevation_to_grade_profile(1000.0, [20.0] * 10)

    assert [s.end_distance_m for s in profile] == [100.0 * i for i in range(1, 11)]
    assert all(abs(g) < 1e-9 for g in _grades(profile))


def test_uphill_and_downhill_signs_follow_route_direction():
    up = elevation_to_grade_profile(2000.0, [0.0, 100.0])        # 고르게 +5%
    down = elevation_to_grade_profile(2000.0, [100.0, 0.0])

    middle = slice(3, -3)   # 양 끝은 이동 평균 가장자리 효과가 있다
    assert all(g == pytest.approx(5.0, abs=0.05) for g in _grades(up)[middle])
    assert all(g == pytest.approx(-5.0, abs=0.05) for g in _grades(down)[middle])


def test_point_object_format_uses_given_distances():
    points = [{"distanceM": 0, "elevationM": 10}, {"distanceM": 500, "elevationM": 10},
              {"distanceM": 1000, "elevationM": 60}]
    profile = elevation_to_grade_profile(1000.0, points)

    grades = _grades(profile)
    assert grades[1] == pytest.approx(0.0, abs=0.05)
    assert grades[8] == pytest.approx(10.0, abs=0.05)


def test_routing_style_smoothing_removes_a_single_spike():
    raw = [{"distanceM": d, "elevationM": 30.0 if d == 500 else 10.0} for d in range(0, 1001, 20)]
    profile = elevation_to_grade_profile(1000.0, raw)

    assert max(abs(g) for g in _grades(profile)) < 1e-9   # 100 m 중앙값 필터가 20 m 스파이크를 지운다


def test_short_course_keeps_exact_remainder_and_one_net_grade():
    profile = elevation_to_grade_profile(150.0, [0.0, 3.0])

    assert [s.end_distance_m for s in profile] == [100.0, 150.0]
    assert sum(s.grade_percent * (s.end_distance_m - s.start_distance_m) for s in profile) / 150.0 \
        == pytest.approx(2.0, abs=0.2)   # 라우팅과 같은 이동 평균은 양 끝을 조금 깎는다


def test_long_course_is_merged_to_the_segment_limit():
    profile = elevation_to_grade_profile(42195.0, [0.0, 50.0, 0.0])

    assert len(profile) <= MAX_STORED_GRADE_SEGMENTS
    assert profile[0].start_distance_m == 0.0 and profile[-1].end_distance_m == 42195.0
    assert all(math.isfinite(g) for g in _grades(profile))


@pytest.mark.parametrize("raw", [
    None, [], [12.0], "[1,2]", [1.0, float("nan")], [1.0, True], {"a": 1},
    [{"distanceM": 0, "elevationM": 1}, {"distanceM": 0, "elevationM": 2}],          # 거리 증가 아님
    [{"distanceM": 0, "elevationM": 1}, {"distanceM": 900, "elevationM": None}],
    [{"distanceM": 0, "elevationM": 1}, {"distanceM": 5000, "elevationM": 2}],       # 코스 밖
    [0.0, 20000.0],                                                                  # 비현실적 고도
])
def test_missing_or_invalid_profile_returns_none(raw):
    assert elevation_to_grade_profile(1000.0, raw) is None


def test_ai05_public_grade_profile_limit_matches_personal_plan_at_450_segments():
    # AI05 공개 요청 상한을 personal-plan 경로와 같은 450개로 맞췄다.
    segments = [{"startDistanceM": float(i), "endDistanceM": float(i + 1), "gradePercent": 0.0}
                for i in range(450)]

    assert len(PlanRequest.model_validate({"gradeProfile": segments}).grade_profile) == 450
    with pytest.raises(ValueError):
        PlanRequest.model_validate({"gradeProfile": segments + [
            {"startDistanceM": 450.0, "endDistanceM": 451.0, "gradePercent": 0.0},
        ]})

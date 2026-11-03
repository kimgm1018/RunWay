"""courses.elevation_profile(JSONB) → 순서 있는 100 m 경사 구간.

형식은 팀 합의 전이다(문서: app/COURSE_ELEVATION_PROFILE_PROPOSAL.md). 지금은 두 형식만 받는다.
  - 숫자 배열: 코스 거리 위에 0 m부터 끝까지 고르게 놓인 고도(m)
  - [{"distanceM": 거리, "elevationM": 고도}] : 거리 오름차순
스무딩은 라우팅 모듈(runway_routing/features.py profile_features)과 같다:
20 m 재표본 → 중앙값 5칸(100 m) → 평균 3칸(60 m) → 100 m 창 경사.
"""
from __future__ import annotations

import math

import numpy as np

from app.ode_schemas import PlanGradeSegment

RESAMPLE_M = 20.0
SMOOTH_MEDIAN_N = 5
SMOOTH_MEAN_N = 3
GRADE_WINDOW_M = 100.0
MAX_STORED_GRADE_SEGMENTS = 450     # 저장 경사와 고도 변환 경로의 최대 구간 수
DISTANCE_TOL_M = 1.0
ELEVATION_RANGE_M = (-500.0, 9000.0)


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _points(distance_m: float, raw) -> tuple[np.ndarray, np.ndarray] | None:
    if not isinstance(raw, list) or len(raw) < 2:
        return None
    if all(not isinstance(item, dict) for item in raw):
        z = [_number(item) for item in raw]
        if any(v is None for v in z):
            return None
        return np.linspace(0.0, distance_m, len(z)), np.asarray(z, dtype=float)
    if not all(isinstance(item, dict) for item in raw):
        return None
    xs, zs = [], []
    for item in raw:
        x, z = _number(item.get("distanceM")), _number(item.get("elevationM"))
        if x is None or z is None or x < -DISTANCE_TOL_M or x > distance_m + DISTANCE_TOL_M:
            return None
        if xs and x <= xs[-1]:
            return None
        xs.append(min(max(x, 0.0), distance_m))
        zs.append(z)
    return np.asarray(xs), np.asarray(zs)


def _rolling(a: np.ndarray, n: int, fn) -> np.ndarray:
    # runway_routing/features.py _rolling 과 같다.
    if n <= 1 or len(a) < n:
        return a
    pad = n // 2
    p = np.pad(a, pad, mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(p, n)
    return fn(win, axis=1)[: len(a)]


def elevation_to_grade_profile(distance_m: float, raw) -> tuple[PlanGradeSegment, ...] | None:
    """형식이 맞지 않거나 비어 있으면 None(경사 정보 없음)."""
    distance = _number(distance_m)
    if distance is None or distance <= 0:
        return None
    points = _points(distance, raw)
    if points is None:
        return None
    px, pz = points
    lo, hi = ELEVATION_RANGE_M
    if pz.min() < lo or pz.max() > hi:
        return None
    xs = np.arange(0.0, distance, RESAMPLE_M)
    xs = np.append(xs, distance)
    zs = np.interp(xs, px, pz)
    zs = _rolling(zs, SMOOTH_MEDIAN_N, np.median)
    zs = _rolling(zs, SMOOTH_MEAN_N, np.mean)

    step = GRADE_WINDOW_M
    if math.ceil(distance / step) > MAX_STORED_GRADE_SEGMENTS:
        step = GRADE_WINDOW_M * math.ceil(distance / (MAX_STORED_GRADE_SEGMENTS * GRADE_WINDOW_M))
    bounds = list(np.arange(0.0, distance, step)) + [distance]
    if len(bounds) > 2 and bounds[-1] - bounds[-2] < 1e-6:
        bounds.pop(-2)
    segments = []
    for start, end in zip(bounds, bounds[1:]):
        rise = float(np.interp(end, xs, zs) - np.interp(start, xs, zs))
        segments.append(PlanGradeSegment(startDistanceM=float(start), endDistanceM=float(end),
                                         gradePercent=round(rise / (end - start) * 100.0, 4)))
    return tuple(segments)

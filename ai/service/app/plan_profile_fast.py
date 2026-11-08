"""Vectorized distance lookup with the original split-by-split arithmetic."""
from __future__ import annotations

import math

import numpy as np

from app.inference import ApiError


def grades_over(grade_index, starts_m, ends_m):
    """Evaluate intervals in float64, preserving the scalar index's order."""
    starts_m = np.asarray(starts_m, dtype=np.float64)
    ends_m = np.asarray(ends_m, dtype=np.float64)
    if grade_index.linear_fallback:
        return tuple(grade_index.grade_over(float(a), float(b))
                     for a, b in zip(starts_m, ends_m))

    distance = float(grade_index.course.distance_m)
    lo = np.maximum(0.0, starts_m)
    hi = np.minimum(distance, ends_m)
    repair = hi <= lo
    lo[repair] = np.minimum(distance - 1e-6, np.maximum(0.0, lo[repair]))
    hi[repair] = np.minimum(distance, lo[repair] + 1e-6)
    # Keep the cache local to this module; the shared scalar index is unchanged.
    arrays = getattr(grade_index, "_profile_fast_arrays", None)
    if arrays is None:
        arrays = tuple(np.asarray(values, dtype=np.float64) for values in (
            grade_index.starts, grade_index.ends, grade_index.grades,
            grade_index.weighted_prefix, grade_index.covered_prefix))
        grade_index._profile_fast_arrays = arrays
    starts, ends, grades, wp, cp = arrays
    first = np.searchsorted(starts, lo, side="right") - 1
    last = np.searchsorted(starts, hi, side="left") - 1
    fallback = (first < 0) | (last < first)
    valid = ~fallback
    weighted = np.zeros(lo.shape, dtype=np.float64)
    covered = np.zeros(lo.shape, dtype=np.float64)

    same = valid & (first == last)
    f = first[same]
    overlap = np.maximum(0.0, np.minimum(hi[same], ends[f]) - np.maximum(lo[same], starts[f]))
    weighted[same] = overlap * grades[f]
    covered[same] = overlap

    multiple = valid & (first != last)
    f, l = first[multiple], last[multiple]
    first_length = np.maximum(0.0, np.minimum(hi[multiple], ends[f])
                              - np.maximum(lo[multiple], starts[f]))
    last_length = np.maximum(0.0, np.minimum(hi[multiple], ends[l])
                             - np.maximum(lo[multiple], starts[l]))
    multi_weighted = first_length * grades[f]
    multi_covered = first_length.copy()
    interior = l > f + 1
    # Do not even add zero for adjacent segments (signed zero matters).
    multi_weighted[interior] += wp[l[interior]] - wp[f[interior] + 1]
    multi_covered[interior] += cp[l[interior]] - cp[f[interior] + 1]
    multi_weighted += last_length * grades[l]
    multi_covered += last_length
    weighted[multiple] = multi_weighted
    covered[multiple] = multi_covered

    if np.any(valid & ((covered <= 0) | (np.abs(covered - (hi - lo)) > 1e-3))):
        raise ApiError(422, "COURSE_DATA_MISMATCH", "ODE 입력용 코스 경사 프로파일이 끊겼습니다.")
    result = np.empty(lo.shape, dtype=np.float64)
    result[valid] = weighted[valid] / covered[valid]
    for index in np.flatnonzero(fallback):
        result[index] = grade_index.grade_over(float(starts_m[index]), float(ends_m[index]))
    return tuple(float(value) for value in result)


def forward_profile(course, paces, grade_index=None):
    # Local import avoids a cycle with the optimizer's delegating method.
    from app.personal_plan import _CourseGradeIndex, split_distance_1km

    grade_index = grade_index or _CourseGradeIndex(course)
    splits = split_distance_1km(course.distance_m)
    duration = sum(float(end - start) * float(pace) / 1000.0
                   for (start, end), pace in zip(splits, paces))
    if not math.isfinite(duration) or duration <= 0:
        raise ApiError(422, "PERSONAL_PLAN_PREDICTION_INVALID", "계획 완주 시간이 유한한 양수가 아닙니다.")
    steps = max(1, int(math.ceil(duration / 30.0)))
    times = np.arange(steps + 1, dtype=np.float64) * 30.0
    times[-1] = min(steps * 30.0, duration)
    remaining = np.maximum(0.0, times)
    distance = np.zeros_like(remaining)
    active = np.ones(remaining.shape, dtype=bool)
    for (start, end), pace in zip(splits, paces):
        speed = 1000.0 / float(pace)
        split_duration = float(end - start) / speed
        used = np.minimum(remaining[active], split_duration)
        # Keep multiply then add, and the scalar loop's early-break mask.
        distance[active] = distance[active] + used * speed
        remaining[active] = remaining[active] - used
        active &= ~(remaining <= 1e-9)
    distance = np.minimum(float(splits[-1][1]), distance)

    starts_m, ends_m = distance[:-1], distance[1:].copy()
    repair = ends_m <= starts_m
    ends_m[repair] = np.minimum(float(course.distance_m), starts_m[repair] + 1e-6)
    grades = grades_over(grade_index, starts_m, ends_m)
    speeds = []
    for index in range(steps):
        start_t, end_t = index * 30.0, (index + 1) * 30.0
        start_m, end_m = float(starts_m[index]), float(ends_m[index])
        active_sec = max(1e-9, min(end_t, duration) - start_t)
        if active_sec >= 30.0 - 1e-9:
            speeds.append((end_m - start_m) / 30.0)
        else:
            pace_index = min(len(splits) - 1, max(0, int(start_m // 1000)))
            speeds.append(1000.0 / float(paces[pace_index]))
    return tuple(speeds), grades, duration

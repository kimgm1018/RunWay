"""ODE 탐색 뒤 km 페이스의 작은 지그재그와 이웃 급변을 완화한다."""
from __future__ import annotations

import math
import os
from typing import Sequence


def km_smoothing_enabled() -> bool:
    """요청마다 스위치를 읽으며 기본값은 활성화다."""
    return os.getenv("PLAN_KM_SMOOTHING_ENABLED", "true").strip().lower() not in {
        "false", "0", "no", "off",
    }


def remove_single_km_blips(
    paces: Sequence[float], lengths: Sequence[float], grades: Sequence[float],
    threshold_sec: float = 15.0, grade_guard_pct: float = 2.0,
) -> list[float]:
    """H: 경사 차이가 작은 단일 km 돌출을 없애고 거리 가중 시간을 복원한다."""
    p = [float(x) for x in paces]
    if len(p) <= 2:
        return p
    total = sum(pace * length for pace, length in zip(p, lengths))
    for _ in range(20):
        changed = False
        for i in range(1, len(p) - 1):
            dl, dr = p[i] - p[i - 1], p[i + 1] - p[i]
            if abs(dl) < 1.0 or abs(dr) < 1.0 or (dl > 0) == (dr > 0):
                continue
            if min(abs(dl), abs(dr)) > threshold_sec:
                continue
            if abs(grades[i] - 0.5 * (grades[i - 1] + grades[i + 1])) >= grade_guard_pct:
                continue
            lo, hi = min(p[i - 1], p[i + 1]), max(p[i - 1], p[i + 1])
            new = min(hi, max(lo, p[i]))
            if abs(new - p[i]) > 1e-9:
                p[i] = new
                changed = True
        if not changed:
            break
    scale = total / sum(pace * length for pace, length in zip(p, lengths))
    return [pace * scale for pace in p]


def cap_neighbor_jumps(
    paces: Sequence[float], lengths: Sequence[float], cap_sec: float = 20.0,
) -> list[float]:
    """A20: 인접 페이스 차이를 거리 가중 시간 보존 방식으로 제한한다."""
    p = [float(x) for x in paces]
    for _ in range(5000):
        worst = 0.0
        for i in range(len(p) - 1):
            d = p[i + 1] - p[i]
            excess = abs(d) - cap_sec
            if excess > 1e-9:
                sign = math.copysign(1.0, d)
                weight = lengths[i] + lengths[i + 1]
                p[i] += sign * excess * lengths[i + 1] / weight
                p[i + 1] -= sign * excess * lengths[i] / weight
                worst = max(worst, excess)
        if worst <= 1e-7:
            break
    return p


def smooth_km_paces(
    paces: Sequence[float], lengths: Sequence[float], grades: Sequence[float],
) -> list[float]:
    """H 다음 A20을 적용한다. 길이는 양수인 km/마지막 잔여 구간이다."""
    return cap_neighbor_jumps(remove_single_km_blips(paces, lengths, grades), lengths)

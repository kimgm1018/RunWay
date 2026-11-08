"""AI09 출발 전 계획 전용 ODE 속도 반응 보정층(S15P31E105-402).

ODE는 같은 사람 안에서 빨리 달릴수록 HR이 오르는 폭을 실제보다 작게 본다(V2 Val 기울기 비율 0.71).
그래서 플래너가 ODE에 넣는 속도만 v' = v_ref + s·(v − v_ref)로 바꾼다. v_ref 근처에서 HR 수준은 그대로이고
속도 차이에 대한 HR 반응만 약 s배가 된다. 탐색 속도·하한/상한 검사·출력 페이스·완주시간은 원래 v 기준이다.

- s: env PERSONAL_PLAN_SPEED_CALIB_SCALE(기본 1.45, V2 Train 5-fold 1-SE 선택). 1.0이면 변환하지 않아
  예전 계획과 bit 단위로 같다(되돌리기).
- v_ref: 사용자의 완료 러닝(running_sessions) 중 계획 시각 이전에 끝난 최근 20회의
  total_distance / moving_duration 중앙값(app/db_lookup.py SPEED_REF_SQL). 없으면
  V2 Train 기본값 env PERSONAL_PLAN_SPEED_REF_DEFAULT_MPS(기본 3.4704).
- 하한: 플래너 탐색 하한(grid[0]). 이미 하한보다 느린 칸은 원래 v보다 낮추지 않는다.
근거: 연구 하네스 ode_speed_calib.py(transform_speeds, 이동 속도 = 거리 / 이동 시간 중앙값)와 같은 식.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import math
import os
from typing import Iterable, Sequence

import numpy as np

CALIBRATION_DEFINITION = "planner_ode_input_speed_affine_vref_prior20_median_moving_v1"
DEFAULT_SCALE = 1.45
DEFAULT_SPEED_REF_MPS = 3.4704
SPEED_REF_RECENT_RUNS = 20
# 하네스 이력과 같은 2시간 이하 러닝만 쓴다.
SPEED_REF_MAX_DURATION_SEC = 7200
# 러닝 한 번의 이동 속도와 v_ref를 믿는 범위(m/s). 벗어난 러닝(기록 오류·보행)은 뺀다.
SPEED_REF_VALID_RANGE_MPS = (0.5, 8.0)
_MAX_SCALE = 3.0


@dataclass(frozen=True)
class SpeedCalibration:
    scale: float
    default_speed_ref_mps: float

    @property
    def enabled(self) -> bool:
        return self.scale != 1.0


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name}는 유한한 숫자여야 합니다: {raw}") from None
    if not math.isfinite(value):
        raise ValueError(f"{name}는 유한한 숫자여야 합니다: {raw}")
    return value


def load_speed_calibration() -> SpeedCalibration:
    """env를 읽고 검사한다. 잘못된 값이면 ValueError(시작·계획 실패)."""
    scale = _env_float("PERSONAL_PLAN_SPEED_CALIB_SCALE", DEFAULT_SCALE)
    if not 0 < scale <= _MAX_SCALE:
        raise ValueError(f"PERSONAL_PLAN_SPEED_CALIB_SCALE는 0 초과 {_MAX_SCALE} 이하여야 합니다: {scale}")
    default_ref = _env_float("PERSONAL_PLAN_SPEED_REF_DEFAULT_MPS", DEFAULT_SPEED_REF_MPS)
    low, high = SPEED_REF_VALID_RANGE_MPS
    if not low <= default_ref <= high:
        raise ValueError(f"PERSONAL_PLAN_SPEED_REF_DEFAULT_MPS는 {low}~{high} m/s여야 합니다: {default_ref}")
    return SpeedCalibration(scale=scale, default_speed_ref_mps=default_ref)


def transform_speeds(speeds: Sequence[float], scale: float, speed_ref: float, floor: float) -> tuple[float, ...]:
    """v' = v_ref + s·(v − v_ref). 이미 하한보다 느린 칸은 원래 v보다 낮추지 않는다(v' ≥ min(v, 하한))."""
    v = np.asarray(speeds, dtype=np.float64)
    if not np.isfinite(v).all() or np.any(v < 0):
        raise ValueError("ODE_INPUT_SPEED_INVALID")
    if not (math.isfinite(scale) and scale > 0 and math.isfinite(speed_ref) and speed_ref > 0
            and math.isfinite(floor) and floor > 0):
        raise ValueError("SPEED_CALIB_PARAMETER_INVALID")
    out = speed_ref + scale * (v - speed_ref)
    return tuple(float(x) for x in np.maximum(out, np.minimum(v, floor)))


def _number(value) -> float | None:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def run_moving_speed(total_distance, moving_duration, elapsed_duration=None) -> float | None:
    """러닝 한 번의 이동 속도 = total_distance(m) / moving_duration(초). 0·NULL·범위 밖·2시간 초과면 None."""
    distance, moving = _number(total_distance), _number(moving_duration)
    if distance is None or moving is None or distance <= 0 or moving <= 0:
        return None
    elapsed = _number(elapsed_duration)
    if max(moving, elapsed or 0.0) > SPEED_REF_MAX_DURATION_SEC:
        return None
    speed = distance / moving
    low, high = SPEED_REF_VALID_RANGE_MPS
    return speed if low <= speed <= high else None


def speed_ref_from_runs(rows: Iterable[dict]) -> tuple[float | None, int]:
    """최근 순 러닝 행(total_distance, moving_duration, elapsed_duration)에서 유효한 최근 20회의 중앙값."""
    speeds = []
    for row in rows:
        value = run_moving_speed(row.get("total_distance"), row.get("moving_duration"), row.get("elapsed_duration"))
        if value is not None:
            speeds.append(value)
        if len(speeds) == SPEED_REF_RECENT_RUNS:
            break
    return (float(np.median(speeds)), len(speeds)) if speeds else (None, 0)


def resolve_speed_ref(speed_ref_mps: float | None, run_count: int, default: float) -> tuple[float, int, str]:
    """(v_ref, 러닝 수, 출처). 사용자 값이 없거나 범위 밖이면 Train 기본값."""
    value = _number(speed_ref_mps)
    low, high = SPEED_REF_VALID_RANGE_MPS
    if value is not None and low <= value <= high and isinstance(run_count, int) and run_count >= 1:
        return value, run_count, "history"
    return float(default), 0, "train_default"


__all__ = ["CALIBRATION_DEFINITION", "DEFAULT_SCALE", "DEFAULT_SPEED_REF_MPS", "SPEED_REF_RECENT_RUNS",
           "SpeedCalibration", "load_speed_calibration", "resolve_speed_ref", "run_moving_speed",
           "speed_ref_from_runs", "transform_speeds"]

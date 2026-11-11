"""AI09 출발 전 계획의 목표 심박 보정(S15P31E105-377).

예전 계획은 목표 심박을 P85 지속 기준 그대로 잡아 실제보다 빠른 계획이 나왔다(V2 Val 평균 완주시간 오차 −474초).
그래서 목표를 `비율 × P85`로 낮춘다.

- 일반화 비율 g: V2 Train 5-fold로 고른 상수 0.9422(실제 지속 HR ÷ P85의 중앙값).
  env PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO.
- 개인 비율 p: 지난 러닝의 `평균 심박 ÷ 지금 P85`, 최근 20회의 중앙값(= 평균 심박 중앙값 ÷ P85).
- 섞기: w = n/(n+k), 비율 = w·p + (1−w)·g, 0.80~1.05로 자른다. 기본 k=5(n=1·5·10에서 w=1/6·1/2·2/3).
  사전 등록 규칙(bpm 5-fold 1-SE)은 k=20을 골랐지만 사용자 결정으로 5를 쓴다: Train 최저 k는 2이고 k=2~20은
  1-SE 안에서 차이가 작다(근사·배율 적용 bpm 오차 k=5 8.10 vs k=20 8.42, SE 0.57~0.59). 403 기록 입력 k=5와
  같은 속도로 신규 사용자 개인화를 빨리 반영한다.
  env PERSONAL_PLAN_TARGET_HR_K(숫자 또는 inf). n=0이면 g만 쓴다.
- 되돌리기: GLOBAL_RATIO=1.0, K=inf면 예전처럼 목표 = P85(bit 단위로 같다).

개인 비율의 "실제 지속 심박"은 연구 하네스(5분 이후 GOOD 실측 HR 평균 ÷ 그 러닝 시점 P85)와 정의가 다르다.
팀 DB에는 품질 라벨과 과거 시점 P85가 없어서 running_sessions.average_heart_rate(러닝 전체 실측 HR 평균)와
지금 P85로 근사한다. 근사 차이는 V2 Train에서 따로 확인했다(.local/target_calib_proxy_20261105). 필요하면
env PERSONAL_PLAN_TARGET_HR_HISTORY_SCALE로 평균 심박에 배율 c를 곱한다. 기본 c는 V2 Train에서 맞춘
중앙값(GOOD 5분 이후 평균 HR ÷ 러닝 전체 평균 HR) 1.0126으로, 사전 등록 G2(목표 심박 부호 중앙값 ≤1 bpm)를
c 없이 −1.08 bpm으로 넘지 못해 사전 등록 대응으로 넣었다(c 적용 후 k=20 −0.23, k=5 −0.37 bpm).

러닝 조건(running_sessions에서 볼 수 있는 것만, 402 v_ref와 같은 완료·미삭제·계획 시각 이전 종료 조건):
경과 900~5,400초, 거리 3,000 m 이상, 평균 심박 30~240 bpm. 종료 시각 역순 최근 20회.
SQL과 조회는 402 v_ref(SPEED_REF_SQL·get_speed_ref)와 같은 자리 app/db_lookup.py에 둔다(TARGET_HR_HISTORY_SQL).
조회 실패(권한·테이블 없음 포함)는 계획을 막지 않고 n=0(일반화 비율)으로 계속하며 경고를 남긴다.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal
import math
import os
from typing import Iterable

import numpy as np

from app.readiness_adjust import ratio_drop

CALIBRATION_DEFINITION = "target_hr_ratio_p85_global_blend_prior20_running_sessions_avg_hr_v1"
# V2 Train 5-fold 상수 모형(서버 target_calib_20261103/full_20261103T031938Z_q0.80-0.80-0.50).
DEFAULT_GLOBAL_RATIO = 0.9421864262333622
DEFAULT_K = 5.0  # 사전 등록 1-SE 값은 20. 위 설명의 사용자 결정(2026-11-05)으로 5
DEFAULT_HISTORY_SCALE = 1.0126320246667229  # V2 Train 배율 c(사전 등록 G2 대응, 2026-11-05)
RATIO_CLIP = (0.80, 1.05)
HISTORY_RECENT_RUNS = 20
HISTORY_ELAPSED_RANGE_SEC = (900, 5400)
HISTORY_MIN_DISTANCE_M = 3000
HISTORY_HR_RANGE_BPM = (30.0, 240.0)
HISTORY_UNAVAILABLE_WARNING = "TARGET_HR_HISTORY_LOOKUP_UNAVAILABLE"

@dataclass(frozen=True)
class TargetCalibration:
    global_ratio: float
    k: float  # math.inf면 개인 비율을 쓰지 않는다
    history_scale: float = DEFAULT_HISTORY_SCALE

    def ratio(self, sustain_bpm: float, history_median_bpm: float | None, run_count: int) -> float:
        """목표 비율. 연구 하네스 target_calib_common.personal_ratio와 같은 식(w=n/(n+k), clip 0.80~1.05)."""
        n = run_count if isinstance(run_count, int) and not isinstance(run_count, bool) and run_count > 0 else 0
        median = _number(history_median_bpm)
        weight = 0.0 if (n == 0 or median is None or math.isinf(self.k)) else n / (n + self.k)
        if weight:
            # 하네스와 같은 연산 순서(중앙값 ÷ P85 × 배율)로 부동소수 결과까지 맞춘다.
            personal = median / float(sustain_bpm) * self.history_scale
            result = weight * personal + (1.0 - weight) * self.global_ratio
        else:
            result = self.global_ratio
        if not math.isfinite(result):
            raise ValueError("TARGET_HR_RATIO_INVALID")
        return float(np.clip(result, *RATIO_CLIP))

    def target_bpm(self, sustain_bpm: float, history_median_bpm: float | None, run_count: int) -> float:
        if self.global_ratio == 1.0 and math.isinf(self.k):
            return float(sustain_bpm)  # 되돌리기: 예전 목표 그대로
        return self.ratio(sustain_bpm, history_median_bpm, run_count) * float(sustain_bpm)


def _env_float(name: str, default: float, *, allow_inf: bool = False) -> float:
    raw = os.getenv(name, str(default)).strip()
    if allow_inf and raw.lower() == "inf":
        return math.inf
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name}는 유한한 숫자여야 합니다: {raw}") from None
    if not math.isfinite(value):
        raise ValueError(f"{name}는 유한한 숫자여야 합니다: {raw}")
    return value


def load_target_calibration() -> TargetCalibration:
    """env를 읽고 검사한다. 잘못된 값이면 ValueError(계획 실패)."""
    ratio = _env_float("PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO", DEFAULT_GLOBAL_RATIO)
    if not RATIO_CLIP[0] <= ratio <= 1.0:
        raise ValueError(f"PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO는 {RATIO_CLIP[0]}~1.0이어야 합니다: {ratio}")
    k = _env_float("PERSONAL_PLAN_TARGET_HR_K", DEFAULT_K, allow_inf=True)
    if k < 0:
        raise ValueError(f"PERSONAL_PLAN_TARGET_HR_K는 0 이상이거나 inf여야 합니다: {k}")
    scale = _env_float("PERSONAL_PLAN_TARGET_HR_HISTORY_SCALE", DEFAULT_HISTORY_SCALE)
    if not 0.8 <= scale <= 1.2:
        raise ValueError(f"PERSONAL_PLAN_TARGET_HR_HISTORY_SCALE는 0.8~1.2여야 합니다: {scale}")
    return TargetCalibration(global_ratio=ratio, k=k, history_scale=scale)


def _number(value) -> float | None:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def history_from_rows(rows: Iterable[dict]) -> tuple[float | None, int]:
    """종료 역순 running_sessions 행에서 조건을 통과한 최근 20회 평균 심박의 중앙값과 회수."""
    values = []
    for row in rows:
        hr, elapsed, distance = (_number(row.get(name)) for name in
                                 ("average_heart_rate", "elapsed_duration", "total_distance"))
        if (hr is None or elapsed is None or distance is None
                or not HISTORY_HR_RANGE_BPM[0] <= hr <= HISTORY_HR_RANGE_BPM[1]
                or not HISTORY_ELAPSED_RANGE_SEC[0] <= elapsed <= HISTORY_ELAPSED_RANGE_SEC[1]
                or distance < HISTORY_MIN_DISTANCE_M):
            continue
        values.append(hr)
        if len(values) == HISTORY_RECENT_RUNS:
            break
    return (float(np.median(values)), len(values)) if values else (None, 0)


def history_query_params(user_id: int, cutoff: datetime) -> dict:
    """app/db_lookup.py TARGET_HR_HISTORY_SQL의 바인딩 값. 조건은 history_from_rows와 같다."""
    return {"user_id": int(user_id), "cutoff": cutoff,
            "min_hr": HISTORY_HR_RANGE_BPM[0], "max_hr": HISTORY_HR_RANGE_BPM[1],
            "min_elapsed_sec": HISTORY_ELAPSED_RANGE_SEC[0], "max_elapsed_sec": HISTORY_ELAPSED_RANGE_SEC[1],
            "min_distance_m": HISTORY_MIN_DISTANCE_M, "limit": HISTORY_RECENT_RUNS}


def attach_target_hr_history(personalization, personalization_lookup, user_id: int | None, *, cutoff: datetime):
    """(스냅숏, 경고). 402 v_ref처럼 동의 사용자(userId)이고 조회기가 get_target_hr_history를 지원할 때만 읽는다.
    k=inf(개인 비율 끔)면 읽지 않는다. 조회 실패는 n=0(일반화 비율)과 경고로 계속한다."""
    if personalization is None:
        return None, None
    get_history = getattr(personalization_lookup, "get_target_hr_history", None)
    if user_id is None or not callable(get_history) or math.isinf(load_target_calibration().k):
        return personalization, None
    median, count, warning = get_history(user_id, cutoff=cutoff)
    return replace(personalization, target_hr_history_median_bpm=median,
                   target_hr_history_run_count=count), warning


def calibrate_reference(ref, personalization):
    """blend_hr_thresholds 결과의 지속 기준(sustain_bpm)만 보정한 목표로 바꾼다. 위험 기준은 그대로다."""
    calibration = load_target_calibration()
    target = calibration.target_bpm(ref.sustain_bpm, getattr(personalization, "target_hr_history_median_bpm", None),
                                    getattr(personalization, "target_hr_history_run_count", 0))
    # S15P31E105-676: 준비도가 낮은 날 목표 비율을 Δ/hr_ref(hr_ref = 비율을 곱하는 P85, 최대 2%) 낮춘다. Δ=0이면 그대로.
    drop = ratio_drop(getattr(personalization, "readiness_drop_bpm", 0.0) or 0.0, ref.sustain_bpm)
    if drop > 0.0:
        target = target - drop * ref.sustain_bpm
    return replace(ref, sustain_bpm=float(target))


def calibration_warnings(personalization) -> list[str]:
    calibration = load_target_calibration()
    count = getattr(personalization, "target_hr_history_run_count", 0)
    k = "inf" if math.isinf(calibration.k) else f"{calibration.k:g}"
    warnings = [f"TARGET_HR_CALIB_GLOBAL_RATIO={calibration.global_ratio:.4f}", f"TARGET_HR_CALIB_K={k}",
                f"TARGET_HR_CALIB_HISTORY_RUNS={count}"]
    # 676: 기능이 켜져 있고 오늘 준비도가 있을 때만 적용한 감소 bpm을 알린다(꺼져 있으면 목록이 이전과 같다).
    if getattr(personalization, "readiness_score", None) is not None:
        warnings.append(f"READINESS_ADJUST_BPM={getattr(personalization, 'readiness_drop_bpm', 0.0):.2f}")
    return warnings


__all__ = ["CALIBRATION_DEFINITION", "DEFAULT_GLOBAL_RATIO", "DEFAULT_HISTORY_SCALE", "DEFAULT_K",
           "HISTORY_UNAVAILABLE_WARNING", "TargetCalibration", "attach_target_hr_history", "calibrate_reference",
           "calibration_warnings", "history_from_rows", "history_query_params", "load_target_calibration"]

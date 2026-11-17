"""GOOD 심박 기록으로 위험·지속 기준을 만들고 모집단 값과 섞는다."""
from dataclasses import dataclass
import math
from collections.abc import Iterable

import numpy as np

from app.policy.config import PolicyConfig
from app.speed_calibration import SPEED_REF_MIN_DISTANCE_M, SPEED_REF_MIN_MOVING_SEC

_USABLE_WORKOUT_QUALITY = frozenset({"CLEAN", "USABLE_WITH_FLAGS"})

# S15P31E105-901: 허용·위험선 계산에 넣을 러닝 기준. 걷기·짧은 QA 기록이 개인 기준을 끌어내리지 않게 한다.
# 거리·이동 시간 하한은 785(AI09 v_ref)와 같은 상수를 쓴다.
HR_THRESHOLD_MIN_DISTANCE_M = SPEED_REF_MIN_DISTANCE_M
HR_THRESHOLD_MIN_MOVING_SEC = SPEED_REF_MIN_MOVING_SEC
# 이동 평균 페이스가 12'00"/km보다 느리면 걷기로 보고 뺀다. V2 Personalized Val(108그룹) 러닝 9,828회 중
# 12'00"보다 느린 기록은 0.43%(99.5% 분위 11'40"), 경과 시간 기준이라 이동 페이스는 이보다 빠르다.
HR_THRESHOLD_MAX_PACE_SEC_PER_KM = 720.0
# 이 속도 미만 표본은 멈춤으로 보고 이동 시간에서 뺀다(걷기 1.3 m/s보다 충분히 낮다).
_MOVING_SPEED_MPS = 0.5
_SAMPLE_INTERVAL_SEC = 5.0
# S15P31E105-901: 개인 기준 바닥. V2 Personalized Val 실제 러너(108그룹, 최근 20회)의 개인 P85 최솟값 127,
# P98 최솟값 145라 이 값은 정상 러너를 자르지 않는다. 섞기 전 개인 값에만 적용한다.
HR_THRESHOLD_PERSONAL_SUSTAIN_FLOOR_BPM = 125.0
HR_THRESHOLD_PERSONAL_DANGER_FLOOR_BPM = 140.0


def _is_running_session(samples) -> bool:
    """5초 표본으로 이동 거리·이동 시간·평균 페이스를 구해 허용선 계산 대상 러닝인지 본다."""
    distance = 0.0
    moving_sec = 0.0
    for sample in samples:
        speed = getattr(sample, "speed_mps", None)
        if speed is None or isinstance(speed, bool):
            continue
        try:
            speed = float(speed)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(speed) or speed <= 0.0:
            continue
        distance += speed * _SAMPLE_INTERVAL_SEC
        if speed >= _MOVING_SPEED_MPS:
            moving_sec += _SAMPLE_INTERVAL_SEC
    if distance < HR_THRESHOLD_MIN_DISTANCE_M or moving_sec < HR_THRESHOLD_MIN_MOVING_SEC:
        return False
    return moving_sec / (distance / 1000.0) <= HR_THRESHOLD_MAX_PACE_SEC_PER_KM


@dataclass(frozen=True)
class PersonalHrThresholds:
    hr_danger_bpm: int | None
    hr_sustain_bpm: int | None
    hr_threshold_run_count: int


@dataclass(frozen=True)
class HrThresholds:
    # 실제로 판단에 쓰는 위험 기준: 개인·모집단 P98을 섞은 값 + 정책 hr_danger_offset_bpm(기본 3).
    danger_bpm: float
    sustain_bpm: float
    source: str
    weight: float
    run_count: int
    provisional: bool
    # 위 danger_bpm에 이미 더해진 값. 섞기 전 P98 = danger_bpm - danger_offset_bpm.
    danger_offset_bpm: float = 0.0

    @property
    def personal_plan_source(self) -> str:
        return f"LEARNED_{self.source}"


def nearest_rank_percentile(values: Iterable[float], percentile: int) -> int | None:
    """기존 ODE hr_ref와 같은 0~255 정수 히스토그램 nearest-rank 방식."""
    if not 0 < percentile <= 100:
        raise ValueError("백분위는 1~100이어야 합니다")
    finite = []
    for value in values:
        if isinstance(value, bool):
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            finite.append(number)
    if not finite:
        return None
    # summary.py와 같이 표본을 float32로 맞춘 뒤 정수 반올림한다.
    hr_float32 = np.asarray(finite, dtype=np.float32).astype(np.float64)
    hr_int = np.clip(np.rint(hr_float32), 0, 255).astype(np.int64)
    hist = np.bincount(hr_int, minlength=256)
    rank = math.ceil(percentile / 100.0 * int(hist.sum()))
    return int(np.searchsorted(np.cumsum(hist), rank))


def personal_hr_thresholds(sessions: Iterable[object]) -> PersonalHrThresholds:
    """최근 20회 러닝에서 GOOD 심박만 모아 P98·P85를 계산한다(경사·GPS는 필요 없다).

    S15P31E105-901: 1 km·이동 10분 미만이거나 12'00"/km보다 느린(걷기) 기록은 뺀다. run_count는 뺀 뒤 수다.
    """
    usable = []
    for session in sessions:
        if getattr(session, "workout_quality", None) not in _USABLE_WORKOUT_QUALITY:
            continue
        samples = getattr(session, "samples", ())
        if not _is_running_session(samples):
            continue
        # 5초 격자(0초부터)만 확인한다. S15P31E105-901: 예전엔 ODE 입력 검사(prepare_with_grade_fallback —
        # 시작 심박·60초 안 속도+경사)까지 통과해야 했다. 심박 기준에는 경사·시작 심박이 필요 없어,
        # GPS·경사 없는 실기기 워치 러닝(걸음 기반 거리)도 위 러닝 기준만 통과하면 쓴다. ODE·GRU 적합은 그대로다.
        elapsed = np.sort(np.asarray([float(getattr(sample, "elapsed_sec", math.nan)) for sample in samples],
                                     dtype=np.float64))
        if (elapsed.size == 0 or not np.isfinite(elapsed).all() or not np.isclose(elapsed[0], 0.0)
                or (elapsed.size > 1 and not np.allclose(np.diff(elapsed), 5.0))):
            continue
        values = []
        for sample in samples:
            if getattr(sample, "hr_quality", None) != "GOOD":
                continue
            value = getattr(sample, "hr_bpm", None)
            if value is None or isinstance(value, bool):
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if math.isfinite(number):
                values.append(number)
        if values:
            usable.append((getattr(session, "session_started_at"), values))
    recent = sorted(usable, key=lambda item: item[0], reverse=True)[:20]
    distribution = [value for _, values in recent for value in values]
    return PersonalHrThresholds(
        hr_danger_bpm=nearest_rank_percentile(distribution, 98),
        hr_sustain_bpm=nearest_rank_percentile(distribution, 85),
        hr_threshold_run_count=len(recent),
    )


def blend_hr_thresholds(cfg: PolicyConfig, *, personal_danger_bpm: float | None = None,
                        personal_sustain_bpm: float | None = None, run_count: int | None = 0) -> HrThresholds:
    """개인 러닝 수에 맞는 정책 비중으로 모집단 P98·P85와 섞는다.

    위험 기준은 섞은 P98에 정책 hr_danger_offset_bpm(기본 3)을 **섞은 뒤에** 더한다.
    개인 P98(AI06 hrDangerBpm, DB hr_danger_bpm)은 더하기 전 원값이어야 한다(두 번 더하지 않게).
    """
    count = 0 if isinstance(run_count, bool) or not isinstance(run_count, int) else min(20, max(0, run_count))
    try:
        danger_personal = float(personal_danger_bpm)
        sustain_personal = float(personal_sustain_bpm)
    except (TypeError, ValueError):
        danger_personal = sustain_personal = math.nan
    usable_personal = (count > 0 and math.isfinite(danger_personal) and math.isfinite(sustain_personal)
                       and 35.0 <= danger_personal <= 220.0
                       and 35.0 <= sustain_personal <= danger_personal)
    weight = cfg.hr_threshold_blend_weights[min(count, len(cfg.hr_threshold_blend_weights) - 1)] \
        if usable_personal else 0.0
    if usable_personal:
        # S15P31E105-901: 이미 저장된 낮은 개인 값(걷기 포함 시절)도 바닥 아래로는 쓰지 않는다.
        danger_personal = max(danger_personal, HR_THRESHOLD_PERSONAL_DANGER_FLOOR_BPM)
        sustain_personal = min(max(sustain_personal, HR_THRESHOLD_PERSONAL_SUSTAIN_FLOOR_BPM), danger_personal)
    danger = cfg.hr_threshold_population_danger_bpm
    sustain = cfg.hr_threshold_population_sustain_bpm
    source = "POPULATION"
    if weight > 0.0 and usable_personal:
        danger = weight * danger_personal + (1.0 - weight) * danger
        sustain = weight * sustain_personal + (1.0 - weight) * sustain
        source = "PERSONAL" if weight == 1.0 else "BLENDED"
    offset = float(cfg.hr_danger_offset_bpm)
    return HrThresholds(float(danger) + offset, float(sustain), source, float(weight), count, cfg.provisional,
                        offset)


__all__ = ["HrThresholds", "PersonalHrThresholds", "blend_hr_thresholds", "nearest_rank_percentile",
           "personal_hr_thresholds"]

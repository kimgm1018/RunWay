"""GOOD 심박 기록으로 위험·지속 기준을 만들고 모집단 값과 섞는다."""
from dataclasses import dataclass
import math
from collections.abc import Iterable

import numpy as np
import pandas as pd

from app.models.ode.validation import pv_data
from app.policy.config import PolicyConfig

_USABLE_WORKOUT_QUALITY = frozenset({"CLEAN", "USABLE_WITH_FLAGS"})


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
    """ODE가 채택하는 최근 20회에서 GOOD 심박만 모아 P98·P85를 계산한다."""
    usable = []
    for session in sessions:
        if getattr(session, "workout_quality", None) not in _USABLE_WORKOUT_QUALITY:
            continue
        samples = getattr(session, "samples", ())
        frame = pd.DataFrame([{
            "session_id": getattr(session, "session_id", 0),
            "segment_id": 0,
            "elapsed_s": sample.elapsed_sec,
            "hr_bpm": sample.hr_bpm,
            "speed_mps": sample.speed_mps,
            "grade_observed_pct": sample.grade_percent,
            "hr_quality": sample.hr_quality if sample.hr_bpm is not None else "MISSING",
            "speed_quality": sample.speed_quality if sample.speed_mps is not None else "MISSING",
            "grade_quality": sample.grade_quality if sample.grade_percent is not None else "MISSING",
            "hr_is_filled": sample.hr_is_filled,
        } for sample in samples], columns=pv_data.TS_COLUMNS)
        frame = frame.sort_values(["segment_id", "elapsed_s"], kind="stable").reset_index(drop=True)
        elapsed = frame.elapsed_s.to_numpy(np.float64)
        if (frame.empty or frame.elapsed_s.duplicated().any() or not np.isclose(elapsed[0], 0.0)
                or (len(elapsed) > 1 and not np.allclose(np.diff(elapsed), 5.0))):
            continue
        if isinstance(pv_data.prepare_session(frame), str):
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

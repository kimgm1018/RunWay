"""Proposal boundary for a future personalized pre-run pace plan.

This module does not invent an inverse ODE model. Until a reviewed pace
selection policy and server data adapters are injected, the public route is
explicitly NOT_READY.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, ROUND_HALF_UP, localcontext
import hashlib
import json
import math
import os
from typing import Protocol, Sequence

import numpy as np
from pydantic import Field, FiniteFloat, field_validator

from app.id_types import ServerId, normalize_server_id
from app.inference import ApiError
from app.ode_schemas import PlanGradeSegment
from app.policy.config import load_policy_config
from app.policy.hr_reference import blend_hr_thresholds
from app import target_calibration
from app.schemas import CamelModel
from app.planner import prerun_planner
from app.population_bundle import EMPTY_MODE_POLICY_VERSION, PopulationBundle
from app.speed_calibration import SpeedCalibration, load_speed_calibration, resolve_speed_ref, transform_speeds
from app import runner_baseline
from app.planner.prerun_planner import PaceCandidate, PreRunSimulationRequest

_CENT = Decimal("0.01")
_M_PER_KM = Decimal("1000")
# 구간 비율(paceRatio) 허용 범위(S15P31E105-487). 백엔드는 목표 페이스 × paceRatio로 구간 페이스를 만든다.
# 0.85 = 평균보다 15% 빠름, 1.20 = 20% 느림. 범위를 벗어나면 공통 배율 λ로 다시 맞추고 경고를 붙인다.
PACE_RATIO_MIN = Decimal("0.85")
PACE_RATIO_MAX = Decimal("1.20")
# paceRatio 응답 자릿수. 소수 여섯째 자리면 반올림 뒤 거리 가중 평균이 1±5e-7 안에 든다.
_RATIO_SCALE = Decimal("0.000001")
SEGMENT_RATIO_CLAMPED = "SEGMENT_RATIO_CLAMPED"
_RATIO_PRECISION = 50
# 계산 안전장치(지연·메모리): 코스 45 km, 1 km 구간 45개까지만 계획한다. 넘으면 422 INVALID_GOAL.
_MAX_DISTANCE_M = Decimal("45000")
# Common search support from FitRec v1 Train, fitrec_fmap/REPORT_fitrec.md §1-4.
# This research domain is not validated against the current v2 split/checkpoint.
# Quantiles bound search; they are never an individual's pace baseline.
_TRAIN_SPEED_QUANTILES_MPS = (1.7638, 2.6474, 3.0483, 3.4485, 4.1272)
_SPEED_SEARCH_SUPPORT_SOURCE = "FITREC_HR_V1_TRAIN_STUDY_NOT_V2_VALIDATED"
_SPEED_SEARCH_GRID_STEP_MPS = 0.1
# ODE 사전 계획이 평가로 확인된 범위(90분). 근거: ODE v2.1 1차 base pre-run H*90, C60 vs B_THS_pers 승.
# 제한이 아니라 정보다: 예상 완주가 이보다 길어도 계획을 내고 경고 ODE_BEYOND_VALIDATED_HORIZON을 붙인다
# (사용자 확정 2026-11-02, MVP 이식 후 점검·보완 예정).
_EVALUATED_PRERUN_HORIZON_SEC = 5400.0
_HR_OBJECTIVE_SCALE_BPM = 10.0
# 탐색 계산 예산: 좌표 탐색에서 ODE에 넣는 30초 rollout 칸의 총수(결정적, 벽시계 아님).
# 기본값은 CPU 1스레드에서 42.195 km 계획이 10초 안에 끝나고 10 km 이하는 예산 도입 전과 같게 고른 값이다.
# 예산을 넘을 코스만 탐색을 줄이고 경고 PLAN_SEARCH_BUDGET_LIMITED를 붙인다. env PERSONAL_PLAN_SEARCH_BUDGET_CELLS.
DEFAULT_SEARCH_BUDGET_CELLS = 70_000
_SEARCH_COST_MARGIN = 1.1
# 첫 구간 과속 방지: 출발 HR이 낮게 잡히면 초반 HR이 낮게 예측돼 첫 1 km가 탐색 최고 속도에 붙는다.
# 켜져 있으면(기본) 제약 없이 최적화한 뒤, 첫 구간이 나머지 구간 거리가중 평균 pace보다 빠르면 첫 구간만
# 그 평균으로 올린다(나머지는 그대로). 목표 시간이 있으면 같은 공통 배율(_goal_adjust)로 완주시간을 맞추고,
# 최종 ODE 재평가로 HR·완주시간을 다시 계산한다. 탐색 중 후보를 버리는 방식(A)보다 계획이 덜 느려졌다
# (실제 ODE 비교, RESULT_V64_HORIZON.md 7절). env PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN.
_FIRST_SEGMENT_TOL_SEC_PER_KM = 1e-6
_BOOL_ENV = {"1": True, "true": True, "yes": True, "on": True, "0": False, "false": False, "no": False, "off": False}
_HR_TARGET_WEIGHT = 1.0
_HR_SPLIT_VARIANCE_WEIGHT = 1.0


def personal_plan_enabled() -> bool:
    """AI09 개인 계획 실험 스위치(PERSONAL_PLAN_EXPERIMENTAL_ENABLED) 판정. health도 같은 값을 쓴다."""
    return os.getenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on"}


class SelectedGoal(CamelModel):
    """The current AI05 target fields; no extra habitual-pace input is needed."""

    target_distance_m: int | None = Field(default=None, strict=True)
    target_duration_sec: int | None = Field(default=None, strict=True)
    target_pace_sec_per_km: FiniteFloat | None = None
    goal_preference: FiniteFloat = 0.5

    model_config = {"extra": "forbid", **CamelModel.model_config}

    @field_validator("target_pace_sec_per_km", "goal_preference", mode="before")
    @classmethod
    def numeric_values_are_json_numbers(cls, value):
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ValueError("field must be a JSON number")
        return value

    @field_validator("goal_preference", mode="after")
    @classmethod
    def public_goal_preference_stays_v0(cls, value):
        if value != 0.5:
            raise ValueError("goalPreference must be 0.5 for the current public API")
        return value


class PersonalPlanRequest(CamelModel):
    """Internal backend request. Include userId only for a health-consented user."""

    user_id: ServerId | None = None
    course_id: ServerId
    selected_goal: SelectedGoal | None = None

    model_config = {"extra": "forbid", **CamelModel.model_config}

    @field_validator("user_id", "course_id", mode="before")
    @classmethod
    def server_ids_are_signed_int64(cls, value, info):
        if info.field_name == "user_id" and value is None:
            return None
        return normalize_server_id(value)


# 코스 경사 출처. 찾는 순서는 app/db_lookup.py DbCourseLookup.get_course와 같다.
COURSE_GRADE_SOURCES = ("COURSE_STORED_GRADE", "COURSE_ELEVATION_PROFILE", "ROUTE_ELEVATION_SOURCE", "MISSING")


@dataclass(frozen=True)
class CoursePlanSnapshot:
    course_id: int
    distance_m: float
    grade_profile: tuple[PlanGradeSegment, ...]
    version: str
    # MISSING이면 grade_profile은 0% 자리표시이고 FREE_RUN_GRADE_POLICY로 처리한다.
    grade_source: str = "COURSE_ELEVATION_PROFILE"

    def __post_init__(self):
        if self.grade_source not in COURSE_GRADE_SOURCES:
            raise ValueError(f"grade_source는 {'|'.join(COURSE_GRADE_SOURCES)} 중 하나여야 합니다: {self.grade_source}")


@dataclass(frozen=True)
class UserPersonalizationSnapshot:
    user_id: int | None
    # None이면 개인화 행이 없다는 뜻(신규 사용자 경로). warnings로 이유를 알린다(예: PERSONALIZATION_TABLE_MISSING).
    payload: dict | None
    # AI06가 계산한 개인 위험·지속 기준. 없으면 정책의 모집단 값을 쓴다.
    hr_danger_bpm: float | None = None
    hr_sustain_bpm: float | None = None
    hr_threshold_run_count: int | None = None
    # AI09 목표 심박 보정(S15P31E105-377, app/target_calibration.py): 지난 러닝 평균 심박 최근 20회 중앙값과 회수.
    target_hr_history_median_bpm: float | None = None
    target_hr_history_run_count: int = 0
    warnings: tuple[str, ...] = ()
    # 평균 묶음으로 계획할 때만: median_bundle 또는 empty(G0). 개인 묶음이면 None.
    population_mode: str | None = None
    # AI09 속도 보정 v_ref(running_sessions 최근 20회 이동 속도 중앙값). 없으면 Train 기본값을 쓴다.
    speed_ref_mps: float | None = None
    speed_ref_run_count: int = 0


@dataclass(frozen=True)
class ResolvedGoal:
    distance_m: Decimal
    target_pace_sec_per_km: Decimal | None
    predicted_finish_sec: int | None
    target_pace_source: str
    target_finish_sec: int | None = None


@dataclass(frozen=True)
class PaceSelection:
    """An explicitly experimental selection produced by an ODE-backed policy."""

    segment_paces_sec_per_km: tuple[float, ...]
    model_version: str
    policy_version: str
    personalized: bool
    preserve_goal_duration: bool | None
    hr_reference_bpm: float | None = None
    hr_reference_source: str | None = None
    mean_predicted_hr_bpm: float | None = None
    peak_predicted_hr_bpm: float | None = None
    max_hr_reference_deviation_bpm: float | None = None
    hr_reference_band_bpm: float | None = None
    hr_reference_band_satisfied: bool | None = None
    hr_reference_validated: bool = False
    pace_search_support_scope: str | None = None
    pace_search_grid_step_mps: float | None = None
    pace_search_boundary_hit: bool | None = None
    personalization_bundle_sha256: str | None = None
    personalization_support_cutoff_at: str | None = None
    personalization_bundle_created_at: str | None = None
    ode_checkpoint_sha256: str | None = None
    ode_summary_stats_sha256: str | None = None
    validated_horizon_sec: float | None = None
    hr0_used: bool = False
    policy_validated: bool = False
    goal_duration_preserved: bool = False
    # 좌표 탐색에서 ODE에 넣은 30초 rollout 칸 수와 예산(초기 후보 포함, 최종 재평가 제외).
    search_rollout_cells: int = 0
    search_budget_cells: int = 0
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class PersonalPlanSegment:
    sequence: int
    start_distance_m: float
    end_distance_m: float
    length_m: float
    pace_sec_per_km: float
    # Per-plan pace ratio, distinct from the course-common terrain ratio.
    pace_ratio: float


class CoursePlanLookup(Protocol):
    """Backend-owned lookup; this package contains no DB credentials or SQL."""

    def get_course(self, course_id: int) -> CoursePlanSnapshot | None: ...


class UserPersonalizationLookup(Protocol):
    """Returns an ODE personalization object already built from backend-owned runs."""

    def get_personalization(self, user_id: int) -> UserPersonalizationSnapshot | None: ...


@dataclass(frozen=True)
class PopulationMeanPlanSnapshot:
    course_id: int
    course_version: str
    segment_paces_sec_per_km: tuple[float, ...]
    dataset_version: str
    train_subject_count: int
    train_run_count: int
    course_coverage: float
    source_scope: str = "COURSE_CONDITIONAL_TRAIN_MEAN"
    mean_pace_sec_per_km: float | None = None
    usage: str | None = None


class PopulationMeanPlanLookup(Protocol):
    """Returns a train-cohort conditional mean and its reproducible provenance."""

    def get_population_mean_plan(self, course: CoursePlanSnapshot) -> PopulationMeanPlanSnapshot | None: ...


class PersonalPaceOptimizer(Protocol):
    """Policy boundary for an ODE-backed proposal; not a validated product policy."""

    def select(self, *, course: CoursePlanSnapshot, goal: ResolvedGoal | None,
               personalization: UserPersonalizationSnapshot, ode_runtime: object) -> PaceSelection | None: ...


class PersonalPlanResponse(CamelModel):
    plan_status: str
    user_id: ServerId | None
    course_id: ServerId
    course_version: str
    model_version: str
    policy_version: str
    personalized: bool
    plan_source: str
    policy_validated: bool = False
    hr0_used: bool = False
    hr_reference_bpm: float | None = None
    hr_reference_source: str | None = None
    mean_predicted_hr_bpm: float | None = None
    peak_predicted_hr_bpm: float | None = None
    max_hr_reference_deviation_bpm: float | None = None
    hr_reference_band_bpm: float | None = None
    hr_reference_band_satisfied: bool | None = None
    hr_reference_validated: bool = False
    pace_search_support_scope: str | None = None
    pace_search_grid_step_mps: float | None = None
    pace_search_boundary_hit: bool | None = None
    personalization_bundle_sha256: str | None = None
    personalization_support_cutoff_at: str | None = None
    personalization_bundle_created_at: str | None = None
    ode_checkpoint_sha256: str | None = None
    ode_summary_stats_sha256: str | None = None
    validated_horizon_sec: float | None = None
    population_mean_pace_sec_per_km: float | None = None
    population_source_scope: str | None = None
    population_dataset_version: str | None = None
    train_subject_count: int | None = None
    train_run_count: int | None = None
    course_profile_coverage: float | None = None
    target_distance_m: float
    target_pace_sec_per_km: float
    predicted_finish_sec: int
    segments: list[PersonalPlanSegment]
    warnings: list[str] = Field(default_factory=list)


def _not_ready(reason: str) -> ApiError:
    return ApiError(
        503,
        "PERSONAL_PLAN_NOT_READY",
        "개인 페이스 계획에 필요한 데이터 또는 승인된 선택 정책이 준비되지 않았습니다.",
        [{"name": "readiness", "reason": reason}],
    )


def resolve_selected_goal(selected_goal: SelectedGoal | None, course: CoursePlanSnapshot) -> ResolvedGoal:
    """Use the AI05 goal conversion when present; no-goal uses the course length only."""
    if course.course_id <= 0 or not math.isfinite(course.distance_m) or course.distance_m <= 0:
        raise ApiError(422, "INVALID_GOAL", "코스 거리 정보가 유효하지 않습니다.")
    if course.distance_m > float(_MAX_DISTANCE_M):
        raise ApiError(422, "INVALID_GOAL", "코스 거리가 현재 AI05 계획 상한을 초과했습니다.")
    if not course.grade_profile:
        raise ApiError(422, "COURSE_DATA_MISMATCH", "코스 등급 프로파일이 비어 있습니다.",
                       [{"name": "course.gradeProfile", "reason": "코스 계획에 경사 구간이 필요합니다."}])
    profile_distance = Decimal(str(course.grade_profile[-1].end_distance_m))
    if abs(Decimal(str(course.distance_m)) - profile_distance) > Decimal(
            str(prerun_planner.COURSE_DISTANCE_TOL_M)):
        raise ApiError(422, "COURSE_DATA_MISMATCH", "코스 거리와 등급 프로파일 길이가 일치하지 않습니다.",
                       [{"name": "course.gradeProfile", "reason": "마지막 구간 끝 거리와 코스 거리가 다릅니다."}])
    no_goal = ResolvedGoal(distance_m=Decimal(str(course.distance_m)),
                           target_pace_sec_per_km=None, predicted_finish_sec=None,
                           target_pace_source="NO_GOAL_ODE_HR_REFERENCE",
                           target_finish_sec=None)
    if selected_goal is None:
        return no_goal
    if (selected_goal.target_distance_m is not None
            and selected_goal.target_distance_m != int(round(course.distance_m))):
        raise ApiError(422, "COURSE_DATA_MISMATCH", "목표 거리와 코스 거리가 일치하지 않습니다.",
                       [{"name": "selectedGoal.targetDistanceM", "reason": "코스 계획은 전체 코스 거리로만 생성됩니다."}])
    if selected_goal.target_duration_sec is None and selected_goal.target_pace_sec_per_km is None:
        # Course distance alone is not a time/pace goal; AI05 would ask for a habitual pace.
        return no_goal
    body = selected_goal.model_dump(by_alias=True, exclude_none=True)
    body["courseId"] = course.course_id
    body["gradeProfile"] = [segment.model_dump(by_alias=True, exclude_none=True)
                            for segment in course.grade_profile]
    status, result = prerun_planner.plan_api(body, predictor=prerun_planner.NO_HR_PREVIEW,
                                             config=prerun_planner.API_CONFIG)
    if status >= 400:
        details = result.get("details") or {}
        fields = details.get("fields") or []
        raise ApiError(status, result.get("code", "INVALID_GOAL"),
                       result.get("message", "선택 목표가 현재 AI05 계약과 맞지 않습니다."), fields)
    if result.get("planStatus") != "PLANNED":
        raise ApiError(422, "INVALID_GOAL", "선택 목표를 페이스 계획으로 변환할 수 없습니다.")
    resolved_distance = Decimal(str(result["targetDistanceM"]))
    resolved_pace = Decimal(str(result["targetPaceSecPerKm"]))
    if selected_goal.target_duration_sec is not None:
        target_finish_sec = selected_goal.target_duration_sec
    else:
        target_finish_sec = int((resolved_distance * resolved_pace / _M_PER_KM).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP))
    return ResolvedGoal(
        distance_m=resolved_distance,
        target_pace_sec_per_km=resolved_pace,
        predicted_finish_sec=int(result["predictedFinishSec"]),
        target_pace_source=str(result["targetPaceSource"]),
        target_finish_sec=target_finish_sec,
    )


def split_distance_1km(total_distance_m: float | Decimal) -> tuple[tuple[Decimal, Decimal], ...]:
    """Split from 0m into 1km portions and retain the exact final remainder."""
    try:
        distance = Decimal(str(total_distance_m))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("total distance must be a finite positive number") from exc
    if not distance.is_finite() or distance <= 0 or distance > _MAX_DISTANCE_M:
        raise ValueError("total distance must be within (0, 45000] meters")
    result: list[tuple[Decimal, Decimal]] = []
    start = Decimal(0)
    while start < distance:
        end = min(start + _M_PER_KM, distance)
        result.append((start, end))
        start = end
    return tuple(result)


def clamp_segment_ratios(
    lengths: Sequence[Decimal | float | int],
    ratios: Sequence[Decimal | float | int],
    *,
    lower: Decimal = PACE_RATIO_MIN,
    upper: Decimal = PACE_RATIO_MAX,
) -> tuple[tuple[Decimal, ...], bool]:
    """구간 비율을 [lower, upper] 안에서 거리 가중 평균 1로 맞춘다. (비율, 잘림 여부)를 돌려준다.

    모든 구간에 같은 배율 λ를 곱한 뒤 범위로 자른다: r'_i = clamp(λ·r_i). f(λ) = Σ l_i·r'_i / Σ l_i는
    λ에 대해 연속·단조 증가하고, λ가 아주 작으면 lower(<1), 아주 크면 upper(>1)이므로 f(λ)=1인 λ가
    항상 있다(모든 값이 1인 계획이 범위 안에 있으므로). f는 꺾이는 점(lower/r_i, upper/r_i) 사이에서
    직선이라, 꺾이는 점 목록을 이분법으로 좁혀 f(a)<1≤f(b)인 구간 [a, b]를 찾고 그 안에서 정확히 푼다.
    입력이 이미 범위 안이고 평균이 1이면 그대로 돌려준다. 잘린 구간을 고정하고 나머지만 다시 맞추던
    방식(공유 패키지 0002)은 (0.75, 1.25)처럼 해가 있는 입력을 '맞출 수 없음'으로 처리했다.
    """
    try:
        segment_lengths = tuple(value if isinstance(value, Decimal) else Decimal(str(value)) for value in lengths)
        original = tuple(value if isinstance(value, Decimal) else Decimal(str(value)) for value in ratios)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("구간 길이와 비율은 유한한 양수여야 합니다") from exc
    if not segment_lengths or len(segment_lengths) != len(original):
        raise ValueError("구간 길이와 비율의 개수가 맞지 않습니다")
    if any(not value.is_finite() or value <= 0 for value in segment_lengths + original):
        raise ValueError("구간 길이와 비율은 유한한 양수여야 합니다")
    if not 0 < lower <= 1 <= upper:
        raise ValueError("비율 범위는 lower ≤ 1 ≤ upper인 양수여야 합니다")

    with localcontext() as context:
        context.prec = _RATIO_PRECISION
        context.rounding = ROUND_HALF_EVEN
        total = sum(segment_lengths, Decimal(0))
        one = Decimal(1)
        # 이미 평균 1인 입력으로 볼 오차. 응답 자릿수(1e-6)보다 훨씬 작다.
        tolerance = Decimal("1e-20")

        def clamped_at(scale: Decimal) -> tuple[Decimal, ...]:
            return tuple(min(upper, max(lower, scale * ratio)) for ratio in original)

        def mean_at(scale: Decimal) -> Decimal:
            return sum((length * ratio for length, ratio in zip(segment_lengths, clamped_at(scale))),
                       Decimal(0)) / total

        if all(lower <= ratio <= upper for ratio in original) and abs(mean_at(one) - one) <= tolerance:
            return original, False

        # f(가장 작은 꺾임점) = lower < 1, f(가장 큰 꺾임점) = upper > 1. lower = 1 = upper인 퇴화 범위는 아래에서 처리.
        breakpoints = sorted({lower / ratio for ratio in original} | {upper / ratio for ratio in original})
        low_index, high_index = 0, len(breakpoints) - 1
        if mean_at(breakpoints[low_index]) >= one:
            scale = breakpoints[low_index]
        else:
            while high_index - low_index > 1:
                middle = (low_index + high_index) // 2
                if mean_at(breakpoints[middle]) < one:
                    low_index = middle
                else:
                    high_index = middle
            left, right = breakpoints[low_index], breakpoints[high_index]
            mean_left, mean_right = mean_at(left), mean_at(right)
            # [left, right] 안에는 꺾임점이 없어 f가 직선이다. mean_left < 1 ≤ mean_right.
            scale = left + (right - left) * (one - mean_left) / (mean_right - mean_left)
        bounded = clamped_at(scale)
        clamped = any(scale * ratio < lower or scale * ratio > upper for ratio in original)
        return bounded, clamped


def _match_goal_finish(lengths: Sequence[Decimal], exact: Sequence[Decimal],
                       rounded: Sequence[Decimal]) -> tuple[Decimal, ...]:
    """두 자리 반올림 페이스의 완주시간(초, 반올림)을 반올림 전 목표 완주시간과 같게 맞춘다.

    구간마다 두 자리 반올림 오차가 쌓여 완주시간이 1초 어긋날 수 있다. 그때만 반올림 경계에 가까운
    구간부터 반올림 방향(올림↔내림)을 바꾼다. 바꾼 페이스도 반올림 전 값과 0.01초/km 안이다.
    """
    def finish(values) -> int:
        seconds = sum((length * pace for length, pace in zip(lengths, values)), Decimal(0)) / _M_PER_KM
        return int(seconds.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    target = finish(exact)
    paces = list(rounded)
    current = finish(paces)
    if current == target:
        return tuple(rounded)
    step = -_CENT if current > target else _CENT
    candidates = sorted((index for index in range(len(paces)) if (paces[index] - exact[index]) * step < 0),
                        key=lambda index: (-abs(paces[index] - exact[index]), index))
    for index in candidates:
        paces[index] += step
        if finish(paces) == target:
            break
    return tuple(paces)


def finalize_personal_segments(
    total_distance_m: float | Decimal,
    target_pace_sec_per_km: float | Decimal | None,
    segment_paces_sec_per_km: Sequence[float | Decimal],
    *,
    preserve_goal_duration: bool,
) -> tuple[PersonalPlanSegment, ...]:
    """Serialize selected paces; this does not choose paces or score ODE output."""
    return finalize_personal_segments_with_clamp(
        total_distance_m, target_pace_sec_per_km, segment_paces_sec_per_km,
        preserve_goal_duration=preserve_goal_duration)[0]


def finalize_personal_segments_with_clamp(
    total_distance_m: float | Decimal,
    target_pace_sec_per_km: float | Decimal | None,
    segment_paces_sec_per_km: Sequence[float | Decimal],
    *,
    preserve_goal_duration: bool,
) -> tuple[tuple[PersonalPlanSegment, ...], bool]:
    """(구간, 비율 잘림 여부). 구간 비율을 0.85~1.20·거리 가중 평균 1로 맞춘 뒤 페이스를 다시 계산한다.

    평균 페이스 m(목표가 있으면 목표 페이스)은 바뀌지 않는다: 최종 페이스 = m × 제한 비율.
    따라서 반올림 전 완주시간은 그대로이고, 백엔드가 목표 페이스 × paceRatio로 만든 구간 페이스와 같다.
    """
    splits = split_distance_1km(total_distance_m)
    try:
        target_pace = (None if target_pace_sec_per_km is None
                       else Decimal(str(target_pace_sec_per_km)))
        paces = tuple(Decimal(str(value)) for value in segment_paces_sec_per_km)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("pace values must be finite positive numbers") from exc
    if target_pace is not None and (not target_pace.is_finite() or target_pace <= 0):
        raise ValueError("target pace must be finite and positive")
    if len(paces) != len(splits):
        raise ValueError("one selected pace is required for each 1km/remainder split")
    if any(not pace.is_finite() or pace <= 0 for pace in paces):
        raise ValueError("selected paces must be finite and positive")

    if preserve_goal_duration and target_pace is not None:
        distance = Decimal(str(total_distance_m))
        weighted_seconds = sum((end - start) * pace for (start, end), pace in zip(splits, paces))
        mean_pace = weighted_seconds / distance
        scale = target_pace / mean_pace
        paces = tuple(pace * scale for pace in paces)

    distance = Decimal(str(total_distance_m))
    lengths = tuple(end - start for start, end in splits)
    with localcontext() as context:
        context.prec = _RATIO_PRECISION
        context.rounding = ROUND_HALF_EVEN
        mean_pace = sum((length * pace for length, pace in zip(lengths, paces)), Decimal(0)) / distance
        if not mean_pace.is_finite() or mean_pace <= 0:
            raise ValueError("pace ratio basis must be finite and positive")
        bounded_ratios, clamped = clamp_segment_ratios(lengths, tuple(pace / mean_pace for pace in paces))
        if clamped:
            paces = tuple(mean_pace * ratio for ratio in bounded_ratios)
    rounded_paces = tuple(pace.quantize(_CENT, rounding=ROUND_HALF_UP) for pace in paces)
    if preserve_goal_duration and target_pace is not None:
        rounded_paces = _match_goal_finish(lengths, paces, rounded_paces)
    rounded_ratios =tuple(ratio.quantize(_RATIO_SCALE, rounding=ROUND_HALF_UP) for ratio in bounded_ratios)
    finalized: list[PersonalPlanSegment] = []
    for index, ((start, end), rounded_pace, rounded_ratio) in enumerate(
            zip(splits, rounded_paces, rounded_ratios), start=1):
        finalized.append(PersonalPlanSegment(
            sequence=index,
            start_distance_m=float(start),
            end_distance_m=float(end),
            length_m=float(end - start),
            pace_sec_per_km=float(rounded_pace),
            pace_ratio=float(rounded_ratio),
        ))
    return tuple(finalized), clamped


def finish_sec_from_segments(segments: Sequence[PersonalPlanSegment]) -> int:
    """Calculate finish time from serialized paces, including their 2dp rounding."""
    if not segments:
        raise ValueError("at least one segment is required")
    seconds = Decimal(0)
    for segment in segments:
        length = Decimal(str(segment.length_m))
        pace = Decimal(str(segment.pace_sec_per_km))
        if not length.is_finite() or length <= 0 or not pace.is_finite() or pace <= 0:
            raise ValueError("segment length and pace must be finite and positive")
        seconds += length * pace / _M_PER_KM
    return int(seconds.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


class _CourseGradeIndex:
    """코스 경사를 앞에서부터 누적해 조회를 빠르게 한다."""

    def __init__(self, course: CoursePlanSnapshot):
        self.course = course
        self.starts = tuple(float(segment.start_distance_m) for segment in course.grade_profile)
        self.ends = tuple(float(segment.end_distance_m) for segment in course.grade_profile)
        self.grades = tuple(float(segment.grade_percent) for segment in course.grade_profile)
        self.weighted_prefix = [0.0]
        self.covered_prefix = [0.0]
        self.linear_fallback = False
        previous_end = None
        for start, end, grade in zip(self.starts, self.ends, self.grades):
            if end <= start or (previous_end is not None and start < previous_end):
                self.linear_fallback = True
            length = max(0.0, end - start)
            self.weighted_prefix.append(self.weighted_prefix[-1] + length * grade)
            self.covered_prefix.append(self.covered_prefix[-1] + length)
            previous_end = end

    @staticmethod
    def _bounds(course: CoursePlanSnapshot, start_m: float, end_m: float) -> tuple[float, float]:
        lo, hi = max(0.0, start_m), min(float(course.distance_m), end_m)
        if hi <= lo:
            lo = min(float(course.distance_m) - 1e-6, max(0.0, lo))
            hi = min(float(course.distance_m), lo + 1e-6)
        return lo, hi

    @staticmethod
    def _linear_sum(course: CoursePlanSnapshot, lo: float, hi: float) -> tuple[float, float]:
        weighted = 0.0
        covered = 0.0
        for segment in course.grade_profile:
            overlap = max(0.0, min(hi, float(segment.end_distance_m))
                          - max(lo, float(segment.start_distance_m)))
            if overlap:
                weighted += overlap * float(segment.grade_percent)
                covered += overlap
        return weighted, covered

    def _indexed_sum(self, lo: float, hi: float) -> tuple[float, float] | None:
        first = bisect_right(self.starts, lo) - 1
        last = bisect_left(self.starts, hi) - 1
        if first < 0 or last < first:
            return None
        if first == last:
            overlap = max(0.0, min(hi, self.ends[first]) - max(lo, self.starts[first]))
            return overlap * self.grades[first], overlap

        first_length = max(0.0, min(hi, self.ends[first]) - max(lo, self.starts[first]))
        last_length = max(0.0, min(hi, self.ends[last]) - max(lo, self.starts[last]))
        weighted = first_length * self.grades[first]
        covered = first_length
        if last > first + 1:
            weighted += self.weighted_prefix[last] - self.weighted_prefix[first + 1]
            covered += self.covered_prefix[last] - self.covered_prefix[first + 1]
        weighted += last_length * self.grades[last]
        covered += last_length
        return weighted, covered

    def grade_over(self, start_m: float, end_m: float) -> float:
        lo, hi = self._bounds(self.course, start_m, end_m)
        if self.linear_fallback:
            weighted, covered = self._linear_sum(self.course, lo, hi)
        else:
            indexed = self._indexed_sum(lo, hi)
            weighted, covered = (indexed if indexed is not None
                                 else self._linear_sum(self.course, lo, hi))
        if covered <= 0 or abs(covered - (hi - lo)) > 1e-3:
            raise ApiError(422, "COURSE_DATA_MISMATCH", "ODE 입력용 코스 경사 프로파일이 끊겼습니다.")
        return weighted / covered


class OdeBalancedPaceOptimizer:
    """Experimental planner that searches complete profiles through the real ODE API.

    Historical speed quantiles bound the search support; they are not a pace baseline.
    The objective tracks the existing AI04 sustainable HR reference uniformly. Both
    the reference policy and this optimizer are unvalidated and are never enabled by
    default. No monotonic pace-to-HR assumption is made.
    """

    policy_version = "ode-hr-balance-experimental-v1"

    def __init__(self, *, coordinate_passes: int = 2, policy_config=None, search_budget_cells: int | None = None,
                 speed_calibration: SpeedCalibration | None = None):
        self.coordinate_passes = max(1, int(coordinate_passes))
        # ODE 입력 속도 보정층(app/speed_calibration.py). s=1.0이면 예전과 bit 단위로 같다.
        self.speed_calibration = speed_calibration or load_speed_calibration()
        self.policy_config = policy_config or load_policy_config()
        if search_budget_cells is None:
            raw = os.getenv("PERSONAL_PLAN_SEARCH_BUDGET_CELLS", str(DEFAULT_SEARCH_BUDGET_CELLS)).strip()
            try:
                search_budget_cells = int(raw)
            except ValueError:
                raise ValueError(f"PERSONAL_PLAN_SEARCH_BUDGET_CELLS는 양의 정수여야 합니다: {raw}") from None
        if isinstance(search_budget_cells, bool) or int(search_budget_cells) <= 0:
            raise ValueError(f"PERSONAL_PLAN_SEARCH_BUDGET_CELLS는 양의 정수여야 합니다: {search_budget_cells}")
        self.search_budget_cells = int(search_budget_cells)
        raw_cap = os.getenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", "true").strip().lower()
        if raw_cap not in _BOOL_ENV:
            raise ValueError(f"PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN는 true/false여야 합니다: {raw_cap}")
        self.first_segment_cap = _BOOL_ENV[raw_cap]

    def _search_plan(self, *, n_splits: int, grid_size: int, seed_cells: int) -> tuple[int, list[list[int]], bool]:
        """예산 안에서 (반복 횟수, 구간 묶음, 줄였는지)를 정한다. 예산 안이면 1 km 구간 하나씩, 기존 반복 그대로."""
        per_batch = grid_size * seed_cells * _SEARCH_COST_MARGIN
        full = seed_cells + self.coordinate_passes * n_splits * per_batch
        singles = [[index] for index in range(n_splits)]
        if full <= self.search_budget_cells:
            return self.coordinate_passes, singles, False
        batches = max(1, int((self.search_budget_cells - seed_cells) // per_batch))
        if batches >= n_splits:
            # 1 km 구간 하나씩은 유지하고 반복 횟수만 줄인다.
            return max(1, min(self.coordinate_passes, batches // n_splits)), singles, True
        # 한 번만 돌되 이웃한 1 km 구간을 묶어 같은 속도로 탐색한다(묶음 수 = 예산이 허락하는 batch 수).
        bounds = [round(i * n_splits / batches) for i in range(batches + 1)]
        return 1, [list(range(a, b)) for a, b in zip(bounds, bounds[1:]) if b > a], True

    def _personal_inputs(self, personalization: UserPersonalizationSnapshot, runtime):
        payload = personalization.payload
        model_version = getattr(getattr(runtime, "info", None), "model_version", None)
        history = np.asarray(payload.get("history8") or [], dtype=np.float64)
        p4 = np.asarray(payload.get("p4") or [], dtype=np.float64)
        if (payload.get("schemaVersion") != "runway.ode.personalization.v1"
                or not payload.get("modelVersion") or payload.get("modelVersion") != model_version
                or payload.get("userId") != personalization.user_id
                # 평균 묶음은 정직하게 supportRunCount=0을 담는다. 개인 묶음만 1 이상을 요구한다.
                or (personalization.population_mode is None and int(payload.get("supportRunCount") or 0) < 1)
                or not isinstance(payload.get("summaryU"), dict) or not payload.get("summaryU")
                or p4.shape != (4,) or not np.isfinite(p4).all()
                or history.ndim != 2 or history.shape[1:] != (5,) or not len(history)
                or len(history) > 512 or not np.isfinite(history).all()):
            raise ApiError(503, "PERSONALIZATION_NOT_SUPPORTED",
                           "ODE 개인화 bundle의 schema, model, support 또는 입력 배열을 검증할 수 없습니다.")
        hr0_support = payload.get("hr0SubBpm")
        if (isinstance(hr0_support, bool) or not isinstance(hr0_support, (int, float))
                or not math.isfinite(float(hr0_support)) or not 35 <= float(hr0_support) <= 220):
            raise ApiError(503, "PERSONALIZATION_NOT_SUPPORTED",
                           "support run 시작 HR 요약값이 없어 HR0 없는 ODE 시나리오를 만들 수 없습니다.")
        ref = blend_hr_thresholds(
            self.policy_config,
            personal_danger_bpm=personalization.hr_danger_bpm,
            personal_sustain_bpm=personalization.hr_sustain_bpm,
            run_count=personalization.hr_threshold_run_count,
        )
        # S15P31E105-377: 계획 목표(sustain_bpm)만 보정 비율 × P85로 바꾼다. 위험 기준은 그대로다.
        ref = target_calibration.calibrate_reference(ref, personalization)
        lower, upper = _TRAIN_SPEED_QUANTILES_MPS[0], _TRAIN_SPEED_QUANTILES_MPS[-1]
        grid = np.unique(np.round(np.concatenate((
            np.arange(lower, upper, _SPEED_SEARCH_GRID_STEP_MPS, dtype=np.float64),
            np.asarray(_TRAIN_SPEED_QUANTILES_MPS, dtype=np.float64),
            np.asarray([upper], dtype=np.float64),
        )), 6))
        return payload, float(hr0_support), ref, grid, _SPEED_SEARCH_SUPPORT_SOURCE

    @staticmethod
    def _distance_at_time(seconds: float, splits, paces: Sequence[float]) -> float:
        remaining = max(0.0, float(seconds))
        distance = 0.0
        for (start, end), pace in zip(splits, paces):
            speed = 1000.0 / float(pace)
            duration = float(end - start) / speed
            used = min(remaining, duration)
            distance += used * speed
            remaining -= used
            if remaining <= 1e-9:
                break
        return min(float(splits[-1][1]), distance)

    @staticmethod
    def _grade_over(course: CoursePlanSnapshot, start_m: float, end_m: float,
                    grade_index: _CourseGradeIndex | None = None) -> float:
        return (grade_index or _CourseGradeIndex(course)).grade_over(start_m, end_m)

    @classmethod
    def _forward_profile(cls, course: CoursePlanSnapshot, paces: Sequence[float],
                         grade_index: _CourseGradeIndex | None = None):
        grade_index = grade_index or _CourseGradeIndex(course)
        splits = split_distance_1km(course.distance_m)
        duration = sum(float(end - start) * float(pace) / 1000.0
                       for (start, end), pace in zip(splits, paces))
        if not math.isfinite(duration) or duration <= 0:
            raise ApiError(422, "PERSONAL_PLAN_PREDICTION_INVALID", "계획 완주 시간이 유한한 양수가 아닙니다.")
        steps = max(1, int(math.ceil(duration / 30.0)))
        speeds, grades = [], []
        for index in range(steps):
            start_t, end_t = index * 30.0, (index + 1) * 30.0
            start_m = cls._distance_at_time(start_t, splits, paces)
            end_m = cls._distance_at_time(min(end_t, duration), splits, paces)
            if end_m <= start_m:
                end_m = min(float(course.distance_m), start_m + 1e-6)
            active_sec = max(1e-9, min(end_t, duration) - start_t)
            if active_sec >= 30.0 - 1e-9:
                speeds.append((end_m - start_m) / 30.0)
            else:
                # The ODE grid is fixed at 30s; its last post-finish point is discarded.
                pace_index = min(len(splits) - 1, max(0, int(start_m // 1000)))
                speeds.append(1000.0 / float(paces[pace_index]))
            grades.append(cls._grade_over(course, start_m, end_m, grade_index))
        return tuple(speeds), tuple(grades), duration

    def _predict_many(self, *, course, pace_profiles, personalization, runtime, support_hr,
                      grade_index: _CourseGradeIndex | None = None, forward_profiles=None):
        """Batch complete 30s ODE trajectories; split/time boundaries stay explicit."""
        schedules = []
        if forward_profiles is None:
            grade_index = grade_index or _CourseGradeIndex(course)
            forward_profiles = tuple(self._forward_profile(course, paces, grade_index)
                                     for paces in pace_profiles)
        for paces, (speeds, grades, duration) in zip(pace_profiles, forward_profiles):
            if duration < 30.0:
                raise ApiError(422, "PLAN_HORIZON_TOO_SHORT",
                               "30초 ODE 간격보다 짧은 완주 시간은 HR trajectory로 평가할 수 없습니다.")
            splits = split_distance_1km(course.distance_m)
            avg_pace = sum(float(end - start) * pace for (start, end), pace
                           in zip(splits, paces)) / float(course.distance_m)
            candidate = PaceCandidate(0.0, tuple(float(p) for p in paces), float(duration))
            schedules.append((candidate, speeds, grades, duration, avg_pace, tuple(paces)))

        ode_speeds = tuple(item[1] for item in schedules)
        calibration = self.speed_calibration
        if calibration.enabled:
            # ODE 입력에만 v' = v_ref + s·(v − v_ref)를 쓴다. 하한·출력 페이스·완주시간은 원래 v 기준이다.
            speed_ref, _, _ = resolve_speed_ref(personalization.speed_ref_mps, personalization.speed_ref_run_count,
                                                calibration.default_speed_ref_mps)
            floor = float(_TRAIN_SPEED_QUANTILES_MPS[0])
            ode_speeds = tuple(transform_speeds(row, calibration.scale, speed_ref, floor) for row in ode_speeds)
        request = PreRunSimulationRequest(
            candidates=tuple(item[0] for item in schedules),
            future_speed_mps=ode_speeds,
            future_grade_pct=tuple(item[2] for item in schedules),
            sample_interval_s=30, hr0_bpm=None, personalized=True,
        )
        predictor = runtime.pre_run_predictor(
            personalization=personalization.payload,
            support_start_hr_median_bpm=support_hr,
            **({"drop_personal_inputs": True} if personalization.population_mode == "empty" else {}),
        )
        simulated = predictor.simulate_pre_run(request)
        if (not getattr(simulated, "personalized", False)
                or getattr(simulated, "model_version", None) != runtime.info.model_version
                or len(getattr(simulated, "hr_bpm", ())) != len(schedules)):
            raise ApiError(503, "PERSONAL_PLAN_PREDICTION_INVALID", "ODE 개인화 예측 상태 또는 버전이 유효하지 않습니다.")

        results = []
        model_warnings = list(getattr(simulated, "warnings", ()))
        for profile_index, (_, speeds, _, duration, avg_pace, paces) in enumerate(schedules):
            curve = np.asarray(simulated.hr_bpm[profile_index], dtype=np.float64)
            if not len(curve) or len(curve) != len(speeds) or not np.isfinite(curve).all():
                raise ApiError(503, "PERSONAL_PLAN_PREDICTION_INVALID", "ODE HR 궤적이 비어 있거나 유한하지 않습니다.")
            full_cells = min(len(curve), int(math.floor(duration / 30.0)))
            if full_cells < 1:
                raise ApiError(422, "PLAN_HORIZON_TOO_SHORT",
                               "완주 전에 관측되는 완전한 30초 ODE cell이 없습니다.")
            usable = curve[:full_cells]
            tail_sec = duration - full_cells * 30.0
            # The final fractional interval holds the last HR sample observed at
            # the previous full-cell boundary. It never counts a post-finish HR.
            intervals = [(index * 30.0, (index + 1) * 30.0, float(value))
                         for index, value in enumerate(usable)]
            if tail_sec > 1e-9:
                intervals.append((full_cells * 30.0, duration, float(usable[-1])))

            splits = split_distance_1km(course.distance_m)
            split_durations = [float(end - start) * float(pace) / 1000.0
                               for (start, end), pace in zip(splits, paces)]
            split_weighted_hr = [0.0 for _ in splits]
            split_weights = [0.0 for _ in splits]
            split_index, split_start_t = 0, 0.0
            split_end_t = split_durations[0]
            for cell_start, cell_end, value in intervals:
                cursor = cell_start
                while cursor < cell_end - 1e-9 and split_index < len(splits):
                    overlap_end = min(cell_end, split_end_t)
                    overlap = max(0.0, overlap_end - max(cursor, split_start_t))
                    if overlap > 0:
                        split_weighted_hr[split_index] += value * overlap
                        split_weights[split_index] += overlap
                        cursor = overlap_end
                    if cursor >= split_end_t - 1e-9 and split_index < len(splits) - 1:
                        split_start_t = split_end_t
                        split_index += 1
                        split_end_t += split_durations[split_index]
                    else:
                        break
            if any(weight <= 0 for weight in split_weights):
                raise ApiError(422, "PERSONAL_PLAN_PREDICTION_INVALID",
                               "완주 전 HR sample로 모든 거리 split을 평가할 coverage가 없습니다.")
            split_means = tuple(weighted / weight for weighted, weight
                                in zip(split_weighted_hr, split_weights))
            # Only full ODE cells are scored. The held tail only gives split coverage;
            # weighting it by time would reward slowing a short remainder near the target.
            mean_hr = float(np.mean(usable))
            mean_square_hr = float(np.mean(usable ** 2))
            results.append(dict(
                curve=tuple(float(v) for v in usable),
                mean=mean_hr,
                mean_square_hr_bpm2=mean_square_hr,
                peak=float(np.max(usable)), duration=duration,
                split_means=split_means,
                load_variance=float(np.average(
                    (np.asarray(split_means) - np.average(
                        split_means, weights=[float(end - start) for start, end in splits])) ** 2,
                    weights=[float(end - start) for start, end in splits])),
                avg_pace=avg_pace,
                warnings=tuple(model_warnings + (["FINAL_PARTIAL_30S_CELL_HR_HOLD_LAST_OBSERVED_SAMPLE"]
                                                  if tail_sec > 1e-9 else [])),
                hr0_used=False,
            ))
        return results

    def _predict(self, *, course, paces, personalization, runtime, support_hr,
                 grade_index: _CourseGradeIndex | None = None):
        return self._predict_many(
            course=course, pace_profiles=(paces,), personalization=personalization,
            runtime=runtime, support_hr=support_hr, grade_index=grade_index,
        )[0]

    @staticmethod
    def _goal_adjust(paces: Sequence[float], course: CoursePlanSnapshot, goal: ResolvedGoal | None):
        if goal is None or goal.target_pace_sec_per_km is None:
            return tuple(float(p) for p in paces)
        splits = split_distance_1km(course.distance_m)
        current_seconds = sum(float(end - start) * float(pace) / 1000.0
                              for (start, end), pace in zip(splits, paces))
        target_seconds = float(course.distance_m) * float(goal.target_pace_sec_per_km) / 1000.0
        if target_seconds <= 0 or not math.isfinite(target_seconds):
            raise ApiError(422, "INVALID_GOAL", "목표 완주 시간이 유한한 양수가 아닙니다.")
        # A common scale preserves the selected relative profile while matching AI05's goal.
        scale = target_seconds / current_seconds
        adjusted = tuple(float(p) * scale for p in paces)
        if any(not math.isfinite(p) or p <= 0 for p in adjusted):
            raise ApiError(422, "INVALID_GOAL", "목표 변환으로 유효하지 않은 페이스가 생겼습니다.")
        return adjusted

    def select(self, *, course: CoursePlanSnapshot, goal: ResolvedGoal | None,
               personalization: UserPersonalizationSnapshot, ode_runtime: object) -> PaceSelection:
        payload, support_hr, ref, grid, support_source = self._personal_inputs(
            personalization, ode_runtime)
        target_hr = float(ref.sustain_bpm)
        if not 0 < float(course.distance_m) <= float(_MAX_DISTANCE_M):
            raise ApiError(422, "INVALID_GOAL", "코스 거리가 현재 AI05 계획 상한을 초과했습니다.")
        splits = split_distance_1km(course.distance_m)
        if len(splits) > 45:
            raise ApiError(422, "INVALID_GOAL", "코스 구간 수가 계획 상한을 초과했습니다.")
        grade_index = _CourseGradeIndex(course)
        target_pace = (None if goal is None else goal.target_pace_sec_per_km)
        distance = float(course.distance_m)
        if target_pace is not None:
            goal_speed = 1000.0 / float(target_pace)
            if not float(grid[0]) - 1e-9 <= goal_speed <= float(grid[-1]) + 1e-9:
                raise ApiError(422, "GOAL_OUTSIDE_PACE_SEARCH_SUPPORT",
                               "목표 pace가 공통 탐색 지원 범위 밖이라 ODE 계획을 만들 수 없습니다.",
                               [{"name": "selectedGoal",
                                 "reason": f"supported pace={1000.0 / float(grid[-1]):.2f}-"
                                           f"{1000.0 / float(grid[0]):.2f} sec/km"}])
        try:
            bundle_sha = hashlib.sha256(json.dumps(
                payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                allow_nan=False,
            ).encode("utf-8")).hexdigest()
        except (TypeError, ValueError) as exc:
            raise ApiError(503, "PERSONALIZATION_NOT_SUPPORTED",
                           "개인화 bundle을 정규 JSON으로 해시할 수 없습니다.") from exc
        support_cutoff_at = payload.get("supportCutoffAt")
        bundle_created_at = payload.get("createdAt") or payload.get("supportCreatedAt")

        spent = [0]

        def evaluate_many(raw_profiles, *, enforce_budget=True):
            valid = []
            valid_meta = []
            for raw_speeds in raw_profiles:
                if min(raw_speeds) < grid[0] - 1e-9 or max(raw_speeds) > grid[-1] + 1e-9:
                    continue
                raw_paces = tuple(1000.0 / float(v) for v in raw_speeds)
                adjusted = self._goal_adjust(raw_paces, course, goal)
                observed_speeds = 1000.0 / np.asarray(adjusted, dtype=np.float64)
                if (goal is not None and goal.target_pace_sec_per_km is not None
                        and (observed_speeds.min() < grid[0] - 1e-9
                             or observed_speeds.max() > grid[-1] + 1e-9)):
                    continue
                duration = sum(float(end - start) * pace / 1000.0
                               for (start, end), pace in zip(splits, adjusted))
                if duration < 30.0:
                    continue
                valid.append(adjusted)
                valid_meta.append((tuple(float(v) for v in raw_speeds), adjusted))
            if not valid:
                return []
            forward_profiles = tuple(self._forward_profile(course, paces, grade_index) for paces in valid)
            cost = sum(len(profile[0]) for profile in forward_profiles)
            if enforce_budget and spent[0] + cost > self.search_budget_cells:
                return None
            spent[0] += cost
            predictions = self._predict_many(
                course=course, pace_profiles=valid, personalization=personalization,
                runtime=ode_runtime, support_hr=support_hr, grade_index=grade_index,
                forward_profiles=forward_profiles)
            scored = []
            for (raw_speeds, adjusted), predicted in zip(valid_meta, predictions):
                mean_error = max(0.0, float(predicted["mean_square_hr_bpm2"]
                                            - 2 * target_hr * predicted["mean"]
                                            + target_hr ** 2))
                pace_change = sum(abs(right - left)
                                  for left, right in zip(raw_speeds, raw_speeds[1:]))
                # J = 1*(time-weighted HR target MSE / 10^2)
                #   + 1*(distance-weighted between-split HR variance / 10^2).
                # Both terms are dimensionless after 10-bpm normalization. The
                # unvalidated AI04 sustainable reference is a soft target, not a cap.
                scale_squared = _HR_OBJECTIVE_SCALE_BPM ** 2
                objective = (_HR_TARGET_WEIGHT * mean_error / scale_squared
                             + _HR_SPLIT_VARIANCE_WEIGHT
                             * predicted["load_variance"] / scale_squared)
                scored.append((objective, mean_error, predicted["load_variance"],
                               pace_change, predicted["duration"], raw_speeds, adjusted, predicted))
            return scored

        # The common FitRec Train p50 is only an initial search seed. User history
        # is supplied to the ODE; no user or population pace is used as the base.
        seed_speed = float(_TRAIN_SPEED_QUANTILES_MPS[2])
        current = [seed_speed for _ in splits]
        initial = evaluate_many((current,), enforce_budget=False)
        best = initial[0] if initial else None
        if best is None:
            raise ApiError(422, "PERSONAL_PLAN_NOT_FEASIBLE", "초기 ODE 후보가 계획 제약과 맞지 않습니다.")
        passes, blocks, budget_limited = self._search_plan(
            n_splits=len(splits), grid_size=len(grid), seed_cells=spent[0])
        exhausted = False
        for _ in range(passes):
            changed = False
            for block in blocks:
                local = best
                trials = []
                for speed in grid:
                    trial = list(best[5])
                    for index in block:
                        trial[index] = float(speed)
                    trials.append(trial)
                results = evaluate_many(trials)
                if results is None:
                    exhausted = True
                    break
                for result in results:
                    if result[:5] < local[:5]:
                        local = result
                if local is not best:
                    best, current, changed = local, list(local[5]), True
            if exhausted or not changed:
                break
        budget_limited = budget_limited or exhausted
        _, _, _, _, _, _, adjusted, predicted = best
        first_segment_capped = False
        rest_m = float(distance) - float(splits[0][1] - splits[0][0])
        if self.first_segment_cap and len(splits) >= 2 and rest_m > 0:
            rest_mean = sum(float(end - start) * pace for (start, end), pace
                            in zip(splits[1:], adjusted[1:])) / rest_m
            if adjusted[0] < rest_mean - _FIRST_SEGMENT_TOL_SEC_PER_KM:
                # 첫 km만 나머지 평균으로 올리고, 목표 시간이 있으면 같은 공통 배율로 완주시간을 맞춘다.
                adjusted = self._goal_adjust((rest_mean,) + tuple(adjusted[1:]), course, goal)
                first_segment_capped = True
        rounded = tuple(float(Decimal(str(p)).quantize(_CENT, rounding=ROUND_HALF_UP)) for p in adjusted)
        # Re-evaluate after goal conversion and 2dp pace rounding.
        final_prediction = self._predict(course=course, paces=rounded, personalization=personalization,
                                         runtime=ode_runtime, support_hr=support_hr,
                                         grade_index=grade_index)
        final_deviation = max(abs(value - target_hr) for value in final_prediction["split_means"])
        warning_set = list(final_prediction["warnings"])
        if final_deviation > self.policy_config.band_bpm:
            warning_set.append("HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN")
        warning_set.append(f"PACE_SEARCH_SUPPORT={support_source}")
        warning_set.extend(target_calibration.calibration_warnings(personalization))
        boundary_hit = any(
            min(abs(speed - float(grid[0])), abs(speed - float(grid[-1]))) <= 1e-6
            for speed in best[5]
        )
        if boundary_hit:
            warning_set.append("PACE_SEARCH_DOMAIN_BOUNDARY_HIT_BEST_EFFORT")
        if final_prediction["duration"] > _EVALUATED_PRERUN_HORIZON_SEC:
            warning_set.append("ODE_BEYOND_VALIDATED_HORIZON")
        if budget_limited:
            warning_set.append("PLAN_SEARCH_BUDGET_LIMITED")
        if first_segment_capped:
            warning_set.append("PLAN_FIRST_SEGMENT_CAPPED")
        warning_set.append(f"PACE_SEARCH_GRID_STEP_MPS={_SPEED_SEARCH_GRID_STEP_MPS:.2f}")
        if self.speed_calibration.enabled:
            _, _, speed_ref_source = resolve_speed_ref(
                personalization.speed_ref_mps, personalization.speed_ref_run_count,
                self.speed_calibration.default_speed_ref_mps)
            warning_set.append(f"ODE_SPEED_CALIB_SCALE={self.speed_calibration.scale:.2f}")
            warning_set.append(f"ODE_SPEED_REF_SOURCE={speed_ref_source.upper()}")
        warning_set.append("POLICY_UNVALIDATED_NO_SAFETY_CLAIM")
        if support_cutoff_at is None:
            warning_set.append("PERSONALIZATION_SUPPORT_CUTOFF_NOT_PROVEN")
        if not getattr(getattr(ode_runtime, "info", None), "hr0_head", False):
            warning_set.append("HR0_NOT_MEASURED_SUPPORT_MEDIAN_USED")
        return PaceSelection(
            segment_paces_sec_per_km=rounded,
            model_version=ode_runtime.info.model_version,
            policy_version=self.policy_version,
            personalized=True,
            preserve_goal_duration=False,
            hr_reference_bpm=target_hr,
            hr_reference_source=ref.personal_plan_source,
            hr_reference_validated=False,
            mean_predicted_hr_bpm=final_prediction["mean"],
            peak_predicted_hr_bpm=final_prediction["peak"],
            max_hr_reference_deviation_bpm=final_deviation,
            hr_reference_band_bpm=float(self.policy_config.band_bpm),
            hr_reference_band_satisfied=final_deviation <= float(self.policy_config.band_bpm),
            pace_search_grid_step_mps=_SPEED_SEARCH_GRID_STEP_MPS,
            pace_search_boundary_hit=boundary_hit,
            pace_search_support_scope=support_source,
            personalization_bundle_sha256=bundle_sha,
            personalization_support_cutoff_at=(str(support_cutoff_at) if support_cutoff_at is not None else None),
            personalization_bundle_created_at=(str(bundle_created_at) if bundle_created_at is not None else None),
            ode_checkpoint_sha256=getattr(ode_runtime.info, "checkpoint_sha256", None),
            ode_summary_stats_sha256=getattr(ode_runtime.info, "summary_stats_sha256", None),
            validated_horizon_sec=_EVALUATED_PRERUN_HORIZON_SEC,
            search_rollout_cells=spent[0],
            search_budget_cells=self.search_budget_cells,
            hr0_used=False,
            policy_validated=False,
            goal_duration_preserved=target_pace is not None,
            warnings=tuple(dict.fromkeys(warning_set)),
        )

    def replay(self, *, course, paces, personalization, ode_runtime):
        payload, support_hr, ref, _, support_source = self._personal_inputs(personalization, ode_runtime)
        result = self._predict(course=course, paces=paces, personalization=personalization,
                              runtime=ode_runtime, support_hr=support_hr)
        result["hr_reference_bpm"] = float(ref.sustain_bpm)
        result["hr_reference_source"] = ref.personal_plan_source
        result["max_hr_reference_deviation_bpm"] = max(
            abs(value - result["hr_reference_bpm"]) for value in result["split_means"])
        result["hr_reference_band_bpm"] = float(self.policy_config.band_bpm)
        result["hr_reference_band_satisfied"] = (
            result["max_hr_reference_deviation_bpm"] <= float(self.policy_config.band_bpm))
        result["pace_search_support_scope"] = support_source
        return result


def build_personal_plan(
    body: PersonalPlanRequest,
    *,
    course_lookup: CoursePlanLookup | None,
    personalization_lookup: UserPersonalizationLookup | None,
    optimizer: PersonalPaceOptimizer | None,
    population_lookup: PopulationMeanPlanLookup | None = None,
    ode_runtime: object | None,
    free_run_grade_policy: str = "reject",
    population_bundle: PopulationBundle | None = None,
    population_mode: str = "off",
    runner_profile_lookup=None,
    runner_blend_k: dict[str, float] | None = None,
) -> PersonalPlanResponse:
    """Build from an ODE bundle or a provenance-bearing train-cohort mean plan."""
    if course_lookup is None:
        raise _not_ready("COURSE_LOOKUP_NOT_CONFIGURED")
    course = course_lookup.get_course(body.course_id)
    if course is None:
        raise ApiError(404, "COURSE_NOT_FOUND", "선택한 코스를 찾을 수 없습니다.")
    if course.course_id != body.course_id:
        raise _not_ready("COURSE_LOOKUP_ID_MISMATCH")
    course_warnings = []
    if course.grade_source == "MISSING":
        if free_run_grade_policy == "reject":
            raise ApiError(422, "COURSE_GRADE_UNAVAILABLE", "코스 고도 정보가 없어 경사 기반 계획을 만들 수 없습니다.")
        # ODE에는 경사 모름 모드가 없어 unknown·flat0 모두 0% 평지로 계산한다.
        course_warnings = ["COURSE_GRADE_PROFILE_MISSING",
                           f"FREE_RUN_GRADE_POLICY_{free_run_grade_policy.upper()}_PROVISIONAL",
                           "ODE_GRADE_FILLED_0"]
    goal = resolve_selected_goal(body.selected_goal, course)
    personalization = (personalization_lookup.get_personalization(body.user_id)
                       if body.user_id is not None and personalization_lookup is not None else None)
    lookup_warnings = list(personalization.warnings) if personalization is not None else []
    course_warnings = course_warnings + lookup_warnings
    if body.user_id is None:
        course_warnings.append("USER_ID_NOT_PROVIDED")
    user_thresholds = ((personalization.hr_danger_bpm, personalization.hr_sustain_bpm,
                        personalization.hr_threshold_run_count) if personalization is not None
                       else (None, None, None))
    # 속도 보정 v_ref: 동의 사용자(userId 있음)만 완료 러닝에서 읽는다. 보정이 꺼져 있거나(s=1.0)
    # 조회기가 지원하지 않으면 읽지 않는다(Train 기본값).
    speed_ref = (None, 0)
    get_speed_ref = getattr(personalization_lookup, "get_speed_ref", None)
    calibration_on = bool(getattr(getattr(optimizer, "speed_calibration", None), "enabled", False))
    if body.user_id is not None and calibration_on and callable(get_speed_ref):
        value, count, speed_warning = get_speed_ref(body.user_id, cutoff=datetime.now(timezone.utc))
        speed_ref = (value, count)
        if speed_warning:
            course_warnings.append(speed_warning)
    if personalization is not None:
        personalization = replace(personalization, speed_ref_mps=speed_ref[0], speed_ref_run_count=speed_ref[1])
    if personalization is not None and personalization.payload is None:
        personalization = None
    enabled = personal_plan_enabled()
    can_personalize = (enabled and personalization is not None and ode_runtime is not None
                       and optimizer is not None)

    if can_personalize:
        payload = personalization.payload
        if personalization.user_id != body.user_id or payload.get("userId") != body.user_id:
            can_personalize = False
        if payload.get("schemaVersion") != "runway.ode.personalization.v1" or not payload.get("modelVersion"):
            can_personalize = False
        if getattr(getattr(ode_runtime, "info", None), "model_version", None) != payload.get("modelVersion"):
            can_personalize = False

    population_kind = None
    if (not can_personalize and population_bundle is not None and population_mode in ("median_bundle", "empty")
            and enabled and ode_runtime is not None and optimizer is not None):
        if getattr(getattr(ode_runtime, "info", None), "model_version", None) != population_bundle.model_version:
            raise _not_ready("POPULATION_BUNDLE_MODEL_VERSION_MISMATCH")
        population_payload = dict(population_bundle.payload)
        population_payload["userId"] = body.user_id
        personalization = UserPersonalizationSnapshot(
            user_id=body.user_id, payload=population_payload,
            hr_danger_bpm=user_thresholds[0], hr_sustain_bpm=user_thresholds[1],
            hr_threshold_run_count=user_thresholds[2],
            population_mode=population_mode, speed_ref_mps=speed_ref[0], speed_ref_run_count=speed_ref[1])
        population_kind = population_mode

    # S15P31E105-377: 목표 심박 개인 비율용 지난 러닝 평균 심박(running_sessions). 실패는 경고만 남긴다.
    if can_personalize or population_kind is not None:
        personalization, history_warning = target_calibration.attach_target_hr_history(
            personalization, personalization_lookup, body.user_id, cutoff=datetime.now(timezone.utc))
        if history_warning:
            course_warnings.append(history_warning)

    # S15P31E105-403: 목표 없는 요청은 온보딩 러닝 프로필 기준을 쓴다(app/runner_baseline.py). ODE는 목표 없이
    # 한 번만 풀고, 그 구간 pace에 공통 배율을 곱해 섞은 완주시간에 맞춘다(목표 경로와 같은 finalize 재사용).
    baseline_plan = None
    if can_personalize or population_kind is not None or population_lookup is not None:
        baseline_plan, baseline_warnings = runner_baseline.prepare_baseline_plan(
            goal, user_id=body.user_id, profile_lookup=runner_profile_lookup,
            cutoff=datetime.now(timezone.utc), blend_k=runner_blend_k)
        course_warnings = course_warnings + baseline_warnings

    def finalize_with_baseline(paces, preserve):
        """(segments, 목표 pace, 경고, 비율 잘림 여부). 기준이 없으면 예전 그대로."""
        if baseline_plan is None:
            segments, clamped = finalize_personal_segments_with_clamp(
                goal.distance_m, goal.target_pace_sec_per_km, paces, preserve_goal_duration=preserve)
            return segments, goal.target_pace_sec_per_km, [], clamped
        ode_finish = sum(float(end - start) * float(pace) / 1000.0
                         for (start, end), pace in zip(split_distance_1km(goal.distance_m), paces))
        pace, extra = runner_baseline.plan_target_pace(baseline_plan, ode_finish, float(goal.distance_m))
        segments, clamped = finalize_personal_segments_with_clamp(goal.distance_m, pace, paces,
                                                                  preserve_goal_duration=True)
        return segments, pace, list(baseline_plan.warnings) + extra, clamped

    if can_personalize or population_kind is not None:
        selection = optimizer.select(course=course, goal=goal,
                                     personalization=personalization, ode_runtime=ode_runtime)
        if (selection is None or not selection.personalized or not selection.model_version
                or not selection.policy_version or selection.preserve_goal_duration is None
                or selection.policy_validated is not False):
            raise _not_ready("PACE_SELECTION_RESULT_NOT_EXPERIMENTAL_OR_PERSONALIZED")
        if selection.model_version != ode_runtime.info.model_version:
            raise _not_ready("PACE_SELECTION_MODEL_VERSION_MISMATCH")
        segments, baseline_pace, baseline_plan_warnings, ratio_clamped = finalize_with_baseline(
            selection.segment_paces_sec_per_km, selection.preserve_goal_duration)
        course_warnings = course_warnings + baseline_plan_warnings
        if goal.target_finish_sec is not None:
            finished = finish_sec_from_segments(segments)
            if abs(finished - goal.target_finish_sec) > 1:
                raise ApiError(422, "PERSONAL_PLAN_GOAL_NOT_PRESERVED",
                               "두 자리 페이스로 반올림한 뒤 목표 완주 시간이 1초 이상 달라집니다.")
        replay = (optimizer.replay(course=course, paces=tuple(s.pace_sec_per_km for s in segments),
                                  personalization=personalization, ode_runtime=ode_runtime)
                  if hasattr(optimizer, "replay") else None)
        mean_plan_pace = sum(segment.length_m * segment.pace_sec_per_km for segment in segments) / float(goal.distance_m)
        selection_warnings = list(selection.warnings)
        if (baseline_plan is not None or ratio_clamped) and replay:
            # 배율 조정·비율 제한 뒤 계획의 HR band 경고는 최종 계획 재생 기준으로 다시 정한다(막지 않음).
            band_warning = "HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN"
            selection_warnings = [w for w in selection_warnings if w != band_warning]
            if replay.get("hr_reference_band_satisfied") is False:
                selection_warnings.append(band_warning)
        if ratio_clamped:
            selection_warnings.append(SEGMENT_RATIO_CLAMPED)
        population_fields = {}
        plan_warnings = course_warnings + selection_warnings
        if population_kind is not None:
            # 평균 기준 계획: 같은 ODE 계획 경로, 묶음은 V2 Train 사람별 중앙값. 정확도 우위를 주장하지 않는다.
            population_fields = dict(
                personalization_bundle_sha256=population_bundle.sha256,
                population_source_scope=population_bundle.source,
                population_dataset_version=f"population-bundle:{population_bundle.sha256[:12]}",
                train_subject_count=population_bundle.train_subject_count,
                train_run_count=population_bundle.train_run_count,
            )
            plan_warnings = course_warnings + [
                "AVERAGE_BASED_RECOMMENDATION", "PERSONALIZED=false", f"POPULATION_MODE={population_kind}",
                f"TRAIN_SUBJECTS={population_bundle.train_subject_count}",
                f"TRAIN_RUNS={population_bundle.train_run_count}"] + selection_warnings
        response = dict(
            plan_status="EXPERIMENTAL" if population_kind is None else "AVERAGE_BASED",
            user_id=body.user_id,
            course_id=body.course_id,
            course_version=course.version,
            model_version=selection.model_version,
            policy_version=(selection.policy_version if population_kind is None
                            else population_bundle.policy_version if population_kind == "median_bundle"
                            else EMPTY_MODE_POLICY_VERSION),
            personalized=population_kind is None,
            plan_source=("PERSONAL_ODE_HR_BALANCE" if population_kind is None
                         else "POPULATION_MEDIAN_ODE" if population_kind == "median_bundle"
                         else "POPULATION_EMPTY_G0_ODE"),
            policy_validated=False,
            hr0_used=False,
            hr_reference_bpm=selection.hr_reference_bpm,
            hr_reference_source=selection.hr_reference_source,
            hr_reference_validated=selection.hr_reference_validated,
            mean_predicted_hr_bpm=(replay["mean"] if replay else selection.mean_predicted_hr_bpm),
            peak_predicted_hr_bpm=(replay["peak"] if replay else selection.peak_predicted_hr_bpm),
            max_hr_reference_deviation_bpm=(
                replay["max_hr_reference_deviation_bpm"] if replay
                else selection.max_hr_reference_deviation_bpm),
            hr_reference_band_bpm=(
                replay["hr_reference_band_bpm"] if replay else selection.hr_reference_band_bpm),
            hr_reference_band_satisfied=(
                replay["hr_reference_band_satisfied"] if replay
                else selection.hr_reference_band_satisfied),
            pace_search_support_scope=selection.pace_search_support_scope,
            pace_search_grid_step_mps=selection.pace_search_grid_step_mps,
            pace_search_boundary_hit=selection.pace_search_boundary_hit,
            personalization_bundle_sha256=selection.personalization_bundle_sha256,
            personalization_support_cutoff_at=selection.personalization_support_cutoff_at,
            personalization_bundle_created_at=selection.personalization_bundle_created_at,
            ode_checkpoint_sha256=selection.ode_checkpoint_sha256,
            ode_summary_stats_sha256=selection.ode_summary_stats_sha256,
            validated_horizon_sec=selection.validated_horizon_sec,
            target_distance_m=float(goal.distance_m),
            target_pace_sec_per_km=float(goal.target_pace_sec_per_km or mean_plan_pace),
            predicted_finish_sec=finish_sec_from_segments(segments),
            segments=list(segments),
            warnings=plan_warnings,
        )
        response.update(population_fields)
        return PersonalPlanResponse(**response)

    # Missing personal ODE state must use a real train-cohort mean, never a user
    # pace average or a locally invented fallback.
    population = (population_lookup.get_population_mean_plan(course)
                  if population_lookup is not None else None)
    if population is None:
        # "Disabled" only when the flag, not a missing bundle, blocked personalization.
        reason = ("PERSONAL_PLAN_EXPERIMENTAL_DISABLED" if not enabled and personalization is not None
                  else "POPULATION_MEAN_MODEL_NOT_CONFIGURED")
        error = _not_ready(reason)
        if lookup_warnings:
            error.fields = error.fields + [{"name": "warnings", "reason": w} for w in lookup_warnings]
            error.headers = {"X-RunWay-Warnings": ",".join(lookup_warnings)}
        raise error
    if (population.course_id != course.course_id or population.course_version != course.version
            or not population.dataset_version or population.train_subject_count <= 0
            or population.train_run_count <= 0 or not math.isfinite(population.course_coverage)
            or not 0 < population.course_coverage <= 1):
        raise _not_ready("POPULATION_MEAN_PROVENANCE_INVALID")
    splits = split_distance_1km(goal.distance_m)
    if len(population.segment_paces_sec_per_km) != len(splits):
        raise _not_ready("POPULATION_MEAN_SPLIT_SHAPE_MISMATCH")
    segments, _, baseline_plan_warnings, ratio_clamped = finalize_with_baseline(
        population.segment_paces_sec_per_km, goal.target_pace_sec_per_km is not None)
    course_warnings = course_warnings + baseline_plan_warnings
    finish = finish_sec_from_segments(segments)
    if goal.target_finish_sec is not None and abs(finish - goal.target_finish_sec) > 1:
        raise ApiError(422, "POPULATION_PLAN_GOAL_NOT_PRESERVED",
                       "평균 기반 계획을 두 자리 페이스로 변환했지만 목표 시간이 1초 이상 달라집니다.")
    mean_plan_pace = sum(segment.length_m * segment.pace_sec_per_km for segment in segments) / float(goal.distance_m)
    return PersonalPlanResponse(
        plan_status="AVERAGE_BASED",
        user_id=body.user_id,
        course_id=body.course_id,
        course_version=course.version,
        model_version=f"train-mean:{population.dataset_version}",
        policy_version="train-cohort-conditional-mean-v1",
        personalized=False,
        plan_source=population.source_scope,
        policy_validated=False,
        hr0_used=False,
        population_mean_pace_sec_per_km=population.mean_pace_sec_per_km,
        population_source_scope=population.source_scope,
        population_dataset_version=population.dataset_version,
        train_subject_count=population.train_subject_count,
        train_run_count=population.train_run_count,
        course_profile_coverage=population.course_coverage,
        target_distance_m=float(goal.distance_m),
        target_pace_sec_per_km=float(goal.target_pace_sec_per_km or mean_plan_pace),
        predicted_finish_sec=finish,
        segments=list(segments),
        warnings=course_warnings + ["AVERAGE_BASED_RECOMMENDATION", "PERSONALIZED=false",
                  f"TRAIN_SUBJECTS={population.train_subject_count}",
                  f"TRAIN_RUNS={population.train_run_count}",
                  f"COURSE_PROFILE_COVERAGE={population.course_coverage:.4f}"]
                 + (["FITREC_RESEARCH_ONLY_NOT_FOR_PRODUCT_OR_REDISTRIBUTION"]
                    if population.usage and "RESEARCH_ONLY_NOT_FOR_PRODUCT" in population.usage else [])
                 + ([SEGMENT_RATIO_CLAMPED] if ratio_clamped else []),
    )

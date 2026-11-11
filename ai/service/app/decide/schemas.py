"""페이스 판단 API의 요청·응답 모델."""
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import Field, FiniteFloat, field_validator, model_serializer, model_validator

from app.schemas import CamelModel, Candidate, PredictRequest
from app.id_types import ServerId, normalize_server_id
from app.pace_selector import DELTAS as CANDIDATE_DELTAS


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and (value.tzinfo is None or value.utcoffset() is None):
        raise ValueError("시각에는 시간대가 있어야 합니다")
    return value


class Goal(CamelModel):
    target_distance_m: int | None = Field(strict=True)
    target_duration_sec: int | None = Field(strict=True)
    target_pace_sec_per_km: FiniteFloat | None

    @field_validator("target_pace_sec_per_km", mode="before")
    @classmethod
    def pace_rejects_boolean(cls, value):
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ValueError("targetPaceSecPerKm must be a JSON number")
        return value

    @model_validator(mode="after")
    def values_follow_shared_goal_contract(self):
        values = {
            "targetDistanceM": self.target_distance_m,
            "targetDurationSec": self.target_duration_sec,
            "targetPaceSecPerKm": self.target_pace_sec_per_km,
        }
        supplied = [(name, value) for name, value in values.items() if value is not None]
        if len(supplied) > 2:
            raise ValueError("거리·시간·페이스 목표는 최대 두 개까지 지정할 수 있습니다")
        if any(value <= 0 for _, value in supplied):
            raise ValueError("목표 값은 양수여야 합니다")
        if self.target_distance_m is not None and self.target_distance_m > 45000:
            raise ValueError("목표 거리는 45000m 이하여야 합니다")
        if self.target_duration_sec is not None:
            try:
                float(self.target_duration_sec)
            except OverflowError as exc:
                # The policy computes with floating point; reject values it cannot represent
                # at the request boundary instead of allowing a decision-time 500.
                raise ValueError("목표 시간이 계산 가능한 숫자 범위를 벗어났습니다") from exc
        pace = self.target_pace_sec_per_km
        if pace is not None and Decimal(str(pace)).as_tuple().exponent < -2:
            raise ValueError("목표 페이스는 소수 둘째 자리까지만 허용합니다")
        return self


class PlanSegment(CamelModel):
    start_m: float = Field(ge=0)
    end_m: float = Field(gt=0)
    ratio: float = Field(gt=0)

    @model_validator(mode="after")
    def ordered(self):
        if self.end_m <= self.start_m:
            raise ValueError("plan 구간 끝은 시작보다 커야 합니다")
        return self


class HrReferenceInput(CamelModel):
    hr_max_bpm: float | None
    rhr_bpm: float | None
    age_years: float = Field(gt=0)
    recent_peak_hr_bpm: float | None = None
    recent_run_count: int | None = Field(default=None, ge=0)


class LastCoaching(CamelModel):
    coaching_id: ServerId
    applied_at: datetime

    @field_validator("coaching_id", mode="before")
    @classmethod
    def server_coaching_id_is_int64(cls, value):
        return normalize_server_id(value)

    @field_validator("applied_at")
    @classmethod
    def applied_at_is_aware(cls, value):
        return _aware(value)

class BpmSample(CamelModel):
    """페이스가 일정한 구간 하나의 평균(백엔드가 만든다)."""
    speed_mps: float = Field(gt=0)
    cadence_spm: float = Field(gt=0)
    cue_bpm: float | None = None          # 그 구간에 켜져 있던 BPM. 큐를 껐으면 null


class BpmRecord(BpmSample):
    run_no: int = Field(ge=1)             # 사용자 러닝 순서(클수록 최근). 같은 러닝의 구간은 같은 값


class BpmInput(CamelModel):
    records: list[BpmRecord] = Field(default_factory=list, max_length=2000)   # 지난 러닝 구간
    first_minute: BpmSample | None = None  # 이번 러닝 첫 1분(처음 사용자 보정용). 아직 없으면 null

class DecideContext(CamelModel):
    session_id: ServerId
    state_version: int = Field(ge=0)
    run_state: Literal["RUNNING", "PAUSED"]
    mode: str = Field(min_length=1, max_length=40)
    goal: Goal
    goal_preference: FiniteFloat = 0.5
    plan: list[PlanSegment] | None = None
    anchor_pace_sec_per_km: float = Field(gt=0)
    current_guide_pace_sec_per_km: float | None = Field(default=None, gt=0)
    guide_pace_set_at: datetime | None = None
    active_sec: float = Field(ge=0)
    distance_m: float = Field(ge=0)
    route_progress_m: float | None = Field(default=None, ge=0)
    input_as_of: datetime
    # 이전 클라이언트 호환 입력. 값은 정책 기준 계산에 쓰지 않는다.
    hr_reference: HrReferenceInput | None = None
    last_coaching: LastCoaching | None = None
    resumed_at: datetime | None = None
    bpm: BpmInput | None = None   # 없으면 처음 사용자처럼 평균 직선으로 계산

    @field_validator("input_as_of", "guide_pace_set_at", "resumed_at")
    @classmethod
    def datetimes_are_aware(cls, value):
        return _aware(value)

    @field_validator("session_id", mode="before")
    @classmethod
    def server_session_id_is_int64(cls, value):
        return normalize_server_id(value)

    @field_validator("goal_preference", mode="before")
    @classmethod
    def public_goal_preference_is_v0(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value != 0.5:
            raise ValueError("goalPreference must be 0.5 for the v0 public API")
        return value


class Pacing(CamelModel):
    actual_minus_guide_sec_per_km: float | None = None
    eta_sec: float | None = None
    eta_minus_goal_sec: float | None = None
    # 선택 필드: 러닝 초반 계획 넘겨주기 단계. 기능이 꺼져 있으면 응답에 넣지 않는다(기존 JSON과 같음).
    handover_phase: Literal["PLAN_HOLD", "PLAN_BLEND", "MPC"] | None = None
    plan_weight: float | None = None
    hr_danger_bpm: float | None = None
    hr_sustain_bpm: float | None = None
    hr_threshold_source: Literal["POPULATION", "BLENDED", "PERSONAL"] | None = None
    hr_threshold_weight: float | None = None
    # S15P31E105-641 선택 필드: GRU 개인 g·b 비중(0~1)과 반영 러닝 수. 기능이 꺼져 있으면 응답에 넣지 않는다.
    gru_personal_weight: float | None = None
    gru_support_n: int | None = None
    # S15P31E105-676 선택 필드: 오늘 준비도 R, 허용 심박 감소 bpm(≥0), 개인 c 비중 w. 기능이 꺼져 있으면 넣지 않는다.
    readiness_score: float | None = None
    readiness_adjust_bpm: float | None = None
    readiness_weight: float | None = None

    @model_serializer(mode="wrap")
    def _omit_handover_when_off(self, handler):
        data = handler(self)
        for key in ("handover_phase", "handoverPhase", "plan_weight", "planWeight",
                    "hr_danger_bpm", "hrDangerBpm", "hr_sustain_bpm", "hrSustainBpm",
                    "hr_threshold_source", "hrThresholdSource", "hr_threshold_weight", "hrThresholdWeight",
                    "gru_personal_weight", "gruPersonalWeight", "gru_support_n", "gruSupportN",
                    "readiness_score", "readinessScore", "readiness_adjust_bpm", "readinessAdjustBpm",
                    "readiness_weight", "readinessWeight"):
            if key in data and data[key] is None:
                del data[key]
        return data


class DecideCandidate(Candidate):
    pace_sec_per_km: float = Field(gt=0)


class DecideRequest(PredictRequest):
    candidates: list[DecideCandidate]
    context: DecideContext
    include_forecast: bool = False

    @model_validator(mode="after")
    def candidate_order(self):
        # 그룹 페이스 AI10과 같은 후보 9개(S15P31E105-624).
        if len(self.candidates) != len(CANDIDATE_DELTAS):
            raise ValueError(f"후보는 정확히 {len(CANDIDATE_DELTAS)}개여야 합니다")
        if any(abs((c.pace_sec_per_km - self.context.anchor_pace_sec_per_km) - d) > 0.01
               for c, d in zip(self.candidates, CANDIDATE_DELTAS)):
            raise ValueError("후보는 기준 pace 대비 −30, −20, −10, 0, +10, +20, +30, +45, +60초/km 순서여야 합니다")
        return self


class Decision(CamelModel):
    action: Literal["GUIDE_PACE", "EASE_OFF", "NOT_RUNNING"]
    chosen_index: int | None
    recommended_pace_sec_per_km: float
    cue_bpm: int | None = Field(default=None, ge=60, le=220)
    predicted_hr_30_bpm: float | None = None
    predicted_hr_60_bpm: float | None = None
    predicted_hr_120_bpm: float | None = None
    route_progress_m: float | None = None
    based_on_state_version: int
    expires_at: datetime
    reason: str | None = None
    reason_text: str | None = None
    # 코칭 단계(S15P31E105-504): OK 막지 않음 · CAUTION 안내 페이스로 복귀 · DANGER 위험 감속. 없어도 되는 칸이다.
    coaching_level: Literal["OK", "CAUTION", "DANGER"] | None = None

    @field_validator("expires_at")
    @classmethod
    def expiry_is_aware(cls, value):
        return _aware(value)


class CandidateResult(CamelModel):
    pace_sec_per_km: float
    pred_hr_bpm: list[float]
    upper_hr_bpm: list[float | None]
    passed: bool
    reject_reason: str | None = None
    score: float | None = None


class DecideResponse(CamelModel):
    trace_id: str | None = None
    model_version: str
    policy_version: str
    status: str
    gate: str | None = None
    publish_suggested: bool
    decision: Decision | None = None
    candidates: list[CandidateResult]
    pacing: Pacing | None = None
    warnings: list[str] = Field(default_factory=list)
    forecast: dict | None = None
    hr_personalized: bool | None = None
    hr_personalization_version: int | None = None

    @model_serializer(mode="wrap")
    def _omit_personalization_when_unused(self, handler):
        data = handler(self)
        if self.hr_personalized is None:
            data.pop("hr_personalized", None)
            data.pop("hrPersonalized", None)
            data.pop("hr_personalization_version", None)
            data.pop("hrPersonalizationVersion", None)
        return data

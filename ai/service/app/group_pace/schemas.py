"""AI10 요청·응답. 심박 기록 형식은 AI03·AI04와 공유한다."""
from datetime import timezone
from typing import Literal

from pydantic import AwareDatetime, Field, StrictBool, field_validator, model_validator

from app.id_types import ServerId, normalize_server_id
from app.schemas import CamelModel, Candidate, History


class LastChange(CamelModel):
    direction: Literal["SLOW", "FAST"]
    changed_at: AwareDatetime

    @field_validator("changed_at")
    @classmethod
    def to_utc(cls, value):
        return value.astimezone(timezone.utc)


class GroupParticipant(CamelModel):
    user_id: ServerId | None = None
    active: StrictBool
    history: History
    future_grade_pct: list[float | None] | None = None

    @field_validator("user_id", mode="before")
    @classmethod
    def server_id(cls, value):
        return None if value is None else normalize_server_id(value)

    @field_validator("future_grade_pct")
    @classmethod
    def future_grade(cls, values):
        return Candidate.grade_ok(values)


class GroupPaceRequest(CamelModel):
    group_run_id: ServerId
    current_group_pace_sec_per_km: float = Field(gt=0, allow_inf_nan=False)
    goal_pace_sec_per_km: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    start_recommended_pace_sec_per_km: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    elapsed_sec: float = Field(ge=0, allow_inf_nan=False)
    progress_ratio: float | None = Field(default=None, allow_inf_nan=False)
    now: AwareDatetime
    last_change: LastChange | None = None
    participants: list[GroupParticipant] = Field(min_length=1)
    # S15P31E105-680: GOAL은 목표 페이스를 유지하고 위험 심박일 때만 늦춘다. 없으면 TOGETHER(기존 동작과 같다).
    pace_mode: Literal["TOGETHER", "GOAL"] = "TOGETHER"

    @field_validator("progress_ratio")
    @classmethod
    def clamp_progress(cls, value):
        return None if value is None else min(1.0, max(0.0, value))

    @field_validator("group_run_id", mode="before")
    @classmethod
    def server_id(cls, value):
        return normalize_server_id(value)

    @field_validator("now")
    @classmethod
    def to_utc(cls, value):
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def change_not_in_future(self):
        if self.last_change is not None and self.last_change.changed_at > self.now:
            raise ValueError("lastChange.changedAt은 now 이후일 수 없습니다")
        return self


class GroupPaceResponse(CamelModel):
    group_pace_sec_per_km: float
    changed: bool
    direction: Literal["SLOW", "FAST", "HOLD"]
    reason: Literal["HR_LIMIT", "RECOVERED", "COOLDOWN", "WARMUP_CAP", "FLOOR", "SMALL_CHANGE", "NO_DATA"]
    struggling_count: int
    excluded_count: int
    pace_only_count: int
    warnings: list[str]
    model_version: str

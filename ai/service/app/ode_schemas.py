"""AI05/AI06 request validation schemas."""
from datetime import datetime

from pydantic import Field, FiniteFloat, field_validator, model_validator

from app.schemas import CamelModel
from app.id_types import ServerId, normalize_server_id

MAX_PUBLIC_GRADE_PROFILE_SEGMENTS = 450


class PlanGradeSegment(CamelModel):
    start_distance_m: FiniteFloat = Field(ge=0)
    end_distance_m: FiniteFloat = Field(gt=0)
    grade_percent: FiniteFloat
    base_pace_ratio: FiniteFloat | None = Field(default=None, gt=0)

    @field_validator("start_distance_m", "end_distance_m", "grade_percent", "base_pace_ratio", mode="before")
    @classmethod
    def numeric_fields_reject_boolean(cls, value):
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ValueError("field must be a JSON number")
        return value

    @model_validator(mode="after")
    def ordered(self):
        if self.end_distance_m <= self.start_distance_m:
            raise ValueError("endDistanceM must be greater than startDistanceM")
        return self


class PlanRequest(CamelModel):
    course_id: ServerId | None = None
    grade_profile: list[PlanGradeSegment] | None = Field(default=None, max_length=MAX_PUBLIC_GRADE_PROFILE_SEGMENTS)
    target_distance_m: int | None = Field(default=None, strict=True)
    target_duration_sec: int | None = Field(default=None, strict=True)
    target_pace_sec_per_km: FiniteFloat | None = None
    average_pace_sec_per_km: FiniteFloat | None = Field(default=None, gt=0)
    goal_preference: FiniteFloat = 0.5
    user_id: ServerId | None = None
    personalization: dict | None = None
    support_start_hr_median_bpm: FiniteFloat | None = Field(default=None, ge=35, le=220)

    model_config = {"extra": "forbid", **CamelModel.model_config}

    @field_validator("course_id", "user_id", mode="before")
    @classmethod
    def server_ids_are_int64(cls, value):
        return None if value is None else normalize_server_id(value)

    @field_validator("target_pace_sec_per_km", "average_pace_sec_per_km", "support_start_hr_median_bpm",
                     mode="before")
    @classmethod
    def numeric_fields_reject_boolean(cls, value):
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ValueError("field must be a JSON number")
        return value

    @field_validator("goal_preference", mode="before")
    @classmethod
    def public_goal_preference_is_v0(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value != 0.5:
            raise ValueError("goalPreference must be 0.5 for the v0 public API")
        return value


class SupportSample(CamelModel):
    elapsed_sec: FiniteFloat = Field(ge=0)
    hr_bpm: FiniteFloat | None = Field(default=None, ge=30, le=240)
    speed_mps: FiniteFloat | None = Field(default=None, ge=0, le=15)
    grade_percent: FiniteFloat | None = Field(default=None, ge=-60, le=60)
    hr_quality: str = "GOOD"
    speed_quality: str = "GOOD"
    grade_quality: str = "GOOD"
    hr_is_filled: bool = False

    @field_validator("elapsed_sec", "hr_bpm", "speed_mps", "grade_percent", mode="before")
    @classmethod
    def numeric_fields_reject_boolean(cls, value):
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise ValueError("field must be a JSON number")
        return value

    @field_validator("hr_quality", "speed_quality", "grade_quality")
    @classmethod
    def quality_allowed(cls, value):
        if value not in {"GOOD", "LOW", "MISSING"}:
            raise ValueError("quality must be GOOD, LOW, or MISSING")
        return value


class SupportSession(CamelModel):
    session_id: ServerId
    session_started_at: datetime
    workout_quality: str = "CLEAN"
    samples: list[SupportSample] = Field(min_length=25, max_length=1441)

    @field_validator("session_started_at")
    @classmethod
    def timestamp_is_aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("sessionStartedAt must be UTC ISO 8601 with timezone")
        return value

    @field_validator("session_id", mode="before")
    @classmethod
    def server_session_id_is_int64(cls, value):
        return normalize_server_id(value)

    @field_validator("workout_quality")
    @classmethod
    def workout_quality_allowed(cls, value):
        if value not in {"CLEAN", "USABLE_WITH_FLAGS", "UNUSABLE"}:
            raise ValueError("workoutQuality is invalid")
        return value


class PersonalizeRequest(CamelModel):
    user_id: ServerId
    sessions: list[SupportSession] = Field(min_length=1, max_length=50)

    @field_validator("user_id", mode="before")
    @classmethod
    def server_user_id_is_int64(cls, value):
        return normalize_server_id(value)

"""요청·응답 형식. JSON 필드는 백엔드 API 명세처럼 camelCase이고 단위를 이름에 붙인다."""
import math
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer, model_validator
from pydantic.alias_generators import to_camel

from app.models.base import FUTURE_STEPS, HORIZONS_SEC, STEP_SEC
from app.id_types import ServerId, normalize_server_id

MAX_HISTORY = 1440   # 5초 × 1440 = 2시간
MAX_CANDIDATES = 20


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


def _check_finite(values, name, nullable=True):
    for v in values:
        if v is None:
            if not nullable:
                raise ValueError(f"{name}에 null을 넣을 수 없습니다")
        elif not math.isfinite(v):
            raise ValueError(f"{name}에 유한한 숫자만 넣을 수 있습니다")
    return values


class History(CamelModel):
    """러닝 시작(또는 최근 일부)부터 t0까지 5초 간격 기록. 마지막 칸이 t0. 측정 못 한 칸은 null."""
    hr_bpm: list[float | None] = Field(min_length=1, max_length=MAX_HISTORY)
    speed_mps: list[float | None] = Field(min_length=1, max_length=MAX_HISTORY)
    grade_pct: list[float | None] = Field(min_length=1, max_length=MAX_HISTORY)
    segment_id: list[int] | None = Field(default=None, description="칸별 구간 번호. 주면 t0와 같은 구간만 쓴다")

    @field_validator("hr_bpm", "speed_mps", "grade_pct")
    @classmethod
    def finite(cls, values, info):
        return _check_finite(values, info.field_name)

    @model_validator(mode="after")
    def same_length(self):
        n = len(self.hr_bpm)
        lengths = [len(self.speed_mps), len(self.grade_pct)] + ([len(self.segment_id)] if self.segment_id is not None else [])
        if any(m != n for m in lengths):
            raise ValueError("history의 hrBpm·speedMps·gradePct·segmentId 길이가 같아야 합니다")
        if any(v is not None and v <= 0 for v in self.hr_bpm):
            raise ValueError("hrBpm은 0보다 커야 합니다")
        if any(v is not None and v < 0 for v in self.speed_mps):
            raise ValueError("speedMps는 0 이상이어야 합니다")
        return self


class Candidate(CamelModel):
    """pace 후보 하나의 t0+5초 ~ t0+120초 계획 (24칸)."""
    future_speed_mps: list[float] = Field(min_length=FUTURE_STEPS, max_length=FUTURE_STEPS)
    future_grade_pct: list[float | None] | None = Field(
        default=None, description="모르면 null(자유러닝). 빈 칸이 하나라도 있어도 모름으로 본다")

    @field_validator("future_speed_mps")
    @classmethod
    def speed_ok(cls, values):
        _check_finite(values, "futureSpeedMps", nullable=False)
        if any(v < 0 for v in values):
            raise ValueError("futureSpeedMps는 0 이상이어야 합니다")
        return values

    @field_validator("future_grade_pct")
    @classmethod
    def grade_ok(cls, values):
        if values is not None:
            if len(values) != FUTURE_STEPS:
                raise ValueError(f"futureGradePct는 {FUTURE_STEPS}칸이어야 합니다")
            _check_finite(values, "futureGradePct")
        return values

    @property
    def grade_known(self) -> bool:
        return self.future_grade_pct is not None and all(v is not None for v in self.future_grade_pct)


class PredictRequest(CamelModel):
    elapsed_sec: float = Field(ge=0, description="t0의 러닝 시작 후 경과 시간(초)")
    session_started_at: datetime | None = Field(default=None, description="러닝 시작 시각(UTC). 개인화 모델용, GRU는 쓰지 않음")
    user_id: ServerId | None = Field(default=None, description="선택: 러닝 중 GRU 개인화 조회에 쓰는 회원 ID")
    history: History
    candidates: list[Candidate] = Field(min_length=1, max_length=MAX_CANDIDATES)

    @field_validator("user_id", mode="before")
    @classmethod
    def server_user_id_is_int64(cls, value):
        return None if value is None else normalize_server_id(value)


class Prediction(CamelModel):
    hr_bpm: list[float] = Field(description="[HR@30, HR@60, HR@120] 절대 심박(bpm)")
    future_grade_used: bool = Field(description="미래 경사를 읽은 모델로 예측했는지 (false면 경사 모름 모델)")


class PredictResponse(CamelModel):
    model_version: str
    horizons_sec: list[int] = list(HORIZONS_SEC)
    predictions: list[Prediction]
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


class ModelInfoResponse(CamelModel):
    model_type: str
    model_version: str
    step_sec: int = STEP_SEC
    window_sec: int
    future_steps: int = FUTURE_STEPS
    horizons_sec: list[int] = list(HORIZONS_SEC)
    required_metrics: list[str]
    min_samples: int
    missing_policy: dict[str, str]
    policy_version: str | None = None
    models: dict[str, dict] = Field(default_factory=dict)


class HealthResponse(CamelModel):
    status: str
    model_loaded: bool
    model_version: str | None = None
    models: dict[str, dict] = Field(default_factory=dict)
    components: dict[str, object] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict | None = None

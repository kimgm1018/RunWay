"""W07 배치의 시연용 검증과 payloadHash 계산."""
import hashlib
import json
import math
import re
import uuid
from decimal import Decimal
from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.inference import ApiError

MAX_BODY_BYTES = 32768


class W07Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("시각에는 시간대가 있어야 합니다")
    return value


class MetricSample(W07Model):
    type: Literal["METRIC_SAMPLE"]
    measuredAt: datetime
    elapsedDurationSec: int = Field(ge=0)
    heartRateBpm: float | None = Field(gt=0)
    cadenceSpm: float | None = Field(ge=0)
    speedMps: float | None = Field(ge=0)
    gradePercent: float | None
    totalDistanceM: float | None = Field(ge=0)
    routeProgressM: float | None = Field(ge=0)
    isHrMeasured: bool

    @field_validator("measuredAt")
    @classmethod
    def measured_at_is_aware(cls, value):
        return _aware(value)

    @model_validator(mode="after")
    def metrics_valid(self):
        if self.isHrMeasured and self.heartRateBpm is None:
            raise ValueError("isHrMeasured가 true이면 heartRateBpm이 필요합니다")
        if not self.isHrMeasured and self.heartRateBpm is not None:
            raise ValueError("isHrMeasured가 false이면 heartRateBpm은 null이어야 합니다")
        values = (self.heartRateBpm, self.cadenceSpm, self.speedMps, self.gradePercent,
                  self.totalDistanceM, self.routeProgressM)
        if not any(value is not None for value in values):
            raise ValueError("측정값이 하나 이상 필요합니다")
        if any(value is not None and not math.isfinite(value) for value in values):
            raise ValueError("측정값은 유한한 숫자여야 합니다")
        return self


class GpsPoint(W07Model):
    type: Literal["GPS_POINT"]
    measuredAt: datetime
    coordinates: tuple[float, float]
    accuracyM: float | None = Field(ge=0)
    altitudeM: float | None

    @field_validator("measuredAt")
    @classmethod
    def measured_at_is_aware(cls, value):
        return _aware(value)

    @field_validator("coordinates")
    @classmethod
    def coordinates_valid(cls, value):
        if not (-180 <= value[0] <= 180 and -90 <= value[1] <= 90):
            raise ValueError("coordinates 범위가 올바르지 않습니다")
        return value

    @field_validator("altitudeM", "accuracyM")
    @classmethod
    def finite_optional(cls, value):
        if value is not None and not math.isfinite(value):
            raise ValueError("측정값은 유한한 숫자여야 합니다")
        return value


BatchItem = Annotated[Union[MetricSample, GpsPoint], Field(discriminator="type")]


class W07Batch(W07Model):
    id: str
    deviceId: int = Field(gt=0)
    sessionId: int = Field(gt=0)
    schemaVersion: Literal["1"]
    payloadHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    items: list[BatchItem] = Field(min_length=1)

    @field_validator("id")
    @classmethod
    def uuid_v4(cls, value):
        try:
            parsed = uuid.UUID(value)
        except (ValueError, AttributeError) as exc:
            raise ValueError("id는 UUID v4여야 합니다") from exc
        if parsed.version != 4 or not re.fullmatch(r"[0-9a-fA-F-]{36}", value):
            raise ValueError("id는 UUID v4여야 합니다")
        return value


def _number(value) -> str:
    if isinstance(value, bool):
        raise ValueError("불리언은 숫자로 쓸 수 없습니다")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("숫자는 유한해야 합니다")
        if value == 0:
            return "0"
        if value.is_integer() and abs(value) < 1e21:
            return str(int(value))
        if 1e-6 <= abs(value) < 1e21:
            text = repr(value)
            return format(Decimal(text), "f") if "e" in text.lower() else text
        raise ValueError("숫자 크기가 JCS 시연 입력 범위를 벗어났습니다")
    raise TypeError("지원하지 않는 JSON 숫자입니다")


def _jcs(value) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(_jcs(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be"))
        if any(not isinstance(key, str) for key in keys):
            raise ValueError("JSON 객체 키는 문자열이어야 합니다")
        return "{" + ",".join(_jcs(key) + ":" + _jcs(value[key]) for key in keys) + "}"
    raise TypeError("지원하지 않는 JSON 값입니다")


def jcs_bytes(value) -> bytes:
    return _jcs(value).encode("utf-8")


def payload_hash(raw: dict) -> str:
    projected = {key: value for key, value in raw.items() if key != "payloadHash"}
    projected["deviceId"] = str(int(projected["deviceId"]))
    projected["sessionId"] = str(int(projected["sessionId"]))
    return hashlib.sha256(jcs_bytes(projected)).hexdigest()


def parse_batch(raw: bytes, *, skip_hash_device_ids: frozenset[int]) -> W07Batch:
    if len(raw) > MAX_BODY_BYTES:
        raise ApiError(413, "FILE_TOO_LARGE", "요청 본문이 허용 크기를 넘었습니다.")
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError):
        raise ApiError(400, "VALIDATION_ERROR", "요청 값이 유효하지 않습니다.",
                       [{"name": "body", "reason": "JSON 형식이 올바르지 않습니다"}]) from None
    try:
        batch = W07Batch.model_validate(value)
    except ValidationError as exc:
        errors = exc.errors()
        invalid_shape = any(error["type"] in {"missing", "json_invalid"}
                            or error["type"].endswith(("_type", "_parsing")) for error in errors)
        status, code = (400, "VALIDATION_ERROR") if invalid_shape else (422, "INVALID_BATCH")
        fields = [{"name": ".".join(str(part) for part in error["loc"]),
                   "reason": error["msg"].removeprefix("Value error, ")} for error in errors]
        raise ApiError(status, code, "요청 값이 유효하지 않습니다." if status == 400 else "배치가 유효하지 않습니다.", fields) from None
    if batch.deviceId not in skip_hash_device_ids and payload_hash(value) != batch.payloadHash:
        raise ApiError(422, "INVALID_BATCH", "payloadHash가 일치하지 않습니다.",
                       [{"name": "payloadHash", "reason": "본문 해시가 일치하지 않습니다"}])
    return batch

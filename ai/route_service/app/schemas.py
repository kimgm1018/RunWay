"""요청 형식. 입력 문서 reports/route_api_input_spec/ROUTE_REQUEST_INPUTS.md(2026-11-04 확정)와
BE Route 내부 계약(MR !183)을 따른다.

여기서 막는 것(400 VALIDATION_ERROR): 필수값, 타입, 유한수, 위도 -90~90·경도 -180~180, shape 값, seed 범위,
filters의 모르는 key. 거리 1~15 km·편도 도착 위치는 데모와 같은 코드(422 DISTANCE_RANGE / DESTINATION_REQUIRED)로
main.py가 검사한다. 최상위의 모르는 필드는 무시한다.
"""
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Filters(BaseModel):
    """켜면 그 조건을 반영(강도 5), 끄면 고려하지 않는다(반대 뜻 아님). 난이도는 flat 하나뿐이다. 모르는 key는 400."""
    model_config = ConfigDict(extra="forbid")

    river: bool = False
    beach: bool = False
    park: bool = False
    trail: bool = False
    pedestrian: bool = False
    avoid_major_road: bool = False
    avoid_steps: bool = False
    avoid_tunnel: bool = False
    flat: bool = False


class RecommendRequest(BaseModel):
    # 필드 순서는 Gate 검토 로그의 request 기록 순서다(데모와 같게 유지).
    model_config = ConfigDict(allow_inf_nan=False)

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    distance_km: float
    filters: Filters = Field(default_factory=Filters)
    seed: int = Field(1, ge=1, le=10_000_000)
    shape: Literal["loop", "out_and_back", "point_to_point"] = "loop"
    end_lat: Optional[float] = Field(None, ge=-90, le=90)     # point_to_point일 때만 필수
    end_lon: Optional[float] = Field(None, ge=-180, le=180)

"""요청 형식. 입력 문서 reports/route_api_input_spec/ROUTE_REQUEST_INPUTS.md(2026-11-04 확정)와
BE Route 내부 계약(MR !183)을 따른다.

여기서 막는 것(400 VALIDATION_ERROR): 필수값, 타입, 유한수, 위도 -90~90·경도 -180~180, shape 값, seed 범위,
filters의 모르는 key. 거리 1~21.1 km·편도 도착 위치는 데모와 같은 코드(422 DISTANCE_RANGE / DESTINATION_REQUIRED)로
main.py가 검사한다. 최상위의 모르는 필드는 무시한다.
"""
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

SEED_MAX = 10_000_000   # seed 허용 상한. next_seed는 이를 넘으면 1부터 다시 센다(app/main.py next_seed)


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
    seed: int = Field(1, ge=1, le=SEED_MAX)
    shape: Literal["loop", "out_and_back", "point_to_point"] = "loop"
    end_lat: Optional[float] = Field(None, ge=-90, le=90)     # point_to_point일 때만 필수
    end_lon: Optional[float] = Field(None, ge=-180, le=180)


class BasemapRequest(BaseModel):
    """POST /internal/v1/basemaps 요청(S15P31E105-612). bbox = [west, south, east, north] WGS84.
    형식·범위·순서·한 변 8 km 초과·경도 또는 위도 폭 1도 초과는 400 VALIDATION_ERROR다(main.py validation handler,
    추천과 같은 400). 모르는 필드는 무시한다."""
    bbox: list[Annotated[float, Field(strict=True, allow_inf_nan=False)]] = Field(min_length=4, max_length=4)
    # "thumb"(기본, 99개 썸네일 바탕) | "full"(서버 렌더 평면 PNG 썸네일용: 보행로·건물까지). 다른 값·타입은 400.
    detail: Literal["thumb", "full"] = "thumb"
    # 선택. 그림 1 px가 덮는 땅(m), 0 초과 100(basemap.MAX_METERS_PER_PIXEL) 이하. full에서만 쓰고(축척 단계·단순화),
    # 없으면 bbox 가로 / 600. thumb에서는 범위만 검사하고 무시한다. 숫자가 아닌 값(문자열·bool)·NaN·무한대는 400.
    meters_per_pixel: Annotated[float, Field(strict=True, allow_inf_nan=False, gt=0, le=100)] | None = None

    @field_validator("bbox")
    @classmethod
    def _check_bbox(cls, v: list[float]) -> list[float]:
        from .basemap import MAX_SIDE_M, MAX_SPAN_DEG, side_lengths_m
        w, s, e, n = v
        if not (-180 <= w <= 180 and -180 <= e <= 180 and -90 <= s <= 90 and -90 <= n <= 90):
            raise ValueError("lon must be -180..180 and lat -90..90")
        if not (w < e and s < n):
            raise ValueError("west < east and south < north required")
        # 경도 폭이 큰 bbox(예: -180~180)는 haversine 가로가 각도 차를 360도 주기로 접어 작게 재므로 m 상한보다 먼저 막는다.
        if e - w > MAX_SPAN_DEG or n - s > MAX_SPAN_DEG:
            raise ValueError(f"lon and lat span must each be <= {MAX_SPAN_DEG:g} degree")
        if max(side_lengths_m(v)) > MAX_SIDE_M:
            raise ValueError(f"each side must be <= {MAX_SIDE_M:g} m")
        return v

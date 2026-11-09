import math
import time
from dataclasses import dataclass


CAP_M = 20000
MARGIN_M = 1000
# 한국 안에서 32652 -> 5179 거리 차이를 여유 있게 감싼다.
PROJECTION_SCALE = 1.002
APP_MAX_M = 21100  # 하프 마라톤 21.1 km, shape_config.json:4. pipeline 생성 때 다시 확인한다.
MAX_END_SNAP_M = 250  # ug-v2 PE1, snap.py:169-182
SNAP_ALLOWANCE_M = 500  # 최악값이 아니다. 부족하면 엔진 검사 후 기존 창으로 재실행한다.


def working_radius_m(target_m):
    return 0.55 * target_m + 250


def half_size_m(shape, target_m, end=None):
    """요청 중심 반쪽 길이(m), 1 km 올림, 상한 20 km.

    end는 위경도가 아니라 출발점 기준 EPSG:5179 (dx_m, dy_m)다.
    P2P에서 end를 모르면 보수적으로 20 km를 쓴다.
    상한에 걸리면 모든 영역을 포함한다는 뜻은 아니다: 기존 창으로 돌아간다.
    """
    shape = str(shape).lower()
    if shape not in ('loop', 'out_and_back', 'point_to_point'):
        raise ValueError('알 수 없는 shape')
    target_m = float(target_m)
    if not math.isfinite(target_m) or target_m <= 0:
        raise ValueError('target_m은 양의 유한수여야 한다')
    radius = working_radius_m(target_m)
    if shape == 'point_to_point':
        if end is None:
            return CAP_M
        dx, dy = map(float, end)
        if not all(map(math.isfinite, (dx, dy))):
            raise ValueError('end 오프셋은 유한수여야 한다')
        # 원시 중점 중심. 원과 두 입력점 주변 환경 조회 범위를 함께 담는다.
        need = max(max(working_radius_m(APP_MAX_M), radius) + MARGIN_M + SNAP_ALLOWANCE_M,
                   max(abs(dx), abs(dy)) / 2 + MARGIN_M)
        return min(CAP_M, math.ceil(need / 1000) * 1000)
    return min(CAP_M, math.ceil((radius * PROJECTION_SCALE + MARGIN_M) / 1000) * 1000)


def window_geometry(start, shape, target_m, end=None):
    """EPSG:5179 중심과 반쪽 길이. end는 출발점에 대한 오프셋이다."""
    half = half_size_m(shape, target_m, end)
    x, y = start
    if str(shape).lower() == 'point_to_point' and end is not None:
        x, y = x + float(end[0])/2, y + float(end[1])/2
    return (x, y), half


def outside_extract(out):
    return any(issue.get('code') == 'OUTSIDE_CANONICAL_EXTRACT'
               for issue in out.get('issues', []))


@dataclass(frozen=True)
class WindowSpec:
    centre: tuple
    half: int
    anchor: tuple
    small: bool

    @property
    def bounds(self):
        x, y = self.centre
        return x-self.half, y-self.half, x+self.half, y+self.half

    @property
    def key(self):
        # polygon도 입력의 일부이므로 셀 번호만으로 캐시하지 않는다.
        return self.bounds

    def anchor_spec(self):
        return WindowSpec(self.anchor, CAP_M, self.anchor, False)


def window_spec(start, shape, target_m, end=None, *, anchor=False):
    x, y = start
    if str(shape).lower() == 'point_to_point' and end is not None:
        # 607: 편도 기준 칸은 출발점이 아니라 출발·도착 중점의 5 km 칸이다. 21.1 km 상한에서는 도착점이
        # 출발점에서 직선 23.7 km까지 떨어질 수 있어, 출발점 기준 ±20 km 창으로는 끝점과 d_min 원을 담지 못한다.
        x, y = x + float(end[0])/2, y + float(end[1])/2
    base = (math.floor((x-700000)/5000)*5000+702500,
            math.floor((y-1300000)/5000)*5000+1302500)
    centre, half = window_geometry(start, shape, target_m, end)
    fallback = (anchor or half == CAP_M or abs(centre[0]-base[0])+half > CAP_M
                or abs(centre[1]-base[1])+half > CAP_M)
    return WindowSpec(base if fallback else centre, CAP_M if fallback else half, base, not fallback)



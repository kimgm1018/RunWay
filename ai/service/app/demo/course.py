"""코스 좌표와 고도 단면에서 거리별 경사·위치를 계산한다."""
import bisect
import json
import math
from dataclasses import dataclass
from pathlib import Path

GRADE_HALF_WINDOW_M = 25.0
EARTH_RADIUS_M = 6_371_000.0


@dataclass(frozen=True)
class CourseProfile:
    distances_m: tuple[float, ...]
    elevations_m: tuple[float, ...]
    lons: tuple[float, ...]
    lats: tuple[float, ...]

    def __post_init__(self):
        sizes = {len(self.distances_m), len(self.elevations_m), len(self.lons), len(self.lats)}
        if len(sizes) != 1 or len(self.distances_m) < 2:
            raise ValueError("코스 배열은 길이가 같고 점이 2개 이상이어야 합니다")
        if self.distances_m[0] != 0 or any(b < a for a, b in zip(self.distances_m, self.distances_m[1:])):
            raise ValueError("코스 누적 거리는 0부터 오름차순이어야 합니다")

    @property
    def length_m(self) -> float:
        return self.distances_m[-1]

    def _segment(self, distance: float) -> tuple[int, float]:
        d = min(self.length_m, max(0.0, distance))
        i = min(len(self.distances_m) - 2, max(0, bisect.bisect_right(self.distances_m, d) - 1))
        span = self.distances_m[i + 1] - self.distances_m[i]
        fraction = (d - self.distances_m[i]) / span if span > 0 else 0.0
        return i, fraction

    def elevation_at(self, d: float) -> float:
        i, f = self._segment(d)
        return self.elevations_m[i] + f * (self.elevations_m[i + 1] - self.elevations_m[i])

    def grade_at(self, d: float) -> float:
        d = min(self.length_m, max(0.0, d))          # 코스 밖이면 끝값에서 멈춘다(리뷰 초점 3)
        lo = max(0.0, d - GRADE_HALF_WINDOW_M)
        hi = min(self.length_m, d + GRADE_HALF_WINDOW_M)
        span = hi - lo
        return 0.0 if span < 1.0 else (self.elevation_at(hi) - self.elevation_at(lo)) / span * 100.0

    def position_at(self, d: float) -> tuple[float, float]:
        i, f = self._segment(d)
        return (self.lons[i] + f * (self.lons[i + 1] - self.lons[i]),
                self.lats[i] + f * (self.lats[i + 1] - self.lats[i]))

    def summary(self, max_points: int = 500) -> dict:
        count = len(self.distances_m)
        if count <= max_points:
            indices = list(range(count))
        else:
            indices = sorted({round(i * (count - 1) / (max_points - 1)) for i in range(max_points)})
        points = [[self.lons[i], self.lats[i], self.elevations_m[i], self.distances_m[i]] for i in indices]
        return {"lengthM": self.length_m, "points": points}


def _haversine(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def load_course(path: Path) -> CourseProfile:
    raw = json.loads(path.read_text(encoding="utf-8"))
    points = raw.get("points") if isinstance(raw, dict) else None
    if not isinstance(points, list) or len(points) < 2:
        raise ValueError("코스는 점이 2개 이상이어야 합니다")
    lons, lats, elevs = [], [], []
    for point in points:
        lon, lat, elevation = float(point["lon"]), float(point["lat"]), float(point["elevationM"])
        if not (-180 <= lon <= 180 and -90 <= lat <= 90) or not all(map(math.isfinite, (lon, lat, elevation))):
            raise ValueError("코스 좌표·고도 값이 올바르지 않습니다")
        lons.append(lon); lats.append(lat); elevs.append(elevation)
    distances = [0.0]
    for i in range(1, len(points)):
        distances.append(distances[-1] + _haversine(lons[i - 1], lats[i - 1], lons[i], lats[i]))
    return CourseProfile(tuple(distances), tuple(elevs), tuple(lons), tuple(lats))

"""모델별 잔차 여유 표를 읽고 방향·경사별 상한을 조회한다."""
import json
import math
from dataclasses import dataclass
from pathlib import Path

ACCEL_AT_LEAST_MPS = 0.15
DECEL_AT_MOST_MPS = -0.15
UP_ABOVE_PCT = 2.0
DOWN_BELOW_PCT = -2.0
HORIZONS = (30, 60, 120)
DIRECTIONS = ("ACCEL", "HOLD", "DECEL")
GRADES = ("UP", "FLAT", "DOWN")


@dataclass(frozen=True)
class MarginTable:
    version: str
    model: str
    personalization: str
    quantile: str
    margins: dict[tuple[int, str, str], float]

    @staticmethod
    def direction_of(dspeed_mps: float | None) -> str | None:
        if dspeed_mps is None:
            return None
        if dspeed_mps >= ACCEL_AT_LEAST_MPS:
            return "ACCEL"
        if dspeed_mps <= DECEL_AT_MOST_MPS:
            return "DECEL"
        return "HOLD"

    @staticmethod
    def grade_of(mean_grade_pct: float | None) -> str | None:
        if mean_grade_pct is None:
            return None
        if mean_grade_pct > UP_ABOVE_PCT:
            return "UP"
        if mean_grade_pct < DOWN_BELOW_PCT:
            return "DOWN"
        return "FLAT"

    def margin(self, h_sec: int, dspeed_mps: float | None, mean_grade_pct: float | None) -> float:
        if h_sec not in HORIZONS:
            raise ValueError("horizon은 30, 60, 120초 중 하나여야 합니다")
        direction = self.direction_of(dspeed_mps)
        grade = self.grade_of(mean_grade_pct)
        values = [v for (h, d, g), v in self.margins.items()
                  if h == h_sec and (direction is None or d == direction) and (grade is None or g == grade)]
        if not values:
            raise ValueError("여유 표 셀이 없습니다")
        return max(values) if direction is None or grade is None else values[0]


def load_margin_table(path: Path) -> MarginTable:
    if not path.is_file():
        raise FileNotFoundError(path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    direction = raw.get("direction", {})
    grade = raw.get("grade", {})
    expected = (ACCEL_AT_LEAST_MPS, DECEL_AT_MOST_MPS, UP_ABOVE_PCT, DOWN_BELOW_PCT)
    actual = (direction.get("accelAtLeastMps"), direction.get("decelAtMostMps"),
              grade.get("upAbovePct"), grade.get("downBelowPct"))
    if actual != expected:
        raise ValueError("여유 표 분류 기준이 현재 정책과 다릅니다")
    nested = raw.get("marginsBpm")
    if not isinstance(nested, dict):
        raise ValueError("marginsBpm이 없습니다")
    margins: dict[tuple[int, str, str], float] = {}
    try:
        for h in HORIZONS:
            for d in DIRECTIONS:
                for g in GRADES:
                    value = nested[str(h)][d][g]
                    number = float(value)
                    if not math.isfinite(number):
                        raise ValueError("여유 표 값은 유한해야 합니다")
                    margins[(h, d, g)] = number
    except (KeyError, TypeError) as exc:
        raise ValueError("여유 표는 27개 셀을 모두 가져야 합니다") from exc
    if len(margins) != 27:
        raise ValueError("여유 표는 27개 셀을 모두 가져야 합니다")
    return MarginTable(str(raw["version"]), str(raw["model"]), str(raw["personalization"]),
                       str(raw["quantile"]), margins)

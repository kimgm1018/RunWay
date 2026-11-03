"""측정 샘플을 시각별 5초 history로 병합한다."""
import math
from dataclasses import dataclass
from datetime import datetime
from collections.abc import Sequence

from app.demo.course import CourseProfile
from app.demo.w07 import MetricSample

STEP_SEC = 5


@dataclass(frozen=True)
class InletInputs:
    elapsed_sec: float
    history: dict
    input_as_of: datetime
    distance_m: float
    route_progress_m: float | None
    actual_pace_60s_sec_per_km: float | None
    grade_source: str
    data_now: datetime


@dataclass(frozen=True)
class Insufficient:
    reason: str


class SessionSamples:
    def __init__(self):
        self._values: dict[tuple[datetime, str], tuple[int, float]] = {}

    @staticmethod
    def _cell(elapsed_sec: int) -> int:
        return 0 if elapsed_sec == 0 else math.ceil(elapsed_sec / STEP_SEC)

    def add(self, items: Sequence[MetricSample]) -> None:
        for item in items:
            cell = self._cell(item.elapsedDurationSec)
            for key, value in (("hr", item.heartRateBpm), ("speed", item.speedMps),
                               ("grade", item.gradePercent), ("distance", item.totalDistanceM),
                               ("route", item.routeProgressM)):
                if value is not None:
                    self._values[(item.measuredAt, key)] = (cell, float(value))

    def build_inputs(self, *, n_cells: int, course: CourseProfile | None) -> InletInputs | Insufficient:
        by_key = {key: [(at, cell, value) for (at, metric), (cell, value) in self._values.items() if metric == key]
                  for key in ("hr", "speed", "grade", "distance", "route")}
        if not by_key["hr"]:
            return Insufficient("NO_HR")
        if not by_key["speed"]:
            return Insufficient("NO_SPEED")
        has_sample_grade = bool(by_key["grade"])
        if not has_sample_grade and course is None:
            return Insufficient("NO_GRADE")
        latest = {key: max((row[0] for row in rows), default=None) for key, rows in by_key.items()}
        grade_latest = latest["grade"] if has_sample_grade else max(
            value for value in (latest["distance"], latest["speed"]) if value is not None)
        input_as_of = min(latest["hr"], latest["speed"], grade_latest)
        eligible = [(at, cell, metric, value) for (at, metric), (cell, value) in self._values.items() if at <= input_as_of]
        if not eligible:
            return Insufficient("NO_HR")
        t0 = max(row[1] for row in eligible)
        earliest = min(row[1] for row in eligible)
        lo = max(t0 - n_cells + 1, earliest)
        cells = list(range(lo, t0 + 1))
        grouped: dict[str, dict[int, list[float]]] = {key: {} for key in ("hr", "speed", "grade", "distance", "route")}
        for _, cell, metric, value in eligible:
            grouped[metric].setdefault(cell, []).append(value)
        means = {key: {cell: sum(values) / len(values) for cell, values in bucket.items()}
                 for key, bucket in grouped.items()}
        distance_cells: dict[int, float] = {}
        if grouped["distance"]:
            running = 0.0
            for cell in cells:
                if cell in means["distance"]:
                    running = max(running, means["distance"][cell])
                distance_cells[cell] = running
        else:
            running = 0.0
            for cell in cells:
                speed = means["speed"].get(cell)
                if speed is not None:
                    running += speed * STEP_SEC
                distance_cells[cell] = running
        hr_history = [means["hr"].get(cell) for cell in cells]
        speed_history = [means["speed"].get(cell) for cell in cells]
        if has_sample_grade:
            grade_history = [means["grade"].get(cell) for cell in cells]
            grade_source = "SAMPLE"
        else:
            grade_history = [course.grade_at(distance_cells[cell]) for cell in cells]
            grade_source = "COURSE_PROFILE"
        all_speed = [value for value in speed_history[-12:] if value is not None]
        mean_speed = sum(all_speed) / len(all_speed) if all_speed else None
        actual_pace = 1000.0 / mean_speed if mean_speed is not None and mean_speed > 0 else None
        route_values = [value for cell, value in means["route"].items() if cell <= t0]
        route_progress = max(route_values) if route_values else None
        return InletInputs(elapsed_sec=STEP_SEC * t0,
                           history={"hrBpm": hr_history, "speedMps": speed_history, "gradePct": grade_history},
                           input_as_of=input_as_of, distance_m=distance_cells[t0],
                           route_progress_m=route_progress, actual_pace_60s_sec_per_km=actual_pace,
                           grade_source=grade_source,
                           data_now=max(at for at, _ in self._values))

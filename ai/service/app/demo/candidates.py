"""정책 후보 pace와 각 후보의 2분 속도·경사를 만든다."""
from app.demo.course import CourseProfile

from app.pace_selector import DELTAS as DELTAS_SEC_PER_KM  # AI04 후보와 같다(S15P31E105-624)


def future_grades(course: CourseProfile | None, distance_m: float, speed_mps: float) -> list[float] | None:
    if course is None:
        return None
    return [course.grade_at(distance_m + speed_mps * 5 * k) for k in range(1, 25)]


def build_candidates(anchor_pace_sec_per_km: float, distance_m: float,
                     course: CourseProfile | None) -> list[dict]:
    candidates = []
    for delta in DELTAS_SEC_PER_KM:
        pace = anchor_pace_sec_per_km + delta
        speed = 1000.0 / pace
        candidates.append({"paceSecPerKm": pace, "futureSpeedMps": [speed] * 24,
                           "futureGradePct": future_grades(course, distance_m, speed)})
    return candidates


def goal_pace(goal: dict) -> float | None:
    pace = goal.get("targetPaceSecPerKm")
    if pace is not None:
        return float(pace)
    distance = goal.get("targetDistanceM")
    duration = goal.get("targetDurationSec")
    if distance and duration:
        return float(duration) / float(distance) * 1000.0
    return None


def choose_anchor(goal_pace_sec_per_km: float | None, current_guide_pace_sec_per_km: float | None,
                  actual_pace_60s_sec_per_km: float | None, *, follows_guide: bool = True) -> float | None:
    # 안내가 워치에 가지 않으면 러너는 자기 pace로 달린다. 이때 가상 안내를 기준으로 삼으면 감속 추천이 쌓인다.
    if not follows_guide and actual_pace_60s_sec_per_km is not None:
        return actual_pace_60s_sec_per_km
    if goal_pace_sec_per_km is not None:
        return current_guide_pace_sec_per_km if current_guide_pace_sec_per_km is not None else goal_pace_sec_per_km
    return actual_pace_60s_sec_per_km

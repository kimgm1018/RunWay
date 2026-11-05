"""AI09 신규 사용자 첫 계획 기준(S15P31E105-403): 온보딩 러닝 프로필(user_profiles) → 목표 완주시간.

사용자가 목표 시간·pace를 넣지 않은 AI09 요청에서만 쓴다. API 입력·planStatus·planSource는 바꾸지 않는다.

계산 순서(ODE는 한 번만 푼다):
1. 플래너가 지금처럼 목표 없이 ODE 계획을 한 번 만든다 → 완주시간 T_ode, 구간 pace 모양(경사 반영).
2. 프로필 기준 T_기준(Riegel)과 섞는다: T = w·T_기준 + (1−w)·T_ode, w = k/(n+k). n=0이면 기준 100%.
3. 그 계획의 구간 pace에 공통 배율 T/T_ode를 곱한다. 목표 시간 경로와 같은
   personal_plan.finalize_personal_segments(preserve_goal_duration=True)를 재사용한다(모양 유지, 2자리 반올림).
   늘리거나 줄인 계획의 HR은 기존 목표 경로처럼 막지 않고(best effort) 최종 재생에서 band를 벗어나면 경고한다.

입력 해석:
- user_profiles(U06·U07): running_level, average_pace(초/km, NOT NULL), distance(m)·duraction(초, nullable).
  컬럼명 오타 duraction은 팀 스키마 그대로 쓴다.
- 거리·시간이 있으면 그 기록, 페이스만 있으면 수준 기준 거리에서 그 페이스로 달린 기록으로 본다.
  오늘 거리로 Riegel T2 = T1 × (D2/D1)^1.06.
- 비현실적 값(pace 3'00"–10'00"/km 밖, 거리 1–50 km 밖, 시간 5분–6시간 밖)은 수준 기준으로 대체한다.
- 프론트는 수준을 고르면 기준값을 폼에 미리 채우고 고치지 않으면 그대로 저장한다(ProfileRunningScreen,
  runningPresets.ts). 그래서 저장값이 수준 기준과 같으면 "수준만 고름"(LEVEL)으로 본다.

n(지난 러닝 수): running_sessions에서 402 v_ref와 같은 조건(COMPLETED, 미삭제, 계획 시각 이전 종료, 2시간 이하,
이동 속도 0.5–8 m/s)을 통과한 러닝 수. v_ref는 최근 20회만 쓰지만 n은 상한 없이 COUNT한다.

k(혼합 강도): env PERSONAL_PLAN_RUNNER_BASELINE_K_TYPED(기본 5), PERSONAL_PLAN_RUNNER_BASELINE_K_LEVEL(기본 3).
- 연구(.local/coldstart_20261104/COLDSTART_REPORT.md)의 사전 등록 1-SE 규칙은 TYPED 20, LEVEL 3이었다.
- TYPED는 5로 바꿨다(사용자 결정, 2026-11-04). 근거: Train fold별 최저 k가 5–8이고 1-SE 안에서는 성능이 거의
  같다. 검증의 "입력 기록"은 실제로 달린 첫 러닝이라, 사람이 직접 입력한 값보다 정확했다. 그래서 본인 기록으로
  더 빨리 옮겨 간다. 사전 등록 규칙에서 벗어난 값이다.
- V2 Val 판정은 보류(완주시간 개선 CI가 0 포함)였고, 사용자 입력을 쓰는 제품 결정으로 채택했다.

조회 실패·프로필 없음·형식 오류는 기존 동작(기준 없음)으로 계속하고 경고만 남긴다.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
import logging
import math
import os

from app.ai_logging import log_ai_error
from app.speed_calibration import SPEED_REF_MAX_DURATION_SEC, SPEED_REF_VALID_RANGE_MPS

log = logging.getLogger("runway.ai")

RIEGEL_EXPONENT = 1.06
# 팀 확정 수준 기준(S15P31E105-366): (거리 m, 시간 초). pace = 400 / 360 / 330 초/km.
LEVEL_REFERENCES = {"BEGINNER": (3000.0, 1200.0), "INTERMEDIATE": (5000.0, 1800.0), "ADVANCED": (10000.0, 3300.0)}
DEFAULT_BLEND_K = {"TYPED": 5.0, "LEVEL": 3.0}
BLEND_K_ENV = {"TYPED": "PERSONAL_PLAN_RUNNER_BASELINE_K_TYPED", "LEVEL": "PERSONAL_PLAN_RUNNER_BASELINE_K_LEVEL"}
PACE_RANGE_SEC_PER_KM = (180.0, 600.0)
DISTANCE_RANGE_M = (1000.0, 50000.0)
DURATION_RANGE_SEC = (300.0, 21600.0)
# 플래너 탐색 속도 범위(personal_plan._TRAIN_SPEED_QUANTILES_MPS 양 끝). 범위 밖 목표는 플래너가 422로 거절한다.
SEARCH_SPEED_RANGE_MPS = (1.7638, 4.1272)
PROFILE_DB_TIMEOUT_MS = 300
MISSING_RELATION_SQLSTATES = frozenset({"42P01", "42703"})
# 지난 러닝 조건은 402 v_ref와 같다(app/speed_calibration.py 상수 그대로).
PAST_RUN_MAX_DURATION_SEC = SPEED_REF_MAX_DURATION_SEC
PAST_RUN_SPEED_RANGE_MPS = SPEED_REF_VALID_RANGE_MPS

PROFILE_SQL = """SELECT running_level::text AS running_level, average_pace, distance, duraction
FROM user_profiles
WHERE user_id = %(user_id)s
ORDER BY updated_at DESC, id DESC
LIMIT 1"""

# 402 SPEED_REF_SQL과 같은 WHERE 조건, LIMIT 없이 개수만.
PAST_RUN_COUNT_SQL = """SELECT COUNT(*) AS run_count
FROM running_sessions
WHERE user_id = %(user_id)s
  AND status = 'COMPLETED'
  AND deleted_at IS NULL
  AND ended_at IS NOT NULL
  AND ended_at <= %(cutoff)s
  AND total_distance > 0
  AND moving_duration > 0
  AND GREATEST(moving_duration, COALESCE(elapsed_duration, 0)) <= %(max_duration_sec)s
  AND total_distance / moving_duration BETWEEN %(min_speed_mps)s AND %(max_speed_mps)s"""


@dataclass(frozen=True)
class RunnerProfile:
    running_level: str
    average_pace_sec_per_km: float | None
    distance_m: float | None = None
    duration_sec: float | None = None


@dataclass(frozen=True)
class RunnerBaseline:
    finish_sec: float
    kind: str            # TYPED | LEVEL
    source: str          # DISTANCE_TIME | PACE | LEVEL_PRESET | LEVEL_FALLBACK
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class BaselinePlan:
    """이번 요청에서 쓸 기준. n = 지난 러닝 수, k = 혼합 강도."""
    baseline: RunnerBaseline
    past_run_count: int
    blend_k: float
    warnings: tuple[str, ...] = ()

    @property
    def baseline_weight(self) -> float:
        return baseline_weight(self.past_run_count, self.blend_k)


def enabled() -> bool:
    """env PERSONAL_PLAN_RUNNER_BASELINE_ENABLED(기본 true). false면 예전 동작과 같다(되돌리기)."""
    return os.getenv("PERSONAL_PLAN_RUNNER_BASELINE_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}


def load_blend_k() -> dict[str, float]:
    """env의 k를 읽고 검사한다. 0 이상 유한한 숫자가 아니면 ValueError(시작 실패)."""
    result = {}
    for kind, name in BLEND_K_ENV.items():
        raw = os.getenv(name, "").strip()
        if not raw:
            result[kind] = DEFAULT_BLEND_K[kind]
            continue
        try:
            value = float(raw)
        except ValueError:
            raise ValueError(f"{name}는 0 이상 유한한 숫자여야 합니다: {raw}") from None
        if not math.isfinite(value) or value < 0:
            raise ValueError(f"{name}는 0 이상 유한한 숫자여야 합니다: {raw}")
        result[kind] = value
    return result


def _number(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _within(value: float | None, bounds: tuple[float, float]) -> bool:
    return value is not None and bounds[0] <= value <= bounds[1]


def _same(a: float, b: float) -> bool:
    return abs(a - b) <= 0.005


def riegel(t1: float, d1: float, d2: float) -> float:
    return t1 * (d2 / d1) ** RIEGEL_EXPONENT


def clip_finish_to_search_support(finish_sec: float, distance_m: float) -> tuple[float, bool]:
    low, high = distance_m / SEARCH_SPEED_RANGE_MPS[1], distance_m / SEARCH_SPEED_RANGE_MPS[0]
    clipped = min(max(finish_sec, low), high)
    return clipped, clipped != finish_sec


def resolve_runner_baseline(profile: RunnerProfile, distance_m: float) -> RunnerBaseline | None:
    """오늘 거리의 기준 완주시간(초). 수준을 알 수 없으면 None."""
    reference = LEVEL_REFERENCES.get(profile.running_level)
    if reference is None or not (distance_m > 0 and math.isfinite(distance_m)):
        return None
    ref_d, ref_t = reference
    ref_pace = ref_t / ref_d * 1000.0
    distance, duration = _number(profile.distance_m), _number(profile.duration_sec)
    pace = _number(profile.average_pace_sec_per_km)
    if distance is not None and duration is not None:
        # 거리·시간 방식: 프론트 페이스(정수 반올림) 대신 거리·시간에서 다시 계산한다.
        ok = (_within(distance, DISTANCE_RANGE_M) and _within(duration, DURATION_RANGE_SEC)
              and _within(duration / distance * 1000.0, PACE_RANGE_SEC_PER_KM))
        if ok and _same(distance, ref_d) and _same(duration, ref_t):
            d1, t1, kind, source = ref_d, ref_t, "LEVEL", "LEVEL_PRESET"
        elif ok:
            d1, t1, kind, source = distance, duration, "TYPED", "DISTANCE_TIME"
        else:
            d1, t1, kind, source = ref_d, ref_t, "LEVEL", "LEVEL_FALLBACK"
    elif _within(pace, PACE_RANGE_SEC_PER_KM):
        # 페이스만: 그 수준 기준 거리를 그 페이스로 달린 기록으로 보고 Riegel로 오늘 거리에 맞춘다.
        if _same(pace, ref_pace):
            d1, t1, kind, source = ref_d, ref_t, "LEVEL", "LEVEL_PRESET"
        else:
            d1, t1, kind, source = ref_d, pace * ref_d / 1000.0, "TYPED", "PACE"
    else:
        d1, t1, kind, source = ref_d, ref_t, "LEVEL", "LEVEL_FALLBACK"
    finish, clipped = clip_finish_to_search_support(riegel(t1, d1, distance_m), distance_m)
    warnings = [f"RUNNER_BASELINE_SOURCE={source}", f"RUNNER_BASELINE_KIND={kind}"]
    if source == "LEVEL_FALLBACK":
        warnings.append("RUNNER_BASELINE_RECORD_IMPLAUSIBLE_LEVEL_USED")
    if clipped:
        warnings.append("RUNNER_BASELINE_PACE_CLIPPED_TO_SEARCH_SUPPORT")
    return RunnerBaseline(finish_sec=finish, kind=kind, source=source, warnings=tuple(warnings))


def baseline_weight(n: int, k: float) -> float:
    """가입 기준 비중 k/(n+k). n=0이면 1(기준 100%). 개인 계획 비중은 1 − 이 값 = n/(n+k)."""
    if not isinstance(n, int) or isinstance(n, bool) or n <= 0:
        return 1.0
    return k / (n + k)


def blended_finish_sec(plan: BaselinePlan, ode_finish_sec: float) -> float:
    w = plan.baseline_weight
    return w * plan.baseline.finish_sec + (1.0 - w) * float(ode_finish_sec)


def target_pace_decimal(finish_sec: float, distance_m: float) -> Decimal:
    return Decimal(str(finish_sec * 1000.0 / distance_m)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def plan_target_pace(plan: BaselinePlan, ode_finish_sec: float, distance_m: float) -> tuple[Decimal, list[str]]:
    """섞은 목표 pace와 경고. 섞은 결과도 탐색 범위 안으로 자른다."""
    finish, clipped = clip_finish_to_search_support(blended_finish_sec(plan, ode_finish_sec), distance_m)
    warnings = [f"RUNNER_BASELINE_WEIGHT={plan.baseline_weight:.3f}", f"RUNNER_BASELINE_PAST_RUNS={plan.past_run_count}"]
    if clipped and "RUNNER_BASELINE_PACE_CLIPPED_TO_SEARCH_SUPPORT" not in plan.warnings:
        warnings.append("RUNNER_BASELINE_PACE_CLIPPED_TO_SEARCH_SUPPORT")
    return target_pace_decimal(finish, distance_m), warnings


def prepare_baseline_plan(goal, *, user_id, profile_lookup, cutoff: datetime,
                          blend_k: dict[str, float] | None = None) -> tuple[BaselinePlan | None, list[str]]:
    """목표 없는 요청이면 프로필 기준과 n을 준비한다. 쓸 수 없으면 (None, 경고)."""
    if goal.target_pace_sec_per_km is not None or user_id is None or profile_lookup is None or not enabled():
        return None, []
    profile, warnings = profile_lookup.get_profile(int(user_id))
    warnings = list(warnings)
    base = resolve_runner_baseline(profile, float(goal.distance_m)) if profile is not None else None
    if base is None:
        if profile is not None:
            warnings.append("RUNNER_PROFILE_INVALID")
        return None, warnings
    n, count_warning = profile_lookup.get_past_run_count(int(user_id), cutoff=cutoff)
    if count_warning:
        warnings.append(count_warning)
    k = (blend_k or load_blend_k())[base.kind]
    return BaselinePlan(baseline=base, past_run_count=n, blend_k=k, warnings=tuple(base.warnings)), warnings


def profile_from_row(row: dict | None) -> RunnerProfile | None:
    if not row or not isinstance(row.get("running_level"), str):
        return None
    return RunnerProfile(running_level=row["running_level"],
                         average_pace_sec_per_km=_number(row.get("average_pace")),
                         distance_m=_number(row.get("distance")), duration_sec=_number(row.get("duraction")))


class DbRunnerProfileLookup:
    """user_profiles 최신 한 행과 지난 러닝 수. 실패해도 예외를 올리지 않고 경고를 돌려준다."""

    def __init__(self, db, *, timeout_ms: int = PROFILE_DB_TIMEOUT_MS):
        self.db = db
        self.timeout_ms = timeout_ms

    def _fetch_one(self, sql: str, params: dict):
        fetch = getattr(self.db, "fetch_one_with_timeout", None)
        return fetch(sql, params, self.timeout_ms) if callable(fetch) else self.db.fetch_one(sql, params)

    def get_profile(self, user_id: int) -> tuple[RunnerProfile | None, tuple[str, ...]]:
        try:
            row = self._fetch_one(PROFILE_SQL, {"user_id": int(user_id)})
        except Exception as exc:
            if getattr(exc, "sqlstate", None) in MISSING_RELATION_SQLSTATES:
                return None, ("RUNNER_PROFILE_TABLE_MISSING",)
            log_ai_error("RUNNER_PROFILE_LOOKUP_FAILED", "personal_plan", exc, level=logging.WARNING)
            return None, ("RUNNER_PROFILE_LOOKUP_UNAVAILABLE",)
        if row is None:
            return None, ("RUNNER_PROFILE_NOT_SET",)
        profile = profile_from_row(row)
        if profile is None:
            return None, ("RUNNER_PROFILE_INVALID",)
        return profile, ()

    def get_past_run_count(self, user_id: int, *, cutoff: datetime) -> tuple[int, str | None]:
        """402와 같은 조건의 지난 러닝 수(상한 없음). 실패하면 0과 경고(기준 100%)."""
        low, high = PAST_RUN_SPEED_RANGE_MPS
        params = {"user_id": int(user_id), "cutoff": cutoff, "max_duration_sec": PAST_RUN_MAX_DURATION_SEC,
                  "min_speed_mps": low, "max_speed_mps": high}
        try:
            row = self._fetch_one(PAST_RUN_COUNT_SQL, params)
        except Exception as exc:
            log_ai_error("RUNNER_PAST_RUNS_LOOKUP_FAILED", "personal_plan", exc, level=logging.WARNING)
            return 0, "RUNNER_PAST_RUNS_LOOKUP_UNAVAILABLE"
        value = (row or {}).get("run_count")
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            return 0, "RUNNER_PAST_RUNS_LOOKUP_UNAVAILABLE"
        return value, None


__all__ = ["BaselinePlan", "DEFAULT_BLEND_K", "DbRunnerProfileLookup", "LEVEL_REFERENCES", "PAST_RUN_COUNT_SQL",
           "PROFILE_SQL", "RIEGEL_EXPONENT", "RunnerBaseline", "RunnerProfile", "baseline_weight",
           "blended_finish_sec", "enabled", "load_blend_k", "plan_target_pace", "prepare_baseline_plan",
           "profile_from_row", "resolve_runner_baseline", "riegel", "target_pace_decimal"]

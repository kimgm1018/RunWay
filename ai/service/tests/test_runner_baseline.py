"""S15P31E105-403 온보딩 러닝 프로필 → 첫 계획 기준 완주시간."""
from datetime import datetime, timezone
from fractions import Fraction
import math

import pytest

from app.runner_baseline import (
    DEFAULT_BLEND_K, PAST_RUN_COUNT_SQL, PROFILE_SQL, BaselinePlan, DbRunnerProfileLookup, RunnerProfile,
    baseline_weight, blended_finish_sec, load_blend_k, plan_target_pace, resolve_runner_baseline, riegel,
    target_pace_decimal,
)

CUTOFF = datetime(2026, 11, 4, tzinfo=timezone.utc)


def profile(level="INTERMEDIATE", pace=None, distance=None, duration=None):
    return RunnerProfile(running_level=level, average_pace_sec_per_km=pace, distance_m=distance, duration_sec=duration)


def test_distance_time_record_is_converted_to_course_distance_with_riegel():
    base = resolve_runner_baseline(profile(pace=348, distance=5000, duration=1740), 10000)
    assert base.kind == "TYPED" and base.source == "DISTANCE_TIME"
    assert base.finish_sec == pytest.approx(1740 * 2 ** 1.06)


def test_same_distance_keeps_typed_time():
    assert resolve_runner_baseline(profile(pace=348, distance=5000, duration=1740), 5000).finish_sec == pytest.approx(1740)


@pytest.mark.parametrize("level,distance,duration,pace", [
    ("BEGINNER", 3000, 1200, 400), ("INTERMEDIATE", 5000, 1800, 360), ("ADVANCED", 10000, 3300, 330)])
def test_frontend_level_preset_is_treated_as_level_only(level, distance, duration, pace):
    # 프론트는 수준을 고르면 기준값을 채우고 그대로 저장한다(runningPresets.ts).
    for base in (resolve_runner_baseline(profile(level, pace, distance, duration), 7000),
                 resolve_runner_baseline(profile(level, pace), 7000)):
        assert base.kind == "LEVEL" and base.source == "LEVEL_PRESET"
        assert base.finish_sec == pytest.approx(riegel(duration, distance, 7000))


def test_pace_only_uses_level_reference_distance_then_riegel():
    base = resolve_runner_baseline(profile("INTERMEDIATE", pace=330), 10000)
    assert base.kind == "TYPED" and base.source == "PACE"
    assert base.finish_sec == pytest.approx(330 * 5 * 2 ** 1.06)


@pytest.mark.parametrize("pace,distance,duration", [
    (170, None, None), (620, None, None),             # pace 3'00" 미만, 10'00" 초과
    (360, 5000, 850), (360, 5000, 3100),              # 거리·시간 pace 범위 밖
    (360, 60000, 20000), (360, 500, 200),             # 거리 범위 밖
    (None, None, None), (float("nan"), None, None)])
def test_implausible_input_falls_back_to_level_reference(pace, distance, duration):
    base = resolve_runner_baseline(profile("BEGINNER", pace, distance, duration), 3000)
    assert base.source == "LEVEL_FALLBACK" and base.kind == "LEVEL"
    assert base.finish_sec == pytest.approx(1200)
    assert "RUNNER_BASELINE_RECORD_IMPLAUSIBLE_LEVEL_USED" in base.warnings


def test_unknown_level_gives_no_baseline():
    assert resolve_runner_baseline(profile("ELITE", 300), 5000) is None


def test_goal_pace_is_clipped_to_planner_search_support():
    base = resolve_runner_baseline(profile("ADVANCED", pace=200), 5000)   # 5 m/s > 4.1272
    assert 5000 / base.finish_sec == pytest.approx(4.1272)
    assert "RUNNER_BASELINE_PACE_CLIPPED_TO_SEARCH_SUPPORT" in base.warnings


def test_default_k_typed_5_level_3_and_env_override(monkeypatch):
    monkeypatch.delenv("PERSONAL_PLAN_RUNNER_BASELINE_K_TYPED", raising=False)
    monkeypatch.delenv("PERSONAL_PLAN_RUNNER_BASELINE_K_LEVEL", raising=False)
    assert load_blend_k() == DEFAULT_BLEND_K == {"TYPED": 5.0, "LEVEL": 3.0}
    monkeypatch.setenv("PERSONAL_PLAN_RUNNER_BASELINE_K_TYPED", "20")
    assert load_blend_k()["TYPED"] == 20.0


@pytest.mark.parametrize("raw", ["-1", "abc", "nan", "inf"])
def test_invalid_k_env_fails(monkeypatch, raw):
    monkeypatch.setenv("PERSONAL_PLAN_RUNNER_BASELINE_K_LEVEL", raw)
    with pytest.raises(ValueError):
        load_blend_k()


@pytest.mark.parametrize("n,personal", [(1, Fraction(1, 6)), (3, Fraction(3, 8)), (5, Fraction(1, 2))])
def test_typed_k5_personal_weight_is_1_6_3_8_1_2(n, personal):
    assert 1 - baseline_weight(n, DEFAULT_BLEND_K["TYPED"]) == pytest.approx(float(personal))


def test_no_past_runs_is_baseline_100_percent():
    assert baseline_weight(0, 5) == 1.0
    assert baseline_weight(True, 5) == 1.0


def test_blended_finish_and_target_pace():
    base = resolve_runner_baseline(profile("BEGINNER", 380), 3000)    # TYPED, 1140 s
    plan = BaselinePlan(baseline=base, past_run_count=5, blend_k=5.0)
    assert blended_finish_sec(plan, 1000.0) == pytest.approx(0.5 * 1140 + 0.5 * 1000)
    pace, warnings = plan_target_pace(plan, 1000.0, 3000)
    assert float(pace) == pytest.approx(1070 / 3, abs=1e-4)
    assert "RUNNER_BASELINE_WEIGHT=0.500" in warnings and "RUNNER_BASELINE_PAST_RUNS=5" in warnings
    zero = BaselinePlan(baseline=base, past_run_count=0, blend_k=5.0)
    assert blended_finish_sec(zero, 1000.0) == pytest.approx(1140)


def test_target_pace_decimal():
    assert float(target_pace_decimal(1800, 5000)) == 360.0
    assert math.isclose(float(target_pace_decimal(1000, 3000)), 333.3333)


class FakeDb:
    def __init__(self, row=None, exc=None):
        self.row, self.exc, self.calls = row, exc, []

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        self.calls.append((sql, params, timeout_ms))
        if self.exc:
            raise self.exc
        return self.row


class SqlError(Exception):
    def __init__(self, sqlstate):
        super().__init__("x")
        self.sqlstate = sqlstate


def test_lookup_reads_user_profiles_with_bound_parameter_and_short_timeout():
    db = FakeDb({"running_level": "ADVANCED", "average_pace": 330, "distance": None, "duraction": None})
    found, warnings = DbRunnerProfileLookup(db).get_profile(7)
    assert found == RunnerProfile("ADVANCED", 330.0, None, None) and warnings == ()
    sql, params, timeout = db.calls[0]
    assert sql == PROFILE_SQL and "duraction" in sql and "%(user_id)s" in sql
    assert params == {"user_id": 7} and timeout == 300


@pytest.mark.parametrize("db,warning", [
    (FakeDb(None), "RUNNER_PROFILE_NOT_SET"),
    (FakeDb(exc=SqlError("42P01")), "RUNNER_PROFILE_TABLE_MISSING"),
    (FakeDb(exc=SqlError("42501")), "RUNNER_PROFILE_LOOKUP_UNAVAILABLE"),   # 권한 없음 등
    (FakeDb(exc=TimeoutError()), "RUNNER_PROFILE_LOOKUP_UNAVAILABLE"),
    (FakeDb({"running_level": None}), "RUNNER_PROFILE_INVALID")])
def test_profile_lookup_failure_never_raises(db, warning):
    assert DbRunnerProfileLookup(db).get_profile(7) == (None, (warning,))


def test_past_run_count_uses_402_conditions_without_limit():
    db = FakeDb({"run_count": 37})
    assert DbRunnerProfileLookup(db).get_past_run_count(7, cutoff=CUTOFF) == (37, None)
    sql, params, _ = db.calls[0]
    assert sql == PAST_RUN_COUNT_SQL and "COUNT(*)" in sql and "LIMIT" not in sql
    for condition in ("status = 'COMPLETED'", "deleted_at IS NULL", "ended_at <= %(cutoff)s",
                      "GREATEST(moving_duration, COALESCE(elapsed_duration, 0)) <= %(max_duration_sec)s",
                      "total_distance / moving_duration BETWEEN %(min_speed_mps)s AND %(max_speed_mps)s"):
        assert condition in sql
    assert params == {"user_id": 7, "cutoff": CUTOFF, "max_duration_sec": 7200,
                      "min_speed_mps": 0.5, "max_speed_mps": 8.0,
                      "min_moving_sec": 600, "min_distance_m": 1000}
    # S15P31E105-785: n도 v_ref와 같이 이동 10분·1 km 이상 기록만 센다.
    for condition in ("moving_duration >= %(min_moving_sec)s", "total_distance >= %(min_distance_m)s"):
        assert condition in sql


def test_past_run_count_where_clause_is_identical_to_402_speed_ref_query():
    from app.db_lookup import SPEED_REF_SQL

    def where(sql):
        body = sql[sql.index("WHERE"):]
        return body[:body.index("ORDER BY")].strip() if "ORDER BY" in body else body.strip()
    assert where(PAST_RUN_COUNT_SQL) == where(SPEED_REF_SQL)
    assert "FROM running_sessions" in SPEED_REF_SQL and "FROM running_sessions" in PAST_RUN_COUNT_SQL


@pytest.mark.parametrize("db", [FakeDb(exc=SqlError("42501")), FakeDb(None), FakeDb({"run_count": None})])
def test_past_run_count_failure_is_zero_with_warning(db):
    assert DbRunnerProfileLookup(db).get_past_run_count(7, cutoff=CUTOFF) == (0, "RUNNER_PAST_RUNS_LOOKUP_UNAVAILABLE")

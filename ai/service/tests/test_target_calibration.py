"""AI09 목표 심박 보정(S15P31E105-377): 비율 식, 이력 조회, 계획 반영, 되돌리기."""
from datetime import datetime, timezone
from decimal import Decimal
import math

import pytest

from app.db_lookup import TARGET_HR_HISTORY_SQL, DbUserPersonalizationLookup
from app.target_calibration import (DEFAULT_GLOBAL_RATIO, DEFAULT_HISTORY_SCALE, DEFAULT_K,
                                    HISTORY_UNAVAILABLE_WARNING,
                                    TargetCalibration, attach_target_hr_history, calibrate_reference,
                                    history_from_rows, load_target_calibration)
from app.personal_plan import UserPersonalizationSnapshot
from app.policy.hr_reference import HrThresholds
from test_db_lookup import FakeDb, PERSONALIZATION_SQL, personalization_row
from test_population_bundle import _app, _plan, new_user_db


def _harness_personal_ratio(global_ratio, median, n, k):
    """연구 하네스 target_calib_common.personal_ratio를 그대로 옮긴 기준식(비교용)."""
    w = 0. if k == math.inf else (n/(n+k) if n else 0.)
    result = w*median+(1-w)*global_ratio if w else global_ratio
    return float(min(max(result, .80), 1.05))


@pytest.fixture(autouse=True)
def _default_env(monkeypatch):
    for name in ("PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO", "PERSONAL_PLAN_TARGET_HR_K",
                 "PERSONAL_PLAN_TARGET_HR_HISTORY_SCALE"):
        monkeypatch.delenv(name, raising=False)


def test_defaults_are_the_train_decision_values():
    calibration = load_target_calibration()
    assert calibration == TargetCalibration(global_ratio=DEFAULT_GLOBAL_RATIO, k=DEFAULT_K,
                                               history_scale=DEFAULT_HISTORY_SCALE)
    assert DEFAULT_HISTORY_SCALE == 1.0126320246667229
    assert DEFAULT_GLOBAL_RATIO == pytest.approx(0.942, abs=5e-4) and DEFAULT_K == 5.0


@pytest.mark.parametrize("sustain, median, n", [
    (163.0, None, 0), (171.0, 151.067, 20), (160.0, 148.246, 20), (156.0, 145.0, 7),
    (164.0, 152.5, 1), (140.0, 160.0, 20),  # 상한 1.05로 잘림
    (190.0, 120.0, 20),  # 하한 0.80으로 잘림
])
def test_ratio_matches_the_research_harness_formula(sustain, median, n):
    calibration = load_target_calibration()
    expected = _harness_personal_ratio(DEFAULT_GLOBAL_RATIO, None if median is None else median/sustain*DEFAULT_HISTORY_SCALE, n, DEFAULT_K)
    assert calibration.ratio(sustain, median, n) == expected  # 연산 순서까지 같아 bit 단위로 같다
    assert calibration.target_bpm(sustain, median, n) == expected*sustain


def test_no_history_uses_only_the_global_ratio():
    assert load_target_calibration().target_bpm(163.0, None, 0) == DEFAULT_GLOBAL_RATIO*163.0


def test_rollback_settings_return_the_old_p85_target(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO", "1.0")
    monkeypatch.setenv("PERSONAL_PLAN_TARGET_HR_K", "inf")
    assert load_target_calibration().target_bpm(171.5, 150.0, 20) == 171.5


def test_k_and_global_ratio_are_configurable(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO", "0.95")
    monkeypatch.setenv("PERSONAL_PLAN_TARGET_HR_K", "20")
    c = load_target_calibration()
    assert c.ratio(160.0, 144.0, 20) == pytest.approx(0.5*0.9*DEFAULT_HISTORY_SCALE + 0.5*0.95)


@pytest.mark.parametrize("n, weight", [(1, 1/6), (5, 1/2), (10, 2/3)])
def test_default_k5_weights(n, weight):
    """기본 k=5: 지난 러닝 n회일 때 개인 비율 가중치 n/(n+5)."""
    c = load_target_calibration()
    personal, g = 144.0/160.0*DEFAULT_HISTORY_SCALE, DEFAULT_GLOBAL_RATIO
    assert c.ratio(160.0, 144.0, n) == pytest.approx(weight*personal + (1-weight)*g, rel=0, abs=1e-15)


def test_history_scale_multiplies_the_personal_part(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_TARGET_HR_HISTORY_SCALE", "1.02")
    c = load_target_calibration()
    w = 20/(20+DEFAULT_K)
    assert c.ratio(160.0, 144.0, 20) == pytest.approx(w*144.0/160.0*1.02 + (1-w)*DEFAULT_GLOBAL_RATIO)


@pytest.mark.parametrize("name, value", [
    ("PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO", "nan"), ("PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO", "1.2"),
    ("PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO", "abc"), ("PERSONAL_PLAN_TARGET_HR_K", "-1"),
    ("PERSONAL_PLAN_TARGET_HR_K", "nan"), ("PERSONAL_PLAN_TARGET_HR_HISTORY_SCALE", "2"),
])
def test_invalid_env_is_rejected(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        load_target_calibration()


def _row(hr, elapsed=1800, distance=5000):
    return {"average_heart_rate": None if hr is None else Decimal(str(hr)),
            "elapsed_duration": elapsed, "total_distance": Decimal(str(distance))}


def test_history_uses_valid_recent_20_runs_median():
    rows = ([_row(150.0)] * 5 + [_row(None), _row(250.0), _row(150.0, elapsed=600), _row(150.0, elapsed=6000),
                                 _row(150.0, distance=2500)] + [_row(140.0)] * 30)
    median, count = history_from_rows(rows)
    # 앞의 유효 5회(150) + 다음 유효 15회(140) = 20회. 조건 밖 5행은 건너뛴다.
    assert count == 20 and median == 140.0


def test_history_empty():
    assert history_from_rows([]) == (None, 0)


def test_sql_matches_the_402_completed_run_conditions():
    for part in ("FROM running_sessions", "status = 'COMPLETED'", "deleted_at IS NULL", "ended_at IS NOT NULL",
                 "ended_at <= %(cutoff)s", "ORDER BY ended_at DESC, id DESC", "LIMIT %(limit)s",
                 "average_heart_rate BETWEEN", "elapsed_duration BETWEEN", "total_distance >="):
        assert part in TARGET_HR_HISTORY_SQL


NOW = datetime(2026, 11, 5, tzinfo=timezone.utc)


def test_lookup_reads_running_sessions_with_bound_parameters():
    db = FakeDb({TARGET_HR_HISTORY_SQL: [_row(150.0), _row(146.0), _row(148.0)]})
    assert DbUserPersonalizationLookup(db).get_target_hr_history(73, cutoff=NOW) == (148.0, 3, None)
    sql, params = db.calls[-1]
    assert sql == TARGET_HR_HISTORY_SQL
    assert params == {"user_id": 73, "cutoff": NOW, "min_hr": 30.0, "max_hr": 240.0, "min_elapsed_sec": 900,
                      "max_elapsed_sec": 5400, "min_distance_m": 3000, "limit": 20}


def test_lookup_failure_falls_back_to_global_ratio_with_a_warning():
    assert DbUserPersonalizationLookup(FakeDb(fail=True)).get_target_hr_history(73, cutoff=NOW) == (
        None, 0, HISTORY_UNAVAILABLE_WARNING)


def test_attach_keeps_snapshot_and_adds_history():
    snap = UserPersonalizationSnapshot(user_id=73, payload={}, warnings=("X",))
    lookup = DbUserPersonalizationLookup(FakeDb({TARGET_HR_HISTORY_SQL: [_row(150.0)]}))
    out, warning = attach_target_hr_history(snap, lookup, 73, cutoff=NOW)
    assert (out.target_hr_history_median_bpm, out.target_hr_history_run_count, out.warnings, warning) == (
        150.0, 1, ("X",), None)
    failed, warning = attach_target_hr_history(snap, DbUserPersonalizationLookup(FakeDb(fail=True)), 73, cutoff=NOW)
    assert failed.target_hr_history_run_count == 0 and warning == HISTORY_UNAVAILABLE_WARNING
    assert attach_target_hr_history(None, lookup, 73, cutoff=NOW) == (None, None)


def test_attach_skips_the_query_without_user_lookup_or_personal_ratio(monkeypatch):
    snap = UserPersonalizationSnapshot(user_id=None, payload={})
    db = FakeDb()
    assert attach_target_hr_history(snap, DbUserPersonalizationLookup(db), None, cutoff=NOW) == (snap, None)
    assert attach_target_hr_history(snap, object(), 73, cutoff=NOW) == (snap, None)
    monkeypatch.setenv("PERSONAL_PLAN_TARGET_HR_K", "inf")
    assert attach_target_hr_history(snap, DbUserPersonalizationLookup(db), 73, cutoff=NOW) == (snap, None)
    assert db.calls == []


def test_calibrate_reference_changes_only_the_sustain_target():
    ref = HrThresholds(danger_bpm=181.0, sustain_bpm=160.0, source="BLENDED", weight=0.5, run_count=2,
                       provisional=False, danger_offset_bpm=3.0)
    snap = UserPersonalizationSnapshot(user_id=1, payload={}, target_hr_history_median_bpm=144.0,
                                       target_hr_history_run_count=5)  # k=5 → w=0.5
    out = calibrate_reference(ref, snap)
    assert out.sustain_bpm == pytest.approx((0.5*(144.0/160.0*DEFAULT_HISTORY_SCALE) + 0.5*DEFAULT_GLOBAL_RATIO)*160.0,
                                            rel=0, abs=1e-12)
    assert (out.danger_bpm, out.source, out.weight, out.run_count) == (181.0, "BLENDED", 0.5, 2)


def test_plan_uses_running_session_history_for_the_target(monkeypatch, tmp_path):
    """팀 DB 경로 끝까지: 개인 P85 180·모집단 163(2회, w=0.5 → 171.5)과 지난 러닝 평균 심박 20회."""
    row = personalization_row(hr_danger_bpm=Decimal("195.00"), hr_sustain_bpm=Decimal("180.00"),
                              hr_threshold_run_count=2)
    history = [_row(150.0)] * 10 + [_row(154.0)] * 10
    db = new_user_db(**{PERSONALIZATION_SQL: row, TARGET_HR_HISTORY_SQL: history})
    app, _, _ = _app(monkeypatch, tmp_path, db)
    body = _plan(app).json()
    sustain = 171.5
    expected = _harness_personal_ratio(DEFAULT_GLOBAL_RATIO, 152.0/sustain*DEFAULT_HISTORY_SCALE, 20, DEFAULT_K)*sustain
    assert body["hrReferenceBpm"] == pytest.approx(expected)
    assert "TARGET_HR_CALIB_HISTORY_RUNS=20" in body["warnings"]
    assert "TARGET_HR_CALIB_K=5" in body["warnings"]
    params = next(p for sql, p in db.calls if sql == TARGET_HR_HISTORY_SQL)
    assert params["user_id"] == 73 and params["cutoff"].tzinfo is not None


def test_plan_continues_when_history_lookup_fails(monkeypatch, tmp_path):
    from test_db_lookup import SqlFailDb, course_row
    from app.db_lookup import COURSE_SQL
    db = SqlFailDb({COURSE_SQL: course_row(distance=Decimal("2000.00"))}, fail_sql=TARGET_HR_HISTORY_SQL,
                   sqlstate="42501")
    app, _, _ = _app(monkeypatch, tmp_path, db)
    response = _plan(app)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["hrReferenceBpm"] == pytest.approx(DEFAULT_GLOBAL_RATIO*163.0)
    assert HISTORY_UNAVAILABLE_WARNING in body["warnings"]
    assert "TARGET_HR_CALIB_HISTORY_RUNS=0" in body["warnings"]


# 연구 하네스 Train 실행(full_proxy_20261105T002918Z, base ckpt, k=20, 배율 1.0)의 실제 세션 행.
# (계획 시점 P85, 지난 러닝 평균 심박 중앙값, 이력 수) → 하네스 목표 심박(p5_s1.00_target_hr_bpm)
HARNESS_TRAIN_ROWS = [
    (163.0, None, 0, 153.57638747603804),
    (163.0, 140.88976377952756, 3, 151.92161047214537),
    (163.0, 156.8429862031718, 6, 154.33021795153044),
    (163.0, 166.31090487238978, 7, 156.87792902324034),
    (163.0, 153.18572605134295, 20, 153.38105676369048),
    (168.0, 142.10172522617296, 20, 150.1945224166889),
    (169.0, 142.10172522617296, 20, 150.6656156298056),
]


@pytest.mark.parametrize("sustain,median,n,expected", HARNESS_TRAIN_ROWS)
def test_service_target_matches_harness_train_rows(sustain, median, n, expected):
    calib = TargetCalibration(global_ratio=0.9421864262333622, k=20.0, history_scale=1.0)
    assert calib.target_bpm(sustain, median, n) == pytest.approx(expected, rel=0, abs=1e-9)

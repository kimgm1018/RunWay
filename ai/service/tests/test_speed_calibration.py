"""AI09 ODE 속도 반응 보정층(S15P31E105-402) 테스트: s=1.0 동일성, 변환·하한, v_ref(running_sessions) 조회·누수."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.db_lookup import (COURSE_SQL, PERSONALIZATION_SQL, SPEED_REF_SQL, SPEED_REF_UNAVAILABLE_WARNING,
                           DatabaseUnavailable, DbUserPersonalizationLookup)
from app.personal_plan import OdeBalancedPaceOptimizer, _TRAIN_SPEED_QUANTILES_MPS
from app.speed_calibration import (DEFAULT_SCALE, DEFAULT_SPEED_REF_MPS, SpeedCalibration, load_speed_calibration,
                                   resolve_speed_ref, run_moving_speed, speed_ref_from_runs, transform_speeds)
from test_db_lookup import FakeDb, _app, course_row, personalization_row
from test_personal_plan_ode import RecordingOdeRuntime, _bundle, _course, _grades

FLOOR = float(_TRAIN_SPEED_QUANTILES_MPS[0])
NOW = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)


def _with_speed_ref(snapshot, value, runs):
    return replace(snapshot, speed_ref_mps=value, speed_ref_run_count=runs)


def _select(monkeypatch, scale, *, bundle=None, distance=5000, kind=2):
    monkeypatch.setenv("PERSONAL_PLAN_SPEED_CALIB_SCALE", scale)
    runtime = RecordingOdeRuntime()
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(distance, grades=_grades(distance, kind)), goal=None,
        personalization=bundle or _bundle(), ode_runtime=runtime)
    return selection, runtime


def _original_speeds(selection, distance=5000, kind=2):
    speeds, _, _ = OdeBalancedPaceOptimizer()._forward_profile(
        _course(distance, grades=_grades(distance, kind)), selection.segment_paces_sec_per_km)
    return speeds


# --- 설정 ---------------------------------------------------------------------

def test_defaults_are_the_adopted_values(monkeypatch):
    monkeypatch.delenv("PERSONAL_PLAN_SPEED_CALIB_SCALE", raising=False)
    monkeypatch.delenv("PERSONAL_PLAN_SPEED_REF_DEFAULT_MPS", raising=False)
    assert load_speed_calibration() == SpeedCalibration(scale=1.45, default_speed_ref_mps=3.4704)
    assert DEFAULT_SCALE == 1.45 and DEFAULT_SPEED_REF_MPS == 3.4704


@pytest.mark.parametrize("name, value", [
    ("PERSONAL_PLAN_SPEED_CALIB_SCALE", "0"), ("PERSONAL_PLAN_SPEED_CALIB_SCALE", "-1"),
    ("PERSONAL_PLAN_SPEED_CALIB_SCALE", "nan"), ("PERSONAL_PLAN_SPEED_CALIB_SCALE", "3.5"),
    ("PERSONAL_PLAN_SPEED_CALIB_SCALE", "abc"), ("PERSONAL_PLAN_SPEED_REF_DEFAULT_MPS", "0.1"),
    ("PERSONAL_PLAN_SPEED_REF_DEFAULT_MPS", "inf"),
])
def test_invalid_env_fails_at_optimizer_creation(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        OdeBalancedPaceOptimizer()


# --- s=1.0 동일성 -------------------------------------------------------------

def test_scale_one_sends_untransformed_speeds_and_adds_no_warning(monkeypatch):
    selection, runtime = _select(monkeypatch, "1.0", bundle=_with_speed_ref(_bundle(), 2.9, 5))
    assert runtime.requests[-1].future_speed_mps[0] == _original_speeds(selection)
    assert not any(w.startswith("ODE_SPEED_") for w in selection.warnings)


def test_scale_one_is_identical_with_or_without_speed_ref(monkeypatch):
    a, ra = _select(monkeypatch, "1.0")
    b, rb = _select(monkeypatch, "1.0", bundle=_with_speed_ref(_bundle(), 2.5, 7))
    assert a.segment_paces_sec_per_km == b.segment_paces_sec_per_km
    assert [r.future_speed_mps for r in ra.requests] == [r.future_speed_mps for r in rb.requests]
    assert a.warnings == b.warnings


# --- 변환·하한 ----------------------------------------------------------------

def test_transform_matches_the_affine_formula_and_keeps_level_at_vref():
    out = transform_speeds([3.0, 3.4704, 4.0], 1.45, 3.4704, FLOOR)
    assert out[1] == pytest.approx(3.4704, abs=1e-12)
    assert out[0] == pytest.approx(3.4704 + 1.45 * (3.0 - 3.4704))
    assert out[2] == pytest.approx(3.4704 + 1.45 * (4.0 - 3.4704))


def test_transform_floor_is_the_search_lower_bound_and_never_slows_slow_cells():
    out = transform_speeds([FLOOR, 2.0], 1.45, 3.4704, FLOOR)
    assert out[0] == FLOOR
    assert out[1] == pytest.approx(max(3.4704 + 1.45 * (2.0 - 3.4704), FLOOR))
    assert transform_speeds([0.0, 1.0], 1.45, 3.4704, FLOOR) == (0.0, 1.0)


@pytest.mark.parametrize("speeds", [[float("nan")], [-0.1]])
def test_transform_rejects_invalid_speed(speeds):
    with pytest.raises(ValueError):
        transform_speeds(speeds, 1.45, 3.47, FLOOR)


def test_enabled_planner_feeds_transformed_speeds_but_returns_paces_from_original_speeds(monkeypatch):
    selection, runtime = _select(monkeypatch, "1.45", bundle=_with_speed_ref(_bundle(), 3.2, 6))
    original = _original_speeds(selection)
    sent = runtime.requests[-1].future_speed_mps[0]
    assert sent == transform_speeds(original, 1.45, 3.2, FLOOR) and sent != original
    speeds = 1000.0 / np.asarray(selection.segment_paces_sec_per_km)
    assert FLOOR - 1e-3 <= speeds.min() and speeds.max() <= _TRAIN_SPEED_QUANTILES_MPS[-1] + 1e-3
    assert "ODE_SPEED_CALIB_SCALE=1.45" in selection.warnings
    assert "ODE_SPEED_REF_SOURCE=HISTORY" in selection.warnings


def test_steeper_speed_response_makes_the_plan_slower_on_the_linear_fixture(monkeypatch):
    base, _ = _select(monkeypatch, "1.0")
    calibrated, _ = _select(monkeypatch, "1.45", bundle=_with_speed_ref(_bundle(), 3.0, 5))
    assert sum(calibrated.segment_paces_sec_per_km) > sum(base.segment_paces_sec_per_km)


def test_missing_speed_ref_uses_train_default(monkeypatch):
    selection, runtime = _select(monkeypatch, "1.45")
    assert runtime.requests[-1].future_speed_mps[0] == transform_speeds(
        _original_speeds(selection), 1.45, 3.4704, FLOOR)
    assert "ODE_SPEED_REF_SOURCE=TRAIN_DEFAULT" in selection.warnings


@pytest.mark.parametrize("value, runs", [(None, 0), (3.1, 0), (0.2, 3), (9.0, 3), (float("nan"), 3), (True, 3)])
def test_invalid_or_missing_speed_ref_falls_back_to_default(value, runs):
    assert resolve_speed_ref(value, runs, 3.4704) == (3.4704, 0, "train_default")


# --- 러닝 기록에서 v_ref ------------------------------------------------------

@pytest.mark.parametrize("distance, moving, elapsed, expected", [
    (5000, 1500, 1600, 5000 / 1500), (Decimal("10000.00"), 3000, None, 10000 / 3000),
    (5000, 0, 1600, None), (5000, None, 1600, None), (None, 1500, 1600, None), (0, 1500, 1600, None),
    (5000, 1500, 7300, None),          # 2시간 초과
    (100, 1500, 1600, None),            # 0.07 m/s: 기록 오류·보행
    (50000, 1500, 1600, None),          # 33 m/s: 기록 오류
    (float("nan"), 1500, 1600, None), (True, 1500, 1600, None),
])
def test_run_moving_speed_guards_zero_null_and_absurd_values(distance, moving, elapsed, expected):
    value = run_moving_speed(distance, moving, elapsed)
    assert value == (pytest.approx(expected) if expected is not None else None)


def test_speed_ref_is_the_median_of_the_most_recent_20_valid_runs():
    valid = [{"total_distance": 1000 * (3.0 + 0.05 * i), "moving_duration": 1000, "elapsed_duration": 1100}
             for i in range(25)]
    rows = [{"total_distance": 5000, "moving_duration": 0, "elapsed_duration": 100}] + valid
    value, count = speed_ref_from_runs(rows)
    assert count == 20
    assert value == pytest.approx(float(np.median([3.0 + 0.05 * i for i in range(20)])))
    assert speed_ref_from_runs([]) == (None, 0)


def test_db_speed_ref_query_is_bound_and_cut_off_at_plan_time():
    rows = [{"total_distance": Decimal("6000.00"), "moving_duration": 2000, "elapsed_duration": 2100},
            {"total_distance": Decimal("6000.00"), "moving_duration": 1800, "elapsed_duration": 1900}]
    db = FakeDb({SPEED_REF_SQL: rows})
    value, count, warning = DbUserPersonalizationLookup(db).get_speed_ref(73, cutoff=NOW)
    assert (value, count, warning) == (pytest.approx(np.median([3.0, 6000 / 1800])), 2, None)
    sql, params = db.calls[0]
    assert sql == SPEED_REF_SQL and params["user_id"] == 73 and params["cutoff"] == NOW
    assert params["limit"] == 20 and (params["min_speed_mps"], params["max_speed_mps"]) == (0.5, 8.0)
    # 미래 기록 누수 방지는 SQL 조건이 맡는다: 계획 시각 이후 종료·미완료·삭제 기록은 고르지 않는다.
    for clause in ("ended_at <= %(cutoff)s", "status = 'COMPLETED'", "deleted_at IS NULL",
                   "ORDER BY ended_at DESC", "moving_duration > 0", "total_distance > 0"):
        assert clause in SPEED_REF_SQL
    assert "73" not in sql


def test_db_speed_ref_failure_falls_back_with_a_warning():
    class DeniedDb(FakeDb):
        def fetch_all(self, sql, params):
            raise DatabaseUnavailable("InsufficientPrivilege", sqlstate="42501")

    assert DbUserPersonalizationLookup(DeniedDb()).get_speed_ref(73, cutoff=NOW) == (
        None, 0, SPEED_REF_UNAVAILABLE_WARNING)


# --- API 경로 -----------------------------------------------------------------

def _plan(monkeypatch, db, scale, user_id=73):
    monkeypatch.setenv("PERSONAL_PLAN_SPEED_CALIB_SCALE", scale)
    with TestClient(_app(monkeypatch, db)) as client:
        return client.post("/v1/pace/personal-plan", json={"userId": user_id, "courseId": 297})


def _rows():
    return {COURSE_SQL: course_row(distance=Decimal("2000.00"), elevation_profile=[10.0, 10.0, 60.0]),
            PERSONALIZATION_SQL: personalization_row()}


def test_api_reads_speed_ref_from_completed_runs_for_the_user(monkeypatch):
    db = FakeDb({**_rows(), SPEED_REF_SQL: [{"total_distance": 6000, "moving_duration": 2000,
                                             "elapsed_duration": 2050}]})
    response = _plan(monkeypatch, db, "1.45")
    assert response.status_code == 200, response.json()
    assert "ODE_SPEED_REF_SOURCE=HISTORY" in response.json()["warnings"]
    speed_calls = [params for sql, params in db.calls if sql == SPEED_REF_SQL]
    assert len(speed_calls) == 1 and speed_calls[0]["user_id"] == 73
    assert abs(speed_calls[0]["cutoff"] - datetime.now(timezone.utc)) < timedelta(minutes=1)


def test_api_with_denied_running_sessions_uses_default_with_warning(monkeypatch):
    class DeniedDb(FakeDb):
        def fetch_all(self, sql, params):
            if sql == SPEED_REF_SQL:
                raise DatabaseUnavailable("InsufficientPrivilege", sqlstate="42501")
            return super().fetch_all(sql, params)

    body = _plan(monkeypatch, DeniedDb(_rows()), "1.45").json()
    assert "ODE_SPEED_REF_SOURCE=TRAIN_DEFAULT" in body["warnings"]
    assert SPEED_REF_UNAVAILABLE_WARNING in body["warnings"]


def test_api_without_runs_uses_default(monkeypatch):
    body = _plan(monkeypatch, FakeDb(_rows()), "1.45").json()
    assert "ODE_SPEED_REF_SOURCE=TRAIN_DEFAULT" in body["warnings"]
    assert SPEED_REF_UNAVAILABLE_WARNING not in body["warnings"]


def test_api_scale_one_does_not_query_runs(monkeypatch):
    db = FakeDb(_rows())
    assert _plan(monkeypatch, db, "1.0").status_code == 200
    assert all(sql != SPEED_REF_SQL for sql, _ in db.calls)


# --- checkpoint 선택(설정만) ---------------------------------------------------

def test_fetch_scripts_choose_the_ode_folder_by_env_with_the_lam1_checkpoint_as_default():
    from pathlib import Path
    scripts = Path(__file__).resolve().parents[1] / "scripts"
    bash = (scripts / "fetch_models.sh").read_text(encoding="utf-8")
    ps1 = (scripts / "fetch_models.ps1").read_text(encoding="utf-8")
    assert 'ODEV21_HF_DIR="${ODEV21_HF_DIR:-ode_v21_speedcal_b_lam1}"' in bash
    assert bash.count('hf_url "$ODEV21_HF_DIR"/') == 3 and "hf_url ode_v21_stage1_base/" not in bash
    assert "'ode_v21_speedcal_b_lam1' } else { $env:ODEV21_HF_DIR.Trim() }" in ps1
    assert ps1.count('Get-ModelUrl "$OdeHfDir/') == 3


NEW_CHECKPOINT_SHA256 = "737334a7d77a8481f0f22029cf24dd20310f6620766c65ca7f452083450dee3b"
NEW_POPULATION_SHA256 = "bb15684840fbf39a35827c26d8d8c67e4d3b10ffaa3ff1b5d8b36c7ab606dcb6"


def test_model_pins_agree_across_runtime_scripts_infra_and_sources():
    import json
    from pathlib import Path
    from app.models.ode import runtime as ode_runtime
    service = Path(__file__).resolve().parents[1]
    assert ode_runtime.DEFAULT_CHECKPOINT_SHA256 == NEW_CHECKPOINT_SHA256
    sources = json.loads((service / "app/models/ode/SOURCES.json").read_text(encoding="utf-8"))
    files = {f["installedName"]: f for f in sources["huggingFaceModelAssets"]["files"]}
    assert files["ode_epoch_020.pt"]["sha256"] == NEW_CHECKPOINT_SHA256
    assert files["population_bundle_v2train_median.json"]["sha256"] == NEW_POPULATION_SHA256
    assert all(f["path"].startswith(("gru/", "ode_v21_speedcal_b_lam1/")) for f in files.values())
    assert sources["selectedOde"]["checkpointSha256"] == NEW_CHECKPOINT_SHA256
    assert sources["previousOde"]["hfDir"] == "ode_v21_stage1_base"
    for name in ("fetch_models.sh", "fetch_models.ps1"):
        text = (service / "scripts" / name).read_text(encoding="utf-8")
        assert NEW_CHECKPOINT_SHA256 in text and NEW_POPULATION_SHA256 in text
    manifest_path = service.parents[1] / "infra/ai/models.json"
    if manifest_path.is_file():
        manifest = {f["name"]: f for f in json.loads(manifest_path.read_text(encoding="utf-8"))["files"]}
        assert manifest["ode_epoch_020.pt"]["sha256"] == NEW_CHECKPOINT_SHA256
        assert manifest["ode_epoch_020.pt"]["source"] == "ode_v21_speedcal_b_lam1/selected_model.pt"
        assert manifest["population_bundle_v2train_median.json"]["sha256"] == NEW_POPULATION_SHA256

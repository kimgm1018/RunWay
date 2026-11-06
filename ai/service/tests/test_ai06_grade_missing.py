"""AI06 grade fallback and unchanged altitude-session regression coverage."""
import copy
from datetime import datetime
import json
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.inference import ApiError
from app.main import create_app
from app.models.ode.runtime import ODEv21Runtime
from app.ode_schemas import PersonalizeRequest
from app.personalization import _json_safe, _records, compute_personalization
from app.policy.hr_reference import personal_hr_thresholds
from demo_fakes import FakeModel5, FakePolicy


@pytest.fixture
def regression():
    path = Path(__file__).parent / "fixtures" / "ai06_grade_regression_dev.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _serialize_records(records, start_hrs):
    return {
        "records": [{
            "session_id": rec.session_id,
            "usable": rec.usable,
            "summ": _json_safe(rec.summ),
            "prep": {key: _json_safe(value) for key, value in rec.prep.items()},
            "hist_rows": _json_safe(rec.hist_rows),
            "y10": _json_safe(rec.y10),
        } for rec in records],
        "start_hrs": start_hrs,
    }


def _grade_less_body(regression):
    body = copy.deepcopy(regression["body"])
    body["sessions"] = body["sessions"][:1]
    for sample in body["sessions"][0]["samples"]:
        sample.update(gradePercent=None, gradeQuality="MISSING")
    return body


def _fake_runtime():
    return SimpleNamespace(fit_module=SimpleNamespace(fit_items=lambda *_args, **_kwargs: []),
                           info=SimpleNamespace(model_version="test"))


def test_altitude_records_identical_to_dev(regression):
    req = PersonalizeRequest.model_validate(regression["body"])
    records, start_hrs, _package, fill_info = _records(req, None)
    assert _serialize_records(records, start_hrs) == regression["records"]
    assert all(not info.filled for info in fill_info)


def test_altitude_thresholds_identical_to_dev(regression):
    req = PersonalizeRequest.model_validate(regression["body"])
    thresholds = personal_hr_thresholds(req.sessions)
    assert {"hrDangerBpm": thresholds.hr_danger_bpm,
            "hrSustainBpm": thresholds.hr_sustain_bpm,
            "hrThresholdRunCount": thresholds.hr_threshold_run_count} == regression["thresholds"]


def test_altitude_full_output_identical_to_dev(regression):
    for name in ("ODEV21_CHECKPOINT_PATH", "ODEV21_SUMMARY_STATS_PATH"):
        value = os.getenv(name)
        if not value or not Path(value).is_file():
            pytest.skip("ODE checkpoint and summary stats paths are required")
    runtime = ODEv21Runtime.from_environment()
    assert runtime is not None
    req = PersonalizeRequest.model_validate(regression["body"])
    result = _json_safe(compute_personalization(req, runtime, now=datetime.fromisoformat(regression["now"])))
    for key, value in regression["personalization"].items():
        if key == "p4":
            # dev itself differs run to run by ~1 float32 ulp in the Adam fit (CPU kernels).
            assert result[key] == pytest.approx(value, rel=0, abs=1e-6), key
        else:
            assert result[key] == value, key
    assert result["gradeFilledRunCount"] == 0
    assert "GRADE_FILLED_0" not in result["warnings"]


def test_grade_less_session_is_accepted_and_flagged(regression):
    req = PersonalizeRequest.model_validate(_grade_less_body(regression))
    records, _start_hrs, _package, fill_info = _records(req, None)
    assert len(records) == len(fill_info) == 1
    assert fill_info[0].filled
    assert fill_info[0].missing_rows == fill_info[0].rows == len(req.sessions[0].samples)
    assert np.all(records[0].prep["cell_grade"] == 0)
    original = regression["records"]["records"][0]["prep"]
    assert records[0].prep["E"] == original["E"]
    assert records[0].prep["n_cell"] == original["n_cell"]
    result = compute_personalization(req, _fake_runtime())
    assert result["warnings"] == ["P4_INPUT_INSUFFICIENT", "GRADE_FILLED_0"]
    assert result["gradeFilledRunCount"] == 1
    assert result["gradeMissingRatio"] == 1.0
    assert result["supportRunCount"] == 1
    assert result["hr0SubBpm"] == round(regression["records"]["start_hrs"][0], 2)


def test_mixed_body_flags_only_filled_runs(regression):
    body = copy.deepcopy(regression["body"])
    extra = _grade_less_body(regression)["sessions"][0]
    extra["sessionId"] = 9999
    body["sessions"].append(extra)
    req = PersonalizeRequest.model_validate(body)
    records, start_hrs, _package, fill_info = _records(req, None)
    assert len(records) == 5
    assert sum(info.filled for info in fill_info) == 1
    altitude = [rec for rec in records if rec.session_id != 9999]
    assert _serialize_records(altitude, start_hrs[:-1]) == regression["records"]
    result = compute_personalization(req, _fake_runtime())
    assert result["gradeFilledRunCount"] == 1
    assert result["gradeMissingRatio"] == round(
        sum(info.missing_rows for info in fill_info) / sum(info.rows for info in fill_info), 4)


def test_grade_less_thresholds_count(regression):
    req = PersonalizeRequest.model_validate(_grade_less_body(regression))
    assert personal_hr_thresholds(req.sessions).hr_threshold_run_count == 1


@pytest.mark.parametrize("missing", ["speed", "start_hr"])
def test_still_422_without_speed_or_start_hr(regression, missing):
    body = _grade_less_body(regression)
    samples = body["sessions"][0]["samples"]
    if missing == "speed":
        for sample in samples:
            sample["speedMps"] = None
    else:
        samples[0]["hrBpm"] = None
    with pytest.raises(ApiError) as error:
        compute_personalization(PersonalizeRequest.model_validate(body), _fake_runtime())
    assert error.value.status == 422
    assert error.value.code == "INPUT_INSUFFICIENT"


def test_grade_less_endpoint_returns_200(regression, monkeypatch):
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "false")
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=_fake_runtime)
    with TestClient(app) as client:
        response = client.post("/v1/hr/personalize", json=_grade_less_body(regression))
    assert response.status_code == 200
    result = response.json()
    assert "GRADE_FILLED_0" in result["warnings"]
    assert result["gradeFilledRunCount"] == 1
    assert result["gradeMissingRatio"] == 1.0
    assert result["hrThresholdRunCount"] == 1

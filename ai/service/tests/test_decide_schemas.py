from pydantic import ValidationError
import pytest
from app.decide.schemas import DecideRequest, Decision
from demo_fakes import decide_body


def test_valid_request_parses():
    req = DecideRequest.model_validate(decide_body())
    assert req.context.input_as_of.tzinfo is not None and len(req.candidates) == 5


def test_rejects_four_candidates():
    b = decide_body(); b["candidates"] = b["candidates"][:4]
    with pytest.raises(ValidationError): DecideRequest.model_validate(b)


def test_rejects_wrong_deltas():
    b = decide_body(); b["candidates"][2]["paceSecPerKm"] = 341
    with pytest.raises(ValidationError, match="−10, −5, 0, \\+5, \\+10"): DecideRequest.model_validate(b)


def test_rejects_naive_datetime():
    with pytest.raises(ValidationError): DecideRequest.model_validate(decide_body(inputAsOf="2026-11-05T05:16:35"))


def test_decision_json_keys():
    keys = Decision(action="GUIDE_PACE", chosen_index=1, recommended_pace_sec_per_km=335, cue_bpm=None,
                    predicted_hr_30_bpm=1, predicted_hr_60_bpm=2, predicted_hr_120_bpm=3, route_progress_m=None,
                    based_on_state_version=7, expires_at="2026-11-05T05:16:55Z", reason=None, reason_text=None
                    ).model_dump(by_alias=True).keys()
    assert {"predictedHr30Bpm", "predictedHr120Bpm", "recommendedPaceSecPerKm", "basedOnStateVersion", "expiresAt"} <= set(keys)


def test_margin_table_path(monkeypatch):
    from app.config import load_settings, SERVICE_DIR
    monkeypatch.delenv("MPC_MARGIN_TABLE_PATH", raising=False)
    assert load_settings().margin_table_path == SERVICE_DIR / "app" / "policy" / "data" / "margin_gru.json"
    monkeypatch.setenv("MPC_MARGIN_TABLE_PATH", "models/residual_quantiles.json")
    assert load_settings().margin_table_path == (SERVICE_DIR / "models/residual_quantiles.json").resolve()


def test_hr_reference_legacy_fields_still_parse():
    req = DecideRequest.model_validate(decide_body(hrReference={"hrMaxBpm": None, "rhrBpm": 58, "ageYears": 29,
                                                                "recentPeakHrBpm": 187.0, "recentRunCount": 5}))
    assert req.context.hr_reference.recent_peak_hr_bpm == 187.0 and req.context.hr_reference.recent_run_count == 5


def test_hr_reference_is_optional_for_legacy_compatible_request():
    body = decide_body()
    body["context"].pop("hrReference", None)

    req = DecideRequest.model_validate(body)

    assert req.context.hr_reference is None

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.decide.service import run_decide
from app.gru_personalization import (
    CachedDbGruPersonalizationLookup,
    DbGruPersonalizationLookup,
    GRU_PERSONALIZATION_SCHEMA_VERSION,
    GRU_PERSONALIZATION_SQL,
    GruPersonalizationResult,
    INVALID_WARNING,
    MISSING_WARNING,
    MODEL_MISMATCH_WARNING,
    NO_WINDOWS_WARNING,
    NOT_FOUND_WARNING,
    UNAVAILABLE_WARNING,
    compute_gru_personalization,
    support_to_frames,
)
from app.main import create_app
from app.models.gru import load_gru
from demo_fakes import FakePolicy, decide_body, fixed_clock


def _test_checkpoint_paths():
    paths = []
    artifact_dir = os.getenv("RUNWAY_TEST_ARTIFACTS_DIR")
    if artifact_dir:
        paths.append(Path(artifact_dir) / "gru_final.pt")
    model_path = os.getenv("HR_MODEL_PATH")
    if model_path:
        candidate = Path(model_path)
        paths.append(candidate / "gru_final.pt" if candidate.is_dir() else candidate)
    paths.append(Path(__file__).resolve().parents[1] / "models" / "gru_final.pt")
    return paths


def _resolve_test_checkpoint():
    paths = _test_checkpoint_paths()
    return next((path for path in paths if path.is_file()), None), paths


@pytest.fixture(scope="module")
def real_gru():
    checkpoint, searched = _resolve_test_checkpoint()
    if checkpoint is None:
        pytest.skip("실제 GRU 체크포인트를 찾지 못했습니다. 확인한 경로: " + "; ".join(map(str, searched)))
    settings = replace(load_settings(), model_path=checkpoint, model_sha256=None,
                       gru_src_dir=Path(__file__).resolve().parents[2] / "workspace" / "doyeon" / "gru" / "src",
                       device="cpu", torch_threads=1)
    model = load_gru(settings)
    yield model
    model.predictor.load_state(None)


def test_checkpoint_search_order_uses_env_then_model_path_then_repo_models(tmp_path, monkeypatch):
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    from_artifacts = artifacts / "gru_final.pt"
    from_artifacts.write_bytes(b"artifact")
    from_env = tmp_path / "env-gru.pt"
    from_env.write_bytes(b"env")
    monkeypatch.setenv("RUNWAY_TEST_ARTIFACTS_DIR", str(artifacts))
    monkeypatch.setenv("HR_MODEL_PATH", str(from_env))

    checkpoint, _ = _resolve_test_checkpoint()
    assert checkpoint == from_artifacts

    from_artifacts.unlink()
    checkpoint, _ = _resolve_test_checkpoint()
    assert checkpoint == from_env


def test_gru_personalization_computes_recent_support_features_per_run_under_window_cap(monkeypatch):
    # 모든 러닝을 한 배열로 합치지 않고 최신 러닝의 window 3개만 head 학습에 쓴다.
    import torch
    import threading
    from app.ode_schemas import PersonalizeRequest

    sessions = []
    for session_id, day in ((1, 1), (2, 2), (3, 3)):
        session = support_session(session_id, minutes=3)
        session["sessionStartedAt"] = (datetime(2026, 10, 1, tzinfo=timezone.utc)
                                       + timedelta(days=day)).isoformat().replace("+00:00", "Z")
        sessions.append(session)
    body = PersonalizeRequest.model_validate(personalize_body(*sessions))

    class Predictor:
        models = {"main": object(), "nograde": object()}

        def __init__(self):
            self.base = {key: (torch.full((3, 2), float(index)), torch.zeros(3))
                         for index, key in enumerate(self.models, 1)}
            self.calls = []
            self.fit_rows = {}

        def support_features(self, support, key):
            assert len(support) == 1
            session_id = int(support[0].session_id.iloc[0])
            self.calls.append((session_id, key))
            x = torch.full((2, 2), float(session_id))
            y = torch.zeros((2, 3))
            mask = torch.ones((2, 3))
            return x, y, mask

        def fit_head(self, base, features, *_args):
            key = "main" if float(base[0][0, 0]) == 1.0 else "nograde"
            self.fit_rows[key] = features[0][:, 0].tolist()
            return base

    predictor = Predictor()
    model = SimpleNamespace(predictor=predictor, sha256="a" * 64,
                            info=SimpleNamespace(model_version="gru-fixture"), lock=threading.Lock())
    monkeypatch.setenv("GRU_PERSONALIZATION_MAX_WINDOWS", "3")

    payload, warnings = compute_gru_personalization(body, model)

    assert warnings == []
    assert payload["supportWindowCount"] == 3 and payload["supportRunCount"] == 2
    assert predictor.fit_rows["main"] == [3.0, 3.0, 2.0]
    assert all(session_id != 1 for session_id, _ in predictor.calls)
    assert {key for _, key in predictor.calls} == {"main", "nograde"}


def support_session(session_id=51, *, minutes=30, hr_shift=0.0, hr_quality="GOOD", filled=False,
                    workout_quality="CLEAN"):
    count = minutes * 12 + 1
    samples = []
    for index in range(count):
        elapsed = index * 5
        hr = 112.0 + hr_shift + 0.018 * elapsed + 1.2 * np.sin(elapsed / 95.0)
        samples.append({
            "elapsedSec": elapsed,
            "hrBpm": round(float(hr), 3),
            "speedMps": round(float(2.8 + 0.08 * np.sin(elapsed / 75.0)), 4),
            "gradePercent": round(float(0.5 * np.sin(elapsed / 150.0)), 4),
            "hrQuality": hr_quality,
            "speedQuality": "GOOD",
            "gradeQuality": "GOOD",
            "hrIsFilled": filled,
        })
    return {
        "sessionId": session_id,
        "sessionStartedAt": "2026-10-20T08:00:00Z",
        "workoutQuality": workout_quality,
        "samples": samples,
    }


def personalize_body(*sessions):
    return {"userId": 73, "sessions": list(sessions)}


def prediction_body(user_id=None):
    body = {
        "elapsedSec": 995,
        "history": {"hrBpm": [145.0] * 80, "speedMps": [2.8] * 80, "gradePct": [0.0] * 80},
        "candidates": [
            {"futureSpeedMps": [speed] * 24, "futureGradePct": [0.0] * 24}
            for speed in (2.7, 2.8, 2.9)
        ],
    }
    if user_id is not None:
        body["userId"] = user_id
    return body


def shifted_state(model, shift):
    state = {}
    for key, (weight, bias) in model.predictor.get_state().items():
        next_bias = bias.clone()
        next_bias += float(shift)
        state[key] = (weight.clone(), next_bias)
    return state


def state_to_head(state):
    return {
        key: {
            "weight": weight.detach().cpu().tolist(),
            "bias": bias.detach().cpu().tolist(),
        }
        for key, (weight, bias) in state.items()
    }


class FakeDb:
    def __init__(self, row=None, *, sqlstate=None):
        self.row = row
        self.sqlstate = sqlstate
        self.calls = 0
        self.timeouts = []

    def fetch_one_with_timeout(self, sql, params, timeout_ms):
        self.calls += 1
        self.timeouts.append(timeout_ms)
        assert sql == GRU_PERSONALIZATION_SQL
        assert set(params) == {"user_id"}
        if self.sqlstate:
            error = RuntimeError("가짜 DB 오류")
            error.sqlstate = self.sqlstate
            raise error
        return self.row


class StaticLookup:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def get_for_model(self, user_id, model):
        self.calls.append((user_id, model))
        return self.result


class MappingLookup:
    def __init__(self, results):
        self.results = results

    def get_for_model(self, user_id, model):
        return self.results[user_id]


def valid_row(model, *, head=None, **overrides):
    row = {
        "user_id": 73,
        "personalization_version": 4,
        "schema_version": GRU_PERSONALIZATION_SCHEMA_VERSION,
        "model_version": model.info.model_version,
        "model_sha256": model.sha256,
        "support_run_count": 1,
        "support_window_count": 20,
        "head_json": head if head is not None else state_to_head(shifted_state(model, 0.7)),
    }
    row.update(overrides)
    return row


def app_client(model, lookup=None, *, ode=None, hr_threshold_lookup=None):
    return TestClient(create_app(
        lambda: model,
        lambda: FakePolicy(),
        clock=fixed_clock(3.0),
        ode_loader=lambda: ode,
        personal_plan_course_lookup=object(),
        personal_plan_user_lookup=object(),
        gru_personalization_lookup=lookup,
        hr_threshold_lookup=hr_threshold_lookup,
    ))


def test_support_quality_matches_ode_and_omits_unusable_sessions():
    from app.ode_schemas import PersonalizeRequest

    body = PersonalizeRequest.model_validate(personalize_body(
        support_session(1, minutes=3, hr_quality="LOW"),
        support_session(2, minutes=3, workout_quality="UNUSABLE"),
    ))
    frames = support_to_frames(body)
    assert len(frames) == 1
    assert set(frames[0].hr_quality) == {"GOOD"}
    assert frames[0].hr_bpm.notna().all()
    assert frames[0].hr_is_filled.eq(False).all()


def test_gru_fit_matches_predictor_personalize_without_mutating_base(real_gru):
    from app.ode_schemas import PersonalizeRequest

    body = PersonalizeRequest.model_validate(personalize_body(support_session()))
    predictor = real_gru.predictor
    before = predictor.get_state()
    payload, warnings = compute_gru_personalization(body, real_gru)
    after = predictor.get_state()
    assert warnings == [] and payload is not None
    assert payload["supportWindowCount"] > 0
    for key in predictor.models:
        assert before[key][0].detach().cpu().numpy().tobytes() == after[key][0].detach().cpu().numpy().tobytes()
        assert before[key][1].detach().cpu().numpy().tobytes() == after[key][1].detach().cpu().numpy().tobytes()
    frames = support_to_frames(body)
    expected = predictor.personalize(frames)
    try:
        for key in predictor.models:
            assert np.allclose(payload["head"][key]["weight"], expected[key][0].detach().cpu().numpy(), atol=1e-6)
            assert np.allclose(payload["head"][key]["bias"], expected[key][1].detach().cpu().numpy(), atol=1e-6)
    finally:
        predictor.load_state(None)


def test_ai06_returns_gru_schema_and_null_when_no_windows(real_gru, monkeypatch):
    # v6_8 (D): GRU 개인화 기본값이 꺼짐(false)으로 바뀌었다. 이 테스트는 켠 상태의 동작을 보므로 명시적으로 켠다.
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "true")
    from app.ode_schemas import PersonalizeRequest
    import app.main as main_module

    body = PersonalizeRequest.model_validate(personalize_body(support_session()))
    monkeypatch.setattr(main_module, "compute_personalization", lambda *_args, **_kwargs: {
        "schemaVersion": "runway.ode.personalization.v1", "warnings": [], "userId": 73,
    })
    with app_client(real_gru, ode=SimpleNamespace()) as client:
        response = client.post("/v1/hr/personalize", json=body.model_dump(by_alias=True, mode="json"))
    assert response.status_code == 200
    payload = response.json()
    gru = payload["gruPersonalization"]
    assert gru["schemaVersion"] == GRU_PERSONALIZATION_SCHEMA_VERSION
    assert gru["modelVersion"] == real_gru.info.model_version
    assert len(gru["modelSha256"]) == 64
    assert gru["supportRunCount"] == 1 and gru["supportWindowCount"] > 0
    assert len(gru["head"]["main"]["weight"]) == 3
    assert all(len(row) == 256 for row in gru["head"]["main"]["weight"])
    assert len(gru["head"]["main"]["bias"]) == 3
    assert len(gru["head"]["nograde"]["weight"]) == 3
    assert all(len(row) == 256 for row in gru["head"]["nograde"]["weight"])
    assert len(gru["head"]["nograde"]["bias"]) == 3
    for key in ("main", "nograde"):
        assert np.isfinite(np.asarray(gru["head"][key]["weight"])).all()
        assert np.isfinite(np.asarray(gru["head"][key]["bias"])).all()

    no_labels = PersonalizeRequest.model_validate(personalize_body(
        support_session(9, minutes=30, hr_quality="LOW", filled=True)))
    with app_client(real_gru, ode=SimpleNamespace()) as client:
        empty = client.post("/v1/hr/personalize", json=no_labels.model_dump(by_alias=True, mode="json"))
    assert empty.status_code == 200
    assert empty.json()["gruPersonalization"] is None
    assert NO_WINDOWS_WARNING in empty.json()["warnings"]


def test_ai06_keeps_ode_error_status_and_returns_independent_gru_result(real_gru, monkeypatch):
    # v6_8 (D): GRU 개인화 기본값이 꺼짐(false)으로 바뀌었다. 이 테스트는 켠 상태의 동작을 보므로 명시적으로 켠다.
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "true")
    from app.ode_schemas import PersonalizeRequest

    body = PersonalizeRequest.model_validate(personalize_body(support_session(11)))
    with app_client(real_gru, ode=None) as client:
        response = client.post("/v1/hr/personalize", json=body.model_dump(by_alias=True, mode="json"))
    assert response.status_code == 503
    assert response.json()["code"] == "MODEL_NOT_READY"
    assert response.json()["gruPersonalization"]["schemaVersion"] == GRU_PERSONALIZATION_SCHEMA_VERSION


def test_json_roundtrip_head_is_accepted_and_predicts_same(real_gru):
    from app.ode_schemas import PersonalizeRequest

    support = PersonalizeRequest.model_validate(personalize_body(support_session(22)))
    payload, warnings = compute_gru_personalization(support, real_gru)
    assert payload is not None and warnings == []
    row = valid_row(real_gru, head=json.loads(json.dumps(payload["head"])))
    db = FakeDb(row)
    lookup = CachedDbGruPersonalizationLookup(db)
    loaded = lookup.get_for_model(73, real_gru)
    assert loaded.warning is None and loaded.personalization_version == 4
    batch = {
        "hr": np.full((1, 80), 145.0, np.float32),
        "speed": np.full((1, 80), 2.8, np.float32),
        "grade": np.zeros((1, 80), np.float32),
        "segment": None,
        "elapsed_s": np.array([995.0], np.float32),
        "future_speed": np.full((1, 24), 2.8, np.float32),
        "future_grade": np.zeros((1, 24), np.float32),
        "session_start_s": None,
    }
    fitted = real_gru.predictor.personalize(support_to_frames(support))
    try:
        expected = real_gru.predict_with_state(batch, fitted)
    finally:
        real_gru.predictor.load_state(None)
    actual = real_gru.predict_with_state(batch, loaded.state)
    assert np.allclose(expected, actual, atol=1e-6)


def test_personalized_predictions_use_head_and_restore_base(real_gru):
    batch = {
        "hr": np.full((1, 80), 145.0, np.float32),
        "speed": np.full((1, 80), 2.8, np.float32),
        "grade": np.zeros((1, 80), np.float32),
        "segment": None,
        "elapsed_s": np.array([995.0], np.float32),
        "future_speed": np.full((1, 24), 2.8, np.float32),
        "future_grade": np.zeros((1, 24), np.float32),
        "session_start_s": None,
    }
    predictor = real_gru.predictor
    base_bytes = {key: (w.cpu().numpy().tobytes(), b.cpu().numpy().tobytes())
                  for key, (w, b) in predictor.base.items()}
    off = real_gru.predict(batch)
    on = real_gru.predict_with_state(batch, shifted_state(real_gru, 2.0))
    assert not np.allclose(off, on)
    restored = predictor.get_state()
    assert {key: (w.cpu().numpy().tobytes(), b.cpu().numpy().tobytes())
            for key, (w, b) in restored.items()} == base_bytes


def test_concurrent_user_heads_do_not_mix_and_restore_base(real_gru):
    batch = {
        "hr": np.full((1, 80), 145.0, np.float32),
        "speed": np.full((1, 80), 2.8, np.float32),
        "grade": np.zeros((1, 80), np.float32),
        "segment": None,
        "elapsed_s": np.array([995.0], np.float32),
        "future_speed": np.full((1, 24), 2.8, np.float32),
        "future_grade": np.zeros((1, 24), np.float32),
        "session_start_s": None,
    }
    state_a, state_b = shifted_state(real_gru, 0.5), shifted_state(real_gru, 1.5)
    expected_a = real_gru.predict_with_state(batch, state_a)
    expected_b = real_gru.predict_with_state(batch, state_b)
    requests = [(state_a if i % 2 == 0 else state_b, expected_a if i % 2 == 0 else expected_b)
                for i in range(24)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        outputs = list(pool.map(lambda item: real_gru.predict_with_state(batch, item[0]), requests))
    for output, (_, expected) in zip(outputs, requests):
        assert np.allclose(output, expected, atol=1e-6)
    default = real_gru.predict(batch)
    assert np.allclose(default, real_gru.predictor.predict(batch, personalized=False), atol=1e-6)


def test_concurrent_ai03_user_requests_keep_their_own_heads(real_gru, monkeypatch):
    monkeypatch.setenv("AI_DB_URL", "postgresql://fake")
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "true")
    state_a, state_b = shifted_state(real_gru, 0.5), shifted_state(real_gru, 1.5)
    lookup = MappingLookup({
        71: GruPersonalizationResult(state=state_a, personalization_version=1),
        72: GruPersonalizationResult(state=state_b, personalization_version=2),
    })
    with app_client(real_gru, lookup) as client:
        reference_a = client.post("/v1/hr/predict", json=prediction_body(71)).json()
        reference_b = client.post("/v1/hr/predict", json=prediction_body(72)).json()

        def request_for(user_id):
            response = client.post("/v1/hr/predict", json=prediction_body(user_id))
            return response.status_code, response.json()

        user_ids = [71, 72] * 12
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(request_for, user_ids))
    for user_id, (status, payload) in zip(user_ids, results):
        assert status == 200
        assert payload == (reference_a if user_id == 71 else reference_b)
    restored = real_gru.predictor.get_state()
    default = real_gru.predictor.base
    for key in default:
        assert restored[key][0].cpu().numpy().tobytes() == default[key][0].cpu().numpy().tobytes()
        assert restored[key][1].cpu().numpy().tobytes() == default[key][1].cpu().numpy().tobytes()


@pytest.mark.parametrize("sqlstate,expected", [
    (None, NOT_FOUND_WARNING),
    ("42P01", MISSING_WARNING),
    ("42703", MISSING_WARNING),
    ("08006", UNAVAILABLE_WARNING),
])
def test_db_lookup_maps_missing_and_unavailable_errors(sqlstate, expected):
    db = FakeDb(sqlstate=sqlstate)
    adapter = DbGruPersonalizationLookup(db, timeout_ms=300)
    row, warning, cacheable = adapter.get_latest(73)
    assert row is None and warning == expected
    assert cacheable is (expected != UNAVAILABLE_WARNING)
    assert db.timeouts == [300]


def test_cache_ttl_hit_and_expiry(real_gru):
    db = FakeDb(valid_row(real_gru))
    now = [10.0]
    lookup = CachedDbGruPersonalizationLookup(db, ttl_sec=300, monotonic=lambda: now[0])
    assert lookup.get_for_model(73, real_gru).personalization_version == 4
    now[0] += 299
    assert lookup.get_for_model(73, real_gru).personalization_version == 4
    assert db.calls == 1
    now[0] += 2
    assert lookup.get_for_model(73, real_gru).personalization_version == 4
    assert db.calls == 2


def test_not_found_cache_is_short_lived(real_gru):
    db = FakeDb(None)
    now = [10.0]
    lookup = CachedDbGruPersonalizationLookup(db, empty_ttl_sec=60, monotonic=lambda: now[0])
    assert lookup.get_for_model(73, real_gru).warning == NOT_FOUND_WARNING
    now[0] += 59
    assert lookup.get_for_model(73, real_gru).warning == NOT_FOUND_WARNING
    assert db.calls == 1
    now[0] += 2
    assert lookup.get_for_model(73, real_gru).warning == NOT_FOUND_WARNING
    assert db.calls == 2


def test_cache_rejects_model_mismatch_and_invalid_heads(real_gru):
    mismatch = CachedDbGruPersonalizationLookup(FakeDb(valid_row(real_gru, model_sha256="0" * 64)))
    assert mismatch.get_for_model(73, real_gru).warning == MODEL_MISMATCH_WARNING
    bad = valid_row(real_gru, head={"main": {"weight": [[0.0] * 256] * 3, "bias": [0.0] * 3},
                                    "nograde": {"weight": [[float("nan")] * 256] * 3, "bias": [0.0] * 3}})
    invalid = CachedDbGruPersonalizationLookup(FakeDb(bad))
    assert invalid.get_for_model(73, real_gru).warning == INVALID_WARNING


@pytest.mark.parametrize("warning", [
    NOT_FOUND_WARNING, MISSING_WARNING, MODEL_MISMATCH_WARNING, INVALID_WARNING, UNAVAILABLE_WARNING,
])
def test_ai03_and_ai04_personalization_failures_return_normal_result_with_warning(real_gru, monkeypatch, warning):
    monkeypatch.setenv("AI_DB_URL", "postgresql://fake")
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "true")
    lookup = StaticLookup(GruPersonalizationResult(warning=warning))
    with app_client(real_gru, lookup) as client:
        ai03 = client.post("/v1/hr/predict", json=prediction_body(73))
        ai04_body = decide_body()
        ai04_body["userId"] = 73
        ai04 = client.post("/v1/pace/decide", json=ai04_body)
    assert ai03.status_code == 200 and warning in ai03.headers.get("X-RunWay-Warnings", "")
    assert ai03.json()["hrPersonalized"] is False and ai03.json()["hrPersonalizationVersion"] is None
    assert ai04.status_code == 200 and warning in ai04.json()["warnings"]
    assert ai04.json()["hrPersonalized"] is False and ai04.json()["hrPersonalizationVersion"] is None


def test_user_id_absent_preserves_response_and_skips_lookup(real_gru, monkeypatch):
    monkeypatch.setenv("AI_DB_URL", "postgresql://fake")
    lookup = StaticLookup(GruPersonalizationResult(warning=NOT_FOUND_WARNING))
    with app_client(real_gru, lookup) as client:
        ai03 = client.post("/v1/hr/predict", json=prediction_body())
        ai04 = client.post("/v1/pace/decide", json=decide_body())
    assert ai03.status_code == 200 and "X-RunWay-Warnings" not in ai03.headers
    assert "hrPersonalized" not in ai03.json() and "hrPersonalizationVersion" not in ai03.json()
    assert ai04.status_code == 200 and ai04.json()["warnings"] == []
    assert "hrPersonalized" not in ai04.json() and "hrPersonalizationVersion" not in ai04.json()
    assert lookup.calls == []


def test_ai03_and_ai04_apply_valid_user_head(real_gru, monkeypatch):
    # v6_8 (D): GRU 개인화 기본값이 꺼짐(false)으로 바뀌었다. 이 테스트는 켠 상태의 동작을 보므로 명시적으로 켠다.
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "true")
    monkeypatch.setenv("AI_DB_URL", "postgresql://fake")
    state = shifted_state(real_gru, 1.2)
    lookup = StaticLookup(GruPersonalizationResult(state=state, personalization_version=8))

    # v6_8 (A): AI04는 userId가 있으면 학습 심박 기준도 DB에서 읽는다. 가짜 AI_DB_URL은 시작 때 연결이 실패해
    # 기준 조회기가 없으므로 HR_THRESHOLD_LOOKUP_UNAVAILABLE 경고가 붙는 것이 맞다(러닝은 계속, 모집단 값 사용).
    # 이 테스트는 GRU 출력층만 보므로 "기준 행 없음"을 돌려주는 조회기를 넣어 경고 없는 상태를 만든다.
    from app.hr_threshold_lookup import HrThresholdLookupResult

    class NoThresholdRow:
        def get_for_user(self, _user_id):
            return HrThresholdLookupResult()

    with app_client(real_gru, lookup, hr_threshold_lookup=NoThresholdRow()) as client:
        ai03 = client.post("/v1/hr/predict", json=prediction_body(73))
        ai04_body = decide_body()
        ai04_body["userId"] = 73
        ai04 = client.post("/v1/pace/decide", json=ai04_body)
    assert ai03.status_code == 200 and ai03.json()["hrPersonalized"] is True
    assert ai03.json()["hrPersonalizationVersion"] == 8
    assert ai04.status_code == 200 and ai04.json()["hrPersonalized"] is True
    assert ai04.json()["hrPersonalizationVersion"] == 8
    assert ai04.json()["warnings"] == []


def test_model_info_reports_gru_personalization_support(real_gru, monkeypatch):
    monkeypatch.setenv("AI_DB_URL", "postgresql://fake")
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "true")
    with app_client(real_gru, StaticLookup(GruPersonalizationResult())) as client:
        models = client.get("/v1/model-info").json()["models"]["gru"]
    assert models["personalizationSupported"] is True
    assert models["personalizationEnabled"] is True
    assert models["personalizationSchemaVersion"] == GRU_PERSONALIZATION_SCHEMA_VERSION

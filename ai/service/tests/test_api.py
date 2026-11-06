"""API 테스트. 기본은 가짜 모델이라 체크포인트 없이 돈다. models/gru_final.pt가 있으면 실제 GRU도 확인한다."""
import numpy as np
import pytest
from types import SimpleNamespace
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app
from app.models.base import ModelInfo

FUT = 24


class FakeModel:
    info = ModelInfo(model_type="fake", model_version="fake-1", window_sec=360, min_samples=1,
                     missing_policy={"hr0": "t0 심박이 없으면 INPUT_INSUFFICIENT"})

    def __init__(self):
        self.batches = []

    def predict(self, batch):
        self.batches.append(batch)
        hr0 = batch["hr"][:, -1]
        speed = batch["future_speed"].mean(1)
        return hr0[:, None] + speed[:, None] * np.array([1.0, 2.0, 3.0])


class FakeODE:
    info = SimpleNamespace(model_version="ode-test", model_type="ODE-v2.1", variant="test",
                           checkpoint_sha256="0" * 64, summary_feature_count=27, hr0_head=False,
                           device="cpu", validated_horizon_sec=5400, sample_interval_sec=30,
                           horizons_sec=(30, 60, 120))


def failing_loader():
    raise FileNotFoundError("체크포인트가 없습니다")


def body(n_hist=80, candidates=None, **history):
    hist = {"hrBpm": [150.0] * n_hist, "speedMps": [3.0] * n_hist, "gradePct": [0.0] * n_hist, **history}
    if candidates is None:
        candidates = [{"futureSpeedMps": [v] * FUT, "futureGradePct": [0.0] * FUT} for v in (2.8, 3.0, 3.2)]
    return {"elapsedSec": 995.0, "history": hist, "candidates": candidates}


@pytest.fixture
def fake():
    return FakeModel()


@pytest.fixture
def client(fake):
    with TestClient(create_app(lambda: fake, ode_loader=lambda: FakeODE())) as c:
        yield c


def test_health_up(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "UP" and r.json()["modelLoaded"] is True
    assert r.json()["models"]["gru"]["modelVersion"] == "fake-1"
    assert r.json()["models"]["ode"]["modelVersion"] == "ode-test"
    assert r.json()["components"]["gru"] == "UP"
    assert r.json()["components"]["ode"] == "UP"
    assert r.json()["components"]["aiDb"] == "NOT_CONFIGURED"


def test_health_down_when_model_missing():
    with TestClient(create_app(failing_loader, ode_loader=lambda: FakeODE())) as c:
        health = c.get("/health")
        assert health.status_code == 503
        assert health.json()["status"] == "DOWN"
        assert health.json()["models"]["gru"]["status"] == "DOWN"
        assert health.json()["models"]["ode"]["status"] == "UP"
        assert health.json()["components"]["gru"] == "DOWN"
        assert health.json()["components"]["ode"] == "UP"
        r = c.post("/v1/hr/predict", json=body())
        assert r.status_code == 503 and r.json()["code"] == "MODEL_NOT_READY"


def test_health_reports_database_and_plan_component_states(monkeypatch):
    monkeypatch.setenv("AI_DB_URL", "postgresql://unit.test/runway")
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    calls = []

    def db_factory(_url):
        calls.append("연결")
        return object()

    with TestClient(create_app(lambda: FakeModel(), ode_loader=lambda: None,
                               db_factory=db_factory, cue_bpm_loader=None)) as c:
        components = c.get("/health").json()["components"]

    assert calls == ["연결"]
    assert components["aiDb"] == "CONFIGURED"
    assert components["personalPlan"] == {
        "enabled": True,
        "populationMode": "median_bundle",
        "populationBundleLoaded": False,
    }
    assert components["cueBpm"] == "DISABLED"


def test_health_reports_database_connection_failure_without_exposing_url(monkeypatch):
    monkeypatch.setenv("AI_DB_URL", "postgresql://unit.test/runway")

    def fail_db_factory(_url):
        raise RuntimeError("연결 실패")

    with TestClient(create_app(lambda: FakeModel(), ode_loader=lambda: None,
                               db_factory=fail_db_factory, cue_bpm_loader=None)) as c:
        response = c.get("/health")

    assert response.status_code == 200
    assert response.json()["components"]["aiDb"] == "CONNECT_FAILED"
    assert "unit.test" not in response.text


def test_health_reports_unavailable_cue_bpm_module_as_down():
    def fail_cue_loader():
        raise RuntimeError("모듈 준비 실패")

    with TestClient(create_app(lambda: FakeModel(), ode_loader=lambda: None,
                               cue_bpm_loader=fail_cue_loader)) as c:
        components = c.get("/health").json()["components"]

    assert components["cueBpm"] == "DOWN"


def test_model_info(client):
    r = client.get("/v1/model-info").json()
    assert r["stepSec"] == 5 and r["futureSteps"] == 24 and r["horizonsSec"] == [30, 60, 120]
    assert r["requiredMetrics"] == ["hrBpm", "speedMps", "gradePct"] and r["minSamples"] == 1


def test_predict(client, fake):
    r = client.post("/v1/hr/predict", json=body())
    assert r.status_code == 200
    out = r.json()
    assert out["modelVersion"] == "fake-1" and out["horizonsSec"] == [30, 60, 120]
    assert [p["hrBpm"] for p in out["predictions"]] == [[152.8, 155.6, 158.4], [153.0, 156.0, 159.0], [153.2, 156.4, 159.6]]
    batch = fake.batches[-1]
    assert batch["hr"].shape == (3, 80) and batch["future_speed"].shape == (3, FUT)
    assert batch["segment"] is None and np.all(batch["elapsed_s"] == 995.0)


def test_unknown_future_grade_goes_to_nan_rows(client, fake):
    candidates = [{"futureSpeedMps": [3.0] * FUT, "futureGradePct": [1.0] * FUT},
                  {"futureSpeedMps": [3.0] * FUT, "futureGradePct": None},
                  {"futureSpeedMps": [3.0] * FUT, "futureGradePct": [1.0] * 23 + [None]}]
    out = client.post("/v1/hr/predict", json=body(candidates=candidates)).json()
    assert [p["futureGradeUsed"] for p in out["predictions"]] == [True, False, False]
    grade = fake.batches[-1]["future_grade"]
    assert not np.isnan(grade[0]).any() and np.isnan(grade[1]).all() and np.isnan(grade[2]).all()


def test_null_history_cells_become_nan(client, fake):
    hr = [150.0] * 79 + [151.0]
    hr[10] = None
    client.post("/v1/hr/predict", json=body(hrBpm=hr, segmentId=[0] * 40 + [1] * 40))
    batch = fake.batches[-1]
    assert np.isnan(batch["hr"][0, 10]) and batch["segment"].shape == (3, 80)


@pytest.mark.parametrize("override, field", [
    ({"speedMps": [3.0] * 79}, "history"),                                       # 길이 다름
    ({"speedMps": [-1.0] * 80}, "history"),                                      # 음수 속도
    ({"hrBpm": []}, "history.hrBpm"),                                            # 빈 기록
])
def test_validation_error(client, override, field):
    r = client.post("/v1/hr/predict", json=body(**override))
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"
    assert any(f["name"].startswith(field) for f in r.json()["details"]["fields"])


def test_validation_error_future_length(client):
    r = client.post("/v1/hr/predict", json=body(candidates=[{"futureSpeedMps": [3.0] * 23}]))
    assert r.status_code == 400 and r.json()["code"] == "VALIDATION_ERROR"


def test_insufficient_without_hr0(client):
    r = client.post("/v1/hr/predict", json=body(hrBpm=[150.0] * 79 + [None]))
    assert r.status_code == 422 and r.json()["code"] == "INPUT_INSUFFICIENT"


def test_insufficient_without_complete_rows(fake, monkeypatch):
    # 팀 기존 계약은 FREE_RUN_GRADE_POLICY=reject로 유지·검증한다. 기본값(flat0)은 tests/test_free_run_grade.py.
    monkeypatch.setenv("FREE_RUN_GRADE_POLICY", "reject")
    with TestClient(create_app(lambda: fake, ode_loader=lambda: FakeODE())) as c:
        r = c.post("/v1/hr/predict", json=body(n_hist=3, gradePct=[None, None, None]))
    assert r.status_code == 422 and r.json()["code"] == "INPUT_INSUFFICIENT"


def _real_gru_path():
    # 찾는 순서(v6_8 E): ① RUNWAY_TEST_ARTIFACTS_DIR/gru_final.pt ② HR_MODEL_PATH ③ models/gru_final.pt
    import os
    from pathlib import Path
    artifact_dir = os.getenv("RUNWAY_TEST_ARTIFACTS_DIR")
    if artifact_dir and (Path(artifact_dir) / "gru_final.pt").is_file():
        return Path(artifact_dir) / "gru_final.pt"
    path = load_settings().model_path
    return path if path.is_file() else None


@pytest.mark.skipif(_real_gru_path() is None,
                    reason="실제 GRU 체크포인트 없음(RUNWAY_TEST_ARTIFACTS_DIR, HR_MODEL_PATH, models/gru_final.pt 확인)")
def test_real_gru(monkeypatch):
    monkeypatch.setenv("HR_MODEL_PATH", str(_real_gru_path()))
    monkeypatch.delenv("HR_MODEL_SHA256", raising=False)
    with TestClient(create_app()) as c:
        assert c.get("/health").json()["modelLoaded"]
        info = c.get("/v1/model-info").json()
        assert info["modelType"] == "gru" and info["windowSec"] == 360
        candidates = [{"futureSpeedMps": [v] * FUT, "futureGradePct": [0.0] * FUT} for v in (2.6, 2.9, 3.2, 3.5, 3.8)]
        candidates.append({"futureSpeedMps": [3.2] * FUT, "futureGradePct": None})
        out = c.post("/v1/hr/predict", json=body(candidates=candidates)).json()
        hr = np.array([p["hrBpm"] for p in out["predictions"]])
        assert hr.shape == (6, 3) and np.isfinite(hr).all()
        assert (np.diff(hr[:5, 2]) >= -0.5).all()            # 빠른 pace일수록 HR@120이 높다
        assert [p["futureGradeUsed"] for p in out["predictions"]] == [True] * 5 + [False]

"""API 테스트. 기본은 가짜 모델이라 체크포인트 없이 돈다. models/gru_final.pt가 있으면 실제 GRU도 확인한다."""
import numpy as np
import pytest
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
    with TestClient(create_app(lambda: fake)) as c:
        yield c


def test_health_up(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "UP", "modelLoaded": True, "modelVersion": "fake-1"}


def test_health_down_when_model_missing():
    with TestClient(create_app(failing_loader)) as c:
        assert c.get("/health").status_code == 503
        r = c.post("/v1/hr/predict", json=body())
        assert r.status_code == 503 and r.json()["code"] == "MODEL_NOT_READY"


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


def test_insufficient_without_complete_rows(client):
    r = client.post("/v1/hr/predict", json=body(n_hist=3, gradePct=[None, None, None]))
    assert r.status_code == 422 and r.json()["code"] == "INPUT_INSUFFICIENT"


@pytest.mark.skipif(not load_settings().model_path.is_file(), reason="models/gru_final.pt 없음")
def test_real_gru():
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

"""자유러닝(과거 경사 전부 없음) 처리 스위치 FREE_RUN_GRADE_POLICY 테스트."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from demo_fakes import FakeModel5, FakePolicy, decide_body, fixed_clock
from test_api import FakeModel, FakeODE, body

FREE_HISTORY = {"gradePct": [None] * 80}
NULL_FUTURE = [{"futureSpeedMps": [3.0] * 24, "futureGradePct": None}]


def _client(fake, monkeypatch, policy=None):
    if policy is None:
        monkeypatch.delenv("FREE_RUN_GRADE_POLICY", raising=False)
    else:
        monkeypatch.setenv("FREE_RUN_GRADE_POLICY", policy)
    return TestClient(create_app(lambda: fake, ode_loader=lambda: FakeODE()))


def _warnings(response):
    return response.headers.get("X-RunWay-Warnings", "").split(",")


def test_default_free_run_is_flat0_and_uses_the_future_grade_model(monkeypatch):
    # 사용자 확정(2026-11-02): 코스 없이 달리면 거절하지 않고 0% 평지(flat0)로 본다 → 메인 모델 M3-005.
    fake = FakeModel()
    with _client(fake, monkeypatch) as client:
        response = client.post("/v1/hr/predict", json=body(candidates=NULL_FUTURE, **FREE_HISTORY))

    assert response.status_code == 200
    assert set(response.json()) == {"modelVersion", "horizonsSec", "predictions"}
    assert response.json()["predictions"][0]["futureGradeUsed"] is True
    batch = fake.batches[-1]
    assert (batch["grade"] == 0).all()
    assert (batch["future_grade"] == 0).all()
    assert "FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL" in _warnings(response)
    assert "FREE_RUN_HISTORY_GRADE_FILLED_0" in _warnings(response)


def test_flat0_policy_fills_future_grade_and_reports_it_as_used(monkeypatch):
    fake = FakeModel()
    with _client(fake, monkeypatch, "flat0") as client:
        response = client.post("/v1/hr/predict", json=body(candidates=NULL_FUTURE, **FREE_HISTORY))

    assert response.status_code == 200
    assert response.json()["predictions"][0]["futureGradeUsed"] is True
    assert (fake.batches[-1]["future_grade"] == 0).all()
    assert "FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL" in _warnings(response)


def test_unknown_policy_is_still_selectable_and_keeps_future_grade_null(monkeypatch):
    fake = FakeModel()
    with _client(fake, monkeypatch, "unknown") as client:
        response = client.post("/v1/hr/predict", json=body(candidates=NULL_FUTURE, **FREE_HISTORY))

    assert response.status_code == 200
    assert response.json()["predictions"][0]["futureGradeUsed"] is False
    batch = fake.batches[-1]
    assert (batch["grade"] == 0).all()
    assert np.isnan(batch["future_grade"]).all()
    assert "FREE_RUN_GRADE_POLICY_UNKNOWN_PROVISIONAL" in _warnings(response)


def test_reject_policy_keeps_the_team_insufficient_contract(monkeypatch):
    with _client(FakeModel(), monkeypatch, "reject") as client:
        response = client.post("/v1/hr/predict", json=body(candidates=NULL_FUTURE, **FREE_HISTORY))

    assert response.status_code == 422 and response.json()["code"] == "INPUT_INSUFFICIENT"


def test_partial_grade_gaps_on_a_course_are_not_treated_as_free_run(monkeypatch):
    fake = FakeModel()
    grade = [0.5] * 79 + [None]
    with _client(fake, monkeypatch) as client:
        response = client.post("/v1/hr/predict", json=body(gradePct=grade))

    assert response.status_code == 200
    assert np.isnan(fake.batches[-1]["grade"][0, -1])
    assert "X-RunWay-Warnings" not in response.headers


def test_free_run_still_requires_measured_hr_and_speed(monkeypatch):
    with _client(FakeModel(), monkeypatch) as client:
        response = client.post("/v1/hr/predict", json=body(
            n_hist=3, gradePct=[None] * 3, speedMps=[None] * 3, candidates=NULL_FUTURE))

    assert response.status_code == 422 and response.json()["code"] == "INPUT_INSUFFICIENT"


def test_unknown_policy_name_fails_at_startup(monkeypatch):
    monkeypatch.setenv("FREE_RUN_GRADE_POLICY", "zero")
    with pytest.raises(ValueError):
        create_app(lambda: FakeModel(), ode_loader=lambda: FakeODE())


def test_decide_free_run_returns_a_decision_with_provisional_warning(monkeypatch):
    monkeypatch.delenv("FREE_RUN_GRADE_POLICY", raising=False)
    request = decide_body(history=dict(FREE_HISTORY), mode="FREE", routeProgressM=None)
    for candidate in request["candidates"]:
        candidate["futureGradePct"] = None
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0))) as client:
        response = client.post("/v1/pace/decide", json=request)

    assert response.status_code == 200
    assert response.json()["status"] != "INPUT_INSUFFICIENT"
    assert "FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL" in response.json()["warnings"]
    assert "FREE_RUN_HISTORY_GRADE_FILLED_0" in response.json()["warnings"]

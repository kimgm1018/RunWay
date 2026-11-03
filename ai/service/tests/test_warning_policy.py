"""v6_8_1 작은 버그 수정 회귀 테스트.

1. GRU 개인화·학습 심박 기준: "설정상 꺼짐/없음"이면 경고·호출별 로그가 없고, "켰는데 실패"면 경고가 있다.
2. 계획이 있는 t0 한 칸 PLAN_HOLD 응답에는 자유러닝 경고를 붙이지 않는다(일반 경로는 그대로).
3. ODE 기본 파일명은 배포 이름(ode_epoch_020.pt, ode_summary_stats.json)이고, env 경로 동작은 그대로다.
"""
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.ode import runtime as ode_runtime
from demo_fakes import FakeModel5, FakePolicy, decide_body, fixed_clock

FREE_RUN_WARNINGS = {"FREE_RUN_GRADE_POLICY_FLAT0_PROVISIONAL", "FREE_RUN_HISTORY_GRADE_FILLED_0"}
REPO_ROOT = Path(__file__).resolve().parents[3]


def _predict_body(user_id=None):
    body = {
        "elapsedSec": 995.0,
        "history": {"hrBpm": [150.0] * 80, "speedMps": [3.0] * 80, "gradePct": [0.0] * 80},
        "candidates": [{"futureSpeedMps": [s] * 24, "futureGradePct": [0.0] * 24} for s in (2.9, 3.0, 3.1)],
    }
    if user_id is not None:
        body["userId"] = user_id
    return body


def _decide_body_with_user(user_id=73):
    body = decide_body()
    body["userId"] = user_id
    return body


class RecordingGruLookup:
    """호출 여부를 기록한다. raise_error=True면 DB 실패를 흉내 낸다."""

    def __init__(self, raise_error=False):
        self.raise_error = raise_error
        self.calls = []

    def get_for_model(self, user_id, model):
        self.calls.append(user_id)
        if self.raise_error:
            raise TimeoutError("db timeout")
        raise AssertionError("이 테스트에서는 성공 조회를 쓰지 않는다")


class NoThresholdRow:
    def get_for_user(self, _user_id):
        from app.hr_threshold_lookup import HrThresholdLookupResult
        return HrThresholdLookupResult()


def _broken_db_factory(_url):
    raise ConnectionError("cannot connect")


def _app(**kwargs):
    return create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0),
                      ode_loader=lambda: None, **kwargs)


def _runway_messages(caplog, level=logging.WARNING):
    return [r.getMessage() for r in caplog.records if r.name == "runway.ai" and r.levelno >= level]


# --- 1. GRU 개인화 꺼짐/켬 구분 -------------------------------------------------------

def test_gru_personalization_off_with_user_id_has_no_warning_lookup_or_log(monkeypatch, caplog):
    monkeypatch.delenv("GRU_PERSONALIZATION_ENABLED", raising=False)   # 기본값 false
    monkeypatch.setenv("AI_DB_URL", "postgresql://configured")
    lookup = RecordingGruLookup()
    caplog.set_level(logging.INFO, logger="runway.ai")
    with TestClient(_app(gru_personalization_lookup=lookup, hr_threshold_lookup=NoThresholdRow(),
                         db_factory=lambda _url: object())) as client:
        ai03 = client.post("/v1/hr/predict", json=_predict_body(73))
        ai04 = client.post("/v1/pace/decide", json=_decide_body_with_user(73))

    assert ai03.status_code == 200 and "X-RunWay-Warnings" not in ai03.headers
    assert ai03.json()["hrPersonalized"] is False and ai03.json()["hrPersonalizationVersion"] is None
    assert ai04.status_code == 200
    assert not [w for w in ai04.json()["warnings"] if w.startswith("GRU_PERSONALIZATION")]
    assert ai04.json()["hrPersonalized"] is False
    assert lookup.calls == []
    assert not [m for m in _runway_messages(caplog) if "GRU_PERSONALIZATION" in m]
    # 꺼짐은 시작 로그(INFO)로 한 번만 남는다.
    assert sum("GRU 개인화 꺼짐" in r.getMessage() for r in caplog.records) == 1


def test_gru_personalization_on_with_db_failure_keeps_warning_and_log(monkeypatch, caplog):
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "true")
    monkeypatch.setenv("AI_DB_URL", "postgresql://configured")
    lookup = RecordingGruLookup(raise_error=True)
    caplog.set_level(logging.WARNING, logger="runway.ai")
    with TestClient(_app(gru_personalization_lookup=lookup, hr_threshold_lookup=NoThresholdRow(),
                         db_factory=lambda _url: object())) as client:
        ai03 = client.post("/v1/hr/predict", json=_predict_body(73))
        ai04 = client.post("/v1/pace/decide", json=_decide_body_with_user(73))

    assert ai03.status_code == 200
    assert "GRU_PERSONALIZATION_UNAVAILABLE" in ai03.headers.get("X-RunWay-Warnings", "")
    assert ai04.status_code == 200 and "GRU_PERSONALIZATION_UNAVAILABLE" in ai04.json()["warnings"]
    assert lookup.calls == [73, 73]
    assert any("code=GRU_PERSONALIZATION_UNAVAILABLE" in m for m in _runway_messages(caplog))


def test_gru_personalization_on_without_db_url_keeps_warning(monkeypatch, caplog):
    # 켰는데 DB 주소가 없으면 설정 오류이므로 지금처럼 경고를 붙인다(꺼짐과 구분).
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "true")
    monkeypatch.delenv("AI_DB_URL", raising=False)
    caplog.set_level(logging.WARNING, logger="runway.ai")
    with TestClient(_app()) as client:
        ai03 = client.post("/v1/hr/predict", json=_predict_body(73))
        ai04 = client.post("/v1/pace/decide", json=_decide_body_with_user(73))

    assert "GRU_PERSONALIZATION_UNAVAILABLE" in ai03.headers.get("X-RunWay-Warnings", "")
    assert "GRU_PERSONALIZATION_UNAVAILABLE" in ai04.json()["warnings"]
    assert any("code=GRU_PERSONALIZATION_UNAVAILABLE" in m for m in _runway_messages(caplog))


# --- 1-b. 학습 심박 기준: 설정상 DB 없음 vs 연결 실패 -----------------------------------

def test_hr_threshold_without_ai_db_url_is_silent_and_logged_once_at_startup(monkeypatch, caplog):
    monkeypatch.delenv("AI_DB_URL", raising=False)
    monkeypatch.delenv("GRU_PERSONALIZATION_ENABLED", raising=False)
    caplog.set_level(logging.INFO, logger="runway.ai")
    with TestClient(_app()) as client:
        responses = [client.post("/v1/pace/decide", json=_decide_body_with_user(73)) for _ in range(3)]

    for response in responses:
        assert response.status_code == 200
        assert "HR_THRESHOLD_LOOKUP_UNAVAILABLE" not in response.json()["warnings"]
        assert response.json()["pacing"]["hrThresholdSource"] == "POPULATION"
        assert response.json()["warnings"] == []
    assert not _runway_messages(caplog)   # WARNING 이상 로그 없음
    assert sum("학습 심박 기준을 조회하지 않고" in r.getMessage() for r in caplog.records) == 1


def test_hr_threshold_with_ai_db_url_but_connection_failure_keeps_warning(monkeypatch):
    monkeypatch.setenv("AI_DB_URL", "postgresql://configured")
    monkeypatch.delenv("GRU_PERSONALIZATION_ENABLED", raising=False)
    with TestClient(_app(db_factory=_broken_db_factory)) as client:
        response = client.post("/v1/pace/decide", json=_decide_body_with_user(73))

    assert response.status_code == 200
    assert "HR_THRESHOLD_LOOKUP_UNAVAILABLE" in response.json()["warnings"]
    assert not [w for w in response.json()["warnings"] if w.startswith("GRU_PERSONALIZATION")]


# --- 2. 0초 1칸 PLAN_HOLD 자유러닝 경고 -----------------------------------------------

def _one_cell_body(*, with_plan=True, grade=None):
    body = decide_body(
        activeSec=0.0, distanceM=0.0, routeProgressM=0.0,
        anchorPaceSecPerKm=263.9, currentGuidePaceSecPerKm=263.9,
        goal={"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": 263.9},
        plan=[{"startM": 0, "endM": 5000, "ratio": 1.0}] if with_plan else None,
    )
    body["history"] = {"hrBpm": [150.0], "speedMps": [1000 / 314], "gradePct": [grade]}
    return body


def test_one_cell_plan_hold_in_course_mode_has_no_free_run_warnings(monkeypatch):
    monkeypatch.delenv("FREE_RUN_GRADE_POLICY", raising=False)   # 기본 flat0
    model = FakeModel5()
    with TestClient(create_app(lambda: model, lambda: FakePolicy(), clock=fixed_clock(0.0),
                               ode_loader=lambda: None)) as client:
        response = client.post("/v1/pace/decide", json=_one_cell_body())

    payload = response.json()
    assert response.status_code == 200 and payload["status"] == "OK"
    assert payload["pacing"]["handoverPhase"] == "PLAN_HOLD"
    assert payload["warnings"] == ["HISTORY_TOO_SHORT_PLAN_HOLD"]
    assert not FREE_RUN_WARNINGS & set(payload["warnings"])
    assert model.batches == []   # GRU 예측을 하지 않는 경로


def test_general_path_free_run_rule_is_unchanged_for_one_cell_without_plan(monkeypatch):
    # 계획이 없으면 같은 1칸도 일반 예측 경로라, 경사가 모두 비면 지금처럼 자유러닝 경고가 붙는다.
    monkeypatch.delenv("FREE_RUN_GRADE_POLICY", raising=False)
    model = FakeModel5()
    with TestClient(create_app(lambda: model, lambda: FakePolicy(), clock=fixed_clock(0.0),
                               ode_loader=lambda: None)) as client:
        response = client.post("/v1/pace/decide", json=_one_cell_body(with_plan=False))

    assert response.status_code == 200 and len(model.batches) == 1
    assert FREE_RUN_WARNINGS <= set(response.json()["warnings"])


# --- 3. ODE 기본 파일명 ---------------------------------------------------------------

def test_ode_default_file_names_match_deployment_example():
    assert Path(ode_runtime.DEFAULT_CHECKPOINT_PATH).name == "ode_epoch_020.pt"
    assert Path(ode_runtime.DEFAULT_STATS_PATH).name == "ode_summary_stats.json"
    infra_env = REPO_ROOT / "infra" / "ai" / ".env.example"
    service_env = REPO_ROOT / "ai" / "service" / ".env.example"
    for path in (infra_env, service_env):
        if not path.is_file():
            pytest.skip(f"{path} 없음")
        text = path.read_text(encoding="utf-8")
        assert "ode_epoch_020.pt" in text and "ode_summary_stats.json" in text
        assert "ODEV21_CHECKPOINT_PATH=models/ode/model_epoch_020.pt" not in text


def test_ode_default_path_prefers_new_name_and_falls_back_to_legacy(tmp_path, monkeypatch):
    env = "RUNWAY_TEST_ODE_PATH_V68_1"
    monkeypatch.delenv(env, raising=False)
    new, legacy = tmp_path / "ode_epoch_020.pt", tmp_path / "model_epoch_020.pt"

    # 둘 다 없으면 새 기본 이름(파일 없음 → 런타임은 None)
    assert ode_runtime._default_or_env_path(env, str(new), str(legacy)) == new
    # 예전 이름만 있으면 예전 로컬 설치를 그대로 읽는다
    legacy.write_bytes(b"x")
    assert ode_runtime._default_or_env_path(env, str(new), str(legacy)) == legacy
    # 새 이름이 있으면 새 이름
    new.write_bytes(b"x")
    assert ode_runtime._default_or_env_path(env, str(new), str(legacy)) == new


def test_ode_env_path_behaviour_is_unchanged(tmp_path, monkeypatch):
    env = "RUNWAY_TEST_ODE_PATH_V68_1"
    legacy = tmp_path / "model_epoch_020.pt"
    legacy.write_bytes(b"x")
    explicit = tmp_path / "custom.pt"
    monkeypatch.setenv(env, str(explicit))
    assert ode_runtime._default_or_env_path(env, str(tmp_path / "ode_epoch_020.pt"), str(legacy)) == explicit
    # Compose의 빈 값(${ODEV21_CHECKPOINT_PATH:-})은 예전처럼 "파일 없음"이 되어 ODE를 찾지 않는다.
    monkeypatch.setenv(env, "")
    resolved = ode_runtime._default_or_env_path(env, str(tmp_path / "ode_epoch_020.pt"), str(legacy))
    assert resolved == ode_runtime._service_path("") and not resolved.is_file()


def test_ode_runtime_returns_none_when_default_files_are_absent(monkeypatch):
    monkeypatch.setenv("ODEV21_CHECKPOINT_PATH", "")
    monkeypatch.setenv("ODEV21_SUMMARY_STATS_PATH", "")
    assert ode_runtime.ODEv21Runtime.from_environment() is None

"""신규 사용자 평균 묶음(population bundle)을 같은 ODE 계획 경로로 쓰는지 확인한다."""
import hashlib
import json
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db_lookup import COURSE_SQL, PERSONALIZATION_SQL, DbUserPersonalizationLookup
from app.main import create_app
from app.population_bundle import load_population_bundle
from demo_fakes import FakeModel5, FakePolicy
from test_db_lookup import FakeDb, SqlFailDb, course_row, personalization_row
from test_personal_plan_ode import RecordingOdeRuntime

MODEL = "ode-fixture-v1"


def bundle_payload(**overrides):
    payload = {
        "schemaVersion": "runway.ode.personalization.v1", "userId": None, "modelVersion": MODEL,
        "personalizationVersion": None, "supportRunCount": 0,
        "summaryU": {"prev_hr_mean": 148.8, "warm_rise": [22.0] * 20, "hr_ref": 173.0},
        "hrRefBpm": 173.0, "history8": [[0.45, 2.0, 3.0, 0.0, 3.0]] * 4,
        "p4": [-0.004, 0.012, 0.006, -0.002], "hr0SubBpm": 87.0,
        "population": {"bundleKind": "POPULATION_MEDIAN", "policy": "v2train-per-user-median-v1",
                       "trainSubjectCount": 545, "trainRunCount": 39360},
    }
    payload.update(overrides)
    return payload


def write_bundle(tmp_path, payload=None):
    path = tmp_path / "population_bundle.json"
    path.write_text(json.dumps(payload or bundle_payload()), encoding="utf-8")
    return path, hashlib.sha256(path.read_bytes()).hexdigest()


class PopulationRuntime(RecordingOdeRuntime):
    """신규 사용자 HR0는 묶음 값(87)이다. 받은 payload·결측 표시를 기록한다."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self.calls = []

    def pre_run_predictor(self, personalization, support_start_hr_median_bpm, drop_personal_inputs=False):
        self.calls.append((personalization, support_start_hr_median_bpm, drop_personal_inputs))
        runtime = self

        class Predictor:
            capabilities = SimpleNamespace(supports_personalization=True,
                                           validated_prerun_horizon_s=runtime.info.validated_horizon_sec)

            def simulate_pre_run(self, request):
                rows = tuple(tuple(100.0 + 14.0 * s + 0.8 * g for s, g in zip(speeds, grades))
                             for speeds, grades in zip(request.future_speed_mps, request.future_grade_pct))
                return SimpleNamespace(hr_bpm=rows, model_name="ODE-fixture",
                                       model_version=runtime.info.model_version, personalized=True, warnings=())
        return Predictor()


def new_user_db(**extra):
    rows = {COURSE_SQL: course_row(distance=Decimal("2000.00"))}
    rows.update(extra)
    return FakeDb(rows)


def _app(monkeypatch, tmp_path, db, *, mode=None, runtime=None, payload=None, sha=None):
    monkeypatch.setenv("AI_DB_URL", "postgresql://configured")
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    path, digest = write_bundle(tmp_path, payload)
    monkeypatch.setenv("ODEV21_POPULATION_BUNDLE_PATH", str(path))
    monkeypatch.setenv("ODEV21_POPULATION_BUNDLE_SHA256", sha or digest)
    if mode is None:
        monkeypatch.delenv("PERSONAL_PLAN_POPULATION_MODE", raising=False)
    else:
        monkeypatch.setenv("PERSONAL_PLAN_POPULATION_MODE", mode)
    runtime = runtime or PopulationRuntime()
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: runtime,
                     db_factory=lambda url: db)
    return app, runtime, digest


def _plan(app):
    with TestClient(app) as client:
        return client.post("/v1/pace/personal-plan", json={"userId": 73, "courseId": 297})


def test_new_user_gets_an_average_based_ode_plan_from_the_median_bundle(monkeypatch, tmp_path):
    app, runtime, digest = _app(monkeypatch, tmp_path, new_user_db())
    response = _plan(app)

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["planStatus"] == "AVERAGE_BASED" and body["personalized"] is False
    assert body["planSource"] == "POPULATION_MEDIAN_ODE"
    assert body["policyVersion"] == "v2train-per-user-median-v1"
    assert body["modelVersion"] == MODEL
    assert body["trainSubjectCount"] == 545 and body["trainRunCount"] == 39360
    assert body["personalizationBundleSha256"] == digest
    assert "AVERAGE_BASED_RECOMMENDATION" in body["warnings"] and "PERSONALIZED=false" in body["warnings"]
    payload, hr0, dropped = runtime.calls[-1]
    assert payload["userId"] == 73 and payload["p4"] == bundle_payload()["p4"]
    assert hr0 == 87.0 and dropped is False


def test_new_user_hr_reference_uses_learned_population_sustain_threshold(monkeypatch, tmp_path):
    db = new_user_db()
    app, _, _ = _app(monkeypatch, tmp_path, db)
    body = _plan(app).json()

    # 나이·RHR 계산을 없애고 모집단 P85 지속 심박 163을 쓴다.
    assert body["hrReferenceBpm"] == 163.0
    assert body["hrReferenceSource"] == "LEARNED_POPULATION"
    assert all(sql not in {"SELECT birth_date FROM users WHERE id = %(user_id)s"} for sql, _ in db.calls)
    assert all("daily_health_metrics" not in sql for sql, _ in db.calls)


def test_new_user_plan_no_longer_requires_birth_date(monkeypatch, tmp_path):
    app, _, _ = _app(monkeypatch, tmp_path, new_user_db())
    response = _plan(app)

    # 나이·RHR SQL 의존을 없애 개인 학습 기준이 없어도 모집단 기준으로 계획을 만든다.
    assert response.status_code == 200
    assert response.json()["hrReferenceSource"] == "LEARNED_POPULATION"


def test_missing_personalization_table_uses_the_bundle_with_a_warning(monkeypatch, tmp_path):
    db = SqlFailDb(new_user_db().rows, fail_sql=PERSONALIZATION_SQL, sqlstate="42P01")
    app, _, _ = _app(monkeypatch, tmp_path, db)
    response = _plan(app)

    assert response.status_code == 200, response.json()
    assert response.json()["planStatus"] == "AVERAGE_BASED"
    assert "PERSONALIZATION_TABLE_MISSING" in response.json()["warnings"]


def test_empty_mode_drops_personal_inputs_like_g0(monkeypatch, tmp_path):
    app, runtime, _ = _app(monkeypatch, tmp_path, new_user_db(), mode="empty")
    response = _plan(app)

    assert response.status_code == 200, response.json()
    assert response.json()["planSource"] == "POPULATION_EMPTY_G0_ODE"
    assert response.json()["personalized"] is False
    _, hr0, dropped = runtime.calls[-1]
    assert dropped is True and hr0 == 87.0


def test_off_mode_keeps_the_previous_503(monkeypatch, tmp_path):
    app, _, _ = _app(monkeypatch, tmp_path, new_user_db(), mode="off")
    response = _plan(app)

    assert response.status_code == 503 and response.json()["code"] == "PERSONAL_PLAN_NOT_READY"
    assert {"name": "readiness", "reason": "POPULATION_MEAN_MODEL_NOT_CONFIGURED"} \
        in response.json()["details"]["fields"]


def test_bundle_sha_mismatch_fails_at_startup(monkeypatch, tmp_path):
    with pytest.raises(ValueError, match="SHA256"):
        _app(monkeypatch, tmp_path, new_user_db(), sha="0" * 64)


def test_bundle_model_version_mismatch_fails_at_startup(monkeypatch, tmp_path):
    app, _, _ = _app(monkeypatch, tmp_path, new_user_db(),
                     payload=bundle_payload(modelVersion="other-model"))
    with pytest.raises(RuntimeError, match="modelVersion"):
        with TestClient(app):
            pass


def test_unknown_population_mode_fails_at_startup(monkeypatch, tmp_path):
    with pytest.raises(ValueError):
        _app(monkeypatch, tmp_path, new_user_db(), mode="guess")


def test_existing_personalized_user_still_uses_their_own_bundle(monkeypatch, tmp_path):
    from test_db_lookup import personalization_row
    db = new_user_db(**{PERSONALIZATION_SQL: personalization_row(model_version=MODEL)})
    app, runtime, _ = _app(monkeypatch, tmp_path, db, runtime=PopulationRuntime())
    body = _plan(app).json()

    assert body["planStatus"] == "EXPERIMENTAL" and body["personalized"] is True
    assert runtime.calls[-1][1] == 120.0


def test_personal_plan_blends_stored_learned_sustain_threshold(monkeypatch, tmp_path):
    row = personalization_row(hr_danger_bpm=Decimal("195.00"), hr_sustain_bpm=Decimal("180.00"),
                              hr_threshold_run_count=2)
    db = new_user_db(**{PERSONALIZATION_SQL: row})
    app, _, _ = _app(monkeypatch, tmp_path, db)

    body = _plan(app).json()

    assert body["hrReferenceBpm"] == 171.5
    assert body["hrReferenceSource"] == "LEARNED_BLENDED"


def test_new_user_lookup_has_no_birth_date_or_resting_hr_dependency():
    db = new_user_db()
    snapshot = DbUserPersonalizationLookup(db).get_personalization(73)

    assert snapshot is not None and snapshot.payload is None
    assert snapshot.hr_danger_bpm is None and snapshot.hr_sustain_bpm is None
    assert snapshot.warnings == ()
    assert [sql for sql, _ in db.calls] == [PERSONALIZATION_SQL]


def test_loader_rejects_a_bundle_with_the_wrong_schema(tmp_path):
    path, digest = write_bundle(tmp_path, bundle_payload(schemaVersion="other"))
    with pytest.raises(ValueError):
        load_population_bundle(str(path), digest)

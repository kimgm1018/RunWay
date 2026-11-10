from fastapi.testclient import TestClient
from app.main import create_app
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import decide_body, FakeModel5, FakePolicy, fixed_clock, flat_table, write_margin_table


def client(policy=None, after=3.0):
    return TestClient(create_app(lambda: FakeModel5(), lambda: policy if policy is not None else FakePolicy(), clock=fixed_clock(after)))


def test_decide_200_shape():
    with client() as c:
        r = c.post("/v1/pace/decide", json=decide_body())
    assert r.status_code == 200
    assert set(r.json()) == {"traceId", "modelVersion", "policyVersion", "status", "gate", "publishSuggested", "decision",
                             "candidates", "pacing", "warnings", "forecast"}
    assert len(r.json()["candidates"]) == 9 and r.json()["traceId"] is None


def test_decide_uses_learned_population_thresholds_and_ignores_hr_reference_values():
    # 나이·RHR·HRmax 입력은 호환을 위해 받지만, 학습 심박 기준 계산에는 쓰지 않는다.
    policy = MpcPolicy(load_policy_config(), flat_table(0.0))
    with TestClient(create_app(lambda: FakeModel5(), lambda: policy, clock=fixed_clock())) as c:
        first = decide_body(hrReference={"hrMaxBpm": 190, "rhrBpm": 50, "ageYears": 25,
                                         "recentPeakHrBpm": 200, "recentRunCount": 5})
        second = decide_body(hrReference={"hrMaxBpm": 160, "rhrBpm": 80, "ageYears": 60,
                                          "recentPeakHrBpm": None, "recentRunCount": 0})
        a = c.post("/v1/pace/decide", json=first).json()
        b = c.post("/v1/pace/decide", json=second).json()

    assert a["decision"]["recommendedPaceSecPerKm"] == b["decision"]["recommendedPaceSecPerKm"]
    # 위험 기준 = 모집단 P98 175 + 3(v6_8 (b), 섞은 뒤 더함) = 178. 응답 hrDangerBpm은 +3까지 반영한 값이다.
    assert a["pacing"]["hrDangerBpm"] == b["pacing"]["hrDangerBpm"] == 178.0
    assert a["pacing"]["hrSustainBpm"] == b["pacing"]["hrSustainBpm"] == 163.0
    assert a["pacing"]["hrThresholdSource"] == "POPULATION"
    assert a["pacing"]["hrThresholdWeight"] == 0.0
    assert "HR_REFERENCE_INPUT_IGNORED" in a["warnings"]


def test_decide_hr_threshold_database_failure_falls_back_without_failing_run():
    class BrokenLookup:
        def get_for_user(self, _user_id):
            raise TimeoutError

    policy = MpcPolicy(load_policy_config(), flat_table(0.0))
    body = decide_body()
    body["userId"] = 73
    with TestClient(create_app(lambda: FakeModel5(), lambda: policy, clock=fixed_clock(),
                               hr_threshold_lookup=BrokenLookup())) as c:
        response = c.post("/v1/pace/decide", json=body)

    payload = response.json()
    assert response.status_code == 200
    assert (payload["pacing"]["hrDangerBpm"], payload["pacing"]["hrSustainBpm"]) == (178.0, 163.0)   # P98 175 + 3
    assert payload["pacing"]["hrThresholdSource"] == "POPULATION"
    assert "HR_THRESHOLD_LOOKUP_UNAVAILABLE" in payload["warnings"]


def test_decide_400_and_422():
    with client(after=25.0) as c:
        b = decide_body(); b["candidates"] = b["candidates"][:4]
        assert c.post("/v1/pace/decide", json=b).json()["code"] == "VALIDATION_ERROR"
        r = c.post("/v1/pace/decide", json=decide_body())
        assert r.status_code == 422 and r.json()["code"] == "INPUT_INSUFFICIENT"


def _one_cell_plan_body(hr=150.0, *, active_sec=0.0, with_plan=True, speed=1000 / 314):
    # 출발 직후라 거리는 0 m다. 처음 입력은 decide_body 기본 distanceM 2310이 남아 "0초에 2.3 km"가 되었고,
    # 계획 pace(남은 시간 ÷ 남은 거리 × ratio)가 490.5로 계산됐다(코드가 아니라 입력 오류).
    body = decide_body(
        activeSec=active_sec,
        distanceM=active_sec / 314 * 1000,
        routeProgressM=active_sec / 314 * 1000,
        anchorPaceSecPerKm=263.9,
        currentGuidePaceSecPerKm=263.9,
        goal={"targetDistanceM": 5000, "targetDurationSec": None, "targetPaceSecPerKm": 263.9},
        plan=[{"startM": 0, "endM": 5000, "ratio": 1.0}] if with_plan else None,
    )
    body["context"]["hrReference"] = {"hrMaxBpm": 190, "rhrBpm": 50, "ageYears": 25,
                                       "recentPeakHrBpm": 200, "recentRunCount": 5}
    body["history"] = {"hrBpm": [hr], "speedMps": [speed], "gradePct": [0.0]}
    return body


def test_plan_hold_accepts_one_t0_cell_and_skips_gru_prediction():
    model = FakeModel5()
    with TestClient(create_app(lambda: model, lambda: FakePolicy(), clock=fixed_clock(0.0))) as c:
        response = c.post("/v1/pace/decide", json=_one_cell_plan_body())

    payload = response.json()
    assert response.status_code == 200
    assert payload["status"] == "OK" and payload["pacing"]["handoverPhase"] == "PLAN_HOLD"
    assert payload["decision"]["recommendedPaceSecPerKm"] == 263.9
    assert payload["candidates"] == [] and model.batches == []
    assert "HISTORY_TOO_SHORT_PLAN_HOLD" in payload["warnings"]
    assert "HR_REFERENCE_INPUT_IGNORED" in payload["warnings"]


def test_one_cell_plan_hold_uses_t0_hr_for_safety():
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(0.0))) as c:
        # 위험 기준 = 모집단 P98 175 + 3 = 178(v6_8 (b)). 177은 계획 유지, 178은 SAFETY.
        below = c.post("/v1/pace/decide", json=_one_cell_plan_body(hr=177.0)).json()
        response = c.post("/v1/pace/decide", json=_one_cell_plan_body(hr=178.0))

    assert below["status"] == "OK" and below["decision"]["recommendedPaceSecPerKm"] == 263.9
    payload = response.json()
    assert payload["pacing"]["hrDangerBpm"] == 178.0
    assert response.status_code == 200 and payload["status"] == "SAFETY"
    assert payload["decision"]["action"] == "EASE_OFF"
    assert payload["decision"]["predictedHr30Bpm"] is None


def test_one_cell_without_plan_or_after_hold_keeps_422():
    # 기존 계약: 심박·속도·경사가 모두 있는 칸이 모델 min_samples(GRU·가짜 모델 모두 1)보다 적으면 422다.
    # 시연 t=0의 422도 t0 칸의 속도가 비어 "완전한 칸 0개"였던 경우다. 그래서 속도 없는 t0 1칸으로 확인한다.
    # (처음 테스트는 완전한 1칸을 써서, 기존 계약대로면 200이 맞는 입력이었다.)
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(0.0))) as c:
        no_plan = c.post("/v1/pace/decide", json=_one_cell_plan_body(with_plan=False, speed=None))
        after_hold = c.post("/v1/pace/decide", json=_one_cell_plan_body(active_sec=60.0, speed=None))
        in_hold = c.post("/v1/pace/decide", json=_one_cell_plan_body(speed=None))
        complete_no_plan = c.post("/v1/pace/decide", json=_one_cell_plan_body(with_plan=False))

    assert no_plan.status_code == 422 and no_plan.json()["code"] == "INPUT_INSUFFICIENT"
    assert after_hold.status_code == 422 and after_hold.json()["code"] == "INPUT_INSUFFICIENT"
    # 같은 입력이라도 계획이 있고 넘겨주기 단계면 200 + 계획 pace다(C).
    assert in_hold.status_code == 200 and in_hold.json()["decision"]["recommendedPaceSecPerKm"] == 263.9
    # 계획 없는 완전한 1칸은 기존처럼 모델 예측으로 간다(바뀌지 않음).
    assert complete_no_plan.status_code == 200 and len(complete_no_plan.json()["candidates"]) == 9


def test_one_cell_with_missing_hr_still_uses_the_plan_during_hold():
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(0.0))) as c:
        response = c.post("/v1/pace/decide", json=_one_cell_plan_body(hr=None))

    payload = response.json()
    assert response.status_code == 200 and payload["status"] == "OK"
    assert payload["pacing"]["handoverPhase"] == "PLAN_HOLD"
    assert payload["decision"]["recommendedPaceSecPerKm"] == 263.9


def test_decide_503_without_policy():
    with TestClient(create_app(lambda: FakeModel5(), lambda: None)) as c:
        r = c.post("/v1/pace/decide", json=decide_body())
    assert r.status_code == 503 and r.json() == {"code": "MODEL_NOT_READY", "message": "정책이 로드되지 않았습니다.", "details": None}


def test_requested_forecast_returns_model_not_ready_when_ode_is_unavailable(monkeypatch):
    monkeypatch.setenv("DECIDE_FORECAST_ENABLED", "true")
    # 고정 입력시각(demo_fakes.T0) 3초 뒤 시계를 넣어, 실제 시각과 무관하게 20초 신선도 검사를 통과시킨다.
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0),
                               ode_loader=lambda: None)) as c:
        request = decide_body()
        request["includeForecast"] = True
        response = c.post("/v1/pace/decide", json=request)
    assert response.status_code == 503
    assert response.json()["code"] == "MODEL_NOT_READY"
    assert set(response.json()) == {"code", "message", "details"}


def test_model_info_policy_version():
    with client() as c:
        assert c.get("/v1/model-info").json()["policyVersion"] == "fake-policy-1"


def test_load_policy(tmp_path):
    from dataclasses import replace
    from app.decide.loader import load_policy
    from app.config import load_settings
    s = load_settings()
    assert load_policy(replace(s, margin_table_path=None)) is None
    assert load_policy(replace(s, margin_table_path=tmp_path / "none.json")) is None
    path = write_margin_table(tmp_path, model="GRU")
    assert load_policy(replace(s, margin_table_path=path, model_type="gru")).policy_version == "mpc-v0.5.0"
    assert load_policy(replace(s, margin_table_path=path, model_type="tf")) is None


def test_decide_danger_threshold_adds_three_after_blending_personal_row():
    # v6_8 (b) 사용자 확정: 위험 기준 = (개인 P98 × w + 모집단 P98 × (1 − w)) + 3. DB 값은 +3 전 원값이다.
    from app.hr_threshold_lookup import HrThresholdLookupResult

    class Row:
        def get_for_user(self, _user_id):
            return HrThresholdLookupResult(hr_danger_bpm=190.0, hr_sustain_bpm=170.0, hr_threshold_run_count=2)

    policy = MpcPolicy(load_policy_config(), flat_table(0.0))
    body = decide_body()
    body["userId"] = 73
    with TestClient(create_app(lambda: FakeModel5(), lambda: policy, clock=fixed_clock(),
                               hr_threshold_lookup=Row())) as c:
        payload = c.post("/v1/pace/decide", json=body).json()

    assert payload["pacing"]["hrThresholdSource"] == "BLENDED" and payload["pacing"]["hrThresholdWeight"] == 0.5
    assert payload["pacing"]["hrDangerBpm"] == 0.5 * 190 + 0.5 * 175 + 3      # 185.5
    assert payload["pacing"]["hrSustainBpm"] == 0.5 * 170 + 0.5 * 163         # 166.5, +3 없음

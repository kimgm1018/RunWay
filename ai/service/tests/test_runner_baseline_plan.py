"""S15P31E105-403: AI09가 온보딩 러닝 프로필 기준으로 완주시간을 정하는지 끝까지 확인한다."""
from fastapi.testclient import TestClient
import pytest

from app.main import create_app
from app.personal_plan import OdeBalancedPaceOptimizer
from app.runner_baseline import RunnerProfile, riegel
from demo_fakes import FakeModel5, FakePolicy
from test_personal_plan_ode import RecordingOdeRuntime, _bundle
from test_personal_plan_service import CourseLookup, PersonalLookup, PopulationLookup, _configure_average_bundle

DISTANCE = 2345.678
BAND = "HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN"


class ProfileLookup:
    def __init__(self, profile=None, warnings=(), past_runs=0, count_warning=None):
        self.profile, self.warnings = profile, tuple(warnings)
        self.past_runs, self.count_warning = past_runs, count_warning
        self.calls, self.count_calls = [], []

    def get_profile(self, user_id):
        self.calls.append(user_id)
        return self.profile, self.warnings

    def get_past_run_count(self, user_id, *, cutoff):
        self.count_calls.append((user_id, cutoff))
        return self.past_runs, self.count_warning


class CountingOptimizer(OdeBalancedPaceOptimizer):
    def __init__(self):
        super().__init__()
        self.selects = 0

    def select(self, **kwargs):
        self.selects += 1
        return super().select(**kwargs)


def _post(profile_lookup, *, personal=None, json=None, optimizer=None, population=None):
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), ode_loader=lambda: RecordingOdeRuntime(),
                     personal_plan_course_lookup=CourseLookup(), personal_plan_user_lookup=PersonalLookup(personal),
                     personal_plan_optimizer=optimizer or OdeBalancedPaceOptimizer(),
                     personal_plan_population_lookup=population, runner_profile_lookup=profile_lookup)
    with TestClient(app) as client:
        return client.post("/v1/pace/personal-plan", json=json or {"userId": 73, "courseId": 297})


def _ratios(body):
    return [s["paceRatio"] for s in body["segments"]]


def test_new_user_typed_record_sets_finish_by_riegel_with_one_ode_solve(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    before = _post(None).json()
    optimizer = CountingOptimizer()
    lookup = ProfileLookup(RunnerProfile("INTERMEDIATE", 348.0, 5000.0, 1740.0))
    response = _post(lookup, optimizer=optimizer)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert optimizer.selects == 1                                    # ODE는 한 번만 푼다
    assert body["planStatus"] == "AVERAGE_BASED" and body["personalized"] is False
    assert abs(body["predictedFinishSec"] - riegel(1740, 5000, DISTANCE)) <= 1
    # 경사 모양은 목표 없는 ODE 계획 그대로(공통 배율), 2자리 반올림 차이만.
    assert _ratios(body) == pytest.approx(_ratios(before), abs=0.011)
    for warning in ("RUNNER_BASELINE_SOURCE=DISTANCE_TIME", "RUNNER_BASELINE_KIND=TYPED",
                    "RUNNER_BASELINE_WEIGHT=1.000", "RUNNER_BASELINE_PAST_RUNS=0"):
        assert warning in body["warnings"]
    assert lookup.calls == [73] and lookup.count_calls[0][0] == 73


def test_level_only_user_uses_level_reference(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    body = _post(ProfileLookup(RunnerProfile("BEGINNER", 400.0, 3000.0, 1200.0))).json()
    assert abs(body["predictedFinishSec"] - riegel(1200, 3000, DISTANCE)) <= 1
    assert "RUNNER_BASELINE_KIND=LEVEL" in body["warnings"]


@pytest.mark.parametrize("past_runs,personal_weight", [(1, 1 / 6), (3, 3 / 8), (5, 1 / 2)])
def test_past_runs_blend_ode_plan_with_baseline(monkeypatch, tmp_path, past_runs, personal_weight):
    _configure_average_bundle(monkeypatch, tmp_path)
    ode = _post(None).json()
    optimizer = CountingOptimizer()
    body = _post(ProfileLookup(RunnerProfile("ADVANCED", 320.0), past_runs=past_runs), optimizer=optimizer).json()
    base = 320 * 10 * (DISTANCE / 10000) ** 1.06
    expected = personal_weight * ode["predictedFinishSec"] + (1 - personal_weight) * base
    assert optimizer.selects == 1
    assert abs(body["predictedFinishSec"] - expected) <= 2
    assert f"RUNNER_BASELINE_WEIGHT={1 - personal_weight:.3f}" in body["warnings"]
    assert _ratios(body) == pytest.approx(_ratios(ode), abs=0.011)


def test_personal_ode_path_also_blends_with_one_solve(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    user = _bundle()
    ode = _post(None, personal=user).json()
    optimizer = CountingOptimizer()
    body = _post(ProfileLookup(RunnerProfile("ADVANCED", 320.0), past_runs=5), personal=user,
                 optimizer=optimizer).json()
    assert optimizer.selects == 1
    assert body["personalized"] is True and body["planSource"] == "PERSONAL_ODE_HR_BALANCE"
    base = 320 * 10 * (DISTANCE / 10000) ** 1.06
    assert abs(body["predictedFinishSec"] - (0.5 * ode["predictedFinishSec"] + 0.5 * base)) <= 2


def test_train_mean_population_path_is_scaled_too():
    before = _post(None, population=PopulationLookup()).json()
    body = _post(ProfileLookup(RunnerProfile("BEGINNER", 400.0)), population=PopulationLookup()).json()
    assert body["planStatus"] == "AVERAGE_BASED"
    assert abs(body["predictedFinishSec"] - riegel(1200, 3000, DISTANCE)) <= 1
    assert _ratios(body) == pytest.approx(_ratios(before), abs=0.011)


def test_band_warning_follows_the_scaled_plan(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    # 아주 느린 기준(9'00"/km)으로 늘리면 HR 기준 band에서 벗어나므로 최종 계획 기준으로 경고한다.
    body = _post(ProfileLookup(RunnerProfile("BEGINNER", 540.0))).json()
    assert body["hrReferenceBandSatisfied"] is False
    assert body["warnings"].count(BAND) == 1


def test_count_failure_means_baseline_100_percent_with_warning(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    body = _post(ProfileLookup(RunnerProfile("BEGINNER", 400.0),
                               count_warning="RUNNER_PAST_RUNS_LOOKUP_UNAVAILABLE")).json()
    assert "RUNNER_PAST_RUNS_LOOKUP_UNAVAILABLE" in body["warnings"]
    assert abs(body["predictedFinishSec"] - riegel(1200, 3000, DISTANCE)) <= 1


def test_user_selected_goal_wins_and_profile_is_not_read(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    lookup = ProfileLookup(RunnerProfile("BEGINNER", 400.0))
    body = _post(lookup, json={"userId": 73, "courseId": 297,
                               "selectedGoal": {"targetPaceSecPerKm": 360}}).json()
    assert lookup.calls == []
    assert not any(w.startswith("RUNNER_BASELINE") for w in body["warnings"])


def test_no_user_id_does_not_read_profile(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    lookup = ProfileLookup(RunnerProfile("BEGINNER", 400.0))
    assert _post(lookup, json={"courseId": 297}).status_code == 200
    assert lookup.calls == []


@pytest.mark.parametrize("warning", ["RUNNER_PROFILE_LOOKUP_UNAVAILABLE", "RUNNER_PROFILE_NOT_SET",
                                     "RUNNER_PROFILE_TABLE_MISSING"])
def test_profile_failure_keeps_previous_plan_and_only_warns(monkeypatch, tmp_path, warning):
    _configure_average_bundle(monkeypatch, tmp_path)
    before = _post(None).json()
    lookup = ProfileLookup(None, [warning])
    after = _post(lookup).json()
    assert after["segments"] == before["segments"]
    assert warning in after["warnings"]
    assert lookup.count_calls == []


def test_switch_off_restores_previous_behavior(monkeypatch, tmp_path):
    _configure_average_bundle(monkeypatch, tmp_path)
    before = _post(None).json()
    monkeypatch.setenv("PERSONAL_PLAN_RUNNER_BASELINE_ENABLED", "false")
    lookup = ProfileLookup(RunnerProfile("BEGINNER", 400.0))
    after = _post(lookup).json()
    assert after == before and lookup.calls == []


def test_invalid_k_env_fails_startup(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_RUNNER_BASELINE_K_TYPED", "-2")
    with pytest.raises(ValueError):
        create_app(lambda: FakeModel5(), lambda: FakePolicy())

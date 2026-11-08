from dataclasses import replace
from types import SimpleNamespace

import numpy as np
import pytest

from app.target_calibration import DEFAULT_GLOBAL_RATIO
from app.inference import ApiError
from app.ode_schemas import PlanGradeSegment
from app.policy.config import load_policy_config
from app.personal_plan import (
    CoursePlanSnapshot,
    OdeBalancedPaceOptimizer,
    PersonalPlanRequest,
    ResolvedGoal,
    UserPersonalizationSnapshot,
    build_personal_plan,
    finalize_personal_segments,
    finish_sec_from_segments,
    resolve_selected_goal,
    split_distance_1km,
)


class RecordingOdeRuntime:
    """Deterministic ODE boundary fixture; production verification also needs the real checkpoint."""

    def __init__(self, *, nonfinite=False, horizon_sec=5400):
        self.info = SimpleNamespace(model_version="ode-fixture-v1", validated_horizon_sec=horizon_sec,
                                    hr0_head=False)
        self.nonfinite = nonfinite
        self.requests = []

    def pre_run_predictor(self, personalization, support_start_hr_median_bpm):
        runtime = self

        class Predictor:
            capabilities = SimpleNamespace(supports_personalization=True,
                                           validated_prerun_horizon_s=runtime.info.validated_horizon_sec)

            def simulate_pre_run(self, request):
                runtime.requests.append(request)
                predictions = []
                for speeds, grades in zip(request.future_speed_mps, request.future_grade_pct):
                    row = [100.0 + 14.0 * speed + 0.8 * grade for speed, grade in zip(speeds, grades)]
                    if runtime.nonfinite:
                        row[0] = float("nan")
                    predictions.append(tuple(row))
                return SimpleNamespace(hr_bpm=tuple(predictions), model_name="ODE-fixture",
                                       model_version=runtime.info.model_version, personalized=True,
                                       warnings=("test fixture: no measured HR0",))

        assert support_start_hr_median_bpm == 120.0
        return Predictor()


def _bundle(*, speeds=(3.0, 3.5, 4.0, 4.5, 5.0), user_id=73):
    history = [[0.0, i / 10.0, speed, 0.0, 0.0] for i, speed in enumerate(speeds)]
    return UserPersonalizationSnapshot(
        user_id=user_id,
        payload={
            "schemaVersion": "runway.ode.personalization.v1",
            "userId": user_id,
            "modelVersion": "ode-fixture-v1",
            "supportRunCount": 4,
            "summaryU": {"prev_start_hr": 120.0},
            "p4": [0.1, -0.1, 0.05, 0.0],
            "history8": history,
            "hrRefBpm": 155.0,
            "hr0SubBpm": 120.0,
        },
        # 강도 목표(지속 기준)를 옛 픽스처와 같은 147 bpm으로 둔다.
        # 옛 픽스처: HRmax 170·RHR 55 → HRR 80% = 147(지속), 90% = 158.5(hard).
        # 이 가짜 ODE는 HR = 100 + 14×속도라 탐색 상한 4.1272 m/s(242.3초/km)에서도 157.8 bpm까지만 나온다.
        # 처음 v6_8 값(개인 195/180, 2회 → 지속 171.5)은 이 범위 밖이라 모든 km가 탐색 하한 242.3에 붙었다.
        # 코드 버그가 아니라 픽스처가 닿을 수 없는 목표였다. 5회 이상(w=1, PERSONAL)이면 개인 값이 그대로 목표다.
        hr_danger_bpm=158.5,
        hr_sustain_bpm=147.0,
        hr_threshold_run_count=5,
    )


def _course(distance=2000, grades=((0, 1000, 0), (1000, 2000, 5))):
    return CoursePlanSnapshot(
        course_id=297,
        distance_m=distance,
        grade_profile=tuple(PlanGradeSegment(startDistanceM=start, endDistanceM=end,
                                             gradePercent=grade)
                            for start, end, grade in grades),
        version="course-v1",
    )


def test_ode_personalized_plan_uses_ordered_grade_to_change_km_paces(monkeypatch):
    # 경사 반영만 본다. 첫 구간 제약이 켜져 있으면 2 km 코스(평지 → 오르막)에서 첫 km를 둘째 km(=나머지 평균)
    # 까지 올려 두 km pace가 같아진다(아래 test_first_km_cap_flattens_a_two_km_uphill_finish).
    monkeypatch.setenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", "false")
    runtime = RecordingOdeRuntime()
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(), goal=None, personalization=_bundle(), ode_runtime=runtime
    )

    segments = finalize_personal_segments(2000, None, selection.segment_paces_sec_per_km,
                                         preserve_goal_duration=False)

    assert selection.personalized is True
    assert selection.model_version == runtime.info.model_version
    assert selection.hr0_used is False
    assert selection.policy_validated is False
    assert len(runtime.requests) > 1
    assert segments[1].pace_sec_per_km > segments[0].pace_sec_per_km
    assert all(np.isfinite(value) and value > 0 for value in selection.segment_paces_sec_per_km)


def test_goal_duration_is_preserved_and_final_serialized_plan_is_replayed_through_ode():
    runtime = RecordingOdeRuntime()
    goal = ResolvedGoal(distance_m=2000, target_pace_sec_per_km=300,
                        predicted_finish_sec=600, target_pace_source="TARGET_DURATION")
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(), goal=goal, personalization=_bundle(), ode_runtime=runtime
    )
    segments = finalize_personal_segments(2000, 300, selection.segment_paces_sec_per_km,
                                         preserve_goal_duration=True)
    finish_sec = finish_sec_from_segments(segments)

    assert abs(finish_sec - 600) <= 1
    assert selection.goal_duration_preserved is True
    final_speeds = runtime.requests[-1].future_speed_mps[0]
    assert len(final_speeds) > 0
    assert all(np.isfinite(value) and value > 0 for value in final_speeds)


def test_build_compares_goal_to_explicit_duration_when_ai05_route_ratios_change_eta(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    runtime = RecordingOdeRuntime()
    course = _course(2000, grades=((0, 1000, 4), (1000, 2000, -2)))
    course = CoursePlanSnapshot(
        course_id=course.course_id,
        distance_m=course.distance_m,
        grade_profile=(
            PlanGradeSegment(startDistanceM=0, endDistanceM=1000, gradePercent=4,
                             basePaceRatio=1.4),
            PlanGradeSegment(startDistanceM=1000, endDistanceM=2000, gradePercent=-2,
                             basePaceRatio=0.8),
        ),
        version=course.version,
    )

    class CourseLookup:
        def get_course(self, course_id):
            return course if course_id == course.course_id else None

    class UserLookup:
        def get_personalization(self, user_id):
            return _bundle(user_id=user_id)

    result = build_personal_plan(
        PersonalPlanRequest.model_validate({
            "userId": 73,
            "courseId": 297,
            "selectedGoal": {"targetDistanceM": 2000, "targetDurationSec": 600},
        }),
        course_lookup=CourseLookup(),
        personalization_lookup=UserLookup(),
        optimizer=OdeBalancedPaceOptimizer(),
        population_lookup=None,
        ode_runtime=runtime,
    )

    assert result.predicted_finish_sec == 600
    assert abs(result.target_pace_sec_per_km - 300.0) < 0.01
    assert result.hr_reference_validated is False


def test_ode_optimizer_rejects_nonfinite_forward_output_instead_of_returning_a_pace():
    runtime = RecordingOdeRuntime(nonfinite=True)

    with pytest.raises(ApiError) as error:
        OdeBalancedPaceOptimizer().select(
            course=_course(), goal=None, personalization=_bundle(), ode_runtime=runtime
        )

    assert error.value.code == "PERSONAL_PLAN_PREDICTION_INVALID"


def test_ode_optimizer_rejects_missing_personal_ode_support_instead_of_claiming_personalized():
    runtime = RecordingOdeRuntime()
    bundle = _bundle()
    bundle.payload["supportRunCount"] = 0

    with pytest.raises(ApiError) as error:
        OdeBalancedPaceOptimizer().select(
            course=_course(), goal=None, personalization=bundle, ode_runtime=runtime
        )

    assert error.value.code == "PERSONALIZATION_NOT_SUPPORTED"


def test_route_direction_is_used_when_building_the_forward_ode_grade_profile():
    runtime = RecordingOdeRuntime()
    course = _course(2000, grades=((0, 1000, -5), (1000, 2000, 5)))
    selection = OdeBalancedPaceOptimizer().select(
        course=course, goal=None, personalization=_bundle(), ode_runtime=runtime
    )

    first, second = runtime.requests[-1].future_grade_pct[0][0], runtime.requests[-1].future_grade_pct[0][-1]
    assert first < 0 < second
    assert selection.personalized is True


def test_unvalidated_hr_band_is_reported_but_does_not_block_best_effort_plan():
    runtime = RecordingOdeRuntime()
    config = replace(load_policy_config(), band_bpm=0.01)
    selection = OdeBalancedPaceOptimizer(policy_config=config).select(
        course=_course(), goal=None, personalization=_bundle(), ode_runtime=runtime
    )

    assert selection.personalized is True
    assert selection.hr_reference_band_satisfied is False
    assert selection.hr_reference_band_bpm == 0.01
    assert "HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN" in selection.warnings


@pytest.mark.parametrize("danger, sustain, runs, expected, source", [
    (158.5, 147.0, 5, 147.0, "LEARNED_PERSONAL"),
    # 2회(w=0.5): 0.5×131 + 0.5×163(모집단 P85) = 147.
    (150.0, 131.0, 2, 147.0, "LEARNED_BLENDED"),
    (None, None, 0, 163.0, "LEARNED_POPULATION"),
])
def test_goal_free_plan_uses_learned_sustain_threshold_and_source(danger, sustain, runs, expected, source):
    bundle = replace(_bundle(), hr_danger_bpm=danger, hr_sustain_bpm=sustain, hr_threshold_run_count=runs)
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(), goal=None, personalization=bundle, ode_runtime=RecordingOdeRuntime()
    )

    # 목표가 없을 때 나이·RHR 기준 대신 모집단과 개인 P85를 섞은 지속값을 강도 목표로 쓴다.
    # 위험 기준 +3(v6_8 (b))은 지속 기준에는 더하지 않으므로 계획 목표는 바뀌지 않는다.
    # S15P31E105-377: 지난 러닝 평균 심박이 없으면(n=0) 목표 = 일반화 비율 0.9422 × 섞은 P85.
    assert selection.hr_reference_bpm == pytest.approx(DEFAULT_GLOBAL_RATIO * expected)
    assert selection.hr_reference_source == source


def test_reachable_learned_target_keeps_the_plan_off_the_search_boundary():
    # 목표 147은 가짜 ODE 범위(최대 157.8) 안이라 계획이 탐색 하한(가장 빠른 242.3초/km)에 붙지 않는다.
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(), goal=None, personalization=_bundle(), ode_runtime=RecordingOdeRuntime()
    )
    assert min(selection.segment_paces_sec_per_km) > 242.3 + 1.0
    assert "PACE_SEARCH_DOMAIN_BOUNDARY_HIT_BEST_EFFORT" not in selection.warnings


def test_first_split_can_use_the_full_common_search_domain():
    runtime = RecordingOdeRuntime()
    bundle = replace(
        _bundle(),
        hr_danger_bpm=220.0,
        hr_sustain_bpm=175.0,
        hr_threshold_run_count=5,
    )
    flat = _course(2000, grades=((0, 2000, 0),))
    selection = OdeBalancedPaceOptimizer().select(
        course=flat, goal=None, personalization=bundle, ode_runtime=runtime
    )

    assert selection.segment_paces_sec_per_km[0] < 1000 / 3.4485
    assert selection.pace_search_support_scope == "FITREC_HR_V1_TRAIN_STUDY_NOT_V2_VALIDATED"


class TransientOdeRuntime(RecordingOdeRuntime):
    """HR starts low and approaches a speed-dependent level, like a real warm-up rise."""

    def pre_run_predictor(self, personalization, support_start_hr_median_bpm):
        runtime = self

        class Predictor:
            def simulate_pre_run(self, request):
                runtime.requests.append(request)
                rows = []
                for speeds, grades in zip(request.future_speed_mps, request.future_grade_pct):
                    rows.append(tuple(100.0 + 14.0 * s + 0.8 * g - 25.0 * np.exp(-i / 3.0)
                                      for i, (s, g) in enumerate(zip(speeds, grades))))
                return SimpleNamespace(hr_bpm=tuple(rows), model_name="ODE-fixture",
                                       model_version=runtime.info.model_version, personalized=True,
                                       warnings=())

        return Predictor()


def test_short_final_remainder_is_not_slowed_to_dilute_the_held_tail_hr():
    runtime = TransientOdeRuntime()
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(1010, grades=((0, 1010, 0),)), goal=None,
        personalization=_bundle(), ode_runtime=runtime,
    )

    first, remainder = selection.segment_paces_sec_per_km
    assert remainder == first


def _beyond(selection):
    return "ODE_BEYOND_VALIDATED_HORIZON" in selection.warnings


def test_evaluated_prerun_horizon_is_90_minutes_and_is_information_only():
    from app.models.ode.runtime import DEFAULT_VALIDATED_HORIZON_SEC
    from app.personal_plan import _EVALUATED_PRERUN_HORIZON_SEC

    assert _EVALUATED_PRERUN_HORIZON_SEC == 5400.0 and DEFAULT_VALIDATED_HORIZON_SEC == 5400


def test_21km_course_is_planned_with_a_beyond_validated_horizon_warning():
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(21100, grades=((0, 21100, 0),)), goal=None,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime(),
    )
    duration = sum(float(end - start) * pace / 1000 for (start, end), pace
                   in zip(split_distance_1km(21100), selection.segment_paces_sec_per_km))

    assert len(selection.segment_paces_sec_per_km) == 22
    assert duration > 5400 and _beyond(selection)
    assert selection.validated_horizon_sec == 5400.0
    assert "ODE_VALIDATED_HORIZON_LIMITED_PACE_SEARCH" not in selection.warnings


def test_long_goal_beyond_90_minutes_is_planned_not_rejected():
    goal = ResolvedGoal(distance_m=14000, target_pace_sec_per_km=420, predicted_finish_sec=5880,
                        target_pace_source="TARGET_PACE", target_finish_sec=5880)
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(14000, grades=((0, 14000, 0),)), goal=goal,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime(),
    )

    assert len(selection.segment_paces_sec_per_km) == 14 and _beyond(selection)


def test_30_minute_course_has_no_beyond_horizon_warning():
    goal = ResolvedGoal(distance_m=5000, target_pace_sec_per_km=360, predicted_finish_sec=1800,
                        target_pace_source="TARGET_PACE", target_finish_sec=1800)
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(5000, grades=((0, 5000, 0),)), goal=goal,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime(),
    )

    assert not _beyond(selection) and selection.validated_horizon_sec == 5400.0


def test_a_short_runtime_horizon_setting_does_not_block_the_plan():
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(10000, grades=((0, 10000, 0),)), goal=None,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime(horizon_sec=2400),
    )

    assert len(selection.segment_paces_sec_per_km) == 10


@pytest.mark.parametrize("distance", [45001, 100000])
def test_oversized_course_is_rejected_by_the_computation_guard(distance):
    course = _course(distance, grades=((0, distance, 0),))
    with pytest.raises(ApiError) as goal_error:
        resolve_selected_goal(None, course)
    with pytest.raises(ApiError) as select_error:
        OdeBalancedPaceOptimizer().select(course=course, goal=None, personalization=_bundle(),
                                          ode_runtime=RecordingOdeRuntime())

    assert goal_error.value.code == "INVALID_GOAL" and select_error.value.code == "INVALID_GOAL"


def test_model_info_reports_the_90_minute_default_when_ode_is_not_ready(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from test_api import FakeModel, failing_loader

    monkeypatch.delenv("ODEV21_VALIDATED_HORIZON_SEC", raising=False)
    with TestClient(create_app(lambda: FakeModel(), ode_loader=failing_loader)) as client:
        ode = client.get("/v1/model-info").json()["models"]["ode"]

    assert ode == {"status": "NOT_READY", "validatedHorizonSec": 5400}


# --- 계산 예산(PLAN_SEARCH_BUDGET_LIMITED) ----------------------------------------
# 예산 도입 전 코드로 같은 픽스처를 돌려 얻은 pace(5·10 km는 그대로여야 한다).
_BEFORE_BUDGET = {
    (5000, 1): [297.28, 297.28, 297.28, 297.28, 297.28],
    (5000, 2): [316.08, 316.08, 306.39, 288.7, 288.7],
    (10000, 1): [306.39, 297.28, 297.28, 297.28, 297.28, 297.28, 297.28, 297.28, 297.28, 297.28],
    (10000, 2): [316.08, 316.08, 316.08, 316.08, 316.08, 289.98, 289.98, 288.7, 288.7, 288.7],
}


def _target_calibration_off(monkeypatch):
    # _BEFORE_BUDGET은 목표 심박 보정(S15P31E105-377) 전 값이다. 비율 1.0·k=inf면 예전과 bit 단위로 같아야 한다.
    monkeypatch.setenv("PERSONAL_PLAN_TARGET_HR_GLOBAL_RATIO", "1.0")
    monkeypatch.setenv("PERSONAL_PLAN_TARGET_HR_K", "inf")


def _grades(distance, kind):
    return ((0, distance, 0),) if kind == 1 else ((0, distance // 2, 3), (distance // 2, distance, -2))


@pytest.mark.parametrize("distance, kind", sorted(_BEFORE_BUDGET))
def test_short_courses_are_unchanged_by_the_search_budget(distance, kind, monkeypatch):
    # 예산 회귀만 본다(제약을 끈 순수 탐색 결과). 이 픽스처에서는 제약을 켜도 결과가 같다(아래 테스트).
    monkeypatch.delenv("PERSONAL_PLAN_SEARCH_BUDGET_CELLS", raising=False)
    monkeypatch.setenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", "false")
    # _BEFORE_BUDGET은 속도 보정층 도입 전 값이다. s=1.0이면 예전과 bit 단위로 같아야 한다.
    monkeypatch.setenv("PERSONAL_PLAN_SPEED_CALIB_SCALE", "1.0")
    _target_calibration_off(monkeypatch)
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(distance, grades=_grades(distance, kind)), goal=None,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime(),
    )

    assert list(selection.segment_paces_sec_per_km) == _BEFORE_BUDGET[(distance, kind)]
    assert "PLAN_SEARCH_BUDGET_LIMITED" not in selection.warnings
    assert 0 < selection.search_rollout_cells <= selection.search_budget_cells


def test_marathon_search_is_limited_to_the_budget_with_a_warning(monkeypatch):
    monkeypatch.delenv("PERSONAL_PLAN_SEARCH_BUDGET_CELLS", raising=False)
    from app.personal_plan import DEFAULT_SEARCH_BUDGET_CELLS
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(42195, grades=((0, 21000, 1), (21000, 42195, -1))), goal=None,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime(),
    )

    assert len(selection.segment_paces_sec_per_km) == 43
    assert "PLAN_SEARCH_BUDGET_LIMITED" in selection.warnings
    assert selection.search_budget_cells == DEFAULT_SEARCH_BUDGET_CELLS
    assert selection.search_rollout_cells <= DEFAULT_SEARCH_BUDGET_CELLS


def test_search_budget_is_configurable_by_env_and_is_deterministic(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_SEARCH_BUDGET_CELLS", "5000")
    run = lambda: OdeBalancedPaceOptimizer().select(
        course=_course(10000, grades=_grades(10000, 2)), goal=None,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime(),
    )
    first, second = run(), run()

    assert "PLAN_SEARCH_BUDGET_LIMITED" in first.warnings
    assert first.search_budget_cells == 5000 and first.search_rollout_cells <= 5000
    assert first.segment_paces_sec_per_km == second.segment_paces_sec_per_km
    assert first.search_rollout_cells == second.search_rollout_cells


@pytest.mark.parametrize("value", ["0", "-1", "abc"])
def test_invalid_search_budget_env_is_rejected(value, monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_SEARCH_BUDGET_CELLS", value)
    with pytest.raises(ValueError):
        OdeBalancedPaceOptimizer()


# --- 첫 구간 과속 방지(PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN) ---------------------
_DOWNHILL_START = ((0, 1000, -10), (1000, 3000, 0))   # 첫 km 내리막: 픽스처 HR이 낮아 계획기가 첫 km를 당긴다


def _first_vs_rest(paces, distance):
    splits = split_distance_1km(distance)
    rest = sum(float(e - s) * p for (s, e), p in zip(splits[1:], paces[1:])) / float(distance - 1000)
    return paces[0], rest


def test_without_the_cap_the_fixture_runs_the_first_km_faster_than_the_rest(monkeypatch):
    monkeypatch.setenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", "false")
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(3000, grades=_DOWNHILL_START), goal=None,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime())
    first, rest = _first_vs_rest(selection.segment_paces_sec_per_km, 3000)

    assert first < rest - 1.0 and "PLAN_FIRST_SEGMENT_CAPPED" not in selection.warnings


def test_first_km_is_not_faster_than_the_rest_mean_by_default(monkeypatch):
    monkeypatch.delenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", raising=False)
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(3000, grades=_DOWNHILL_START), goal=None,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime())
    first, rest = _first_vs_rest(selection.segment_paces_sec_per_km, 3000)

    assert first >= rest - 0.01
    assert "PLAN_FIRST_SEGMENT_CAPPED" in selection.warnings


def test_first_km_cap_keeps_the_goal_duration(monkeypatch):
    monkeypatch.delenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", raising=False)
    goal = ResolvedGoal(distance_m=3000, target_pace_sec_per_km=330, predicted_finish_sec=990,
                        target_pace_source="TARGET_PACE", target_finish_sec=990)
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(3000, grades=_DOWNHILL_START), goal=goal,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime())
    segments = finalize_personal_segments(3000, 330, selection.segment_paces_sec_per_km,
                                         preserve_goal_duration=True)
    first, rest = _first_vs_rest([s.pace_sec_per_km for s in segments], 3000)

    assert abs(finish_sec_from_segments(segments) - 990) <= 1
    assert first >= rest - 0.01 and "PLAN_FIRST_SEGMENT_CAPPED" in selection.warnings


@pytest.mark.parametrize("value", ["maybe", "2"])
def test_invalid_first_segment_cap_env_is_rejected(value, monkeypatch):
    monkeypatch.setenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", value)
    with pytest.raises(ValueError):
        OdeBalancedPaceOptimizer()


@pytest.mark.parametrize("distance, kind", sorted(_BEFORE_BUDGET))
def test_first_segment_cap_leaves_plans_without_a_fast_first_km_unchanged(distance, kind, monkeypatch):
    # 후처리 방식: 첫 km가 이미 나머지 평균보다 느리거나 같으면 계획은 그대로다.
    monkeypatch.delenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", raising=False)
    monkeypatch.setenv("PERSONAL_PLAN_SPEED_CALIB_SCALE", "1.0")  # 보정층 도입 전 값과 비교
    _target_calibration_off(monkeypatch)
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(distance, grades=_grades(distance, kind)), goal=None,
        personalization=_bundle(), ode_runtime=RecordingOdeRuntime())

    assert list(selection.segment_paces_sec_per_km) == _BEFORE_BUDGET[(distance, kind)]
    assert "PLAN_FIRST_SEGMENT_CAPPED" not in selection.warnings


def test_first_segment_cap_only_raises_the_first_km_and_keeps_the_rest(monkeypatch):
    run = lambda flag: (monkeypatch.setenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", flag),
                        OdeBalancedPaceOptimizer().select(
                            course=_course(3000, grades=_DOWNHILL_START), goal=None,
                            personalization=_bundle(), ode_runtime=RecordingOdeRuntime()))[1]
    free, capped = run("false"), run("true")
    _, rest = _first_vs_rest(free.segment_paces_sec_per_km, 3000)

    assert capped.segment_paces_sec_per_km[1:] == free.segment_paces_sec_per_km[1:]
    assert capped.segment_paces_sec_per_km[0] == pytest.approx(rest, abs=0.01)


def test_first_km_cap_flattens_a_two_km_uphill_finish(monkeypatch):
    monkeypatch.delenv("PLAN_FIRST_SEGMENT_NO_FASTER_THAN_MEAN", raising=False)
    selection = OdeBalancedPaceOptimizer().select(
        course=_course(), goal=None, personalization=_bundle(), ode_runtime=RecordingOdeRuntime())

    first, second = selection.segment_paces_sec_per_km
    assert first == second and "PLAN_FIRST_SEGMENT_CAPPED" in selection.warnings

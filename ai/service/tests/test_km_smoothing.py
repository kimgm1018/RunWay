"""H + A20 smoothing and the serialized AI09 session-plan contract."""
from decimal import Decimal
import math
from types import SimpleNamespace

import pytest

from app import km_smoothing


def _dot(paces, lengths):
    return sum(p * length for p, length in zip(paces, lengths))


@pytest.mark.parametrize("paces,lengths,grades", [
    ([300, 315, 300], [1000] * 3, [0] * 3),
    ([300, 364, 300, 340, 280], [1000] * 4 + [4.9], [0] * 5),
    ([370, 300, 360, 290, 350], [1000] * 5, [0, 3, 0, -3, 0]),
])
def test_each_stage_preserves_weighted_time_and_is_deterministic(paces, lengths, grades):
    original = paces.copy()
    h = km_smoothing.remove_single_km_blips(paces, lengths, grades)
    a = km_smoothing.cap_neighbor_jumps(paces, lengths)
    both = km_smoothing.smooth_km_paces(paces, lengths, grades)
    for result in (h, a, both):
        assert abs(_dot(result, lengths) - _dot(paces, lengths)) <= 1e-6
        assert all(math.isfinite(p) and p > 0 for p in result)
    for result in (a, both):
        assert all(abs(b - a) <= 20 + 1e-6 for a, b in zip(result, result[1:]))
    assert both == km_smoothing.cap_neighbor_jumps(h, lengths)
    assert both == km_smoothing.smooth_km_paces(paces, lengths, grades)
    assert paces == original


@pytest.mark.parametrize("middle", [285, 315])
def test_flat_small_blip_is_flattened_and_rescaled(middle):
    result = km_smoothing.remove_single_km_blips([300, middle, 300], [1000] * 3, [0] * 3)
    assert result == pytest.approx([(600 + middle) / 3] * 3)
    assert min(result[0], result[2]) <= result[1] <= max(result[0], result[2])


@pytest.mark.parametrize("paces,grades", [
    ([300, 315, 300], [0, 2, 0]),
    ([300, 285, 300], [0, -2, 0]),
    ([300, 316, 300], [0, 0, 0]),
    ([300, 300.5, 300], [0, 0, 0]),
    ([300, 310, 320], [0, 0, 0]),
])
def test_h_keeps_terrain_large_subsecond_and_monotone_changes(paces, grades):
    assert km_smoothing.remove_single_km_blips(paces, [1000] * 3, grades) == paces


def test_h_uses_smaller_side_of_blip_and_strict_grade_guard():
    result = km_smoothing.remove_single_km_blips([300, 340, 330], [1000] * 3, [0, 1.999, 0])
    assert result == pytest.approx([300 * 970 / 960, 330 * 970 / 960, 330 * 970 / 960])


@pytest.mark.parametrize("paces,lengths", [([], []), ([310], [4.9]), ([300, 364], [1000, 4.9])])
def test_short_inputs(paces, lengths):
    grades = [0] * len(paces)
    assert km_smoothing.remove_single_km_blips(paces, lengths, grades) == paces
    result = km_smoothing.smooth_km_paces(paces, lengths, grades)
    assert abs(_dot(result, lengths) - _dot(paces, lengths)) <= 1e-6
    if len(paces) == 2:
        assert result == pytest.approx([300 + 44 * 4.9 / 1004.9, 364 - 44 * 1000 / 1004.9])
        assert result[1] - result[0] == pytest.approx(20)
    else:
        assert result == paces


@pytest.mark.parametrize("value,expected", [(None, True), ("true", True), ("1", True),
    ("false", False), ("0", False), ("no", False), ("off", False), (" OFF ", False)])
def test_switch_is_read_per_call(monkeypatch, value, expected):
    monkeypatch.setenv("PLAN_KM_SMOOTHING_ENABLED", "true")
    assert km_smoothing.km_smoothing_enabled()
    if value is None:
        monkeypatch.delenv("PLAN_KM_SMOOTHING_ENABLED")
    else:
        monkeypatch.setenv("PLAN_KM_SMOOTHING_ENABLED", value)
    assert km_smoothing.km_smoothing_enabled() is expected


BAND_WARNING = "HR_REFERENCE_BAND_NOT_SATISFIED_BEST_EFFORT_EXPERIMENTAL_PLAN"


class FixedOptimizer:
    def __init__(self, paces, *, replay_satisfied=True):
        self.paces = tuple(paces)
        self.replay_satisfied = replay_satisfied
        self.replayed = None

    def select(self, **kwargs):
        from app import personal_plan as pp

        return pp.PaceSelection(
            segment_paces_sec_per_km=self.paces, model_version="ode-fixture-v1",
            policy_version="smoothing-test", personalized=True, preserve_goal_duration=True,
            warnings=(BAND_WARNING,),
        )

    def replay(self, *, paces, **kwargs):
        self.replayed = paces
        return dict(mean=150.0, peak=155.0, max_hr_reference_deviation_bpm=5.0,
                    hr_reference_band_bpm=10.0, hr_reference_band_satisfied=self.replay_satisfied)


def _build(monkeypatch, distance, paces, *, enabled, target=None, grades=None, replay_satisfied=True):
    from app import personal_plan as pp
    from app.ode_schemas import PlanGradeSegment
    from test_personal_plan_ode import _bundle

    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    monkeypatch.setenv("PLAN_KM_SMOOTHING_ENABLED", str(enabled).lower())
    splits = pp.split_distance_1km(distance)
    course = pp.CoursePlanSnapshot(
        course_id=297, distance_m=distance, version="smoothing-course",
        grade_profile=tuple(PlanGradeSegment(startDistanceM=float(start), endDistanceM=float(end),
                                            gradePercent=grade)
                            for (start, end), grade in zip(splits, grades or [0] * len(splits))),
    )
    optimizer = FixedOptimizer(paces, replay_satisfied=replay_satisfied)
    body = {"userId": 73, "courseId": 297}
    if target is not None:
        body["selectedGoal"] = {"targetPaceSecPerKm": target}
    result = pp.build_personal_plan(
        pp.PersonalPlanRequest.model_validate(body),
        course_lookup=SimpleNamespace(get_course=lambda _: course),
        personalization_lookup=SimpleNamespace(get_personalization=lambda _: _bundle()),
        optimizer=optimizer, ode_runtime=SimpleNamespace(info=SimpleNamespace(model_version="ode-fixture-v1")),
    )
    assert optimizer.replayed == tuple(s.pace_sec_per_km for s in result.segments)
    return result


def _assert_session_plan_valid(result):
    # Decimal(str(...)) mirrors the backend's decimal request validation.
    distance = Decimal(str(result.target_distance_m))
    target = Decimal(str(result.target_pace_sec_per_km))
    previous_end = Decimal(0)
    weighted_pace = weighted_ratio = Decimal(0)
    for sequence, segment in enumerate(result.segments, 1):
        start, end = Decimal(str(segment.start_distance_m)), Decimal(str(segment.end_distance_m))
        pace, ratio = Decimal(str(segment.pace_sec_per_km)), Decimal(str(segment.pace_ratio))
        assert segment.sequence == sequence
        assert start == previous_end
        assert end == min(distance, start + 1000)
        assert Decimal("0.85") <= ratio <= Decimal("1.20")
        assert abs(target * ratio - pace) <= Decimal("0.02")
        weighted_pace += (end - start) * pace
        weighted_ratio += (end - start) * ratio
        previous_end = end
    assert previous_end == distance
    assert abs(weighted_pace / distance - target) <= Decimal("0.02")
    assert abs(weighted_ratio / distance - 1) <= Decimal("0.000001")


@pytest.mark.parametrize("distance,paces,target", [
    (3000, [300, 315, 300], None),
    (4004.90, [300, 312, 300, 340, 280], None),
    (2000, [300, 364], 330),
    (3000, [300, 315, 300], 200),  # outside search support: other finalize branch
])
def test_build_smooths_before_finalize_and_keeps_backend_contract(monkeypatch, distance, paces, target):
    from app import personal_plan as pp

    before = _build(monkeypatch, distance, paces, enabled=False, target=target)
    after = _build(monkeypatch, distance, paces, enabled=True, target=target)
    _assert_session_plan_valid(before)
    _assert_session_plan_valid(after)
    assert pp.SEGMENT_RATIO_CLAMPED not in after.warnings
    assert all(abs(b.pace_sec_per_km - a.pace_sec_per_km) <= 20.02
               for a, b in zip(after.segments, after.segments[1:]))
    assert before.segments != after.segments
    if target != 200:
        assert BAND_WARNING in before.warnings
    assert BAND_WARNING not in after.warnings
    assert not set(after.warnings) - set(before.warnings)
    lengths = [s.length_m for s in before.segments]
    assert abs(_dot([s.pace_sec_per_km for s in before.segments], lengths)
               - _dot([s.pace_sec_per_km for s in after.segments], lengths)) / distance <= 0.02
    print(f"{distance}m target={target}: {[s.pace_sec_per_km for s in before.segments]}"
          f" -> {[s.pace_sec_per_km for s in after.segments]}")


def test_disabled_build_bypasses_smoothing_and_matches_original_finalize(monkeypatch):
    from app import personal_plan as pp

    def unexpected(*args, **kwargs):
        pytest.fail("disabled smoothing must not be called")

    monkeypatch.setattr(pp, "smooth_km_paces", unexpected)
    result = _build(monkeypatch, 4004.9, [300, 312, 300, 340, 280], enabled=False)
    expected = pp.finalize_personal_segments(4004.9, None, [300, 312, 300, 340, 280],
                                            preserve_goal_duration=True)
    assert result.segments == list(expected)
    assert result.warnings == [BAND_WARNING]


def test_disabled_http_response_matches_pre_change_golden(monkeypatch):
    import json

    from app.personal_plan import OdeBalancedPaceOptimizer
    from test_personal_plan_course_regression import FIXTURE, _post
    from test_personal_plan_ode import RecordingOdeRuntime, _bundle

    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    monkeypatch.setenv("PLAN_KM_SMOOTHING_ENABLED", "false")
    monkeypatch.setenv("FREE_RUN_GRADE_POLICY", "flat0")
    actual = _post({"userId": 73, "courseId": 297}, personal=_bundle(),
                   runtime=RecordingOdeRuntime(), optimizer=OdeBalancedPaceOptimizer())
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))["personal_ode_none"]
    assert json.dumps(actual, sort_keys=True).encode() == json.dumps(expected, sort_keys=True).encode()


@pytest.mark.parametrize("satisfied", [True, False])
def test_smoothing_recomputes_band_warning_from_final_replay(monkeypatch, satisfied):
    result = _build(monkeypatch, 3000, [300, 315, 300], enabled=True, replay_satisfied=satisfied)
    assert (BAND_WARNING in result.warnings) is not satisfied


def test_unchanged_smoothing_does_not_recompute_band_warning(monkeypatch):
    result = _build(monkeypatch, 3000, [300, 300, 300], enabled=True)
    assert BAND_WARNING in result.warnings


def test_build_uses_course_grades_for_h_guard(monkeypatch):
    result = _build(monkeypatch, 3000, [300, 315, 300], enabled=True, grades=[0, 2, 0])
    assert [s.pace_sec_per_km for s in result.segments] == [300, 315, 300]
    assert BAND_WARNING in result.warnings

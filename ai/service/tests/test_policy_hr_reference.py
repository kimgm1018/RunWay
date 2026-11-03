from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.policy.config import load_policy_config
from app.policy.hr_reference import (
    blend_hr_thresholds,
    nearest_rank_percentile,
    personal_hr_thresholds,
)

C = load_policy_config()


def _session(day, values, *, workout_quality="CLEAN", hr_quality="GOOD"):
    started = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day)
    sequence = [values[index % len(values)] for index in range(max(25, len(values)))]
    samples = [SimpleNamespace(elapsed_sec=5 * index, hr_bpm=value, hr_quality=hr_quality,
                               speed_mps=3.0, speed_quality="GOOD", grade_percent=0.0,
                               grade_quality="GOOD", hr_is_filled=False)
               for index, value in enumerate(sequence)]
    return SimpleNamespace(session_started_at=started, workout_quality=workout_quality, samples=samples)


@pytest.mark.parametrize("run_count, weight", [(0, 0.0), (1, 0.25), (2, 0.50), (3, 0.75),
                                                 (4, 0.90), (5, 1.0), (6, 1.0)])
def test_blend_weights_follow_policy_table(run_count, weight):
    thresholds = blend_hr_thresholds(C, personal_danger_bpm=195, personal_sustain_bpm=180,
                                     run_count=run_count)

    assert thresholds.weight == weight
    # v6_8 (b): 위험 기준은 섞은 P98에 정책 hr_danger_offset_bpm 3을 섞은 뒤에 더한다(사용자 확정).
    assert thresholds.danger_bpm == pytest.approx(weight * 195 + (1 - weight) * 175 + 3.0)
    assert thresholds.danger_offset_bpm == 3.0
    assert thresholds.sustain_bpm == pytest.approx(weight * 180 + (1 - weight) * 163)
    assert thresholds.source == ("POPULATION" if weight == 0 else "PERSONAL" if weight == 1 else "BLENDED")


def test_nearest_rank_percentile_uses_ceiling_rank_and_integer_hr():
    values = [float(value) for value in range(100, 200)]

    assert nearest_rank_percentile(values, 98) == 197
    assert nearest_rank_percentile(values, 85) == 184


def test_personal_thresholds_use_only_twenty_latest_sessions_by_start_time():
    # 가장 오래된 1회만 높은 값으로 두어 최근 20회 선택 여부를 확인한다.
    sessions = [_session(0, [220])] + [_session(day, [150]) for day in range(1, 21)]

    result = personal_hr_thresholds(sessions)

    assert result.hr_threshold_run_count == 20
    assert result.hr_danger_bpm == 150
    assert result.hr_sustain_bpm == 150


def test_personal_thresholds_skip_unusable_runs_and_non_good_hr():
    sessions = [
        _session(1, [210], workout_quality="UNUSABLE"),
        _session(2, [220], hr_quality="LOW"),
        _session(3, [170, 180]),
    ]

    result = personal_hr_thresholds(sessions)

    assert result.hr_threshold_run_count == 1
    assert result.hr_danger_bpm == 180
    assert result.hr_sustain_bpm == 180


def test_personal_thresholds_skip_sessions_not_admitted_by_ode():
    session = _session(1, [220])
    for sample in session.samples:
        sample.speed_mps = None

    result = personal_hr_thresholds([session])

    assert result.hr_threshold_run_count == 0
    assert result.hr_danger_bpm is None and result.hr_sustain_bpm is None


def test_missing_personal_thresholds_use_population_values():
    result = blend_hr_thresholds(C, personal_danger_bpm=None, personal_sustain_bpm=None, run_count=0)

    # 나이·RHR 비율을 빼고 모집단 P98·P85를 기준으로 쓴다.
    # 위험 기준은 모집단 P98 175에 +3을 더한 178이다(v6_8 (b), 사용자 확정). 지속 기준에는 더하지 않는다.
    assert (result.danger_bpm, result.sustain_bpm) == (178.0, 163.0)
    assert (result.source, result.weight) == ("POPULATION", 0.0)


def test_danger_offset_is_added_once_to_the_blended_p98():
    # 개인 P98 190(DB 원값, +3 전), 모집단 P98 175, 2회(w=0.5): 섞은 값 182.5 + 3 = 185.5.
    # 비중 합이 1이라 섞기 전에 더해도 값은 같다. 여기서 보는 것은 +3이 한 번만 붙고(188.5 아님)
    # 지속 기준에는 붙지 않는다는 점이다.
    blended = blend_hr_thresholds(C, personal_danger_bpm=190, personal_sustain_bpm=170, run_count=2)
    assert blended.danger_bpm == pytest.approx(0.5 * 190 + 0.5 * 175 + 3.0)
    assert blended.sustain_bpm == pytest.approx(0.5 * 170 + 0.5 * 163)
    personal = blend_hr_thresholds(C, personal_danger_bpm=190, personal_sustain_bpm=170, run_count=7)
    assert personal.danger_bpm == pytest.approx(193.0) and personal.source == "PERSONAL"


def test_danger_offset_comes_from_policy_json(tmp_path):
    import json
    from pathlib import Path

    import app.policy.config as config_module
    from app.policy.config import load_policy_config

    raw = json.loads(Path(config_module.__file__).with_name("policy_v03.json").read_text(encoding="utf-8"))
    assert raw["hr_danger_offset_bpm"] == 3
    raw["hr_danger_offset_bpm"] = 0.0
    path = tmp_path / "policy.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    assert blend_hr_thresholds(load_policy_config(path)).danger_bpm == 175.0
    for bad in (-1.0, 21.0, True):
        raw["hr_danger_offset_bpm"] = bad
        path.write_text(json.dumps(raw), encoding="utf-8")
        with pytest.raises(ValueError):
            load_policy_config(path)

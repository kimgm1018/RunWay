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


def _session(day, values, *, workout_quality="CLEAN", hr_quality="GOOD", minutes=12, speed_mps=3.0):
    # 기본: 12분(145표본)·3.0 m/s(5'33"/km)·약 2.2 km — 901 러닝 기준(1 km·이동 10분·12'00"/km)을 통과한다.
    started = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(days=day)
    sequence = [values[index % len(values)] for index in range(max(25, len(values), minutes * 12 + 1))]
    samples = [SimpleNamespace(elapsed_sec=5 * index, hr_bpm=value, hr_quality=hr_quality,
                               speed_mps=speed_mps, speed_quality="GOOD", grade_percent=0.0,
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


def test_personal_thresholds_skip_sessions_without_speed():
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


# --- S15P31E105-901: 걷기·짧은 기록을 빼고, 개인 기준 바닥을 둔다 ---

@pytest.mark.parametrize("minutes, speed_mps, kept", [
    (12, 3.0, True),     # 12분·5'33"/km 러닝
    (9, 3.0, False),     # 이동 10분 미만
    (12, 1.3, False),    # 걷기(12'49"/km, 12'00"보다 느림)
    (12, 1.42, True),    # 11'44"/km 느린 조깅은 남긴다
    (30, 0.5, False),    # 0.9 km — 1 km 미만
])
def test_personal_thresholds_keep_only_running_sessions(minutes, speed_mps, kept):
    result = personal_hr_thresholds([_session(1, [140], minutes=minutes, speed_mps=speed_mps)])

    assert result.hr_threshold_run_count == (1 if kept else 0)
    assert (result.hr_sustain_bpm == 140) if kept else result.hr_sustain_bpm is None


def test_stops_do_not_count_as_moving_time():
    # 앞 6분 정지(속도 0) + 6분 3.0 m/s: 경과 12분이어도 이동 6분이라 뺀다.
    session = _session(1, [150], minutes=12)
    for sample in session.samples[:72]:
        sample.speed_mps = 0.0

    assert personal_hr_thresholds([session]).hr_threshold_run_count == 0


def test_walk_and_qa_only_user_falls_back_to_population():
    # 재현: 걷기·짧은 QA 5회만 있는 사용자(운영 user 11과 같은 모양). 예전엔 개인 100%(5회)로 129/119가 되었다.
    sessions = ([_session(day, [110, 119, 129], minutes=20, speed_mps=1.2) for day in range(3)]
                + [_session(day, [110, 119, 129], minutes=4, speed_mps=2.6) for day in range(3, 5)])

    learned = personal_hr_thresholds(sessions)
    blended = blend_hr_thresholds(C, personal_danger_bpm=learned.hr_danger_bpm,
                                  personal_sustain_bpm=learned.hr_sustain_bpm,
                                  run_count=learned.hr_threshold_run_count)

    assert learned.hr_threshold_run_count == 0
    assert (blended.danger_bpm, blended.sustain_bpm, blended.source) == (178.0, 163.0, "POPULATION")


def test_blend_weight_uses_count_after_filtering():
    # 러닝 2회 + 걷기 3회 → 유효 2회라 비중 0.5(5회의 1.0 아님).
    sessions = ([_session(day, [150, 170], minutes=15) for day in range(2)]
                + [_session(day, [100], minutes=30, speed_mps=1.1) for day in range(2, 5)])

    learned = personal_hr_thresholds(sessions)
    blended = blend_hr_thresholds(C, personal_danger_bpm=learned.hr_danger_bpm,
                                  personal_sustain_bpm=learned.hr_sustain_bpm,
                                  run_count=learned.hr_threshold_run_count)

    assert (learned.hr_threshold_run_count, learned.hr_danger_bpm, learned.hr_sustain_bpm) == (2, 170, 170)
    assert blended.weight == 0.5


def test_normal_runner_values_are_unchanged():
    # 정상 러닝 사용자(최근 6회 러닝, 기존에도 전부 통과): 계산 값과 섞은 기준이 수정 전과 같다.
    sessions = [_session(day, [150, 160, 170, 180, 190], minutes=30) for day in range(6)]

    learned = personal_hr_thresholds(sessions)
    blended = blend_hr_thresholds(C, personal_danger_bpm=learned.hr_danger_bpm,
                                  personal_sustain_bpm=learned.hr_sustain_bpm,
                                  run_count=learned.hr_threshold_run_count)

    assert (learned.hr_threshold_run_count, learned.hr_danger_bpm, learned.hr_sustain_bpm) == (6, 190, 190)
    assert (blended.danger_bpm, blended.sustain_bpm, blended.source) == (193.0, 190.0, "PERSONAL")


@pytest.mark.parametrize("danger, sustain, expected", [
    (129, 119, (143.0, 125.0)),   # 운영 user 11 저장 값 → 바닥 140/125(+3)
    (121, 109, (143.0, 125.0)),   # 운영 user 2 저장 값
    (145, 127, (148.0, 127.0)),   # V2 Val 실제 러너 최솟값 — 바닥에 걸리지 않는다
    (138, 130, (143.0, 130.0)),   # 위험만 바닥 아래
])
def test_personal_floor_applies_before_blending(danger, sustain, expected):
    result = blend_hr_thresholds(C, personal_danger_bpm=danger, personal_sustain_bpm=sustain, run_count=5)

    assert (result.danger_bpm, result.sustain_bpm) == expected


def _gps_less_watch_run(day):
    # 운영 사례(user 11, 11/17): GPS 없는 실기기 워치 러닝 34분·4.6 km(걸음 기반 거리, 경사 없음).
    # 시작 심박이 늦게 잡히고 걸음 거리 속도도 90초 뒤에야 나온다 → ODE 입력 검사(no_start_hr·late_or_no_action)로는 빠진다.
    session = _session(day, [150, 160, 170], minutes=34, speed_mps=2.26)
    for index, sample in enumerate(session.samples):
        sample.grade_percent, sample.grade_quality = None, "MISSING"
        if index < 6:
            sample.hr_bpm, sample.hr_quality = None, "MISSING"
        if index < 18:
            sample.speed_mps, sample.speed_quality = None, "MISSING"
    return session


def test_gps_less_watch_run_is_rejected_by_ode_input_check():
    # 전제 확인: 같은 세션은 ODE·GRU 적합 입력 검사에서는 여전히 빠진다(그쪽은 바꾸지 않는다).
    import pandas as pd

    from app.grade_fill import prepare_with_grade_fallback
    from app.models.ode.validation import pv_data

    session = _gps_less_watch_run(10)
    frame = pd.DataFrame([{
        "session_id": 1, "segment_id": 0, "elapsed_s": s.elapsed_sec, "hr_bpm": s.hr_bpm, "speed_mps": s.speed_mps,
        "grade_observed_pct": s.grade_percent, "hr_quality": s.hr_quality, "speed_quality": s.speed_quality,
        "grade_quality": s.grade_quality, "hr_is_filled": s.hr_is_filled} for s in session.samples],
        columns=pv_data.TS_COLUMNS)

    assert isinstance(prepare_with_grade_fallback(frame)[1], str)


def test_gps_less_watch_run_counts_for_hr_thresholds():
    # 경사 없는 정상 러닝 1개 + 짧은 기록 5개 → 허용·위험선은 그 러닝만 반영(1회, 비중 0.25).
    sessions = [_gps_less_watch_run(10)] + [_session(day, [110, 120], minutes=4) for day in range(5)]

    learned = personal_hr_thresholds(sessions)
    blended = blend_hr_thresholds(C, personal_danger_bpm=learned.hr_danger_bpm,
                                  personal_sustain_bpm=learned.hr_sustain_bpm,
                                  run_count=learned.hr_threshold_run_count)

    assert (learned.hr_threshold_run_count, learned.hr_danger_bpm, learned.hr_sustain_bpm) == (1, 170, 170)
    assert blended.weight == 0.25
    assert blended.sustain_bpm == pytest.approx(0.25 * 170 + 0.75 * 163)

"""서비스 흐름: 보정에 쓸 기록 고르기와 처음 사용자의 첫 1분 보정을 확인한다."""
import numpy as np
import pytest

from stride_model import StridePrior
from target_bpm import Window, first_minute_bpm, select_records, target_bpm

PRIOR = StridePrior(mu=np.array([1.0, 0.3]), G=np.diag([0.05 ** 2, 0.03 ** 2]), sigma2=0.01 ** 2)


def test_unfollowed_cue_windows_are_dropped():
    windows = [
        Window(1, 2.8, 165),                     # 큐 없음 → 사용
        Window(1, 3.2, 170, cue_bpm=168),        # 따라감(차이 2) → 사용
        Window(1, 2.2, 167, cue_bpm=140),        # 안 따라감(차이 27) → 제외
    ]
    speeds = sorted(s for s, _ in select_records(windows))
    assert speeds == pytest.approx([2.8, 3.2])


def test_only_recent_runs_are_used():
    windows = [Window(run, 2.0 + 0.5 * run, 160) for run in range(1, 8)]   # 러닝마다 다른 속도 칸
    windows.append(Window(8, 6.5, 160, cue_bpm=120))                        # 쓸 구간이 없는 러닝은 세지 않는다
    speeds = sorted(s for s, _ in select_records(windows, recent_runs=5))
    assert speeds == pytest.approx([2.0 + 0.5 * run for run in range(3, 8)])


def test_same_run_and_speed_bin_becomes_one_record():
    windows = [Window(1, 2.98, 160), Window(1, 3.02, 170), Window(2, 3.5, 175)]
    records = select_records(windows)
    assert len(records) == 2                                                # 러닝 1의 두 구간이 하나로
    speed, cadence = min(records, key=lambda r: r[0])
    strides = [60 * 2.98 / 160, 60 * 3.02 / 170]
    assert speed == pytest.approx(3.0)
    assert cadence == pytest.approx(60 * 3.0 / np.mean(strides))            # 보폭 평균으로 되돌린 케이던스


def test_first_minute_skipped_for_users_with_records():
    current = target_bpm(360, PRIOR, records=[(2.8, 165)]).bpm
    first = Window(1, 2.3, current, cue_bpm=current)
    assert first_minute_bpm(current, 360, first, [(2.8, 165)], PRIOR) is None


def test_first_minute_skipped_when_bpm_not_followed():
    current = target_bpm(360, PRIOR).bpm
    first = Window(1, 2.3, current + 15, cue_bpm=current)
    assert first_minute_bpm(current, 360, first, [], PRIOR) is None


def test_first_minute_keeps_bpm_when_change_is_small():
    current = target_bpm(360, PRIOR).bpm
    speed = 1000 / 360
    first = Window(1, speed, current, cue_bpm=current)                      # 평균 직선대로 뛴 1분
    assert first_minute_bpm(current, 360, first, [], PRIOR) is None


def test_first_minute_raises_bpm_for_short_stride():
    current = target_bpm(360, PRIOR).bpm
    first = Window(1, 2.3, current, cue_bpm=current)       # BPM은 따라갔지만 목표보다 느림 → 보폭이 짧다
    result = first_minute_bpm(current, 360, first, [], PRIOR)
    assert result is not None
    assert result.source == "bayes"
    assert result.bpm >= current + 3

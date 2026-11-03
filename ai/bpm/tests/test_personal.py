"""개인 워치 기록 변환과 시간순 평가를 합성 데이터로 확인한다."""
import numpy as np
import pandas as pd
import pytest

from convert_personal import steady_windows
from evaluate_personal import evaluate
from stride_model import StridePrior


def samples(minutes):
    """분마다 (속도 목록, 케이던스 목록)을 받아 10초 간격 기록을 만든다."""
    rows = []
    for m, (speeds, cadences) in enumerate(minutes):
        for i, (v, c) in enumerate(zip(speeds, cadences)):
            rows.append({"t_s": m * 60 + i * 10, "speed_mps": v, "cadence_spm": c})
    return pd.DataFrame(rows)


def test_steady_windows_keeps_only_steady_running():
    df = samples([
        ([3.0] * 6, [170] * 6),                         # 일정하게 달림 → 남김
        ([1.2] * 6, [110] * 6),                         # 걷기 → 뺌
        ([2.5, 3.5] * 3, [165, 175] * 3),               # 페이스가 크게 흔들림 → 뺌
        ([3.0] * 3, [170] * 3),                         # 기록이 너무 적음 → 뺌
    ])
    out = steady_windows(df)
    assert list(out["window"]) == [0]
    assert out["speed_mps"].iloc[0] == pytest.approx(3.0)
    assert out["cadence_spm"].iloc[0] == pytest.approx(170)


def make_windows(stride_by_run):
    rows = []
    for run_no, stride in stride_by_run.items():
        for k, v in enumerate([2.8, 3.0, 3.2]):
            rows.append({"run_no": run_no, "window_start_s": k * 60, "speed_mps": v,
                         "stride_m": stride, "cadence_spm": 60 * v / stride})
    return pd.DataFrame(rows)


@pytest.fixture
def prior():
    return StridePrior(mu=np.array([1.0, 0.3]), G=np.diag([0.05 ** 2, 0.03 ** 2]), sigma2=0.02 ** 2)


def test_personal_evaluation_does_not_use_future_runs(prior):
    base = evaluate(prior, make_windows({1: 0.95, 2: 0.95, 3: 0.95}))
    changed = evaluate(prior, make_windows({1: 0.95, 2: 0.95, 3: 1.40}))   # 3번째 러닝만 바꾼다
    cols = ["method", "window_start_s", "pred_cadence"]
    run2_base = base[base["run_no"] == 2][cols].reset_index(drop=True)
    run2_changed = changed[changed["run_no"] == 2][cols].reset_index(drop=True)
    pd.testing.assert_frame_equal(run2_base, run2_changed)
    assert base.groupby("run_no")["n_past_runs"].first().tolist() == [0, 1, 2]


def test_past_records_improve_prediction(prior):
    pred = evaluate(prior, make_windows({1: 0.90, 2: 0.90, 3: 0.90, 4: 0.90}))
    last = pred[pred["run_no"] == 4].groupby("method")["abs_err"].mean()
    assert last["bayes_past"] < last["population"]
    assert last["bayes_past_inrun"] < last["population"]
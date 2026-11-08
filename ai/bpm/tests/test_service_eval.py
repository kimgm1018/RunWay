"""BPM-008·009 평가: 사람별 시간순 채점(미래·다른 사람 기록 미사용)과 큐 켠 러닝 첫 1분 처리를 합성 데이터로 확인한다."""
import numpy as np
import pandas as pd
import pytest

from evaluate_cued import speed_at_bpm
from evaluate_service import evaluate_cued_runs, evaluate_personal, score_cued_run
from stride_model import StridePrior

PRIOR = StridePrior(mu=np.array([1.0, 0.3]), G=np.diag([0.05 ** 2, 0.03 ** 2]), sigma2=0.01 ** 2)
OFFSET = np.array([0.06, 0.0])          # 이 사람은 평균보다 보폭이 6 cm 길다


def cadence(speed):
    return 60 * speed / (PRIOR.mu[0] + OFFSET[0] + (PRIOR.mu[1] + OFFSET[1]) * (speed - PRIOR.v_ref))


def cued_run(run_no, bpms):
    speeds = speed_at_bpm(PRIOR, bpms, OFFSET)
    return pd.DataFrame({"run_no": run_no, "kind": "cued", "start": range(len(bpms)), "speed_mps": speeds,
                         "cadence_spm": cadence(speeds), "cue_bpm": np.asarray(bpms, dtype=float)})


def test_cued_run_uses_first_minute_only_for_calibration():
    run = cued_run(1, [165, 165, 165, 150, 160, 170])
    run.loc[3, "cadence_spm"] += 10                       # BPM을 안 따라간 구간 → 채점 제외
    rows = pd.DataFrame(score_cued_run(PRIOR, run, records=[]))
    assert set(rows["method"]) == {"population", "first_minute", "oracle_run_median"}   # 기록 없으면 기록 방법 없음
    pace = rows[rows["task"] == "pace"]
    assert (pace["method"] == "population").sum() == 2   # 첫 1분 3구간과 안 따라간 구간을 뺀 2구간
    err = (pace["pred"] - pace["true"]).abs().groupby(pace["method"]).mean()
    assert err["first_minute"] < err["population"]


def test_cued_run_with_records_adds_record_methods_and_skips_short_runs():
    run = cued_run(2, [160, 160, 160, 170, 175])
    records = [(float(v), float(cadence(v))) for v in (2.6, 2.9, 3.2)]
    rows = pd.DataFrame(score_cued_run(PRIOR, run, records))
    assert {"records", "records_first_minute"} <= set(rows["method"])
    rec = rows[(rows["method"] == "records") & (rows["task"] == "pace")]
    assert (rec["pred"] - rec["true"]).abs().max() < (rows.loc[rows["method"] == "population", "pred"]
                                                      - rows.loc[rows["method"] == "population", "true"]).abs().max()
    assert score_cued_run(PRIOR, run.iloc[:3], records) == []          # 첫 1분 뒤 채점할 구간이 없음


def test_personal_evaluation_uses_only_past_runs():
    speeds = np.array([2.6, 2.8, 3.0, 3.2])
    df = pd.concat([pd.DataFrame({"run_no": r, "speed_mps": speeds, "cadence_spm": cadence(speeds)})
                    for r in (1, 2, 3)], ignore_index=True)
    pred = evaluate_personal(PRIOR, df)
    assert pred.groupby("run_no")["n_past"].first().tolist() == [0, 1, 2]
    assert "service_records" not in set(pred.loc[pred["run_no"] == 1, "method"])   # 첫 러닝은 지난 기록 없음
    cad = pred[pred["run_no"] == 2]
    assert cad.loc[cad["method"] == "service_records", "abs_err"].mean() < \
        cad.loc[cad["method"] == "population", "abs_err"].mean()
    assert len(pred[pred["run_no"] == 3]) == 3 * 3                 # 첫 구간 제외 3구간 × 세 방법
    assert pred["err"].to_numpy() == pytest.approx(pred["pred"] - pred["true"])


def test_cued_runs_use_only_that_persons_earlier_runs():
    df = pd.concat([cued_run(r, [160, 160, 160, 165, 170]) for r in (1, 2, 3)], ignore_index=True)
    pred = evaluate_cued_runs(PRIOR, df, "cued_1")
    # 러닝마다 BPM 3개 = 속도 칸 3개. 그 사람의 앞선 러닝만 쌓인다
    assert pred.groupby("run_no")["n_records"].first().tolist() == [0, 3, 6]
    assert "records" not in set(pred.loc[pred["run_no"] == 1, "method"])

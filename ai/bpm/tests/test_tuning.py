"""BPM-006: 가중 보정, 지난 기록 반영 규칙, 노이즈 나눠 보기를 합성 데이터로 확인한다."""
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest

from evaluate_tuning import noise_parts, rules, weighted_offset
from stride_model import StridePrior, personal_offset

PRIOR = StridePrior(mu=np.array([1.0, 0.3]), G=np.diag([0.05 ** 2, 0.03 ** 2]), sigma2=0.02 ** 2)
SPEEDS = [2.5, 3.0, 3.5]
STRIDES = [0.88, 1.05, 1.19]


def test_equal_weights_match_personal_offset():
    assert weighted_offset(PRIOR, SPEEDS, STRIDES) == pytest.approx(personal_offset(PRIOR, SPEEDS, STRIDES))


def test_half_weight_equals_double_noise():
    noisy = replace(PRIOR, sigma2=2 * PRIOR.sigma2)
    assert weighted_offset(PRIOR, SPEEDS, STRIDES, [0.5] * 3) == pytest.approx(personal_offset(noisy, SPEEDS, STRIDES))


def test_recent_and_decay_rules():
    age = np.array([0, 1, 4, 5])                      # 0 = 바로 전 러닝
    weights = {name: fn(age) for name, fn in rules()}
    assert weights["last5"].tolist() == [1, 1, 1, 0]
    assert weights["all"].tolist() == [1, 1, 1, 1]
    assert weights["decay0.5"] == pytest.approx([1, 0.5, 0.0625, 0.03125])


def test_noise_parts_recovers_within_and_between_run_spread():
    rng = np.random.default_rng(0)
    rows = []
    for run in range(1, 201):
        day = rng.normal(0, 0.03)                     # 날마다 달라지는 보폭
        for _ in range(15):
            v = rng.uniform(2.5, 3.5)
            rows.append({"run_no": run, "speed_mps": v,
                         "stride_m": 1.0 + 0.3 * (v - 3) - 0.02 + day + rng.normal(0, 0.01)})
    parts = noise_parts(PRIOR, pd.DataFrame(rows))
    assert parts["within_run_sd_m"] == pytest.approx(0.01, abs=0.002)
    assert parts["between_run_sd_m"] == pytest.approx(0.03, abs=0.005)
    assert parts["personal_offset_m"] == pytest.approx(-0.02, abs=0.005)

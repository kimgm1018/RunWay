"""정답을 알고 만든 합성 데이터로 보폭 모델과 target_bpm을 확인한다."""
import numpy as np
import pandas as pd
import pytest

from stride_model import StridePrior, fit_prior, personal_offset, predict_cadence
from target_bpm import BPM_MAX, BPM_MIN, target_bpm

TRUE_MU = (1.0, 0.3)          # 3 m/s 보폭, 1 m/s당 보폭 증가
SPEEDS = (2.5, 3.0, 3.5, 4.0)


def make_table(n=40, seed=0, height_effect=0.0):
    """사람마다 절편·기울기가 조금씩 다른 보폭 직선 데이터. height_effect는 키 1cm당 보폭(m)."""
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        height = rng.uniform(160, 190)
        a = TRUE_MU[0] + height_effect * (height - 175) + rng.normal(0, 0.05)
        b = TRUE_MU[1] + rng.normal(0, 0.03)
        for v in SPEEDS:
            stride = a + b * (v - 3) + rng.normal(0, 0.01)
            rows.append({"subject_id": f"S{i:02d}", "speed_mps": v, "stride_m": stride,
                         "cadence_spm": 60 * v / stride, "height_cm": height})
    return pd.DataFrame(rows)


@pytest.fixture(scope="module")
def prior():
    return fit_prior(make_table())


def pace(speed):
    return 1000 / speed


def test_fit_prior_recovers_true_line(prior):
    assert prior.mu == pytest.approx(TRUE_MU, abs=0.03)
    assert prior.sigma2 > 0
    assert np.all(np.diag(prior.G) > 0)


def test_prior_save_load_roundtrip(prior, tmp_path):
    path = tmp_path / "prior.json"
    prior.save(path)
    loaded = StridePrior.load(path)
    assert loaded.mu == pytest.approx(prior.mu)
    assert loaded.G == pytest.approx(prior.G)
    assert loaded.sigma2 == pytest.approx(prior.sigma2)


def test_no_records_means_no_offset(prior):
    assert personal_offset(prior, [], []) == pytest.approx([0.0, 0.0])
    result = target_bpm(360, prior)
    assert result.source == "population"
    assert result.n_records == 0


def test_short_stride_user_gets_higher_bpm(prior):
    # 평균보다 보폭이 10cm 짧은 사람: 같은 페이스에서 케이던스가 높아야 한다
    records = [(3.0, 60 * 3.0 / 0.90)]
    base = target_bpm(360, prior).raw_cadence
    personal = target_bpm(360, prior, records=records)
    assert personal.source == "bayes"
    assert personal.raw_cadence > base


def test_more_records_get_closer_to_truth(prior):
    # 실제 직선: 보폭 = 0.88 + 0.35 × (속도 − 3)
    def true_cadence(v):
        return 60 * v / (0.88 + 0.35 * (v - 3))

    target_speed = 3.6
    errors = []
    for k in (0, 1, 2, 4):
        records = [(v, true_cadence(v)) for v in (2.5, 4.0, 3.0, 3.5)[:k]]
        pred = target_bpm(pace(target_speed), prior, records=records).raw_cadence
        errors.append(abs(pred - true_cadence(target_speed)))
    assert errors[0] > errors[1] > errors[3]
    assert errors[3] < 1.0


def test_offset_moves_partway_with_one_record(prior):
    # 기록 1개는 평균과 그 기록 사이로 끌어당긴다(전부 따라가지 않는다)
    observed = 0.85
    offset = personal_offset(prior, [3.0], [observed])
    fitted = prior.mu[0] + offset[0]
    assert observed < fitted < prior.mu[0]


def test_height_prior_direction():
    prior_h = fit_prior(make_table(height_effect=0.005), use_height=True)
    assert prior_h.height_coef == pytest.approx(0.005, abs=0.002)
    short = target_bpm(360, prior_h, prior_h, height_cm=165)
    tall = target_bpm(360, prior_h, prior_h, height_cm=185)
    assert short.source == tall.source == "height_prior"
    assert short.bpm > tall.bpm


def test_height_outside_range_is_clipped():
    prior_h = fit_prior(make_table(height_effect=0.005), use_height=True)
    lo, _ = prior_h.h_range
    assert predict_cadence(prior_h, [3.0], height_cm=100) == pytest.approx(
        predict_cadence(prior_h, [3.0], height_cm=lo))


def test_falls_back_without_height(prior):
    prior_h = fit_prior(make_table(height_effect=0.005), use_height=True)
    assert target_bpm(360, prior, prior_h).source == "population"          # 키 모름
    assert target_bpm(360, prior, None, height_cm=170).source == "population"   # 키 prior 없음
    with_records = target_bpm(360, prior, prior_h, records=[(3.0, 170)], height_cm=170)
    assert with_records.source == "bayes"                                  # 기록이 있으면 키 무시


@pytest.mark.parametrize("pace_sec", [100, 150, 240, 360, 600, 1200, 3000])
def test_bpm_is_integer_in_range(prior, pace_sec):
    result = target_bpm(pace_sec, prior)
    assert isinstance(result.bpm, int)
    assert BPM_MIN <= result.bpm <= BPM_MAX


def test_comfort_range_clips(prior):
    base = target_bpm(360, prior)
    low = target_bpm(360, prior, comfort_range=(base.raw_cadence + 10, base.raw_cadence + 20))
    high = target_bpm(360, prior, comfort_range=(base.raw_cadence - 20, base.raw_cadence - 10))
    assert low.bpm == round(base.raw_cadence + 10)
    assert high.bpm == round(base.raw_cadence - 10)


@pytest.mark.parametrize("bad", [0, -10])
def test_invalid_pace_raises(prior, bad):
    with pytest.raises(ValueError):
        target_bpm(bad, prior)
"""BPM-005 평가: 워치 기록 읽기와 'BPM → 속도' 역계산을 합성 데이터로 확인한다."""
import json

import numpy as np
import pytest

from evaluate_cued import load_windows, speed_at_bpm
from stride_model import StridePrior, predict_cadence

PRIOR = StridePrior(mu=np.array([1.0, 0.3]), G=np.diag([0.05 ** 2, 0.03 ** 2]), sigma2=0.01 ** 2)


def fake_run(participant, started_at, segments):
    """segments: (초, BPM, 케이던스, 속도) 1초 간격. 워치 앱 내보내기와 같은 구조."""
    samples = []
    for sec, bpm, cadence, speed in segments:
        for metric, value in (("CADENCE", cadence), ("SPEED", speed)):
            samples.append({"metric": metric, "sessionElapsedMs": sec * 1000, "value": value,
                            "unit": "", "targetBpmAtEnd": bpm})
    return {"participantId": participant, "startedAt": started_at, "samples": samples}


def test_speed_at_bpm_is_inverse_of_cadence():
    for offset in (None, np.array([0.05, -0.02])):
        speeds = speed_at_bpm(PRIOR, [150, 165, 180], offset)
        assert predict_cadence(PRIOR, speeds, offset) == pytest.approx([150, 165, 180])


def test_load_windows(tmp_path):
    segments = ([(s, 160, 161, 2.8) for s in range(0, 20)]                 # 따라간 구간
                + [(s, 140, 165, 2.6) for s in range(20, 40)]              # 안 따라간 구간
                + [(s, 160 if s < 50 else 165, 162, 2.8) for s in range(40, 60)])   # 중간에 BPM이 바뀜 → 제외
    (tmp_path / "a.json").write_text(json.dumps(fake_run("Runner01", "2026-11-02T12:00:00Z", segments)),
                                     encoding="utf-16")                    # 워치 앱이 UTF-16으로 저장하기도 한다
    (tmp_path / "b.json").write_text(json.dumps(fake_run("Runner01", "2026-10-27T10:00:00Z", segments)),
                                     encoding="utf-8")                     # 다른 사람이 뛴 날 → 날짜로 제외
    (tmp_path / "c.json").write_text(json.dumps(fake_run("Runner02", "2026-11-01T10:00:00Z", segments)),
                                     encoding="utf-8")                     # 다른 참가자

    df = load_windows(tmp_path, "Runner01", {"2026-10-27"})
    assert df["run_no"].unique().tolist() == [1]
    assert df["bpm"].tolist() == [160, 140]
    assert df["followed"].tolist() == [True, False]
    assert df["stride_m"].iloc[0] == pytest.approx(60 * 2.8 / 161)

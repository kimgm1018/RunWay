import os
from pathlib import Path

import numpy as np
import pytest

from app.models.ode.runtime import load_ode_runtime
from app.planner import prerun_planner as pp


def _ready_runtime(monkeypatch):
    # 찾는 순서(v6_8 E): ① RUNWAY_TEST_ARTIFACTS_DIR(ode_epoch_020.pt + ode_summary_stats.json)
    # ② ODEV21_CHECKPOINT_PATH ③ 저장소 상대경로 models/ode/. 해시 검사는 런타임 기본값 그대로 한다.
    artifact_dir = os.getenv("RUNWAY_TEST_ARTIFACTS_DIR")
    if artifact_dir:
        checkpoint = Path(artifact_dir) / "ode_epoch_020.pt"
        stats = Path(artifact_dir) / "ode_summary_stats.json"
        if checkpoint.is_file() and stats.is_file():
            monkeypatch.setenv("ODEV21_CHECKPOINT_PATH", str(checkpoint))
            monkeypatch.setenv("ODEV21_SUMMARY_STATS_PATH", str(stats))
    path = os.getenv("ODEV21_CHECKPOINT_PATH", "models/ode/ode_epoch_020.pt")
    if not Path(path).expanduser().is_file():
        pytest.skip(f"ODE checkpoint is not installed (확인한 경로: {path}, RUNWAY_TEST_ARTIFACTS_DIR={artifact_dir})")
    runtime = load_ode_runtime()
    if runtime is None:
        pytest.skip("ODE checkpoint or summary stats are not installed")
    return runtime


def test_ode_batch_1_and_128_max_difference_is_at_most_1e_3(monkeypatch):
    runtime = _ready_runtime(monkeypatch)
    one_speed = [3.0] * max(1, runtime.info.validated_horizon_sec // 30)
    one_grade = [0.5] * len(one_speed)
    single = runtime._predict_items(runtime._items([one_speed], [one_grade], None, 85.0))[0]
    speeds = [one_speed] * 128
    grades = [one_grade] * 128
    batched = runtime._predict_items(runtime._items(speeds, grades, None, 85.0))[0]
    n = min(len(single), len(batched))
    assert n > 0
    assert float(np.max(np.abs(single[:n] - batched[:n]))) <= 1e-3

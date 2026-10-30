"""인계 폴더 실행 확인: 모델 로드 → 개인화 → 예측 [N, 3] → NaN/Inf 없음 → reset → CPU 지연. 가짜 입력만 쓴다.

예) python src/smoke_test.py --model-dir model
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from predictor import HRPredictor  # noqa: E402


def fake_run(rng, cells=360, hr=140.0, speed=3.0):
    return {"elapsed_s": np.arange(cells) * 5.0, "hr": hr + np.cumsum(rng.normal(0, 0.5, cells)),
            "speed": speed + rng.normal(0, 0.1, cells)}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--model-dir", type=Path, required=True)
    args = p.parse_args(argv)
    rng = np.random.default_rng(0)
    pred = HRPredictor(args.model_dir, num_threads=4)
    print(f"모델 로드: {pred.config['exp_id']} · {pred.version} · 특징 {len(pred.columns)}개 · 과거 {pred.past}칸")

    day = 86400.0
    support = [{"session_id": f"s{i}", "start_time_s": 1.7e9 + i * day, "duration_s": 1800.0, **fake_run(rng)}
               for i in range(4)]
    L = 200                                                     # t0 = 러닝 시작 후 995초
    run = fake_run(rng, L)
    v0 = run["speed"][-6:].mean()
    pace = 1000 / v0 + np.array([-10, -5, 0, 5, 10])            # candidate 5개 (sec/km)
    batch = {"hr": [run["hr"]] * 5, "speed": [run["speed"]] * 5, "grade": [np.zeros(L)] * 5,
             "elapsed_s": np.full(5, (L - 1) * 5.0), "future_speed": np.repeat((1000 / pace)[:, None], 24, axis=1),
             "future_grade": np.zeros((5, 24)), "session_start_s": np.full(5, 1.7e9 + 5 * day)}

    pred.personalize(support)
    on = pred.predict(batch)
    off = pred.predict(batch, personalized=False)
    assert on.shape == (5, 3), on.shape
    assert np.isfinite(on).all() and np.isfinite(off).all(), "NaN/Inf"
    print("개인화 ON  [HR30, HR60, HR120] (빠른 → 느린 후보):\n", on.round(1))
    print("개인화 OFF:\n", off.round(1))
    pred.reset()
    assert pred.state is None
    cold = pred.predict(batch)
    assert np.allclose(cold, off), "reset 후에는 OFF(Cold-start)와 같아야 한다"
    print("reset 후 상태 없음 · Cold-start 예측 = OFF 예측 확인")

    pred.personalize(support)
    times = []
    for i in range(220):
        t0 = time.perf_counter()
        pred.predict(batch)
        if i >= 20:
            times.append((time.perf_counter() - t0) * 1000)
    pred.reset()
    print(f"CPU 지연 (요청 1건 = 후보 5개, 200회): p50 {np.percentile(times, 50):.1f}ms · p95 {np.percentile(times, 95):.1f}ms")
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

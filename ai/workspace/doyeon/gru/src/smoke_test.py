"""인계 폴더 실행 확인: 모델 로드 → 개인화 → 예측 [N, 3] → NaN/Inf 없음 → OFF·reset → 상태 저장·복원 → CPU 지연. 가짜 입력만 쓴다.

예) python src/smoke_test.py            (이 폴더에서, 기본 model/gru_final.pt)
"""
import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from predictor import MODEL_DIR, load  # noqa: E402

FUT = 24


def fake_run(rng, cells, hr=140.0, speed=3.0):
    """5초 간격 가짜 러닝 (심박이 천천히 오르는 모양)."""
    return {"elapsed_s": np.arange(cells) * 5.0, "hr": hr + np.cumsum(rng.normal(0.05, 0.5, cells)),
            "speed": speed + rng.normal(0, 0.1, cells), "grade": rng.normal(0, 2, cells)}


def check(name, ok):
    print(f"  {'OK  ' if ok else 'FAIL'} {name}")
    return ok


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--checkpoint", type=Path, default=MODEL_DIR / "gru_final.pt")
    args = p.parse_args(argv)
    torch.set_num_threads(4)
    rng = np.random.default_rng(0)

    pred = load(args.checkpoint, "cpu")
    ok = check(f"모델 로드: {args.checkpoint.name} → 경사 앎(M3-005) + 경사 모름(M3-006) · 과거 {pred.hist}칸 · CPU",
               sorted(pred.models) == ["main", "nograde"])

    support = [{"session_id": f"s{i}", **fake_run(rng, 360)} for i in range(4)]   # Support 러닝 4개 (30분씩)
    L = 200                                                                      # t0 = 러닝 시작 후 995초
    run = fake_run(rng, L)
    v0 = run["speed"][-6:].mean()
    pace = 1000 / v0 + np.array([-10, -5, 0, 5, 10])                             # candidate 5개 (sec/km)
    batch = {"hr": [run["hr"]] * 5, "speed": [run["speed"]] * 5, "grade": [run["grade"]] * 5,
             "elapsed_s": np.full(5, (L - 1) * 5.0), "future_speed": np.repeat((1000 / pace)[:, None], FUT, axis=1),
             "future_grade": np.zeros((5, FUT))}
    windows = [{"hr": run["hr"], "speed": run["speed"], "grade": run["grade"], "elapsed_s": run["elapsed_s"],
                "future_speed": batch["future_speed"][i], "future_grade": batch["future_grade"][i]} for i in range(5)]

    base = pred.predict(batch)
    ok &= check(f"출력 shape {base.shape} = (5, 3)", base.shape == (5, 3))
    ok &= check("NaN/Inf 없음", bool(np.isfinite(base).all()))
    ok &= check("묶음 dict 입력 = window 리스트 입력", np.allclose(base, pred.predict(windows), atol=1e-4))
    ok &= check("빠른 pace일수록 HR@120 높음", bool((np.diff(base[:, 2]) <= 0.5).all()))

    no_grade = pred.predict({**batch, "future_grade": None})
    ok &= check("경사 모름(None) → M3-006, NaN/Inf 없음", no_grade.shape == (5, 3) and bool(np.isfinite(no_grade).all()))
    ok &= check("경사 NaN = 경사 None", np.allclose(no_grade, pred.predict({**batch, "future_grade": np.full((5, FUT), np.nan)}), atol=1e-4))

    t = time.perf_counter(); pred.personalize(support); t_pers = time.perf_counter() - t
    on = pred.predict(batch)
    off = pred.predict(batch, personalized=False)
    ok &= check(f"개인화 ON ≠ OFF (personalize {t_pers:.2f}초)", not np.allclose(on, off))
    ok &= check("predict(personalized=False) = 개인화 전", np.allclose(off, base, atol=1e-4))
    ok &= check("OFF 예측 뒤에도 ON 상태 유지", np.allclose(pred.predict(batch), on, atol=1e-4))

    state_path = Path(__file__).resolve().parent / "_smoke_state.pt"
    pred.save_state(state_path)
    pred.reset()
    ok &= check("reset 후 = 개인화 전 (앞사람 상태 안 남음)", np.allclose(pred.predict(batch), base, atol=1e-4))
    pred.load_state(state_path)
    ok &= check("save_state → load_state로 ON 복원", np.allclose(pred.predict(batch), on, atol=1e-4))
    state_path.unlink()
    pred.reset()

    short = pred.predict({**batch, "hr": [run["hr"][-1:]] * 5, "speed": [run["speed"][-1:]] * 5,
                          "grade": [run["grade"][-1:]] * 5})
    ok &= check("과거 1칸만 있어도 예측 (window 제외 없음)", short.shape == (5, 3) and bool(np.isfinite(short).all()))

    times = []
    for i in range(220):                                                         # 요청 1건 = candidate 5개
        t = time.perf_counter(); pred.predict(batch); dt = time.perf_counter() - t
        if i >= 20:
            times.append(dt)
    p95 = float(np.percentile(times, 95))
    ok &= check(f"CPU 지연 p50 {np.percentile(times, 50) * 1000:.1f}ms · p95 {p95 * 1000:.1f}ms ≤ 1초", p95 <= 1.0)

    print("OK" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

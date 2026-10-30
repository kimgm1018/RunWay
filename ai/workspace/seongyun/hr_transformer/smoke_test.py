"""인계 패키지 smoke test: load → personalize → predict → reset을 CPU에서 자동 검증한다.

    python smoke_test.py --checkpoint <Hugging Face에서 받은 경로>/ptv2_sessionctx_v1_seed1729_step130000.pt

checkpoint는 Git에 없다(README 13장). --checkpoint는 필수이고, 파일 SHA256이 config/final_checkpoint.json과 같은지도
확인한다. 입력은 합성(가짜) 세션만 쓴다. 실제 건강 데이터·Test split은 열지 않는다. 마지막 줄 "SMOKE OK" = 전부 통과.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from predictor import Predictor, file_sha256, query_batch_from_session  # noqa: E402

DAY = 86400.0
FAILURES = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))  # ASCII: cp949 consoles
    if not ok:
        FAILURES.append(name)


def raises(fn) -> bool:
    try:
        fn()
    except ValueError:
        return True
    return False


def synthetic_session(rng, *, session_id: str, start_s: float, minutes: int, base_hr: float, gap: bool = False) -> dict:
    """그럴듯한 합성 러닝 1개 (5초 칸). gap=True면 가운데 60초가 끊긴 segment 2개."""
    n = minutes * 12
    t = np.arange(n)
    speed = 2.9 + 0.35 * np.sin(t / 40.0) + 0.05 * rng.standard_normal(n)
    grade = 3.0 * np.sin(t / 55.0) + 0.3 * rng.standard_normal(n)
    hr = np.empty(n)
    hr[0] = 95.0
    for i in range(1, n):
        target = base_hr + 16.0 * (speed[i] - 2.9) + 1.3 * grade[i]
        hr[i] = hr[i - 1] + (target - hr[i - 1]) * 5.0 / 45.0 + 0.6 * rng.standard_normal()
    hr = np.round(hr)
    filled = rng.random(n) < 0.03
    filled[0] = False
    for i in np.flatnonzero(filled):
        hr[i] = hr[i - 1]  # LOCF
    elapsed = 5.0 * t
    segment = np.zeros(n, np.int64)
    if gap:
        segment[n // 2:] = 1
        elapsed[n // 2:] += 60.0
    return dict(session_id=session_id, start_time_s=start_s, end_time_s=start_s + elapsed[-1] + 5.0,
                elapsed_s=elapsed, segment_id=segment, hr=hr.astype(np.float32), hr_is_filled=filled,
                speed=speed.astype(np.float32), grade=grade.astype(np.float32),
                hr_quality=np.full(n, "GOOD"), speed_quality=np.full(n, "GOOD"), grade_quality=np.full(n, "GOOD"))


def user_sessions(seed: int, base_hr: float, t_start: float):
    rng = np.random.default_rng(seed)
    support = [synthetic_session(rng, session_id=f"u{seed}_s{i}", start_s=t_start + i * 2 * DAY, minutes=35 + 5 * i,
                                 base_hr=base_hr, gap=(i == 1)) for i in range(4)]
    query = synthetic_session(rng, session_id=f"u{seed}_q", start_s=t_start + 9 * DAY, minutes=40, base_hr=base_hr)
    return support, query


def candidate_batch(query: dict, t0: float = 1200.0, scales=(0.9, 0.95, 1.0, 1.05, 1.1)) -> dict:
    """같은 t0에서 pace 후보 5개 (기록된 미래 속도 × scale, 경사는 기록값)."""
    one = query_batch_from_session(query, [t0])
    n = len(scales)
    batch = {k: (v * n if isinstance(v, list) else np.repeat(v, n, axis=0)) for k, v in one.items()}
    batch["future_speed"] = (one["future_speed"] * np.asarray(scales, np.float32)[:, None]).astype(np.float32)
    return batch


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--checkpoint", required=True,
                    help="final checkpoint .pt downloaded from Hugging Face (README 13, config/final_checkpoint.json)")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--threads", type=int, default=None)
    ap.add_argument("--latency-runs", type=int, default=100)
    args = ap.parse_args(argv)
    if not Path(args.checkpoint).is_file():
        print(f"checkpoint not found: {args.checkpoint}\n"
              "Model weights are not in Git: download them from Hugging Face (README 13) and pass the path.")
        return 2
    ckpt_sha_before = file_sha256(args.checkpoint)
    final = json.loads((HERE / "config" / "final_checkpoint.json").read_text(encoding="utf-8"))
    check("0 checkpoint SHA256 == final (config/final_checkpoint.json)", ckpt_sha_before == final["sha256"],
          f"{Path(args.checkpoint).name} {ckpt_sha_before[:12]}")

    # 1. model load
    t = time.perf_counter()
    p = Predictor(args.checkpoint, device=args.device, num_threads=args.threads)
    check("1 model load", True, f"{time.perf_counter() - t:.2f}s, seed {p.info['seed']}, step {p.info['step']}, "
          f"params {p.info['parameters']:,}, device {args.device}, sha {p.checkpoint_sha256[:12]}")
    prior = p.personal4()
    check("  population state at load", not p.is_personalized
          and np.array_equal(prior, p.population_personal4.numpy()), f"Personal4 prior {np.round(prior, 4).tolist()}")

    support_a, query_a = user_sessions(11, 158.0, 1.7e9)
    support_b, query_b = user_sessions(22, 128.0, 1.7e9 + 40 * DAY)
    batch_a, batch_b = candidate_batch(query_a), candidate_batch(query_b, t0=1500.0)
    pop_a = p.predict(batch_a)  # 개인화 전 = population

    # 2-3. Support → personalize
    t = time.perf_counter()
    s = p.personalize(support_a, user_id="A")
    t_personalize = time.perf_counter() - t
    check("2-3 personalize(support A)", p.is_personalized and s["support_windows"] > 0 and s["updates"] > 0,
          f"{s['support_sessions']} sessions, {s['support_windows']} windows, {s['updates']} updates, "
          f"loss {s['loss_first']:.2f}->{s['loss_last']:.2f}, |dPersonal4| {s['personal4_shift']:.4f}, "
          f"{t_personalize:.2f}s")
    check("  shared weights unchanged", _shared_ok(p))
    check("  Personal4 adapted", s["personal4_shift"] > 0)

    # 4-8. Query predict
    state_before = (p.personal4().tobytes(), _workouts_digest(p))
    on_a = p.predict(batch_a)
    check("4-6 predict shape == [N, 3]", on_a.shape == (5, 3), f"{on_a.shape}, dtype {on_a.dtype}")
    check("7 no NaN", not np.isnan(on_a).any())
    check("8 no Inf", not np.isinf(on_a).any())
    print("    HR@30/60/120 (A, 5 pace candidates):", np.round(on_a, 1).tolist())
    p.predict(batch_b)  # 다른 Query를 먼저 예측해도
    check("  predict is read-only", state_before == (p.personal4().tobytes(), _workouts_digest(p))
          and np.array_equal(p.predict(batch_a), on_a) and _shared_ok(p), "state, history and outputs unchanged")
    print("    (info) HR@120 by pace scale 0.9..1.1:", np.round(on_a[:, 2], 2).tolist())

    # OFF
    off_a = p.predict(batch_a, personalized=False)
    check("  OFF == population (before personalize)", np.array_equal(off_a, pop_a))
    check("  ON != OFF", float(np.abs(on_a - off_a).max()) > 0, f"max |ON-OFF| {np.abs(on_a - off_a).max():.3f} bpm")

    # 9-10. reset
    p.reset()
    check("9 reset()", not p.is_personalized)
    check("10 after reset: state == population/default", np.array_equal(p.personal4(), prior)
          and np.array_equal(p.predict(batch_a), pop_a), "Personal4 == prior, outputs == population")

    # isolation A → B
    fresh = Predictor(args.checkpoint, device=args.device)
    fresh.personalize(support_b, user_id="B")
    ref_b = fresh.predict(batch_b)
    p.personalize(support_b, user_id="B")
    check("  isolation (A then reset then B == fresh B)", np.array_equal(p.predict(batch_b), ref_b)
          and np.array_equal(p.personal4(), fresh.personal4()))
    p.personalize(support_a, user_id="A")
    p.personalize(support_b, user_id="B")  # reset 없이 다시 불러도 이전 상태를 버린다
    check("  personalize() discards the previous user", np.array_equal(p.predict(batch_b), ref_b))

    # 상태 저장/불러오기 (임시 폴더)
    with tempfile.TemporaryDirectory() as tmp:
        path = p.save_state(Path(tmp) / "user_B.json")
        q = Predictor(args.checkpoint, device=args.device)
        q.load_state(path)
        check("  save_state/load_state round trip", np.array_equal(q.predict(batch_b), ref_b), path.name)
    p.reset()

    # 입력 검증
    bad_len = dict(batch_a, future_speed=batch_a["future_speed"][:, :20])
    bad_grade = dict(batch_a, future_grade=np.where(np.arange(24) == 3, np.nan, batch_a["future_grade"]))
    short = dict(batch_a, hr=[x[-10:] for x in batch_a["hr"]], speed=[x[-10:] for x in batch_a["speed"]],
                 grade=[x[-10:] for x in batch_a["grade"]], row_elapsed_s=[x[-10:] for x in batch_a["row_elapsed_s"]],
                 segment=None, hr_is_filled=None, hr_quality=None, speed_quality=None, grade_quality=None)
    nan_hr = dict(batch_a, hr=[np.r_[x[:-1], np.nan] for x in batch_a["hr"]])
    no_start = {k: v for k, v in batch_a.items() if k != "session_start_s"}
    p.personalize(support_a)
    cases = {"missing key": {k: v for k, v in batch_a.items() if k != "future_grade"},
             "future length 20": bad_len, "NaN future grade": bad_grade, "prefix < 24 rows": short,
             "NaN HR0": nan_hr, "personalized without session_start_s": no_start}
    for name, b in cases.items():
        check(f"  input validation: {name} -> ValueError", raises(lambda b=b: p.predict(b)))
    p.reset()

    # T4: future grade 0 (평지) 명시
    t4 = p.predict(dict(batch_a, future_grade=np.zeros_like(batch_a["future_grade"])))
    check("  T4 future_grade = 0 runs", t4.shape == (5, 3) and np.isfinite(t4).all())

    # CPU latency (personalized, N = 5 후보)
    p.personalize(support_a)
    for _ in range(5):
        p.predict(batch_a)
    times = []
    for _ in range(args.latency_runs):
        t = time.perf_counter()
        p.predict(batch_a)
        times.append((time.perf_counter() - t) * 1000)
    p50, p95 = np.percentile(times, [50, 95])
    check("  CPU latency (N=5)", True, f"p50 {p50:.1f} ms, p95 {p95:.1f} ms over {args.latency_runs} runs, "
          f"torch threads {torch.get_num_threads()}")
    p.reset()

    check("  checkpoint file unchanged", file_sha256(args.checkpoint) == ckpt_sha_before)
    if FAILURES:
        print(f"SMOKE FAILED: {FAILURES}")
        return 1
    print("SMOKE OK")
    return 0


def _shared_ok(p: Predictor) -> bool:
    try:
        p.verify_shared_unchanged()
        return True
    except AssertionError:
        return False


def _workouts_digest(p: Predictor) -> bytes:
    if not p.is_personalized:
        return b""
    return b"".join(w["rows"].tobytes() for w in p._state["workouts"])


if __name__ == "__main__":
    sys.exit(main())

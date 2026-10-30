"""Inference Latency와 What-if Response 측정 (팀 기준 초안).

What-if PASS: 세 시나리오 모두
 ① 평균 변화가 모든 시점에서 맞는 방향
 ② |@30| <= |@60| <= |@120| (경사는 |@120| >= 0.9 x |@60| 까지 허용)
 ③ +120초에서 맞는 방향인 샘플 85% 이상
 ④ 속도 ±20%는 +120초 평균 변화가 3~20 bpm

이미 저장된 모델 측정: python ai/gru/measure.py --checkpoint ~/runway-runs/M2-001/best.pt
"""
import argparse
import time

import pandas as pd
import torch

from data import FEATURES, FUT, HIST, TARGET, EVAL_STRIDE, ELAPSED_CLIP, HorizonDataset, Normalizer, load_fitrec, split_by_contract
from model import HorizonGRU


# 이름: (바꿀 입력 칸 번호, 바꾸는 방법, 기대 방향 +1 오름 / -1 내림)
SCENARIOS = {
    "speed+20%": (0, lambda v: v * 1.2, +1),
    "speed-20%": (0, lambda v: v * 0.8, -1),
    "grade+5pp": (1, lambda v: v + 5.0, +1),
}


def measure_latency(model, device, steps=HIST + FUT, repeat=300):
    """샘플 1개(steps칸)를 예측하는 평균 시간(ms)."""
    model.to(device).eval()
    x = torch.randn(1, steps, model.gru.input_size, device=device)
    with torch.no_grad():
        for _ in range(30):                  # 처음 몇 번은 느려서 버림
            model(x)
        if device == "cuda":
            torch.cuda.synchronize()
        start = time.perf_counter()
        for _ in range(repeat):
            model(x)
        if device == "cuda":
            torch.cuda.synchronize()
    return (time.perf_counter() - start) / repeat * 1000


def latency_report(model, steps=HIST + FUT):
    devices = ["cpu"] + (["cuda"] if torch.cuda.is_available() else [])
    return {f"Latency_{d}_ms": measure_latency(model, d, steps) for d in devices}


def what_if(model, dataset, norm, device, n=5000, seed=0):
    """val 샘플 n개의 미래 속도·경사만 바꿔서 예측 심박이 상식대로 바뀌는지 본다."""
    model.to(device).eval()
    idx = torch.randperm(len(dataset), generator=torch.Generator().manual_seed(seed))[:n]
    seq = torch.stack([dataset[i][0] for i in idx]).to(device)
    hr_std = norm.std[TARGET]

    def predict(s):
        with torch.no_grad():
            return model(s).cpu() * hr_std   # 변화량 (bpm)

    base = predict(seq)
    result, passed = {}, True
    for name, (col, change, sign) in SCENARIOS.items():
        feat = FEATURES[col]
        s = seq.clone()
        raw = s[:, -FUT:, col] * norm.std[feat] + norm.mean[feat]          # 원래 단위로
        s[:, -FUT:, col] = (change(raw) - norm.mean[feat]) / norm.std[feat]  # 바꾸고 다시 정규화
        diff = predict(s) - base                                           # (n, 3) bpm
        mean = diff.mean(0)
        right = (diff * sign > 0).float().mean(0)

        ok_direction = bool((mean * sign > 0).all())                        # ①
        size = mean.abs()
        if feat == "grade_observed_pct":   # 경사는 1분 안에 포화될 수 있어 +120초가 +60초의 90% 이상이면 OK
            ok_grow = bool(size[0] <= size[1] and size[2] >= 0.9 * size[1])  # ②
        else:
            ok_grow = bool(size[0] <= size[1] <= size[2])                   # ②
        ok_consistent = right[2].item() >= 0.85                             # ③
        ok_size = 3 <= size[2].item() <= 20 if feat == "speed_mps" else True  # ④
        passed &= ok_direction and ok_grow and ok_consistent and ok_size

        result[f"WhatIf_{name}_change@120"] = mean[2].item()
        result[f"WhatIf_{name}_right@120"] = right[2].item()
        print(f"  What-if {name:10s} change @30/60/120 "
              + " ".join(f"{v:+.2f}" for v in mean.tolist())
              + "  | right " + " ".join(f"{v * 100:.0f}%" for v in right.tolist())
              + f"  | ①{ok_direction} ②{ok_grow} ③{ok_consistent} ④{ok_size}")
    result["WhatIf_PASS"] = passed
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", required=True)
    args = p.parse_args()

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    a = ckpt["args"]
    use_elapsed = a.get("use_elapsed", False)   # ← 추가: 경과 시간 입력을 쓴 모델인지
    model = HorizonGRU(n_inputs=5 if use_elapsed else 4, hidden=a["hidden"], layers=a["layers"],
                       mask_future_grade=a.get("no_future_grade", False))
    model.load_state_dict(ckpt["model"])

    norm = object.__new__(Normalizer)                 # 학습 때 저장한 정규화 기준값 그대로 사용
    norm.mean, norm.std = pd.Series(ckpt["norm_mean"]), pd.Series(ckpt["norm_std"])
    df = load_fitrec(a["data_dir"], a["n_files"])
    _, val_df, _ = split_by_contract(df, a["split_path"], a["data_dir"])

    device = "cuda" if torch.cuda.is_available() else "cpu"
    hist = a.get("hist", HIST)                       # 예전 체크포인트에는 hist가 없음 → 24
    elapsed_clip = a.get("elapsed_clip", ELAPSED_CLIP)   # 예전 체크포인트에는 없음 → 30분
    result = what_if(model, HorizonDataset(norm(val_df), stride=EVAL_STRIDE, use_elapsed=use_elapsed, hist=hist,
                                           elapsed_clip=elapsed_clip), norm, device)
    result.update(latency_report(model, hist + FUT))
    for k, v in result.items():
        print(f"{k}: {v:.3f}" if isinstance(v, float) else f"{k}: {v}")
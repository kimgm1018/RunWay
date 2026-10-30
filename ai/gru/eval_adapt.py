"""v2 개인화(adaptation): 사람별 support 러닝으로 모델을 미세조정한 뒤 query 러닝을 예측한다.

v2 분할 규칙대로 personalized val 그룹은 오래된 support 러닝(약 80%)으로 그 사람 모델을 따로 미세조정하고,
최신 query 러닝(약 20%)을 채점한다. cold start 그룹은 support가 없어 미세조정 없이 기본 모델로 채점한다.
보정 전(before)은 같은 query를 기본 모델로 채점한 값 = 계약의 population_no_adaptation이다.
 - head: GRU는 그대로 두고 마지막 출력층(hidden → 3)만 미세조정 (사람별 파라미터 771개)
 - all: 모델 전체를 미세조정
학습 때와 같이 미래 속도는 2분 평균(Flat), 손실은 실제로 잰 정답만 쓴 L1이다.

실행: python ai/gru/eval_adapt.py --model-run M3-001 --run-name M3-004
"""
import argparse
import copy
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import wandb
from torch.utils.data import DataLoader

from data import USER_COL, HIST, FUT, EVAL_STRIDE, ELAPSED_CLIP, HorizonDataset, load_fitrec, session_roles_v2
from eval_personal import SECONDS, PRIOR_BINS, load_model, person_of, predict_samples, mae


def adapt(base, df, mode, epochs, lr, stride, use_elapsed, hist, elapsed_clip, device, seed):
    """한 사람의 support 러닝(df, 정규화된 값)으로 기본 모델 복사본을 미세조정해 돌려준다."""
    model = copy.deepcopy(base)
    for name, p in model.named_parameters():
        p.requires_grad = mode == "all" or name.startswith("head.")
    ds = HorizonDataset(df, stride=stride, use_elapsed=use_elapsed, hist=hist, elapsed_clip=elapsed_clip)
    if len(ds) == 0:
        return model, 0
    loader = DataLoader(ds, batch_size=256, shuffle=True, generator=torch.Generator().manual_seed(seed))
    opt = torch.optim.Adam([p for p in model.parameters() if p.requires_grad], lr=lr)
    model.train(mode == "all")                     # head만 바꿀 때는 GRU dropout을 끄고 특징을 고정
    for _ in range(epochs):
        for seq, target, current, valid, _ in loader:
            seq[:, -FUT:, 0] = seq[:, -FUT:, 0].mean(1, keepdim=True)          # Flat: 학습 때와 같음
            seq, target, current, valid = seq.to(device), target.to(device), current.to(device), valid.to(device)
            err = (model(seq) - (target - current[:, None])).abs()
            loss = (err * valid).sum() / valid.sum().clamp(min=1)              # 실제로 잰 정답만 반영
            opt.zero_grad()
            loss.backward()
            opt.step()
    model.eval()
    return model, len(ds)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model-run", default="M3-001")                    # 미세조정할 기본 모델 실험 ID
    p.add_argument("--run-name", required=True)                        # 이 평가의 실험 ID. 예: M3-004
    p.add_argument("--adapt", choices=["head", "all"], default="head")  # 미세조정 범위
    p.add_argument("--adapt-epochs", type=int, default=5)              # support를 몇 번 반복해서 볼지
    p.add_argument("--adapt-lr", type=float, default=1e-3)
    p.add_argument("--adapt-stride", type=int, default=EVAL_STRIDE)    # support 샘플 간격 (6 = 30초)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--max-groups", type=int, default=None)             # 동작 확인용: 앞쪽 그룹만
    p.add_argument("--runs-dir", default=str(Path.home() / "runway-runs"))
    p.add_argument("--project", default="runway-hr")
    args = p.parse_args()

    torch.manual_seed(args.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    base, norm, a = load_model(Path(args.runs_dir) / args.model_run / "best.pt", device)
    use_elapsed, hist, elapsed_clip = a.get("use_elapsed", False), a.get("hist", HIST), a.get("elapsed_clip", ELAPSED_CLIP)
    with open(a["split_path"], encoding="utf-8") as f:
        spec = json.load(f)
    assert "cohorts" in spec, "v2 분할로 학습한 모델만 쓸 수 있다 (v1 체크포인트는 v2 val 평가 금지)"

    # val 그룹의 support·query·cold start 러닝. test는 쓰지 않는다.
    df = load_fitrec(a["data_dir"], a["n_files"])
    groups = person_of(a["split_path"])
    df = df.assign(group=df[USER_COL].map(lambda s: groups.get(s, s)), role=df["session_id"].map(session_roles_v2(spec, a["data_dir"])))
    personal, cold = list(spec["cohorts"]["personalized_val"]), set(spec["cohorts"]["cold_start_val"])
    if args.max_groups:
        personal = personal[:args.max_groups]
    df = df[df["group"].isin(set(personal) | cold) & df["role"].isin(["val", "support"])]
    ndf = norm(df)

    # 사람별: support로 미세조정 → query 예측 (보정 전 예측도 같이)
    before, after, sess_all, true_all, valid_all, tags_all, n_support, is_cold = [], [], [], [], [], [], [], []
    for i, g in enumerate(personal + sorted(cold)):
        query = ndf[(ndf["group"] == g) & (ndf["role"] == "val")]
        if len(query) == 0:
            continue
        support = ndf[(ndf["group"] == g) & (ndf["role"] == "support")]
        sess, pred0, true, valid, tags = predict_samples(base, norm, query, use_elapsed, hist, elapsed_clip, device)
        if len(sess) == 0:
            continue
        if g in cold:
            pred1, n = pred0, 0                                                # cold start: 미세조정 없음
        else:
            model, n = adapt(base, support, args.adapt, args.adapt_epochs, args.adapt_lr, args.adapt_stride,
                             use_elapsed, hist, elapsed_clip, device, args.seed + i)
            _, pred1, _, _, _ = predict_samples(model, norm, query, use_elapsed, hist, elapsed_clip, device)
        before.append(pred0); after.append(pred1); sess_all.append(sess); true_all.append(true); valid_all.append(valid)
        tags_all.append(tags)
        n_support.append(np.full(len(sess), support["session_id"].nunique()))
        is_cold.append(np.full(len(sess), g in cold))
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}명 완료")

    pred0, pred1, true, valid = (np.concatenate(x) for x in [before, after, true_all, valid_all])
    sess, prior, is_cold = np.concatenate(sess_all), np.concatenate(n_support), np.concatenate(is_cold)
    tags = {name: np.concatenate([t[name] for t in tags_all]) for name in tags_all[0]}
    errs = {"before": np.abs(true - pred0), "adapt": np.abs(true - pred1)}

    def row(mask_rows):
        m = valid & mask_rows[:, None]
        r = {"share": float(mask_rows.mean())}
        for method, e in errs.items():
            per_h = mae(e, m)
            r[method] = float(per_h.mean())
            r.update({f"{method}@{s}": float(v) for s, v in zip(SECONDS, per_h)})
        return r

    results = {"all": row(np.ones(len(sess), bool)), "personalized": row(~is_cold), "cold_start": row(is_cold)}
    for lo, hi, name in PRIOR_BINS:
        results[f"prior_{name}"] = row((prior >= lo) & ((prior <= hi) if hi is not None else True))
    for name, t in tags.items():
        results[name] = row(t.astype(bool))

    print(f"분할 {spec['name']}, 평가 러닝 {len(set(sess))}개, 샘플 {len(sess)}개, 미세조정 {args.adapt} "
          f"(epoch {args.adapt_epochs}, lr {args.adapt_lr}, support 샘플 간격 {args.adapt_stride})")
    print(f"{'구간':<16}{'비율':>7}{'보정 전':>9}{'미세조정':>9}   미세조정 @30/60/120")
    for name, r in results.items():
        print(f"{name:<16}{r['share']:>7.1%}{r['before']:>9.3f}{r['adapt']:>9.3f}   "
              + " ".join(f"{r[f'adapt@{s}']:.2f}" for s in SECONDS))
    print(f"※ 보정 전 전체(all)가 {args.model_run}의 W&B Flat_Overall_MAE와 같아야 평가가 학습 때와 같은 조건이다")

    out_dir = Path(args.runs_dir) / args.run_name
    out_dir.mkdir(parents=True, exist_ok=True)
    run = wandb.init(project=args.project, name=args.run_name, job_type="eval", dir=str(out_dir), config={
        "model_run": args.model_run, "adapt": args.adapt, "adapt_epochs": args.adapt_epochs, "adapt_lr": args.adapt_lr,
        "adapt_stride": args.adapt_stride, "seed": args.seed, "max_groups": args.max_groups, "future": "flat",
        "split": spec["name"], "history": "support", "test_used": False,
        "eval_sessions": len(set(sess)), "eval_samples": len(sess),
    })
    run.summary.update({f"{name}/{k}": v for name, r in results.items() for k, v in r.items()})
    run.summary.update({"Flat_Overall_MAE_before": results["all"]["before"],
                        "Flat_Overall_MAE_adapt": results["all"]["adapt"]})
    run.finish()


if __name__ == "__main__":
    main()

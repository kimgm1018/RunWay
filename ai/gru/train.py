import argparse
import json
from pathlib import Path

import torch
import torch.nn as nn
import wandb  
from torch.utils.data import DataLoader

from data import FEATURES, TARGET, HIST, FUT, HORIZONS, STRIDE, EVAL_STRIDE, START, ELAPSED_BINS, Normalizer, HorizonDataset, load_fitrec, split_by_contract
from model import HorizonGRU
from measure import latency_report, what_if

import matplotlib.pyplot as plt

def masked_mae(err, mask):
    """mask가 True인 칸만 평균 (시점별 3개)."""
    return (err * mask).sum(0) / mask.sum(0).clamp(min=1)


def evaluate(model, loader, norm, device, future="actual"):
    """future: "actual"=실제 미래 속도, "hold"=지금 속도 유지, "flat"=미래 2분 평균 속도"""
    """실제로 잰 정답만 채점. 시점별 MAE, 상황별 Overall MAE를 모델과 Persistence 각각 bpm으로.
    speed_hold=True면 미래 속도를 '지금 속도 그대로'로 바꿔서 예측 (실제 서비스에 가까운 조건)."""
    std = norm.std[TARGET]
    sp_m, sp_s = norm.mean["speed_mps"], norm.std["speed_mps"]
    gr_m, gr_s = norm.mean["grade_observed_pct"], norm.std["grade_observed_pct"]
    model.eval()
    errs_m, errs_p, valids = [], [], []
    tags = {"early": [], "uphill": [], "speed_change": [], **{name: [] for name in ELAPSED_BINS}}
    with torch.no_grad():
        for seq, target, current, valid, elapsed in loader:
            now_speed = seq[:, -FUT - 1, 0]                               # 지금 속도 (정규화)
            future_speed = seq[:, -FUT:, 0] * sp_s + sp_m                 # 원래 단위 (m/s)
            future_grade = seq[:, -FUT:, 1] * gr_s + gr_m                 # 원래 단위 (%)
            tags["early"].append(elapsed <= 300)                          # 러닝 시작 5분 이내
            for name, (lo, hi) in ELAPSED_BINS.items():                   # 경과 시간 구간별
                tags[name].append((elapsed >= lo) & (elapsed < hi))
            tags["uphill"].append(future_grade.mean(1) > 3)               # 앞으로 평균 3% 넘는 오르막
            tags["speed_change"].append((future_speed.mean(1) - (now_speed * sp_s + sp_m)).abs() > 0.5)
            if future == "hold":
                seq = seq.clone()
                seq[:, -FUT:, 0] = now_speed[:, None]                     # 미래 속도 = 지금 속도
            elif future == "flat":
                seq = seq.clone()
                seq[:, -FUT:, 0] = seq[:, -FUT:, 0].mean(1, keepdim=True)  # 미래 속도 = 2분 평균                   # 미래 속도 = 지금 속도
            pred = current[:, None] + model(seq.to(device)).cpu()
            errs_m.append((pred - target).abs() * std)
            errs_p.append((current[:, None] - target).abs() * std)
            valids.append(valid)
    err_m, err_p, valid = torch.cat(errs_m), torch.cat(errs_p), torch.cat(valids)
    result = {"mae": masked_mae(err_m, valid), "persist": masked_mae(err_p, valid)}
    for name, tag in tags.items():
        mask = valid & torch.cat(tag)[:, None]
        result[f"{name}_mae"] = masked_mae(err_m, mask).mean().item()
        result[f"{name}_persist"] = masked_mae(err_p, mask).mean().item()
        result[f"{name}_share"] = torch.cat(tag).float().mean().item()
    return result



def main():
    p = argparse.ArgumentParser()
    p.add_argument("--epochs", type=int, default=10)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--hidden", type=int, default=64)
    p.add_argument("--layers", type=int, default=2)
    p.add_argument("--data-dir", default="C:/Users/SSAFY/Desktop/fitrec/canonical/fitrec_v1")
    p.add_argument("--split-path", default="C:/Users/SSAFY/Desktop/fitrec/fitrec_hr_v1.json")
    p.add_argument("--n-files", type=int, default=3)
    p.add_argument("--run-name", required=True)                       # 실험 ID. 예: M2-002
    p.add_argument("--project", default="runway-hr")                  # 팀 공통 W&B 프로젝트 이름
    p.add_argument("--batch", type=int, default=256)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--out-dir", default=str(Path.home() / "runway-runs"))   # 저장소 밖
    p.add_argument("--flat-future", action="store_true")   # 학습 때 미래 속도를 2분 평균으로 평평하게
    p.add_argument("--flat-prob", type=float, default=None)   # 샘플마다 이 확률로만 평평하게 (0.5 = 절반은 실제 속도)
    p.add_argument("--no-future-grade", action="store_true")   # 미래 경사를 항상 비움 (경사 모를 때 쓰는 모델)
    p.add_argument("--select-by", choices=["actual", "flat"], default="actual")   # ← 추가: best 모델 고르는 점수
    p.add_argument("--use-elapsed", action="store_true")   # 경과 시간을 5번째 입력으로
    p.add_argument("--cosine", action="store_true")   # 학습률 cosine 감소   (add_argument 목록 끝)
    p.add_argument("--dropout", type=float, default=0.0)   # GRU 층 사이 dropout
    p.add_argument("--hist", type=int, default=24)         # 과거 입력 칸 수 (5초 단위, 48 = 4분)
    p.add_argument("--elapsed-clip", type=int, default=1800)   # 경과 시간 자르는 기준 (초, 7200 = 120분)

    args = p.parse_args()
    torch.manual_seed(args.seed)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    df = load_fitrec(args.data_dir, args.n_files)     
    train_df, val_df, _ = split_by_contract(df, args.split_path, args.data_dir)   # test는 안 씀
    with open(args.split_path, encoding="utf-8") as f:
        split_name = json.load(f)["name"]                 # fitrec_hr_v1 / fitrec_hr_v2
    norm = Normalizer(train_df)
    train_loader = DataLoader(HorizonDataset(norm(train_df), stride=STRIDE, use_elapsed=args.use_elapsed, hist=args.hist, elapsed_clip=args.elapsed_clip), batch_size=args.batch, shuffle=True)
    val_loader = DataLoader(HorizonDataset(norm(val_df), stride=EVAL_STRIDE, use_elapsed=args.use_elapsed, hist=args.hist, elapsed_clip=args.elapsed_clip), batch_size=1024)   # 평가 위치 고정
    out_dir = Path(args.out_dir) / args.run_name
    out_dir.mkdir(parents=True, exist_ok=True)
    run = wandb.init(
        project=args.project,
        name=args.run_name,
        dir=str(out_dir),                      # wandb 로그 폴더도 저장소 밖에
        config={
            **vars(args),                      # epochs, lr, hidden, batch, seed, n_files ...
            "model": "HorizonGRU",
            "dataset_version": "fitrec_canonical_v1.1",
            "split": split_name,
            "features": FEATURES + [TARGET],
            "history_steps": args.hist, "future_steps": FUT,
            "horizons_steps": HORIZONS, "stride_steps": STRIDE,
            "eval_stride_steps": EVAL_STRIDE, "start_steps": START, "eval_target": "measured_only",
            "train_subjects": train_df["subject_id"].nunique(),
            "val_subjects": val_df["subject_id"].nunique(),
            "train_samples": len(train_loader.dataset),
            "val_samples": len(val_loader.dataset),
            "test_used": False,
        },
    )

    model = HorizonGRU(n_inputs=5 if args.use_elapsed else 4, hidden=args.hidden, layers=args.layers, dropout=args.dropout,
                       mask_future_grade=args.no_future_grade).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs) if args.cosine else None

    history = []
    best = float("inf") 
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0


        for seq, target, current, valid, _ in train_loader:
            if args.flat_future:                                        # 미래 속도 24칸 → 그 평균으로
                seq[:, -FUT:, 0] = seq[:, -FUT:, 0].mean(1, keepdim=True)
            elif args.flat_prob:                                        # 일부 샘플만 평평하게
                pick = torch.rand(len(seq)) < args.flat_prob
                seq[pick, -FUT:, 0] = seq[pick, -FUT:, 0].mean(1, keepdim=True)
            seq, target, current, valid = seq.to(device), target.to(device), current.to(device), valid.to(device)
            err = (model(seq) - (target - current[:, None])).abs()   # 정답 "변화량"과 비교
            loss = (err * valid).sum() / valid.sum().clamp(min=1)    # 실제로 잰 정답만 반영
            opt.zero_grad()
            loss.backward()
            opt.step()
            train_loss += loss.item()
        train_loss /= len(train_loader)
        lr_now = opt.param_groups[0]["lr"]  
        if sched: sched.step()

        r = evaluate(model, val_loader, norm, device)
        rf = evaluate(model, val_loader, norm, device, future="flat")   # ← 추가: epoch마다 Flat 평가
        mae, persist = r["mae"], r["persist"]
        overall, p_overall = mae.mean().item(), persist.mean().item()
        print(f"epoch {epoch}  MAE@30/60/120 {mae[0]:.2f} {mae[1]:.2f} {mae[2]:.2f}  "
              f"Overall {overall:.2f}  |  Persistence {p_overall:.2f}  Δ {overall - p_overall:+.2f}  |  "
              f"초반 {r['early_mae']:.2f}  오르막 {r['uphill_mae']:.2f}  속도변화 {r['speed_change_mae']:.2f}")
        fmae = rf["mae"]
        flat_overall = fmae.mean().item()
        print(f"   Flat  MAE@30/60/120 {fmae[0]:.2f} {fmae[1]:.2f} {fmae[2]:.2f}  "          # ← 추가: 평균 속도 기준
              f"Overall {flat_overall:.2f}  |  Persistence {p_overall:.2f}  Δ {flat_overall - p_overall:+.2f}  |  "
              f"초반 {rf['early_mae']:.2f}  오르막 {rf['uphill_mae']:.2f}  속도변화 {rf['speed_change_mae']:.2f}")
        history.append(overall)
        wandb.log({
            "epoch": epoch,
            "train/loss": train_loss,
            "val/MAE@30": mae[0].item(), "val/MAE@60": mae[1].item(), "val/MAE@120": mae[2].item(),
            "val/Overall_MAE": overall,
            "val/Persistence_Overall": p_overall,
            "val/Delta_vs_Persistence": overall - p_overall,
            "val/Early_MAE": r["early_mae"], "val/Uphill_MAE": r["uphill_mae"],
            "val/SpeedChange_MAE": r["speed_change_mae"],
            "val/Flat_Overall_MAE": flat_overall,
            "val/Flat_MAE@30": fmae[0].item(), "val/Flat_MAE@60": fmae[1].item(), "val/Flat_MAE@120": fmae[2].item(),
            "val/Flat_Delta_vs_Persistence": flat_overall - p_overall,
            "val/Flat_Early_MAE": rf["early_mae"], "val/Flat_Uphill_MAE": rf["uphill_mae"],
            "val/Flat_SpeedChange_MAE": rf["speed_change_mae"],
            "train/lr": lr_now,
        })


        score = flat_overall if args.select_by == "flat" else overall   # best 고르는 점수
        if score < best:                   # 지금까지 중 가장 좋으면
            best = score
            torch.save({"model": model.state_dict(), "args": vars(args), "epoch": epoch,
                        "norm_mean": norm.mean.to_dict(), "norm_std": norm.std.to_dict()},
                       out_dir / "best.pt")        # 모델 저장 (저장소 밖)
            run.summary.update({                    # 시트에 적을 최종 값
                "best_epoch": epoch,
                "MAE@30": mae[0].item(), "MAE@60": mae[1].item(), "MAE@120": mae[2].item(),
                "Overall_MAE": overall,
                "Persistence_MAE@30": persist[0].item(), "Persistence_MAE@60": persist[1].item(),
                "Persistence_MAE@120": persist[2].item(), "Persistence_Overall": p_overall,
                "Delta_vs_Persistence": overall - p_overall,
                **{f"{tag}_{kind}": r[f"{tag}_{kind}"] for tag in ["early", "uphill", "speed_change"]
                   for kind in ["mae", "persist", "share"]},
                "Flat_Delta_vs_Persistence": flat_overall - p_overall,
                **{f"Flat_{tag}_mae": rf[f"{tag}_mae"] for tag in ["early", "uphill", "speed_change", *ELAPSED_BINS]},
                **{f"{tag}_share": r[f"{tag}_share"] for tag in ELAPSED_BINS},
            })

    # 가장 좋았던 epoch의 모델로 What-if·Latency 측정
    best_ckpt = torch.load(out_dir / "best.pt", map_location=device, weights_only=False)
    model.load_state_dict(best_ckpt["model"])
    hold = evaluate(model, val_loader, norm, device, future="hold")
    extra = {f"SpeedHold_MAE@{s}": v for s, v in zip([30, 60, 120], hold["mae"].tolist())}
    extra["SpeedHold_Overall_MAE"] = hold["mae"].mean().item()
    print(f"속도 유지 가정  MAE@30/60/120 " + " ".join(f"{v:.2f}" for v in hold["mae"].tolist())
          + f"  Overall {extra['SpeedHold_Overall_MAE']:.2f}")

    flat = evaluate(model, val_loader, norm, device, future="flat")
    extra.update({f"Flat_MAE@{s}": v for s, v in zip([30, 60, 120], flat["mae"].tolist())})
    extra["Flat_Overall_MAE"] = flat["mae"].mean().item()
    print(f"평균 속도 가정  MAE@30/60/120 " + " ".join(f"{v:.2f}" for v in flat["mae"].tolist())
          + f"  Overall {extra['Flat_Overall_MAE']:.2f}")

    extra.update(what_if(model, val_loader.dataset, norm, device))
    extra.update(latency_report(model, args.hist + FUT))
    extra["Latency_device"] = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu"
    run.summary.update(extra)
    print(f"What-if PASS {extra['WhatIf_PASS']}  |  Latency " +
          "  ".join(f"{k} {v:.2f}" for k, v in extra.items() if k.startswith("Latency_") and k.endswith("_ms")))
    
    artifact = wandb.Artifact(f"{args.run_name}-model", type="model")
    artifact.add_file(str(out_dir / "best.pt"))
    run.log_artifact(artifact)             # 모델 파일을 W&B에 올려 이 실행과 연결
    run.finish()
    print(f"best ({args.select_by}) Overall {best:.2f}  checkpoint {out_dir / 'best.pt'}")



if __name__ == "__main__":
    main()
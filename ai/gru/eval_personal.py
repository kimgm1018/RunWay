"""사람별 과거 러닝으로 예측을 보정하면 MAE가 얼마나 줄어드는지 잰다 (학습 없음).

평가 러닝마다 같은 사람(중복 계정 묶음)이 그보다 먼저 달린 러닝 최근 N회로 보정값을 만든다 (시점별).
 - 평균 보정: 모델이 평균적으로 틀린 만큼(실제 - 예측)을 예측에 더한다
 - 배율 보정: 예측 변화량에 "실제 변화량 / 예측 변화량" 배율을 곱한다 (0.5~2.0으로 제한)
미래 속도는 학습·평가와 같이 2분 평균(Flat)으로 바꿔서 예측한다.
분할은 모델을 학습한 명단을 그대로 따른다.
 - v1: val 사람의 모든 이전 러닝을 과거 기록으로 쓰고, 정해진 평가 러닝(사람당 최대 20회)을 채점한다
 - v2: val 그룹의 support 러닝만 과거 기록으로 쓰고, query와 cold start 러닝을 채점한다

실행: python ai/gru/eval_personal.py --model-run M2-027 --run-name M2-029
     python ai/gru/eval_personal.py --model-run M3-001 --run-name M3-002
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import wandb
from torch.utils.data import DataLoader

from data import (USER_COL, GROUP_COLS, HIST, FUT, EVAL_STRIDE, ELAPSED_CLIP, ELAPSED_BINS, Normalizer, HorizonDataset,
                  load_fitrec, load_split, session_roles_v2)
from model import HorizonGRU

SECONDS = [30, 60, 120]
PRIOR_BINS = [(0, 0, "0"), (1, 2, "1-2"), (3, 9, "3-9"), (10, None, "10+")]   # 이전 러닝 수 구간
SCALE_MIN, SCALE_MAX = 0.5, 2.0                                                # 배율이 튀지 않게 제한
METHODS = ["before", "bias", "scale"]                                          # 보정 없음 / 평균 / 배율


def load_model(ckpt_path, device):
    """학습 때 저장한 가중치·설정·정규화 기준값을 그대로 불러온다."""
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    a = ckpt["args"]
    model = HorizonGRU(n_inputs=5 if a.get("use_elapsed") else 4, hidden=a["hidden"],
                       layers=a["layers"], dropout=a.get("dropout", 0.0),
                       mask_future_grade=a.get("no_future_grade", False)).to(device)
    model.load_state_dict(ckpt["model"])
    model.eval()
    norm = object.__new__(Normalizer)
    norm.mean, norm.std = pd.Series(ckpt["norm_mean"]), pd.Series(ckpt["norm_std"])
    return model, norm, a


def person_of(split_path):
    """{계정 ID: 사람 ID}. 중복 계정 2개는 같은 사람 ID(그룹 ID)로 묶는다."""
    with open(split_path, encoding="utf-8") as f:
        members = json.load(f)["group_members"]
    return {subject: group for group, subjects in members.items() for subject in subjects}


def predict_samples(model, norm, df, use_elapsed, hist, elapsed_clip, device):
    """샘플마다 러닝 ID, 예측 변화량·실제 변화량(bpm, 시점 3개), 채점 가능 여부, 상황 구분을 돌려준다."""
    ds = HorizonDataset(df, stride=EVAL_STRIDE, use_elapsed=use_elapsed, hist=hist, elapsed_clip=elapsed_clip)
    seg_session = [key[0] for key, _ in df.groupby(GROUP_COLS)]        # HorizonDataset과 같은 구간 순서
    session = np.array([seg_session[k] for k, _ in ds.index])

    std = norm.std["hr_bpm"]
    sp_m, sp_s = norm.mean["speed_mps"], norm.std["speed_mps"]
    gr_m, gr_s = norm.mean["grade_observed_pct"], norm.std["grade_observed_pct"]
    preds, trues, valids = [], [], []
    tags = {"early": [], "uphill": [], "speed_change": [], **{name: [] for name in ELAPSED_BINS}}
    with torch.no_grad():
        for seq, target, current, valid, elapsed in DataLoader(ds, batch_size=1024):
            now_speed = seq[:, -FUT - 1, 0] * sp_s + sp_m
            future_speed = seq[:, -FUT:, 0] * sp_s + sp_m
            tags["early"].append(elapsed <= 300)                                  # train.py evaluate와 같은 기준
            for name, (lo, hi) in ELAPSED_BINS.items():
                tags[name].append((elapsed >= lo) & (elapsed < hi))
            tags["uphill"].append((seq[:, -FUT:, 1] * gr_s + gr_m).mean(1) > 3)    # train.py evaluate와 같은 기준
            tags["speed_change"].append((future_speed.mean(1) - now_speed).abs() > 0.5)
            seq[:, -FUT:, 0] = seq[:, -FUT:, 0].mean(1, keepdim=True)            # Flat: 미래 속도 = 2분 평균
            preds.append(model(seq.to(device)).cpu() * std)                      # 예측 변화량 (bpm)
            trues.append((target - current[:, None]) * std)                      # 실제 변화량 (bpm)
            valids.append(valid)
    return (session, torch.cat(preds).numpy(), torch.cat(trues).numpy(), torch.cat(valids).numpy(),
            {name: torch.cat(t).numpy() for name, t in tags.items()})


def person_corrections(sessions, pred, true, valid, start, person, eval_ids, history_n, history_ids=None):
    """평가 러닝마다 같은 사람의 '그보다 먼저 시작한' 러닝 최근 history_n회로 평균 보정값과 배율(시점 3개)을 만든다.
    history_ids를 주면 그 러닝(v2 support)만 이전 러닝으로 쓴다."""
    # 러닝별 합계 (채점 가능한 칸만): 개수, 실제-예측 합, 예측×실제 합, 예측² 합
    m = valid.astype(float)
    parts = {"n": m, "resid": (true - pred) * m, "xy": pred * true * m, "xx": pred * pred * m}
    stats = {k: pd.DataFrame(v, columns=SECONDS).groupby(sessions).sum() for k, v in parts.items()}
    index = stats["n"].index
    runs_all = pd.DataFrame({"start": index.map(start), "person": index.map(person)}, index=index)

    bias, scale, n_prior = {}, {}, {}
    for _, runs in runs_all.sort_values("start").groupby("person"):    # 사람별, 시작 시각 순
        starts = runs["start"].to_numpy()
        usable = runs.index.isin(history_ids) if history_ids is not None else np.ones(len(runs), bool)
        st = {k: v.loc[runs.index].to_numpy() for k, v in stats.items()}
        for i, sid in enumerate(runs.index):
            if sid not in eval_ids:
                continue
            prior = np.flatnonzero(usable & (starts < starts[i]))            # 시작 시각이 엄격하게 이른 러닝
            used = prior[-history_n:]                                        # 그중 최근 history_n회
            n, resid, xy, xx = (st[key][used].sum(0) for key in ["n", "resid", "xy", "xx"])
            bias[sid] = np.where(n > 0, resid / np.maximum(n, 1), 0.0)       # 이전 러닝 없으면 보정 0
            ratio = np.where(xx > 0, xy / np.where(xx > 0, xx, 1), 1.0)      # 이전 러닝 없으면 배율 1
            scale[sid] = np.clip(ratio, SCALE_MIN, SCALE_MAX)
            n_prior[sid] = len(prior)
    return bias, scale, n_prior


def mae(abs_err, mask):
    """시점별 MAE 3개 (mask가 True인 칸만)."""
    return (abs_err * mask).sum(0) / np.maximum(mask.sum(0), 1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model-run", default="M2-027")                    # 보정할 학습 실험 ID
    p.add_argument("--run-name", required=True)                        # 이 평가의 실험 ID. 예: M2-029
    p.add_argument("--history-n", type=int, default=10)                # 보정에 쓸 이전 러닝 최대 수
    p.add_argument("--runs-dir", default=str(Path.home() / "runway-runs"))
    p.add_argument("--project", default="runway-hr")
    args = p.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, norm, a = load_model(Path(args.runs_dir) / args.model_run / "best.pt", device)

    # val 사람들의 평가 러닝과 과거 기록 러닝. test는 쓰지 않는다.
    with open(a["split_path"], encoding="utf-8") as f:
        spec = json.load(f)
    df = load_fitrec(a["data_dir"], a["n_files"])
    groups = person_of(a["split_path"])
    group = df[USER_COL].map(lambda s: groups.get(s, s))
    cold_groups = set()
    if "cohorts" in spec:                                                  # v2: support만 과거 기록
        roles = session_roles_v2(spec, a["data_dir"])
        cold_groups = set(spec["cohorts"]["cold_start_val"])
        val_groups = set(spec["cohorts"]["personalized_val"]) | cold_groups
        val_all = df[group.isin(val_groups) & df["session_id"].map(roles).isin(["val", "support"])]
        eval_ids = {s for s in val_all["session_id"].unique() if roles[s] == "val"}
        history_ids = {s for s in val_all["session_id"].unique() if roles[s] == "support"}
    else:                                                                  # v1: 모든 이전 러닝이 과거 기록
        subject_split, eval_sessions = load_split(a["split_path"])
        val_all = df[df[USER_COL].map(subject_split) == "val"]
        eval_ids = eval_sessions["val"]
        history_ids = None
    sessions = pd.read_parquet(Path(a["data_dir"]) / "sessions.parquet", columns=["session_id", "start_time_utc"])
    start = dict(zip(sessions["session_id"], pd.to_datetime(sessions["start_time_utc"])))
    person = val_all.drop_duplicates("session_id").set_index("session_id")[USER_COL].map(lambda s: groups.get(s, s))

    sample_session, pred, true, valid, tags = predict_samples(model, norm, norm(val_all), a.get("use_elapsed", False),
                                                              a.get("hist", HIST), a.get("elapsed_clip", ELAPSED_CLIP), device)
    bias, scale, n_prior = person_corrections(sample_session, pred, true, valid, start, person.to_dict(),
                                              eval_ids, args.history_n, history_ids)

    # 평가 러닝 샘플만 채점
    is_eval = np.isin(sample_session, list(eval_ids))
    pred, true, valid = pred[is_eval], true[is_eval], valid[is_eval]
    sess = sample_session[is_eval]
    tags = {name: t[is_eval] for name, t in tags.items()}
    prior = np.array([n_prior[s] for s in sess])
    b = np.stack([bias[s] for s in sess])
    c = np.stack([scale[s] for s in sess])
    errs = {"before": np.abs(true - pred), "bias": np.abs(true - (pred + b)), "scale": np.abs(true - pred * c)}
    bias_abs = np.abs(np.stack(list(bias.values()))).mean(0)               # 평가 러닝별 평균 보정값 크기
    scale_mean = np.stack(list(scale.values())).mean(0)                    # 평가 러닝별 배율 평균

    def row(mask_rows):
        m = valid & mask_rows[:, None]
        r = {"share": float(mask_rows.mean())}
        for method in METHODS:
            per_h = mae(errs[method], m)
            r[method] = float(per_h.mean())
            r.update({f"{method}@{s}": float(v) for s, v in zip(SECONDS, per_h)})
        return r

    everyone = np.ones(len(sess), bool)
    results = {"all": row(everyone)}
    if cold_groups:                                                        # v2: 과거 기록 있는 사람 / 신규 사용자
        is_cold = np.isin(person.loc[sess].to_numpy(), list(cold_groups))
        results["personalized"] = row(~is_cold)
        results["cold_start"] = row(is_cold)
    for lo, hi, name in PRIOR_BINS:
        results[f"prior_{name}"] = row((prior >= lo) & ((prior <= hi) if hi is not None else True))
    for name, t in tags.items():
        results[name] = row(t.astype(bool))

    print(f"분할 {spec['name']}, 평가 러닝 {len(set(sess))}개, 샘플 {len(sess)}개, 보정에 쓴 이전 러닝 최대 {args.history_n}회")
    print("평균 보정값 크기(bpm) @30/60/120: " + " ".join(f"{v:.2f}" for v in bias_abs))
    print("배율 평균 @30/60/120: " + " ".join(f"{v:.2f}" for v in scale_mean))
    print(f"{'구간':<14}{'비율':>7}{'보정 전':>9}{'평균 보정':>10}{'배율 보정':>10}   배율 보정 @30/60/120")
    for name, r in results.items():
        print(f"{name:<14}{r['share']:>7.1%}{r['before']:>9.3f}{r['bias']:>10.3f}{r['scale']:>10.3f}   "
              + " ".join(f"{r[f'scale@{s}']:.2f}" for s in SECONDS))
    print(f"※ 보정 전 전체(all)가 {args.model_run}의 W&B Flat_Overall_MAE와 같아야 평가가 학습 때와 같은 조건이다")

    out_dir = Path(args.runs_dir) / args.run_name
    out_dir.mkdir(parents=True, exist_ok=True)
    run = wandb.init(project=args.project, name=args.run_name, job_type="eval", dir=str(out_dir), config={
        "model_run": args.model_run, "history_n": args.history_n, "corrections": ["person_mean_residual", "person_scale"],
        "scale_clip": [SCALE_MIN, SCALE_MAX], "future": "flat", "split": spec["name"], "test_used": False,
        "history": "support" if history_ids is not None else "all_prior",
        "eval_sessions": len(set(sess)), "eval_samples": len(sess),
    })
    run.summary.update({f"{name}/{k}": v for name, r in results.items() for k, v in r.items()})
    run.summary.update({f"bias_abs_mean@{s}": float(v) for s, v in zip(SECONDS, bias_abs)})
    run.summary.update({f"scale_mean@{s}": float(v) for s, v in zip(SECONDS, scale_mean)})
    run.summary.update({"Flat_Overall_MAE_before": results["all"]["before"],
                        "Flat_Overall_MAE_bias": results["all"]["bias"],
                        "Flat_Overall_MAE_scale": results["all"]["scale"]})
    run.finish()


if __name__ == "__main__":
    main()

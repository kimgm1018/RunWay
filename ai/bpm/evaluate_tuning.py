"""BPM-006: 워치 기록에 맞게 측정 노이즈 σ와 지난 기록 반영 방식(최근 N회 / 감쇠 가중)을 고른다.

prior의 σ(0.020 m)는 실험실 측정 기준이다. 워치 기록은 더 흔들리고 날마다 보폭도 달라지므로,
σ가 작으면 기록 하나에 너무 크게 끌려간다. 개인 워치 기록(BPM-004와 같은 personal_windows.csv)으로
σ와 지난 기록 반영 방식을 고르고, 앞 절반 러닝으로 고른 값을 뒤 절반 러닝에서 확인한다(과적합 방지).

비교:
  past     지난 러닝 기록만으로 보정(기록이 있는 사용자). 최근 N회 또는 감쇠 가중(λ^지난 러닝 수)
  inrun_1  이번 러닝 첫 구간 1개만으로 보정(처음 사용자). σ만 바꾼다

사용법:
    python evaluate_tuning.py <bpm 데이터 폴더> [--wandb]
    (폴더의 stride_prior.json, personal_windows.csv를 읽고 eval_tuning_grid.csv를 저장)
"""
import argparse
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd

from evaluate_personal import summarize_runs
from stride_model import StridePrior, base_stride, design, predict_cadence

SIGMAS = [0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.06, 0.10]     # m
RECENT = [5, 10, 15, 20, 25, 30, 40, 50, 60, None]     # None = 지난 기록 전부
DECAYS = [0.5, 0.7, 0.8, 0.9, 0.95]
CURRENT = {"sigma": 0.02, "rule": "last5"}               # 지금 서비스 기본값


def weighted_offset(prior: StridePrior, speeds, strides, weights=None) -> np.ndarray:
    """가중 베이지안 보정. 가중치 w인 기록은 노이즈가 σ²/w인 기록으로 본다(w=1이면 personal_offset과 같다)."""
    if len(speeds) == 0:
        return np.zeros(2)
    X = design(prior, speeds)
    w = np.ones(len(X)) if weights is None else np.asarray(weights, dtype=float)
    resid = np.asarray(strides, dtype=float) - base_stride(prior, speeds)
    P = np.linalg.inv(np.linalg.inv(prior.G) + X.T @ (w[:, None] * X) / prior.sigma2)
    return P @ X.T @ (w * resid) / prior.sigma2


def rules():
    """(이름, 지난 기록 → 가중치) 목록. 가중치 0인 기록은 쓰지 않는다."""
    out = []
    for n in RECENT:
        name = "all" if n is None else f"last{n}"
        out.append((name, lambda age, n=n: (age < n if n else np.ones_like(age, dtype=bool)).astype(float)))
    for lam in DECAYS:
        out.append((f"decay{lam}", lambda age, lam=lam: lam ** age))
    return out


def noise_parts(prior: StridePrior, windows: pd.DataFrame) -> dict:
    """구간 노이즈(같은 러닝 안)와 날마다 달라지는 정도(러닝 간)를 나눠 본다. 기울기는 prior 값을 쓴다."""
    r = windows.assign(resid=windows["stride_m"] - base_stride(prior, windows["speed_mps"]))
    g = r.groupby("run_no")["resid"]
    within = float(np.sqrt((g.var(ddof=1) * (g.count() - 1)).sum() / (g.count() - 1).sum()))
    run_mean = g.mean()
    between = float(np.sqrt(max(run_mean.var(ddof=1) - within ** 2 / g.count().mean(), 0)))
    return {"within_run_sd_m": within, "between_run_sd_m": between, "personal_offset_m": float(run_mean.mean())}


def evaluate(prior: StridePrior, windows: pd.DataFrame) -> pd.DataFrame:
    past_records = summarize_runs(windows)
    priors = {s: replace(prior, sigma2=s ** 2) for s in SIGMAS}
    rows = []
    for run_no, g in windows.groupby("run_no"):
        g = g.sort_values("window_start_s")
        if len(g) < 2:
            continue
        first, targets = g.iloc[0], g.iloc[1:]
        past = past_records[past_records["run_no"] < run_no]
        age = (run_no - 1 - past["run_no"]).to_numpy()          # 바로 전 러닝 = 0
        n_past = past["run_no"].nunique()
        for s, p in priors.items():
            off = weighted_offset(p, [first["speed_mps"]], [first["stride_m"]])
            rows.append(_score(p, targets, off, run_no, n_past, s, "inrun_1"))
            if n_past == 0:
                continue
            for name, weight_fn in rules():
                w = weight_fn(age)
                keep = w > 0
                off = weighted_offset(p, past["speed_mps"][keep], past["stride_m"][keep], w[keep])
                rows.append(_score(p, targets, off, run_no, n_past, s, name))
    return pd.DataFrame(rows)


def _score(prior, targets, offset, run_no, n_past, sigma, rule):
    err = predict_cadence(prior, targets["speed_mps"], offset) - targets["cadence_spm"].to_numpy()
    return {"run_no": run_no, "n_past_runs": n_past, "sigma": sigma, "rule": rule,
            "windows": len(err), "abs_err_sum": float(np.abs(err).sum()), "err_sum": float(err.sum()),
            "within_5": int((np.abs(err) <= 5).sum())}


def summarize(scores: pd.DataFrame) -> pd.DataFrame:
    s = scores.groupby(["rule", "sigma"], as_index=False)[["windows", "abs_err_sum", "err_sum", "within_5"]].sum()
    s["mae"] = s["abs_err_sum"] / s["windows"]
    s["bias"] = s["err_sum"] / s["windows"]
    s["within_5"] = s["within_5"] / s["windows"]
    return s[["rule", "sigma", "windows", "mae", "bias", "within_5"]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--wandb", action="store_true", help="결과를 W&B에 기록 (WANDB_API_KEY는 터미널에서 설정)")
    parser.add_argument("--wandb-project", default="runway-bpm-stride")
    args = parser.parse_args()

    prior = StridePrior.load(args.folder / "stride_prior.json")
    windows = pd.read_csv(args.folder / "personal_windows.csv")
    parts = noise_parts(prior, windows)
    print(f"[노이즈 나눠 보기] 같은 러닝 안 구간 sd {parts['within_run_sd_m']:.3f} m, "
          f"러닝 간(날마다) sd {parts['between_run_sd_m']:.3f} m, prior σ {np.sqrt(prior.sigma2):.3f} m")

    scores = evaluate(prior, windows)
    split = scores["run_no"].median()
    tune, test = scores[scores["run_no"] <= split], scores[scores["run_no"] > split]
    grid = summarize(tune).merge(summarize(test), on=["rule", "sigma"], suffixes=("_tune", "_test"))
    grid.to_csv(args.folder / "eval_tuning_grid.csv", index=False)

    print(f"\n앞 절반 러닝(≤{split:.0f}번)으로 고르고 뒤 절반에서 확인. MAE는 케이던스 spm")
    picks = []
    for task, mask in (("기록 있는 사용자(past)", grid["rule"] != "inrun_1"),
                       ("처음 사용자(inrun_1)", grid["rule"] == "inrun_1")):
        g = grid[mask]
        best = g.loc[g["mae_tune"].idxmin()]
        cur_rule = CURRENT["rule"] if task.startswith("기록") else "inrun_1"
        cur = g[(g["rule"] == cur_rule) & np.isclose(g["sigma"], CURRENT["sigma"])].iloc[0]
        picks += [{"task": task, "pick": "current", **cur.to_dict()}, {"task": task, "pick": "best", **best.to_dict()}]
    table = pd.DataFrame(picks)
    print(table[["task", "pick", "rule", "sigma", "mae_tune", "mae_test", "bias_test", "within_5_test"]]
          .round(3).to_string(index=False))

    for half in ("tune", "test"):
        print(f"\n[기록 있는 사용자] 규칙 × σ별 MAE ({'앞' if half == 'tune' else '뒤'} 절반)")
        past = grid[grid["rule"] != "inrun_1"].pivot(index="rule", columns="sigma", values=f"mae_{half}")
        print(past.round(2).to_string())
    print("\n[처음 사용자] σ별 MAE (앞 절반 / 뒤 절반)")
    print(grid[grid["rule"] == "inrun_1"][["sigma", "mae_tune", "mae_test"]].round(2).to_string(index=False))

    if args.wandb:
        import wandb
        run = wandb.init(project=args.wandb_project, job_type="eval_tuning", config={
            "experiment": "BPM-006", "subjects": 1, "runs": int(windows["run_no"].nunique()),
            "sigmas": SIGMAS, "recent": [n or 0 for n in RECENT], "decays": DECAYS,
            "tune_runs": f"<= {split:.0f}", "prior": "stride_prior.json"})
        run.log({
            "grid": wandb.Table(dataframe=grid),
            "picks": wandb.Table(dataframe=table),
            "charts/test_mae_current_vs_best": wandb.plot.bar(
                wandb.Table(dataframe=table.assign(name=table["task"] + " " + table["pick"])[["name", "mae_test"]]),
                "name", "mae_test", title="Test MAE: current vs tuned (spm)"),
            **{f"noise/{k}": v for k, v in parts.items()},
        })
        run.finish()


if __name__ == "__main__":
    main()

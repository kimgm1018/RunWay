"""BPM-004: 실제 워치 기록 1명으로, 러닝이 쌓일수록 케이던스 예측이 좋아지는지 본다.

러닝 n번째의 구간을 예측할 때는 1 ~ n−1번째 러닝 기록과 이번 러닝의 첫 구간만 쓴다(미래를 보지 않는다).
prior는 공개 트레드밀 데이터로 학습한 stride_prior.json을 그대로 쓴다.

사용법:
    python evaluate_personal.py <bpm 데이터 폴더> [--wandb]
    (폴더의 stride_prior.json, personal_windows.csv를 읽고 eval_personal_predictions.csv를 저장)

비교하는 방법 (모두 각 러닝의 첫 구간을 뺀 같은 구간들을 예측):
  population        기록 없음
  bayes_inrun_1     이번 러닝의 첫 구간 1개
  bayes_past        지난 러닝 기록 전부
  bayes_last5       최근 러닝 5회 기록만
  bayes_past_inrun  지난 러닝 전부 + 이번 러닝 첫 구간
  bayes_last5_inrun 최근 러닝 5회 + 이번 러닝 첫 구간
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from stride_model import StridePrior, personal_offset, predict_cadence

WITHIN_SPM = 5
SPEED_BIN = 0.25         # 지난 러닝 기록을 러닝·속도 칸(m/s)별 평균 하나로 묶는다
RECENT_RUNS = 5
PAST_BINS = [0, 1, 2, 5, 10, 20, 50, 1000]
PAST_LABELS = ["0", "1", "2-4", "5-9", "10-19", "20-49", "50+"]


def summarize_runs(windows: pd.DataFrame) -> pd.DataFrame:
    """한 러닝 안의 구간들은 서로 비슷해 독립 기록이 아니므로, 러닝·속도 칸별 평균 하나로 줄인다."""
    binned = windows.assign(bin=(windows["speed_mps"] / SPEED_BIN).round())
    return binned.groupby(["run_no", "bin"], as_index=False)[["speed_mps", "stride_m"]].mean()


def evaluate(prior: StridePrior, windows: pd.DataFrame) -> pd.DataFrame:
    past_records = summarize_runs(windows)
    rows = []
    for run_no, g in windows.groupby("run_no"):
        g = g.sort_values("window_start_s")
        if len(g) < 2:
            continue
        first, targets = g.iloc[0], g.iloc[1:]
        past = past_records[past_records["run_no"] < run_no]
        last5 = past[past["run_no"] >= run_no - RECENT_RUNS]
        n_past = int(past["run_no"].nunique())

        def offset(records: pd.DataFrame, with_first: bool):
            speeds = list(records["speed_mps"]) + ([first["speed_mps"]] if with_first else [])
            strides = list(records["stride_m"]) + ([first["stride_m"]] if with_first else [])
            return personal_offset(prior, speeds, strides)

        empty = past.iloc[0:0]
        offsets = {
            "population": None,
            "bayes_inrun_1": offset(empty, True),
            "bayes_past": offset(past, False),
            "bayes_last5": offset(last5, False),
            "bayes_past_inrun": offset(past, True),
            "bayes_last5_inrun": offset(last5, True),
        }
        for method, off in offsets.items():
            pred = predict_cadence(prior, targets["speed_mps"], off)
            for (_, t), p in zip(targets.iterrows(), pred):
                rows.append({"run_no": run_no, "n_past_runs": n_past, "method": method,
                             "window_start_s": t["window_start_s"], "speed_mps": t["speed_mps"],
                             "true_cadence": t["cadence_spm"], "pred_cadence": float(p)})
    pred = pd.DataFrame(rows)
    pred["err"] = pred["pred_cadence"] - pred["true_cadence"]
    pred["abs_err"] = pred["err"].abs()
    pred["past_group"] = pd.cut(pred["n_past_runs"], PAST_BINS, right=False, labels=PAST_LABELS)
    return pred


def summarize(pred: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    return (pred.groupby(by, observed=True)
            .agg(windows=("abs_err", "size"), runs=("run_no", "nunique"), mae_spm=("abs_err", "mean"),
                 bias_spm=("err", "mean"), within_5=("abs_err", lambda e: (e <= WITHIN_SPM).mean()))
            .round(3).reset_index())

def plot_curve(curve: pd.DataFrame):
    """지난 러닝 수별 MAE 선 그래프. 칸마다 해당 러닝 수를 x축 이름에 붙인다."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(7, 4.5))
    labels = [f"{g}\n(n={n})" for g, n in zip(curve.index, curve["runs"])]
    for method in ["population", "bayes_inrun_1", "bayes_past", "bayes_last5_inrun"]:
        ax.plot(labels, curve[method], "-o", label=method)
    ax.set_xlabel("Number of past runs (n = runs in group)")
    ax.set_ylabel("Cadence MAE (spm)")
    ax.set_title("BPM-004: error as past runs accumulate")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    return fig

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--wandb", action="store_true", help="결과를 W&B에 기록 (WANDB_API_KEY는 터미널에서 설정)")
    parser.add_argument("--wandb-project", default="runway-bpm-stride")
    args = parser.parse_args()

    prior = StridePrior.load(args.folder / "stride_prior.json")
    windows = pd.read_csv(args.folder / "personal_windows.csv")
    pred = evaluate(prior, windows)
    pred.to_csv(args.folder / "eval_personal_predictions.csv", index=False)

    order = ["population", "bayes_inrun_1", "bayes_past", "bayes_last5", "bayes_past_inrun", "bayes_last5_inrun"]
    main_table = summarize(pred, ["method"]).set_index("method").loc[order].reset_index()
    by_past = summarize(pred, ["past_group", "method"])
    curve = by_past.pivot(index="past_group", columns="method", values="mae_spm")[order]
    curve.insert(0, "runs", by_past.groupby("past_group", observed=True)["runs"].max())

    print(f"러닝 {pred['run_no'].nunique()}회, 예측 구간 {len(pred) // len(order)}개 (각 러닝 첫 구간 제외), 1명")
    print("\n[방법별 케이던스 오차]")
    print(main_table.to_string(index=False))
    print("\n[지난 러닝 수별 MAE] 기록이 쌓일수록 좋아지는지")
    print(curve.round(2).to_string())

    if args.wandb:
        import wandb
        run = wandb.init(project=args.wandb_project, job_type="eval_personal", config={
            "experiment": "BPM-004", "subjects": 1, "runs": int(pred["run_no"].nunique()),
            "window_sec": 60, "speed_bin": SPEED_BIN, "recent_runs": RECENT_RUNS,
            "prior": "stride_prior.json (public treadmill, 51 people)",
        })
        run.log({
            "summary": wandb.Table(dataframe=main_table),
            "by_past_runs": wandb.Table(dataframe=by_past),
            "charts/mae_by_method": wandb.plot.bar(
                wandb.Table(dataframe=main_table[["method", "mae_spm"]]), "method", "mae_spm",
                title="Cadence MAE by method (spm)"),
            "charts/mae_by_past_runs": wandb.Image(plot_curve(curve)),
            **{f"personal/{r.method}/mae_spm": r.mae_spm for r in main_table.itertuples()},
        })
        run.finish()


if __name__ == "__main__":
    main()
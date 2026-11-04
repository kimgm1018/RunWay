"""BPM-003: 트레드밀로 학습한 보폭 모델이 실외 케이던스를 얼마나 맞히는지 본다.

Zenodo 참가자 11~15(5명)의 실외 직선 구간(사람당 10개)을 예측 대상으로 하고,
평가할 사람은 prior 학습에서 뺀다(leave-one-subject-out).

사용법:
    python evaluate_outdoor.py <bpm 데이터 폴더> [--wandb]
    (폴더의 all_treadmill.csv, zenodo_out.csv를 읽고 eval_outdoor_predictions.csv를 저장)

비교하는 방법:
  fixed          학습 데이터 평균 케이던스
  population     평균 직선 (그 사람 기록 없음)
  bayes_tm       그 사람의 트레드밀 기록(SS1, 5개 속도)으로 보정
  own_tm_line    prior 없이 그 사람의 트레드밀 기록만으로 맞춘 직선
  bayes_out_1    그 사람의 실외 구간 1개로 보정 (러닝 초반 보정과 같은 상황)
  bayes_tm_out_1 트레드밀 기록 + 실외 구간 1개로 보정
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from stride_model import fit_prior, personal_offset, predict_cadence

WITHIN_SPM = 5


def load(folder: Path):
    tm = pd.read_csv(folder / "all_treadmill.csv")
    tm = tm[~tm["session_id"].str.endswith("SS2")].reset_index(drop=True)
    out = pd.read_csv(folder / "zenodo_out.csv")
    return tm, out


def own_line(records: pd.DataFrame, speeds) -> np.ndarray:
    b, a = np.polyfit(records["speed_mps"], records["stride_m"], 1)
    speeds = np.asarray(speeds, dtype=float)
    return 60 * speeds / (a + b * speeds)


def evaluate(tm: pd.DataFrame, out: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for subject, g_out in out.groupby("subject_id"):
        train = tm[tm["subject_id"] != subject]
        prior = fit_prior(train)
        fixed = train["cadence_spm"].mean()
        mine = tm[tm["subject_id"] == subject]
        off_tm = personal_offset(prior, mine["speed_mps"], mine["stride_m"])
        speeds = g_out["speed_mps"].to_numpy()

        preds = {
            "fixed": np.full(len(g_out), fixed),
            "population": predict_cadence(prior, speeds),
            "bayes_tm": predict_cadence(prior, speeds, off_tm),
            "own_tm_line": own_line(mine, speeds),
        }
        for method, pred in preds.items():
            for (_, target), p in zip(g_out.iterrows(), pred):
                rows.append({"subject_id": subject, "method": method, "cal": "",
                             "target": target["session_id"], "speed_mps": target["speed_mps"],
                             "true_cadence": target["cadence_spm"], "pred_cadence": float(p)})

        # 실외 구간 하나로 보정하고 나머지 9개를 예측한다
        for _, cal in g_out.iterrows():
            rest = g_out[g_out["session_id"] != cal["session_id"]]
            off_out = personal_offset(prior, [cal["speed_mps"]], [cal["stride_m"]])
            both = pd.concat([mine[["speed_mps", "stride_m"]], cal[["speed_mps", "stride_m"]].to_frame().T])
            off_both = personal_offset(prior, both["speed_mps"].astype(float), both["stride_m"].astype(float))
            for method, off in (("bayes_out_1", off_out), ("bayes_tm_out_1", off_both)):
                pred = predict_cadence(prior, rest["speed_mps"], off)
                for (_, target), p in zip(rest.iterrows(), pred):
                    rows.append({"subject_id": subject, "method": method, "cal": cal["session_id"],
                                 "target": target["session_id"], "speed_mps": target["speed_mps"],
                                 "true_cadence": target["cadence_spm"], "pred_cadence": float(p)})

    pred = pd.DataFrame(rows)
    pred["err"] = pred["pred_cadence"] - pred["true_cadence"]
    pred["abs_err"] = pred["err"].abs()
    return pred


def treadmill_shift(tm: pd.DataFrame, out: pd.DataFrame) -> pd.DataFrame:
    """같은 사람의 트레드밀 직선과 비교한 실외 케이던스 차이(실외 − 트레드밀)."""
    rows = []
    for subject, g in out.groupby("subject_id"):
        mine = tm[tm["subject_id"] == subject]
        diff = g["cadence_spm"].to_numpy() - own_line(mine, g["speed_mps"])
        rows.append({"subject_id": subject, "shift_mean_spm": diff.mean(), "shift_sd_spm": diff.std(ddof=1),
                     "out_speed_min": g["speed_mps"].min(), "out_speed_max": g["speed_mps"].max()})
    return pd.DataFrame(rows).round(2)


def summarize(pred: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    return (pred.groupby(by)
            .agg(n=("abs_err", "size"), mae_spm=("abs_err", "mean"), bias_spm=("err", "mean"),
                 within_5=("abs_err", lambda e: (e <= WITHIN_SPM).mean()))
            .round(3).reset_index())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--wandb", action="store_true", help="결과를 W&B에 기록 (WANDB_API_KEY는 터미널에서 설정)")
    parser.add_argument("--wandb-project", default="runway-bpm-stride")
    args = parser.parse_args()

    tm, out = load(args.folder)
    pred = evaluate(tm, out)
    pred.to_csv(args.folder / "eval_outdoor_predictions.csv", index=False)

    order = ["fixed", "population", "bayes_tm", "own_tm_line", "bayes_out_1", "bayes_tm_out_1"]
    main_table = summarize(pred, ["method"]).set_index("method").loc[order].reset_index()
    by_subject = summarize(pred, ["subject_id", "method"])
    shift = treadmill_shift(tm, out)

    print(f"실외 {len(out)}구간, {out['subject_id'].nunique()}명 (평가할 사람은 prior 학습에서 제외)")
    print("\n[방법별 실외 케이던스 오차]")
    print(main_table.to_string(index=False))
    print("\n[사람별 실외 − 트레드밀 차이] 같은 속도에서 실외 케이던스가 트레드밀보다 몇 spm 높은지")
    print(shift.to_string(index=False))
    print("\n[사람별 MAE]")
    print(by_subject.pivot(index="subject_id", columns="method", values="mae_spm")[order].round(2).to_string())

    if args.wandb:
        import wandb
        run = wandb.init(project=args.wandb_project, job_type="eval_outdoor", config={
            "experiment": "BPM-003", "subjects": int(out["subject_id"].nunique()), "outdoor_segments": len(out),
            "prior": "leave-one-subject-out on all_treadmill (SS1)", "cadence_method": "foot gyro autocorrelation",
        })
        run.log({"summary": wandb.Table(dataframe=main_table), "by_subject": wandb.Table(dataframe=by_subject),
                 "treadmill_shift": wandb.Table(dataframe=shift)})
        for r in main_table.itertuples():
            run.summary[f"outdoor/{r.method}/mae_spm"] = r.mae_spm
        run.finish()


if __name__ == "__main__":
    main()
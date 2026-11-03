"""사람 단위 교차검증으로 페이스→케이던스 예측 방법들을 비교한다.

사용법:
    python evaluate.py <bpm 데이터 폴더> [--folds 5] [--seed 42] [--wandb]
    (폴더의 all_treadmill.csv를 읽고 eval_predictions.csv, stride_prior.json, stride_prior_height.json을 같은 폴더에 저장)

시나리오마다 같은 예측 대상에서 방법들을 비교한다.
  k0: 그 사람의 기록 없이 모든 측정을 예측           fixed, population, population_height
  k1: 측정 1개로 보정하고 나머지를 예측               fixed, population, bayes_1, bayes_1_height
  k2: 측정 2개로 보정하고 남은 측정을 예측 (속도 3개 이상)  fixed, population, bayes_2, own_line_2

*_height는 키를 넣어 학습한 prior(키가 있는 Fukuchi로만 학습)를 쓴다.
키를 모르는 사람(Zenodo)은 서비스와 같이 키 없는 prior로 대신 예측한다.
"""
import argparse
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd

from stride_model import fit_prior, personal_offset, predict_cadence

WITHIN_SPM = 5   # 메트로놈 오차 허용 기준


def load(folder: Path):
    table = pd.read_csv(folder / "all_treadmill.csv")
    repeat = table["session_id"].str.endswith("SS2")
    return table[~repeat].reset_index(drop=True), table


def noise_floor(full: pd.DataFrame) -> float:
    """같은 사람·같은 속도의 SS1과 SS2 케이던스 차이 평균."""
    zen = full[full["session_id"].str.contains("_SS")].copy()
    zen["cond"] = zen["session_id"].str[-3:]
    pair = zen.pivot_table(index=["subject_id", "speed_mps"], columns="cond", values="cadence_spm").dropna()
    return float((pair["SS1"] - pair["SS2"]).abs().mean())


def own_line_cadence(cal: pd.DataFrame, speed: float) -> float:
    """prior 없이 그 사람의 기록만으로 맞춘 보폭 직선."""
    b, a = np.polyfit(cal["speed_mps"], cal["stride_m"], 1)
    return 60 * speed / (a + b * speed)


def evaluate_subject(g: pd.DataFrame, prior, prior_h, fixed_cadence: float) -> list[dict]:
    rows = []
    height = g["height_cm"].iloc[0]
    if np.isnan(height):
        height, prior_h = None, prior   # 키를 모르면 키 없는 prior로 대신한다

    def add(scenario, method, cal, target, pred):
        rows.append({
            "subject_id": target["subject_id"], "source": target["source"], "scenario": scenario, "method": method,
            "cal_speeds": "" if cal is None else " ".join(f"{v:g}" for v in cal["speed_mps"]),
            "target_speed": target["speed_mps"], "true_cadence": target["cadence_spm"], "pred_cadence": float(pred),
        })

    def baselines(scenario, cal, target):
        add(scenario, "fixed", cal, target, fixed_cadence)
        add(scenario, "population", cal, target, predict_cadence(prior, [target["speed_mps"]])[0])

    for _, target in g.iterrows():
        baselines("k0", None, target)
        add("k0", "population_height", None, target, predict_cadence(prior_h, [target["speed_mps"]], height_cm=height)[0])

    for k in (1, 2):
        if len(g) < k + 1:
            continue
        for cal_idx in combinations(g.index, k):
            cal = g.loc[list(cal_idx)]
            offset = personal_offset(prior, cal["speed_mps"], cal["stride_m"])
            for _, target in g.drop(index=list(cal_idx)).iterrows():
                baselines(f"k{k}", cal, target)
                add(f"k{k}", f"bayes_{k}", cal, target, predict_cadence(prior, [target["speed_mps"]], offset)[0])
                if k == 1:
                    offset_h = personal_offset(prior_h, cal["speed_mps"], cal["stride_m"], height)
                    add("k1", "bayes_1_height", cal, target,
                        predict_cadence(prior_h, [target["speed_mps"]], offset_h, height)[0])
                if k == 2:
                    add("k2", "own_line_2", cal, target, own_line_cadence(cal, target["speed_mps"]))
    return rows


def cross_validate(table: pd.DataFrame, n_folds: int, seed: int) -> pd.DataFrame:
    subjects = table["subject_id"].unique()
    rng = np.random.default_rng(seed)
    folds = np.array_split(rng.permutation(subjects), n_folds)
    rows = []
    for fold, test_ids in enumerate(folds):
        train = table[~table["subject_id"].isin(test_ids)]
        test = table[table["subject_id"].isin(test_ids)]
        prior = fit_prior(train)
        prior_h = fit_prior(train, use_height=True)
        fixed_cadence = train["cadence_spm"].mean()
        for _, g in test.groupby("subject_id"):
            for r in evaluate_subject(g, prior, prior_h, fixed_cadence):
                rows.append({"fold": fold, **r})
    pred = pd.DataFrame(rows)
    pred["abs_err"] = (pred["pred_cadence"] - pred["true_cadence"]).abs()
    return pred


def summarize(pred: pd.DataFrame, by: list[str]) -> pd.DataFrame:
    return (pred.groupby(by)
            .agg(n=("abs_err", "size"), subjects=("subject_id", "nunique"),
                 mae_spm=("abs_err", "mean"), within_5=("abs_err", lambda e: (e <= WITHIN_SPM).mean()))
            .round(3).reset_index())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--wandb", action="store_true", help="결과를 W&B에 기록 (WANDB_API_KEY는 터미널에서 설정)")
    parser.add_argument("--wandb-project", default="runway-bpm-stride")
    args = parser.parse_args()

    table, full = load(args.folder)
    floor = noise_floor(full)
    pred = cross_validate(table, args.folds, args.seed)
    pred.to_csv(args.folder / "eval_predictions.csv", index=False)

    main_table = summarize(pred, ["scenario", "method"])
    by_source = summarize(pred[pred["scenario"].isin(["k0", "k1"])], ["scenario", "method", "source"])
    k1 = pred[pred["scenario"] == "k1"].copy()
    k1["distance"] = (k1["target_speed"] - k1["cal_speeds"].astype(float)).abs()
    by_distance = summarize(k1, ["method", "distance"])

    print(f"데이터: {len(table)}행, {table['subject_id'].nunique()}명, {args.folds}-fold (seed {args.seed})")
    print("\n[시나리오별 MAE] 같은 시나리오 안에서는 같은 예측 대상을 비교한다")
    print(main_table.to_string(index=False))
    print("\n[k0·k1 데이터별] 키는 Fukuchi만 있어 *_height의 효과는 Fukuchi 행에서 본다")
    print(by_source.to_string(index=False))
    print("\n[k1 보정 속도와 예측 속도 거리별]")
    print(by_distance.to_string(index=False))
    print(f"\n노이즈 바닥 (SS1 vs SS2): {floor:.2f} spm")

    # 서비스용: 전체 데이터로 다시 학습. 기록이 없으면 키 prior, 기록이 생기면 키 없는 prior로 보정한다
    prior = fit_prior(table)
    prior.save(args.folder / "stride_prior.json")
    prior_h = fit_prior(table, use_height=True)
    prior_h.save(args.folder / "stride_prior_height.json")
    print(f"\n최종 prior: μ={np.round(prior.mu, 4).tolist()}, "
          f"사람 간 표준편차={np.round(np.sqrt(np.diag(prior.G)), 4).tolist()}, σ={np.sqrt(prior.sigma2):.4f} m")
    print(f"키 prior: μ={np.round(prior_h.mu, 4).tolist()}, 키 10cm당 보폭 {prior_h.height_coef * 10:+.3f} m, "
          f"키 범위 {prior_h.h_range[0]:.1f}~{prior_h.h_range[1]:.1f} cm")

    if args.wandb:
        import wandb
        run = wandb.init(project=args.wandb_project, job_type="eval", config={
            "folds": args.folds, "seed": args.seed, "v_ref": prior.v_ref, "rows": len(table),
            "subjects": int(table["subject_id"].nunique()), "data": "fukuchi+zenodo_tm (SS1)",
        })
        run.log({"summary": wandb.Table(dataframe=main_table), "by_source": wandb.Table(dataframe=by_source),
                 "by_distance": wandb.Table(dataframe=by_distance), "noise_floor_spm": floor})
        for r in main_table.itertuples():
            run.summary[f"{r.scenario}/{r.method}/mae_spm"] = r.mae_spm
        run.summary["prior"] = prior.to_dict()
        run.summary["prior_height"] = prior_h.to_dict()
        run.finish()


if __name__ == "__main__":
    main()
"""BPM-005: 메트로놈(큐)을 켜고 뛴 기록으로 보정해도 되는지 본다.

데이터: 워치 데모 앱 BPM 실험 기록(같은 러너, 러닝 여러 회, 1초 간격, BPM 이벤트 포함).
20초 구간마다 평균 속도·케이던스와 그 구간의 목표 BPM을 만든다(구간 안에서 BPM이 바뀐 구간은 뺀다).

질문 두 가지:
  1. 큐를 켜면 케이던스가 BPM을 따라가나? (BPM과 실제 케이던스 차이)
  2. 다른 러닝의 큐 켠 기록으로 보정하면, 이 러닝에서 "이 BPM을 주면 몇 페이스로 뛰나"를 더 잘 맞히나?
     (평균 직선 vs 다른 러닝의 큐 기록으로 보정, 러닝 하나씩 빼고 평가)

사용법:
    python evaluate_cued.py <워치 JSON 폴더> <bpm 데이터 폴더> [--participant Runner01] [--exclude-date 2026-10-27] [--wandb]
    (--exclude-date: 다른 사람이 뛴 기록 등 뺄 러닝의 시작 날짜, UTC 기준, 여러 개 가능)
    (bpm 데이터 폴더의 stride_prior.json을 쓰고 eval_cued_predictions.csv를 저장)
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from stride_model import StridePrior, personal_offset, predict_cadence

WINDOW_SEC = 20
MIN_SPEED = 1.5
FOLLOW_SPM = 5          # |케이던스 − BPM| ≤ 5 이면 BPM을 따라간 구간으로 본다
SPEED_BIN = 0.25


def read_json(path: Path) -> dict:
    """워치 앱 내보내기는 UTF-8 또는 UTF-16(BOM 있음)으로 저장된다."""
    raw = path.read_bytes()
    encoding = "utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig"
    return json.loads(raw.decode(encoding))


def load_windows(folder: Path, participant: str, exclude_dates=()) -> pd.DataFrame:
    rows = []
    for path in sorted(folder.glob("*.json")):
        d = read_json(path)
        if d["participantId"] != participant or d["startedAt"][:10] in exclude_dates:
            continue
        s = pd.DataFrame(d["samples"])
        s = s[s["metric"].isin(["CADENCE", "SPEED"])].copy()
        s["window"] = (s["sessionElapsedMs"] // (WINDOW_SEC * 1000)).astype(int)
        w = s.pivot_table(index="window", columns="metric", values="value", aggfunc="mean")
        bpm = s.groupby("window")["targetBpmAtEnd"].agg(["min", "max"])
        w = w.join(bpm).dropna()
        w = w[(w["min"] == w["max"]) & (w["SPEED"] >= MIN_SPEED)]
        rows.append(pd.DataFrame({"run": d["startedAt"][:16], "window": w.index, "bpm": w["min"],
                                  "speed_mps": w["SPEED"], "cadence_spm": w["CADENCE"]}))
    df = pd.concat(rows, ignore_index=True)
    df["stride_m"] = 60 * df["speed_mps"] / df["cadence_spm"]
    df["followed"] = (df["cadence_spm"] - df["bpm"]).abs() <= FOLLOW_SPM
    df["run_no"] = df["run"].rank(method="dense").astype(int)
    return df


def speed_at_bpm(prior: StridePrior, bpm, offset=None) -> np.ndarray:
    """BPM으로 딱 맞춰 뛸 때 나오는 속도: 60·v = BPM·(A + B·(v − v_ref))를 v에 대해 푼다."""
    a, b = prior.mu + (np.zeros(2) if offset is None else offset)
    bpm = np.asarray(bpm, dtype=float)
    return bpm * (a - b * prior.v_ref) / (60 - bpm * b)


def binned(records: pd.DataFrame) -> pd.DataFrame:
    """한 러닝 안의 비슷한 구간이 과하게 반영되지 않게 러닝·속도 칸별 평균 하나로 묶는다."""
    r = records.assign(bin=(records["speed_mps"] / SPEED_BIN).round())
    return r.groupby(["run_no", "bin"], as_index=False)[["speed_mps", "stride_m"]].mean()


def evaluate(prior: StridePrior, df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for run_no, target in df.groupby("run_no"):
        others = df[df["run_no"] != run_no]
        cal = {
            "population": None,
            "bayes_cued_all": binned(others),                       # 다른 러닝의 큐 켠 구간 전부
            "bayes_cued_followed": binned(others[others["followed"]]),   # 그중 BPM을 따라간 구간만
        }
        for method, rec in cal.items():
            off = None if rec is None else personal_offset(prior, rec["speed_mps"], rec["stride_m"])
            followed = target[target["followed"]]
            pred_speed = speed_at_bpm(prior, followed["bpm"], off)          # 질문 2: BPM → 페이스
            pred_cad = predict_cadence(prior, target["speed_mps"], off)    # 참고: 속도 → 케이던스
            for (_, t), v in zip(followed.iterrows(), pred_speed):
                rows.append({"run_no": run_no, "method": method, "task": "pace_at_bpm",
                             "true": 1000 / t["speed_mps"], "pred": 1000 / v})   # 초/km
            for (_, t), c in zip(target.iterrows(), pred_cad):
                rows.append({"run_no": run_no, "method": method, "task": "cadence_at_speed",
                             "true": t["cadence_spm"], "pred": float(c)})
    pred = pd.DataFrame(rows)
    pred["err"] = pred["pred"] - pred["true"]
    pred["abs_err"] = pred["err"].abs()
    return pred


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("watch_folder", type=Path)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--participant", default="Runner01")
    parser.add_argument("--exclude-date", nargs="*", default=[], help="뺄 러닝의 시작 날짜(UTC, YYYY-MM-DD)")
    parser.add_argument("--wandb", action="store_true", help="결과를 W&B에 기록 (WANDB_API_KEY는 터미널에서 설정)")
    parser.add_argument("--wandb-project", default="runway-bpm-stride")
    args = parser.parse_args()

    prior = StridePrior.load(args.folder / "stride_prior.json")
    df = load_windows(args.watch_folder, args.participant, set(args.exclude_date))
    diff = df["cadence_spm"] - df["bpm"]
    band = df.groupby(pd.cut(df["bpm"], [0, 130, 150, 170, 250]), observed=True).apply(
        lambda g: pd.Series({"windows": len(g), "follow_rate": g["followed"].mean(),
                             "median_cadence_minus_bpm": (g["cadence_spm"] - g["bpm"]).median()}))
    print(f"러너 1명, 러닝 {df['run_no'].nunique()}회, 20초 구간 {len(df)}개 (모두 큐 켜짐)")
    print(f"\n[1] BPM을 따라갔나: |케이던스 − BPM| 중앙값 {diff.abs().median():.1f} spm, "
          f"±{FOLLOW_SPM} 안 {df['followed'].mean():.0%}")
    print(band.round(2).to_string())

    pred = evaluate(prior, df)
    pred.to_csv(args.folder / "eval_cued_predictions.csv", index=False)
    table = (pred.groupby(["task", "method"])
             .agg(n=("abs_err", "size"), mae=("abs_err", "mean"), bias=("err", "mean")).round(2).reset_index())
    print("\n[2] 러닝 하나씩 빼고, 다른 러닝의 큐 켠 기록으로 보정했을 때")
    print("  pace_at_bpm: BPM을 따라간 구간에서 '이 BPM이면 몇 초/km로 뛰나' 오차(초/km)")
    print("  cadence_at_speed: 실제 속도에서 케이던스 오차(spm), 참고용")
    print(table.to_string(index=False))

    if args.wandb:
        import wandb
        run = wandb.init(project=args.wandb_project, job_type="eval_cued", config={
            "experiment": "BPM-005", "participant": args.participant, "runs": int(df["run_no"].nunique()),
            "window_sec": WINDOW_SEC, "follow_spm": FOLLOW_SPM, "prior": "stride_prior.json",
            "exclude_dates": args.exclude_date})
        run.log({"follow_by_bpm": wandb.Table(dataframe=band.reset_index().astype({"bpm": str})),
                 "summary": wandb.Table(dataframe=table),
                 "charts/pace_mae_by_method": wandb.plot.bar(
                     wandb.Table(dataframe=table[table["task"] == "pace_at_bpm"][["method", "mae"]]),
                     "method", "mae", title="Pace error at given BPM (sec/km)"),
                 "cued/follow_rate": float(df["followed"].mean()),
                 **{f"cued/{r.task}/{r.method}/mae": r.mae for r in table.itertuples()}})
        run.finish()


if __name__ == "__main__":
    main()

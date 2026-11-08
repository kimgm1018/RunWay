"""BPM-008·009: 서비스 목표 BPM 규칙(target_bpm.py)을 실제 워치 기록으로 그대로 채점한다.

사람마다 따로 채점한다. 각 사람의 n번째 러닝은 **그 사람의** 1 ~ n−1번째 기록만 쓴다(미래 기록 미사용).

  A. 큐 없이 뛴 사람(개인 기록, personal_windows.csv, 60초 구간): 그 구간 실제 페이스를 목표로
     서비스가 줄 BPM vs 실제 케이던스. 각 러닝의 첫 구간은 첫 1분 보정용이라 채점하지 않는다.
       - service_records: select_records(최근 20회) → target_bpm
       - service_new_user: 지난 기록 없이 평균 직선 → first_minute_bpm(첫 1분, 3 spm 이상이면 변경)
       - population: 평균 직선
  C. 큐를 켜고 뛴 사람(워치 데모 앱 JSON, 20초 구간)마다, 러닝마다 첫 1분(BPM을 따라간 구간 3개)은
     보정에만 쓰고 나머지 BPM을 따라간 구간에서 "이 BPM이면 몇 초/km"(와 참고용 케이던스)를 채점한다.
     평균 직선, 그 사람의 지난 기록, 첫 1분만, 지난 기록 + 첫 1분을 비교하고, 그 러닝의 실제 페이스
     중앙값을 미리 알았다고 쳤을 때의 오차(러닝 안 흔들림 참고값)를 함께 낸다.

개인 건강 데이터는 저장소 밖 폴더에서만 읽는다. 출력·W&B에는 사람 순번·러닝 순번과 오차만 남긴다.

사용법:
    python evaluate_service.py <bpm 데이터 폴더> [--cued <워치 JSON 폴더> <참가자>]... [--exclude-date 2026-10-27] [--wandb]
    (bpm 데이터 폴더의 personal_windows.csv·stride_prior.json을 쓰고 eval_service_predictions.csv를 저장)
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from evaluate_cued import FOLLOW_SPM, load_windows, speed_at_bpm
from stride_model import StridePrior, personal_offset, predict_cadence
from target_bpm import Window, first_minute_bpm, select_records, target_bpm

FIRST_MINUTE_WINDOWS = 3     # 큐 켠 러닝의 첫 1분 = BPM을 따라간 20초 구간 3개


def to_windows(df: pd.DataFrame) -> list[Window]:
    cue = df["cue_bpm"] if "cue_bpm" in df else pd.Series(np.nan, index=df.index)
    return [Window(int(r), float(s), float(c), None if np.isnan(b) else float(b))
            for r, s, c, b in zip(df["run_no"], df["speed_mps"], df["cadence_spm"], cue)]


def records_offset(prior: StridePrior, records) -> np.ndarray | None:
    if not records:
        return None
    sp = np.array([s for s, _ in records])
    cad = np.array([c for _, c in records])
    return personal_offset(prior, sp, 60 * sp / cad)


def finish(rows: list[dict]) -> pd.DataFrame:
    out = pd.DataFrame(rows)
    out["err"] = out["pred"] - out["true"]
    out["abs_err"] = out["err"].abs()
    return out


def evaluate_personal(prior: StridePrior, df: pd.DataFrame) -> pd.DataFrame:
    """A: 큐 없이 뛴 한 사람의 기록을 시간순으로 채점한다."""
    rows = []
    for run_no, g in df.groupby("run_no"):
        history = to_windows(df[df["run_no"] < run_no])
        records = select_records(history)
        base = {"run_no": run_no, "n_past": len({w.run_no for w in history}), "task": "cadence"}
        first, rest = g.iloc[0], g.iloc[1:]
        first_w = Window(run_no, first["speed_mps"], first["cadence_spm"])
        for t in rest.itertuples():
            pace = 1000 / t.speed_mps
            if records:
                rows.append({**base, "method": "service_records", "true": t.cadence_spm,
                             "pred": target_bpm(pace, prior, records=records).bpm})
            start = target_bpm(pace, prior).bpm
            fm = first_minute_bpm(start, pace, first_w, [], prior)
            rows.append({**base, "method": "service_new_user", "true": t.cadence_spm, "pred": fm.bpm if fm else start})
            rows.append({**base, "method": "population", "true": t.cadence_spm, "pred": start})
    return finish(rows)


def score_cued_run(prior: StridePrior, run: pd.DataFrame, records) -> list[dict]:
    """C: 큐 켠 러닝 하나. 첫 1분은 보정에만 쓰고 나머지 BPM을 따라간 구간을 채점한다."""
    followed = run[(run["cadence_spm"] - run["cue_bpm"]).abs() <= FOLLOW_SPM]
    first, rest = followed.iloc[:FIRST_MINUTE_WINDOWS], followed.iloc[FIRST_MINUTE_WINDOWS:]
    if len(first) < FIRST_MINUTE_WINDOWS or rest.empty:
        return []
    fs, fc = first["speed_mps"].to_numpy(), first["cadence_spm"].to_numpy()
    offsets = {"population": None, "first_minute": personal_offset(prior, fs, 60 * fs / fc)}
    if records:
        sp = np.r_[[s for s, _ in records], fs]
        cad = np.r_[[c for _, c in records], fc]
        offsets["records"] = records_offset(prior, records)
        offsets["records_first_minute"] = personal_offset(prior, sp, 60 * sp / cad)
    true_pace = 1000 / rest["speed_mps"].to_numpy()
    rows = []
    for method, off in offsets.items():
        pace = 1000 / speed_at_bpm(prior, rest["cue_bpm"], off)
        cad = predict_cadence(prior, rest["speed_mps"].to_numpy(), off)
        rows += [{"task": "pace", "method": method, "true": t, "pred": p} for t, p in zip(true_pace, pace)]
        rows += [{"task": "cadence", "method": method, "true": t, "pred": c}
                 for t, c in zip(rest["cadence_spm"], cad)]
    oracle = float(np.median(true_pace))       # 러닝 평균 페이스를 미리 알았을 때(참고)
    rows += [{"task": "pace", "method": "oracle_run_median", "true": t, "pred": oracle} for t in true_pace]
    return rows


def evaluate_cued_runs(prior: StridePrior, df: pd.DataFrame, user: str) -> pd.DataFrame:
    """C: 큐 켠 한 사람. 각 러닝은 그 사람의 앞선 러닝만 기록으로 쓴다."""
    rows = []
    for run_no, g in df.groupby("run_no"):
        records = select_records(to_windows(df[df["run_no"] < run_no]))
        rows += [{"user": user, "run_no": run_no, "n_records": len(records), **r}
                 for r in score_cued_run(prior, g, records)]
    return finish(rows) if rows else pd.DataFrame()


def summarize(pred: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    def stats(g):
        e = g["abs_err"]
        limit = 30 if g.name[-1] == "pace" else FOLLOW_SPM
        return pd.Series({"windows": len(g), "mae": e.mean(), "bias": g["err"].mean(), "within": (e <= limit).mean()})
    out = pred.groupby(keys + ["method", "task"]).apply(stats).round(2).reset_index()
    return out.astype({"windows": int})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("--cued", nargs=2, action="append", default=[], metavar=("WATCH_FOLDER", "PARTICIPANT"),
                        help="큐 켠 워치 기록 폴더와 참가자 ID. 사람마다 한 번씩 (여러 번 가능)")
    parser.add_argument("--exclude-date", nargs="*", default=[], help="뺄 러닝의 시작 날짜(UTC, 다른 사람이 뛴 기록 등)")
    parser.add_argument("--wandb", action="store_true", help="결과를 W&B에 기록 (WANDB_API_KEY는 터미널에서 설정)")
    parser.add_argument("--wandb-project", default="runway-bpm-stride")
    args = parser.parse_args()

    prior = StridePrior.load(args.folder / "stride_prior.json")
    personal = pd.read_csv(args.folder / "personal_windows.csv")
    a = evaluate_personal(prior, personal)
    table_a = summarize(a, [])
    print(f"[A] 큐 없이 뛴 사람 1명, 러닝 {personal['run_no'].nunique()}회: 서비스가 줄 BPM vs 실제 케이던스 "
          f"(spm, within = ±5 안 비율)")
    print(table_a.to_string(index=False))
    bins = pd.cut(a["n_past"], [-1, 0, 4, 9, 19, 1000], labels=["0", "1-4", "5-9", "10-19", "20+"])
    print("지난 러닝 수별 MAE")
    print(a.groupby([bins, "method"], observed=True)["abs_err"].mean().unstack().round(2).to_string())

    cued, runs = [], {}
    for i, (watch, participant) in enumerate(args.cued, 1):
        df = load_windows(Path(watch), participant, set(args.exclude_date))
        df = df.assign(cue_bpm=df["bpm"])
        runs[f"cued_{i}"] = int(df["run_no"].nunique())
        cued.append(evaluate_cued_runs(prior, df, f"cued_{i}"))
    cued = [c for c in cued if not c.empty]
    table_c = table_c_user = table_c_with = pd.DataFrame()
    if cued:
        cued = pd.concat(cued, ignore_index=True)
        table_c = summarize(cued, ["user", "run_no"])
        table_c_user = summarize(cued, ["user"])
        with_records = cued[cued["n_records"] > 0]
        print(f"\n[C] 큐 켠 사람별 (러닝 수 {runs}): 첫 1분은 보정에만 쓰고 나머지 채점 "
              "(pace within = ±30초, cadence within = ±5 spm)")
        print("oracle_run_median = 그 러닝의 실제 페이스 중앙값 하나로 맞혔을 때(참고, BPM이 여러 개면 하한이 아님)")
        print(table_c_user.to_string(index=False))
        if not with_records.empty:
            table_c_with = summarize(with_records, ["user"])
            print("지난 기록이 있는 러닝만 (같은 구간에서 방법 비교)")
            print(table_c_with[table_c_with["task"] == "pace"].to_string(index=False))
        print("러닝별 페이스 MAE")
        print(table_c[table_c["task"] == "pace"]
              .pivot_table(index=["user", "run_no"], columns="method", values="mae").round(1).to_string())
    else:
        cued = pd.DataFrame()

    out = pd.concat([a.assign(user="personal", part="A"), cued.assign(part="C")], ignore_index=True)
    out.to_csv(args.folder / "eval_service_predictions.csv", index=False)

    if args.wandb:
        import wandb
        # 실행 명령(참가자 ID·날짜·로컬 경로)이 W&B에 남지 않게 시스템 메타데이터를 끈다
        run = wandb.init(project=args.wandb_project, job_type="eval_service",
                         settings=wandb.Settings(x_disable_meta=True), config={
            "experiment": "BPM-008/BPM-009", "personal_runs": int(personal["run_no"].nunique()), "cued_runs": runs,
            "first_minute_windows": FIRST_MINUTE_WINDOWS, "follow_spm": FOLLOW_SPM, "prior": "stride_prior.json"})
        log = {"A_cadence": wandb.Table(dataframe=table_a),
               **{f"A/{r.method}/mae": r.mae for r in table_a.itertuples()},
               **{f"A/{r.method}/within5": r.within for r in table_a.itertuples()}}
        if not table_c.empty:
            log.update({"C_cued_runs": wandb.Table(dataframe=table_c), "C_by_user": wandb.Table(dataframe=table_c_user),
                        **{f"C/{r.user}/{r.task}/{r.method}/mae": r.mae for r in table_c_user.itertuples()}})
        if not table_c_with.empty:
            log.update({"C_with_records": wandb.Table(dataframe=table_c_with),
                        **{f"C_with_records/{r.user}/{r.task}/{r.method}/mae": r.mae
                           for r in table_c_with.itertuples()}})
        run.log(log)
        run.finish()


if __name__ == "__main__":
    main()

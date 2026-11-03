"""Samsung Health 내보내기에서 러닝마다 페이스가 일정한 구간의 (속도, 케이던스) 기록을 만든다.

개인 건강 데이터라 결과 CSV는 저장소 밖에 두고, 화면에는 개수만 출력한다.
워치 live_data는 약 10초 간격으로 speed(m/s)와 cadence(양발 걸음/분)를 같은 기록에 담는다.

사용법:
    python convert_personal.py <Samsung Health 내보내기 폴더> <출력 CSV>
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

RUNNING = 1002                 # exercise_type: 러닝
WINDOW_SEC = 60                # 구간 길이
MIN_SAMPLES = 4                # 구간 안 최소 기록 수(약 10초 간격)
MIN_SPEED = 1.5                # 이보다 느리면 걷기·정지로 본다(m/s)
CADENCE_RANGE = (120, 230)     # 러닝 케이던스로 보는 범위(spm)
MAX_SPEED_CV = 0.05            # 구간 안 속도 변동계수 상한(페이스가 일정한 구간만)
MAX_CADENCE_SD = 5.0           # 구간 안 케이던스 표준편차 상한(spm)

EX = "com.samsung.health.exercise."


def load_runs(src: Path) -> pd.DataFrame:
    table = pd.read_csv(next(src.glob("com.samsung.shealth.exercise.2*.csv")),
                        skiprows=1, index_col=False, low_memory=False)
    runs = table[table[EX + "exercise_type"] == RUNNING]
    runs = runs.assign(start=pd.to_datetime(runs[EX + "start_time"])).sort_values("start")
    return runs[[EX + "datauuid", "start"]].reset_index(drop=True)


def live_samples(path: Path) -> pd.DataFrame:
    records = json.loads(path.read_text(encoding="utf-8-sig"))
    rows = [(r["start_time"], r["speed"], r["cadence"]) for r in records if "speed" in r and "cadence" in r]
    df = pd.DataFrame(rows, columns=["t_ms", "speed_mps", "cadence_spm"]).sort_values("t_ms")
    df["t_s"] = (df["t_ms"] - df["t_ms"].iloc[0]) / 1000 if len(df) else []
    return df


def steady_windows(df: pd.DataFrame) -> pd.DataFrame:
    """60초 구간으로 나눠 달리는 중이고 페이스가 일정한 구간만 평균을 낸다."""
    ok = (df["speed_mps"] >= MIN_SPEED) & df["cadence_spm"].between(*CADENCE_RANGE)
    df = df[ok].assign(window=(df["t_s"] // WINDOW_SEC).astype(int))
    stats = df.groupby("window").agg(
        n=("speed_mps", "size"), speed_mps=("speed_mps", "mean"), speed_sd=("speed_mps", "std"),
        cadence_spm=("cadence_spm", "mean"), cadence_sd=("cadence_spm", "std"))
    steady = (stats["n"] >= MIN_SAMPLES) & (stats["speed_sd"] / stats["speed_mps"] <= MAX_SPEED_CV) \
        & (stats["cadence_sd"] <= MAX_CADENCE_SD)
    return stats[steady].reset_index()


def convert(src: Path) -> pd.DataFrame:
    files = {p.name.split(".")[0]: p for p in
             (src / "jsons" / "com.samsung.shealth.exercise").glob("*/*.com.samsung.health.exercise.live_data.json")}
    rows = []
    run_no = 0
    for uid in load_runs(src)[EX + "datauuid"]:
        if uid not in files:
            continue
        windows = steady_windows(live_samples(files[uid]))
        if windows.empty:
            continue
        run_no += 1                                   # 시간순 번호. 날짜·위치는 저장하지 않는다
        for w in windows.itertuples():
            rows.append({
                "subject_id": "G_P01",
                "run_no": run_no,
                "session_id": f"G_run{run_no:03d}",
                "window_start_s": int(w.window * WINDOW_SEC),
                "setting": "outdoor_watch",
                "speed_mps": w.speed_mps,
                "cadence_spm": w.cadence_spm,
                "stride_m": 60 * w.speed_mps / w.cadence_spm,
                "n_samples": int(w.n),
            })
    return pd.DataFrame(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()

    table = convert(args.src)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(args.out, index=False)
    per_run = table.groupby("run_no").size()
    print(f"러닝 {table['run_no'].nunique()}회, 일정 페이스 구간 {len(table)}개 → {args.out}")
    print(f"러닝당 구간 수: 중앙값 {per_run.median():.0f}, 최소 {per_run.min()}, 최대 {per_run.max()}")


if __name__ == "__main__":
    main()
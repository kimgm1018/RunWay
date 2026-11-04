"""Zenodo 16541185 트레드밀(TM_FP) stride 파일에서 속도별 케이던스·보폭 표를 만든다.

stride 파일 하나 = 한 발 기준 한 주기 = 두 걸음.
사용법:
    python convert_zenodo_tm.py <zenodo 폴더> <출력 CSV>
"""
import argparse
import re
from pathlib import Path

import numpy as np
import pandas as pd

CONDITIONS = ("cadence_SS1", "cadence_SS2")   # 본인이 편한 케이던스로 뛴 조건만 쓴다
DIR_RE = re.compile(r"participant_(\d+)/speed_([\d.]+)/(cadence_SS\d)")


def convert_folder(folder: Path) -> dict:
    durations, speeds = [], []
    for path in folder.glob("stride_*.csv"):
        stride = pd.read_csv(path, usecols=["delta_time", "speed"])
        durations.append(stride["delta_time"].sum())     # stride 시간(초)
        speeds.append(stride["speed"].mean())
    durations = np.array(durations)
    med = np.median(durations)
    good = durations[(durations > 0.7 * med) & (durations < 1.3 * med)]   # 잘못 잘린 stride 제외
    cadence = 120 / good.mean()                          # stride 하나에 두 걸음
    speed = float(np.median(speeds))
    return {
        "speed_mps": speed,
        "cadence_spm": cadence,
        "stride_m": 60 * speed / cadence,
        "n_steps": 2 * len(good),
        "n_dropped": len(durations) - len(good),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()

    rows = []
    for folder in sorted((args.src / "TM_FP").glob("participant_*/speed_*/cadence_*")):
        m = DIR_RE.search(folder.as_posix())
        if not m or m.group(3) not in CONDITIONS:
            continue
        num, speed_name, cond = int(m.group(1)), m.group(2), m.group(3)
        rows.append({
            "subject_id": f"Z_P{num:02d}",
            "session_id": f"Z_P{num:02d}_TM_{speed_name}_{cond[-3:]}",
            "setting": "treadmill",
            **convert_folder(folder),
            "height_cm": np.nan,    # 데이터에 키 정보가 없다
        })

    table = pd.DataFrame(rows).sort_values(["subject_id", "speed_mps", "session_id"])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(args.out, index=False)
    print(f"{len(table)}행, {table['subject_id'].nunique()}명 → {args.out}")
    print(table.groupby("speed_mps")[["cadence_spm", "stride_m", "n_steps"]].describe().round(2).T)


if __name__ == "__main__":
    main()
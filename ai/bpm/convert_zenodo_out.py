"""Zenodo 16541185 실외(OUT) 직선 구간 파일에서 발 IMU로 케이던스를 구해 표로 만든다.

실외에는 힘판이 없어서 발 자이로의 주기(자기상관)로 stride 시간을 찾는다.
한 발의 한 주기 = 두 걸음이므로 케이던스 = 120 / stride 시간.

사용법:
    python convert_zenodo_out.py <zenodo 폴더> <출력 CSV>
    python convert_zenodo_out.py <zenodo 폴더> --check-treadmill   (트레드밀 stride 시간과 비교해 방법 확인)
"""
import argparse
import re
from pathlib import Path

import numpy as np
import pandas as pd

FS_HZ = 120                      # 실외·트레드밀 IMU 샘플링 주파수(delta_time 약 0.00833초)
STRIDE_SEC = (0.45, 1.1)         # 찾을 stride 시간 범위 = 케이던스 약 109~267 spm
FILE_RE = re.compile(r"participant_(\d+)/set_(\d+)_straightaway_(\d+)\.csv")


def foot_gyro(df: pd.DataFrame) -> np.ndarray:
    """발 자이로 세 축 중 가장 크게 흔들리는 축(다리 앞뒤 회전)."""
    gyro = df[["fot_gyr_x", "fot_gyr_y", "fot_gyr_z"]]
    return gyro[gyro.var().idxmax()].to_numpy()


def stride_period(signal: np.ndarray, fs: float = FS_HZ) -> tuple[float, float]:
    """자기상관이 가장 큰 지연 = stride 시간(초). 두 번째 값은 그 자기상관(주기가 뚜렷할수록 1에 가깝다)."""
    x = signal - signal.mean()
    n = len(x)
    spec = np.fft.rfft(x, 2 * n)
    ac = np.fft.irfft(spec * np.conj(spec))[:n]
    ac /= ac[0]
    lo, hi = int(STRIDE_SEC[0] * fs), int(STRIDE_SEC[1] * fs)
    k = lo + int(np.argmax(ac[lo:hi]))
    y0, y1, y2 = ac[k - 1], ac[k], ac[k + 1]
    shift = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)    # 꼭짓점을 포물선으로 보정해 1샘플보다 정밀하게
    return (k + shift) / fs, float(y1)


def imu_cadence(df: pd.DataFrame) -> tuple[float, float]:
    period, quality = stride_period(foot_gyro(df))
    return 120 / period, quality


def convert(src: Path) -> pd.DataFrame:
    rows = []
    for path in sorted((src / "OUT").glob("participant_*/set_*_straightaway_*.csv")):
        m = FILE_RE.search(path.as_posix())
        if not m:
            continue
        num, set_no, straight = int(m.group(1)), m.group(2), m.group(3)
        df = pd.read_csv(path)
        cadence, quality = imu_cadence(df)
        speed = float(df["speed"].median())        # 시작 직후 0인 줄이 있어 중앙값을 쓴다
        duration = float(df["delta_time"].sum())
        rows.append({
            "subject_id": f"Z_P{num:02d}",
            "session_id": f"Z_P{num:02d}_OUT_set{set_no}_s{straight}",
            "setting": "outdoor",
            "speed_mps": speed,
            "cadence_spm": cadence,
            "stride_m": 60 * speed / cadence,
            "n_steps": int(round(duration * cadence / 60)),
            "acf_quality": quality,
            "height_cm": np.nan,
        })
    return pd.DataFrame(rows)


def check_treadmill(src: Path) -> pd.DataFrame:
    """트레드밀 stride 파일을 이어 붙여 같은 방법으로 케이던스를 구하고, stride 시간으로 구한 값과 비교한다."""
    rows = []
    for folder in sorted((src / "TM_FP").glob("participant_*/speed_*/cadence_SS*")):
        files = sorted(folder.glob("stride_*.csv"), key=lambda p: int(re.findall(r"(\d+)", p.stem)[0]))
        strides = [pd.read_csv(f) for f in files]
        truth = 120 / np.mean([s["delta_time"].sum() for s in strides])
        cadence, quality = imu_cadence(pd.concat(strides))
        rows.append({"folder": folder.relative_to(src / "TM_FP").as_posix(), "truth_spm": truth,
                     "imu_spm": cadence, "acf_quality": quality})
    table = pd.DataFrame(rows)
    table["abs_err"] = (table["imu_spm"] - table["truth_spm"]).abs()
    return table


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("out", type=Path, nargs="?")
    parser.add_argument("--check-treadmill", action="store_true")
    args = parser.parse_args()

    if args.check_treadmill:
        table = check_treadmill(args.src)
        print(f"트레드밀 {len(table)}개 폴더: IMU 케이던스 오차 평균 {table['abs_err'].mean():.2f} spm, "
              f"최대 {table['abs_err'].max():.2f} spm, 자기상관 최소 {table['acf_quality'].min():.2f}")
        return

    table = convert(args.src)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(args.out, index=False)
    print(f"{len(table)}행, {table['subject_id'].nunique()}명 → {args.out}")
    print(table.groupby("subject_id")[["speed_mps", "cadence_spm", "acf_quality"]].agg(["min", "max"]).round(2))


if __name__ == "__main__":
    main()
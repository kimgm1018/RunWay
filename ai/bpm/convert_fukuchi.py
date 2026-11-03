"""Fukuchi 러닝 데이터(figshare 4543435)의 힘판 기록에서 속도별 케이던스·보폭 표를 만든다.

사용법:
    python convert_fukuchi.py <fukuchi 폴더> <출력 CSV>
"""

import argparse
import hashlib
import re
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

FS_HZ = 300            # 힘판 샘플링 주파수
CONTACT_N = 200.0      # 이 값을 아래에서 위로 넘으면 착지
MIN_GAP_FRAMES = 30    # 0.1초. 이보다 가까운 착지는 노이즈로 본다
SPEEDS = {"T25": 2.5, "T35": 3.5, "T45": 4.5}
FILE_RE = re.compile(r"RBDS(\d{3})run(T25|T35|T45)forces\.txt")


def detect_contacts(fy: np.ndarray) -> np.ndarray:
    """수직 힘이 CONTACT_N을 넘는 순간(프레임 번호)을 찾는다."""
    above = fy >= CONTACT_N
    onsets = np.flatnonzero(~above[:-1] & above[1:]) + 1
    kept = []
    for i in onsets:
        if not kept or i - kept[-1] >= MIN_GAP_FRAMES:
            kept.append(i)
    return np.array(kept)


def convert_file(path: Path, speed: float) -> dict:
    forces = pd.read_csv(path, sep="\t")
    contacts = detect_contacts(forces["Fy"].to_numpy())
    gaps = np.diff(contacts)                    # 착지 간격(프레임)
    med = np.median(gaps)
    good = gaps[(gaps > 0.7 * med) & (gaps < 1.3 * med)]   # 잘못 잡힌 착지 때문에 생긴 짧은·긴 간격 제외
    cadence = 60 * FS_HZ / good.mean()          # 걸음/분 (두 발 합)
    return {
        "cadence_spm": cadence,
        "stride_m": 60 * speed / cadence,       # 한 걸음 길이
        "n_steps": len(good),
        "n_dropped": len(gaps) - len(good),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()

    info = pd.read_csv(args.src / "39452932_RBDSinfo.txt", sep="\t")
    height = info.drop_duplicates("Subject").set_index("Subject")["Height"]

        # 원본에 속도만 다르고 내용이 똑같은 파일이 있다(RBDS029·030·032). 어느 속도인지 알 수 없어 뺀다
    paths = [p for p in sorted(args.src.glob("RBDS*run*forces.txt")) if FILE_RE.fullmatch(p.name)]
    digests = {p: hashlib.md5(p.read_bytes()).hexdigest() for p in paths}
    counts = Counter(digests.values())
    duplicated = [p.name for p in paths if counts[digests[p]] > 1]
    if duplicated:
        print(f"내용이 같은 파일 {len(duplicated)}개 제외: {', '.join(duplicated)}")

    rows = []
    for path in paths:
        if path.name in duplicated:
            continue
        m = FILE_RE.fullmatch(path.name)
        num, cond = int(m.group(1)), m.group(2)
        speed = SPEEDS[cond]
        rows.append({
            "subject_id": f"F_RBDS{num:03d}",
            "session_id": f"F_RBDS{num:03d}_{cond}",
            "setting": "treadmill",
            "speed_mps": speed,
            **convert_file(path, speed),
            "height_cm": height.get(num, np.nan),
        })

    table = pd.DataFrame(rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(args.out, index=False)
    print(f"{len(table)}행, {table['subject_id'].nunique()}명 → {args.out}")
    print(table.groupby("speed_mps")[["cadence_spm", "stride_m", "n_steps"]].describe().round(2).T)


if __name__ == "__main__":
    main()
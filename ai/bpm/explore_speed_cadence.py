"""변환한 표들을 합치고, 사람별 속도-케이던스·속도-보폭 그래프를 그린다.

사용법:
    python explore_speed_cadence.py <bpm 데이터 폴더>
    (폴더 안의 fukuchi.csv, zenodo_tm.csv를 읽고 all_treadmill.csv와 그래프 PNG를 같은 폴더에 저장)
"""
import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

SOURCES = {"fukuchi.csv": ("Fukuchi", "tab:blue"), "zenodo_tm.csv": ("Zenodo", "tab:orange")}


def load(folder: Path) -> pd.DataFrame:
    tables = []
    for name, (source, _) in SOURCES.items():
        t = pd.read_csv(folder / name)
        t["source"] = source
        tables.append(t)
    return pd.concat(tables, ignore_index=True)


def per_person_lines(table: pd.DataFrame, y: str) -> pd.DataFrame:
    """속도가 3개 이상인 사람마다 y = a + b × 속도 직선을 맞춘다 (SS1만 사용)."""
    rows = []
    data = table[~table["session_id"].str.endswith("SS2")]
    for subject, g in data.groupby("subject_id"):
        if g["speed_mps"].nunique() < 3:
            continue
        b, a = np.polyfit(g["speed_mps"], g[y], 1)
        pred = a + b * g["speed_mps"]
        r2 = 1 - ((g[y] - pred) ** 2).sum() / ((g[y] - g[y].mean()) ** 2).sum()
        rows.append({"subject_id": subject, "a": a, "b": b, "r2": r2})
    return pd.DataFrame(rows)


def plot(table: pd.DataFrame, y: str, ylabel: str, out: Path):
    fig, ax = plt.subplots(figsize=(7, 5))
    data = table[~table["session_id"].str.endswith("SS2")]
    for subject, g in data.groupby("subject_id"):
        source = g["source"].iloc[0]
        color = dict(SOURCES.values())[source]
        g = g.sort_values("speed_mps")
        ax.plot(g["speed_mps"], g[y], "-o", color=color, alpha=0.5, markersize=3, linewidth=1)
    for source, color in SOURCES.values():
        ax.plot([], [], "-o", color=color, label=source)
    ax.set_xlabel("Speed (m/s)")
    ax.set_ylabel(ylabel)
    ax.set_title(f"{ylabel} vs speed, one line per runner")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out, dpi=150)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    args = parser.parse_args()

    table = load(args.folder)
    table.to_csv(args.folder / "all_treadmill.csv", index=False)
    print(f"합친 표: {len(table)}행, {table['subject_id'].nunique()}명")

    plot(table, "cadence_spm", "Cadence (spm)", args.folder / "speed_vs_cadence.png")
    plot(table, "stride_m", "Step length (m)", args.folder / "speed_vs_stride.png")

    for y in ("cadence_spm", "stride_m"):
        lines = per_person_lines(table, y)
        print(f"\n[{y}] 사람별 직선 {len(lines)}명")
        print(f"  절편 a: 평균 {lines['a'].mean():.2f}, 표준편차 {lines['a'].std():.2f}")
        print(f"  기울기 b: 평균 {lines['b'].mean():.2f}, 표준편차 {lines['b'].std():.2f}")
        print(f"  직선 적합도 R²: 중앙값 {lines['r2'].median():.3f}, 최소 {lines['r2'].min():.3f}")

    print("\n같은 속도에서 사람 간 케이던스 범위")
    print(table.groupby("speed_mps")["cadence_spm"].agg(["count", "min", "max"]).round(1))


if __name__ == "__main__":
    main()
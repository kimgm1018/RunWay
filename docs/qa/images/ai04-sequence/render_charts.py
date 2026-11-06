"""Render AI04 sequence charts into this folder. Source: .qa-local/418-ai04-sequence.json"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.lines import Line2D

ROOT = Path(__file__).resolve().parents[4]
SRC = ROOT / ".qa-local" / "418-ai04-sequence.json"
OUT = Path(__file__).resolve().parent

LEVEL_COLOR = {"OK": "#2e7d32", "CAUTION": "#ef6c00", "DANGER": "#c62828"}


def load_steps():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    steps = data["steps"]
    labels = [s["step"].replace("_", "\n") for s in steps]
    short = [f"S{i+1}" for i in range(len(steps))]
    guide = [s["input"]["guidePaceSecPerKm"] for s in steps]
    actual = [s["input"]["actualPaceSecPerKm"] for s in steps]
    rec = [float(s["recommendedPaceSecPerKm"]) for s in steps]
    hrs = []
    for s in steps:
        hr = s["input"]["hrBpm"]
        if isinstance(hr, (int, float)):
            hrs.append(float(hr))
        else:
            # "list(len=80, last=151.0)"
            hrs.append(151.0)
    levels = [s["coachingLevel"] for s in steps]
    actions = [s["action"] for s in steps]
    reasons = [s["reason"] for s in steps]
    cues = [s["cueBpm"] for s in steps]
    return {
        "passed": data["passed"],
        "short": short,
        "labels": labels,
        "guide": guide,
        "actual": actual,
        "rec": rec,
        "hr": hrs,
        "levels": levels,
        "actions": actions,
        "reasons": reasons,
        "cues": cues,
        "descs": [s["desc"] for s in steps],
    }


def style_axes(ax):
    ax.set_facecolor("#fafafa")
    ax.grid(True, axis="y", linestyle="--", alpha=0.45)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)


def chart_pace(d):
    fig, ax = plt.subplots(figsize=(11, 5.2), dpi=160)
    x = range(len(d["short"]))
    ax.plot(x, d["guide"], "o--", color="#546e7a", linewidth=2, markersize=7, label="입력 guide")
    ax.plot(x, d["actual"], "s--", color="#7e57c2", linewidth=2, markersize=7, label="입력 실측")
    ax.plot(x, d["rec"], "D-", color="#1565c0", linewidth=2.5, markersize=8, label="추천 pace")
    for i, (xv, yv, lv) in enumerate(zip(x, d["rec"], d["levels"])):
        ax.annotate(
            f"{yv:.0f}",
            (xv, yv),
            textcoords="offset points",
            xytext=(0, 10),
            ha="center",
            fontsize=9,
            color=LEVEL_COLOR.get(lv, "#333"),
            fontweight="bold",
        )
    ax.set_xticks(list(x), d["short"])
    ax.set_ylabel("페이스 (sec/km)  ↑느림")
    ax.set_xlabel("시퀀스 스텝")
    ax.set_title("AI04 시퀀스 — 가이드 / 실측 / 추천 페이스")
    ax.legend(loc="upper left")
    style_axes(ax)
    # invert not needed: larger sec/km = slower, natural for ease-off story
    fig.tight_layout()
    path = OUT / "01-pace-sequence.png"
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path


def chart_hr_level(d):
    fig, ax1 = plt.subplots(figsize=(11, 5.2), dpi=160)
    x = list(range(len(d["short"])))
    colors = [LEVEL_COLOR[lv] for lv in d["levels"]]
    bars = ax1.bar(x, d["hr"], color=colors, width=0.55, alpha=0.85, label="HR (bpm)")
    for bar, hr, lv in zip(bars, d["hr"], d["levels"]):
        ax1.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 1.5,
            f"{hr:.0f}\n{lv}",
            ha="center",
            va="bottom",
            fontsize=8,
            color=LEVEL_COLOR[lv],
            fontweight="bold",
        )
    ax1.set_ylabel("심박 (bpm)")
    ax1.set_xlabel("시퀀스 스텝")
    ax1.set_xticks(x, d["short"])
    ax1.set_ylim(120, 210)
    ax1.set_title("AI04 시퀀스 — 심박과 coachingLevel")
    style_axes(ax1)
    handles = [mpatches.Patch(color=c, label=l) for l, c in LEVEL_COLOR.items()]
    ax1.legend(handles=handles, loc="upper right", title="level")
    fig.tight_layout()
    path = OUT / "02-hr-coaching-level.png"
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path


def chart_storyboard(d):
    fig, ax = plt.subplots(figsize=(12, 6.2), dpi=160)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 7)
    ax.axis("off")
    ax.set_title("AI04 시퀀스 스토리보드 (PASS)", fontsize=14, pad=12)

    # flow arrow
    ax.annotate(
        "",
        xy=(11.2, 5.4),
        xytext=(0.8, 5.4),
        arrowprops=dict(arrowstyle="->", color="#90a4ae", lw=2),
    )

    boxes = [
        (1.0, "S1–S2\n안정", "guide/실측 ≈ 340\nHR 145→148\n→ 추천 340 OK", LEVEL_COLOR["OK"]),
        (4.0, "S3–S4\n위험", "HR 190→182\nEASE_OFF\n340→370→400", LEVEL_COLOR["DANGER"]),
        (7.0, "S5\n회복", "HR 150\n안내 400 유지\nlevel OK", LEVEL_COLOR["OK"]),
        (10.0, "S6\n과속", "실측 300 vs 340\nCAUTION\n추천 340 유지", LEVEL_COLOR["CAUTION"]),
    ]
    for cx, title, body, color in boxes:
        fancy = mpatches.FancyBboxPatch(
            (cx - 1.2, 3.2),
            2.4,
            2.6,
            boxstyle="round,pad=0.08,rounding_size=0.15",
            linewidth=1.5,
            edgecolor=color,
            facecolor="white",
        )
        ax.add_patch(fancy)
        ax.text(cx, 5.4, title, ha="center", va="center", fontsize=11, fontweight="bold", color=color)
        ax.text(cx, 4.15, body, ha="center", va="center", fontsize=8.5, color="#37474f")

    # concrete table-like footer
    rows = [
        "S1: 340→340 (OK)   S2: 340→340 (OK)   S3: 340→370 (DANGER)   S4: 370→400 (DANGER)",
        "S5: 400→400 (OK)   S6: 340→340 CAUTION+OVERPACE   판정 PASS · policy mpc-v0.4.3 · GRU db59d414",
    ]
    ax.text(6, 2.2, "구체 페이스 (sec/km)", ha="center", fontsize=10, fontweight="bold", color="#263238")
    ax.text(6, 1.4, rows[0], ha="center", fontsize=8.2, family="monospace", color="#455a64")
    ax.text(6, 0.8, rows[1], ha="center", fontsize=8.2, family="monospace", color="#455a64")

    path = OUT / "03-sequence-storyboard.png"
    fig.savefig(path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return path


def chart_combined(d):
    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(11, 7.5), dpi=160, sharex=True, gridspec_kw={"height_ratios": [1.35, 1]}
    )
    x = list(range(len(d["short"])))
    ax1.plot(x, d["guide"], "o--", color="#546e7a", lw=2, label="guide")
    ax1.plot(x, d["actual"], "s--", color="#7e57c2", lw=2, label="actual")
    ax1.plot(x, d["rec"], "D-", color="#1565c0", lw=2.5, label="recommended")
    for i, (yv, lv) in enumerate(zip(d["rec"], d["levels"])):
        ax1.scatter([i], [yv], s=80, zorder=5, color=LEVEL_COLOR[lv], edgecolors="white", linewidths=1)
        ax1.annotate(f"{yv:.0f}", (i, yv), textcoords="offset points", xytext=(0, 8), ha="center", fontsize=8)
    ax1.set_ylabel("pace sec/km")
    ax1.set_title("AI04 시퀀스 종합 — 페이스 + 심박/단계")
    ax1.legend(loc="upper left", ncol=3, fontsize=8)
    style_axes(ax1)

    colors = [LEVEL_COLOR[lv] for lv in d["levels"]]
    ax2.bar(x, d["hr"], color=colors, width=0.55, alpha=0.9)
    ax2.set_ylabel("HR bpm")
    ax2.set_xticks(x, [f"{s}\n{a}\n{r}" for s, a, r in zip(d["short"], d["actions"], d["reasons"])], fontsize=7.5)
    ax2.set_ylim(120, 205)
    style_axes(ax2)
    for i, (hr, cue) in enumerate(zip(d["hr"], d["cues"])):
        ax2.text(i, hr + 2, f"{hr:.0f}", ha="center", fontsize=8)
        ax2.text(i, 125, f"cue {cue}", ha="center", fontsize=7, color="#607d8b")

    fig.tight_layout()
    path = OUT / "00-overview.png"
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path


def write_index(paths):
    lines = [
        "# AI04 시퀀스 시각화 (418)",
        "",
        "원본 데이터: `.qa-local/418-ai04-sequence.json` (PASS, 2026-11-06).",
        "",
        "| 파일 | 내용 |",
        "| --- | --- |",
        "| `00-overview.png` | 페이스·심박 종합 |",
        "| `01-pace-sequence.png` | guide / 실측 / 추천 페이스 |",
        "| `02-hr-coaching-level.png` | 심박 + coachingLevel |",
        "| `03-sequence-storyboard.png` | 시나리오 스토리보드 + 구체 페이스 |",
        "",
        "재생성: `python render_charts.py` (repo 루트 기준 matplotlib 환경).",
        "",
    ]
    (OUT / "README.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    plt.rcParams["font.family"] = ["Malgun Gothic", "AppleGothic", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False
    d = load_steps()
    paths = [chart_combined(d), chart_pace(d), chart_hr_level(d), chart_storyboard(d)]
    write_index(paths)
    for p in paths:
        print(p)


if __name__ == "__main__":
    main()

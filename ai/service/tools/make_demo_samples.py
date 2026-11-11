"""시연 콘솔 재생 샘플(개인 AI04 + 그룹 AI10)을 현재 코드·정책으로 한 번에 만든다. 오프라인 리허설·대체 시연용.

- 개인: tools/offline_replay.build_recording → 실제 run_decide(AI04 공용 선택기, 현재 정책 후보) → build_trace
- 그룹: tools/offline_group_replay.build_group_recording → 실제 recommend_group_pace(AI10)
- 심박 예측은 체크포인트 없이 도는 합성 모형이고, 러닝 기록·코스도 합성이다. 기록 이름에 '합성'을 적는다.
- index.js에는 개인 샘플을 첫 번째(콘솔 기본 선택)로, 그룹 샘플을 두 번째로 쓴다. 다른 기록 파일은 뒤에 남긴다.
"""
import argparse
import csv
import json
import math
import re
import sys
import tempfile
from pathlib import Path

import numpy as np

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.config import load_settings
from app.models.base import ModelInfo
from tools.offline_group_replay import build_group_recording
from tools.offline_replay import build_recording

PERSONAL_ID = "personal_demo"
GROUP_ID = "group_demo"
SUBJECT = "synthetic-demo"


def _course_points(n: int = 240) -> list[dict]:
    """해운대 근처 합성 순환 코스(약 6 km). 1.6~2.4 km 구간에 오르막이 있다."""
    points = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        lon = 129.158 + 0.0105 * math.cos(a) + 0.003 * math.cos(3 * a)
        lat = 35.160 + 0.0068 * math.sin(a) + 0.0018 * math.sin(2 * a)
        elevation = 12 + 22 * math.exp(-((a - 2.2) / 0.45) ** 2) + 3 * math.sin(4 * a)
        points.append({"lon": round(lon, 6), "lat": round(lat, 6), "elevationM": round(elevation, 1)})
    return points


class _Course:
    def __init__(self, points):
        self.points = points
        self.dist = [0.0]
        for p, q in zip(points, points[1:]):
            dx = (q["lon"] - p["lon"]) * 91_000
            dy = (q["lat"] - p["lat"]) * 111_000
            self.dist.append(self.dist[-1] + math.hypot(dx, dy))

    def elevation(self, d: float) -> float:
        d = d % self.dist[-1]
        for i in range(1, len(self.dist)):
            if self.dist[i] >= d:
                f = (d - self.dist[i - 1]) / max(1e-6, self.dist[i] - self.dist[i - 1])
                return self.points[i - 1]["elevationM"] + f * (self.points[i]["elevationM"] - self.points[i - 1]["elevationM"])
        return self.points[-1]["elevationM"]

    def grade(self, d: float) -> float:
        return (self.elevation(d + 25) - self.elevation(d - 25)) / 50 * 100


def _runner_target(pace: float, grade: float) -> float:
    """합성 러너의 정상 심박: 빠를수록, 오르막일수록 높다."""
    return 127 + (420 - pace) * 0.45 + max(-2.0, grade) * 3.0


class SyntheticPersonalModel:
    """마지막 심박에서 후보 pace·경사의 정상 심박으로 다가가는 합성 예측(30·60·120초). 실제 GRU가 아니다."""
    info = ModelInfo("gru", "synthetic-personal-demo", 360, 1)

    def predict(self, batch):
        hr = batch["hr"]
        rows = []
        for i in range(len(hr)):
            last = float(hr[i][~np.isnan(hr[i])][-1])
            pace = 1000.0 / float(np.nanmean(batch["future_speed"][i]))
            grade = float(np.nanmean(batch["future_grade"][i])) if "future_grade" in batch else 0.0
            target = _runner_target(pace, 0.0 if math.isnan(grade) else grade)
            rows.append([last + (target - last) * f for f in (0.3, 0.55, 0.82)])
        return np.asarray(rows)


def _write_personal_run(dir_path: Path, course: _Course, minutes: float) -> tuple[Path, Path]:
    """합성 개인 러닝: 6'15" 출발 → 3분부터 6'00" → 오르막에서 심박 상승. 5초 칸."""
    rows, hr, dist = [], 138.0, 0.0
    for t in range(0, int(minutes * 60) + 1, 5):
        pace = 375.0 if t < 180 else 360.0
        grade = course.grade(dist)
        pace += max(0.0, grade) * 6                       # 오르막에서는 조금 느려진다
        hr += (_runner_target(pace, grade) - hr) * 0.07
        speed = 1000.0 / pace
        rows.append({"session_id": "s1", "subject_group_id": SUBJECT, "elapsed_s": t,
                     "hr_bpm": round(hr, 1), "speed_mps": round(speed, 3), "grade_pct": round(grade, 2),
                     "cumulative_distance_m": round(dist, 1)})
        dist += speed * 5
    csv_path = dir_path / "personal_run.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    split_path = dir_path / "split.json"
    split_path.write_text(json.dumps({"train": [], "val": [SUBJECT]}), encoding="utf-8")
    return csv_path, split_path


def _write_index(out_dir: Path, first: list[str]):
    index_path = out_dir / "index.js"
    names = []
    if index_path.exists():
        match = re.search(r"window\.RunwayDemoRecordingFiles\s*=\s*(\[[\s\S]*?\])", index_path.read_text(encoding="utf-8"))
        if match:
            names = [n for n in json.loads(match.group(1)) if isinstance(n, str)]
    ordered = first + [n for n in names if n not in first]
    index_path.write_text("window.RunwayDemoRecordingFiles = " + json.dumps(ordered, indent=2) + ";\n", encoding="utf-8")


def make_samples(out_dir: Path, *, minutes: float = 12.0, settings=None) -> dict:
    settings = settings or load_settings()
    out_dir = Path(out_dir)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        points = _course_points()
        course_file = tmp_path / "course.json"
        course_file.write_text(json.dumps({"points": points}), encoding="utf-8")
        csv_path, split_path = _write_personal_run(tmp_path, _Course(points), minutes)
        personal = build_recording(
            file=csv_path, split_file=split_path, split="val", recording_id=PERSONAL_ID,
            label="개인 러닝 리허설(합성 심박)", model_label="합성 예측(체크포인트 없음)",
            margin_table=settings.margin_table_path, goal_distance_m=5000, goal_duration_sec=1800,
            hr_reference={"hrMaxBpm": None, "rhrBpm": 60, "ageYears": 28, "recentPeakHrBpm": 186.0, "recentRunCount": 8},
            out_dir=out_dir, model=SyntheticPersonalModel(), course_file=course_file, settings=settings)
        group = build_group_recording(recording_id=GROUP_ID, label="그룹 러닝 리허설(합성 심박)", out_dir=out_dir,
                                      course_file=course_file)
    _write_index(out_dir, [PERSONAL_ID + ".js", GROUP_ID + ".js"])
    return {"personal": personal, "group": group}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=SERVICE_DIR / "app" / "static" / "demo" / "recordings")
    parser.add_argument("--minutes", type=float, default=12.0)
    args = parser.parse_args(argv)
    try:
        result = make_samples(args.out_dir, minutes=args.minutes)
    except (OSError, ValueError) as exc:
        print(f"시연 샘플 만들기 실패: {exc}", file=sys.stderr)
        return 1
    for key, rec in result.items():
        first = rec["traces"][0]
        count = len(first.get("candidates") or first.get("group", {}).get("candidates") or [])
        print(f"{key}: {rec['id']}.js 판단 {len(rec['traces'])}개, 정책 {rec['policyVersion']}, 후보 {count}개")
    print(f"index.js: {args.out_dir / 'index.js'} (개인 샘플이 기본 선택)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

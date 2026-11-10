"""그룹 러닝(AI10) 시연 재생 기록을 만든다. 오프라인 리허설용.

실제 AI10 선택 코드(recommend_group_pace)와 실제 정책·여유 표를 그대로 쓰고, 심박만 합성 러너 모형으로 만든다.
이야기: 출발(목표보다 느린 출발 추천) → 심박 여유가 있어 가속 → 목표 pace에서 유지 → 한 러너의 심박이 올라 감속.
GRU 체크포인트가 없어도 돈다(--model gru를 주면 실제 GRU로 예측한다). 결과는 합성 데이터임을 label에 적는다.
"""
import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.config import load_settings
from app.demo.course import load_course
from app.demo.group_trace import build_group_trace
from app.group_pace.schemas import GroupPaceRequest
from app.group_pace.service import recommend_group_pace
from app.models.base import ModelInfo
from app.policy import build_policy

CELL_SEC = 5
CALL_EVERY_SEC = 30


class Runner:
    """합성 러너: 심박은 pace에 따라 정해진 목표 심박으로 천천히 다가간다."""

    def __init__(self, rest_hr: float, gain: float, surge_at: float | None = None, surge_per_min: float = 0.0,
                 surge_max: float = 0.0):
        self.rest_hr, self.gain = rest_hr, gain
        self.surge_at, self.surge_per_min, self.surge_max = surge_at, surge_per_min, surge_max
        self.hr = rest_hr + 15.0

    def target(self, pace: float, t: float) -> float:
        surge = 0.0
        if self.surge_at is not None and t > self.surge_at:
            surge = min(self.surge_max, (t - self.surge_at) / 60.0 * self.surge_per_min)
        return self.rest_hr + (420.0 - pace) * self.gain + surge

    def step(self, pace: float, t: float) -> float:
        self.hr += (self.target(pace, t) - self.hr) * 0.08
        return self.hr


class SyntheticModel:
    """합성 러너 모형으로 30·60·120초 뒤 심박을 낸다. 실제 GRU가 아니다."""
    info = ModelInfo("gru", "synthetic-group-demo", 360, 1)

    def __init__(self):
        self.calls = []        # 요청 순서대로 (runner, t)

    def bind(self, runners, t):
        self.calls = [(r, t) for r in runners]

    def predict(self, batch):
        rows = []
        n_cand = len(batch["future_speed"]) // max(1, len(self.calls))
        for i, (speed, hr) in enumerate(zip(batch["future_speed"], batch["hr"])):
            runner, t = self.calls[min(len(self.calls) - 1, i // max(1, n_cand))]
            pace = 1000.0 / float(np.mean(speed))
            last = float(hr[~np.isnan(hr)][-1])
            target = runner.target(pace, t + 120)
            rows.append([last + (target - last) * f for f in (0.33, 0.6, 0.86)])
        return np.asarray(rows)


def _write_index(out_dir: Path, recording_id: str):
    index_path = out_dir / "index.js"
    names = []
    if index_path.exists():
        match = re.search(r"window\.RunwayDemoRecordingFiles\s*=\s*(\[[\s\S]*?\])", index_path.read_text(encoding="utf-8"))
        if match:
            names = [n for n in json.loads(match.group(1)) if isinstance(n, str)]
    if recording_id + ".js" not in names:
        names.append(recording_id + ".js")
    index_path.write_text("window.RunwayDemoRecordingFiles = " + json.dumps(names, indent=2) + ";\n", encoding="utf-8")


def build_group_recording(*, recording_id: str, label: str, out_dir: Path, minutes: float = 12.0,
                          start_pace: float = 370.0, goal_pace: float = 350.0, policy=None, model=None,
                          course_file: Path | None = None, group_run_id: int = 900001) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", recording_id):
        raise ValueError("id는 영문, 숫자, 밑줄, 하이픈만 쓸 수 있습니다")
    if policy is None:
        settings = load_settings()
        policy = build_policy(settings.margin_table_path, "gru")
    synthetic = model is None
    model = model or SyntheticModel()
    runners = [Runner(118, 0.42), Runner(124, 0.40), Runner(121, 0.41, surge_at=7.0 * 60, surge_per_min=8.0, surge_max=13.0)]
    t0 = datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc)
    pace = start_pace
    histories = [{"hrBpm": [], "speedMps": [], "gradePct": []} for _ in runners]
    last_change = None
    traces = []
    total = int(minutes * 60)
    for t in range(0, total + 1, CELL_SEC):
        for runner, h in zip(runners, histories):
            h["hrBpm"].append(round(runner.step(pace, t), 1))
            h["speedMps"].append(round(1000.0 / pace, 3))
            h["gradePct"].append(0.0)
        if t < 60 or t % CALL_EVERY_SEC:
            continue
        now = t0 + timedelta(seconds=t)
        body = GroupPaceRequest.model_validate({
            "groupRunId": group_run_id, "currentGroupPaceSecPerKm": pace, "goalPaceSecPerKm": goal_pace,
            "startRecommendedPaceSecPerKm": start_pace, "elapsedSec": t, "progressRatio": None,
            "now": now.isoformat(), "lastChange": last_change,
            "participants": [{"userId": i + 1, "active": True,
                              "history": {k: v[-72:] for k, v in h.items()}, "futureGradePct": [0.0] * 24}
                             for i, h in enumerate(histories)]})
        if synthetic:
            model.bind(runners, t)
        detail = {}
        response = recommend_group_pace(body, model, policy, hr_threshold_lookup_configured=False, detail=detail)
        trace = build_group_trace(body, response, detail, boot_id="offline-" + recording_id, seq=len(traces) + 1,
                                  stage="L3", label=label, policy_version=policy.policy_version,
                                  decided_at=now, decide_ms=None)
        traces.append(trace)
        if response.changed:
            last_change = {"direction": response.direction, "changedAt": now.isoformat()}
            pace = response.group_pace_sec_per_km
    course = load_course(Path(course_file)).summary() if course_file else None
    recording = {"id": recording_id, "label": label, "modelLabel": model.info.model_version,
                 "modelVersion": model.info.model_version, "policyVersion": policy.policy_version,
                 "snapshot": {"stage": "L3", "label": label, "course": course}, "traces": traces}
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    text = json.dumps(recording, ensure_ascii=False, separators=(",", ":"))
    (out_dir / f"{recording_id}.json").write_text(text, encoding="utf-8")
    (out_dir / f"{recording_id}.js").write_text("window.RunwayDemoRecordings.push(" + text + ");\n", encoding="utf-8")
    _write_index(out_dir, recording_id)
    return recording


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", default="group_demo")
    parser.add_argument("--label", default="그룹 러닝 리허설(합성 심박)")
    parser.add_argument("--out-dir", type=Path, default=SERVICE_DIR / "app" / "static" / "demo" / "recordings")
    parser.add_argument("--minutes", type=float, default=12.0)
    parser.add_argument("--start-pace", type=float, default=370.0, help="출발 추천 공동 pace(초/km)")
    parser.add_argument("--goal-pace", type=float, default=350.0, help="목표 pace(초/km)")
    parser.add_argument("--course-file", type=Path)
    args = parser.parse_args(argv)
    try:
        rec = build_group_recording(recording_id=args.id, label=args.label, out_dir=args.out_dir, minutes=args.minutes,
                                    start_pace=args.start_pace, goal_pace=args.goal_pace, course_file=args.course_file)
    except (OSError, ValueError) as exc:
        print(f"그룹 재생 기록 만들기 실패: {exc}", file=sys.stderr)
        return 1
    codes = [t["decision"]["reasonCode"] for t in rec["traces"]]
    print(f"그룹 재생 기록: {args.out_dir / (args.id + '.js')} (판단 {len(codes)}개)")
    print(" → ".join(f"{t['elapsedSec']:.0f}s {c}" for t, c in zip(rec["traces"], codes) if c != "HOLD"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

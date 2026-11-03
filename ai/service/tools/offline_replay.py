"""FitRec Val 러닝을 HTTP 없이 MPC 판단 기록으로 만들어 화면 재생 파일로 저장한다."""
import argparse
import json
import os
import re
import sys
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.config import load_settings
from app.decide.service import run_decide
from app.demo.inlet import GuideState, build_inlet_request
from app.demo.samples import Insufficient, SessionSamples
from app.demo.trace import build_trace
from app.demo.w07 import MetricSample
from app.models import load_model
from app.policy import build_policy
from app.demo.course import load_course
from tools.replay_sources import read_fitrec_csv

SESSION_ID = 900000001


def _load_split_rows(file: Path, split_file: Path, split: str, max_minutes: float | None):
    rows = read_fitrec_csv(file, split_file=split_file, split=split)
    if not rows:
        raise ValueError("CSV에 재생할 행이 없습니다")
    if max_minutes is not None:
        if max_minutes <= 0:
            raise ValueError("max-minutes는 0보다 커야 합니다")
        first = min(row.elapsed_sec for row in rows)
        limit = first + max_minutes * 60
        rows = [row for row in rows if row.elapsed_sec <= limit]
    if not rows:
        raise ValueError("선택한 재생 구간에 행이 없습니다")
    return rows


def _profile(goal_distance_m, goal_duration_sec, hr_reference, course):
    reference = dict(hr_reference or {})
    reference.setdefault("hrMaxBpm", None)
    reference.setdefault("rhrBpm", None)
    reference.setdefault("ageYears", 30)
    reference.setdefault("recentPeakHrBpm", None)
    reference.setdefault("recentRunCount", None)
    goal = {"targetDistanceM": goal_distance_m, "targetDurationSec": goal_duration_sec,
            "targetPaceSecPerKm": None}
    return SimpleNamespace(label="오프라인 재생", course=course, mode="COURSE", goal=goal,
                           goal_preference=0.5, plan=None, hr_reference=reference)


def _write_index(out_dir: Path, recording_id: str):
    index_path = out_dir / "index.js"
    filenames = []
    if index_path.exists():
        content = index_path.read_text(encoding="utf-8")
        match = re.search(r"window\.RunwayDemoRecordingFiles\s*=\s*(\[[\s\S]*?\])\s*;?", content)
        if match:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, list):
                filenames = [str(name) for name in parsed if isinstance(name, str)]
    filename = recording_id + ".js"
    if filename not in filenames:
        filenames.append(filename)
    index_path.write_text("window.RunwayDemoRecordingFiles = " +
                          json.dumps(filenames, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")


def build_recording(*, file: Path, split_file: Path, split: str, recording_id: str,
                    label: str, model_label: str, margin_table: Path, goal_distance_m: float,
                    hr_reference: dict, out_dir: Path, model=None, course_file: Path | None = None,
                    goal_duration_sec: float | None = None, max_minutes: float | None = None,
                    settings=None) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", recording_id):
        raise ValueError("id는 영문, 숫자, 밑줄, 하이픈만 쓸 수 있습니다")
    rows = _load_split_rows(Path(file), Path(split_file), split, max_minutes)
    settings = settings or load_settings()
    settings = replace(settings, margin_table_path=Path(margin_table))
    model = model or load_model(settings)
    policy = build_policy(settings.margin_table_path, settings.model_type)
    course = load_course(Path(course_file)) if course_file else None
    profile = _profile(goal_distance_m, goal_duration_sec, hr_reference, course)

    first_elapsed = min(row.elapsed_sec for row in rows)
    last_elapsed = max(row.elapsed_sec for row in rows)
    base_time = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(seconds=last_elapsed - first_elapsed)
    grouped: dict[int, list] = {}
    for row in rows:
        grouped.setdefault((row.elapsed_sec - first_elapsed) // 5, []).append(row)

    samples = SessionSamples()
    guide = GuideState()
    traces: list[dict] = []
    boot_id = "offline-" + recording_id
    window_cells = model.info.window_sec // 5 + 12
    for _, grouped_rows in sorted(grouped.items()):
        metric_items = []
        for row in grouped_rows:
            if all(value is None for value in (row.hr_bpm, row.speed_mps, row.total_distance_m, row.grade_pct)):
                continue
            measured_at = base_time + timedelta(seconds=row.elapsed_sec - first_elapsed)
            metric_items.append(MetricSample(
                type="METRIC_SAMPLE", measuredAt=measured_at, elapsedDurationSec=row.elapsed_sec,
                heartRateBpm=row.hr_bpm, cadenceSpm=row.cadence_spm, speedMps=row.speed_mps,
                gradePercent=row.grade_pct, totalDistanceM=row.total_distance_m,
                routeProgressM=row.total_distance_m, isHrMeasured=row.hr_bpm is not None))
        samples.add(metric_items)
        inputs = samples.build_inputs(n_cells=window_cells, course=course)
        if isinstance(inputs, Insufficient):
            continue
        body = build_inlet_request(SESSION_ID, profile, inputs, guide, follows_guide=False)   # 재생 러너는 안내를 받지 않는다
        if body is None:
            continue
        outcome = run_decide(body, model, policy, received_at=inputs.data_now, now=lambda: inputs.data_now)
        trace = build_trace(outcome, boot_id=boot_id, seq=len(traces) + 1, stage="L3", replay_speed=1,
                            grade_source=inputs.grade_source, previous=traces)
        traces.append(trace)
        response = outcome.response
        if (response and response.publish_suggested and response.decision
                and response.decision.recommended_pace_sec_per_km is not None):
            guide.pace_sec_per_km = response.decision.recommended_pace_sec_per_km
            guide.set_at = outcome.decided_at

    if not traces:
        raise ValueError("입력 조건을 만족해 생성된 판단 기록이 없습니다")
    distance_values = [row.total_distance_m for row in rows if row.total_distance_m is not None]
    course_summary = course.summary() if course else None
    recording = {
        "id": recording_id,
        "label": label,
        "modelLabel": model_label,
        "modelVersion": model.info.model_version,
        "policyVersion": policy.policy_version,
        "marginTableVersion": policy.margin_table_version,
        "session": {"source": "FitRec " + split, "sessionId": SESSION_ID,
                    "durationSec": max(0, last_elapsed - first_elapsed),
                    "distanceM": max(distance_values) if distance_values else None},
        "snapshot": {"stage": "L3", "label": label, "course": course_summary},
        "traces": traces,
    }
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_text = json.dumps(recording, ensure_ascii=False, indent=2) + "\n"
    (out_dir / (recording_id + ".json")).write_text(json_text, encoding="utf-8")
    (out_dir / (recording_id + ".js")).write_text(
        "window.RunwayDemoRecordings.push(" + json.dumps(recording, ensure_ascii=False, separators=(",", ":")) + ");\n",
        encoding="utf-8")
    _write_index(out_dir, recording_id)
    return recording


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--split-file", required=True, type=Path)
    parser.add_argument("--split", required=True, choices=("train", "val"))
    parser.add_argument("--id", required=True, dest="recording_id")
    parser.add_argument("--label", required=True)
    parser.add_argument("--model-label", required=True)
    parser.add_argument("--margin-table", required=True, type=Path)
    parser.add_argument("--course-file", type=Path)
    parser.add_argument("--goal-distance-m", type=float, required=True)
    parser.add_argument("--goal-duration-sec", type=float)
    parser.add_argument("--hr-max-bpm", type=float)
    parser.add_argument("--rhr-bpm", type=float)
    parser.add_argument("--age-years", type=float, default=30)
    parser.add_argument("--recent-peak-hr-bpm", type=float)
    parser.add_argument("--recent-run-count", type=int)
    parser.add_argument("--max-minutes", type=float)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        settings = load_settings()
        recording = build_recording(
            file=args.file, split_file=args.split_file, split=args.split, recording_id=args.recording_id,
            label=args.label, model_label=args.model_label, margin_table=args.margin_table,
            goal_distance_m=args.goal_distance_m, goal_duration_sec=args.goal_duration_sec,
            hr_reference={"hrMaxBpm": args.hr_max_bpm, "rhrBpm": args.rhr_bpm,
                          "ageYears": args.age_years, "recentPeakHrBpm": args.recent_peak_hr_bpm,
                          "recentRunCount": args.recent_run_count},
            course_file=args.course_file, max_minutes=args.max_minutes, out_dir=args.out_dir, settings=settings)
    except Exception as exc:
        print(f"오프라인 재생 기록 생성 실패: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(f"기록 생성: {args.out_dir / (args.recording_id + '.js')} ({len(recording['traces'])}개 판단)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""큐(BPM)를 켜고 뛴 실제 워치 기록을 5초 간격으로 AI04(run_decide)에 다시 넣어 목표 BPM(cueBpm)을 확인한다.

S15P31E105-456. 서비스와 같은 GRU 모델·MPC 정책·BPM 계산기·DB 기록 조회(CachedDbBpmLookup)를 쓴다.
DB만 메모리 표(tools/memory_bpm_db.py)로 바꾸고, 워치 기록을 DB에 쌓인 것처럼 넣는다.
  - 학습 기록: --split-date 전에 시작한 러닝. 완료 러닝으로 DB에 넣어 지난 기록으로 쓴다.
  - 확인 기록: --split-date 이후 러닝. 진행 중 세션으로 넣고 5초마다 그 시각까지의 측정만 보이게 한다.
  - BPM 변경은 적용된 SET_BPM으로 넣는다. 처음 튼 BPM은 실제 DB처럼 지난 러닝에는 남기지 않는다.
  - 워치 기록에는 경사가 없어 평지(0%)로 넣는다. 러너는 AI04 안내를 받지 않았으므로 기준 페이스는 실제 60초 페이스다.

재는 것(판단마다):
  1. 목표 BPM − 실제 케이던스(최근 20초 평균, spm)
  2. 그 BPM대로 뛰면 예상되는 페이스 − AI04 추천 페이스(초/km). 같은 보정 기록으로 BPM → 속도를 거꾸로 푼다
  3. 5초마다 BPM이 바뀌는 횟수, 그중 1~2만 바뀌는 횟수, 바로 되돌아가는(A→B→A) 횟수

개인 건강 데이터는 저장소 밖에서 읽고 결과 CSV도 저장소 밖(--out)에 쓴다. 출력에는 날짜를 남기지 않는다.

사용법 (ai/service에서):
    python tools/replay_cue_bpm.py --user <워치 JSON 폴더> <참가자 ID> --split-date YYYY-MM-DD
        [--new-user <워치 JSON 폴더> <참가자 ID>] [--exclude-date YYYY-MM-DD ...] --out <저장소 밖 CSV>
"""
import argparse
import json
import os
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.bpm_cue import CueBpmCalculator  # noqa: E402
from app.bpm_lookup import CachedDbBpmLookup  # noqa: E402
from app.demo.inlet import GuideState, build_inlet_request  # noqa: E402
from app.demo.samples import Insufficient, SessionSamples  # noqa: E402
from app.demo.w07 import MetricSample  # noqa: E402
from app.decide.service import run_decide  # noqa: E402
from tools.memory_bpm_db import MemoryBpmDb  # noqa: E402

STEP_SEC = 5
CADENCE_LOOKBACK_SEC = 20
FOLLOW_SPM = 5


def read_json(path: Path) -> dict:
    """워치 앱 내보내기는 UTF-8 또는 UTF-16(BOM)으로 저장된다."""
    raw = path.read_bytes()
    encoding = "utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig"
    return json.loads(raw.decode(encoding))


@dataclass
class Second:
    hr: float | None = None
    speed: float | None = None
    cadence: float | None = None
    cue: float | None = None


@dataclass
class WatchRun:
    started_at: datetime
    seconds: dict[int, Second]

    @property
    def last_sec(self) -> int:
        return max(self.seconds)

    def cue_at(self, sec: int) -> float | None:
        known = [s for s in self.seconds if s <= sec and self.seconds[s].cue is not None]
        return self.seconds[max(known)].cue if known else None


def load_runs(folder: Path, participant: str, exclude_dates=()) -> list[WatchRun]:
    runs = []
    for path in sorted(folder.glob("*.json")):
        data = read_json(path)
        if data.get("participantId") != participant or data["startedAt"][:10] in exclude_dates:
            continue
        seconds: dict[int, Second] = {}
        for s in data["samples"]:
            key = {"HEART_RATE": "hr", "SPEED": "speed", "CADENCE": "cadence"}.get(s.get("metric"))
            if key is None or s.get("sessionElapsedMs") is None or s.get("value") is None:
                continue
            row = seconds.setdefault(int(s["sessionElapsedMs"]) // 1000, Second())
            setattr(row, key, float(s["value"]))
            if s.get("targetBpmAtEnd") is not None:
                row.cue = float(s["targetBpmAtEnd"])
        if seconds:
            runs.append(WatchRun(datetime.fromisoformat(data["startedAt"].replace("Z", "+00:00")), seconds))
    return sorted(runs, key=lambda r: r.started_at)


def add_to_db(db: MemoryBpmDb, run: WatchRun, session_id: int, user_id: int, *, completed: bool) -> None:
    db.sessions.append({
        "id": session_id, "user_id": user_id, "status": "COMPLETED" if completed else "RUNNING",
        "deleted_at": None, "ended_at": run.started_at + timedelta(seconds=run.last_sec) if completed else None,
        # 진행 중 세션: 그 시각에 켜져 있던 BPM(바꾼 적이 없으면 처음 튼 BPM)
        "current_bpm": None if completed else (lambda until: run.cue_at(int((until - run.started_at).total_seconds()))),
    })
    previous = None
    for sec in sorted(run.seconds):
        row, at = run.seconds[sec], run.started_at + timedelta(seconds=sec)
        if row.speed is not None or row.cadence is not None:
            db.samples.append({"session_id": session_id, "elapsed": sec, "at": at,
                               "speed": row.speed, "cadence": row.cadence})
        if row.cue is not None and previous is not None and row.cue != previous:
            db.events.append({"session_id": session_id, "action": "SET_BPM", "result": "APPLIED",
                              "target_bpm": row.cue, "applied_at": at})
        if row.cue is not None:
            previous = row.cue


@dataclass
class Profile:
    goal: dict
    mode: str = "FREE"
    goal_preference: float = 0.5
    plan: list | None = None
    hr_reference: dict | None = None
    course: object | None = None


def offset_used(calc: CueBpmCalculator, bpm_input, pace: float):
    """BpmCalculator.compute와 같은 경로로 그때 쓴 보폭 보정값을 되짚는다(평균 직선이면 None)."""
    tb = calc._tb
    import stride_model   # BPM_SRC_DIR(ai/bpm)은 계산기가 sys.path에 넣었다
    past = [tb.Window(r.run_no, r.speed_mps, r.cadence_spm, r.cue_bpm) for r in (bpm_input.records if bpm_input else [])]
    records = tb.select_records(past)
    if records:
        sp = [s for s, _ in records]
        return stride_model.personal_offset(calc.prior, sp, [60 * s / c for s, c in records])
    first = bpm_input.first_minute if bpm_input else None
    if first is None:
        return None
    base = tb.target_bpm(pace, calc.prior).bpm
    window = tb.Window(0, first.speed_mps, first.cadence_spm, first.cue_bpm)
    if tb.first_minute_bpm(base, pace, window, [], calc.prior) is None:
        return None
    return stride_model.personal_offset(calc.prior, [first.speed_mps], [60 * first.speed_mps / first.cadence_spm])


def pace_at_bpm(prior, bpm: float, offset) -> float:
    """BPM으로 딱 맞춰 뛸 때의 페이스: 60·v = BPM·(A + B·(v − v_ref))를 v에 대해 푼다(ai/bpm/evaluate_cued.py)."""
    a, b = prior.mu if offset is None else prior.mu + offset
    speed = bpm * (a - b * prior.v_ref) / (60 - bpm * b)
    return 1000.0 / speed


def replay_run(run: WatchRun, *, session_id: int, db: MemoryBpmDb, model, policy, calc, label: str) -> list[dict]:
    lookup = CachedDbBpmLookup(db)
    moving = [r.speed for r in run.seconds.values() if r.speed is not None and r.speed >= 1.5]
    profile = Profile(goal={"targetDistanceM": None, "targetDurationSec": None,
                            "targetPaceSecPerKm": round(1000.0 / statistics.fmean(moving), 1)})
    samples, guide, rows = SessionSamples(), GuideState(), []
    n_cells = model.info.window_sec // STEP_SEC + 12
    fed = -1
    for t in range(STEP_SEC, run.last_sec + 1, STEP_SEC):
        items = []
        for sec in range(fed + 1, t + 1):
            row = run.seconds.get(sec)
            if row is None or (row.hr is None and row.speed is None):
                continue
            items.append(MetricSample(type="METRIC_SAMPLE", measuredAt=run.started_at + timedelta(seconds=sec),
                                      elapsedDurationSec=sec, heartRateBpm=row.hr if row.hr and row.hr > 0 else None,
                                      cadenceSpm=row.cadence, speedMps=row.speed, gradePercent=0.0,
                                      totalDistanceM=None, routeProgressM=None,
                                      isHrMeasured=bool(row.hr and row.hr > 0)))
        fed = t
        samples.add(items)
        inputs = samples.build_inputs(n_cells=n_cells, course=None)
        if isinstance(inputs, Insufficient):
            continue
        body = build_inlet_request(session_id, profile, inputs, guide, follows_guide=False)
        if body is None:
            continue
        db.until = run.started_at + timedelta(seconds=t)
        now = inputs.data_now
        outcome = run_decide(body, model, policy, received_at=now, now=lambda: now,
                             cue_bpm_calc=calc, bpm_lookup=lookup)
        decision = outcome.response.decision if outcome.response else None
        recent = [run.seconds[s] for s in range(t - CADENCE_LOOKBACK_SEC + 1, t + 1)
                  if s in run.seconds and run.seconds[s].cadence is not None and run.seconds[s].speed is not None
                  and run.seconds[s].speed >= 1.5 and 120 <= run.seconds[s].cadence <= 230]
        out = {"group": label, "session": session_id, "t_sec": t, "status": outcome.status,
               "action": decision.action if decision else None, "reason": decision.reason if decision else None,
               "recommended_pace": decision.recommended_pace_sec_per_km if decision else None,
               "cue_bpm": decision.cue_bpm if decision else None,
               "watch_bpm": run.cue_at(t), "actual_pace_60s": inputs.actual_pace_60s_sec_per_km,
               "actual_cadence_20s": statistics.fmean([r.cadence for r in recent]) if recent else None,
               "warnings": ";".join(outcome.response.warnings) if outcome.response else ""}
        if decision is not None and decision.cue_bpm is not None:
            bpm_input = lookup.get_for_session(session_id).bpm_input
            offset = offset_used(calc, bpm_input, decision.recommended_pace_sec_per_km)
            out["pace_at_cue_bpm"] = pace_at_bpm(calc.prior, decision.cue_bpm, offset)
            out["source"] = ("records" if bpm_input and bpm_input.records else
                             "first_minute" if offset is not None else "population")
        rows.append(out)
    return rows


def summarize(rows: list[dict]) -> dict:
    with_bpm = [r for r in rows if r.get("cue_bpm") is not None]
    running = [r for r in with_bpm if r["actual_cadence_20s"] is not None]
    followed = [r for r in running if r["watch_bpm"] is not None and abs(r["actual_cadence_20s"] - r["watch_bpm"]) <= FOLLOW_SPM]
    cad_err = [r["cue_bpm"] - r["actual_cadence_20s"] for r in running]
    fol_err = [r["cue_bpm"] - r["actual_cadence_20s"] for r in followed]
    pace_gap = [r["pace_at_cue_bpm"] - r["recommended_pace"] for r in with_bpm]
    cues = [r["cue_bpm"] for r in with_bpm]
    changes = [b - a for a, b in zip(cues, cues[1:]) if b != a]
    reversals = sum(1 for a, b, c in zip(cues, cues[1:], cues[2:]) if a == c != b)
    minutes = len(with_bpm) * STEP_SEC / 60

    def mae(values):
        return round(statistics.fmean(abs(v) for v in values), 2) if values else None

    return {
        "decisions": len(rows), "with_bpm": len(with_bpm), "minutes": round(minutes, 1),
        "sources": {s: sum(1 for r in with_bpm if r.get("source") == s) for s in ("records", "first_minute", "population")},
        "bpm_minus_cadence_mae": mae(cad_err), "bpm_minus_cadence_bias": round(statistics.fmean(cad_err), 2) if cad_err else None,
        "bpm_within5": round(sum(abs(v) <= 5 for v in cad_err) / len(cad_err), 2) if cad_err else None,
        "followed_windows": len(followed), "followed_mae": mae(fol_err),
        "pace_at_bpm_minus_recommended_mae": mae(pace_gap),
        "pace_gap_max": round(max((abs(v) for v in pace_gap), default=0), 1),
        "bpm_changes": len(changes), "small_changes_1_2": sum(1 for d in changes if abs(d) <= 2),
        "reversals_a_b_a": reversals,
        "changes_per_10min": round(len(changes) / minutes * 10, 1) if minutes else None,
        "bpm_range": (min(cues), max(cues)) if cues else None,
        "warnings": sorted({w for r in rows for w in r["warnings"].split(";") if w}),
    }


def gru_sha_from_manifest() -> str | None:
    manifest = SERVICE_DIR.parents[1] / "infra" / "ai" / "models.json"
    try:
        files = json.loads(manifest.read_text(encoding="utf-8"))["files"]
        return next(f["sha256"] for f in files if f["name"] == "gru_final.pt")
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", nargs=2, required=True, metavar=("WATCH_FOLDER", "PARTICIPANT"),
                        help="기록이 쌓이는 사용자. --split-date 전 러닝은 지난 기록, 이후 러닝은 확인 기록")
    parser.add_argument("--split-date", required=True, help="YYYY-MM-DD(UTC). 이 날짜부터 시작한 러닝을 확인 기록으로 쓴다")
    parser.add_argument("--new-user", nargs=2, action="append", default=[], metavar=("WATCH_FOLDER", "PARTICIPANT"),
                        help="지난 기록 없는 사용자. 모든 러닝을 확인 기록으로 쓴다(여러 번 가능)")
    parser.add_argument("--exclude-date", nargs="*", default=[], help="뺄 러닝의 시작 날짜(UTC, 다른 사람이 뛴 기록 등)")
    parser.add_argument("--out", type=Path, required=True, help="판단별 결과 CSV(저장소 밖)")
    args = parser.parse_args()

    if args.out.resolve().is_relative_to(SERVICE_DIR.parents[1]):
        parser.error("--out은 저장소 밖이어야 합니다(개인 건강 데이터 결과)")
    if not os.getenv("HR_MODEL_SHA256") and gru_sha_from_manifest():
        os.environ["HR_MODEL_SHA256"] = gru_sha_from_manifest()   # 서비스와 같은 GRU인지 시작할 때 확인
    from app.main import default_loader, default_policy_loader
    model, policy, calc = default_loader(), default_policy_loader(), CueBpmCalculator()

    db, groups, session_id = MemoryBpmDb(), [], 1000
    runs = load_runs(Path(args.user[0]), args.user[1], set(args.exclude_date))
    train = [r for r in runs if r.started_at.date().isoformat() < args.split_date]
    test = [r for r in runs if r.started_at.date().isoformat() >= args.split_date]
    for r in train:
        session_id += 1
        add_to_db(db, r, session_id, 1, completed=True)
    groups.append(("user_with_records", 1, test))
    for i, (folder, participant) in enumerate(args.new_user, 2):
        groups.append((f"new_user_{i - 1}", i, load_runs(Path(folder), participant, set(args.exclude_date))))
    print(f"기록 있는 사용자: 학습 러닝 {len(train)}회, 확인 러닝 {len(test)}회 / "
          f"새 사용자 {len(groups) - 1}명, 확인 러닝 {sum(len(g[2]) for g in groups[1:])}회")

    all_rows = []
    for label, user_id, eval_runs in groups:
        for k, r in enumerate(eval_runs, 1):
            session_id += 1
            add_to_db(db, r, session_id, user_id, completed=False)
            rows = replay_run(r, session_id=session_id, db=db, model=model, policy=policy, calc=calc,
                              label=f"{label}#{k}")
            db.until = None
            all_rows += rows
            print(f"\n[{label} 확인 러닝 {k}]")
            for key, value in summarize(rows).items():
                print(f"  {key}: {value}")
        group_rows = [row for row in all_rows if row["group"].startswith(label + "#")]
        if len(eval_runs) > 1:
            print(f"\n[{label} 합계]")
            for key, value in summarize(group_rows).items():
                print(f"  {key}: {value}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    keys = sorted({k for row in all_rows for k in row})
    with args.out.open("w", encoding="utf-8", newline="") as stream:
        import csv
        writer = csv.DictWriter(stream, fieldnames=keys)
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"\n판단별 결과: {len(all_rows)}행 저장")


if __name__ == "__main__":
    main()

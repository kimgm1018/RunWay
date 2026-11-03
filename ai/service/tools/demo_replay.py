"""기록 출처를 W07 batch로 바꿔 데모 입구에 배속 전송한다."""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.demo.w07 import payload_hash
from tools.replay_sources import read_db_csv, read_fitrec_csv, read_watch_json


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def to_batches(rows, *, start_at: datetime, device_id: int, session_id: int,
               uuid_factory=uuid.uuid4) -> list[dict]:
    if start_at.tzinfo is None or start_at.utcoffset() is None:
        raise ValueError("start_at에는 시간대가 필요합니다")
    if not rows:
        return []
    ordered = sorted(rows, key=lambda row: row.elapsed_sec)
    first = ordered[0].elapsed_sec
    groups: dict[int, list] = {}
    for row in ordered:
        if row.elapsed_sec < first:
            continue
        bucket = (row.elapsed_sec - first) // 5
        groups.setdefault(bucket, []).append(row)
    batches = []
    for bucket, grouped_rows in sorted(groups.items()):
        items = []
        for row in grouped_rows:
            measured_at = start_at + timedelta(seconds=row.elapsed_sec - first)
            if any(value is not None for value in (row.hr_bpm, row.speed_mps, row.total_distance_m,
                                                   row.grade_pct, row.cadence_spm)):
                items.append({
                    "type": "METRIC_SAMPLE", "measuredAt": _iso(measured_at),
                    "elapsedDurationSec": int(row.elapsed_sec),
                    "heartRateBpm": row.hr_bpm, "cadenceSpm": row.cadence_spm,
                    "speedMps": row.speed_mps, "gradePercent": row.grade_pct,
                    "totalDistanceM": row.total_distance_m, "routeProgressM": None,
                    "isHrMeasured": row.hr_bpm is not None,
                })
            if row.latitude is not None and row.longitude is not None:
                items.append({
                    "type": "GPS_POINT", "measuredAt": _iso(measured_at),
                    "coordinates": [row.longitude, row.latitude],
                    "accuracyM": None, "altitudeM": row.altitude_m,
                })
        if not items:
            continue
        batch = {"id": str(uuid_factory()), "deviceId": int(device_id), "sessionId": int(session_id),
                 "schemaVersion": "1", "payloadHash": "0" * 64, "items": items}
        batch["payloadHash"] = payload_hash(batch)
        batches.append(batch)
    return batches


def run(batches, *, post: Callable[[dict], int], speed: float, sleep=time.sleep,
        monotonic=time.monotonic) -> dict:
    if speed <= 0:
        raise ValueError("speed는 0보다 커야 합니다")
    start = monotonic()
    sent = 0
    failed = 0
    for index, batch in enumerate(batches):
        due = start + index * 5.0 / speed
        delay = due - monotonic()
        if delay > 0:
            sleep(delay)
        try:
            status = int(post(batch))
        except Exception:
            status = 0
        if status == 200:
            sent += 1
        else:
            failed += 1
    return {"sent": sent, "failed": failed}


def make_poster(base_url: str, session_id: int, token: str, speed: float) -> Callable[[dict], int]:
    url = base_url.rstrip("/") + f"/v1/demo/sessions/{int(session_id)}/batches"
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json",
               "X-Demo-Replay-Speed": str(int(speed))}

    def post(batch: dict) -> int:
        body = json.dumps(batch, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        last_status = 0
        for attempt, delay in enumerate((0, 1, 2)):
            if delay:
                time.sleep(delay)
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return int(response.status)
            except urllib.error.HTTPError as exc:
                last_status = int(exc.code)
            except (urllib.error.URLError, TimeoutError, OSError):
                last_status = 0
            if attempt == 2:
                return last_status
        return last_status

    return post


def _read_rows(source: str, path: Path, *, split_file: Path | None, split: str | None):
    if source == "db-csv":
        return read_db_csv(path)
    if source == "watch-json":
        return read_watch_json(path)
    if not split_file or not split:
        raise ValueError("fitrec-csv에는 --split-file과 --split train|val이 필요합니다")
    return read_fitrec_csv(path, split_file=split_file, split=split)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, choices=("db-csv", "watch-json", "fitrec-csv"))
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--session", required=True, type=int)
    parser.add_argument("--speed", type=int, default=1, choices=range(1, 9))
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--device-id", type=int, default=900000101)
    parser.add_argument("--split-file", type=Path)
    parser.add_argument("--split", choices=("train", "val"))
    args = parser.parse_args(argv)
    token = os.getenv("DEMO_INGEST_TOKEN", "").strip()
    if not token:
        print("DEMO_INGEST_TOKEN 환경변수가 필요합니다.", file=sys.stderr)
        return 2
    try:
        rows = _read_rows(args.source, args.file, split_file=args.split_file, split=args.split)
        batches = to_batches(rows, start_at=datetime.now(timezone.utc), device_id=args.device_id,
                             session_id=args.session)
        result = run(batches, post=make_poster(args.url, args.session, token, args.speed), speed=args.speed)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"재생 준비 실패: {exc}", file=sys.stderr)
        return 2
    print(f"전송 완료: {result['sent']}개, 실패: {result['failed']}개")
    return 0 if result["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

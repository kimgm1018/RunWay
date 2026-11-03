"""Replay one local Val-only FitRec copy as W07 batches at a fixed five-second cadence."""
import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import statistics
import sys
import time
import urllib.error
import urllib.request

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from tools.demo_replay import to_batches
from tools.replay_sources import read_fitrec_csv

_DEFAULT_VAL_DATA_DIR = Path(__file__).resolve().parents[5] / "mpc_demo_20261101" / "data"
VAL_DATA_DIR = Path(os.getenv("RUNWAY_VAL_DATA_DIR", str(_DEFAULT_VAL_DATA_DIR))).expanduser().resolve()
VAL_SPLIT = VAL_DATA_DIR / "fitrec_hr_v2_val_only.json"
DEFAULT_CSV = VAL_DATA_DIR / "fitrec_val_endo_40003766.csv"


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, math.ceil(q * len(ordered)) - 1))]


def replay(*, csv_path: Path, base_url: str, session_id: int, device_id: int,
           token: str, summary_path: Path | None = None) -> dict:
    data_root = VAL_DATA_DIR.resolve()
    csv_path = csv_path.resolve()
    if csv_path.parent != data_root or not csv_path.name.startswith("fitrec_val_") or csv_path.suffix != ".csv":
        raise ValueError("source must be one fitrec_val_*.csv under prototype data/")
    if not VAL_SPLIT.is_file():
        raise ValueError("prototype Val-only split file is missing")
    rows = read_fitrec_csv(csv_path, split_file=VAL_SPLIT, split="val")
    start_at = datetime.now(timezone.utc)
    batches = to_batches(rows, start_at=start_at, device_id=device_id, session_id=session_id)
    if not batches:
        raise ValueError("Val source produced no W07 batches")

    url = base_url.rstrip("/") + f"/v1/demo/sessions/{session_id}/batches"
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json",
               "X-Demo-Replay-Speed": "1"}
    started = time.monotonic()
    latencies, errors = [], 0
    sent = 0
    for index, batch in enumerate(batches):
        due = started + index * 5.0
        delay = due - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        body = json.dumps(batch, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        status = 0
        for attempt in range(3):
            request_started = time.perf_counter()
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    status = int(response.status)
                    payload = json.loads(response.read().decode("utf-8"))
                latency = (time.perf_counter() - request_started) * 1000.0
                if status == 200 and payload.get("status") == "COMMITTED":
                    latencies.append(latency)
                    sent += 1
                    break
            except urllib.error.HTTPError as exc:
                status = int(exc.code)
            except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
                status = 0
            if attempt < 2:
                time.sleep((1, 2)[attempt])
        else:
            errors += 1

    elapsed = time.monotonic() - started
    result = {
        "source": csv_path.name,
        "split": "val",
        "cadenceSec": 5,
        "batchCount": len(batches),
        "sent": sent,
        "errors": errors,
        "decisionAckLatencyMs": {
            "p50": round(statistics.median(latencies), 3) if latencies else None,
            "p95": round(_percentile(latencies, 0.95), 3) if latencies else None,
            "sampleCount": len(latencies),
        },
        "elapsedWallSec": round(elapsed, 3),
    }
    if summary_path:
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--session", type=int, default=690001)
    parser.add_argument("--device-id", type=int, default=690101)
    parser.add_argument("--summary", type=Path, default=SERVICE_DIR.parents[2] / "test-results/live-replay-summary.json")
    args = parser.parse_args(argv)
    token = os.getenv("DEMO_INGEST_TOKEN", "").strip()
    if len(token) < 32:
        print("DEMO_INGEST_TOKEN must be supplied outside the source tree", file=sys.stderr)
        return 2
    try:
        result = replay(csv_path=args.file, base_url=args.url, session_id=args.session,
                        device_id=args.device_id, token=token, summary_path=args.summary)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"Val replay failed: {type(exc).__name__}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["errors"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

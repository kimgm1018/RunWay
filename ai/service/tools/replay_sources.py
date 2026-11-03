"""시연 재생에 쓸 CSV와 워치 JSON 출처를 Row로 읽는다."""
import csv
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Row:
    elapsed_sec: int
    hr_bpm: float | None
    speed_mps: float | None
    total_distance_m: float | None
    grade_pct: float | None
    cadence_spm: float | None = None
    latitude: float | None = None
    longitude: float | None = None
    altitude_m: float | None = None
    segment_id: int | None = None


def _number(value, *, integer=False):
    if value is None or str(value).strip() == "":
        return None
    number = float(value)
    if integer:
        return int(number)
    return number


def _read_csv(path: Path):
    with Path(path).open("r", newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("CSV 머리글이 없습니다")
        return reader.fieldnames, list(reader)


def _require_columns(fieldnames, required):
    missing = [name for name in required if name not in fieldnames]
    if missing:
        raise ValueError("필수 CSV 열이 없습니다: " + ", ".join(missing))


def read_db_csv(path: Path) -> list[Row]:
    required = ("measured_at", "elapsed_duration", "heart_rate", "cadence", "speed", "grade",
                "total_distance", "route_progress", "is_hr_measured")
    fieldnames, records = _read_csv(path)
    _require_columns(fieldnames, required)
    result = []
    for record in records:
        elapsed = _number(record["elapsed_duration"], integer=True)
        if elapsed is None or elapsed < 0:
            raise ValueError("elapsed_duration은 0 이상의 정수여야 합니다")
        hr = _number(record["heart_rate"])
        measured = str(record["is_hr_measured"]).strip().lower() in {"true", "1", "yes"}
        if not measured:
            hr = None
        result.append(Row(elapsed, hr,
                          _number(record["speed"]), _number(record["total_distance"]),
                          _number(record["grade"]), _number(record["cadence"])))
    return sorted(result, key=lambda row: row.elapsed_sec)


def read_watch_json(path: Path) -> list[Row]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    samples = data.get("samples") if isinstance(data, dict) else None
    if not isinstance(samples, list):
        raise ValueError("워치 JSON에 samples 배열이 없습니다")
    grouped: dict[int, dict[str, float | None]] = {}
    destinations = {"HEART_RATE": "hr_bpm", "SPEED": "speed_mps", "CADENCE": "cadence_spm",
                    "DISTANCE_TOTAL": "total_distance_m"}
    for sample in samples:
        if not isinstance(sample, dict) or sample.get("metric") not in destinations:
            continue
        elapsed_ms = sample.get("sessionElapsedMs")
        if elapsed_ms is None:
            continue
        elapsed = int(elapsed_ms) // 1000
        if elapsed < 0:
            raise ValueError("sessionElapsedMs는 0 이상이어야 합니다")
        value = _number(sample.get("value"))
        grouped.setdefault(elapsed, {})[destinations[sample["metric"]]] = value
    rows = []
    for elapsed, values in sorted(grouped.items()):
        rows.append(Row(elapsed, values.get("hr_bpm"), values.get("speed_mps"),
                        values.get("total_distance_m"), None, values.get("cadence_spm")))
    return rows


def read_fitrec_csv(path: Path, *, split_file: Path, split: str) -> list[Row]:
    if split not in {"train", "val"}:
        raise ValueError("split은 train 또는 val만 허용됩니다")
    required = ("session_id", "subject_group_id", "elapsed_s", "hr_bpm", "speed_mps", "grade_pct")
    optional = ("cumulative_distance_m", "latitude", "longitude", "altitude_m", "segment_id")
    fieldnames, records = _read_csv(path)
    _require_columns(fieldnames, required)
    split_data = json.loads(Path(split_file).read_text(encoding="utf-8"))
    if not isinstance(split_data, dict) or not isinstance(split_data.get(split), list):
        raise ValueError("split 파일에 요청한 분할 목록이 없습니다")
    allowed_groups = {str(value) for value in split_data[split]}
    session_values = [str(record.get("session_id", "")).strip() for record in records]
    if any(not value for value in session_values):
        raise ValueError("session_id가 비어 있는 행이 있습니다")
    session_ids = set(session_values)
    if len(session_ids) > 1:
        raise ValueError("CSV 한 파일에는 세션 하나만 있어야 합니다")
    result = []
    for record in records:
        group = str(record.get("subject_group_id", "")).strip()
        if group not in allowed_groups:
            raise ValueError(f"subject_group_id가 {split} split에 없는 그룹입니다")
        def optional_number(name, integer=False):
            return _number(record.get(name), integer=integer) if name in fieldnames else None
        elapsed = _number(record["elapsed_s"], integer=True)
        if elapsed is None or elapsed < 0:
            raise ValueError("elapsed_s는 0 이상의 정수여야 합니다")
        result.append(Row(elapsed, _number(record["hr_bpm"]), _number(record["speed_mps"]),
                          optional_number("cumulative_distance_m"), _number(record["grade_pct"]), None,
                          optional_number("latitude"), optional_number("longitude"),
                          optional_number("altitude_m"), optional_number("segment_id", integer=True)))
    return sorted(result, key=lambda row: row.elapsed_sec)

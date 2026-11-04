"""FitRec CSV 좌표와 고도로 코스 JSON을 만든다."""
import argparse
import csv
import json
import math
from pathlib import Path


def build_course(path: Path) -> dict:
    with Path(path).open("r", newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        fields = set(reader.fieldnames or ())
        if not {"latitude", "longitude"} <= fields:
            raise ValueError("CSV에 latitude와 longitude 열이 필요합니다")
        points = []
        for row in reader:
            if row.get("latitude", "").strip() == "" or row.get("longitude", "").strip() == "":
                continue
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            altitude_text = (row.get("altitude_m") or "").strip()
            elevation = float(altitude_text) if altitude_text else 0.0
            if not all(math.isfinite(value) for value in (lon, lat, elevation)):
                raise ValueError("코스 좌표와 고도는 유한한 숫자여야 합니다")
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                raise ValueError("코스 좌표 범위가 올바르지 않습니다")
            points.append({"lon": lon, "lat": lat, "elevationM": elevation})
    return {"points": points}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    result = build_course(args.file)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

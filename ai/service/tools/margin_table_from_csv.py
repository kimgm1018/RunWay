"""잔차 분위수 CSV를 정책 런타임 여유 표로 변환한다."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

HEADER = "model,personalization,set,horizon_s,direction,grade,n,low_n,P50,P90,P95".split(",")
DIRECTION_MAP = {"가속": "ACCEL", "유지": "HOLD", "감속": "DECEL"}
GRADE_MAP = {"오르막": "UP", "평지": "FLAT", "내리막": "DOWN"}


def _usable(row: dict, quantile: str):
    if row is None or row["low_n"].strip().lower() in {"true", "1", "yes"}:
        return None
    raw = row.get(quantile, "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return max(0.0, value) if math.isfinite(value) else None


def build_table(csv_path: Path, *, model: str, personalization: str = "OFF", set_name: str = "W1", quantile: str = "P90") -> dict:
    if quantile not in {"P50", "P90", "P95"}:
        raise ValueError("quantile은 P50, P90, P95 중 하나여야 합니다")
    raw_bytes = csv_path.read_bytes()
    with csv_path.open("r", newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != HEADER:
            raise ValueError("잔차 CSV 헤더가 예상 형식과 다릅니다")
        rows = list(reader)
    selected = [r for r in rows if r["model"] == model and r["personalization"] == personalization and r["set"] == set_name]
    if not selected:
        raise ValueError("요청한 모델·개인화·평가 구간 행이 없습니다")
    index = {(int(r["horizon_s"]), r["direction"], r["grade"]): r for r in selected}
    margins: dict[str, dict[str, dict[str, float]]] = {}
    fallback_cells: list[str] = []
    for h in (30, 60, 120):
        margins[str(h)] = {}
        for d_ko, d in DIRECTION_MAP.items():
            margins[str(h)][d] = {}
            for g_ko, g in GRADE_MAP.items():
                cell = (h, d_ko, g_ko)
                value = _usable(index.get(cell), quantile)
                if value is None:
                    value = _usable(index.get((h, d_ko, "전체")), quantile)
                    if value is None:
                        value = _usable(index.get((h, "전체", "전체")), quantile)
                    fallback_cells.append(f"{h}/{d}/{g}")
                if value is None:
                    raise ValueError(f"여유 표 값을 찾을 수 없습니다: {h}/{d}/{g}")
                margins[str(h)][d][g] = value
    sha = hashlib.sha256(raw_bytes).hexdigest()
    return {
        "version": f"cve1-{model}-{personalization}-{set_name}-{quantile}-{sha[:8]}",
        "model": model,
        "personalization": personalization,
        "set": set_name,
        "quantile": quantile,
        "source": {"file": csv_path.name, "sha256": sha},
        "direction": {"variable": "mean speed t0+5..t0+60 − mean speed t0−25..t0 (m/s)",
                      "accelAtLeastMps": 0.15, "decelAtMostMps": -0.15},
        "grade": {"variable": "mean grade t0+5..t0+120 (%)", "upAbovePct": 2.0, "downBelowPct": -2.0},
        "marginsBpm": margins,
        "fallbackCells": fallback_cells,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--model", required=True)
    parser.add_argument("--personalization", default="OFF", choices=("OFF", "ON"))
    parser.add_argument("--set", dest="set_name", default="W1")
    parser.add_argument("--quantile", default="P90", choices=("P50", "P90", "P95"))
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    table = build_table(args.csv, model=args.model, personalization=args.personalization,
                        set_name=args.set_name, quantile=args.quantile)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(table, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

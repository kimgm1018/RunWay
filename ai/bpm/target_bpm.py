"""목표 페이스를 그 사용자의 목표 BPM(메트로놈 박자)으로 바꾼다.

기록이 없으면 키 prior(키를 모르면 키 없는 prior)의 평균 직선을 쓰고,
기록이 있으면 키 없는 prior를 사용자 기록으로 베이지안 보정한다(BPM-002 결과).

서비스 흐름:
  - 러닝 시작과 목표 페이스가 바뀔 때마다 target_bpm으로 BPM을 계산한다.
  - 지난 기록은 select_records로 골라 넣는다(BPM을 따라간 구간만, 최근 5회, 러닝·속도 칸별 평균).
  - 보정에 쓸 기록이 없는 처음 사용자만, 이번 러닝의 첫 1분으로 한 번 다시 계산한다(first_minute_bpm).

사용 예:
    python target_bpm.py <prior 폴더> --pace 360
    python target_bpm.py <prior 폴더> --pace 330 --height 165 --record 2.8 170 --record 3.2 176
"""
import argparse
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from stride_model import StridePrior, personal_offset, predict_cadence

BPM_MIN, BPM_MAX = 60, 220
FOLLOW_SPM = 5          # 큐를 켠 구간은 |케이던스 − BPM| ≤ 5일 때만 보정에 쓴다 (BPM-005)
RECENT_RUNS = 5         # 최근 러닝 5회만 쓴다 (BPM-004, 잠정)
SPEED_BIN = 0.25        # 러닝·속도 칸(m/s)별 평균 하나로 묶는다
MIN_CHANGE_SPM = 3      # 첫 1분 보정은 지금 BPM과 이만큼 이상 차이 날 때만 바꾼다 (잠정)


@dataclass
class BpmResult:
    bpm: int                 # 워치에 보낼 정수 BPM
    raw_cadence: float       # 제한 전 예측 케이던스(spm)
    source: str              # height_prior / population / bayes
    n_records: int

@dataclass
class Window:
    """저장된 러닝 기록의 페이스가 일정한 구간 하나(평균 속도·케이던스)."""
    run_no: int                       # 러닝 순서(클수록 최근)
    speed_mps: float
    cadence_spm: float
    cue_bpm: float | None = None      # 큐를 켰으면 그 구간의 목표 BPM, 껐으면 None


def is_usable(window: Window, follow_spm: float = FOLLOW_SPM) -> bool:
    """큐 없이 뛴 구간이거나, 큐를 켜고 BPM을 따라간 구간이면 보정에 쓴다."""
    return window.cue_bpm is None or abs(window.cadence_spm - window.cue_bpm) <= follow_spm


def select_records(
    windows: list[Window],
    recent_runs: int = RECENT_RUNS,
    follow_spm: float = FOLLOW_SPM,
    speed_bin: float = SPEED_BIN,
) -> list[tuple[float, float]]:
    """저장된 구간 중 보정에 쓸 (속도, 케이던스)를 고른다.

    1. BPM을 따라가지 않은 구간은 뺀다.
    2. 쓸 구간이 남은 러닝 중 최근 recent_runs회만 남긴다.
    3. 한 러닝 안의 비슷한 구간이 과하게 반영되지 않게 러닝·속도 칸별 평균 하나로 묶는다.
    """
    usable = [w for w in windows if is_usable(w, follow_spm)]
    recent = set(sorted({w.run_no for w in usable})[-recent_runs:])
    groups: dict[tuple[int, int], list[Window]] = {}
    for w in usable:
        if w.run_no in recent:
            groups.setdefault((w.run_no, round(w.speed_mps / speed_bin)), []).append(w)

    records = []
    for group in groups.values():
        speed = float(np.mean([w.speed_mps for w in group]))
        stride = float(np.mean([60 * w.speed_mps / w.cadence_spm for w in group]))
        records.append((speed, 60 * speed / stride))
    return records


def load_priors(folder: Path) -> tuple[StridePrior, StridePrior | None]:
    prior = StridePrior.load(folder / "stride_prior.json")
    height_path = folder / "stride_prior_height.json"
    prior_h = StridePrior.load(height_path) if height_path.exists() else None
    return prior, prior_h


def target_bpm(
    pace_sec_per_km: float,
    prior: StridePrior,
    prior_h: StridePrior | None = None,
    records: list[tuple[float, float]] | None = None,
    height_cm: float | None = None,
    comfort_range: tuple[float, float] | None = None,
) -> BpmResult:
    """records: 그 사용자의 (속도 m/s, 케이던스 spm) 목록. select_records로 고른 값을 넣는다."""
    if pace_sec_per_km <= 0:
        raise ValueError("페이스는 0보다 커야 합니다")
    speed = 1000 / pace_sec_per_km
    records = records or []

    if records:
        speeds = np.array([s for s, _ in records], dtype=float)
        cadences = np.array([c for _, c in records], dtype=float)
        offset = personal_offset(prior, speeds, 60 * speeds / cadences)
        cadence = predict_cadence(prior, [speed], offset)[0]
        source = "bayes"
    elif prior_h is not None and height_cm is not None:
        cadence = predict_cadence(prior_h, [speed], height_cm=height_cm)[0]
        source = "height_prior"
    else:
        cadence = predict_cadence(prior, [speed])[0]
        source = "population"

    bpm = cadence
    if comfort_range is not None:
        bpm = float(np.clip(bpm, *comfort_range))
    bpm = int(round(float(np.clip(bpm, BPM_MIN, BPM_MAX))))
    return BpmResult(bpm=bpm, raw_cadence=float(cadence), source=source, n_records=len(records))

def first_minute_bpm(
    current_bpm: int,
    pace_sec_per_km: float,
    first_window: Window,
    past_records: list[tuple[float, float]],
    prior: StridePrior,
    prior_h: StridePrior | None = None,
    height_cm: float | None = None,
    comfort_range: tuple[float, float] | None = None,
    min_change: float = MIN_CHANGE_SPM,
) -> BpmResult | None:
    """처음 사용자만 이번 러닝의 첫 1분(페이스가 일정한 구간)으로 BPM을 한 번 다시 계산한다.

    지금 BPM을 그대로 두면 None을 돌려준다:
      - 보정에 쓸 지난 기록이 있는 사용자(목표 페이스가 바뀔 때만 BPM을 바꾼다)
      - 첫 1분에 BPM을 따라가지 않았을 때
      - 새 BPM이 지금 BPM과 min_change 미만으로 차이 날 때
    러닝당 한 번만 부르는 것은 호출하는 쪽에서 지킨다.
    """
    if past_records or not is_usable(first_window):
        return None
    result = target_bpm(pace_sec_per_km, prior, prior_h,
                        records=[(first_window.speed_mps, first_window.cadence_spm)],
                        height_cm=height_cm, comfort_range=comfort_range)
    return result if abs(result.bpm - current_bpm) >= min_change else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path, help="stride_prior.json이 있는 폴더")
    parser.add_argument("--pace", type=float, required=True, help="목표 페이스(초/km). 360 = 6:00/km")
    parser.add_argument("--height", type=float, default=None, help="키(cm)")
    parser.add_argument("--record", type=float, nargs=2, action="append", metavar=("SPEED", "CADENCE"),
                        help="사용자 기록 (속도 m/s, 케이던스 spm). 여러 번 줄 수 있음")
    parser.add_argument("--comfort", type=float, nargs=2, default=None, metavar=("MIN", "MAX"),
                        help="편한 케이던스 범위")
    args = parser.parse_args()

    prior, prior_h = load_priors(args.folder)
    result = target_bpm(args.pace, prior, prior_h, records=args.record, height_cm=args.height,
                        comfort_range=tuple(args.comfort) if args.comfort else None)
    print(result)


if __name__ == "__main__":
    main()
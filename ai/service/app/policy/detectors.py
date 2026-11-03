"""최근 활동 칸으로 pace 저하와 과속을 감지한다."""
from collections.abc import Sequence

from app.policy.config import PolicyConfig


def detect(cells: Sequence[tuple[float | None, float | None]], *, guide_pace_sec_per_km: float | None,
           allow_bpm: float, hr_now_bpm: float | None, cfg: PolicyConfig) -> tuple[str, ...]:
    if guide_pace_sec_per_km is None:
        return ()
    window = list(cells[-cfg.detector_window_cells:])
    valid = [(hr, speed) for hr, speed in window if speed is not None and speed >= cfg.walk_speed_mps]
    if len(valid) < cfg.detector_min_valid_cells:
        return ()
    mean_speed = sum(speed for _, speed in valid) / len(valid)
    if mean_speed <= 0:
        return ()
    mean_pace = 1000.0 / mean_speed
    if mean_pace - guide_pace_sec_per_km > cfg.pace_drop_slower_sec_per_km:
        return ("PACE_DROP",)
    if guide_pace_sec_per_km - mean_pace <= cfg.overpace_faster_sec_per_km:
        return ()
    hr_points = [(i, hr) for i, (hr, speed) in enumerate(window)
                 if hr is not None and speed is not None and speed >= cfg.walk_speed_mps]
    rise = 0.0
    if len(hr_points) >= 2:
        first_i, first_hr = hr_points[0]
        last_i, last_hr = hr_points[-1]
        span = (last_i - first_i) * 5.0
        if span > 0:
            rise = (last_hr - first_hr) * 60.0 / span
    if (hr_now_bpm is not None and hr_now_bpm >= allow_bpm) or rise > cfg.overpace_hr_rise_bpm_per_min:
        return ("OVERPACE",)
    return ()

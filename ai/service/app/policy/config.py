"""MPC 정책 설정을 엄격하게 읽는다."""
import json
import math
from dataclasses import dataclass, fields
from pathlib import Path


@dataclass(frozen=True)
class PolicyConfig:
    policy_version: str
    validated: bool
    provisional: bool
    hr_threshold_population_danger_bpm: float
    hr_threshold_population_sustain_bpm: float
    # 위험 기준 = (개인·모집단 P98을 섞은 값) + 이 값. 섞은 뒤에 더한다(사용자 확정 2026-11-03, 기본 3 bpm).
    hr_danger_offset_bpm: float
    hr_threshold_blend_weights: tuple[float, ...]
    final_stretch_extra_bpm: float
    p0: float
    sprint_m: float
    band_bpm: float
    ease_off_sec_per_km: float
    chase_limit_sec_per_km: float
    hold_sec: float
    publish_delta_sec_per_km: float
    walk_speed_mps: float
    hr_stale_sec: float
    input_insufficient_sec: float
    margin_quantile: str
    w_t_base: float
    w_c: float
    score_unit_sec_per_km: float
    # 러닝 초반 계획 유지 → MPC 넘겨주기(activeSec 기준, 잠정: V2 Val 재생 평가로 조정 예정). 0, 0이면 꺼짐.
    plan_hold_sec: float
    plan_blend_end_sec: float
    goal_preference_default: float
    pace_drop_slower_sec_per_km: float
    overpace_faster_sec_per_km: float
    detector_window_cells: int
    detector_min_valid_cells: int
    overpace_hr_rise_bpm_per_min: float


def load_policy_config(path: Path | None = None) -> PolicyConfig:
    config_path = path or Path(__file__).with_name("policy_v03.json")
    raw = json.loads(config_path.read_text(encoding="utf-8"))
    expected = {f.name for f in fields(PolicyConfig)}
    if not isinstance(raw, dict) or set(raw) != expected:
        missing = sorted(expected - set(raw) if isinstance(raw, dict) else expected)
        unknown = sorted(set(raw) - expected if isinstance(raw, dict) else [])
        raise ValueError(f"정책 설정 키가 다릅니다: 누락 {missing}, 알 수 없음 {unknown}")
    if raw["validated"] is not False:
        raise ValueError("정책 v0.4 설정은 validated=false여야 합니다")
    weights = raw.get("hr_threshold_blend_weights")
    if (not isinstance(weights, list) or len(weights) != 6
            or any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in weights)
            or any(not math.isfinite(float(value)) or not 0.0 <= float(value) <= 1.0 for value in weights)
            or weights[0] != 0.0 or weights[-1] != 1.0
            or any(float(left) > float(right) for left, right in zip(weights, weights[1:]))):
        raise ValueError("hr_threshold_blend_weights는 0~5+ 러닝용 6개 오름차순 비중이어야 합니다")
    if not isinstance(raw.get("provisional"), bool):
        raise ValueError("provisional은 true 또는 false여야 합니다")
    for key, value in raw.items():
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"{key}는 유한한 값이어야 합니다")
    try:
        config_values = {**raw, "hr_threshold_blend_weights": tuple(float(value) for value in weights)}
        cfg = PolicyConfig(**config_values)
    except (TypeError, ValueError) as exc:
        raise ValueError("정책 설정의 값 형식이 올바르지 않습니다") from exc
    if (not 35.0 <= cfg.hr_threshold_population_danger_bpm <= 220.0
            or not 35.0 <= cfg.hr_threshold_population_sustain_bpm <= 220.0
            or cfg.hr_threshold_population_sustain_bpm > cfg.hr_threshold_population_danger_bpm
            or not math.isfinite(cfg.final_stretch_extra_bpm) or cfg.final_stretch_extra_bpm < 0
            or isinstance(cfg.hr_danger_offset_bpm, bool)
            or not isinstance(cfg.hr_danger_offset_bpm, (int, float))
            or not 0.0 <= cfg.hr_danger_offset_bpm <= 20.0
            or cfg.hr_threshold_population_danger_bpm + cfg.hr_danger_offset_bpm > 220.0):
        raise ValueError("학습 심박 기준, 위험 기준 더하기 값(0~20), 마지막 구간 추가 심박 값 중 범위를 벗어난 것이 있습니다")
    if not 0.0 <= cfg.plan_hold_sec <= cfg.plan_blend_end_sec:
        raise ValueError("plan_hold_sec는 0 이상이고 plan_blend_end_sec 이하여야 합니다")
    return cfg

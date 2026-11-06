"""MPC 정책 설정을 엄격하게 읽는다."""
import json
import math
import os
from dataclasses import dataclass, fields, replace
from pathlib import Path

# 실측 페이스 예측으로 OK/CAUTION을 정할지 배포에서 바꿀 때 쓴다(true/false). 없으면 설정 파일 값(S15P31E105-504).
ACTUAL_PACE_CHECK_ENV = "AI04_ACTUAL_PACE_CHECK_ENABLED"


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
    # 코칭 단계(S15P31E105-504): 러너의 실측 속도로도 심박을 예측해 OK/CAUTION을 정한다. 끄면 CAUTION은 OVERPACE 감지와
    # 안내 페이스 심박 gate로만 정한다(GRU가 작은 페이스 차이를 잘 구분하지 못할 때 끈다).
    actual_pace_check_enabled: bool
    # 넘친 만큼 늦추기(인계 I-23, S15P31E105-506): 심박 때문에 늦출 때(SLOW_ONLY) AI가 안에서 이 폭들로 늦춘 페이스를
    # 함께 예측하고, 2분 뒤 상한이 허용선 아래가 되는 가장 작은 폭을 고른다. 없으면 가장 큰 폭(걷기 경계 하한이면 DANGER).
    hr_slow_steps_sec_per_km: tuple[float, ...]
    # 감속 쿨다운: 안내가 바뀐 뒤 이 시간 동안은 더 늦추지 않는다(심박 반응 60~105초, 팀 검토 2026-11-06).
    hr_slow_cooldown_sec: float
    # 늦추는 후보의 2분 상한 여유분(경사 칸별, FLAT/UP/DOWN/UNKNOWN). 감속 잔차로 따로 잰 값(팀 측정 2026-11-06).
    hr_slow_margin_120_bpm: dict[str, float]
    # 넘친 만큼 빨라지기: 빨라지는 폭(초/km) 중 상한이 허용선 − band 아래이고 목표 페이스보다 빠르지 않은 가장 큰 폭.
    speed_up_steps_sec_per_km: tuple[float, ...]
    # 출발 뒤 early_slow_cap_sec 동안은 심박 감속을 early_slow_cap_sec_per_km까지만(위험 감속 제외). 0초면 끔.
    early_slow_cap_sec: float
    early_slow_cap_sec_per_km: float
    # 러너가 안내보다 이만큼 이상 빠르면 안내를 따르지 않는 것으로 본다(감속 대신 같은 안내 + 단계 올림).
    not_following_sec_per_km: float
    # 안내가 바뀐 뒤 이 시간이 지나야 안내 미준수를 판단한다(러너가 페이스를 바꾸고 60초 평균에 반영될 시간).
    not_following_grace_sec: float


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
    if not isinstance(raw.get("actual_pace_check_enabled"), bool):
        raise ValueError("actual_pace_check_enabled는 true 또는 false여야 합니다")
    for key, value in raw.items():
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"{key}는 유한한 값이어야 합니다")
    try:
        lists = {}
        for key in ("hr_slow_steps_sec_per_km", "speed_up_steps_sec_per_km"):
            steps = raw.get(key)
            if (not isinstance(steps, list) or not steps
                    or any(isinstance(v, bool) or not isinstance(v, (int, float)) for v in steps)):
                raise ValueError(f"{key}는 숫자 목록이어야 합니다")
            lists[key] = tuple(float(v) for v in steps)
        slow_margin = raw.get("hr_slow_margin_120_bpm")
        if (not isinstance(slow_margin, dict) or set(slow_margin) != {"FLAT", "UP", "DOWN", "UNKNOWN"}
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= float(v) <= 30
                       for v in slow_margin.values())):
            raise ValueError("hr_slow_margin_120_bpm는 FLAT/UP/DOWN/UNKNOWN 0~30 bpm이어야 합니다")
        config_values = {**raw, "hr_threshold_blend_weights": tuple(float(value) for value in weights), **lists,
                         "hr_slow_margin_120_bpm": {k: float(v) for k, v in slow_margin.items()}}
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
    for key in ("hr_slow_steps_sec_per_km", "speed_up_steps_sec_per_km"):
        steps = getattr(cfg, key)
        if (any(not math.isfinite(v) or v <= 0.0 or v > 120.0 for v in steps)
                or any(a >= b for a, b in zip(steps, steps[1:]))):
            raise ValueError(f"{key}는 0보다 크고 120 이하인 오름차순 값이어야 합니다")
    if (not 0.0 <= cfg.early_slow_cap_sec <= 1800.0 or not 0.0 < cfg.early_slow_cap_sec_per_km <= 120.0
            or not 0.0 < cfg.not_following_sec_per_km <= 120.0 or not 0.0 <= cfg.not_following_grace_sec <= 600.0):
        raise ValueError("early_slow_cap_sec(0~1800), early_slow_cap_sec_per_km·not_following_sec_per_km(0~120) 범위를 벗어났습니다")
    if (isinstance(cfg.hr_slow_cooldown_sec, bool) or not isinstance(cfg.hr_slow_cooldown_sec, (int, float))
            or not 0.0 <= cfg.hr_slow_cooldown_sec <= 600.0):
        raise ValueError("hr_slow_cooldown_sec는 0~600초여야 합니다")
    if not 0.0 <= cfg.plan_hold_sec <= cfg.plan_blend_end_sec:
        raise ValueError("plan_hold_sec는 0 이상이고 plan_blend_end_sec 이하여야 합니다")
    override = os.getenv(ACTUAL_PACE_CHECK_ENV)
    if override is not None and override.strip():
        value = override.strip().lower()
        if value not in {"true", "false"}:
            raise ValueError(f"{ACTUAL_PACE_CHECK_ENV}는 true 또는 false여야 합니다")
        cfg = replace(cfg, actual_pace_check_enabled=value == "true")
    return cfg

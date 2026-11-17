"""시연 설정의 계정 전용 값(S15P31E105-913): 회원별 심박 기준 고정과 그룹 여유 가속 시연 값을 검증한다."""
import math
from dataclasses import dataclass

MIN_BPM = 35.0
MAX_BPM = 220.0
# 위험선(dangerBpm)을 생략했을 때 허용선(sustainBpm)에 더하는 값
DEFAULT_DANGER_GAP_BPM = 15.0
STEP_CHOICES = (10, 20, 30)          # 후보 페이스 간격(10초/km)에 맞는 값만 가속 후보를 만든다
CALM_RANGE = (30.0, 300.0)
MARGIN_RANGE = (0.0, 40.0)
FORCE_AFTER_RANGE = (0.0, 600.0)     # 915: 출발 후 강제 여유 가속 시각(초)


@dataclass(frozen=True)
class HrOverride:
    """고정할 허용(지속)·위험 심박 bpm. 학습값·모집단 섞기·위험 오프셋·준비도 보정 없이 그대로 쓴다."""
    sustain_bpm: float
    danger_bpm: float


def _number(value, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name}는 숫자여야 합니다")
    return float(value)


def _bpm(value, name: str) -> float:
    number = _number(value, name)
    if not MIN_BPM <= number <= MAX_BPM:
        raise ValueError(f"{name}는 {MIN_BPM:g}~{MAX_BPM:g} bpm이어야 합니다")
    return number


def _user_id(key) -> int:
    # JSON 객체 키는 문자열이다. "011"·" 11"처럼 같은 회원을 다르게 쓸 수 있는 표기는 받지 않는다.
    if not isinstance(key, str) or not key.isascii() or not key.isdigit() or str(int(key)) != key or int(key) <= 0:
        raise ValueError("hrThresholdOverrides의 키는 양의 정수 userId 문자열이어야 합니다")
    return int(key)


def parse_hr_overrides(raw, user_allowlist) -> dict[int, HrOverride]:
    """`{"11": {"sustainBpm": 163, "dangerBpm": 178}}` 형식. userAllowlist에 없는 회원은 거부한다."""
    if not isinstance(raw, dict):
        raise ValueError("hrThresholdOverrides는 객체여야 합니다")
    result = {}
    for key, item in raw.items():
        user_id = _user_id(key)
        if not user_allowlist or user_id not in user_allowlist:
            raise ValueError("hrThresholdOverrides는 userAllowlist에 있는 회원만 지정할 수 있습니다")
        if not isinstance(item, dict) or "sustainBpm" not in item or not set(item) <= {"sustainBpm", "dangerBpm"}:
            raise ValueError("hrThresholdOverrides 값은 sustainBpm(필수)과 dangerBpm만 가진 객체여야 합니다")
        sustain = _bpm(item["sustainBpm"], "sustainBpm")
        danger = _bpm(item["dangerBpm"], "dangerBpm") if "dangerBpm" in item \
            else _bpm(sustain + DEFAULT_DANGER_GAP_BPM, "dangerBpm(기본 sustainBpm+15)")
        if not sustain < danger:
            raise ValueError("sustainBpm는 dangerBpm보다 작아야 합니다")
        result[user_id] = HrOverride(sustain, danger)
    return result


def parse_account_settings(raw: dict, user_allowlist) -> dict:
    """demo_config 최상위 JSON에서 이 작업의 키만 읽어 DemoConfig 키워드 인자로 돌려준다. 키가 없으면 기본값."""
    result = {}
    if "hrThresholdOverrides" in raw:
        result["hr_threshold_overrides"] = parse_hr_overrides(raw["hrThresholdOverrides"], user_allowlist)
    if "speedUpStepSec" in raw:
        result["speed_up_step_sec"] = parse_speed_up_step(raw["speedUpStepSec"])
    if "speedUpCalmSec" in raw:
        result["speed_up_calm_sec"] = parse_speed_up_calm(raw["speedUpCalmSec"])
    if "speedUpMarginBpm" in raw:
        result["speed_up_margin_bpm"] = parse_speed_up_margin(raw["speedUpMarginBpm"])
    if "speedUpForceAfterSec" in raw and raw["speedUpForceAfterSec"] is not None:   # 915: null이면 끈다
        result["speed_up_force_after_sec"] = parse_speed_up_force_after(raw["speedUpForceAfterSec"])
    return result


def parse_speed_up_force_after(value) -> float:
    number = _number(value, "speedUpForceAfterSec")
    if not FORCE_AFTER_RANGE[0] <= number <= FORCE_AFTER_RANGE[1]:
        raise ValueError("speedUpForceAfterSec는 0~600초여야 합니다")
    return number


def parse_speed_up_step(value) -> int:
    number = _number(value, "speedUpStepSec")
    if number not in STEP_CHOICES:
        raise ValueError("speedUpStepSec는 10, 20, 30 중 하나여야 합니다")
    return int(number)


def parse_speed_up_calm(value) -> float:
    number = _number(value, "speedUpCalmSec")
    if not CALM_RANGE[0] <= number <= CALM_RANGE[1]:
        raise ValueError("speedUpCalmSec는 30~300초여야 합니다")
    return number


def parse_speed_up_margin(value) -> float:
    number = _number(value, "speedUpMarginBpm")
    if not MARGIN_RANGE[0] <= number <= MARGIN_RANGE[1]:
        raise ValueError("speedUpMarginBpm는 0~40 bpm이어야 합니다")
    return number

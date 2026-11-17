"""데모 설정 파일과 환경 변수를 읽는다."""
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from app.demo.course import CourseProfile, load_course
from app.demo.overrides import HrOverride, parse_account_settings

log = logging.getLogger("runway.ai")
VALID_LIVE_STAGES = ("L1A", "L1B", "L2", "L2B")
MIN_TOKEN_LEN = 32
LIVE_METRICS_SEC_RANGE = (3, 30)   # 912: 실시간 측정값 주기 허용 범위(초)


@dataclass(frozen=True)
class RunProfile:
    label: str
    course: CourseProfile | None
    mode: str
    goal: dict
    goal_preference: float
    plan: list[dict] | None
    hr_reference: dict | None


@dataclass(frozen=True)
class DemoConfig:
    live_stage: str
    live: RunProfile
    replay: dict[int, RunProfile]
    session_allowlist: frozenset[int] | None
    skip_payload_hash_device_ids: frozenset[int]
    # 그룹 러닝(AI10): null이면 모든 그룹, 목록이면 그 groupRunId만 기록한다
    group_allowlist: frozenset[int] | None = None
    group_label: str | None = None
    # 모니터링 대상 회원(숫자 userId). null이면 모두. 목록이면 그 회원의 개인 러닝(AI04 userId)과
    # 그 회원이 한 명이라도 낀 그룹런(AI10 participants[].userId)만 기록한다(S15P31E105-718)
    user_allowlist: frozenset[int] | None = None
    # AI10 여유 가속 대기 시간(초). 위 회원이 낀 그룹런만 이 값을 쓴다(S15P31E105-728). 나머지는 기본 180초
    speed_up_warmup_sec: float = 60.0
    # S15P31E105-913 시연 계정 전용 설정(모두 선택, 없으면 기존 동작). userAllowlist 회원만 해당한다
    # 회원별 허용·위험 심박 고정(AI04·AI10·시연 trace): DB 학습값·섞기·준비도 보정을 모두 무시한다
    hr_threshold_overrides: dict[int, HrOverride] = field(default_factory=dict)
    # AI10 여유 가속 시연 값. 위 회원이 낀 그룹런만 쓴다. None이면 기본(10초/km·60초·환경변수 여유 기준)
    speed_up_step_sec: int | None = None
    speed_up_calm_sec: float | None = None
    speed_up_margin_bpm: float | None = None
    # 912: 대상 회원의 최신 심박·실제 페이스·거리를 콘솔에 보내는 주기(초). null이면 끈다(기본). 3~30초
    live_metrics_sec: float | None = None


@dataclass(frozen=True)
class DemoSettings:
    enabled: bool
    view_token: str | None
    ingest_token: str | None
    config: DemoConfig | None


def _profile(raw: dict, base_dir: Path) -> RunProfile:
    course_file = raw.get("courseFile")
    course = load_course((base_dir / course_file).resolve()) if course_file else None
    return RunProfile(str(raw["label"]), course, str(raw["mode"]), dict(raw["goal"]),
                      float(raw.get("goalPreference", 0.5)), raw.get("plan"), raw.get("hrReference"))


def load_demo_config(path: Path) -> DemoConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    live_raw = raw["live"]
    stage = live_raw.get("stage", "L1A")
    if stage not in VALID_LIVE_STAGES:
        raise ValueError("live.stage 값이 올바르지 않습니다")
    base = path.resolve().parent
    live = _profile(live_raw, base)
    replay = {}
    for item in raw.get("replay", []):
        session_id = int(item["sessionId"])
        if session_id <= 0:
            raise ValueError("재생 sessionId는 양수여야 합니다")
        replay[session_id] = _profile(item, base)
    allow = raw.get("sessionAllowlist")
    skip = raw.get("skipPayloadHashDeviceIds", [])
    group_allow = raw.get("groupAllowlist")
    group_label = raw.get("groupLabel")
    warmup = raw.get("speedUpWarmupSec", 60)
    if isinstance(warmup, bool) or not isinstance(warmup, (int, float)) or not 0 <= warmup <= 3600:
        raise ValueError("speedUpWarmupSec는 0~3600초여야 합니다")
    user_allow = raw.get("userAllowlist")
    if user_allow is not None and (not isinstance(user_allow, list)
                                   or any(isinstance(v, bool) or not isinstance(v, int) or v <= 0 for v in user_allow)):
        raise ValueError("userAllowlist는 양의 정수 userId 목록이어야 합니다")
    live_sec = raw.get("liveMetricsSec")                       # 912
    low, high = LIVE_METRICS_SEC_RANGE
    if live_sec is not None and (isinstance(live_sec, bool) or not isinstance(live_sec, (int, float))
                                 or not low <= live_sec <= high):
        raise ValueError("liveMetricsSec는 null 또는 3~30초여야 합니다")
    account = parse_account_settings(raw, frozenset(user_allow) if user_allow else frozenset())
    # 키워드 인자로 넘긴다: 다른 작업(예: 912 live_metrics_sec)과 합칠 때 위치 인자가 밀려 엉뚱한 필드로 들어가지 않게 한다
    return DemoConfig(
        live_stage=stage, live=live, replay=replay,
        session_allowlist=frozenset(map(int, allow)) if allow is not None else None,
        skip_payload_hash_device_ids=frozenset(map(int, skip)),
        group_allowlist=frozenset(map(int, group_allow)) if group_allow is not None else None,
        group_label=str(group_label) if group_label else None,
        user_allowlist=frozenset(user_allow) if user_allow is not None else None,
        speed_up_warmup_sec=float(warmup),
        live_metrics_sec=float(live_sec) if live_sec is not None else None, **account)


def account_settings_summary(config: DemoConfig) -> str:
    """시작 로그용 한 줄. 회원 ID·심박 값은 싣지 않고 적용 여부와 개수만 남긴다(S15P31E105-913)."""
    def shown(value):
        return "기본" if value is None else f"{value:g}"
    return (f"시연 계정 설정: 고정 {len(config.hr_threshold_overrides)}명, 가속 폭 {shown(config.speed_up_step_sec)}"
            f"·확인 {shown(config.speed_up_calm_sec)}·여유 {shown(config.speed_up_margin_bpm)}"
            f"·대기 {config.speed_up_warmup_sec:g}")


def load_demo_settings() -> DemoSettings:
    enabled = os.getenv("DEMO_STREAM_ENABLED", "false").strip().lower() == "true"
    view_token = os.getenv("DEMO_VIEW_TOKEN", "").strip() or None
    ingest_token = os.getenv("DEMO_INGEST_TOKEN", "").strip() or None
    config_value = os.getenv("DEMO_CONFIG_PATH", "").strip()
    if not enabled:
        return DemoSettings(False, view_token, ingest_token, None)
    if not view_token or len(view_token) < MIN_TOKEN_LEN:
        log.warning("시연 기능을 끕니다: DEMO_VIEW_TOKEN")
        return DemoSettings(False, view_token, ingest_token, None)
    if not ingest_token or len(ingest_token) < MIN_TOKEN_LEN:
        log.warning("시연 기능을 끕니다: DEMO_INGEST_TOKEN")
        return DemoSettings(False, view_token, ingest_token, None)
    if not config_value:
        log.warning("시연 기능을 끕니다: DEMO_CONFIG_PATH")
        return DemoSettings(False, view_token, ingest_token, None)
    try:
        config = load_demo_config(Path(config_value).expanduser())
    except Exception as exc:
        log.warning("시연 기능을 끕니다: DEMO_CONFIG_PATH (%s)", type(exc).__name__)
        return DemoSettings(False, view_token, ingest_token, None)
    log.info("%s", account_settings_summary(config))
    return DemoSettings(True, view_token, ingest_token, config)

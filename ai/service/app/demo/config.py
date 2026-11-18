"""데모 설정 파일과 환경 변수를 읽는다."""
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

from app.demo.course import CourseProfile, load_course

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
    return DemoConfig(
        live_stage=stage, live=live, replay=replay,
        session_allowlist=frozenset(map(int, allow)) if allow is not None else None,
        skip_payload_hash_device_ids=frozenset(map(int, skip)),
        group_allowlist=frozenset(map(int, group_allow)) if group_allow is not None else None,
        group_label=str(group_label) if group_label else None,
        user_allowlist=frozenset(user_allow) if user_allow is not None else None,
        speed_up_warmup_sec=float(warmup),
        live_metrics_sec=float(live_sec) if live_sec is not None else None)


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
    return DemoSettings(True, view_token, ingest_token, config)

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
    return DemoConfig(stage, live, replay,
                      frozenset(map(int, allow)) if allow is not None else None,
                      frozenset(map(int, skip)))


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

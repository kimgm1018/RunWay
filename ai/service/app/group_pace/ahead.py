"""AI10 여유 가속(S15P31E105-728): 전원 심박 여유가 크면 출발 페이스보다 빠르게 올린다.

기존 회복(RECOVERED)은 목표 또는 출발 추천 페이스(cap)까지만 올린다. 여유 가속은 그 뒤 단계로, AI 추천(TOGETHER)
모드에서만 다음을 모두 만족할 때 한 번에 10초/km, 출발 페이스보다 최대 30초/km 빠르게까지 올린다.
  - 참가자 전원이 심박으로 판단된다(제외·속도만 0명).
  - 전원의 지금과 한 단계 빠른 후보의 상한 예측이 허용선보다 MARGIN 이상 낮다.
  - 연속 조건: API가 상태를 갖지 않으므로 "N번 연속 판정" 대신 각 회원의 실측 심박이 최근 N×30초(기본 60초) 동안
    허용선 − MARGIN 아래였는지로 본다. 실측 칸이 절반 미만이면 여유로 보지 않는다.
  - 출발 뒤 대기 시간(기본 180초, 시연 계정이 낀 그룹은 demo_config speedUpWarmupSec)이 지났다.
  - 시연 계정이 낀 그룹은 1회 가속 폭·여유 확인 기간·여유 기준도 demo_config의 speedUpStepSec·speedUpCalmSec·
    speedUpMarginBpm으로 바꾼다(S15P31E105-913). 출발 페이스보다 최대 30초/km 한도는 그대로다.
  - 쿨다운(마지막 변경 뒤 120초)이 지났고 위험 심박이 아니다.
기존 선택이 페이스를 바꾸면(감속·회복) 여유 가속은 끼어들지 않는다. 스위치가 꺼져 있으면 출력이 이전과 같다.
"""
import os
from dataclasses import dataclass, replace

import numpy as np

from app.pace_selector import COOLDOWN_SEC, PACE_EPS

STEP_SEC_PER_KM = 10
MAX_AHEAD_SEC_PER_KM = 30
EVAL_INTERVAL_SEC = 30
SAMPLE_SEC = 5
REASON = "AHEAD"


def _flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _number(name: str, default: float, low: float, high: float) -> float:
    try:
        value = float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default
    return min(high, max(low, value))


@dataclass(frozen=True)
class AheadSettings:
    margin_bpm: float = 15.0
    streak: int = 2
    wait_sec: float = 180.0
    # S15P31E105-913 시연 값. 기본은 한 번에 10초/km, 여유 확인 기간은 streak×30초(None)
    step_sec: int = STEP_SEC_PER_KM
    calm_sec: float | None = None

    @property
    def calm_window_sec(self) -> float:
        return float(self.calm_sec) if self.calm_sec is not None else float(self.streak * EVAL_INTERVAL_SEC)


def ahead_enabled() -> bool:
    return _flag("GROUP_PACE_AHEAD_ENABLED")


def load_ahead_settings() -> AheadSettings:
    return AheadSettings(margin_bpm=_number("GROUP_PACE_AHEAD_MARGIN_BPM", 15.0, 0.0, 40.0),
                         streak=int(_number("GROUP_PACE_AHEAD_STREAK", 2, 1, 10)),
                         wait_sec=_number("GROUP_PACE_AHEAD_WAIT_SEC", 180.0, 0.0, 3600.0))


def _demo_group(demo_config, participants) -> bool:
    """시연 대상 회원(demo_config.user_allowlist)이 한 명이라도 낀 그룹인가. 목록이 없으면(null = 모두) 아니다."""
    allow = getattr(demo_config, "user_allowlist", None) if demo_config is not None else None
    return bool(allow) and any(p.user_id is not None and p.user_id in allow for p in participants)


def ahead_wait(settings: AheadSettings, demo_config, participants) -> tuple[float, bool]:
    """대기 시간과 시연 설정 여부. 시연 대상 회원(demo_config.user_allowlist)이 한 명이라도 낀 그룹만 짧은 값을 쓴다.
    목록이 없으면(null = 모두) 시연 대기 시간을 쓰지 않는다."""
    if _demo_group(demo_config, participants):
        return float(demo_config.speed_up_warmup_sec), True
    return settings.wait_sec, False


def ahead_for_group(settings: AheadSettings, demo_config, participants) -> AheadSettings:
    """시연 대상 회원이 낀 그룹이면 demo_config의 1회 가속 폭·여유 확인 기간·여유 기준을 적용한 사본, 아니면 그대로.
    demo_config에 값이 없는 항목은 기본(환경변수 값)을 유지한다."""
    if not _demo_group(demo_config, participants):
        return settings
    step = getattr(demo_config, "speed_up_step_sec", None)
    calm = getattr(demo_config, "speed_up_calm_sec", None)
    margin = getattr(demo_config, "speed_up_margin_bpm", None)
    return replace(settings,
                   step_sec=settings.step_sec if step is None else int(step),
                   calm_sec=settings.calm_sec if calm is None else float(calm),
                   margin_bpm=settings.margin_bpm if margin is None else float(margin))


@dataclass(frozen=True)
class ForceAhead:
    """S15P31E105-915 시연 그룹 강제 여유 가속 설정: 출발 후 after_sec 이후 출발 페이스 − step_sec로 한 번 올린다."""
    after_sec: float
    step_sec: int = MAX_AHEAD_SEC_PER_KM


def force_ahead_for_group(demo_config, participants) -> ForceAhead | None:
    """시연 대상 회원이 낀 그룹이고 demo_config에 speedUpForceAfterSec가 있을 때만 설정을 돌려준다. 아니면 None(꺼짐)."""
    if not _demo_group(demo_config, participants):
        return None
    after = getattr(demo_config, "speed_up_force_after_sec", None)
    if after is None:
        return None
    step = getattr(demo_config, "speed_up_step_sec", None)
    return ForceAhead(float(after), MAX_AHEAD_SEC_PER_KM if step is None else int(step))


def _latest_hr(hr_bpm) -> float | None:
    return next((v for v in reversed(list(hr_bpm)) if v is not None), None)


def try_force_ahead(*, force: ForceAhead, mode: str, current: float, start_pace: float | None, elapsed_sec: float,
                    now, last_change, histories, dangers) -> tuple[float | None, str | None]:
    """(올릴 목표 페이스, 막힌 이유). 목표는 항상 출발 페이스 − step이다(출발 직후 감속으로 느려졌어도 같다).

    심박 누락·여유 부족·쿨다운·이전 감속은 보지 않는다. 안전장치는 하나뿐이다: 가장 최근 실측 심박이 그 회원의 위험선
    이상이면 내지 않는다. 한 번만 내도록, 강제 시각 이후에 이미 페이스가 바뀐 적이 있으면 다시 내지 않는다."""
    if mode == "GOAL":
        return None, "GOAL_MODE"
    if start_pace is None:
        return None, "NO_START_PACE"
    if elapsed_sec < force.after_sec:
        return None, "WAITING"
    target = start_pace - force.step_sec
    if current <= target + PACE_EPS:
        return None, "ALREADY_FAST"
    if last_change is not None and (now - last_change.changed_at).total_seconds() < elapsed_sec - force.after_sec:
        return None, "ALREADY_FORCED"   # 강제 시각 뒤에 이미 한 번 바뀌었다(우리 가속이거나 그 뒤의 안전 감속)
    for history, danger in zip(histories, dangers):
        latest = _latest_hr(history)
        if latest is not None and latest >= danger:
            return None, "DANGER_HR"
    if abs(current - target) < STEP_SEC_PER_KM:
        return None, "SMALL_CHANGE"
    return target, None


def _calm_history(hr_bpm, allow: float, margin: float, window_sec: float) -> bool:
    """최근 window_sec 실측 심박이 모두 허용선 − margin 아래이고, 칸의 절반 이상이 측정돼 있는가."""
    cells = max(1, int(round(window_sec / SAMPLE_SEC)))
    recent = list(hr_bpm[-cells:])
    measured = [v for v in recent if v is not None]
    if len(recent) < cells or len(measured) * 2 < cells:
        return False
    return max(measured) <= allow - margin


def try_ahead(*, settings: AheadSettings, wait_sec: float, demo_wait: bool, mode: str, paces, current: float,
              start_pace: float | None, elapsed_sec: float, since_change_sec: float | None, danger: bool,
              excluded: int, pace_only: int, uppers, allows, histories, detail: dict | None) -> int | None:
    """올릴 후보 인덱스, 아니면 None. detail(시연 기록)에는 판단 근거를 넣는다."""
    blocked_by = None
    target = None
    floor = None if start_pace is None else start_pace - MAX_AHEAD_SEC_PER_KM
    if mode == "GOAL":
        blocked_by = "GOAL_MODE"
    elif excluded or pace_only or len(histories) == 0:
        blocked_by = "NOT_ALL_HR"
    elif start_pace is None:
        blocked_by = "NO_START_PACE"
    elif elapsed_sec < wait_sec:
        blocked_by = "WAITING"
    elif since_change_sec is not None and since_change_sec < COOLDOWN_SEC:
        blocked_by = "COOLDOWN"
    elif danger:
        blocked_by = "DANGER"
    elif current - settings.step_sec < floor - PACE_EPS:
        blocked_by = "AT_MAX"
    else:
        want = current - settings.step_sec
        index = next((j for j, pace in enumerate(paces) if abs(pace - want) <= PACE_EPS), None)
        baseline = next(j for j, pace in enumerate(paces) if abs(pace - current) <= PACE_EPS)
        uppers = np.asarray(uppers, dtype=float)
        allows = np.asarray(allows, dtype=float)
        line = allows - settings.margin_bpm
        if index is None:
            blocked_by = "NO_CANDIDATE"
        elif not (np.all(uppers[:, baseline] < line) and np.all(uppers[:, index] < line)):
            blocked_by = "NO_MARGIN"
        elif not all(_calm_history(h, a, settings.margin_bpm, settings.calm_window_sec)
                     for h, a in zip(histories, allows)):
            blocked_by = "NOT_STEADY"
        else:
            target = index
    if detail is not None:
        detail["ahead"] = {
            "applied": target is not None, "blockedBy": blocked_by,
            "waitSec": wait_sec, "demoWait": demo_wait, "marginBpm": settings.margin_bpm,
            "stepSec": settings.step_sec, "steadySec": settings.calm_window_sec,
            "startPace": start_pace, "fastestPace": floor,
        }
    return target

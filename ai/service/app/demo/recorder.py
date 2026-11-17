"""데모 버퍼 상태와 decide 기록 연결."""
import secrets
from dataclasses import dataclass, replace

from app.demo.buffer import GROUP_KEY_OFFSET, DemoBuffer, group_key, is_group_key
from app.demo.config import DemoSettings, RunProfile
from app.demo.trace import build_trace


@dataclass
class DemoState:
    settings: DemoSettings
    buffer: DemoBuffer
    rate_per_sec: int = 2
    routes: object | None = None      # 722: 지도용 실제 경로(DemoRoutes). AI DB가 없으면 None
    live_metrics: object | None = None  # 912: 실시간 측정값(DemoLiveMetrics). 설정이 꺼져 있으면 None

    @property
    def config(self):
        return self.settings.config

    def profile_for(self, session_id: int) -> tuple[str, RunProfile]:
        if self.config is None:
            raise KeyError(session_id)
        if is_group_key(session_id):
            label = self.config.group_label or f"그룹 러닝 #{session_id - GROUP_KEY_OFFSET}"
            return self.config.live_stage, replace(self.config.live, label=label)
        if session_id in self.config.replay:
            return "L3", self.config.replay[session_id]
        return self.config.live_stage, self.config.live


def new_demo_state(settings: DemoSettings, *, rate_per_sec: int = 2, now=None) -> DemoState:
    from datetime import datetime, timezone
    clock = now or (lambda: datetime.now(timezone.utc))
    allow = settings.config.session_allowlist if settings.config else None
    group_allow = settings.config.group_allowlist if settings.config else None
    buffer = DemoBuffer(secrets.token_hex(4), allowlist=allow, now=clock, group_allowlist=group_allow)
    return DemoState(settings, buffer, rate_per_sec)


def record_trace(state: DemoState, outcome, *, stage: str, replay_speed: int | None,
                 grade_source: str) -> str | None:
    session_id = outcome.request.context.session_id
    if not state.buffer.allowed(session_id):
        return None
    seq = state.buffer.next_seq()
    trace = build_trace(outcome, boot_id=state.buffer.boot_id, seq=seq, stage=stage,
                        replay_speed=replay_speed, grade_source=grade_source,
                        previous=state.buffer.traces(session_id))
    state.buffer.append(session_id, trace)
    return trace["traceId"]


def user_allowed(state: DemoState, user_id: int | None) -> bool:
    """userAllowlist가 없으면 모두, 있으면 목록 안 회원만. userId가 없는 요청은 목록이 있을 때 기록하지 않는다."""
    allow = state.config.user_allowlist if state.config else None
    return allow is None or (user_id is not None and int(user_id) in allow)


def decide_allowed(state: DemoState, body) -> bool:
    """AI04 판단을 시연 버퍼에 남길지: 세션 허용 목록과 회원 허용 목록을 모두 통과해야 한다."""
    return state.buffer.allowed(body.context.session_id) and user_allowed(state, body.user_id)


def group_allowed(state: DemoState, group_run_id: int, participants=None) -> bool:
    """AI10 그룹을 기록할지: 그룹 허용 목록, 그리고 회원 허용 목록이 있으면 참가자 중 한 명이라도 대상이어야 한다."""
    if not state.buffer.allowed(group_key(group_run_id)):
        return False
    allow = state.config.user_allowlist if state.config else None
    if allow is None:
        return True
    return any(user_allowed(state, p.user_id) for p in (participants or ()))


def record_group_trace(state: DemoState, body, response, detail: dict, *, policy_version: str,
                       decided_at, decide_ms: float | None) -> str | None:
    """AI10 판단 하나를 그룹 스트림에 넣는다. 응답은 바꾸지 않는다."""
    from app.demo.group_trace import build_group_trace
    key = group_key(body.group_run_id)
    if not state.buffer.allowed(key):
        return None
    stage, profile = state.profile_for(key)
    if state.routes is not None:
        state.routes.set_group_members(key, [p.user_id for p in body.participants])
    trace = build_group_trace(body, response, detail, boot_id=state.buffer.boot_id, seq=state.buffer.next_seq(),
                              stage=stage, label=profile.label, policy_version=policy_version,
                              decided_at=decided_at, decide_ms=decide_ms)
    state.buffer.append(key, trace)
    return trace["traceId"]

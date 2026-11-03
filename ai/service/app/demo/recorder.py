"""데모 버퍼 상태와 decide 기록 연결."""
import secrets
from dataclasses import dataclass

from app.demo.buffer import DemoBuffer
from app.demo.config import DemoSettings, RunProfile
from app.demo.trace import build_trace


@dataclass
class DemoState:
    settings: DemoSettings
    buffer: DemoBuffer
    rate_per_sec: int = 2

    @property
    def config(self):
        return self.settings.config

    def profile_for(self, session_id: int) -> tuple[str, RunProfile]:
        if self.config is None:
            raise KeyError(session_id)
        if session_id in self.config.replay:
            return "L3", self.config.replay[session_id]
        return self.config.live_stage, self.config.live


def new_demo_state(settings: DemoSettings, *, rate_per_sec: int = 2, now=None) -> DemoState:
    from datetime import datetime, timezone
    clock = now or (lambda: datetime.now(timezone.utc))
    allow = settings.config.session_allowlist if settings.config else None
    buffer = DemoBuffer(secrets.token_hex(4), allowlist=allow, now=clock)
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

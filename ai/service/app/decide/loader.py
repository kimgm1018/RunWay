"""예측기와 여유 표에 맞는 MPC 정책을 준비한다."""
import logging

from app.ai_logging import log_ai_error
from app.config import Settings
from app.decide.policy_port import PacePolicy
from app.policy import build_policy

def load_policy(settings: Settings) -> PacePolicy | None:
    try:
        return build_policy(settings.margin_table_path, settings.model_type)
    except Exception as exc:
        log_ai_error("POLICY_LOAD_FAILED", "startup", exc, level=logging.WARNING)
        return None

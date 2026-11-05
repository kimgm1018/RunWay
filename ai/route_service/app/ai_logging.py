"""민감한 값 없이 운영 오류 한 줄을 남긴다(ai/service/app/ai_logging.py와 같은 형식, logger runway.ai)."""
import logging


def log_ai_error(code: str, endpoint: str, cause, *, level: int = logging.ERROR) -> None:
    cause_name = cause if isinstance(cause, str) else type(cause).__name__
    logging.getLogger("runway.ai").log(
        level,
        "ai_error code=%s endpoint=%s cause=%s",
        code,
        endpoint,
        cause_name,
    )

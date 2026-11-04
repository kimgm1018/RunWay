"""Shared server-entity ID validation for RunWay AI request boundaries."""
from typing import Annotated

from pydantic import Field


MAX_SERVER_ID = (1 << 63) - 1
ServerId = Annotated[int, Field(strict=True, ge=1, le=MAX_SERVER_ID)]


def normalize_server_id(value):
    """Normalize current integer input and legacy decimal-string input to int.

    Decimal-string acceptance is a compatibility behavior only. The complete
    BIGINT JSON number versus string wire policy remains a team decision.
    """
    if isinstance(value, bool):
        raise ValueError("server ID must be a positive int64")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value and value.isascii() and value.isdigit() and len(value) <= 20:
        return int(value)
    raise ValueError("server ID must be a positive int64")

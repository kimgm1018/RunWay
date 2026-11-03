"""배포 Compose가 FREE_RUN_GRADE_POLICY를 앱에 전달하는지 확인한다(기본값은 사용자 확정 flat0)."""
from __future__ import annotations

import re

from test_feature_flag_delivery import _compose_environment


def test_compose_passes_free_run_grade_policy_with_flat0_default():
    expression = _compose_environment().get("FREE_RUN_GRADE_POLICY")

    assert expression is not None
    match = re.fullmatch(r"\$\{FREE_RUN_GRADE_POLICY:-([a-z0-9]+)\}", expression)
    assert match and match.group(1) == "flat0"


def test_compose_passes_ai_db_url_empty_by_default_and_personal_plan_flag_off():
    environment = _compose_environment()

    assert environment.get("AI_DB_URL") == "${AI_DB_URL:-}"
    assert environment.get("PERSONAL_PLAN_EXPERIMENTAL_ENABLED") == "${PERSONAL_PLAN_EXPERIMENTAL_ENABLED:-false}"

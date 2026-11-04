from __future__ import annotations

from test_feature_flag_delivery import _compose_environment


def test_compose_passes_gru_personalization_settings_with_defaults():
    environment = _compose_environment()
    assert environment.get("AI_DB_URL") == "${AI_DB_URL:-}"
    assert environment.get("GRU_PERSONALIZATION_ENABLED") == "${GRU_PERSONALIZATION_ENABLED:-false}"
    assert environment.get("GRU_PERSONALIZATION_MAX_WINDOWS") == "${GRU_PERSONALIZATION_MAX_WINDOWS:-2000}"
    assert environment.get("GRU_PERSONALIZATION_CACHE_TTL_SEC") == "${GRU_PERSONALIZATION_CACHE_TTL_SEC:-300}"
    assert environment.get("GRU_PERSONALIZATION_EMPTY_CACHE_TTL_SEC") == "${GRU_PERSONALIZATION_EMPTY_CACHE_TTL_SEC:-60}"
    assert environment.get("GRU_PERSONALIZATION_CACHE_MAX_USERS") == "${GRU_PERSONALIZATION_CACHE_MAX_USERS:-1024}"
    assert environment.get("GRU_PERSONALIZATION_DB_TIMEOUT_MS") == "${GRU_PERSONALIZATION_DB_TIMEOUT_MS:-300}"

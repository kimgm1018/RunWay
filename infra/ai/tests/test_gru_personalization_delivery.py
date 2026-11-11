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


def test_compose_turns_gru_gb_personalization_on_by_default():
    environment = _compose_environment()
    assert environment.get("GRU_GB_PERSONALIZATION_ENABLED") == "${GRU_GB_PERSONALIZATION_ENABLED:-true}"
    assert environment.get("GRU_GB_MAX_WINDOWS") == "${GRU_GB_MAX_WINDOWS:-3000}"


def _rendered(name, shell_value=None):
    import re
    variable, default = re.fullmatch(r"\$\{([A-Z0-9_]+):-([^}]*)\}", _compose_environment()[name]).groups()
    return shell_value if shell_value else default


def test_compose_gru_gb_default_and_override_reach_the_app(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from demo_fakes import FakeModel5, FakePolicy, fixed_clock

    for shell_value, expected in ((None, True), ("false", False)):
        monkeypatch.setenv("GRU_GB_PERSONALIZATION_ENABLED", _rendered("GRU_GB_PERSONALIZATION_ENABLED", shell_value))
        app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0), ode_loader=lambda: None)
        with TestClient(app):
            assert app.state.gru_gb_enabled is expected


def test_code_default_stays_off_without_env(monkeypatch):
    from app.gru_gb import gru_gb_enabled

    monkeypatch.delenv("GRU_GB_PERSONALIZATION_ENABLED", raising=False)
    assert gru_gb_enabled() is False

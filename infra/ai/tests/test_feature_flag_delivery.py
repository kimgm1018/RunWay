from __future__ import annotations

import re
import sys
from pathlib import Path

from fastapi.testclient import TestClient

SERVICE_TESTS = Path(__file__).resolve().parents[3] / "ai" / "service" / "tests"
sys.path.insert(0, str(SERVICE_TESTS))

from app.main import create_app
from demo_fakes import FakeModel5, FakePolicy, decide_body, fixed_clock

COMPOSE = Path(__file__).resolve().parents[1] / "compose.yaml"
FLAGS = ("ODE_PREVIEW_ENABLED", "DECIDE_FORECAST_ENABLED", "GROUP_PACE_ENABLED")


def _compose_environment() -> dict[str, str]:
    """Read scalar entries from the compose service's environment mapping."""
    lines = COMPOSE.read_text(encoding="utf-8").splitlines()
    values: dict[str, str] = {}
    in_environment = False
    for line in lines:
        if line == "    environment:":
            in_environment = True
            continue
        if in_environment and line and not line.startswith("      "):
            break
        if not in_environment:
            continue
        match = re.fullmatch(r"      ([A-Z0-9_]+):\s*(.*?)\s*", line)
        if match:
            values[match.group(1)] = match.group(2).strip("\"'")
    return values


def _render_flag_values(shell_values: dict[str, str]) -> dict[str, str]:
    expressions = _compose_environment()
    rendered: dict[str, str] = {}
    for name in FLAGS:
        expression = expressions.get(name)
        if expression is None:
            continue
        match = re.fullmatch(r"\$\{([A-Z0-9_]+)(?::-([^}]*))?\}", expression)
        if not match:
            rendered[name] = expression
            continue
        variable, default = match.groups()
        supplied = shell_values.get(variable)
        rendered[name] = supplied if supplied else (default or "")
    return rendered


def _set_service_flags(monkeypatch, shell_values: dict[str, str]) -> None:
    rendered = _render_flag_values(shell_values)
    for name in FLAGS:
        monkeypatch.delenv(name, raising=False)
    for name, value in rendered.items():
        monkeypatch.setenv(name, value)


def _client() -> TestClient:
    # decide_body의 inputAsOf는 고정값이라 그 3초 뒤 시계를 넣어, 실제 시각과 무관하게 20초 신선도 검사를 통과시킨다.
    return TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0),
                                 ode_loader=lambda: None))


def test_compose_feature_flags_default_off_at_api_consumers(monkeypatch):
    _set_service_flags(monkeypatch, {})
    with _client() as client:
        plan = client.post("/v1/pace/plan", json={"targetDistanceM": 5000, "targetDurationSec": 1650})
        decide_body_value = decide_body()
        decide_body_value["includeForecast"] = True
        decide = client.post("/v1/pace/decide", json=decide_body_value)
        assert client.get("/health").json()["components"]["groupPace"]["enabled"] is False

    assert plan.status_code == 200
    assert "ODE_MODEL_NOT_READY" not in [warning["code"] for warning in plan.json()["warnings"]]
    assert decide.status_code == 200
    assert decide.json()["forecast"]["status"] == "DISABLED"


def test_compose_feature_flag_overrides_reach_api_consumers(monkeypatch):
    _set_service_flags(monkeypatch, {
        "ODE_PREVIEW_ENABLED": "true",
        "DECIDE_FORECAST_ENABLED": "true",
        "GROUP_PACE_ENABLED": "true",
    })
    with _client() as client:
        plan = client.post("/v1/pace/plan", json={"targetDistanceM": 5000, "targetDurationSec": 1650})
        decide_body_value = decide_body()
        decide_body_value["includeForecast"] = True
        decide = client.post("/v1/pace/decide", json=decide_body_value)
        assert client.get("/health").json()["components"]["groupPace"]["enabled"] is True

    assert plan.status_code == 200
    assert "ODE_MODEL_NOT_READY" in [warning["code"] for warning in plan.json()["warnings"]]
    assert decide.status_code == 503
    assert decide.json()["code"] == "MODEL_NOT_READY"

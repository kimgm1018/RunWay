from __future__ import annotations

from pathlib import Path

import pytest

from app.demo.config import load_demo_settings
from test_feature_flag_delivery import _compose_environment

DEMO_ENV = ("DEMO_STREAM_ENABLED", "DEMO_VIEW_TOKEN", "DEMO_INGEST_TOKEN", "DEMO_CONFIG_PATH")
INFRA = Path(__file__).resolve().parents[2]


def _render(shell: dict[str, str]) -> dict[str, str]:
    rendered = {}
    for name, expression in _compose_environment().items():
        if name not in DEMO_ENV:
            continue
        variable, default = expression[2:-1].split(":-", 1)
        rendered[name] = shell.get(variable) or default
    return rendered


def test_compose_passes_demo_settings_with_off_default():
    environment = _compose_environment()
    assert environment.get("DEMO_STREAM_ENABLED") == "${DEMO_STREAM_ENABLED:-false}"
    for name in DEMO_ENV[1:]:
        assert environment.get(name) == "${%s:-}" % name


def test_demo_stays_off_without_server_values(monkeypatch):
    for name, value in _render({}).items():
        monkeypatch.setenv(name, value)
    assert load_demo_settings().enabled is False


def test_demo_values_pass_through_and_enable(monkeypatch, tmp_path):
    config = tmp_path / "demo_config.json"
    config.write_text('{"live": {"label": "live", "mode": "FREE", "goal": {}}, "sessionAllowlist": null}',
                      encoding="utf-8")
    shell = {"DEMO_STREAM_ENABLED": "true", "DEMO_VIEW_TOKEN": "v" * 32,
             "DEMO_INGEST_TOKEN": "i" * 32, "DEMO_CONFIG_PATH": str(config)}
    rendered = _render(shell)
    assert rendered == shell
    for name, value in rendered.items():
        monkeypatch.setenv(name, value)
    settings = load_demo_settings()
    assert settings.enabled is True
    assert settings.view_token == "v" * 32 and settings.config.session_allowlist is None


def test_nginx_routes_admin_demo_without_basic_auth_and_sse():
    nginx = INFRA / "nginx" / "default.conf"
    if not nginx.exists():  # AI 테스트 이미지에는 infra/ai만 들어간다
        pytest.skip("infra/nginx is not in the AI test image")
    conf = nginx.read_text(encoding="utf-8")
    page = conf.split("location /admin/demo/ {", 1)[1].split("}", 1)[0]
    assert "auth_basic" not in page                       # 718: 페이지 안 보기 토큰만 쓴다(SSE는 AI가 401)
    assert "rewrite ^/admin/demo/(.*)$ /demo/$1 break;" in page
    sse = conf.split("location ~ ^/v1/demo/sessions/", 1)[1].split("\n    }\n", 1)[0]
    for line in ("proxy_buffering off;", "proxy_read_timeout 3600s;", "proxy_http_version 1.1;",
                 'proxy_set_header Connection "";', "deny all;"):
        assert line in sse
    compose = (INFRA / "compose.yaml").read_text(encoding="utf-8")
    assert "name: runway-ai_default" in compose and "htpasswd" not in compose

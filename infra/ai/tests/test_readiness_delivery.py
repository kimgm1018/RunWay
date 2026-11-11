from __future__ import annotations

from test_feature_flag_delivery import _compose_environment


def test_compose_passes_readiness_flag_off_by_default():
    # S15P31E105-676: 준비도 민감도는 배포 기본도 꺼짐. 켜기는 팀이 정한다.
    assert _compose_environment().get("READINESS_ADJUST_ENABLED") == "${READINESS_ADJUST_ENABLED:-false}"


def test_app_has_no_readiness_lookup_unless_flag_on(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import create_app
    from demo_fakes import FakeModel5, FakePolicy, fixed_clock

    sentinel = object()
    for value, expected in ((None, None), ("false", None), ("true", sentinel)):
        if value is None:
            monkeypatch.delenv("READINESS_ADJUST_ENABLED", raising=False)
        else:
            monkeypatch.setenv("READINESS_ADJUST_ENABLED", value)
        app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3.0), ode_loader=lambda: None,
                         readiness_lookup=sentinel)
        with TestClient(app):
            assert app.state.readiness_lookup is expected

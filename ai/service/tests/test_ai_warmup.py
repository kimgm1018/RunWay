"""ODE가 준비됐을 때만 Adam 예열을 하고 모델 파라미터는 건드리지 않는다."""
from types import SimpleNamespace

import torch
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.ode.runtime import ODEv21Runtime
from demo_fakes import FakeModel5, FakePolicy


def test_ode_adam_warmup_does_not_change_model_parameters():
    runtime = object.__new__(ODEv21Runtime)
    runtime.torch = torch
    runtime.device = "cpu"
    runtime.model = torch.nn.Linear(2, 1)
    before = {name: value.detach().clone() for name, value in runtime.model.state_dict().items()}

    runtime.warmup_adam()

    assert all(torch.equal(before[name], value) for name, value in runtime.model.state_dict().items())


def test_startup_warms_only_a_loaded_ode_when_enabled(monkeypatch):
    calls = []
    runtime = SimpleNamespace(info=SimpleNamespace(model_version="warmup-test"),
                              warmup_adam=lambda: calls.append("loaded"))

    monkeypatch.setenv("ODEV21_WARMUP_ENABLED", "true")
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(),
                               ode_loader=lambda: runtime)) as client:
        assert client.get("/health").status_code == 200
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(),
                               ode_loader=lambda: None)) as client:
        assert client.get("/health").status_code == 200
    monkeypatch.setenv("ODEV21_WARMUP_ENABLED", "false")
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(),
                               ode_loader=lambda: runtime)) as client:
        assert client.get("/health").status_code == 200

    assert calls == ["loaded"]

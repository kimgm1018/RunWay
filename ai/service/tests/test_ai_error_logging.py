"""오류 로그는 형식·예외 종류만 남기고 민감한 문자열은 빼는지 확인한다."""
import logging

from fastapi.testclient import TestClient

from app.gru_personalization import (NOT_FOUND_WARNING, GruPersonalizationResult,
                                    lookup_user_personalization)
from app.main import create_app
from demo_fakes import FakeModel5, FakePolicy, decide_body, fixed_clock


def test_ai03_and_ai04_server_errors_log_code_endpoint_and_exception_type(caplog):
    private_text = "postgresql://reader:secret@db/path userId=73 hrBpm=189"

    class BrokenModel(FakeModel5):
        def predict(self, _batch):
            raise ValueError(private_text)

    caplog.set_level(logging.ERROR, logger="runway.ai")
    with TestClient(create_app(lambda: BrokenModel(), lambda: FakePolicy(), ode_loader=lambda: None),
                    raise_server_exceptions=False) as client:
        ai03 = client.post("/v1/hr/predict", json={
            "elapsedSec": 995.0,
            "history": {"hrBpm": [150.0] * 80, "speedMps": [3.0] * 80, "gradePct": [0.0] * 80},
            "candidates": [{"futureSpeedMps": [3.0] * 24, "futureGradePct": [0.0] * 24}],
        })
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy(raise_error=True),
                               clock=fixed_clock(3.0), ode_loader=lambda: None),
                    raise_server_exceptions=False) as client:
        ai04 = client.post("/v1/pace/decide", json=decide_body())

    messages = [record.getMessage() for record in caplog.records if record.name == "runway.ai"]
    assert ai03.status_code == 500 and ai04.status_code == 500
    assert "ai_error code=PREDICTION_FAILED endpoint=/v1/hr/predict cause=ValueError" in messages
    assert "ai_error code=DECISION_FAILED endpoint=/v1/pace/decide cause=RuntimeError" in messages
    assert private_text not in caplog.text
    assert "postgresql://" not in caplog.text and "userId=73" not in caplog.text


def test_gru_personalization_warning_logs_code_without_user_id_or_payload(caplog):
    class WarningLookup:
        def get_for_model(self, _user_id, _model):
            return GruPersonalizationResult(warning=NOT_FOUND_WARNING)

    caplog.set_level(logging.WARNING, logger="runway.ai")

    result = lookup_user_personalization(
        WarningLookup(), 73, object(), endpoint="/v1/pace/decide")

    assert result.warning == NOT_FOUND_WARNING
    assert f"ai_error code={NOT_FOUND_WARNING} endpoint=/v1/pace/decide cause=Warning" \
        in caplog.text
    assert "73" not in caplog.text and "userId" not in caplog.text

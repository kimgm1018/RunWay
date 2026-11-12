from fastapi.testclient import TestClient
from app.main import create_app
from app.demo.config import load_demo_settings
from demo_fakes import FakeModel5, FakePolicy, demo_settings, demo_client, decide_body, fixed_clock


def test_disabled_by_default(monkeypatch):
    for k in ("DEMO_STREAM_ENABLED", "DEMO_VIEW_TOKEN", "DEMO_INGEST_TOKEN", "DEMO_CONFIG_PATH"): monkeypatch.delenv(k, raising=False)
    assert load_demo_settings().enabled is False
    with TestClient(create_app(lambda: FakeModel5(), lambda: FakePolicy())) as c:
        events = c.get("/v1/demo/sessions/1/events")
        batches = c.post("/v1/demo/sessions/1/batches", json={})
        assert events.status_code == 503 and events.json()["code"] == "DEMO_DISABLED"
        assert batches.status_code == 503 and batches.json()["code"] == "DEMO_DISABLED"
        assert c.get("/demo/").status_code == 404


def test_short_tokens_disable(monkeypatch, tmp_path):
    demo_settings(tmp_path)
    monkeypatch.setenv("DEMO_STREAM_ENABLED", "true"); monkeypatch.setenv("DEMO_VIEW_TOKEN", "short")
    monkeypatch.setenv("DEMO_INGEST_TOKEN", "i" * 32); monkeypatch.setenv("DEMO_CONFIG_PATH", str(tmp_path / "demo.json"))
    assert load_demo_settings().enabled is False


def test_config_parses(tmp_path):
    cfg = demo_settings(tmp_path).config
    assert cfg.live_stage == "L1A" and 900000001 in cfg.replay and cfg.live.course.length_m > 0
    assert cfg.skip_payload_hash_device_ids == frozenset({900000101})


def test_decide_records_trace(tmp_path):
    with demo_client(tmp_path) as c:
        r = c.post("/v1/pace/decide", json=decide_body()).json()
        t = c.app.state.demo.buffer.traces(201)[-1]
    assert r["traceId"] == t["traceId"] and t["stage"] == "L1A" and t["coaching"]["delivery"] == "WATCH"


def test_not_allowed_session_has_no_trace(tmp_path):
    with demo_client(tmp_path, allow=frozenset({999})) as c:
        assert c.post("/v1/pace/decide", json=decide_body()).json()["traceId"] is None


def test_insufficient_decide_still_records(tmp_path):
    with demo_client(tmp_path, after=25.0) as c:
        assert c.post("/v1/pace/decide", json=decide_body()).status_code == 422
        assert c.app.state.demo.buffer.traces(201)[-1]["status"] == "INPUT_INSUFFICIENT"


def test_logs_and_errors_have_no_health_values(tmp_path, caplog):
    import logging; caplog.set_level(logging.DEBUG)
    with demo_client(tmp_path, after=25.0) as c:
        r = c.post("/v1/pace/decide", json=decide_body(history={"hrBpm": [187.123] * 80, "speedMps": [3.456] * 80}))
    assert "187.123" not in caplog.text and "3.456" not in caplog.text and "187.123" not in r.text


def test_boot_id_changes_between_apps(tmp_path):
    with demo_client(tmp_path) as c1, demo_client(tmp_path) as c2:
        assert c1.app.state.demo.buffer.boot_id != c2.app.state.demo.buffer.boot_id


def test_static_served_when_enabled(tmp_path):
    with demo_client(tmp_path) as c:
        r = c.get("/demo/")
    assert r.status_code == 200 and "<title>" in r.text


def test_decide_trace_carries_display_speed(tmp_path):
    # 724 표시용: 최근 속도 12칸 평균. 응답 계약에는 없다
    with demo_client(tmp_path) as c:
        r = c.post("/v1/pace/decide", json=decide_body())
        t = c.app.state.demo.buffer.traces(201)[-1]
    assert t["input"]["speedNowMps"] == 3.0 and "speedNowMps" not in r.text

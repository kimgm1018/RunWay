"""S15P31E105-441 코드 리뷰 수정의 재현 테스트(데이터 불필요). 수정 전 코드에서는 각 테스트가 실패한다.

R1  PBF 0개·여러 개의 SystemExit -> phase failed / 503 UNAVAILABLE (이전: 시작 스레드만 죽고 loading에 머묾)
R6  응답 조립 중 예외·NaN 직렬화 -> 500 INTERNAL {code, message, details} + ai_error 로그 (이전: FastAPI 기본 500)
R9  /health/live, /internal/v1/ready는 async (thread pool이 다 차도 바로 답함)
R10 Gate 검토 로그에 규칙 파일 해시(gate_files_sha256)
R11 엔진 on/off 환경변수는 "0"/"1"만 허용 (이전: "false"도 켜짐)
R12 next_seed가 seed 허용 범위를 넘지 않음
"""
import asyncio
import json
import logging
import math

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import ATTEMPTS, Engine, create_app, next_seed
from app.schemas import SEED_MAX
from runway_routing.env_flags import flag
from test_api import BODY, READY, URL, FakePipeline, GraphPipeline, _route, assert_error, client, loop_out, settings


# ------------------------------------------------------------------ R1
@pytest.mark.parametrize("background", [False, True])
def test_pbf_system_exit_is_start_failure(tmp_path, background):
    def no_pbf(_):
        raise SystemExit("expected one Busan extract in data/osm/busan, found 0; run `extract`")

    app = create_app(settings(tmp_path), no_pbf, background=background)
    with TestClient(app) as c:
        engine = app.state.engine
        for _ in range(200):          # background: the start thread ends quickly
            if engine.phase != "loading":
                break
            asyncio.run(asyncio.sleep(0.01))
        r = c.get(READY)
        assert r.status_code == 503 and r.json()["phase"] == "failed"
        assert_error(c.post(URL, json=BODY), 503, "UNAVAILABLE")
    assert engine.error.startswith("SystemExit: expected one Busan extract")


def test_warmup_system_exit_is_start_failure(tmp_path):
    c, _ = client(tmp_path, FakePipeline(exc=SystemExit("found 2")))
    with c:
        assert c.get(READY).json()["phase"] == "failed"


def test_keyboard_interrupt_is_not_swallowed(tmp_path):
    def interrupted(_):
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        Engine(settings(tmp_path), interrupted).start()


# ------------------------------------------------------------------ R6
@pytest.mark.parametrize("debug", [False, True])
def test_assembly_error_is_internal_and_logged(tmp_path, caplog, debug):
    out = loop_out(baseline=[_route(baseline_score=None)])          # score lookup raises TypeError while assembling
    out["canonical"]["start"]["shift_to_main_m"] = 0
    c, pipe = client(tmp_path, GraphPipeline(out), debug=debug, warmup=False)
    with caplog.at_level(logging.ERROR, logger="runway.ai"), c:
        j = assert_error(c.post(URL, json=BODY), 500, "INTERNAL")
        assert pipe.lock.acquire(timeout=0)
        pipe.lock.release()
    assert ("debug" in j) is debug and j["details"] is None
    assert "ai_error code=INTERNAL endpoint=/internal/v1/routes/recommendations cause=TypeError" in caplog.text


def test_non_finite_number_in_response_is_internal(tmp_path, caplog):
    out = loop_out(baseline=[_route(baseline_score={"score": math.nan, "terms": []})])
    c, _ = client(tmp_path, GraphPipeline(out), warmup=False)
    with caplog.at_level(logging.ERROR, logger="runway.ai"), c:
        assert_error(c.post(URL, json=BODY), 500, "INTERNAL")
    assert "cause=ValueError" in caplog.text


def test_assembled_success_still_200(tmp_path):
    out = loop_out(baseline=[_route()])
    c, _ = client(tmp_path, GraphPipeline(out), warmup=False)
    with c:
        r = c.post(URL, json=BODY)
    assert r.status_code == 200, r.text
    assert list(r.json()) == ["routes", "notices", "next_seed"] and r.json()["next_seed"] == 1 + ATTEMPTS


# ------------------------------------------------------------------ R9
def test_probes_are_async(tmp_path):
    app = create_app(settings(tmp_path), lambda s: FakePipeline(), background=False)
    eps = {r.path: r.endpoint for r in app.routes if hasattr(r, "endpoint")}
    assert asyncio.iscoroutinefunction(eps["/health/live"])
    assert asyncio.iscoroutinefunction(eps[READY])


# ------------------------------------------------------------------ R10
def test_gate_log_keeps_rule_file_hashes(tmp_path):
    files = {"ug-v1.json": "a" * 64, "ug-v2.json": "b" * 64, "usability_gate.py": "c" * 64}
    out = loop_out([{"code": "NO_CANDIDATE_IN_TOLERANCE", "message": "x", "blocking": True}])
    out["usability"] = {"mode": "enforce", "skipped": "no valid candidate", "gate_version": {"config_version": "v"}}
    pipe = FakePipeline(out)
    pipe.gate = type("G", (), {"files": files})()
    c, _ = client(tmp_path, pipe, warmup=False)
    with c:
        assert_error(c.post(URL, json=BODY), 422, "NO_ROUTE")
    (log,) = (tmp_path / "gate").glob("usability_gate_*.jsonl")
    rec = json.loads(log.read_text(encoding="utf-8"))
    assert list(rec)[:4] == ["ts", "request", "gate_version", "gate_files_sha256"]
    assert rec["gate_files_sha256"] == files


# ------------------------------------------------------------------ R11
@pytest.mark.parametrize("raw,want", [(None, True), ("1", True), ("0", False)])
def test_env_flag_normal_values(monkeypatch, raw, want):
    if raw is None:
        monkeypatch.delenv("RUNWAY_TEST_FLAG", raising=False)
    else:
        monkeypatch.setenv("RUNWAY_TEST_FLAG", raw)
    assert flag("RUNWAY_TEST_FLAG") is want


@pytest.mark.parametrize("raw", ["false", "off", "no", "true", " 0", "0 ", "", "2"])
def test_env_flag_rejects_other_values(monkeypatch, raw):
    monkeypatch.setenv("RUNWAY_TEST_FLAG", raw)
    with pytest.raises(ValueError, match="RUNWAY_TEST_FLAG must be 0 or 1"):
        flag("RUNWAY_TEST_FLAG")


def test_fast_graph_typo_is_rejected(monkeypatch):
    monkeypatch.setenv("RUNWAY_FAST_GRAPH", "false")       # before: != "0", so the fast builder silently stayed on
    with pytest.raises(ValueError, match="RUNWAY_FAST_GRAPH"):
        load_settings()
    monkeypatch.setenv("RUNWAY_FAST_GRAPH", "0")
    assert load_settings().fast_graph is False


# ------------------------------------------------------------------ R12
def test_next_seed_stays_in_range():
    assert next_seed(1) == 1 + ATTEMPTS
    assert next_seed(SEED_MAX - ATTEMPTS) == SEED_MAX
    assert next_seed(SEED_MAX - ATTEMPTS + 1) == 1
    assert next_seed(SEED_MAX) == ATTEMPTS
    assert all(1 <= next_seed(s) <= SEED_MAX for s in range(SEED_MAX - 50, SEED_MAX + 1))


def test_next_seed_at_the_top_is_accepted_again(tmp_path):
    out = loop_out(baseline=[_route()])
    c, _ = client(tmp_path, GraphPipeline(out), warmup=False)
    with c:
        j = c.post(URL, json={**BODY, "seed": SEED_MAX}).json()
        assert j["next_seed"] == ATTEMPTS
        assert c.post(URL, json={**BODY, "seed": j["next_seed"]}).status_code == 200


# ------------------------------------------------------------------ R15
def test_half_built_graph_is_not_cached(monkeypatch):
    """running-suitability 계산이 실패한 graph는 LRU에 남지 않는다(이전: 다음 요청이 rs 속성 없는 graph를 받음)."""
    import types
    from runway_routing import graph as G

    def boom(cg, cfg):
        raise RuntimeError("boom")

    monkeypatch.setattr(G, "build_request_graph", lambda *a: types.SimpleNamespace())
    monkeypatch.setattr(G, "traffic_node_distance", boom)
    gen = types.SimpleNamespace(working_radius_m=lambda t: 3000.0)
    data = types.SimpleNamespace(env=None, thresholds=None, dem=None, cache=None, rs_cfg={})
    store = G.GraphStore(gen, data)
    with pytest.raises(RuntimeError):
        store.get(35.15, 129.11, 5000)
    assert len(store._graphs) == 0


# ------------------------------------------------------------------ R7 (정책 변경 허용 후)
@pytest.mark.parametrize("exc", [IndexError("arrays used as indices must be of integer (or boolean) type"),
                                 ValueError("attempt to get argmax of an empty sequence"),
                                 ValueError("Found no graph nodes within the requested polygon.")])
def test_no_usable_road_is_422(tmp_path, caplog, exc):
    c, _ = client(tmp_path, FakePipeline(exc=exc), warmup=False)
    with caplog.at_level(logging.WARNING, logger="runway.ai"), c:
        assert_error(c.post(URL, json=BODY), 422, "NO_ROAD_NEARBY")     # before: 500 INTERNAL
    assert "ai_error code=NO_USABLE_ROAD" in caplog.text


@pytest.mark.parametrize("exc", [IndexError("list index out of range"), ValueError("something else")])
def test_other_index_value_errors_stay_internal(tmp_path, exc):
    c, _ = client(tmp_path, FakePipeline(exc=exc), warmup=False)
    with c:
        assert_error(c.post(URL, json=BODY), 500, "INTERNAL")


# ------------------------------------------------------------------ R8
def test_250m_limit_uses_actual_start_after_shift(tmp_path):
    out = loop_out(snap_m=20.0, baseline=[_route()])
    out["canonical"]["start"]["shift_to_main_m"] = 312.0     # nearest road 20 m is isolated; real start 312 m away
    c, _ = client(tmp_path, GraphPipeline(out), warmup=False)
    with c:
        j = assert_error(c.post(URL, json=BODY), 422, "NO_ROAD_NEARBY")   # before: 200 with a 312 m walk to the start
    assert "312 m" in j["message"]


def test_shift_within_250m_still_ok(tmp_path):
    out = loop_out(snap_m=20.0, baseline=[_route()])
    out["canonical"]["start"]["shift_to_main_m"] = 120.0
    c, _ = client(tmp_path, GraphPipeline(out), warmup=False)
    with c:
        assert c.post(URL, json=BODY).status_code == 200


def test_start_distance_m():
    from runway_routing.snap import start_distance_m
    assert start_distance_m({"snap_node_dist_m": 20.0, "shift_to_main_m": 0.0}) == 20.0
    assert start_distance_m({"snap_node_dist_m": 20.0, "shift_to_main_m": 312.0}) == 312.0
    assert start_distance_m({"snap_node_dist_m": 20.0}) == 20.0


# ------------------------------------------------------------------ R13
@pytest.mark.parametrize("out,code", [(loop_out([{"code": "NO_CANDIDATE_IN_TOLERANCE", "message": "x", "blocking": True}]), "NO_ROUTE"),
                                      (loop_out([{"code": "OUTSIDE_CANONICAL_EXTRACT", "message": "x", "blocking": True}]), "OUT_OF_AREA")])
def test_warmup_4xx_is_start_failure(tmp_path, out, code):
    c, _ = client(tmp_path, GraphPipeline(out))
    with c:
        r = c.get(READY)
        assert r.status_code == 503 and r.json()["phase"] == "failed"      # before: ready
        assert_error(c.post(URL, json=BODY), 503, "UNAVAILABLE")
    assert code in c.app.state.engine.error


def test_warmup_success_is_ready(tmp_path):
    from test_api import ok_pipeline
    c, _ = client(tmp_path, ok_pipeline())
    with c:
        assert c.get(READY).json()["phase"] == "ready"

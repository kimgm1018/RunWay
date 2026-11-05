"""API 계약 테스트: 엔진 대신 가짜 pipeline으로 검증 오류·오류 코드·HTTP 상태·준비 상태·BUSY·deadline·debug 스위치를
확인한다(데이터 불필요). 계약: BE Route 내부 계약(MR !183)과 API.md.

실제 엔진 응답(성공 경로, 응답 필드)은 test_engine_api.py와 tools/route_regression/service_identity.py가 본다.
"""
import copy
import logging
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import ATTEMPTS, create_app

URL = "/internal/v1/routes/recommendations"
READY = "/internal/v1/ready"
BODY = {"lat": 35.1532, "lon": 129.1186, "distance_km": 5.0}
P2P = {**BODY, "shape": "point_to_point", "end_lat": 35.1587, "end_lon": 129.1604}
SHAPE_CFG = {"tolerance": {"value": 0.10}, "app_km": {"max": 15.0}, "snap_max_m": {"value": 250}}


class InsufficientResponseError(Exception):
    """osmnx 예외와 같은 이름(서비스는 이름으로 판단한다)."""


def loop_out(issues=(), snap_m=10.0, baseline=()):
    return {"request": {"generation_bias": None}, "issues": [dict(i) for i in issues],
            "canonical": {"start": {"snap_node_dist_m": snap_m, "node_lat": 35.0, "node_lon": 129.0}},
            "graph": None, "counts": {"attempts": 24, "generated": 0, "distinct": 0, "loop_valid": 0},
            "pool": [], "baseline": list(baseline), "preference": None}


def shape_out(issues=()):
    return {"request": {"attempts": 24}, "issues": [dict(i) for i in issues], "canonical": None, "graph": None,
            "counts": {}, "pool": [], "baseline": [], "preference": None,
            "shape": {"shape": "point_to_point", "route_type": "POINT_TO_POINT"}}


def issue(code, **extra):
    return {"code": code, "message": code, "blocking": True, **extra}


class FakePipeline:
    def __init__(self, out=None, exc=None):
        self.lock = threading.Lock()
        self.shape_cfg = SHAPE_CFG
        self.out, self.exc, self.calls = out if out is not None else loop_out(), exc, []

    def run(self, *args, **kw):
        self.calls.append((args, kw))
        if self.exc is not None:
            raise self.exc
        return copy.deepcopy(self.out)

    def graph(self, *args):
        return None


def _route(**over):
    r = {"features": {"distance_m": 5000.0, "distance_error_pct": 0.0}, "eids": [0], "coords": [[35.0, 129.0], [35.0, 129.0]],
         "baseline_score": {"score": 1.0, "terms": []}, "candidate_id": "c1"}
    r.update(over)
    return r


class _Graph:
    """explain/details/edges가 읽는 최소 graph(edge 1개)."""
    def __init__(self):
        import numpy as np
        import pandas as pd
        self.redges = pd.DataFrame({"osm_u": [1], "osm_v": [2]})
        self.ea = {"length": np.array([5000.0])}


class GraphPipeline(FakePipeline):
    def graph(self, *args):
        return _Graph()


def ok_pipeline():
    """예열이 성공하는(코스 1개) 가짜 pipeline. 441 R13부터 예열은 200이어야 ready다."""
    return GraphPipeline(loop_out(baseline=[_route()]))


def settings(tmp_path, debug=False, warmup=True):
    return Settings(debug=debug, warmup=warmup, gate_mode="enforce", fast_graph=True, usability_log_dir=tmp_path / "gate")


def client(tmp_path, pipeline=None, debug=False, warmup=True, factory=None):
    pipeline = pipeline or FakePipeline()
    app = create_app(settings(tmp_path, debug, warmup), factory or (lambda s: pipeline), background=False)
    return TestClient(app), pipeline


def assert_error(r, status, code):
    j = r.json()
    assert r.status_code == status, j
    assert j["code"] == code and isinstance(j["message"], str) and j["message"]
    assert "details" in j and "ok" not in j
    return j


# ------------------------------------------------------------------ readiness
def test_live_before_ready_and_ready_after_warmup(tmp_path):
    gate = threading.Event()
    pipe = ok_pipeline()

    def slow_factory(_):
        gate.wait(10)
        return pipe

    app = create_app(settings(tmp_path), slow_factory, background=True)
    with TestClient(app) as c:
        assert c.get("/health/live").status_code == 200
        r = c.get(READY)
        assert r.status_code == 503 and r.json()["ready"] is False and r.json()["phase"] == "loading"
        assert_error(c.post(URL, json=BODY), 503, "NOT_READY")
        gate.set()
        for _ in range(200):
            if c.get(READY).status_code == 200:
                break
            time.sleep(0.02)
        r = c.get(READY)
        assert r.status_code == 200 and r.json()["ready"] is True and r.json()["phase"] == "ready"
    assert len(pipe.calls) == 1                                    # the warm-up request ran once
    assert pipe.calls[0][1]["seed"] == 1 and pipe.calls[0][1]["attempts"] == ATTEMPTS
    assert not (tmp_path / "gate").exists()                        # warm-up writes no Gate review log


def test_old_paths_are_gone(tmp_path):
    c, _ = client(tmp_path, warmup=False)
    with c:
        assert c.get("/health/ready").status_code == 404
        assert c.post("/v1/courses/recommend", json=BODY).status_code == 404


def test_ready_without_warmup(tmp_path):
    c, pipe = client(tmp_path, warmup=False)
    with c:
        assert c.get(READY).json()["ready"] is True
    assert pipe.calls == []


@pytest.mark.parametrize("debug", [False, True])
def test_load_failure_is_unavailable(tmp_path, debug):
    def broken(_):
        raise RuntimeError("no extract")

    c, _ = client(tmp_path, debug=debug, factory=broken)
    with c:
        r = c.get(READY)
        assert r.status_code == 503 and r.json() == {"ready": False, "phase": "failed", "load_s": None, "warmup_s": None}
        j = assert_error(c.post(URL, json=BODY), 503, "UNAVAILABLE")
        assert ("debug" in j) is debug


def test_warmup_failure_is_not_ready(tmp_path):
    c, _ = client(tmp_path, FakePipeline(exc=ValueError("boom")))
    with c:
        assert c.get(READY).json()["phase"] == "failed"
        assert_error(c.post(URL, json=BODY), 503, "UNAVAILABLE")


# ------------------------------------------------------------------ request format (400)
@pytest.mark.parametrize("body,field", [
    ({"lat": 35.1, "lon": 129.1}, "distance_km"),
    ({**BODY, "shape": "zigzag"}, "shape"),
    ({**BODY, "seed": 0}, "seed"),
    ({**BODY, "seed": 10_000_001}, "seed"),
    ({**BODY, "lat": "north"}, "lat"),
    ({**BODY, "lat": 91}, "lat"),
    ({**BODY, "lon": -181}, "lon"),
    ({**BODY, "filters": {"flat": "very"}}, "filters.flat"),
    ({**BODY, "filters": {"hilly": True}}, "filters.hilly"),
])
def test_validation_error(tmp_path, body, field):
    c, pipe = client(tmp_path, warmup=False)
    with c:
        j = assert_error(c.post(URL, json=body), 400, "VALIDATION_ERROR")
    assert j["message"] == "요청 값이 유효하지 않습니다."
    assert field in [f["name"] for f in j["details"]["fields"]]
    assert pipe.calls == []


def test_non_finite_number_is_rejected(tmp_path):
    c, pipe = client(tmp_path, warmup=False)
    with c:
        r = c.post(URL, content='{"lat": NaN, "lon": 129.1, "distance_km": 5}', headers={"Content-Type": "application/json"})
    assert_error(r, 400, "VALIDATION_ERROR")
    assert pipe.calls == []


def test_unknown_top_level_field_is_ignored(tmp_path):
    c, pipe = client(tmp_path, FakePipeline(loop_out([issue("NO_CANDIDATE_IN_TOLERANCE")])), warmup=False)
    with c:
        assert_error(c.post(URL, json={**BODY, "extra": 1}), 422, "NO_ROUTE")
    assert len(pipe.calls) == 1


# ------------------------------------------------------------------ checks before the engine runs (422)
@pytest.mark.parametrize("body,code", [
    ({**BODY, "distance_km": 0.99}, "DISTANCE_RANGE"),
    ({**BODY, "distance_km": 15.01}, "DISTANCE_RANGE"),
    ({**BODY, "shape": "point_to_point"}, "DESTINATION_REQUIRED"),
    ({**BODY, "shape": "point_to_point", "end_lat": 35.1532}, "DESTINATION_REQUIRED"),
    ({**BODY, "shape": "point_to_point", "end_lat": 35.35, "end_lon": 129.1186}, "OUT_OF_APP_RANGE"),
])
def test_rejected_without_engine_call(tmp_path, body, code):
    c, pipe = client(tmp_path, warmup=False)
    with c:
        assert_error(c.post(URL, json=body), 422, code)
    assert pipe.calls == []


def test_distance_range_message(tmp_path):
    c, _ = client(tmp_path, warmup=False)
    with c:
        j = c.post(URL, json={**BODY, "distance_km": 20}).json()
    assert j == {"code": "DISTANCE_RANGE", "message": "거리는 1~15 km 사이로 정해 주세요.", "details": None}


# ------------------------------------------------------------------ engine results -> error codes
@pytest.mark.parametrize("out,status,code", [
    (loop_out([issue("OUTSIDE_CANONICAL_EXTRACT")]), 422, "OUT_OF_AREA"),
    (loop_out(snap_m=251.0), 422, "NO_ROAD_NEARBY"),
    (loop_out([issue("USABILITY_GATE_ALL_FAILED")]), 422, "USABILITY_GATE_ALL_FAILED"),
    (loop_out([issue("NO_CANDIDATE_IN_TOLERANCE")]), 422, "NO_ROUTE"),
    (shape_out([issue("END_SNAP_PE1")]), 422, "END_SNAP_PE1"),
    (shape_out([issue("END_SNAP_PE2")]), 422, "END_SNAP_PE2"),
    (shape_out([issue("END_SNAP_PE4")]), 422, "END_SNAP_PE4"),
    (shape_out([issue("END_SNAP_PE5")]), 422, "END_SNAP_PE5"),
    (loop_out([issue("FORBIDDEN_EDGE_USED")]), 500, "SAFETY_CHECK"),
    (shape_out([issue("SNAP_NODE_NOT_IN_GENERATION_GRAPH")]), 500, "SNAP_NODE_NOT_IN_GENERATION_GRAPH"),
])
def test_engine_error_codes(tmp_path, out, status, code):
    body = BODY if "shape" not in out else P2P
    c, _ = client(tmp_path, FakePipeline(out), warmup=False)
    with c:
        j = assert_error(c.post(URL, json=body), status, code)
    assert j["details"] is None and "debug" not in j


def test_no_road_message_has_distance(tmp_path):
    c, _ = client(tmp_path, FakePipeline(loop_out(snap_m=312.4)), warmup=False)
    with c:
        j = c.post(URL, json=BODY).json()
    assert "312 m" in j["message"]


def test_destination_too_far_carries_minimum_in_details(tmp_path):
    out = shape_out([issue("DESTINATION_TOO_FAR", min_target_km=9.4, alternatives_from_km=[9.4, 10.0])])
    c, _ = client(tmp_path, FakePipeline(out), warmup=False)
    with c:
        r = c.post(URL, json=P2P)
    assert r.status_code == 422
    assert r.json() == {"code": "DESTINATION_TOO_FAR", "message": "이 목적지까지는 최소 9.4 km가 필요합니다.",
                        "details": {"min_target_km": 9.4, "alternatives_from_km": [9.4, 10.0]}}


def test_insufficient_response_is_no_road_nearby(tmp_path):
    c, _ = client(tmp_path, FakePipeline(exc=InsufficientResponseError("empty")), warmup=False)
    with c:
        assert_error(c.post(URL, json=BODY), 422, "NO_ROAD_NEARBY")


@pytest.mark.parametrize("debug", [False, True])
def test_internal_error_is_500_and_logged(tmp_path, caplog, debug):
    c, pipe = client(tmp_path, FakePipeline(exc=KeyError("x")), debug=debug, warmup=False)
    with caplog.at_level(logging.ERROR, logger="runway.ai"), c:
        j = assert_error(c.post(URL, json=BODY), 500, "INTERNAL")
        assert pipe.lock.acquire(timeout=0)          # the lock was released after the exception
        pipe.lock.release()
    assert ("debug" in j) is debug
    assert "ai_error code=INTERNAL endpoint=/internal/v1/routes/recommendations cause=KeyError" in caplog.text


@pytest.mark.parametrize("debug", [False, True])
def test_debug_flag_on_error_response(tmp_path, debug):
    c, _ = client(tmp_path, FakePipeline(loop_out([issue("OUTSIDE_CANONICAL_EXTRACT")])), debug=debug, warmup=False)
    with c:
        j = c.post(URL, json=BODY).json()
    assert ("debug" in j) is debug
    if debug:
        assert j["debug"]["seed"] == 1 and j["debug"]["attempts"] == ATTEMPTS


# ------------------------------------------------------------------ admission (BUSY) and deadline (TIMEOUT)
def test_busy_when_slot_not_free_within_one_second(tmp_path):
    pipe = FakePipeline(loop_out([issue("NO_CANDIDATE_IN_TOLERANCE")]))
    c, _ = client(tmp_path, pipe, warmup=False)
    with c:
        pipe.lock.acquire()
        try:
            t0 = time.perf_counter()
            assert_error(c.post(URL, json=BODY), 503, "BUSY")
            waited = time.perf_counter() - t0
        finally:
            pipe.lock.release()
        assert 0.9 <= waited < 3.0
        assert_error(c.post(URL, json=BODY), 422, "NO_ROUTE")   # free again
    assert len(pipe.calls) == 1


def test_waits_for_slot_freed_within_one_second(tmp_path):
    pipe = FakePipeline(loop_out([issue("NO_CANDIDATE_IN_TOLERANCE")]))
    c, _ = client(tmp_path, pipe, warmup=False)
    with c:
        pipe.lock.acquire()
        threading.Timer(0.3, pipe.lock.release).start()
        assert_error(c.post(URL, json=BODY), 422, "NO_ROUTE")
    assert len(pipe.calls) == 1


def test_deadline_already_passed_is_timeout_without_compute(tmp_path):
    c, pipe = client(tmp_path, warmup=False)
    with c:
        past = str(int(time.time() * 1000) - 1)
        assert_error(c.post(URL, json=BODY, headers={"X-Request-Deadline": past}), 503, "TIMEOUT")
    assert pipe.calls == []


def test_deadline_passed_while_waiting_for_slot(tmp_path):
    pipe = FakePipeline(loop_out([issue("NO_CANDIDATE_IN_TOLERANCE")]))
    c, _ = client(tmp_path, pipe, warmup=False)
    with c:
        pipe.lock.acquire()
        threading.Timer(0.5, pipe.lock.release).start()
        soon = str(int(time.time() * 1000) + 200)
        assert_error(c.post(URL, json=BODY, headers={"X-Request-Deadline": soon}), 503, "TIMEOUT")
    assert pipe.calls == []


def test_future_deadline_runs(tmp_path):
    pipe = FakePipeline(loop_out([issue("NO_CANDIDATE_IN_TOLERANCE")]))
    c, _ = client(tmp_path, pipe, warmup=False)
    with c:
        later = str(int(time.time() * 1000) + 60_000)
        assert_error(c.post(URL, json=BODY, headers={"X-Request-Deadline": later}), 422, "NO_ROUTE")
    assert len(pipe.calls) == 1


def test_bad_deadline_header_is_400(tmp_path):
    c, pipe = client(tmp_path, warmup=False)
    with c:
        j = assert_error(c.post(URL, json=BODY, headers={"X-Request-Deadline": "soon"}), 400, "VALIDATION_ERROR")
    assert j["details"]["fields"][0]["name"] == "X-Request-Deadline"
    assert pipe.calls == []

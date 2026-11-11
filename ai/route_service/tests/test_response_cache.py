"""추천 성공 응답 cache(S15P31E105-630, app/response_cache.py) 테스트: 가짜 pipeline으로 hit/miss·key·TTL·LRU·끄기 스위치·
엔진 lock·재추천·오류 미저장을 확인한다(데이터 불필요)."""
import logging
import threading
import time
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app import response_cache
from app.config import load_settings
from app.main import ATTEMPTS, create_app
from app.schemas import RecommendRequest
from test_api import BODY, URL, READY, GraphPipeline, _route, issue, loop_out, settings


def ok_pipe():
    return GraphPipeline(loop_out(baseline=[_route()]))


def make(tmp_path, pipe=None, **over):
    pipe = pipe or ok_pipe()
    s = replace(settings(tmp_path, warmup=False), **over)
    app = create_app(s, lambda _: pipe, background=False)
    return app, pipe


def stats(c):
    return c.get(READY).json()["response_cache"]


# ------------------------------------------------------------------ ResponseCache 단위
def test_cache_ttl_and_lru():
    now = [0.0]
    c = response_cache.ResponseCache(size=2, ttl_s=600, clock=lambda: now[0])
    c.put("a", b"A")
    c.put("b", b"B")
    assert c.get("a") == (b"A", None)       # a를 최근으로
    c.put("c", b"C")                         # 가장 오래 안 쓴 b가 밀려남
    assert c.get("b") is None and c.get("a") == (b"A", None) and c.get("c") == (b"C", None)
    now[0] = 600.5
    assert c.get("a") is None and len(c) == 1    # TTL 지나면 miss, 지운다
    assert c.stats() == {"entries": 1, "hits": 3, "misses": 2, "puts": 3, "bytes": 1}
    assert c.get("zz", count_miss=False) is None and c.misses == 2


def test_cache_size_zero_stores_nothing():
    c = response_cache.ResponseCache(size=0)
    c.put("a", b"A")
    assert len(c) == 0 and c.get("a") is None


def test_key_covers_every_request_field_and_settings(tmp_path):
    s = settings(tmp_path)
    base = RecommendRequest(**BODY)
    k = response_cache.request_key(base, s)
    assert k == response_cache.request_key(RecommendRequest(**BODY), s)          # 같은 요청 = 같은 key
    assert k == response_cache.request_key(RecommendRequest(**BODY, extra=1), s)  # 무시되는 최상위 필드
    variants = [{"seed": 2}, {"distance_km": 5.1}, {"lat": 35.1533}, {"lon": 129.1187},
                {"filters": {"park": True}}, {"filters": {"flat": True}}, {"shape": "out_and_back"},
                {"end_lat": 35.2, "end_lon": 129.2}]
    keys = {response_cache.request_key(RecommendRequest(**{**BODY, **v}), s) for v in variants}
    assert len(keys) == len(variants) and k not in keys
    for over in ({"gate_mode": "shadow"}, {"fast_graph": False}, {"reroll_exclude": False}, {"debug": True}):
        assert response_cache.request_key(base, replace(s, **over)) != k


# ------------------------------------------------------------------ 서비스
def test_hit_returns_identical_bytes_without_engine_call(tmp_path, caplog):
    app, pipe = make(tmp_path)
    with TestClient(app) as c, caplog.at_level(logging.INFO, logger="runway.ai"):
        r1 = c.post(URL, json=BODY)
        r2 = c.post(URL, json=BODY)
        assert r1.status_code == r2.status_code == 200
        assert r2.content == r1.content and r2.headers["content-type"] == r1.headers["content-type"]
        assert r2.headers["content-length"] == r1.headers["content-length"]
        assert len(pipe.calls) == 1
        assert stats(c) == {"entries": 1, "hits": 1, "misses": 1, "puts": 1, "bytes": len(r1.content)}
    msgs = [r.getMessage() for r in caplog.records]
    assert any(m.startswith("route_response_cache miss key=") for m in msgs)
    assert any(m.startswith("route_response_cache hit key=") and "stage=before_lock" in m for m in msgs)
    assert not any(str(BODY["lat"]) in m for m in msgs if "route_response_cache" in m)   # 좌표는 로그에 없다


def test_cached_body_equals_fresh_run_without_cache(tmp_path):
    a, _ = make(tmp_path)
    b, _ = make(tmp_path, response_cache=False)
    with TestClient(a) as ca, TestClient(b) as cb:
        body = {**BODY, "seed": 7, "filters": {"park": True, "flat": True}}
        ca.post(URL, json=body)
        hit = ca.post(URL, json=body)
        fresh = cb.post(URL, json=body)
        assert hit.status_code == fresh.status_code == 200 and hit.content == fresh.content


@pytest.mark.parametrize("change", [{"seed": 2}, {"filters": {"park": True}}, {"distance_km": 6.0},
                                    {"end_lat": 35.2, "end_lon": 129.2}, {"lat": 35.1533}])
def test_different_request_misses(tmp_path, change):
    app, pipe = make(tmp_path)
    with TestClient(app) as c:
        assert c.post(URL, json=BODY).status_code == 200
        assert c.post(URL, json={**BODY, **change}).status_code == 200
        assert len(pipe.calls) == 2


def test_deadline_header_is_not_in_key_and_hit_ignores_expired_deadline(tmp_path):
    app, pipe = make(tmp_path)
    with TestClient(app) as c:
        future = str(int(time.time() * 1000) + 60_000)
        r1 = c.post(URL, json=BODY, headers={"X-Request-Deadline": future})
        past = str(int(time.time() * 1000) - 1_000)
        r2 = c.post(URL, json=BODY, headers={"X-Request-Deadline": past})   # 계산 없이 바로 답할 수 있으므로 hit
        assert r2.status_code == 200 and r2.content == r1.content and len(pipe.calls) == 1


def test_ttl_expiry_recomputes(tmp_path):
    app, pipe = make(tmp_path, response_cache_ttl_s=600.0)
    now = [0.0]
    app.state.engine.responses.clock = lambda: now[0]
    with TestClient(app) as c:
        c.post(URL, json=BODY)
        now[0] = 599.0
        c.post(URL, json=BODY)
        assert len(pipe.calls) == 1
        now[0] = 1200.0                     # 마지막 저장(0초)에서 600초 넘음
        assert c.post(URL, json=BODY).status_code == 200
        assert len(pipe.calls) == 2


def test_lru_eviction(tmp_path):
    app, pipe = make(tmp_path, response_cache_size=2)
    a, b, d = BODY, {**BODY, "seed": 2}, {**BODY, "seed": 3}
    with TestClient(app) as c:
        c.post(URL, json=a)
        c.post(URL, json=b)
        c.post(URL, json=a)          # hit, a를 최근으로
        c.post(URL, json=d)          # b가 밀려남
        assert len(pipe.calls) == 3
        c.post(URL, json=a)
        c.post(URL, json=d)
        assert len(pipe.calls) == 3
        c.post(URL, json=b)
        assert len(pipe.calls) == 4 and stats(c)["entries"] == 2


@pytest.mark.parametrize("over", [{"response_cache": False}, {"response_cache_size": 0}, {"debug": True}])
def test_kill_switch_and_debug_mode_do_not_cache(tmp_path, over):
    app, pipe = make(tmp_path, **over)
    assert app.state.engine.responses is None
    with TestClient(app) as c:
        c.post(URL, json=BODY)
        c.post(URL, json=BODY)
        assert len(pipe.calls) == 2 and stats(c) is None


def test_env_settings(monkeypatch):
    for k in ("ROUTE_RESPONSE_CACHE", "ROUTE_RESPONSE_CACHE_SIZE", "ROUTE_RESPONSE_CACHE_TTL_S"):
        monkeypatch.delenv(k, raising=False)
    s = load_settings()
    assert (s.response_cache, s.response_cache_size, s.response_cache_ttl_s) == (True, 32, 600.0)
    monkeypatch.setenv("ROUTE_RESPONSE_CACHE", "0")
    monkeypatch.setenv("ROUTE_RESPONSE_CACHE_SIZE", "8")
    monkeypatch.setenv("ROUTE_RESPONSE_CACHE_TTL_S", "30")
    s = load_settings()
    assert (s.response_cache, s.response_cache_size, s.response_cache_ttl_s) == (False, 8, 30.0)


@pytest.mark.parametrize("name, value", [("ROUTE_RESPONSE_CACHE", "maybe"), ("ROUTE_RESPONSE_CACHE_SIZE", "-1"),
                                         ("ROUTE_RESPONSE_CACHE_SIZE", "x"), ("ROUTE_RESPONSE_CACHE_TTL_S", "0"),
                                         ("ROUTE_RESPONSE_CACHE_TTL_S", "inf"), ("ROUTE_RESPONSE_CACHE_TTL_S", "x")])
def test_invalid_env_is_rejected(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError):
        load_settings()


def test_hit_does_not_wait_for_engine_lock(tmp_path):
    app, pipe = make(tmp_path, lock_wait_s=0.05)
    with TestClient(app) as c:
        first = c.post(URL, json=BODY)
        pipe.lock.acquire()          # 다른 계산이 실행 중
        try:
            t0 = time.perf_counter()
            r = c.post(URL, json=BODY)
            assert r.status_code == 200 and r.content == first.content
            assert time.perf_counter() - t0 < 0.05 + 1.0
            assert c.post(URL, json={**BODY, "seed": 2}).json()["code"] == "BUSY"   # miss는 예전처럼 lock을 기다린다
        finally:
            pipe.lock.release()
        assert len(pipe.calls) == 1


def test_checks_cache_again_after_acquiring_lock(tmp_path):
    """lock을 기다리는 동안 같은 요청이 끝나 저장됐으면, lock을 잡은 뒤 다시 보고 계산하지 않는다."""
    app, pipe = make(tmp_path)
    engine = app.state.engine
    key = response_cache.request_key(RecommendRequest(**BODY), engine.settings)
    inner = pipe.lock

    class FinishesWhileWaiting:
        def acquire(self, timeout=-1):
            engine.responses.put(key, b'{"stored":true}')   # 기다리는 동안 같은 요청이 끝남
            return inner.acquire(timeout=timeout)

        def release(self):
            inner.release()

    pipe.lock = FinishesWhileWaiting()
    with TestClient(app) as c:
        r = c.post(URL, json=BODY)
        assert r.status_code == 200 and r.content == b'{"stored":true}' and pipe.calls == []
        assert inner.acquire(blocking=False)   # hit 경로도 잡은 lock을 반환한다
        inner.release()
        assert stats(c)["hits"] == 1 and stats(c)["misses"] == 1   # miss는 lock 전 한 번만 센다


def test_completed_result_is_stored_even_after_deadline_passed(tmp_path):
    """BE가 포기한(마감이 지난) 뒤 끝난 계산도 저장해 다음 같은 요청에 바로 준다."""
    pipe = ok_pipe()
    run = pipe.run

    def slow_run(*a, **kw):
        time.sleep(0.3)
        return run(*a, **kw)

    pipe.run = slow_run
    app, _ = make(tmp_path, pipe)
    with TestClient(app) as c:
        deadline = str(int(time.time() * 1000) + 100)   # 계산 중에 지난다
        r1 = c.post(URL, json=BODY, headers={"X-Request-Deadline": deadline})
        assert r1.status_code == 200
        r2 = c.post(URL, json=BODY)
        assert r2.content == r1.content and len(pipe.calls) == 1


def test_reroll_requests_are_cached_and_hit_refills_reroll_cache(tmp_path):
    app, pipe = make(tmp_path)
    engine = app.state.engine
    reroll2 = {**BODY, "seed": 1 + ATTEMPTS}
    with TestClient(app) as c:
        c.post(URL, json=BODY)                       # seed 1 계산
        engine.reroll._d.clear()                     # 재추천 cache만 비워진 상황(밀려남 등)
        c.post(URL, json=BODY)                       # 응답 cache hit -> 재추천 cache에 seed 1 묶음을 다시 넣는다
        assert len(pipe.calls) == 1 and len(engine.reroll) == 1
        r1 = c.post(URL, json=reroll2)               # 재추천: 이전 묶음은 재추천 cache hit, 계산 1번
        assert r1.status_code == 200 and len(pipe.calls) == 2
        assert "shown" in pipe.calls[-1][1]          # 이전 TOP3를 빼고 계산했다
        r2 = c.post(URL, json=reroll2)               # 같은 재추천은 응답 cache hit
        assert r2.content == r1.content and len(pipe.calls) == 2


def test_reroll_off_still_caches_by_seed(tmp_path):
    app, pipe = make(tmp_path, reroll_exclude=False)
    with TestClient(app) as c:
        c.post(URL, json={**BODY, "seed": 25})
        c.post(URL, json={**BODY, "seed": 25})
        c.post(URL, json={**BODY, "seed": 49})
        assert len(pipe.calls) == 2


@pytest.mark.parametrize("out, exc, code", [
    (loop_out(), None, "NO_ROUTE"),
    (loop_out([issue("OUTSIDE_CANONICAL_EXTRACT")]), None, "OUT_OF_AREA"),
    (None, RuntimeError("boom"), "INTERNAL"),
])
def test_failure_responses_are_not_cached(tmp_path, out, exc, code):
    pipe = GraphPipeline(out, exc)
    app, _ = make(tmp_path, pipe)
    with TestClient(app) as c:
        for _ in range(2):
            assert c.post(URL, json=BODY).json()["code"] == code
        assert len(pipe.calls) == 2
        assert stats(c)["puts"] == 0 and stats(c)["entries"] == 0


def test_busy_and_validation_failures_are_not_cached(tmp_path):
    app, pipe = make(tmp_path, lock_wait_s=0.05)
    with TestClient(app) as c:
        pipe.lock.acquire()
        try:
            assert c.post(URL, json=BODY).json()["code"] == "BUSY"
        finally:
            pipe.lock.release()
        assert c.post(URL, json={**BODY, "distance_km": 30}).json()["code"] == "DISTANCE_RANGE"
        assert stats(c)["puts"] == 0
        assert c.post(URL, json=BODY).status_code == 200 and len(pipe.calls) == 1


def test_warmup_is_not_stored(tmp_path):
    pipe = ok_pipe()
    app = create_app(settings(tmp_path, warmup=True), lambda _: pipe, background=False)
    with TestClient(app) as c:
        assert c.get(READY).json()["ready"] is True
        assert stats(c) == {"entries": 0, "hits": 0, "misses": 0, "puts": 0, "bytes": 0}


def test_concurrent_identical_requests_compute_once(tmp_path):
    """같은 요청 둘이 동시에 오면 하나가 계산하고, lock을 기다린 다른 하나는 lock 뒤 확인에서 hit."""
    pipe = ok_pipe()
    started, go = threading.Event(), threading.Event()
    run = pipe.run

    def gated_run(*a, **kw):
        started.set()
        go.wait(5)
        return run(*a, **kw)

    pipe.run = gated_run
    app, _ = make(tmp_path, pipe)
    with TestClient(app) as c:
        out = {}
        t1 = threading.Thread(target=lambda: out.__setitem__(1, c.post(URL, json=BODY)))
        t1.start()
        assert started.wait(5)
        t2 = threading.Thread(target=lambda: out.__setitem__(2, c.post(URL, json=BODY)))
        t2.start()
        time.sleep(0.2)              # 두 번째 요청이 lock을 기다리는 중
        go.set()
        t1.join(5)
        t2.join(5)
        assert out[1].status_code == out[2].status_code == 200 and out[1].content == out[2].content
        assert len(pipe.calls) == 1

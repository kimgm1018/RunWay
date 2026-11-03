"""무거운 요청은 차례를 기다리고, 대기 동안 AI04 스레드풀 자리를 비워 둔다."""
import asyncio
import threading

import anyio
import httpx

from app import main as main_module
from app.main import create_app
from demo_fakes import FakeModel5, FakePolicy, decide_body, fixed_clock


def _plan_body():
    return {"targetDistanceM": 5000, "targetDurationSec": 1650}


def _async_client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def test_second_heavy_request_waits_and_runs_after_the_first(monkeypatch):
    monkeypatch.setenv("HEAVY_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_QUEUE_WAIT_SEC", "2")
    entered = threading.Event()
    release = threading.Event()
    active = 0
    max_active = 0
    lock = threading.Lock()

    def slow_plan(*_args, **_kwargs):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        entered.set()
        try:
            assert release.wait(3)
            return 200, {"planStatus": "PLANNED"}
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(main_module.planner_v1, "plan_api", slow_plan)
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3), ode_loader=lambda: None)

    async def run():
        async with app.router.lifespan_context(app):
            async with _async_client(app) as client:
                first = asyncio.create_task(client.post("/v1/pace/plan", json=_plan_body()))
                assert await asyncio.to_thread(entered.wait, 2)
                second = asyncio.create_task(client.post("/v1/pace/plan", json=_plan_body()))
                # Windows 시계 단위(약 16 ms) 때문에 측정 대기가 sleep보다 짧게 나올 수 있어 여유를 둔다.
                await asyncio.sleep(0.15)
                assert not second.done()
                release.set()
                first_response, second_response = await asyncio.gather(first, second)

        assert first_response.status_code == second_response.status_code == 200
        assert int(first_response.headers["X-RunWay-Queue-Wait-Ms"]) >= 0
        assert int(second_response.headers["X-RunWay-Queue-Wait-Ms"]) >= 20
        assert max_active == 1

    asyncio.run(run())


def test_queue_timeout_returns_ai_busy_retry_after_and_wait_header(monkeypatch, caplog):
    monkeypatch.setenv("HEAVY_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_QUEUE_WAIT_SEC", "0.15")
    entered = threading.Event()
    release = threading.Event()

    def slow_plan(*_args, **_kwargs):
        entered.set()
        release.wait(3)
        return 200, {"planStatus": "PLANNED"}

    monkeypatch.setattr(main_module.planner_v1, "plan_api", slow_plan)
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3), ode_loader=lambda: None)

    async def run():
        async with app.router.lifespan_context(app):
            async with _async_client(app) as client:
                first = asyncio.create_task(client.post("/v1/pace/plan", json=_plan_body()))
                assert await asyncio.to_thread(entered.wait, 2)
                response = await client.post("/v1/pace/plan", json=_plan_body())
                release.set()
                await first
        return response

    response = asyncio.run(run())

    assert response.status_code == 503
    assert response.json()["code"] == "AI_BUSY"
    assert response.headers["Retry-After"] == "1"
    assert int(response.headers["X-RunWay-Queue-Wait-Ms"]) >= 100      # 대기 한도 150 ms, 시계 단위 여유 50 ms
    assert "ai_error code=AI_BUSY endpoint=/v1/pace/plan cause=TimeoutError" in caplog.text
    assert "targetDistanceM" not in caplog.text


def test_waiting_heavy_request_does_not_use_the_worker_needed_by_ai04(monkeypatch):
    monkeypatch.setenv("HEAVY_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_QUEUE_WAIT_SEC", "3")
    entered = threading.Event()
    release = threading.Event()

    def slow_plan(*_args, **_kwargs):
        entered.set()
        assert release.wait(3)
        return 200, {"planStatus": "PLANNED"}

    monkeypatch.setattr(main_module.planner_v1, "plan_api", slow_plan)
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3), ode_loader=lambda: None)

    async def run():
        async with app.router.lifespan_context(app):
            default_limiter = anyio.to_thread.current_default_thread_limiter()
            old_tokens = default_limiter.total_tokens
            default_limiter.total_tokens = 2
            async with _async_client(app) as client:
                first = asyncio.create_task(client.post("/v1/pace/plan", json=_plan_body()))
                assert await asyncio.to_thread(entered.wait, 2)
                queued = asyncio.create_task(client.post("/v1/pace/plan", json=_plan_body()))
                await asyncio.sleep(0.05)
                assert not queued.done()
                try:
                    decision = await asyncio.wait_for(
                        client.post("/v1/pace/decide", json=decide_body()), timeout=0.5)
                finally:
                    release.set()
                first_response, queued_response = await asyncio.gather(first, queued)
                default_limiter.total_tokens = old_tokens

        assert decision.status_code == 200
        assert first_response.status_code == queued_response.status_code == 200

    asyncio.run(run())


def test_heavy_slot_is_released_when_handler_raises(monkeypatch):
    monkeypatch.setenv("HEAVY_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_QUEUE_WAIT_SEC", "1")
    calls = 0

    def fail_once(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("테스트 실패")
        return 200, {"planStatus": "PLANNED"}

    monkeypatch.setattr(main_module.planner_v1, "plan_api", fail_once)
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3), ode_loader=lambda: None)

    async def run():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://test",
            ) as client:
                failed = await client.post("/v1/pace/plan", json=_plan_body())
                succeeded = await client.post("/v1/pace/plan", json=_plan_body())
        return failed, succeeded

    failed, succeeded = asyncio.run(run())

    assert failed.status_code == 500
    assert succeeded.status_code == 200


# ---- v6_8 (a): 개인화(AI06)와 계획(AI05·AI09) 대기열 분리 ----

def _personalize_body():
    # 개인화 계산 자체는 아래에서 가짜로 바꾸므로 형식만 맞는 최소 support 1회(5분)다.
    samples = [{"elapsedSec": 5 * i, "hrBpm": 120.0 + 0.1 * i, "speedMps": 2.8, "gradePercent": 0.0,
                "hrQuality": "GOOD", "speedQuality": "GOOD", "gradeQuality": "GOOD", "hrIsFilled": False}
               for i in range(61)]
    return {"userId": 73, "sessions": [{"sessionId": 1, "sessionStartedAt": "2026-10-20T08:00:00Z",
                                         "workoutQuality": "CLEAN", "samples": samples}]}


def _slow_personalize(monkeypatch):
    from types import SimpleNamespace

    entered = threading.Event()
    release = threading.Event()
    calls = []

    def slow(*_args, **_kwargs):
        calls.append(1)
        entered.set()
        assert release.wait(3)
        return {"schemaVersion": "runway.ode.personalization.v1", "warnings": [], "userId": 73}

    monkeypatch.setattr(main_module, "compute_personalization", slow)
    monkeypatch.setenv("GRU_PERSONALIZATION_ENABLED", "false")
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3),
                     ode_loader=lambda: SimpleNamespace())
    return app, entered, release, calls


def test_plan_does_not_wait_behind_a_running_personalization(monkeypatch):
    monkeypatch.setenv("HEAVY_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_PERSONALIZE_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_QUEUE_WAIT_SEC", "2")
    monkeypatch.setattr(main_module.planner_v1, "plan_api", lambda *_a, **_k: (200, {"planStatus": "PLANNED"}))
    app, entered, release, _ = _slow_personalize(monkeypatch)

    async def run():
        async with app.router.lifespan_context(app):
            async with _async_client(app) as client:
                personalize = asyncio.create_task(client.post("/v1/hr/personalize", json=_personalize_body()))
                assert await asyncio.to_thread(entered.wait, 2)
                try:
                    # 개인화가 아직 끝나지 않았는데(release 전) 계획은 바로 끝나야 한다.
                    plan = await asyncio.wait_for(client.post("/v1/pace/plan", json=_plan_body()), timeout=1.0)
                    assert not personalize.done()
                finally:
                    release.set()
                personalized = await personalize
        return plan, personalized

    plan, personalized = asyncio.run(run())

    assert plan.status_code == 200
    assert int(plan.headers["X-RunWay-Queue-Wait-Ms"]) < 500
    assert personalized.status_code == 200


def test_personalization_requests_still_wait_for_each_other_and_time_out_with_ai_busy(monkeypatch):
    monkeypatch.setenv("HEAVY_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_PERSONALIZE_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_QUEUE_WAIT_SEC", "0.05")
    app, entered, release, calls = _slow_personalize(monkeypatch)

    async def run():
        async with app.router.lifespan_context(app):
            async with _async_client(app) as client:
                first = asyncio.create_task(client.post("/v1/hr/personalize", json=_personalize_body()))
                assert await asyncio.to_thread(entered.wait, 2)
                second = await client.post("/v1/hr/personalize", json=_personalize_body())
                release.set()
                await first
        return second

    second = asyncio.run(run())

    # 개인화 줄 안에서는 기존과 같다: 한 번에 1개, 대기 한도를 넘으면 503 AI_BUSY + Retry-After.
    assert second.status_code == 503 and second.json()["code"] == "AI_BUSY"
    assert second.headers["Retry-After"] == "1"
    assert len(calls) == 1


def test_personalize_concurrency_env_is_separate_from_plan(monkeypatch):
    monkeypatch.setenv("HEAVY_MAX_CONCURRENCY", "1")
    monkeypatch.setenv("HEAVY_PERSONALIZE_MAX_CONCURRENCY", "3")
    app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3), ode_loader=lambda: None)

    async def run():
        async with app.router.lifespan_context(app):
            return app.state.heavy_limiter.total_tokens, app.state.heavy_personalize_limiter.total_tokens

    assert asyncio.run(run()) == (1, 3)
    monkeypatch.delenv("HEAVY_PERSONALIZE_MAX_CONCURRENCY")
    default_app = create_app(lambda: FakeModel5(), lambda: FakePolicy(), clock=fixed_clock(3), ode_loader=lambda: None)
    assert default_app.state.heavy_personalize_max_concurrency == 1

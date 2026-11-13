import asyncio
import json
from datetime import timedelta
from app.demo.stream import sse, event_stream
from app.demo.w07 import GpsPoint
from demo_fakes import new_buffer, tr, _false, VIEW, INGEST, demo_client, decide_body, gps_batch_json, T


def test_sse_format():
    assert sse("HEARTBEAT", {"a": 1, "b": "가"}) == 'event: HEARTBEAT\ndata: {"a":1,"b":"가"}\n\n'


def test_snapshot_trace_heartbeat_order():
    b = new_buffer(); b.subscribe(1); t = {"v": 0.0}
    async def sleep(s): t["v"] += s; b.append(1, tr(t["v"])) if t["v"] == 0.2 else None
    async def run():
        out = [x async for x in event_stream(b, 1, snapshot={"bootId": "b"}, sleep=sleep, monotonic=lambda: t["v"],
                                             server_time=lambda: "Z", is_disconnected=_false, max_loops=80)]
        return [x.split("\n")[0] for x in out]
    assert asyncio.run(run())[:3] == ["event: SNAPSHOT", "event: MPC_TRACE", "event: HEARTBEAT"]


def test_new_w07_route_is_published_as_course_update():
    b = new_buffer(); b.subscribe(1); t = {"v": 0.0}
    route = [GpsPoint(type="GPS_POINT", measuredAt=T, coordinates=(127.0, 37.5), accuracyM=None, altitudeM=12.0),
             GpsPoint(type="GPS_POINT", measuredAt=T + timedelta(seconds=5), coordinates=(127.0001, 37.5001),
                      accuracyM=None, altitudeM=15.0)]

    async def sleep(seconds):
        t["v"] += seconds
        if t["v"] == 0.2:
            b.append_route_points(1, route)

    async def run():
        return [event async for event in event_stream(b, 1, snapshot={"bootId": "b", "course": None},
                                                       sleep=sleep, monotonic=lambda: t["v"],
                                                       is_disconnected=_false, max_loops=2)]

    events = asyncio.run(run())
    assert events[0].startswith("event: SNAPSHOT")
    assert events[1].startswith("event: COURSE_UPDATE")
    payload = __import__("json").loads(events[1].split("data: ", 1)[1])
    assert payload["course"]["points"][0] == [127.0, 37.5, 12.0, 0.0]
    assert payload["course"]["points"][-1][2] == 15.0


def test_disconnect_releases_slot():
    b = new_buffer(); assert b.subscribe(1) and b.subscribe(1)
    async def gone(): return True
    async def run(): return [x async for x in event_stream(b, 1, snapshot={"bootId": "b"}, server_time=lambda: "Z", is_disconnected=gone)]
    asyncio.run(run()); assert b.subscribe(1)


def test_route_errors(tmp_path):
    with demo_client(tmp_path) as c:
        assert c.get("/v1/demo/sessions/201/events").status_code == 401
        assert c.get("/v1/demo/sessions/201/events?token=x", headers=VIEW).status_code == 400
        assert c.get("/v1/demo/sessions/latest/events", headers=VIEW).json()["code"] == "SESSION_NOT_FOUND"
        c.post("/v1/pace/decide", json=decide_body())
        buf = c.app.state.demo.buffer
        for _ in range(5): buf.subscribe(201)                    # 747: 화면 연결 상한 5
        assert c.get("/v1/demo/sessions/201/events", headers=VIEW).status_code == 429


def test_route_snapshot(tmp_path):
    with demo_client(tmp_path) as c:
        c.app.state.demo_stream_max_loops = 1
        c.post("/v1/pace/decide", json=decide_body())
        r = c.get("/v1/demo/sessions/latest/events", headers=VIEW)
    assert r.headers["content-type"].startswith("text/event-stream") and r.text.startswith("event: SNAPSHOT")
    assert '"label":"러너 A"' in r.text


def test_route_snapshot_with_w07_course_before_first_trace(tmp_path):
    with demo_client(tmp_path, allow=frozenset({201}), include_course=False) as c:
        gps = gps_batch_json(201, 5, [(127.0, 37.5, 12.0), (127.0001, 37.5001, 18.0)])
        assert c.post("/v1/demo/sessions/201/batches", content=gps, headers=INGEST).status_code == 200
        assert c.app.state.demo.buffer.traces(201) == []
        c.app.state.demo_stream_max_loops = 0
        response = c.get("/v1/demo/sessions/201/events", headers=VIEW)
    assert response.status_code == 200
    snapshot = json.loads(response.text.split("data: ", 1)[1].splitlines()[0])
    assert snapshot["traces"] == []
    assert snapshot["course"]["points"][0] == [127.0, 37.5, 12.0, 0.0]
    assert snapshot["course"]["points"][-1][2] == 18.0

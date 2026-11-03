import json
import pytest
from demo_fakes import demo_client, batch_json, post_run, INGEST, gps_batch_json

URL = "/v1/demo/sessions/{}/batches"


def test_ack_and_trace_course_grade(tmp_path):
    with demo_client(tmp_path, stage="L2B", after=305) as c:
        rs = post_run(c, 201, range(5, 305, 5))
        t = c.app.state.demo.buffer.traces(201)[-1]
    assert rs[0].json() == {"status": "COMMITTED", "batchId": json.loads(batch_json(201, 5))["id"], "acceptedCount": 1}
    assert t["stage"] == "L2B" and t["input"]["gradeSource"] == "COURSE_PROFILE" and t["coaching"]["delivery"] == "NOT_DELIVERED"
    assert t["anchorPaceSecPerKm"] == pytest.approx(1000 / 3.0, abs=0.01)      # 미전달 단계는 실측 60초 pace가 기준


def test_watch_stage_anchor_starts_at_goal_pace(tmp_path):
    with demo_client(tmp_path, stage="L1A", after=305) as c:
        post_run(c, 201, range(5, 305, 5))
        t = c.app.state.demo.buffer.traces(201)[0]
    assert t["coaching"]["delivery"] == "WATCH" and t["anchorPaceSecPerKm"] == pytest.approx(360.0)


def test_duplicate_and_conflict(tmp_path):
    with demo_client(tmp_path, after=0.5) as c:
        b = batch_json(201, 5)
        a1 = c.post(URL.format(201), content=b, headers=INGEST).json(); n = len(c.app.state.demo.buffer.traces(201))
        assert c.post(URL.format(201), content=b, headers=INGEST).json() == a1 and len(c.app.state.demo.buffer.traces(201)) == n
        assert c.post(URL.format(201), content=batch_json(201, 5, hr=151, same_id_as=b), headers=INGEST).status_code == 409


def test_session_mismatch_rate_limit_and_token(tmp_path):
    with demo_client(tmp_path, after=0.5, rate=2) as c:
        assert c.post(URL.format(202), content=batch_json(201, 5), headers=INGEST).status_code == 422
        assert c.post(URL.format(201), content=batch_json(201, 10), headers={"Authorization": "Bearer " + "v" * 32}).status_code == 401
        r = post_run(c, 201, (15, 20, 25))
        assert r[-1].status_code == 429 and r[-1].headers["Retry-After"] == "1"


def test_replay_uses_data_clock_and_speed(tmp_path):
    with demo_client(tmp_path, after=999999) as c:
        for s in range(5, 305, 5):
            c.post(URL.format(900000001), content=batch_json(900000001, s), headers={**INGEST, "X-Demo-Replay-Speed": "4"})
        t = c.app.state.demo.buffer.traces(900000001)[-1]
    assert t["stage"] == "L3" and t["replaySpeed"] == 4 and t["latency"]["inputLagMs"] is None and t["status"] == "OK"


def test_replay_hr_gap_stale_then_insufficient(tmp_path):
    with demo_client(tmp_path) as c:
        post_run(c, 900000001, range(5, 155, 5))
        post_run(c, 900000001, (155, 160, 165, 167, 170, 175), hr=None)
        post_run(c, 900000001, range(180, 200, 5))
        st = [t["status"] for t in c.app.state.demo.buffer.traces(900000001)]
    assert st.index("HR_STALE") < st.index("INPUT_INSUFFICIENT") and st[-1] == "OK"


def test_gps_only_then_metrics(tmp_path):
    with demo_client(tmp_path, after=0.5) as c:
        assert c.post(URL.format(201), content=gps_batch_json(201, 5), headers=INGEST).status_code == 200
        assert c.app.state.demo.buffer.traces(201) == []
        post_run(c, 201, range(10, 130, 5))
        assert c.app.state.demo.buffer.traces(201)


def test_live_trace_and_snapshot_use_w07_coordinates_and_altitude(tmp_path, caplog):
    import logging
    caplog.set_level(logging.DEBUG)
    with demo_client(tmp_path, after=0.5, include_course=False) as c:
        gps = gps_batch_json(201, 5, [(127.0, 37.5, 12.0),
                                     (127.0001, 37.5001, 18.0),
                                     (127.0002, 37.5002, 21.0)])
        assert c.post(URL.format(201), content=gps, headers=INGEST).status_code == 200
        post_run(c, 201, range(10, 130, 5), grade=0.0)
        c.app.state.demo_stream_max_loops = 1
        stream = c.get("/v1/demo/sessions/201/events", headers={"Authorization": "Bearer " + "v" * 32})
    snapshot = json.loads(stream.text.split("data: ", 1)[1].split("\n", 1)[0])
    course = snapshot["course"]
    assert course["points"][0] == [127.0, 37.5, 12.0, 0.0]
    assert course["points"][-1][2] == 21.0
    assert course["points"][-1][3] > 0
    assert "127.0001" not in caplog.text and "37.5001" not in caplog.text

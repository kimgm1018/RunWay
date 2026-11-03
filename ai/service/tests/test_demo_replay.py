import json
from datetime import datetime, timezone
import pytest
from tools.replay_sources import read_db_csv, read_watch_json, read_fitrec_csv, Row
from tools.demo_replay import to_batches, run, main, make_poster
from app.demo.w07 import parse_batch
S = datetime(2026, 11, 5, 5, 0, tzinfo=timezone.utc)


def test_watch_json_groups_same_time(tmp_path):
    p = tmp_path / "w.json"
    p.write_text(json.dumps({"schemaVersion": 2, "samples": [
        {"metric": "HEART_RATE", "value": 150, "sessionElapsedMs": 2000}, {"metric": "SPEED", "value": 3.0, "sessionElapsedMs": 2000},
        {"metric": "STEPS", "value": 5, "sessionElapsedMs": 2000}]}), encoding="utf-8")
    assert read_watch_json(p) == [Row(2, 150.0, 3.0, None, None, None)]


def test_fitrec_refuses_other_split(tmp_path):
    (tmp_path / "s.json").write_text('{"train":["g1"],"val":["g2"],"test":["g3"]}', encoding="utf-8")
    (tmp_path / "f.csv").write_text("session_id,subject_group_id,elapsed_s,hr_bpm,speed_mps,grade_pct\nx,g3,0,150,3,0\n", encoding="utf-8")
    with pytest.raises(ValueError): read_fitrec_csv(tmp_path / "f.csv", split_file=tmp_path / "s.json", split="train")


def test_fitrec_optional_columns(tmp_path):
    (tmp_path / "s.json").write_text('{"train":["g1"],"val":["g2"]}', encoding="utf-8")
    p = tmp_path / "f.csv"
    p.write_text("session_id,subject_group_id,elapsed_s,hr_bpm,speed_mps,grade_pct,cumulative_distance_m,latitude,longitude,altitude_m,segment_id\nx,g2,5,150,3,0,15,37.5,127.0,42,2\nx,g2,10,151,3.1,1,,,,,\n", encoding="utf-8")
    rows = read_fitrec_csv(p, split_file=tmp_path / "s.json", split="val")
    assert rows == [Row(5, 150.0, 3.0, 15.0, 0.0, None, 37.5, 127.0, 42.0, 2),
                    Row(10, 151.0, 3.1, None, 1.0, None, None, None, None, None)]


def test_batches_are_valid_w07():
    rows = [Row(5 * k, 150.0, 3.0, 15.0 * k, None) for k in range(12)]
    bs = to_batches(rows, start_at=S, device_id=900000101, session_id=900000001)
    assert len(bs) == 12 and bs[0]["items"][0]["measuredAt"] == "2026-11-05T05:00:00Z"
    for b in bs: parse_batch(json.dumps(b).encode(), skip_hash_device_ids=frozenset())


def test_val_location_and_altitude_become_w07_gps_points():
    rows = [Row(0, 150.0, 3.0, 0.0, 0.0, latitude=37.5, longitude=127.0, altitude_m=42.0),
            Row(5, 151.0, 3.1, 15.5, 0.0, latitude=37.5001, longitude=127.0001, altitude_m=45.0)]
    batches = to_batches(rows, start_at=S, device_id=900000101, session_id=900000001)
    first_item = batches[0]["items"][-1]
    second_item = batches[1]["items"][-1]
    assert first_item == {"type": "GPS_POINT", "measuredAt": "2026-11-05T05:00:00Z",
                          "coordinates": [127.0, 37.5], "accuracyM": None, "altitudeM": 42.0}
    assert second_item["type"] == "GPS_POINT" and second_item["coordinates"] == [127.0001, 37.5001]
    assert second_item["altitudeM"] == 45.0
    for batch in batches:
        parse_batch(json.dumps(batch).encode(), skip_hash_device_ids=frozenset())


def test_run_pacing():
    t = {"v": 0.0}; sent = []
    def sleep(s): t["v"] += s
    run([{"i": k} for k in range(4)], post=lambda b: sent.append(t["v"]) or 200, speed=4, sleep=sleep, monotonic=lambda: t["v"])
    assert sent == [0.0, 1.25, 2.5, 3.75]


def test_token_from_env_only(monkeypatch, tmp_path, capsys):
    monkeypatch.delenv("DEMO_INGEST_TOKEN", raising=False)
    assert main(["--source", "db-csv", "--file", str(tmp_path / "x.csv"), "--session", "900000001", "--url", "http://x"]) == 2


def test_poster_headers(monkeypatch):
    seen = {}
    class R:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *a): pass
    monkeypatch.setattr("urllib.request.urlopen", lambda req, timeout: seen.update(h=dict(req.header_items()), t=timeout) or R())
    assert make_poster("http://x", 900000001, "i" * 32, 4)({"a": 1}) == 200
    assert seen["h"]["Authorization"] == "Bearer " + "i" * 32 and seen["h"]["X-demo-replay-speed"] == "4" and seen["t"] == 10

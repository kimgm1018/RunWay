import json, pytest
from app.demo.w07 import jcs_bytes, payload_hash, parse_batch
from app.inference import ApiError
DOC = {"id": "00000000-0000-4000-8000-000000000101", "deviceId": 101, "sessionId": 5001, "schemaVersion": "1",
       "items": [{"type": "METRIC_SAMPLE", "measuredAt": "2026-10-27T01:00:01Z", "elapsedDurationSec": 1, "heartRateBpm": 142,
                  "cadenceSpm": None, "speedMps": None, "gradePercent": None, "totalDistanceM": None, "routeProgressM": None,
                  "isHrMeasured": True}],
       "payloadHash": "ba0c20955e268924e342e2bf7e52ae85b9f9b993652fcc3b596a980b83a8df4c"}
NONE = frozenset()


def test_hash_matches_w07_doc_example():
    assert payload_hash(DOC) == DOC["payloadHash"]


def test_jcs_numbers_and_keys():
    assert jcs_bytes([1.0, 0.5, 1e-5, 142, -0.0]) == b"[1,0.5,0.00001,142,0]"
    assert jcs_bytes({"b": 1, "a": {"d": 1, "c": 2}}) == b'{"a":{"c":2,"d":1},"b":1}'


def raw(**patch):
    b = json.loads(json.dumps(DOC)); b.update(patch); return json.dumps(b).encode()


def code(body, skip=NONE):
    with pytest.raises(ApiError) as e: parse_batch(body, skip_hash_device_ids=skip)
    return e.value.status, e.value.code


def test_parse_ok_and_errors():
    assert parse_batch(raw(), skip_hash_device_ids=NONE).items[0].heartRateBpm == 142
    assert code(raw(extra=1)) == (422, "INVALID_BATCH")
    assert code(raw(items=[])) == (422, "INVALID_BATCH")
    assert code(b"{") == (400, "VALIDATION_ERROR")
    bad = json.loads(raw()); del bad["items"][0]["cadenceSpm"]
    assert code(json.dumps(bad).encode()) == (400, "VALIDATION_ERROR")
    assert code(raw(payloadHash="0" * 64)) == (422, "INVALID_BATCH")
    assert parse_batch(raw(payloadHash="0" * 64), skip_hash_device_ids=frozenset({101}))
    assert code(b" " * 32769) == (413, "FILE_TOO_LARGE")


def test_hr_measured_rule():
    bad = json.loads(raw()); bad["items"][0]["heartRateBpm"] = None
    assert code(json.dumps(bad).encode(), frozenset({101})) == (422, "INVALID_BATCH")


def test_gps_only_batch_ok():
    gps = {"type": "GPS_POINT", "measuredAt": "2026-10-27T01:00:01Z", "coordinates": [127.0, 37.5], "accuracyM": 5.0, "altitudeM": None}
    assert parse_batch(raw(items=[gps]), skip_hash_device_ids=frozenset({101})).items[0].type == "GPS_POINT"

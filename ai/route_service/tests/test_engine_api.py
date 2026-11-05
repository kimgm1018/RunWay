"""실제 엔진 + 데이터로 성공 응답 계약을 확인한다. RUNWAY_DATA_DIR(데이터 root)가 없으면 건너뛴다.

    RUNWAY_DATA_DIR=<data root> python -B -m pytest tests/test_engine_api.py
데모 응답과의 전체 동일성은 tools/route_regression/service_identity.py가 Golden 시나리오 전부로 확인한다.
"""
import math
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

DATA = os.environ.get("RUNWAY_DATA_DIR")
pytestmark = pytest.mark.skipif(not DATA or not (Path(DATA) / "data" / "osm" / "busan").is_dir(),
                                reason="RUNWAY_DATA_DIR with data/osm/busan is needed")

URL = "/internal/v1/routes/recommendations"
LOOP = {"lat": 35.1532, "lon": 129.1186, "distance_km": 5.0, "filters": {"beach": True, "flat": True}, "seed": 1}
OAB = {"lat": 35.1532, "lon": 129.1186, "distance_km": 4.0, "shape": "out_and_back", "seed": 1}
P2P = {"lat": 35.1532, "lon": 129.1186, "distance_km": 8.0, "shape": "point_to_point",
       "end_lat": 35.1587, "end_lon": 129.1604, "seed": 1}
ROUTE_KEYS = ["rank", "coords", "distance_m", "summary", "reasons", "caveats", "score", "score_terms"]
SCORE_TERM_KEYS = {"term", "label", "group", "feature_value", "weight", "contribution"}   # BE 계약(!183)이 고정한 key
ELEVATION = {"elevation_profile_m", "profile_m", "elevation_available", "elevation_note", "elevation_gain_m",
             "elevation_loss_m", "elevation_min_m", "elevation_max_m", "avg_grade_pct", "max_grade_pct",
             "steep_segment_ratio", "gain_per_km"}


def _app(tmp_path_factory, debug: bool):
    from app.config import Settings
    from app.main import create_app
    s = Settings(debug=debug, warmup=True, gate_mode=os.environ.get("RUNWAY_USABILITY_GATE", "enforce"),
                 fast_graph=True, usability_log_dir=tmp_path_factory.mktemp("gate"))
    return create_app(s, background=False)


@pytest.fixture(scope="module")
def plain(tmp_path_factory):
    with TestClient(_app(tmp_path_factory, debug=False)) as c:
        yield c


@pytest.fixture(scope="module")
def with_debug(tmp_path_factory):
    with TestClient(_app(tmp_path_factory, debug=True)) as c:
        yield c


def test_ready_after_warmup(plain):
    r = plain.get("/internal/v1/ready")
    assert r.status_code == 200 and r.json()["ready"] is True and r.json()["warmup_s"] is not None


@pytest.mark.parametrize("body", [LOOP, OAB, P2P], ids=["loop", "oab", "p2p"])
def test_success_body_has_only_contract_fields(plain, body):
    r = plain.post(URL, json=body)
    j = r.json()
    assert r.status_code == 200, j
    assert list(j) == ["routes", "notices", "next_seed"]
    assert j["next_seed"] == body["seed"] + 24 and 1 <= len(j["routes"]) <= 3
    assert all(isinstance(n, str) for n in j["notices"])
    for i, route in enumerate(j["routes"], 1):
        assert list(route) == ROUTE_KEYS and route["rank"] == i
        assert len(route["coords"]) >= 2 and all(len(p) == 2 for p in route["coords"])
        assert route["distance_m"] > 0 and route["summary"]
        assert abs(route["distance_m"] - body["distance_km"] * 1000) <= body["distance_km"] * 100 + 1e-6
        assert all(isinstance(x, str) for x in route["reasons"] + route["caveats"])


@pytest.mark.parametrize("body", [LOOP, OAB, P2P], ids=["loop", "oab", "p2p"])
def test_score_terms_keys_are_pinned(plain, body):
    for route in plain.post(URL, json=body).json()["routes"]:
        assert route["score_terms"]
        for t in route["score_terms"]:
            assert set(t) == SCORE_TERM_KEYS, t
            assert isinstance(t["term"], str) and isinstance(t["label"], str) and isinstance(t["group"], str)
            for k in ("feature_value", "weight", "contribution"):
                assert isinstance(t[k], (int, float)) and math.isfinite(t[k])
        assert abs(sum(t["contribution"] for t in route["score_terms"]) - route["score"]) < 1e-3


def test_flat_term_present_when_flat_on(plain):
    terms = [t["term"] for r in plain.post(URL, json=LOOP).json()["routes"] for t in r["score_terms"]]
    assert "difficulty_flat" in terms


def test_debug_mode_returns_full_fields_without_elevation(with_debug):
    j = with_debug.post(URL, json=LOOP).json()
    assert j["ok"] is True and "debug" in j and "start" in j
    for route in j["routes"]:
        assert {"edges", "features", "details", "candidate_id"} <= set(route)
        assert not (set(route) & ELEVATION) and not (set(route["features"]) & ELEVATION)
        assert not {d["label"] for d in route["details"]} & {"누적 상승", "평균 경사"}


def test_same_input_same_result_and_debug_has_same_routes(plain, with_debug):
    a, b = plain.post(URL, json=LOOP).json(), plain.post(URL, json=LOOP).json()
    d = with_debug.post(URL, json=LOOP).json()
    assert a == b
    assert a["routes"] == [{k: r[k] for k in ROUTE_KEYS} for r in d["routes"]]
    assert a["notices"] == d["notices"] and a["next_seed"] == d["next_seed"]


def test_out_of_area_is_422(plain):
    r = plain.post(URL, json={"lat": 37.5665, "lon": 126.978, "distance_km": 5.0})
    assert r.status_code == 422 and r.json()["code"] == "OUT_OF_AREA"

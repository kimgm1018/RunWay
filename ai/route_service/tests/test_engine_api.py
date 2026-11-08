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


# ------------------------------------------------------------------ 재추천 제외 (S15P31E105-383)
def _ov(route, shown):
    """(이전 코스 하나와 공유 길이 / 짧은 쪽 최댓값, 이 코스 길이 중 이전 코스들 edge에 있던 비율) - edge key 기준."""
    a = dict((k, x) for k, x in route["edges"])
    pair = max((sum(a[k] for k in a.keys() & {k for k, _ in s["edges"]}) /
                min(sum(a.values()), sum(dict(s["edges"]).values())) for s in shown), default=0.0)
    keys = {k for s in shown for k, _ in s["edges"]}
    union = sum(x for k, x in route["edges"] if k in keys) / sum(x for _, x in route["edges"])
    return pair, union


@pytest.mark.parametrize("body", [LOOP, OAB], ids=["loop", "oab"])
def test_reroll_excludes_shown_routes_and_hit_equals_miss(with_debug, body):
    from app import reroll
    engine = with_debug.app.state.engine
    chain = [with_debug.post(URL, json={**body, "seed": s}).json() for s in (1, 25, 49)]
    shown = list(chain[0]["routes"])
    for j in chain[1:]:
        assert j["ok"] is True and j["debug"]["reroll"]["cache"]["misses"] == 0
        for route in j["routes"]:
            pair, union = _ov(route, shown)
            # edge key("u-v")는 평행 edge를 하나로 보므로 엔진(edge id) 판단과 아주 조금 다를 수 있다
            assert pair < 0.6 + 0.02 and union < 0.6 + 0.02, (pair, union)
        shown += j["routes"]
    engine.reroll = reroll.ShownCache()           # 재시작·만료와 같은 상태: 이전 묶음을 다시 계산
    miss = with_debug.post(URL, json={**body, "seed": 49}).json()
    assert miss["debug"]["reroll"]["cache"]["recomputed_runs"] == 2
    strip = lambda j: {k: v for k, v in j.items() if k not in ("generation", "debug")}  # noqa: E731
    assert strip(miss) == strip(chain[2])


def test_first_request_unchanged_by_reroll_switch(plain):
    """seed 1~24는 재추천 제외와 상관없이 예전 결과(같은 앱에서 스위치만 끈 것과 같음)."""
    engine = plain.app.state.engine
    on = plain.post(URL, json={**LOOP, "seed": 7}).json()
    saved, engine.reroll = engine.reroll, None
    try:
        off = plain.post(URL, json={**LOOP, "seed": 7}).json()
    finally:
        engine.reroll = saved
    assert on == off

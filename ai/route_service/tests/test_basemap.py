"""POST /internal/v1/basemaps(S15P31E105-612): 저장 코스 썸네일 지도 바탕.

실제 전국 자료 없이 작은 합성 저장소(network npy와 같은 배열 형식 + envcache/layers.gpkg)로 검증한다.
"""
import math
import threading
import time
from dataclasses import replace
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pyproj import Transformer

from app import basemap as B
from app.main import BASEMAPS, create_app
from test_api import assert_error, settings

COVERAGE = (124.0, 32.0, 132.0, 39.0)
TIMESTAMP = "2026-10-20T20:23:47Z"
BBOX = [127.02, 37.49, 127.06, 37.52]   # 서울 강남 부근 약 3.5 km x 3.3 km
TOL = 1.5 * 10 ** -B.COORD_DIGITS        # 소수 5자리 반올림 오차


def build_network(ways):
    """ways: [(tags dict, [(lon, lat), ...])] -> NationalStore와 같은 grid/net 배열과 strings.
    같은 좌표의 node는 하나로 합친다(OSM처럼 way가 끝점 node를 공유)."""
    strings, sid = [], {}

    def s(v):
        if v not in sid:
            sid[v] = len(strings)
            strings.append(v)
        return sid[v]

    node_of, lonlat = {}, []
    ref_ptr, ref_pos, tag_ptr, tag_k, tag_v = [0], [], [0], [], []
    for tags, coords in ways:
        for c in coords:
            if c not in node_of:
                node_of[c] = len(lonlat)
                lonlat.append(c)
            ref_pos.append(node_of[c])
        ref_ptr.append(len(ref_pos))
        for k, v in tags.items():
            tag_k.append(s(k))
            tag_v.append(s(v))
        tag_ptr.append(len(tag_k))
    ll = np.asarray(lonlat, np.float64)
    x, y = Transformer.from_crs(4326, 5179, always_xy=True).transform(ll[:, 0], ll[:, 1])
    cell = np.floor((np.asarray(y) - 1300000) / 1000).astype(int) * 800 + np.floor((np.asarray(x) - 700000) / 1000).astype(int)
    order = np.argsort(cell, kind="stable")
    ids, starts = np.unique(cell[order], return_index=True)
    node_ways = [[] for _ in lonlat]
    for wi in range(len(ways)):
        for p in sorted(set(ref_pos[ref_ptr[wi]:ref_ptr[wi + 1]])):
            node_ways[p].append(wi)
    grid = {"cell_ids": ids.astype(np.int32), "cell_offsets": np.r_[starts, len(cell)].astype(np.int32),
            "cell_node_idx": order.astype(np.int32)}
    net = {"lonlat": ll, "ref_ptr": np.asarray(ref_ptr, np.int32), "ref_pos": np.asarray(ref_pos, np.int32),
           "tag_ptr": np.asarray(tag_ptr, np.int32), "tag_k": np.asarray(tag_k, np.int32),
           "tag_v": np.asarray(tag_v, np.int32),
           "node_way_ptr": np.r_[0, np.cumsum([len(w) for w in node_ways])].astype(np.int32),
           "node_way_idx": np.asarray([w for ws in node_ways for w in ws], np.int32)}
    return grid, net, strings


def write_env(path, rows):
    import geopandas as gpd
    (path / "envcache").mkdir(parents=True, exist_ok=True)
    gdf = gpd.GeoDataFrame({"env_class": [r[0] for r in rows], "osm_id": list(range(len(rows))),
                            "name": [None] * len(rows), "tag": ["x"] * len(rows), "area_m2": [0.0] * len(rows)},
                           geometry=[r[1] for r in rows], crs="EPSG:4326")
    gdf.to_file(path / "envcache/layers.gpkg", layer="env", driver="GPKG", index=False)


def fake_store(path, ways, env_rows):
    grid, net, strings = build_network(ways)
    if env_rows:
        write_env(path, env_rows)
    return SimpleNamespace(grid=grid, net=net, strings=strings, path=path, coverage=COVERAGE,
                           metadata={"bbox_wsen": list(COVERAGE), "osm_data_timestamp": TIMESTAMP})


def normal_ways():
    lat = 37.505
    return [
        ({"highway": "primary", "name": "테헤란로"}, [(127.00, lat), (127.03, lat), (127.05, lat), (127.08, lat)]),
        # 같은 등급 두 way가 끝점을 공유 -> 한 선으로 합쳐진다
        ({"highway": "secondary"}, [(127.01, 37.512), (127.025, 37.512), (127.04, 37.512)]),
        ({"highway": "secondary"}, [(127.04, 37.512), (127.055, 37.512), (127.07, 37.512)]),
        ({"highway": "tertiary"}, [(127.03, 37.48), (127.03, 37.50), (127.03, 37.53)]),
        # bbox 안에 node가 없이 지나가는 긴 구간(grid 여유 칸으로 찾아야 한다)
        ({"highway": "motorway"}, [(127.045, 37.481), (127.045, 37.529)]),
        # 생활도로도 넣는다(road_class=residential)
        ({"highway": "residential"}, [(127.035, 37.495), (127.045, 37.497)]),
        # 빠져야 하는 길
        ({"highway": "service"}, [(127.023, 37.493), (127.033, 37.496)]),
        ({"highway": "primary_link"}, [(127.036, 37.50), (127.044, 37.51)]),
        ({"highway": "footway"}, [(127.04, 37.495), (127.05, 37.515)]),
        ({"bridge": "yes"}, [(127.022, 37.493), (127.058, 37.518)]),
    ]


def normal_env():
    from shapely.geometry import LineString, Polygon, box
    return [
        ("park", box(127.04, 37.50, 127.05, 37.51)),
        ("water", box(127.00, 37.515, 127.03, 37.53)),               # bbox 밖으로 걸쳐 잘린다
        ("river", LineString([(127.00, 37.50), (127.08, 37.495)])),
        ("green", box(127.051, 37.511, 127.0512, 37.5112)),           # bbox 면적의 0.1 % 미만 -> 버린다
        ("coast", LineString([(127.021, 37.519), (127.059, 37.519)])),
        ("beach", Polygon([(127.022, 37.491), (127.03, 37.491), (127.03, 37.497), (127.022, 37.491)])),
        ("park", box(128.0, 36.0, 128.01, 36.01)),                    # bbox와 무관
    ]


def make_client(tmp_path, store, **kw):
    cfg = replace(settings(tmp_path, warmup=False), data_mode="national", national_dir=tmp_path, **kw)
    pipe = SimpleNamespace(store=store, lock=threading.Lock())
    app = create_app(cfg, lambda _: pipe, background=False)
    app.state.engine.start()   # lifespan 없이 바로 ready(예열 없음)
    return TestClient(app), pipe


def all_points(feature):
    g = feature["geometry"]
    if g["type"] == "LineString":
        return g["coordinates"]
    return [p for ring in g["coordinates"] for p in ring]


def assert_valid(body, bbox=BBOX):
    w, s, e, n = bbox
    assert 0 <= len(body["features"]) <= 99
    order = [B.DRAW_ORDER.index(f["kind"]) for f in body["features"]]
    assert order == sorted(order), "배경 먼저 그리는 순서"
    for f in body["features"]:
        assert f["kind"] in B.DRAW_ORDER
        if f["kind"] == "road":
            assert set(f) == {"kind", "geometry", "road_class"} and f["road_class"] in B.ROAD_CLASSES
        else:
            assert set(f) == {"kind", "geometry"}
        g = f["geometry"]
        if g["type"] == "LineString":
            assert len({tuple(p) for p in g["coordinates"]}) >= 2
        else:
            assert g["type"] == "Polygon"
            for ring in g["coordinates"]:
                assert len(ring) >= 4 and ring[0] == ring[-1]
        for lon, lat in all_points(f):
            assert round(lon, B.COORD_DIGITS) == lon and round(lat, B.COORD_DIGITS) == lat
            assert w - TOL <= lon <= e + TOL and s - TOL <= lat <= n + TOL


# ------------------------------------------------------------------ 정상
def test_normal_bbox(tmp_path):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    r = c.post(BASEMAPS, json={"bbox": BBOX})
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["osm_data_timestamp"] == TIMESTAMP
    assert 1 <= len(body["features"]) <= 99
    assert_valid(body)
    kinds = [f["kind"] for f in body["features"]]
    # primary 1 + secondary(두 way 합침) 1 + tertiary 1 + motorway(bbox 안 node 없음) 1 + residential 1.
    # service·link·footway 제외
    assert kinds.count("road") == 5
    roads = [f for f in body["features"] if f["kind"] == "road"]
    assert [f["road_class"] for f in roads] == ["motorway", "primary", "secondary", "tertiary", "residential"]
    assert {"park", "water", "river", "coast", "beach"} <= set(kinds)
    assert "sea" not in kinds     # 해안선이 bbox 양 끝에 닿지 않아 bbox를 나누지 못한다
    assert "green" not in kinds   # 아주 작은 면은 버린다
    assert kinds.count("park") == 1
    # 큰길은 bbox 끝까지 잘린 선
    roads = [f for f in body["features"] if f["kind"] == "road"]
    lons = sorted(p[0] for f in roads for p in f["geometry"]["coordinates"])
    assert lons[0] == pytest.approx(BBOX[0], abs=TOL) and lons[-1] == pytest.approx(BBOX[2], abs=TOL)
    # 같은 요청은 같은 응답
    assert c.post(BASEMAPS, json={"bbox": BBOX}).json() == body


def test_road_filter_excludes_minor_and_links(tmp_path):
    excluded = ["primary_link", "motorway_link", "tertiary_link", "footway", "service", "path", "cycleway", "steps",
                "track", "pedestrian"]
    ways = [({"highway": v}, [(127.025, 37.492 + i * 0.002), (127.055, 37.492 + i * 0.002)])
            for i, v in enumerate(excluded)]
    c, _ = make_client(tmp_path, fake_store(tmp_path, ways, []))
    body = c.post(BASEMAPS, json={"bbox": BBOX}).json()
    assert body["features"] == []
    included = ["trunk", "unclassified", "residential", "living_street"]
    ways += [({"highway": v}, [(127.025, 37.513 + i * 0.0015), (127.055, 37.513 + i * 0.0015)])
             for i, v in enumerate(included)]
    c, _ = make_client(tmp_path, fake_store(tmp_path, ways, []))
    body = c.post(BASEMAPS, json={"bbox": BBOX}).json()
    assert [f["kind"] for f in body["features"]] == ["road"] * 4
    assert [f["road_class"] for f in body["features"]] == included   # 등급 순
    assert_valid(body)


def test_road_class_rank_order_all_classes(tmp_path):
    # 등급이 낮을수록 길게 만들어도 응답(=순위) 순서는 ROAD_CLASSES 순서다.
    ways = [({"highway": v}, [(127.05 - i * 0.003, 37.493 + i * 0.003), (127.059, 37.493 + i * 0.003)])
            for i, v in enumerate(B.ROAD_CLASSES)]
    body = B.build_basemap(fake_store(tmp_path, list(reversed(ways)), []), tuple(BBOX))
    assert [f["road_class"] for f in body["features"]] == list(B.ROAD_CLASSES)
    assert_valid(body)


def test_road_rank_class_then_length(tmp_path):
    # 큰길 상한보다 많은 tertiary + 짧은 motorway 1개: motorway가 반드시 남는다.
    ways = [({"highway": "tertiary"}, [(127.021, 37.4905 + i * 0.0005), (127.059, 37.4905 + i * 0.0005)])
            for i in range(B.KIND_CAPS["road"] + 5)]
    ways.append(({"highway": "motorway"}, [(127.04, 37.519), (127.045, 37.519)]))
    store = fake_store(tmp_path, ways, [])
    body = B.build_basemap(store, tuple(BBOX))
    assert len(body["features"]) == B.KIND_CAPS["road"]
    assert any(f["geometry"]["coordinates"][0][1] == 37.519 for f in body["features"])


def test_caps(tmp_path):
    from shapely.geometry import LineString, box
    ways = [({"highway": "primary"}, [(127.021, 37.4902 + i * 0.0003), (127.059, 37.4902 + i * 0.0003)])
            for i in range(100)]
    env = []
    for i in range(10):
        for j in range(10):
            x, y = 127.021 + i * 0.0038, 37.4902 + j * 0.0029
            env.append(("park", box(x, y, x + 0.003, y + 0.0025)))
            env.append(("green", box(x + 0.0001, y + 0.0001, x + 0.0029, y + 0.0024)))
            env.append(("water", box(x, y, x + 0.0025, y + 0.002)))
            env.append(("beach", box(x, y, x + 0.002, y + 0.002)))
    for k in range(30):
        y = 37.4905 + k * 0.001
        env.append(("river", LineString([(127.021, y), (127.059, y)])))
        # bbox를 가로지르는 해안선. 방향을 번갈아(서->동, 동->서) 두 줄 사이가 하나 걸러 바다가 된다(바다 면 약 15개).
        coast = [(127.01, y + 0.0004), (127.07, y + 0.0004)]
        env.append(("coast", LineString(coast if k % 2 else coast[::-1])))
    store = fake_store(tmp_path, ways, env)
    body = B.build_basemap(store, tuple(BBOX))
    kinds = [f["kind"] for f in body["features"]]
    assert len(kinds) == B.MAX_FEATURES == 99
    assert B.KIND_CAPS == {"road": 58, "park": 12, "green": 10, "water": 6, "river": 6, "coast": 4, "beach": 3, "sea": 4}
    for k, cap in B.KIND_CAPS.items():
        if k != "road":
            assert kinds.count(k) == cap, k
    # 종류별 상한 합계(103)가 전체 상한을 넘어 그리는 순서 마지막인 도로가 남은 자리(99 - 45 = 54)만큼 담긴다.
    assert kinds.count("road") == B.MAX_FEATURES - sum(v for k, v in B.KIND_CAPS.items() if k != "road") == 54
    assert_valid(body)


# ------------------------------------------------------------------ 바다
def _coast_across(reverse=False):
    """bbox를 서->동으로 가로지르는 해안선(두 way가 끝점을 공유, linemerge 대상). 왼쪽(북)이 육지, 오른쪽(남)이 바다."""
    from shapely.geometry import LineString
    a = [(127.00, 37.500), (127.03, 37.503), (127.04, 37.506)]
    b = [(127.04, 37.506), (127.05, 37.508), (127.08, 37.510)]
    if reverse:
        return [("coast", LineString(b[::-1])), ("coast", LineString(a[::-1]))]
    return [("coast", LineString(a)), ("coast", LineString(b))]


NO_ROADS = [({"highway": "service"}, [(127.035, 37.495), (127.045, 37.497)])]   # 도로 feature가 없는 도로망


def _sea(body):
    from shapely.geometry import shape
    return [shape(f["geometry"]) for f in body["features"] if f["kind"] == "sea"]


def test_sea_on_right_of_coastline(tmp_path):
    from shapely.geometry import Point
    ways = [({"highway": "primary"}, [(127.025, 37.515), (127.055, 37.515)])]
    body = B.build_basemap(fake_store(tmp_path, ways, _coast_across()), tuple(BBOX))
    assert_valid(body)
    kinds = [f["kind"] for f in body["features"]]
    assert kinds[0] == "sea" and kinds.count("sea") == 1, "바다는 맨 앞(배경)"
    assert kinds.count("coast") == 2 and kinds.count("road") == 1   # 해안선 선도 그대로 남는다
    sea = _sea(body)[0]
    assert sea.contains(Point(127.04, 37.495)) and not sea.contains(Point(127.04, 37.515))
    # 바다 면은 해안선 아래 bbox 부분과 거의 같다(단순화 오차 정도)
    w, s, e, n = BBOX
    assert sea.bounds[1] == pytest.approx(s, abs=TOL) and sea.bounds[3] < 37.509
    assert sea.bounds[0] == pytest.approx(w, abs=TOL) and sea.bounds[2] == pytest.approx(e, abs=TOL)


def test_sea_side_follows_coastline_direction(tmp_path):
    from shapely.geometry import Point
    body = B.build_basemap(fake_store(tmp_path, NO_ROADS, _coast_across(reverse=True)), tuple(BBOX))
    assert_valid(body)
    sea = _sea(body)
    assert len(sea) == 1
    assert sea[0].contains(Point(127.04, 37.515)) and not sea[0].contains(Point(127.04, 37.495))


def test_sea_around_island(tmp_path):
    # bbox 안의 섬(해안선이 반시계 방향으로 닫힘, 왼쪽=안쪽이 육지): 섬 밖이 바다이고 섬은 구멍이다.
    from shapely.geometry import LineString, Point
    ring = [(127.03, 37.50), (127.05, 37.50), (127.05, 37.51), (127.03, 37.51), (127.03, 37.50)]
    body = B.build_basemap(fake_store(tmp_path, NO_ROADS, [("coast", LineString(ring))]), tuple(BBOX))
    assert_valid(body)
    sea = _sea(body)
    assert len(sea) == 1 and len(sea[0].interiors) == 1
    assert sea[0].contains(Point(127.025, 37.495)) and not sea[0].contains(Point(127.04, 37.505))


@pytest.mark.parametrize("coast", [
    [(127.021, 37.505), (127.059, 37.506)],   # bbox 안에서 끝남(bbox를 나누지 못함)
    [(127.00, 37.505), (127.04, 37.506)],     # 한쪽 변만 넘음
    [(127.00, 37.53), (127.08, 37.535)],      # bbox 밖
])
def test_no_sea_when_coastline_does_not_divide_bbox(tmp_path, coast):
    from shapely.geometry import LineString
    body = B.build_basemap(fake_store(tmp_path, NO_ROADS, [("coast", LineString(coast))]), tuple(BBOX))
    assert_valid(body)
    assert "sea" not in [f["kind"] for f in body["features"]]


def test_sea_kept_first_in_coord_budget(tmp_path):
    # 좌표 상한을 넘는 도로가 많아도 바다 면(순위 0, 응답 맨 앞)은 남는다.
    store = fake_store(tmp_path, _budget_ways(), _coast_across())
    body = B.build_basemap(store, tuple(BBOX))
    assert_valid(body)
    assert _coords(body) <= B.MAX_TOTAL_COORDS
    kinds = [f["kind"] for f in body["features"]]
    assert kinds[0] == "sea" and "road" in kinds and kinds.count("road") < 40


def test_global_cap_even_if_kind_caps_change(tmp_path, monkeypatch):
    monkeypatch.setattr(B, "KIND_CAPS", {**B.KIND_CAPS, "road": 500})
    ways = [({"highway": "primary"}, [(127.021, 37.4902 + i * 0.0002), (127.059, 37.4902 + i * 0.0002)])
            for i in range(140)]
    body = B.build_basemap(fake_store(tmp_path, ways, []), tuple(BBOX))
    assert len(body["features"]) == 99


def test_real_national_store_format(tmp_path):
    """실제 NationalStore(합성 npy + MANIFEST)로 읽는다. 고정 자료의 way는 footway와 태그만 있는 길이라 큰길이 없다."""
    from shapely.geometry import box
    from runway_routing.national.store import NationalStore
    from fixtures.national_store import write_store
    path = write_store(tmp_path)
    write_env(path, [("park", box(127.035, 37.498, 127.045, 37.505))])
    store = NationalStore(path)
    c, _ = make_client(tmp_path, store)
    r = c.post(BASEMAPS, json={"bbox": [127.03, 37.495, 127.05, 37.51]})
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["osm_data_timestamp"] == "2026-10-20T20:23:47Z"
    assert [f["kind"] for f in body["features"]] == ["park"]
    assert_valid(body, [127.03, 37.495, 127.05, 37.51])


def test_empty_area_inside_coverage(tmp_path):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    r = c.post(BASEMAPS, json={"bbox": [129.0, 35.0, 129.01, 35.01]})
    assert r.status_code == 200 and r.json()["features"] == []


# ------------------------------------------------------------------ 오류
@pytest.mark.parametrize("bbox", [
    [127.06, 37.49, 127.02, 37.52],          # west > east
    [127.02, 37.52, 127.06, 37.49],          # south > north
    [127.02, 37.49, 127.02, 37.52],          # 넓이 0
    [127.0, 37.49, 127.1, 37.52],            # 가로 약 8.8 km
    [127.02, 37.40, 127.06, 37.52],          # 세로 약 13 km
    [127.02, 37.49, 127.06],                 # 길이 3
    [127.02, 37.49, 127.06, 37.52, 1.0],     # 길이 5
    [127.02, "37.49", 127.06, 37.52],        # 문자열
    [127.02, True, 127.06, 37.52],           # bool
    [-181, 37.49, -180.5, 37.52],            # 경도 범위
    [127.02, 90.5, 127.06, 91],              # 위도 범위
    [-180, 37.49, 180, 37.52],               # 경도 폭 360도(haversine 가로는 0에 가깝게 접힌다)
    [127.0, -90, 127.01, 90],                # 위도 폭 180도
    None,
])
def test_validation_error(tmp_path, bbox):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []))
    j = assert_error(c.post(BASEMAPS, json={"bbox": bbox}), 400, "VALIDATION_ERROR")
    assert j["details"]["fields"] and j["details"]["fields"][0]["name"].startswith("bbox")


@pytest.mark.parametrize("raw", [
    '{"bbox": [NaN, 37.49, 127.06, 37.52]}',
    '{"bbox": [127.02, 37.49, Infinity, 37.52]}',
    '{}',
    '[1, 2, 3, 4]',
    'not json',
])
def test_validation_error_raw(tmp_path, raw):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []))
    r = c.post(BASEMAPS, content=raw, headers={"content-type": "application/json"})
    assert_error(r, 400, "VALIDATION_ERROR")


def test_recommend_validation_same_400(tmp_path):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []))
    assert_error(c.post("/internal/v1/routes/recommendations", json={"lat": "x"}), 400, "VALIDATION_ERROR")


def test_side_limit_boundary():
    # 경계(8 km 이하)는 통과, 넘으면 거절
    from app.schemas import BasemapRequest
    from pydantic import ValidationError
    lat = 37.5
    dlon = 7990 / (B.EARTH_R_M * math.cos(math.radians(lat))) * 180 / math.pi
    BasemapRequest(bbox=[127.0, lat, 127.0 + dlon, lat + 0.01])
    with pytest.raises(ValidationError):
        BasemapRequest(bbox=[127.0, lat, 127.0 + dlon * 1.01, lat + 0.01])


def test_out_of_area(tmp_path):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []))
    for bbox in ([0.0, 0.0, 0.05, 0.05], [123.93, 37.0, 123.99, 37.05], [127.0, 39.0, 127.05, 39.05]):
        j = assert_error(c.post(BASEMAPS, json={"bbox": bbox}), 422, "OUT_OF_AREA")
        assert "지도" in j["message"]
    # 일부만 겹치면 정상(겹치는 부분만 자료가 있다)
    assert c.post(BASEMAPS, json={"bbox": [123.97, 37.0, 124.03, 37.05]}).status_code == 200


def test_not_ready_and_unavailable(tmp_path):
    gate = threading.Event()
    store = fake_store(tmp_path, normal_ways(), [])

    def slow(_):
        gate.wait(10)
        return SimpleNamespace(store=store, lock=threading.Lock())

    cfg = replace(settings(tmp_path, warmup=False), data_mode="national", national_dir=tmp_path)
    with TestClient(create_app(cfg, slow, background=True)) as c:
        assert_error(c.post(BASEMAPS, json={"bbox": BBOX}), 503, "NOT_READY")
        gate.set()
        for _ in range(100):
            if c.app.state.engine.phase == "ready":
                break
            time.sleep(0.05)
        assert c.post(BASEMAPS, json={"bbox": BBOX}).status_code == 200

    def broken(_):
        raise RuntimeError("load failed")

    app = create_app(cfg, broken, background=False)
    app.state.engine.start()
    assert app.state.engine.phase == "failed"
    c = TestClient(app)
    assert_error(c.post(BASEMAPS, json={"bbox": BBOX}), 503, "UNAVAILABLE")


def test_busan_mode_unavailable(tmp_path):
    from test_api import FakePipeline
    app = create_app(settings(tmp_path, warmup=False), lambda _: FakePipeline(), background=False)
    app.state.engine.start()
    j = assert_error(TestClient(app).post(BASEMAPS, json={"bbox": BBOX}), 503, "UNAVAILABLE")
    assert "부산" in j["message"]


def test_internal_error(tmp_path, monkeypatch):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []))

    def boom(*_):
        raise RuntimeError("x")

    monkeypatch.setattr(B, "build_basemap", boom)
    assert_error(c.post(BASEMAPS, json={"bbox": BBOX}), 500, "INTERNAL")


def test_does_not_take_pipeline_lock(tmp_path):
    c, pipe = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    c.post(BASEMAPS, json={"bbox": BBOX})   # 첫 호출 import·Transformer 비용 제외
    assert pipe.lock.acquire(timeout=1)     # 추천 계산이 엔진 lock을 잡고 있는 상황
    try:
        t0 = time.perf_counter()
        r = c.post(BASEMAPS, json={"bbox": BBOX})
        elapsed = time.perf_counter() - t0
    finally:
        pipe.lock.release()
    assert r.status_code == 200 and r.json()["features"]
    assert elapsed < 5.0


def test_concurrent_requests_same_result(tmp_path):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    expected = c.post(BASEMAPS, json={"bbox": BBOX}).json()
    results = []

    def call():
        results.append(c.post(BASEMAPS, json={"bbox": BBOX}).json())

    threads = [threading.Thread(target=call) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert len(results) == 6 and all(r == expected for r in results)


def test_degenerate_geometry_dropped():
    from shapely.geometry import LineString, Polygon
    assert B._to_geojson(LineString([(127.000001, 37.5), (127.000002, 37.5)])) is None
    assert B._to_geojson(Polygon([(127.0, 37.5), (127.000001, 37.5), (127.000001, 37.500001)])) is None
    hole = [(127.01, 37.51), (127.010001, 37.51), (127.010001, 37.510001)]
    gj = B._to_geojson(Polygon([(127.0, 37.5), (127.02, 37.5), (127.02, 37.52), (127.0, 37.52)], [hole]))
    assert gj["type"] == "Polygon" and len(gj["coordinates"]) == 1 and gj["coordinates"][0][0] == gj["coordinates"][0][-1]


def test_wrapped_longitude_span_rejected():
    # 날짜변경선을 감싸는 bbox: haversine 가로가 작게 나와도 경도 폭 1도 초과로 400이다.
    from app.schemas import BasemapRequest
    from pydantic import ValidationError
    assert max(B.side_lengths_m([-180, 37.49, 180, 37.52])) <= B.MAX_SIDE_M
    with pytest.raises(ValidationError):
        BasemapRequest(bbox=[-180, 37.49, 180, 37.52])
    with pytest.raises(ValidationError):
        BasemapRequest(bbox=[-179.5, 37.49, 179.5, 37.52])


# ------------------------------------------------------------------ 응답 크기 상한
def _holey_park(n=30):
    """bbox 대부분을 덮는 공원 하나에 작은 구멍 n x n개(각 약 26 m x 22 m)와 큰 구멍 1개(약 790 m x 890 m)."""
    from shapely.geometry import Polygon, box
    w, s, e, n_ = 127.022, 37.4915, 127.058, 37.5185
    holes = []
    for i in range(n):
        for j in range(n):
            x, y = w + 0.001 + i * 0.0007, s + 0.001 + j * 0.0005
            holes.append(list(box(x, y, x + 0.0003, y + 0.0002).exterior.coords))
    big = list(box(127.047, 37.509, 127.056, 37.517).exterior.coords)
    return Polygon(box(w, s, e, n_).exterior.coords, holes + [big]), len(holes)


def test_small_polygon_holes_dropped(tmp_path):
    park, n_small = _holey_park()
    assert n_small == 900 and park.is_valid
    minor = [({"highway": "service"}, [(127.035, 37.495), (127.045, 37.497)])]   # 도로 없음(빈 도로망 대신)
    body = B.build_basemap(fake_store(tmp_path, minor, [("park", park)]), tuple(BBOX))
    assert_valid(body)
    parks = [f for f in body["features"] if f["kind"] == "park"]
    assert len(parks) == 1
    rings = parks[0]["geometry"]["coordinates"]
    assert len(rings) == 2, "작은 구멍은 모두 버리고 바탕 면적 기준 이상인 큰 구멍만 남긴다"


def test_drop_small_holes_threshold():
    from shapely.geometry import Polygon, box
    outer = box(0, 0, 100, 100).exterior.coords
    poly = Polygon(outer, [box(10, 10, 12, 12).exterior.coords, box(50, 50, 70, 70).exterior.coords])
    kept = B._drop_small_holes(poly, 100.0)
    assert len(kept.interiors) == 1 and Polygon(kept.interiors[0]).area == 400
    assert B._drop_small_holes(poly, 1.0) is poly


def _zigzag(y0, x0=127.021, x1=127.059, step=0.0002, amp=0.0005):
    """bbox를 가로지르는 톱니 선. 꺾임(약 55 m)이 단순화 허용 오차(약 17.6 m)보다 커서 점이 남는다."""
    n = int((x1 - x0) / step)
    return [(round(x0 + i * step, 6), y0 + (amp if i % 2 else 0.0)) for i in range(n + 1)]


def _budget_ways():
    return [({"highway": "primary"}, _zigzag(37.4905 + i * 0.0007)) for i in range(40)]


def _budget_env():
    from shapely.geometry import LineString
    return [("river", LineString(_zigzag(37.4908 + k * 0.0029))) for k in range(10)]


def _coords(body):
    return sum(B._coord_count(f["geometry"]) for f in body["features"])


def test_total_coord_budget(tmp_path, monkeypatch):
    store = fake_store(tmp_path, _budget_ways(), _budget_env())
    monkeypatch.setattr(B, "MAX_TOTAL_COORDS", 10 ** 9)
    unbounded = B.build_basemap(store, tuple(BBOX))
    assert _coords(unbounded) > 6000, "합성 자료가 상한을 넘어야 의미가 있다"
    monkeypatch.undo()

    assert B.MAX_TOTAL_COORDS == 6000
    c, _ = make_client(tmp_path, store)
    r = c.post(BASEMAPS, json={"bbox": BBOX})
    assert r.status_code == 200, r.json()
    body = r.json()
    assert_valid(body)
    assert _coords(body) <= B.MAX_TOTAL_COORDS
    assert len(r.content) < 256 * 1024
    # 남은 것은 각 종류에서 순위가 높은 앞쪽 feature다(기존 순위 유지, 순서 그대로).
    for kind in ("road", "river"):
        full = [f for f in unbounded["features"] if f["kind"] == kind]
        kept = [f for f in body["features"] if f["kind"] == kind]
        assert kept and kept == full[:len(kept)], kind
    assert len(body["features"]) < len(unbounded["features"])


def test_fit_coord_budget_drops_lowest_rank_first():
    def line(n):
        return {"kind": "road", "geometry": {"type": "LineString", "coordinates": [[0.0, float(i)] for i in range(n)]}}
    feats = [line(10), line(10), line(10), line(10)]
    # 종류 A 순위 0,1 / 종류 B 순위 0,1
    out = B._fit_coord_budget(feats, [0, 1, 0, 1], 25)
    assert out == [feats[0], feats[2]]
    assert B._fit_coord_budget(feats, [0, 1, 0, 1], 40) is feats


def test_fit_coord_budget_skips_only_oversized_feature():
    # 재검토 F-1: 혼자 예산을 넘는 면 하나 때문에 큰길까지 모두 빠져 빈 응답이 되면 안 된다.
    def line(n, kind="road"):
        return {"kind": kind, "geometry": {"type": "LineString", "coordinates": [[0.0, float(i)] for i in range(n)]}}
    huge = line(6500, "park")
    roads = [line(10) for _ in range(40)]
    feats = [huge] + roads
    out = B._fit_coord_budget(feats, [0] + list(range(40)), 6000)
    assert out == roads
    assert sum(len(f["geometry"]["coordinates"]) for f in out) <= 6000

"""POST /internal/v1/basemaps detail="full"(S15P31E105-612 서버 렌더 평면 PNG 썸네일): 보행로·건물까지 담는 상세 모드.

test_basemap.py의 합성 저장소(network 배열 + envcache/layers.gpkg)에 작은 buildings.gpkg를 더해 검증한다.
"""
import json
import time

import numpy as np
import pytest

from app import basemap as B
from app.main import BASEMAPS
from test_api import assert_error
from test_basemap import BBOX, TIMESTAMP, TOL, all_points, fake_store, make_client, normal_env, normal_ways

BLD_TIMESTAMP = "2026-11-01T00:00:00Z"
FINE_MPP = 1.0   # 축척 단계(LOD)로 빼는 것이 없는 축척(모든 도로 등급, 건물 최소 15 m², 단순화는 bbox 기준 그대로)


def write_buildings(national_dir, rows, metadata=True):
    """rows: [(osm_id, height_m, Polygon 또는 MultiPolygon)] -> {national_dir}/buildings/buildings.gpkg(+metadata.json).
    빌더(tools/data/national/build_buildings.py)와 같은 layer·열 형식."""
    import geopandas as gpd
    from shapely.geometry import MultiPolygon
    out = national_dir / "buildings"
    out.mkdir(parents=True, exist_ok=True)
    geoms = [g if g.geom_type == "MultiPolygon" else MultiPolygon([g]) for _, _, g in rows]
    gdf = gpd.GeoDataFrame({"osm_id": np.asarray([r[0] for r in rows], np.int64),
                            "height_m": np.asarray([r[1] for r in rows], np.float64)},
                           geometry=geoms, crs="EPSG:4326")
    gdf.to_file(out / "buildings.gpkg", layer="buildings", driver="GPKG", engine="pyogrio", index=False,
                geometry_type="MultiPolygon", layer_options={"SPATIAL_INDEX": "YES"})
    if metadata:
        (out / "metadata.json").write_text(json.dumps({"format": 1, "osm_data_timestamp": BLD_TIMESTAMP,
                                                       "count": len(rows)}), encoding="utf-8")
    return out


def full_ways():
    lat = 37.505
    return normal_ways() + [
        ({"highway": "footway"}, [(127.025, 37.494), (127.055, 37.494)]),
        ({"highway": "cycleway"}, [(127.025, 37.4945), (127.055, 37.4945)]),
        ({"highway": "path"}, [(127.025, 37.4955), (127.055, 37.4955)]),
        ({"highway": "pedestrian"}, [(127.025, 37.4965), (127.055, 37.4965)]),
        # 빠져야 하는 길(full에서도)
        ({"highway": "steps"}, [(127.025, 37.5165), (127.055, 37.5165)]),
        ({"highway": "track"}, [(127.025, 37.5170), (127.055, 37.5170)]),
        ({"highway": "service"}, [(127.025, 37.5175), (127.055, 37.5175)]),
        # *_link는 상위 등급(road_class=trunk)
        ({"highway": "trunk_link"}, [(127.025, lat + 0.011), (127.055, lat + 0.011)]),
    ]


def bld_rows():
    from shapely.geometry import MultiPolygon, Polygon, box
    big_hole = Polygon(box(127.031, 37.501, 127.033, 37.503).exterior.coords,
                       [box(127.0315, 37.5015, 127.0325, 37.5025).exterior.coords])   # 안뜰(구멍) 있는 건물
    return [
        (1, 9.0, box(127.040, 37.500, 127.0405, 37.5004)),                        # 약 44 m x 44 m
        (2, 48.0, box(127.041, 37.500, 127.0412, 37.5002)),
        (-3, 6.4, big_hole),
        (4, 12.0, MultiPolygon([box(127.045, 37.500, 127.0452, 37.5002), box(127.046, 37.500, 127.0462, 37.5002)])),
        (5, 9.0, box(127.042, 37.500, 127.04203, 37.50003)),                      # 약 2.6 m x 3.3 m < 15 m² -> 버림
        (6, 30.0, box(127.0595, 37.505, 127.0610, 37.506)),                       # bbox 동쪽 변에 걸쳐 잘린다
        (7, 9.0, box(128.0, 36.0, 128.001, 36.001)),                              # bbox 밖
    ]


def assert_valid_full(body, bbox=BBOX):
    w, s, e, n = bbox
    assert set(body) == {"osm_data_timestamp", "buildings_available", "buildings_osm_data_timestamp", "features"}
    order = [B.FULL_DRAW_ORDER.index(f["kind"]) for f in body["features"]]
    assert order == sorted(order), "배경 먼저, 건물 마지막"
    for f in body["features"]:
        if f["kind"] == "road":
            assert set(f) == {"kind", "geometry", "road_class"} and f["road_class"] in B.FULL_ROAD_CLASSES
        elif f["kind"] == "building":
            assert set(f) == {"kind", "geometry", "height_m"}
            assert isinstance(f["height_m"], float) and 0 < f["height_m"] <= 300
            assert f["geometry"]["type"] == "Polygon"
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
def test_full_without_buildings_file(tmp_path):
    c, _ = make_client(tmp_path, fake_store(tmp_path, full_ways(), normal_env()))
    r = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full", "meters_per_pixel": FINE_MPP})
    assert r.status_code == 200, r.json()
    body = r.json()
    assert_valid_full(body)
    assert body["osm_data_timestamp"] == TIMESTAMP
    assert body["buildings_available"] is False and body["buildings_osm_data_timestamp"] is None
    kinds = [f["kind"] for f in body["features"]]
    assert "building" not in kinds
    classes = [f["road_class"] for f in body["features"] if f["kind"] == "road"]
    # 등급 순(같은 등급은 길이 순). primary_link는 primary와 끝점이 이어지지 않아 별도 선, trunk_link -> trunk.
    assert classes == ["motorway", "trunk", "primary", "primary", "secondary", "tertiary", "residential",
                       "pedestrian", "footway", "footway", "path", "cycleway"]
    assert {"park", "water", "river", "coast", "beach"} <= set(kinds)
    # full은 작은 면도 남긴다(thumb에서는 bbox 면적 0.1 % 미만이라 버리는 green)
    assert "green" in kinds
    # 같은 요청은 같은 응답
    assert c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full", "meters_per_pixel": FINE_MPP}).json() == body


def test_full_with_buildings(tmp_path):
    from shapely.geometry import shape
    write_buildings(tmp_path, bld_rows())
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    r = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"})
    assert r.status_code == 200, r.json()
    body = r.json()
    assert_valid_full(body)
    assert body["buildings_available"] is True and body["buildings_osm_data_timestamp"] == BLD_TIMESTAMP
    blds = [f for f in body["features"] if f["kind"] == "building"]
    # 1, 2, -3, 4(두 조각), 6(잘림) = 6개. 5(15 m² 미만), 7(bbox 밖) 없음. 면적 큰 것부터.
    assert len(blds) == 6
    areas = [shape(f["geometry"]).area for f in blds]
    assert areas == sorted(areas, reverse=True)
    heights = sorted(f["height_m"] for f in blds)
    assert heights == [6.4, 9.0, 12.0, 12.0, 30.0, 48.0]
    courtyard = [f for f in blds if f["height_m"] == 6.4][0]
    assert len(courtyard["geometry"]["coordinates"]) == 2, "15 m² 이상 구멍(안뜰)은 남는다"
    clipped = [f for f in blds if f["height_m"] == 30.0][0]
    assert max(p[0] for p in all_points(clipped)) == pytest.approx(BBOX[2], abs=TOL)
    assert body["features"][-1]["kind"] == "building"


def test_full_buildings_without_metadata(tmp_path):
    from shapely.geometry import box
    write_buildings(tmp_path, [(1, 9.0, box(127.040, 37.500, 127.0405, 37.5004))], metadata=False)
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []))
    body = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"}).json()
    assert body["buildings_available"] is True and body["buildings_osm_data_timestamp"] is None
    assert [f["kind"] for f in body["features"]].count("building") == 1


def test_buildings_metadata_cache_rereads_changed_file(tmp_path):
    from shapely.geometry import box
    out = write_buildings(tmp_path, [(1, 9.0, box(127.040, 37.500, 127.0405, 37.5004))])
    assert B.buildings_metadata(out)["osm_data_timestamp"] == BLD_TIMESTAMP
    assert B.buildings_metadata(out) is B.buildings_metadata(out)   # 바뀌지 않으면 다시 읽지 않는다
    (out / "metadata.json").write_text(json.dumps({"osm_data_timestamp": "2027-01-01T00:00:00Z", "x": 1}),
                                       encoding="utf-8")
    assert B.buildings_metadata(out)["osm_data_timestamp"] == "2027-01-01T00:00:00Z"
    (out / "metadata.json").write_text("not json", encoding="utf-8")
    assert B.buildings_metadata(out) is None
    assert B.buildings_metadata(tmp_path / "nowhere") is None and B.buildings_metadata(None) is None


def test_thumb_unchanged_with_buildings_file(tmp_path):
    write_buildings(tmp_path, bld_rows())
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    default = c.post(BASEMAPS, json={"bbox": BBOX}).json()
    explicit = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "thumb"}).json()
    assert default == explicit
    assert set(default) == {"osm_data_timestamp", "features"}
    assert "building" not in [f["kind"] for f in default["features"]]
    assert B.build_basemap(fake_store(tmp_path, normal_ways(), normal_env()), tuple(BBOX)) == default


@pytest.mark.parametrize("detail", ["x", "FULL", 1, None, True])
def test_detail_validation(tmp_path, detail):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []))
    j = assert_error(c.post(BASEMAPS, json={"bbox": BBOX, "detail": detail}), 400, "VALIDATION_ERROR")
    assert j["details"]["fields"][0]["name"].startswith("detail")


def test_build_basemap_unknown_detail(tmp_path):
    with pytest.raises(ValueError):
        B.build_basemap(fake_store(tmp_path, normal_ways(), []), tuple(BBOX), "medium")


# ------------------------------------------------------------------ 상한과 빼는 순서
def _rec(kind, size, road_class=None, n=5):
    f = {"kind": kind, "geometry": {"type": "LineString", "coordinates": [[127.0, 37.0 + i * 1e-5] for i in range(n)]}}
    if road_class:
        f["road_class"] = road_class
    return kind, road_class, size, f, n, len(json.dumps(f, separators=(",", ":")))


def test_fit_full_limits_drop_order(monkeypatch):
    recs = [_rec("sea", 9e6), _rec("green", 50.0), _rec("green", 900.0), _rec("park", 10.0),
            _rec("road", 500.0, "primary"), _rec("road", 5.0, "residential"),
            _rec("road", 30.0, "footway"), _rec("road", 10.0, "cycleway"), _rec("road", 20.0, "path"),
            _rec("road", 40.0, "pedestrian"),
            _rec("building", 300.0), _rec("building", 20.0), _rec("building", 100.0)]
    feats = [r[3] for r in recs]
    assert B._fit_full_limits(recs) == feats   # 상한 안이면 그대로

    def kept(max_features):
        monkeypatch.setattr(B, "MAX_FULL_FEATURES", max_features)
        out = B._fit_full_limits(recs)
        pos = {id(f): i for i, f in enumerate(feats)}
        return [pos[id(f)] for f in out]

    everything = list(range(len(recs)))
    assert kept(12) == [i for i in everything if i != 11]                  # 가장 작은 건물
    assert kept(10) == everything[:10]                                     # 건물 모두
    assert kept(9) == [i for i in everything[:10] if i != 7]               # 다음은 가장 짧은 보행로(cycleway)
    assert kept(7) == [0, 1, 2, 3, 4, 5, 9]                                # footway/path/cycleway 모두(pedestrian은 남음)
    assert kept(6) == [0, 2, 3, 4, 5, 9]                                   # 다음은 작은 green
    assert kept(5) == [0, 3, 4, 5, 9]
    assert kept(4) == [0, 3, 4, 5]                                         # 그다음 가장 낮은 등급 도로(pedestrian)
    assert kept(3) == [0, 3, 4]                                            # 다음 등급(residential)
    assert kept(1) == [0]                                                  # 바다는 마지막까지 남는다


def test_fit_full_limits_coords_and_bytes(monkeypatch):
    recs = [_rec("road", 500.0, "primary", n=100)] + [_rec("building", float(i + 1), n=50) for i in range(10)]
    monkeypatch.setattr(B, "MAX_FULL_COORDS", 300)
    out = B._fit_full_limits(recs)
    assert sum(len(f["geometry"]["coordinates"]) for f in out) <= 300
    assert out == [recs[0][3]] + [r[3] for r in recs[-4:]]     # 큰 건물 4개 남음
    monkeypatch.undo()
    whole = len(json.dumps([r[3] for r in recs], separators=(",", ":")))
    monkeypatch.setattr(B, "MAX_FULL_BYTES", whole // 2 + B.FULL_ENVELOPE_BYTES)
    out = B._fit_full_limits(recs)
    assert len(json.dumps(out, separators=(",", ":"))) <= whole // 2
    assert out[0] is recs[0][3] and out[-1] is recs[-1][3]


def test_full_limits_end_to_end(tmp_path, monkeypatch):
    # 실제 응답에서도 건물(작은 것부터) -> 보행로 -> green 순서로 빠진다.
    from shapely.geometry import box
    rows = [(i, 9.0, box(127.025 + i * 0.0006, 37.500, 127.0253 + i * 0.0006 + i * 0.00001, 37.5003))
            for i in range(20)]
    write_buildings(tmp_path, rows)
    c, _ = make_client(tmp_path, fake_store(tmp_path, full_ways(), normal_env()))
    full = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"}).json()
    n_bld = sum(f["kind"] == "building" for f in full["features"])
    assert n_bld == 20
    monkeypatch.setattr(B, "MAX_FULL_FEATURES", len(full["features"]) - 5)
    body = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"}).json()
    assert_valid_full(body)
    blds = [f for f in body["features"] if f["kind"] == "building"]
    assert len(blds) == 15
    expect = [f for f in full["features"] if f["kind"] == "building"][:15]   # 응답은 면적 큰 순이라 앞 15개가 남는다
    assert blds == expect
    assert [f for f in body["features"] if f["kind"] != "building"] == \
        [f for f in full["features"] if f["kind"] != "building"]


# ------------------------------------------------------------------ 촘촘한 도심(크기·시간)
def test_full_dense_city_size_and_time(tmp_path):
    """4 km x 4 km에 건물 약 6만 개 + 도로 격자. 응답은 상한 안(feature·좌표·8 MB)이고 몇 초 안에 끝난다."""
    from shapely.geometry import box
    w, s = 127.00, 37.50
    e, n = w + 0.0452, s + 0.036                 # 약 4.0 km x 4.0 km
    bbox = [w, s, e, n]
    rows, k = [], 0
    for i in range(245):
        for j in range(245):
            x, y = w + 0.0001 + i * 0.000184, s + 0.0001 + j * 0.000146
            rows.append((k, 9.0 + (k % 30), box(x, y, x + 0.00011 + (k % 7) * 1e-5, y + 0.00009)))
            k += 1
    write_buildings(tmp_path, rows)
    ways = []
    for i in range(60):   # 가로·세로 도로 + 보행로
        y = s + 0.0003 + i * 0.0006
        x = w + 0.0003 + i * 0.00075
        cls = ("primary", "residential", "footway")[i % 3]
        ways.append(({"highway": cls}, [(w - 0.001 + t * 0.0025, y + (t % 2) * 0.00005) for t in range(20)]))
        ways.append(({"highway": cls}, [(x + (t % 2) * 0.00005, s - 0.001 + t * 0.002) for t in range(20)]))
    c, _ = make_client(tmp_path, fake_store(tmp_path, ways, normal_env()))
    c.post(BASEMAPS, json={"bbox": [127.02, 37.49, 127.021, 37.491], "detail": "full"})   # import·Transformer 예열
    t0 = time.perf_counter()
    r = c.post(BASEMAPS, json={"bbox": bbox, "detail": "full", "meters_per_pixel": FINE_MPP})
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200, r.json()
    body = r.json()
    assert len(r.content) < 8_000_000
    assert len(r.content) <= B.MAX_FULL_BYTES + 200
    feats = body["features"]
    assert len(feats) <= B.MAX_FULL_FEATURES
    assert sum(B._coord_count(f["geometry"]) for f in feats) <= B.MAX_FULL_COORDS
    kinds = [f["kind"] for f in feats]
    assert kinds.count("building") < len(rows), "합성 자료가 상한을 넘어야 의미가 있다"
    assert kinds.count("road") == 120 and "footway" in {f.get("road_class") for f in feats}   # 건물만 빠진다
    assert_valid_full(body, bbox)
    print(f"dense full: {elapsed:.2f}s, {len(r.content):,} bytes, {len(feats):,} features")
    assert elapsed < 15.0, elapsed


# ------------------------------------------------------------------ 축척 단계(LOD, meters_per_pixel). 리뷰 B-2
def _lod_ways():
    return full_ways() + [
        ({"highway": "living_street"}, [(127.025, 37.4975), (127.055, 37.4975)]),
        ({"highway": "unclassified"}, [(127.025, 37.4985), (127.055, 37.4985)]),
    ]


def _road_classes(c, mpp):
    body = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full", "meters_per_pixel": mpp}).json()
    assert_valid_full(body)
    return {f["road_class"] for f in body["features"] if f["kind"] == "road"}


def test_lod_road_class_thresholds(tmp_path):
    c, _ = make_client(tmp_path, fake_store(tmp_path, _lod_ways(), normal_env()))
    paths, local = set(B.PATH_LOD_CLASSES), set(B.LOCAL_ROAD_LOD_CLASSES)
    major = {"motorway", "trunk", "primary", "secondary", "tertiary"}
    assert _road_classes(c, B.PATH_MAX_MPP) == major | paths | local           # 5: 보행로까지 모두
    assert _road_classes(c, B.PATH_MAX_MPP + 0.01) == major | local            # 5 초과: 보행로 등급 없음
    assert _road_classes(c, B.LOCAL_ROAD_MAX_MPP) == major | local             # 8: 이면도로 남음
    assert _road_classes(c, B.LOCAL_ROAD_MAX_MPP + 0.01) == major              # 8 초과: 큰길만
    assert _road_classes(c, B.MAX_METERS_PER_PIXEL) == major


def test_lod_helpers():
    assert (B.PATH_MAX_MPP, B.LOCAL_ROAD_MAX_MPP, B.MIN_BUILDING_PX, B.SIMPLIFY_MPP_FACTOR) == (5.0, 8.0, 1.5, 0.5)
    assert "footway" in B.full_road_classes(5.0) and "pedestrian" in B.full_road_classes(5.0)
    assert not set(B.PATH_LOD_CLASSES) & set(B.full_road_classes(5.0001))
    assert "residential" in B.full_road_classes(8.0)
    assert B.full_road_classes(8.0001) == ("motorway", "trunk", "primary", "secondary", "tertiary")
    assert B.min_building_area_m2(1.0) == B.MIN_BUILDING_AREA_M2          # (1.5 m)² < 15 m² -> 15 m²
    assert B.min_building_area_m2(10.0) == pytest.approx(225.0)           # (1.5 x 10)²
    width, height = B.side_lengths_m(BBOX)
    assert B.default_meters_per_pixel(BBOX) == pytest.approx(width / 600)
    base = max(width, height) / B.FULL_SIMPLIFY_DIVISOR
    assert B.full_simplify_tolerance(BBOX, 1.0) == pytest.approx(base)    # bbox 기준이 더 크다
    assert B.full_simplify_tolerance(BBOX, 40.0) == pytest.approx(20.0)   # 0.5 x mpp


def test_lod_building_min_area(tmp_path):
    import math
    from shapely.geometry import box
    write_buildings(tmp_path, bld_rows())
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    # 건물 2(약 17.6 m x 22 m)의 투영 면적에서 (1.5 x mpp)² 경계를 구한다
    to_k, _ = B._transformers()
    area = B._project(box(127.041, 37.500, 127.0412, 37.5002), to_k).area
    edge = math.sqrt(area) / B.MIN_BUILDING_PX

    def heights(mpp):
        body = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full", "meters_per_pixel": mpp}).json()
        assert_valid_full(body)
        return sorted(f["height_m"] for f in body["features"] if f["kind"] == "building")

    assert 48.0 in heights(edge * 0.99)       # 면적 >= (1.5 px)²: 남는다
    assert 48.0 not in heights(edge * 1.01)   # 면적 < (1.5 px)²: 버린다
    assert heights(FINE_MPP) == [6.4, 9.0, 12.0, 12.0, 30.0, 48.0]


def test_lod_simplify_tolerance_follows_mpp(tmp_path):
    # 폭 약 3 m로 지그재그인 primary. 작은 bbox(약 620 m)라 bbox 기준 허용 오차는 약 1 m다.
    zig = [(127.031 + i * 0.0002, 37.5025 + (0.00003 if i % 2 else -0.00003)) for i in range(26)]
    c, _ = make_client(tmp_path, fake_store(tmp_path, [({"highway": "primary"}, zig)], []))
    bbox = [127.03, 37.50, 127.037, 37.505]

    def coords(mpp):
        body = c.post(BASEMAPS, json={"bbox": bbox, "detail": "full", "meters_per_pixel": mpp}).json()
        assert_valid_full(body, bbox)
        (road,) = [f for f in body["features"] if f["kind"] == "road"]
        return len(road["geometry"]["coordinates"])

    assert coords(1.0) == 26                  # 허용 오차 max(약 1 m, 0.5 m) < 진폭: 그대로
    assert coords(20.0) == 2                  # 허용 오차 10 m: 직선으로


def test_lod_default_mpp_is_bbox_width_over_600(tmp_path):
    write_buildings(tmp_path, bld_rows())
    c, _ = make_client(tmp_path, fake_store(tmp_path, _lod_ways(), normal_env()))
    default = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"}).json()
    explicit = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full",
                                      "meters_per_pixel": B.default_meters_per_pixel(BBOX)}).json()
    assert default == explicit
    # 3.5 km bbox -> 약 5.8 m/px: 보행로 없음, 이면도로 있음
    classes = {f["road_class"] for f in default["features"] if f["kind"] == "road"}
    assert "residential" in classes and not classes & set(B.PATH_LOD_CLASSES)


@pytest.mark.parametrize("mpp", [0, -1, 100.001, "1", True, None, [1]])
def test_meters_per_pixel_validation(tmp_path, mpp):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []))
    body = {"bbox": BBOX, "detail": "full", "meters_per_pixel": mpp}
    if mpp is None:   # null은 생략과 같다
        assert c.post(BASEMAPS, json=body).status_code == 200
        return
    j = assert_error(c.post(BASEMAPS, json=body), 400, "VALIDATION_ERROR")
    assert j["details"]["fields"][0]["name"].startswith("meters_per_pixel")


def test_meters_per_pixel_bounds_accepted_and_thumb_ignores_it(tmp_path):
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    for mpp in (0.01, 1, 100):
        assert c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full", "meters_per_pixel": mpp}).status_code == 200
    thumb = c.post(BASEMAPS, json={"bbox": BBOX}).json()
    assert c.post(BASEMAPS, json={"bbox": BBOX, "meters_per_pixel": 50}).json() == thumb


# ------------------------------------------------------------------ 메모리: 투영 전 건물 사전 선별. 리뷰 B-1
def test_building_preselect_keeps_largest_within_budget(tmp_path):
    from shapely.geometry import box
    # 크기가 다른 건물 10개(입력 순서와 크기 순서가 다르다) + 기준 미만 1개
    sizes = [3, 9, 1, 7, 5, 10, 2, 8, 4, 6]
    rows = [(i, float(i + 1), box(127.025 + i * 0.002, 37.50, 127.025 + i * 0.002 + 0.0001 * k, 37.5002))
            for i, k in enumerate(sizes)]
    rows.append((99, 99.0, box(127.05, 37.50, 127.05003, 37.50003)))
    out = write_buildings(tmp_path, rows)
    ok, heights, geoms = B._building_candidates(out, BBOX, 15.0, 4)
    assert ok and len(geoms) == 4
    assert heights.tolist() == [2.0, 4.0, 6.0, 8.0]           # 가장 큰 4개(9, 7, 10, 8), 입력 순서 유지
    ok, heights, _ = B._building_candidates(out, BBOX, 15.0, 0)
    assert ok and len(heights) == 0
    ok, heights, _ = B._building_candidates(out, BBOX, 15.0, 1000)
    assert 99.0 not in heights.tolist() and len(heights) == 10   # 약 7 m² 건물은 기준 미만


def test_full_building_count_bounded_by_feature_budget(tmp_path, monkeypatch):
    from shapely.geometry import box
    rows = [(i, 9.0, box(127.025 + i * 0.0006, 37.500, 127.0253 + i * 0.0006, 37.5003)) for i in range(30)]
    write_buildings(tmp_path, rows)
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()))
    seen = []
    real = B._building_candidates

    def spy(*a, **kw):
        res = real(*a, **kw)
        seen.append((a[3], len(res[2])))
        return res

    monkeypatch.setattr(B, "_building_candidates", spy)
    monkeypatch.setattr(B, "MAX_FULL_FEATURES", 20)
    body = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full", "meters_per_pixel": FINE_MPP}).json()
    budget, n_read = seen[-1]
    assert 0 < budget < 20 and n_read == budget                  # 30동 중 남은 예산만큼만 투영한다
    assert len(body["features"]) <= 20


# ------------------------------------------------------------------ 건물 파일 고장. 리뷰 B-3
def _break_buildings(out, how):
    import geopandas as gpd
    from shapely.geometry import box
    g = out / "buildings.gpkg"
    if how == "garbage":
        g.write_bytes(b"not a sqlite file" * 100)
    elif how == "truncated":
        data = g.read_bytes()
        g.write_bytes(data[: len(data) // 3])
    elif how == "empty":
        g.write_bytes(b"")
    elif how == "wrong_layer":
        g.unlink()
        gpd.GeoDataFrame({"height_m": [9.0]}, geometry=[box(127.04, 37.50, 127.041, 37.501)],
                         crs="EPSG:4326").to_file(g, layer="other", driver="GPKG", engine="pyogrio")
    elif how == "no_height":
        g.unlink()
        gpd.GeoDataFrame({"x": [1]}, geometry=[box(127.04, 37.50, 127.041, 37.501)],
                         crs="EPSG:4326").to_file(g, layer="buildings", driver="GPKG", engine="pyogrio")


@pytest.mark.parametrize("how", ["garbage", "truncated", "empty", "wrong_layer", "no_height"])
def test_broken_buildings_file_still_answers(tmp_path, caplog, how):
    import logging
    _break_buildings(write_buildings(tmp_path, bld_rows()), how)
    c, _ = make_client(tmp_path, fake_store(tmp_path, full_ways(), normal_env()))
    with caplog.at_level(logging.WARNING, logger="runway.ai"):
        r = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full", "meters_per_pixel": FINE_MPP})
    assert r.status_code == 200, r.json()
    body = r.json()
    assert_valid_full(body)
    assert body["buildings_available"] is False and body["buildings_osm_data_timestamp"] is None
    kinds = [f["kind"] for f in body["features"]]
    assert "building" not in kinds and "road" in kinds and "park" in kinds
    warns = [rec for rec in caplog.records if "BUILDINGS_UNAVAILABLE" in rec.getMessage()]
    assert len(warns) == 1 and warns[0].levelno == logging.WARNING
    text = warns[0].getMessage()
    assert "127.0" not in text and "37.4" not in text and "37.5" not in text and str(tmp_path) not in text


# ------------------------------------------------------------------ 오류 로그·debug에 좌표 없음. 리뷰 A-4
@pytest.mark.parametrize("detail", ["thumb", "full"])
def test_basemap_error_log_and_debug_have_no_coordinates(tmp_path, caplog, monkeypatch, detail):
    import logging

    def boom(*_a, **_kw):
        raise ValueError("TopologyException: Self-intersection at 127.03456 37.50123 (bbox 127.02 37.49)")

    monkeypatch.setattr(B, "build_basemap", boom)
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), []), debug=True)
    with caplog.at_level(logging.DEBUG, logger="runway.ai"):
        r = c.post(BASEMAPS, json={"bbox": BBOX, "detail": detail})
    j = assert_error(r, 500, "INTERNAL")
    assert j["debug"] == "ValueError"
    assert "127.0" not in r.text and "37.5" not in r.text
    logs = " | ".join(rec.getMessage() for rec in caplog.records)
    assert "ai_error code=INTERNAL endpoint=/internal/v1/basemaps cause=ValueError" in logs
    assert "127.0" not in logs and "37.5" not in logs and "37.4" not in logs


# ------------------------------------------------------------------ full 동시 실행 1건. 리뷰 B-1
def test_full_runs_one_at_a_time_and_busy_after_wait(tmp_path, monkeypatch):
    import threading
    entered, release = threading.Event(), threading.Event()
    real = B.build_basemap
    calls = {"n": 0}

    def slow(store, bbox, detail="thumb", *a, **kw):
        if detail == "full" and calls["n"] == 0:
            calls["n"] += 1
            entered.set()
            assert release.wait(10)
        return real(store, bbox, detail, *a, **kw)

    def broken(*_a, **_kw):
        raise RuntimeError("x")

    monkeypatch.setattr(B, "build_basemap", slow)
    c, _ = make_client(tmp_path, fake_store(tmp_path, normal_ways(), normal_env()), lock_wait_s=0.3)
    first = {}
    t = threading.Thread(target=lambda: first.setdefault(
        "r", c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"})))
    t.start()
    try:
        assert entered.wait(10)
        t0 = time.perf_counter()
        busy = c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"})
        waited = time.perf_counter() - t0
        j = assert_error(busy, 503, "BUSY")
        assert "지도 바탕" in j["message"] and waited >= 0.25
        # thumb는 full slot과 별개라 바로 답한다
        assert c.post(BASEMAPS, json={"bbox": BBOX}).status_code == 200
    finally:
        release.set()
        t.join(10)
    assert first["r"].status_code == 200
    # 끝나면 slot이 풀린다(예외로 끝나도 풀린다)
    assert c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"}).status_code == 200
    monkeypatch.setattr(B, "build_basemap", broken)
    assert_error(c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"}), 500, "INTERNAL")
    monkeypatch.setattr(B, "build_basemap", real)
    assert c.post(BASEMAPS, json={"bbox": BBOX, "detail": "full"}).status_code == 200

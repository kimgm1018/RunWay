"""tools/data/national/build_buildings.py(S15P31E105-612): 작은 합성 .osm XML로 건물 layer를 만든다."""
import json
import sqlite3

import pytest

from tools.data.national import build_buildings as BB

# 1~4: 건물(way 10), 5~8: 층수 건물(way 11), 9~12: 높이 건물(way 12), 20~27: relation 바깥·안쪽 ring, 30~31: 도로
OSM = """<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
  <node id="1" version="1" lat="37.5000" lon="127.0000"/>
  <node id="2" version="1" lat="37.5000" lon="127.0010"/>
  <node id="3" version="1" lat="37.5010" lon="127.0010"/>
  <node id="4" version="1" lat="37.5010" lon="127.0000"/>
  <node id="5" version="1" lat="37.5020" lon="127.0000"/>
  <node id="6" version="1" lat="37.5020" lon="127.0010"/>
  <node id="7" version="1" lat="37.5030" lon="127.0010"/>
  <node id="8" version="1" lat="37.5030" lon="127.0000"/>
  <node id="9" version="1" lat="37.5040" lon="127.0000"/>
  <node id="10" version="1" lat="37.5040" lon="127.0010"/>
  <node id="11" version="1" lat="37.5050" lon="127.0010"/>
  <node id="12" version="1" lat="37.5050" lon="127.0000"/>
  <node id="20" version="1" lat="37.5100" lon="127.0100"/>
  <node id="21" version="1" lat="37.5100" lon="127.0140"/>
  <node id="22" version="1" lat="37.5140" lon="127.0140"/>
  <node id="23" version="1" lat="37.5140" lon="127.0100"/>
  <node id="24" version="1" lat="37.5110" lon="127.0110"/>
  <node id="25" version="1" lat="37.5110" lon="127.0130"/>
  <node id="26" version="1" lat="37.5130" lon="127.0130"/>
  <node id="27" version="1" lat="37.5130" lon="127.0110"/>
  <node id="30" version="1" lat="37.5200" lon="127.0000"/>
  <node id="31" version="1" lat="37.5200" lon="127.0100"/>
  <node id="40" version="1" lat="37.5300" lon="127.0000"/>
  <node id="41" version="1" lat="37.5300" lon="127.0010"/>
  <node id="42" version="1" lat="37.5310" lon="127.0010"/>
  <node id="43" version="1" lat="37.5310" lon="127.0000"/>
  <way id="10" version="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
    <tag k="building" v="yes"/></way>
  <way id="11" version="1"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="8"/><nd ref="5"/>
    <tag k="building" v="apartments"/><tag k="building:levels" v="15"/></way>
  <way id="12" version="1"><nd ref="9"/><nd ref="10"/><nd ref="11"/><nd ref="12"/><nd ref="9"/>
    <tag k="building" v="office"/><tag k="height" v="45 m"/><tag k="building:levels" v="3"/></way>
  <way id="13" version="1"><nd ref="20"/><nd ref="21"/><nd ref="22"/><nd ref="23"/><nd ref="20"/></way>
  <way id="14" version="1"><nd ref="24"/><nd ref="25"/><nd ref="26"/><nd ref="27"/><nd ref="24"/></way>
  <way id="15" version="1"><nd ref="30"/><nd ref="31"/><tag k="highway" v="primary"/></way>
  <way id="16" version="1"><nd ref="40"/><nd ref="41"/><nd ref="42"/><nd ref="43"/><nd ref="40"/>
    <tag k="landuse" v="grass"/></way>
  <way id="17" version="1"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/>
    <tag k="building" v="no"/></way>
  <relation id="100" version="1">
    <member type="way" ref="13" role="outer"/><member type="way" ref="14" role="inner"/>
    <tag k="type" v="multipolygon"/><tag k="building" v="yes"/><tag k="building:levels" v="2"/>
  </relation>
</osm>
"""


@pytest.fixture
def built(tmp_path):
    src = tmp_path / "in" / "tiny.osm"
    src.parent.mkdir()
    src.write_text(OSM, encoding="utf-8")
    out = tmp_path / "national" / "buildings"
    meta = BB.build(src, out, batch=2, log=lambda *_: None)   # 묶음 2개씩 -> 이어 쓰기까지 검증
    return src, out, meta


def test_build_buildings_layer(built):
    import geopandas as gpd
    from shapely.geometry import Point
    src, out, meta = built
    gdf = gpd.read_file(out / "buildings.gpkg", layer="buildings")
    assert gdf.crs.to_epsg() == 4326
    rows = {int(i): (h, g) for i, h, g in zip(gdf["osm_id"], gdf["height_m"], gdf.geometry)}
    # 건물 way 3개 + multipolygon relation 1개(-id). 도로·잔디·building=no·태그 없는 member way는 없다.
    assert set(rows) == {10, 11, 12, -100}
    assert rows[10][0] == BB.DEFAULT_HEIGHT_M == 9.0
    assert rows[11][0] == pytest.approx(15 * 3.2)
    assert rows[12][0] == 45.0                       # height가 building:levels보다 우선
    assert rows[-100][0] == pytest.approx(2 * 3.2)
    for _, g in rows.values():
        assert g.geom_type == "MultiPolygon" and g.is_valid and not g.is_empty
    rel = rows[-100][1]
    assert len(rel.geoms) == 1 and len(rel.geoms[0].interiors) == 1   # 구멍 있는 면
    assert rel.contains(Point(127.0105, 37.5105)) and not rel.contains(Point(127.012, 37.512))
    # metadata
    on_disk = json.loads((out / "metadata.json").read_text(encoding="utf-8"))
    assert on_disk == meta
    assert meta["format"] == 1 and meta["source"] == "tiny.osm" and meta["count"] == 4
    assert meta["osm_data_timestamp"] is None        # XML에는 replication header가 없다
    assert len(meta["pbf_md5"]) == 32 and len(meta["pbf_sha256"]) == 64 and meta["built_at"].endswith("Z")
    # 임시 파일이 남지 않는다
    assert sorted(p.name for p in out.iterdir()) == ["buildings.gpkg", "metadata.json"]


def test_build_buildings_spatial_index_and_bbox_read(built):
    import geopandas as gpd
    _, out, _ = built
    with sqlite3.connect(out / "buildings.gpkg") as con:
        ext = con.execute("SELECT table_name, extension_name FROM gpkg_extensions").fetchall()
        cols = {r[1]: r[2] for r in con.execute("PRAGMA table_info(buildings)")}
        assert con.execute("SELECT count(*) FROM rtree_buildings_geom").fetchone()[0] == 4
    assert ("buildings", "gpkg_rtree_index") in ext
    assert cols["osm_id"].upper() in ("INTEGER", "BIGINT") and cols["height_m"].upper() in ("REAL", "DOUBLE")
    part = gpd.read_file(out / "buildings.gpkg", layer="buildings", bbox=(127.009, 37.509, 127.015, 37.515))
    assert list(part["osm_id"]) == [-100]


def test_build_buildings_replaces_previous_output(built, tmp_path):
    src, out, _ = built
    meta = BB.build(src, out, log=lambda *_: None)
    assert meta["count"] == 4
    assert sorted(p.name for p in out.iterdir()) == ["buildings.gpkg", "metadata.json"]


def test_build_buildings_cli(tmp_path):
    src = tmp_path / "a.osm"
    src.write_text(OSM, encoding="utf-8")
    BB.main(["--pbf", str(src), "--out", str(tmp_path / "b")])
    assert json.loads((tmp_path / "b/metadata.json").read_text(encoding="utf-8"))["count"] == 4


@pytest.mark.parametrize("tags, expected", [
    ({}, 9.0),
    ({"height": "45 m"}, 45.0),
    ({"height": "45m"}, 45.0),
    ({"height": "12,5"}, 12.5),
    ({"height": "100 ft"}, 30.48),
    ({"height": "tall", "building:levels": "4"}, 12.8),
    ({"building:levels": "3;5"}, 9.6),
    ({"building:levels": "0"}, 2.0),          # 하한
    ({"height": "999"}, 300.0),               # 상한
    ({"building:levels": "x"}, 9.0),
])
def test_height_of(tags, expected):
    assert BB.height_of(tags) == pytest.approx(expected)


def test_clean_polygonal_repairs_bowtie():
    from shapely.geometry import Polygon
    bowtie = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])
    assert not bowtie.is_valid
    fixed = BB.clean_polygonal(bowtie)
    assert fixed.geom_type == "MultiPolygon" and fixed.is_valid and fixed.area == pytest.approx(0.5)
    assert BB.clean_polygonal(Polygon()) is None

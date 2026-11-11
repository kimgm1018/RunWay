"""전국 PBF에서 건물 면 layer(buildings.gpkg)를 만든다. S15P31E105-612(저장 코스 평면 썸네일의 건물).

    python -m tools.data.national.build_buildings --pbf C:\\data\\south-korea.osm.pbf --out C:\\data\\national-bundle\\buildings

서비스 폴더(`ai/route_service`)에서 실행한다. 출력 폴더(`--out`)는 서비스의 `{ROUTE_NATIONAL_DIR}/buildings`다.

출력
- `buildings.gpkg` layer `buildings`: EPSG:4326 MultiPolygon, 열 `osm_id` INTEGER(way면 way id, multipolygon relation이면
  -relation id), `height_m` REAL(항상 값이 있다). GPKG 공간 색인(SPATIAL_INDEX=YES)을 만든다.
- `metadata.json`: format, 원본 파일 이름, PBF md5·sha256, PBF header의 osmosis_replication_timestamp(없으면 null),
  건물 수, 만든 시각.
두 파일 모두 임시 이름에 쓴 뒤 os.replace로 바꾼다(gpkg 먼저, 그다음 metadata). 서비스는 gpkg가 있으면 건물을 쓴다.

건물: `building=*`(값이 `no`면 제외) 태그가 있는 닫힌 way와 type=multipolygon relation을 pyosmium 영역 조립으로 면으로 만든다.
높이: `height`(m, 단위 글자 제거, ft는 0.3048 곱) -> `building:levels` x 3.2 -> 9.0. 2~300 m로 자른다.
고장 난 도형은 make_valid(실패하면 buffer(0))로 고치고 면 부분만 남기며 빈 도형은 버린다.

메모리: node 위치 색인 기본값은 `sparse_mem_array`(node 하나 16 byte, 정렬된 배열). 대한민국 PBF(약 291 MB, node 수천만 개)는
약 1 GB 이하다. dense 계열은 전 세계 node id 범위만큼 잡으므로 쓰지 않는다. 메모리가 모자라면
`--index sparse_file_array,<파일 경로>`로 디스크에 둔다. 건물은 BATCH개씩 gpkg에 이어 써서 Python 쪽 메모리는 묶음 크기로 묶인다.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

CODE = Path(__file__).resolve().parents[3]
if str(CODE) not in sys.path:
    sys.path.insert(0, str(CODE))

FORMAT = 1
LAYER = "buildings"
LEVEL_M = 3.2
DEFAULT_HEIGHT_M = 9.0
MIN_HEIGHT_M, MAX_HEIGHT_M = 2.0, 300.0
BATCH = 20000
DEFAULT_INDEX = "sparse_mem_array"

_NUMBER = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*(m|meters?|metres?|ft|feet|')?\s*$", re.IGNORECASE)
_FIRST_NUMBER = re.compile(r"^\s*(\d+(?:[.,]\d+)?)")


def _num(text):
    return float(text.replace(",", "."))


def height_of(tags):
    """건물 높이(m). tags는 dict 같은 객체(get 지원)."""
    h = None
    raw = tags.get("height")
    if raw:
        m = _NUMBER.match(str(raw))
        if m:
            h = _num(m.group(1)) * (0.3048 if (m.group(2) or "").lower() in ("ft", "feet", "'") else 1.0)
    if h is None:
        raw = tags.get("building:levels")
        m = _FIRST_NUMBER.match(str(raw)) if raw else None
        if m:
            h = _num(m.group(1)) * LEVEL_M
    if h is None or h != h:
        h = DEFAULT_HEIGHT_M
    return min(MAX_HEIGHT_M, max(MIN_HEIGHT_M, h))


def clean_polygonal(geom):
    """면 부분만 남긴 유효한 MultiPolygon. 남는 면이 없으면 None."""
    import shapely
    from shapely.geometry import MultiPolygon
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        try:
            geom = shapely.make_valid(geom)
        except Exception:
            geom = None
        if geom is None or geom.is_empty or not geom.is_valid:
            try:
                geom = shapely.buffer(geom if geom is not None else shapely.Polygon(), 0)
            except Exception:
                return None
    polys = []
    stack = [geom]
    while stack:
        g = stack.pop()
        if g.geom_type == "Polygon":
            if not g.is_empty and g.area > 0:
                polys.append(g)
        elif g.geom_type in ("MultiPolygon", "GeometryCollection"):
            stack.extend(reversed(list(g.geoms)))
    return MultiPolygon(polys) if polys else None


def _hashes(path):
    md5, sha = hashlib.md5(), hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 << 20), b""):
            md5.update(chunk)
            sha.update(chunk)
    return md5.hexdigest(), sha.hexdigest()


def _header_timestamp(pbf):
    import osmium
    with osmium.io.Reader(str(pbf), osmium.osm.osm_entity_bits.NOTHING) as reader:
        value = reader.header().get("osmosis_replication_timestamp")
    return value or None


def iter_buildings(pbf, index=DEFAULT_INDEX):
    """(osm_id, height_m, MultiPolygon WGS84)를 PBF 순서대로 낸다."""
    import osmium
    import shapely
    fab = osmium.geom.WKBFactory()
    fp = (osmium.FileProcessor(str(pbf))
          .with_locations(index)
          .with_areas(osmium.filter.KeyFilter("building"))     # 1차(relation 후보)는 building 태그만
          .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
          .with_filter(osmium.filter.KeyFilter("building")))   # 조립된 면 중 building 태그만 Python으로
    for area in fp:
        tags = area.tags
        if tags.get("building", "no") == "no":
            continue
        try:
            geom = shapely.from_wkb(fab.create_multipolygon(area))
        except Exception:   # 조립은 됐지만 도형을 만들 수 없는 면(위치 누락 등)
            continue
        geom = clean_polygonal(geom)
        if geom is None:
            continue
        osm_id = area.orig_id() if area.from_way() else -area.orig_id()
        yield osm_id, round(height_of(tags), 2), geom


def _write_batch(path, ids, heights, geoms, first):
    import geopandas as gpd
    import numpy as np
    gdf = gpd.GeoDataFrame({"osm_id": np.asarray(ids, np.int64), "height_m": np.asarray(heights, np.float64)},
                           geometry=geoms, crs="EPSG:4326")
    kw = {"layer_options": {"SPATIAL_INDEX": "YES"}} if first else {"append": True}
    gdf.to_file(path, layer=LAYER, driver="GPKG", engine="pyogrio", index=False,
                geometry_type="MultiPolygon", promote_to_multi=True, **kw)


def build(pbf, out, index=DEFAULT_INDEX, batch=BATCH, log=print):
    pbf, out = Path(pbf).resolve(), Path(out).resolve()
    if not pbf.is_file():
        raise FileNotFoundError(f"PBF가 없습니다: {pbf}")
    out.mkdir(parents=True, exist_ok=True)
    tmp_gpkg = out / f".buildings-{os.getpid()}.tmp.gpkg"
    tmp_meta = out / f".metadata-{os.getpid()}.tmp.json"
    for p in (tmp_gpkg, tmp_meta):
        if p.exists():
            p.unlink()
    t0 = time.perf_counter()
    count, first = 0, True
    ids, heights, geoms = [], [], []
    try:
        for osm_id, h, g in iter_buildings(pbf, index):
            ids.append(osm_id)
            heights.append(h)
            geoms.append(g)
            if len(ids) >= batch:
                _write_batch(tmp_gpkg, ids, heights, geoms, first)
                count += len(ids)
                first = False
                ids, heights, geoms = [], [], []
                log(f"buildings {count:,} ({time.perf_counter() - t0:.0f}s)")
        if ids or first:   # 건물이 0개여도 빈 layer를 만든다
            _write_batch(tmp_gpkg, ids, heights, geoms, first)
            count += len(ids)
        md5, sha = _hashes(pbf)
        meta = {"format": FORMAT, "source": pbf.name, "pbf_md5": md5, "pbf_sha256": sha,
                "osm_data_timestamp": _header_timestamp(pbf), "count": count,
                "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "location_index": index.split(",", 1)[0]}
        tmp_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
        os.replace(tmp_gpkg, out / "buildings.gpkg")
        os.replace(tmp_meta, out / "metadata.json")
    finally:
        for p in (tmp_gpkg, tmp_meta):
            if p.exists():
                p.unlink()
    log(f"done: {count:,} buildings in {time.perf_counter() - t0:.0f}s -> {out}")
    return meta


def main(argv=None):
    ap = argparse.ArgumentParser(description="전국 PBF -> buildings.gpkg(+metadata.json)")
    ap.add_argument("--pbf", required=True, type=Path, help="입력 .osm.pbf(.osm XML도 가능)")
    ap.add_argument("--out", required=True, type=Path, help="출력 폴더(서비스의 {ROUTE_NATIONAL_DIR}/buildings)")
    ap.add_argument("--index", default=DEFAULT_INDEX,
                    help="node 위치 색인(pyosmium map type). 기본 sparse_mem_array, 디스크: sparse_file_array,<path>")
    ap.add_argument("--batch", type=int, default=BATCH, help="gpkg에 이어 쓰는 묶음 크기")
    args = ap.parse_args(argv)
    if args.batch < 1:
        ap.error("--batch must be >= 1")
    build(args.pbf, args.out, args.index, args.batch)


if __name__ == "__main__":
    main()

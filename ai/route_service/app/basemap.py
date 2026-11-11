"""저장 코스 썸네일용 지도 바탕(basemap) 자료. S15P31E105-612.

POST /internal/v1/basemaps 가 쓴다. 요청 bbox(WGS84) 안의 바다·도로·강·물·해안·해변·공원·녹지만 골라 GeoJSON 조각으로
돌려준다.
- 도로: 전국 저장소 network(mmap)의 highway way 중 ROAD_CLASSES(motorway ~ living_street, *_link·service·footway 등 제외).
  bbox를 덮는 1 km grid 칸(+여유 칸)의 node에서 way를 찾는다. 같은 등급의 잘린 way는 끝점이 이어지면 한 선으로 합친다.
  도로 feature는 road_class(highway 값)를 함께 보낸다.
- 강·물·해안·해변·공원·녹지: 저장소 envcache/layers.gpkg의 env layer(env_class)를 bbox로 읽는다.
- 바다(sea): 해안선(coast 선, OSM 규칙상 진행 방향 왼쪽이 육지·오른쪽이 바다)으로 bbox 면을 나누고, 해안선 양쪽으로 조금 띄운
  점의 투표로 바다 쪽 조각을 고른다. 해안선이 bbox를 나누지 못하면 바다 면은 없다.
- 모든 도형은 bbox로 자르고 EPSG:5179(m)에서 단순화한 뒤 [lon, lat] 소수 5자리로 반올림한다.
- 종류별 상한 뒤 전체 99개 상한(OSMF attribution guideline "fewer than 100 features").
- 응답 크기 상한: 작은 면과 같은 기준(bbox 면적의 0.1 % 미만)의 면 구멍은 버리고, 전체 좌표 수가 MAX_TOTAL_COORDS를
  넘으면 순위가 낮은 feature부터 뺀다(백엔드 응답 본문 상한 256 KB 안에 들게 한다).

detail="full"(백엔드 서버 렌더 평면 PNG 썸네일용)은 _build_full을 쓴다: 위 종류 + 보행로까지 넓힌 도로 + 건물(building,
height_m). 99개 상한 없이 MAX_FULL_FEATURES·MAX_FULL_COORDS·MAX_FULL_BYTES 안에서 작은 건물 -> 보행로 -> 작은 녹지 순서로 뺀다.
축척(meters_per_pixel, 없으면 bbox 가로 / FULL_DEFAULT_IMAGE_PX)에 맞춰 그림에서 보이지 않는 것은 처음부터 뺀다(LOD):
면적 (MIN_BUILDING_PX px)² 미만 건물, mpp > PATH_MAX_MPP면 보행로 등급, mpp > LOCAL_ROAD_MAX_MPP면 이면도로 등급.
단순화 허용 오차는 max(bbox 긴 변 / FULL_SIMPLIFY_DIVISOR, SIMPLIFY_MPP_FACTOR x mpp).
건물은 {national_dir}/buildings/buildings.gpkg(tools/data/national/build_buildings.py가 만든다)를 bbox로 읽는다. 메모리를
줄이려고 투영·단순화 전에 경위도 근사 면적으로 작은 건물을 빼고 남은 feature 예산만큼 큰 건물만 남긴다. 파일이 없거나
읽을 수 없으면(고장·잘림·layer 다름) 건물 없이 buildings_available=false로 답한다(읽기 실패는 경고 로그, 좌표 없음).
full 요청의 동시 실행 제한(한 번에 1건)은 main.py가 한다.

읽기 전용: 엔진 pipeline.lock을 잡지 않고 공유 엔진 상태를 바꾸지 않는다(mmap 배열·gpkg 파일만 읽는다).
pyproj Transformer는 thread마다 따로 만든다(엔진이 쓰는 store.to_k/to_ll을 함께 쓰지 않는다).
"""
import json
import logging
import math
import threading
from pathlib import Path

import numpy as np

from .ai_logging import log_ai_error

# 응답 그리기 순서(배경 먼저). 응답 features도 이 순서로 정렬한다.
DRAW_ORDER = ("sea", "green", "park", "beach", "water", "river", "coast", "road")
# 종류별 상한. 한 종류가 모자라도 다른 종류로 채우지 않는다(결정적이고 설명하기 쉬움). 합계(103)가 전체 상한 99를 넘으면
# 그리는 순서 마지막인 도로가 덜 담긴다.
KIND_CAPS = {"sea": 4, "road": 58, "park": 12, "green": 10, "water": 6, "river": 6, "coast": 4, "beach": 3}
MAX_FEATURES = 99
# 도로 등급(앞이 더 중요). *_link, service, footway, path, cycleway, steps, track, pedestrian 등은 넣지 않는다.
ROAD_CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street")
SEA_OFFSET_RATIO = 1e-4      # 바다 쪽 투표 점을 해안선에서 띄우는 거리 = bbox 긴 변 x 1e-4 (8 km면 0.8 m)
ENV_KINDS = ("river", "water", "coast", "beach", "park", "green")
MAX_SIDE_M = 8000.0          # bbox 한 변 상한(m)
MAX_SPAN_DEG = 1.0           # bbox 경도·위도 폭 상한(도). 날짜변경선을 감싸는 입력에서 haversine 가로가 작아지는 것을 막는다
SIMPLIFY_DIVISOR = 200.0     # 단순화 허용 오차 = bbox 긴 변 / 200 (8 km면 40 m)
MIN_AREA_RATIO = 0.001       # 잘린 면적이 bbox 면적의 0.1 % 미만인 면은 버린다
MIN_LINE_RATIO = 0.01        # 잘린 길이가 bbox 긴 변의 1 % 미만인 선은 버린다
COORD_DIGITS = 5
# 응답 전체 좌표 상한([lon, lat] 쌍 수, 면은 닫는 점 포함). 소수 5자리 좌표 한 쌍은 JSON에서 약 22 byte라
# 6,000쌍이면 약 132 KB로 백엔드 응답 본문 상한(256 KB) 안에 여유 있게 든다.
MAX_TOTAL_COORDS = 6000
GRID_PAD_CELLS = 2           # bbox 밖 node 사이를 지나는 긴 구간을 놓치지 않도록 grid 칸을 2칸(2 km) 더 본다
EARTH_R_M = 6371008.8

# ---- detail="full" (S15P31E105-612 평면 PNG 썸네일). 응답 feature 순서(배경 먼저, 건물 마지막. 건물 정렬은 백엔드 렌더러가 한다)
FULL_DRAW_ORDER = ("sea", "green", "park", "beach", "water", "river", "coast", "road", "building")
# full 도로 등급(앞이 더 중요). service·steps·track 등은 넣지 않는다.
FULL_ROAD_CLASSES = ROAD_CLASSES + ("pedestrian", "footway", "path", "cycleway")
# *_link는 상위 등급으로 보낸다(road_class도 상위 값). 같은 등급이라 본선과 끝점이 이어지면 한 선으로 합쳐진다.
LINK_PARENT = {"motorway_link": "motorway", "trunk_link": "trunk", "primary_link": "primary",
               "secondary_link": "secondary", "tertiary_link": "tertiary"}
MINOR_PATH_CLASSES = ("footway", "path", "cycleway")   # 상한을 넘으면 건물 다음으로 빼는 길
FULL_SIMPLIFY_DIVISOR = 600.0    # 단순화 허용 오차 = bbox 긴 변 / 600 (4 km면 약 6.7 m)
FULL_MIN_AREA_RATIO = 1e-5       # 건물 외 면: 잘린 면적이 bbox 면적의 0.001 % 미만이면 버린다(4 km x 4 km면 160 m²)
FULL_MIN_LINE_RATIO = 0.002      # 선: 잘린 길이가 bbox 긴 변의 0.2 % 미만이면 버린다(4 km면 8 m)
MIN_BUILDING_AREA_M2 = 15.0      # 건물: 잘린 면적 15 m² 미만은 버린다(구멍도 같은 기준). 축척 기준과 큰 쪽을 쓴다
# ---- full 축척 단계(LOD). mpp = meters_per_pixel(그림 1 px가 덮는 땅 m). 그림에서 보이지 않는 것은 처음부터 보내지 않는다
MAX_METERS_PER_PIXEL = 100.0     # 요청 meters_per_pixel 상한(초과는 400)
FULL_DEFAULT_IMAGE_PX = 600.0    # meters_per_pixel이 없으면 bbox 가로(m) / 600
MIN_BUILDING_PX = 1.5            # 건물: 면적 (1.5 px)² = (1.5 x mpp)² m² 미만은 버린다
PATH_MAX_MPP = 5.0               # mpp > 5면 보행로 등급(PATH_LOD_CLASSES)을 보내지 않는다
LOCAL_ROAD_MAX_MPP = 8.0         # mpp > 8이면 이면도로 등급(LOCAL_ROAD_LOD_CLASSES)도 보내지 않는다
PATH_LOD_CLASSES = ("footway", "path", "cycleway", "pedestrian")
LOCAL_ROAD_LOD_CLASSES = ("living_street", "residential", "unclassified")
SIMPLIFY_MPP_FACTOR = 0.5        # 단순화 허용 오차 하한 = 0.5 x mpp(반 px)
# 건물 사전 선별(투영 전 경위도 근사 면적). 근사 오차로 경계 근처 건물을 잘못 빼지 않게 기준의 90 %로 거르고,
# 정확한 기준(투영 m² 잘린 면적)은 뒤에서 다시 적용한다.
PRESELECT_AREA_SLACK = 0.9
M_PER_DEG = EARTH_R_M * math.pi / 180.0
BASEMAPS_ENDPOINT = "/internal/v1/basemaps"   # 로그 endpoint 이름(main.BASEMAPS와 같은 값)
MAX_FULL_FEATURES = 40000
MAX_FULL_COORDS = 300000
# 응답 본문 상한(compact JSON byte). 백엔드 읽기 상한 8 MB보다 여유 있게 잡는다.
MAX_FULL_BYTES = 7_500_000
FULL_ENVELOPE_BYTES = 1024       # features 밖 응답 필드(시각 문자열 등) 몫
BUILDINGS_LAYER = "buildings"
HEIGHT_DIGITS = 1

_local = threading.local()
_meta_lock = threading.Lock()
_meta_cache = {}             # metadata.json 경로 -> ((mtime_ns, size), dict 또는 None)
_strings_lock = threading.Lock()
_strings_cache = {}          # id(strings) -> (strings, highway key id, {value id: 등급 순위})


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * EARTH_R_M * math.asin(min(1.0, math.sqrt(a)))


def side_lengths_m(bbox):
    """bbox (가로 m, 세로 m). 가로는 남·북 변 중 긴 쪽."""
    w, s, e, n = bbox
    width = max(haversine_m(s, w, s, e), haversine_m(n, w, n, e))
    return width, haversine_m(s, w, n, w)


def _transformers():
    t = getattr(_local, "tr", None)
    if t is None:
        from pyproj import Transformer
        t = _local.tr = (Transformer.from_crs(4326, 5179, always_xy=True),
                         Transformer.from_crs(5179, 4326, always_xy=True))
    return t


def _project(geom, tr):
    import shapely
    return shapely.transform(geom, lambda c: np.column_stack(tr.transform(c[:, 0], c[:, 1])))


def _road_ids(strings, classes=ROAD_CLASSES, aliases=None):
    """strings.json에서 highway key와 도로 값의 id -> 등급 순위. 전국 문자열 목록은 크므로 store·등급 목록별로 한 번만 찾는다.
    aliases = {다른 highway 값: classes 안의 등급}(예: primary_link -> primary)."""
    aliases = aliases or {}
    key = (id(strings), classes, tuple(sorted(aliases.items())))
    with _strings_lock:
        hit = _strings_cache.get(key)
        if hit is not None and hit[0] is strings:
            return hit[1], hit[2]
    wanted = {"highway", *classes, *aliases}
    found = {}
    for i, s in enumerate(strings):
        if s in wanted and s not in found:
            found[s] = i
    hk = found.get("highway", -1)
    values = {found[c]: rank for rank, c in enumerate(classes) if c in found}
    values.update({found[a]: classes.index(p) for a, p in aliases.items() if a in found and p in classes})
    with _strings_lock:
        if len(_strings_cache) >= 8:
            _strings_cache.clear()
        _strings_cache[key] = (strings, hk, values)
    return hk, values


def _parts(geom):
    """Multi*/GeometryCollection을 단일 LineString·Polygon 조각으로 편다. 점·빈 도형은 버린다."""
    if geom is None or geom.is_empty:
        return []
    t = geom.geom_type
    if t in ("LineString", "Polygon"):
        return [geom]
    if t == "LinearRing":
        from shapely.geometry import LineString
        return [LineString(geom.coords)]
    if t in ("MultiLineString", "MultiPolygon", "GeometryCollection"):
        return [p for g in geom.geoms for p in _parts(g)]
    return []


def _road_candidates(store, bbox, to_k, classes=ROAD_CLASSES, aliases=None):
    """(kind, 등급 순위(classes 안 위치), 잘린 선(WGS84)) 목록. bbox를 덮는 grid 칸의 node에 걸친 도로 way만 본다."""
    import shapely
    from runway_routing.national.store import gather_ranges
    hk, values = _road_ids(store.strings, classes, aliases)
    if hk < 0 or not values:
        return []
    w, s, e, n = bbox
    # bbox 경계를 촘촘히 투영해 5179 사각 범위를 구한다(투영 후 변이 살짝 휜다).
    t = np.linspace(0, 1, 9)
    lon = np.r_[w + (e - w) * t, np.full(9, e), w + (e - w) * t, np.full(9, w)]
    lat = np.r_[np.full(9, s), s + (n - s) * t, np.full(9, n), s + (n - s) * t]
    x, y = to_k.transform(lon, lat)
    ix0 = max(0, int(np.floor((min(x) - 700000) / 1000)) - GRID_PAD_CELLS)
    ix1 = min(800, int(np.floor((max(x) - 700000) / 1000)) + 1 + GRID_PAD_CELLS)
    iy0 = max(0, int(np.floor((min(y) - 1300000) / 1000)) - GRID_PAD_CELLS)
    iy1 = min(900, int(np.floor((max(y) - 1300000) / 1000)) + 1 + GRID_PAD_CELLS)
    if ix1 <= ix0 or iy1 <= iy0:
        return []
    xs, ys = np.meshgrid(np.arange(ix0, ix1), np.arange(iy0, iy1))
    cells = np.sort((ys * 800 + xs).ravel())
    grid, net = store.grid, store.net
    ids = grid["cell_ids"]
    p = np.searchsorted(ids, cells)
    p = p[p < len(ids)]
    p = p[np.isin(ids[p], cells)]
    if not len(p):
        return []
    cp = grid["cell_offsets"]
    nodes = np.asarray(grid["cell_node_idx"][gather_ranges(cp[p], cp[p + 1])], np.int64)
    nptr = net["node_way_ptr"]
    ways = np.unique(np.asarray(net["node_way_idx"][gather_ranges(nptr[nodes], nptr[nodes + 1])], np.int64))
    if not len(ways):
        return []
    # highway 값으로 큰길 way만 남긴다(벡터 처리).
    tp = net["tag_ptr"]
    tlen = np.asarray(tp[ways + 1] - tp[ways], np.int64)
    tags = gather_ranges(tp[ways], tp[ways + 1])
    owner = np.repeat(np.arange(len(ways)), tlen)
    tk, tv = np.asarray(net["tag_k"][tags]), np.asarray(net["tag_v"][tags])
    vid = np.fromiter(values.keys(), np.int64, len(values))
    hit = (tk == hk) & np.isin(tv, vid)
    rank_of = np.full(len(ways), -1, np.int64)
    if hit.any():
        lut = dict(values)
        rank_of[owner[hit]] = [lut[int(v)] for v in tv[hit]]
    keep = rank_of >= 0
    ways, rank_of = ways[keep], rank_of[keep]
    if not len(ways):
        return []
    rp = net["ref_ptr"]
    rlen = np.asarray(rp[ways + 1] - rp[ways], np.int64)
    ok = rlen >= 2
    ways, rank_of, rlen = ways[ok], rank_of[ok], rlen[ok]
    if not len(ways):
        return []
    refs = gather_ranges(rp[ways], rp[ways + 1])
    coords = np.asarray(net["lonlat"][np.asarray(net["ref_pos"][refs], np.int64)], np.float64)
    lines = shapely.linestrings(coords, indices=np.repeat(np.arange(len(ways)), rlen))
    clipped = shapely.clip_by_rect(lines, w, s, e, n)
    present = ~(shapely.is_missing(clipped) | shapely.is_empty(clipped))
    out = []
    for rank in np.unique(rank_of[present]):
        sel = clipped[present & (rank_of == rank)]   # 입력 순서 유지
        pieces = [pt for g in sel for pt in _parts(g) if pt.geom_type == "LineString"]
        if not pieces:
            continue
        # 같은 등급에서 끝점이 이어지는 way를 한 선으로 합친다(OSM은 한 도로를 여러 way로 나눈다).
        merged = shapely.line_merge(shapely.multilinestrings(pieces))
        out.extend(("road", int(rank), g) for g in _parts(merged) if g.geom_type == "LineString")
    return out


def _env_candidates(store, bbox):
    """([(kind, 잘린 도형(WGS84))], [자르지 않은 해안선 LineString(WGS84)]). env layer를 bbox로 읽는다.
    해안선은 바다 면을 만들 때 방향(왼쪽 육지·오른쪽 바다)이 필요해 자르기 전 도형도 함께 돌려준다."""
    import geopandas as gpd
    import shapely
    path = store.path / "envcache/layers.gpkg"
    if not path.is_file():
        return [], []
    w, s, e, n = bbox
    layers = gpd.read_file(path, layer="env", bbox=(w, s, e, n), columns=["env_class"])
    if not len(layers):
        return [], []
    if layers.crs is not None and layers.crs.to_epsg() != 4326:
        layers = layers.to_crs(4326)
    layers = layers[layers["env_class"].isin(ENV_KINDS)]
    kinds, geoms = layers["env_class"].to_numpy(), layers.geometry.to_numpy()
    clipped = shapely.clip_by_rect(geoms, w, s, e, n)
    coast = [g for kind, geom in zip(kinds, geoms) if kind == "coast"
             for g in _parts(geom) if g.geom_type == "LineString"]
    return [(kind, g) for kind, geom in zip(kinds, clipped) for g in _parts(geom)], coast


def _sea_polygons(coast_k, box_k, eps):
    """해안선(투영 m, OSM 방향 그대로)으로 투영 bbox 면 box_k를 나눈 조각 중 바다 쪽 조각 목록.
    선을 합쳐(linemerge) bbox를 조각내고, 해안선의 각 구간(bbox 안 부분) 가운데에서 오른쪽(바다)·왼쪽(육지)으로 eps만큼
    띄운 점이 든 조각에 그 구간 길이만큼 +/- 표를 준다. 합이 양수인 조각이 바다다. 투표는 원래 구간 방향을 쓰므로
    linemerge·자르기가 선 방향을 뒤집어도 영향이 없다. 해안선이 bbox를 나누지 못하면(조각 1개) 빈 목록."""
    import shapely
    from shapely.errors import GEOSException
    from shapely.ops import split
    if not coast_k:
        return []
    # 자를 선: bbox보다 조금 넓게 잘라 bbox 경계와 확실히 교차하게 한다(split은 경계와 선의 합집합을 다각형화한다).
    reach = box_k.buffer(eps * 1000)
    cut = [p for p in _parts(shapely.intersection(shapely.line_merge(shapely.union_all(coast_k)), reach))
           if p.geom_type == "LineString"]
    if not cut:
        return []
    try:
        pieces = [p for p in _parts(split(box_k, shapely.multilinestrings(cut))) if p.geom_type == "Polygon"]
    except (ValueError, GEOSException):
        return []
    if len(pieces) < 2:
        return []
    # 해안선 구간(2점 선)들. bbox 범위와 겹치는 구간만 bbox로 자른다.
    seg = np.concatenate([np.stack([c[:-1], c[1:]], axis=1)
                          for c in (np.asarray(g.coords, np.float64)[:, :2] for g in coast_k) if len(c) >= 2])
    x0, y0, x1, y1 = box_k.bounds
    near = ((np.maximum(seg[:, 0, 0], seg[:, 1, 0]) >= x0) & (np.minimum(seg[:, 0, 0], seg[:, 1, 0]) <= x1)
            & (np.maximum(seg[:, 0, 1], seg[:, 1, 1]) >= y0) & (np.minimum(seg[:, 0, 1], seg[:, 1, 1]) <= y1))
    seg = seg[near]
    if not len(seg):
        return []
    d = seg[:, 1] - seg[:, 0]
    norm = np.hypot(d[:, 0], d[:, 1])
    ok = norm > 0
    seg, d, norm = seg[ok], d[ok], norm[ok]
    inside = shapely.intersection(shapely.linestrings(seg), box_k)
    rx, ry, lx, ly, wt = [], [], [], [], []
    for i, g in enumerate(inside):
        ux, uy = d[i, 0] / norm[i], d[i, 1] / norm[i]
        for part in _parts(g):
            if part.geom_type != "LineString" or part.length <= 0:
                continue
            m = part.interpolate(0.5, normalized=True)
            rx.append(m.x + uy * eps); ry.append(m.y - ux * eps)   # 진행 방향 오른쪽 = 바다
            lx.append(m.x - uy * eps); ly.append(m.y + ux * eps)   # 왼쪽 = 육지
            wt.append(part.length)
    if not wt:
        return []
    rx, ry, lx, ly, wt = map(np.asarray, (rx, ry, lx, ly, wt))
    out = []
    for pc in pieces:
        vote = (wt * shapely.contains_xy(pc, rx, ry)).sum() - (wt * shapely.contains_xy(pc, lx, ly)).sum()
        if vote > 0:
            out.append(pc)
    return out


def _round_ring(coords):
    pts = []
    for x, y in coords:
        p = [round(float(x), COORD_DIGITS), round(float(y), COORD_DIGITS)]
        if not pts or pts[-1] != p:
            pts.append(p)
    return pts


def _to_geojson(geom):
    """반올림한 GeoJSON. 퇴화(선 2점 미만, 면 ring 4점 미만)면 None."""
    if geom.geom_type == "LineString":
        pts = _round_ring(geom.coords)
        return {"type": "LineString", "coordinates": pts} if len(pts) >= 2 else None
    rings = []
    for i, ring in enumerate([geom.exterior, *geom.interiors]):
        pts = _round_ring(ring.coords)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts.pop()
        if len(pts) < 3:
            if i == 0:
                return None   # 바깥 ring이 퇴화하면 면 전체를 버린다
            continue          # 구멍만 퇴화하면 그 구멍만 버린다
        rings.append(pts + [pts[0]])
    return {"type": "Polygon", "coordinates": rings}


def _drop_small_holes(geom, min_area):
    """면의 구멍 중 면적(투영 m²)이 min_area 미만인 것을 버린다. 작은 면을 버리는 기준과 같다. 면이 아니면 그대로."""
    if geom.geom_type != "Polygon" or not len(geom.interiors):
        return geom
    from shapely.geometry import Polygon
    holes = [r for r in geom.interiors if Polygon(r).area >= min_area]
    if len(holes) == len(geom.interiors):
        return geom
    return Polygon(geom.exterior, holes)


def _coord_count(geometry):
    """GeoJSON geometry의 [lon, lat] 쌍 수."""
    c = geometry["coordinates"]
    return len(c) if geometry["type"] == "LineString" else sum(len(ring) for ring in c)


def _fit_coord_budget(features, ranks, budget):
    """전체 좌표 수가 budget 이하가 되도록 중요한 feature부터 담고, 남은 예산에 들어가지 않는 feature만 건너뛴다.
    남은 feature의 순서는 그대로다. ranks[i] = 그 종류 안의 순위(0이 가장 중요). 순위 숫자가 작은 것부터, 같으면 응답에서
    앞에 있는 것부터 담는다(종류마다 중요한 것을 고르게 남기고, 각 종류 안의 기존 순위를 지킨다).
    feature 하나가 혼자 예산을 넘어도 그것만 빠지고 다른 feature(큰길 등)는 남는다(S15P31E105-612 재검토 F-1)."""
    counts = [_coord_count(f["geometry"]) for f in features]
    if sum(counts) <= budget:
        return features
    kept, used = set(), 0
    for i in sorted(range(len(features)), key=lambda i: (ranks[i], i)):
        if used + counts[i] <= budget:
            kept.add(i)
            used += counts[i]
    return [f for i, f in enumerate(features) if i in kept]


def build_basemap(store, bbox, detail="thumb", buildings_dir=None, meters_per_pixel=None):
    """store(NationalStore와 같은 속성: grid, net, strings, path, metadata)와 bbox -> 응답 dict.
    detail="thumb"(기본, 99개 썸네일 바탕) 또는 "full"(평면 PNG 썸네일용, buildings_dir의 buildings.gpkg를 함께 읽는다).
    meters_per_pixel은 full에서만 쓴다(None이면 bbox 가로 / FULL_DEFAULT_IMAGE_PX)."""
    if detail == "full":
        return _build_full(store, bbox, buildings_dir, meters_per_pixel)
    if detail != "thumb":
        raise ValueError(f"unknown detail: {detail!r}")
    import shapely
    to_k, to_ll = _transformers()
    w, s, e, n = bbox
    max_side = max(side_lengths_m(bbox))
    tol = max_side / SIMPLIFY_DIVISOR
    box_k = _project(shapely.box(w, s, e, n).segmentize(max((e - w), (n - s)) / 8), to_k)
    min_area = box_k.area * MIN_AREA_RATIO
    min_len = max_side * MIN_LINE_RATIO

    # 후보: (정렬 key, 투영 도형, road_class). 정렬 key가 작을수록 먼저 고른다. 동점은 입력 순서(결정적).
    cand = {k: [] for k in KIND_CAPS}
    for kind, rank, g in _road_candidates(store, bbox, to_k):
        gk = _project(g, to_k)
        if gk.length >= min_len:
            cand[kind].append(((rank, -gk.length), gk, ROAD_CLASSES[rank]))
    env, coast = _env_candidates(store, bbox)
    for kind, g in env:
        gk = _project(g, to_k)
        if g.geom_type == "Polygon":
            if gk.area >= min_area:   # 면은 잘린 면적 순, 같은 종류의 선보다 먼저
                cand[kind].append(((0, -gk.area), _drop_small_holes(gk, min_area), None))
        elif gk.length >= min_len:    # 선은 잘린 길이 순
            cand[kind].append(((1, -gk.length), gk, None))
    for pk in _sea_polygons([_project(g, to_k) for g in coast], box_k, max_side * SEA_OFFSET_RATIO):
        if pk.area >= min_area:       # 바다 면은 면적 순
            cand["sea"].append(((0, -pk.area), _drop_small_holes(pk, min_area), None))

    features, ranks = [], []   # ranks: 종류 안의 순위(좌표 상한에서 뺄 순서)
    for kind in DRAW_ORDER:
        picked = 0
        for _, gk, road_class in sorted(cand[kind], key=lambda c: c[0]):
            if picked >= KIND_CAPS[kind]:
                break
            simple = shapely.simplify(gk, tol, preserve_topology=True)
            # 투영을 되돌리면 bbox 경계에서 아주 작은 오차가 생길 수 있어 다시 자른다.
            back = shapely.clip_by_rect(_project(simple, to_ll), w, s, e, n)
            for part in _parts(back):
                if picked >= KIND_CAPS[kind]:
                    break
                gj = _to_geojson(part)
                if gj is not None:
                    f = {"kind": kind, "geometry": gj}
                    if road_class is not None:
                        f["road_class"] = road_class
                    features.append(f)
                    # 바다는 배경이라 좌표 상한에서 모두 순위 0(각 종류의 1순위와 같고 응답 앞쪽이라 먼저 담긴다)
                    ranks.append(0 if kind == "sea" else picked)
                    picked += 1
    features = _fit_coord_budget(features[:MAX_FEATURES], ranks[:MAX_FEATURES], MAX_TOTAL_COORDS)
    return {"osm_data_timestamp": (getattr(store, "metadata", None) or {}).get("osm_data_timestamp"),
            "features": features}


# ------------------------------------------------------------------ detail="full"
POLYGON_KINDS = ("sea", "green", "park", "beach", "water", "building")


def buildings_metadata(buildings_dir):
    """{buildings_dir}/metadata.json(dict) 또는 None. 파일의 (mtime, 크기)가 같으면 다시 읽지 않는다(요청마다 stat 1번)."""
    if buildings_dir is None:
        return None
    path = Path(buildings_dir) / "metadata.json"
    try:
        st = path.stat()
    except OSError:
        return None
    stamp, key = (st.st_mtime_ns, st.st_size), str(path)
    with _meta_lock:
        hit = _meta_cache.get(key)
        if hit is not None and hit[0] == stamp:
            return hit[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = None
    if not isinstance(data, dict):
        data = None
    with _meta_lock:
        if len(_meta_cache) >= 8:
            _meta_cache.clear()
        _meta_cache[key] = (stamp, data)
    return data


def _single_parts(geoms):
    """도형 배열 -> (단일 LineString·Polygon 배열, 원래 위치). 대부분 get_parts 한 번(벡터)이고 남은 Multi·GC·LinearRing만
    _parts로 편다. 원래 순서를 지킨다."""
    import shapely
    parts, idx = shapely.get_parts(np.asarray(geoms, object), return_index=True)
    tid = shapely.get_type_id(parts)
    simple = (tid == 1) | (tid == 3)
    if simple.all():
        return parts, idx
    out_p, out_i = [], []
    for p, i, ok in zip(parts, idx, simple):
        if ok:
            out_p.append(p); out_i.append(i)
        else:
            for q in _parts(p):
                out_p.append(q); out_i.append(i)
    arr = np.empty(len(out_p), object)
    arr[:] = out_p
    return arr, np.asarray(out_i, np.int64)


def _read_buildings(path, bbox):
    """buildings.gpkg의 bbox에 걸친 행 -> (높이 배열, 도형 배열(WGS84)). GeoDataFrame을 만들지 않고 pyogrio raw(WKB)로
    읽는다(촘촘한 도심 bbox에서 pandas·GeoSeries 사본 메모리를 줄인다). 파일·layer·열이 맞지 않으면 예외."""
    import shapely
    from pyogrio.raw import read
    meta, _, wkb, fields = read(path, layer=BUILDINGS_LAYER, bbox=tuple(bbox), columns=["height_m"])
    if list(meta.get("fields", [])) != ["height_m"] or len(fields) != 1:
        raise ValueError("buildings layer has no height_m column")
    heights = np.asarray(fields[0], np.float64)
    geoms = shapely.from_wkb(wkb)
    del wkb
    crs = meta.get("crs")
    if crs is not None and crs.upper() not in ("EPSG:4326", "OGC:CRS84") and len(geoms):
        from pyproj import CRS, Transformer
        if CRS.from_user_input(crs).to_epsg() != 4326:
            geoms = _project(geoms, Transformer.from_crs(crs, 4326, always_xy=True))
    return heights, np.asarray(geoms, object)


def _building_candidates(buildings_dir, bbox, min_area_m2=MIN_BUILDING_AREA_M2, budget=MAX_FULL_FEATURES):
    """(가능 여부, 높이 배열, 잘린 Polygon 배열(WGS84)). buildings.gpkg가 없거나 읽을 수 없으면(고장·잘림·layer 다름)
    (False, 빈, 빈)이고, 읽기 실패는 경고 로그(예외 클래스 이름만, 좌표·경로 없음)를 남긴다.
    투영·단순화 전에 줄인다: 경위도 근사 면적(도² x M_PER_DEG² x cos(위도))이 min_area_m2 x PRESELECT_AREA_SLACK 미만인
    건물을 빼고, 그래도 budget(남은 feature 예산)보다 많으면 큰 것부터 budget개만 남긴다(입력 순서 유지, 동점은 입력 순서).
    요청마다 gpkg를 열고 닫는다(GPKG 공간 색인으로 bbox에 걸친 행만 읽는다). 열린 파일을 thread 사이에 나누지 않는다."""
    import shapely
    empty = np.empty(0, np.float64), np.empty(0, object)
    if buildings_dir is None:
        return (False, *empty)
    path = Path(buildings_dir) / "buildings.gpkg"
    if not path.is_file():
        return (False, *empty)
    w, s, e, n = bbox
    try:
        heights, geoms = _read_buildings(path, bbox)
    except Exception as exc:   # 고장 난 파일 때문에 지도 바탕 전체를 실패시키지 않는다(ADR-0022 "건물 없이 그림")
        log_ai_error("BUILDINGS_UNAVAILABLE", BASEMAPS_ENDPOINT, exc, level=logging.WARNING)
        return (False, *empty)
    if not len(geoms):
        return (True, *empty)
    bx = shapely.bounds(geoms)
    out = (bx[:, 0] < w) | (bx[:, 1] < s) | (bx[:, 2] > e) | (bx[:, 3] > n)
    del bx
    geoms[out] = shapely.clip_by_rect(geoms[out], w, s, e, n)   # bbox 경계를 넘는 건물만 자른다
    approx = shapely.area(geoms) * (M_PER_DEG * M_PER_DEG * math.cos(math.radians((s + n) / 2)))
    idx = np.nonzero(approx >= min_area_m2 * PRESELECT_AREA_SLACK)[0]
    if len(idx) > budget:
        idx = np.sort(idx[np.argsort(-approx[idx], kind="stable")[:max(0, budget)]])
    geoms, heights = geoms[idx], heights[idx]
    del approx, idx
    parts, pidx = _single_parts(geoms)
    poly = shapely.get_type_id(parts) == 3
    return True, heights[pidx[poly]], parts[poly]


def _num_len(v):
    """소수 5자리로 반올림한 좌표 숫자의 JSON 길이 상한(부호 + 정수 자릿수 + '.' + 5자리). 실제(repr)는 끝의 0이 빠져 같거나 짧다."""
    a = np.abs(v)
    digits = np.where(a < 10, 1, np.floor(np.log10(np.maximum(a, 1))).astype(np.int64) + 1)
    return (v < 0).astype(np.int64) + digits + 1 + COORD_DIGITS


def _geojson_batch(parts):
    """단일 LineString·Polygon 배열 -> [(GeoJSON geometry 또는 None, 좌표 수, 좌표 부분 JSON byte 상한)].
    _to_geojson과 같은 규칙(소수 5자리, 이어진 같은 점 제거, 선 2점 미만·바깥 ring 4점 미만이면 None, 퇴화 구멍만 버림)을
    배열 연산으로 한다(도심 bbox의 수만 개 건물을 하나씩 Python으로 돌지 않는다)."""
    import shapely
    out = [None] * len(parts)
    tid = shapely.get_type_id(parts)
    for want in (1, 3):
        sel = np.nonzero(tid == want)[0]
        if not len(sel):
            continue
        _, coords, offsets = shapely.to_ragged_array(parts[sel])
        if want == 1:
            ring_off, geom_off = offsets[0], np.arange(len(sel) + 1)
        else:
            ring_off, geom_off = offsets
        c = np.round(coords[:, :2], COORD_DIGITS)
        n_ring = len(ring_off) - 1
        ring_of = np.repeat(np.arange(n_ring), np.diff(ring_off))
        keep = np.ones(len(c), bool)
        keep[1:] = ~((ring_of[1:] == ring_of[:-1]) & (c[1:] == c[:-1]).all(axis=1))
        c, ring_of = c[keep], ring_of[keep]
        ring_n = np.bincount(ring_of, minlength=n_ring)
        ring_start = np.r_[0, np.cumsum(ring_n)]
        pair_len = 3 + _num_len(c[:, 0]) + _num_len(c[:, 1])        # "[lon,lat]"
        csum = np.r_[0, np.cumsum(pair_len)]
        ring_bytes = (csum[ring_start[1:]] - csum[ring_start[:-1]]) + np.maximum(ring_n - 1, 0) + 2
        ok_ring = ring_n >= (2 if want == 1 else 4)
        pts = c.tolist()
        rs = ring_start.tolist()
        ring_lists = [pts[rs[r]:rs[r + 1]] for r in range(n_ring)]
        okl = ok_ring.tolist()
        # 도형별 합계(좌표 수, 좌표 byte). 퇴화 ring(구멍)은 뺀다. 면 coordinates의 바깥 [] 2 + ring 사이 쉼표.
        g_n = np.add.reduceat(np.where(ok_ring, ring_n, 0), geom_off[:-1]).tolist() if n_ring else []
        g_rings = np.add.reduceat(ok_ring.astype(np.int64), geom_off[:-1]).tolist() if n_ring else []
        g_b = np.add.reduceat(np.where(ok_ring, ring_bytes, 0), geom_off[:-1]).tolist() if n_ring else []
        go = geom_off.tolist()
        for k, gi in enumerate(sel.tolist()):
            r0, r1 = go[k], go[k + 1]
            if not okl[r0]:
                continue   # 선이 퇴화했거나 바깥 ring이 퇴화하면 도형 전체를 버린다
            if want == 1:
                out[gi] = ({"type": "LineString", "coordinates": ring_lists[r0]}, g_n[k], g_b[k])
                continue
            if g_rings[k] == r1 - r0:
                rings = ring_lists[r0:r1]
            else:   # 구멍만 퇴화하면 그 구멍만 버린다
                rings = [ring_lists[r] for r in range(r0, r1) if okl[r]]
            out[gi] = ({"type": "Polygon", "coordinates": rings}, g_n[k], g_b[k] + g_rings[k] - 1 + 2)
    return out


def _feature_bytes(kind, gtype, road_class, height, coord_bytes):
    """compact JSON(Starlette JSONResponse와 같은 separators) feature 하나의 byte 상한."""
    n = len('{"kind":"","geometry":{"type":"","coordinates":}}') + len(kind) + len(gtype) + coord_bytes
    if road_class is not None:
        n += len(',"road_class":""') + len(road_class)
    if height is not None:
        n += len(',"height_m":') + len(repr(height))
    return n


def _fit_full_limits(recs):
    """recs: [(kind, road_class, 크기(투영 m² 또는 m), feature, 좌표 수, JSON byte 상한)] 응답 순서.
    feature 수·좌표 수·byte 상한을 넘으면 작은 건물 -> footway/path/cycleway(짧은 것부터) -> 작은 green ->
    (그래도 넘으면) 낮은 등급·짧은 도로 -> 작은 면·짧은 선 -> 작은 바다 순서로 하나씩 뺀다. 남은 feature의 순서는 그대로다."""
    n = len(recs)
    c = sum(r[4] for r in recs)
    b = sum(r[5] for r in recs) + max(n - 1, 0) + FULL_ENVELOPE_BYTES

    def fits():
        return n <= MAX_FULL_FEATURES and c <= MAX_FULL_COORDS and b <= MAX_FULL_BYTES

    if fits():
        return [r[3] for r in recs]
    idx = range(len(recs))

    def small_first(i):
        return recs[i][2], -i   # 작은 것부터, 같으면 응답 뒤쪽부터

    def group(pred, key=small_first):
        return sorted((i for i in idx if pred(recs[i])), key=key)

    order = (group(lambda r: r[0] == "building")
             + group(lambda r: r[0] == "road" and r[1] in MINOR_PATH_CLASSES)
             + group(lambda r: r[0] == "green")
             + group(lambda r: r[0] == "road" and r[1] not in MINOR_PATH_CLASSES,
                     key=lambda i: (-FULL_ROAD_CLASSES.index(recs[i][1]), recs[i][2], -i))
             + group(lambda r: r[0] not in ("building", "road", "green", "sea"))
             + group(lambda r: r[0] == "sea"))
    removed = set()
    for i in order:
        if fits():
            break
        removed.add(i)
        n, c, b = n - 1, c - recs[i][4], b - recs[i][5] - 1
    return [r[3] for i, r in enumerate(recs) if i not in removed]


def default_meters_per_pixel(bbox):
    """요청에 meters_per_pixel이 없을 때 쓰는 축척: bbox 가로(m) / FULL_DEFAULT_IMAGE_PX."""
    return side_lengths_m(bbox)[0] / FULL_DEFAULT_IMAGE_PX


def full_road_classes(mpp):
    """축척 mpp에서 보낼 full 도로 등급(FULL_ROAD_CLASSES 순서 유지). mpp > PATH_MAX_MPP면 보행로 등급,
    mpp > LOCAL_ROAD_MAX_MPP면 이면도로 등급도 뺀다."""
    return tuple(c for c in FULL_ROAD_CLASSES
                 if not (mpp > PATH_MAX_MPP and c in PATH_LOD_CLASSES)
                 and not (mpp > LOCAL_ROAD_MAX_MPP and c in LOCAL_ROAD_LOD_CLASSES))


def min_building_area_m2(mpp):
    """축척 mpp에서 남기는 건물의 최소 잘린 면적(m²) = max(MIN_BUILDING_AREA_M2, (MIN_BUILDING_PX x mpp)²)."""
    return max(MIN_BUILDING_AREA_M2, (MIN_BUILDING_PX * mpp) ** 2)


def full_simplify_tolerance(bbox, mpp):
    """full 단순화 허용 오차(m) = max(bbox 긴 변 / FULL_SIMPLIFY_DIVISOR, SIMPLIFY_MPP_FACTOR x mpp)."""
    return max(max(side_lengths_m(bbox)) / FULL_SIMPLIFY_DIVISOR, SIMPLIFY_MPP_FACTOR * mpp)


def _build_full(store, bbox, buildings_dir, meters_per_pixel=None):
    """detail="full" 응답. 후보를 한 번에 투영·단순화·자르기·GeoJSON 변환(shapely·numpy 배열 연산)해 촘촘한 도심 bbox도
    몇 초 안에 끝낸다. 축척(meters_per_pixel)에 맞춰 보이지 않는 도로 등급·작은 건물은 읽은 직후 뺀다(LOD)."""
    import shapely
    to_k, to_ll = _transformers()
    w, s, e, n = bbox
    mpp = float(meters_per_pixel) if meters_per_pixel is not None else default_meters_per_pixel(bbox)
    max_side = max(side_lengths_m(bbox))
    tol = full_simplify_tolerance(bbox, mpp)
    box_k = _project(shapely.box(w, s, e, n).segmentize(max((e - w), (n - s)) / 8), to_k)
    min_area = box_k.area * FULL_MIN_AREA_RATIO
    min_len = max_side * FULL_MIN_LINE_RATIO
    min_bld = min_building_area_m2(mpp)
    road_classes = full_road_classes(mpp)

    # 후보(WGS84, bbox로 잘린 단일 LineString·Polygon): kind, 도로 등급(이름), 높이
    kinds, classes, geoms = [], [], []
    for _, rank, g in _road_candidates(store, bbox, to_k, road_classes, LINK_PARENT):
        kinds.append("road"); classes.append(road_classes[rank]); geoms.append(g)
    env, coast = _env_candidates(store, bbox)
    for kind, g in env:
        kinds.append(kind); classes.append(None); geoms.append(g)
    del env
    n_other = len(geoms)
    # 건물은 남은 feature 예산만큼만 투영한다(바다 몇 조각은 _fit_full_limits가 맞춘다).
    available, b_heights, b_geoms = _building_candidates(buildings_dir, bbox, min_bld,
                                                         max(0, MAX_FULL_FEATURES - n_other))
    kinds += ["building"] * len(b_geoms)
    classes += [None] * len(b_geoms)
    heights = [None] * n_other + [round(float(h), HEIGHT_DIGITS) for h in b_heights]
    del b_heights

    # 후보 정렬(배열 연산): 그리는 순서 -> 종류 안 순위. 도로는 등급 다음 잘린 길이, 그 밖의 종류는 면(잘린 면적 순) 다음
    # 선(잘린 길이 순), 건물은 면적 순. 동점은 입력 순서(lexsort는 안정 정렬이라 같은 요청은 같은 응답).
    draw = {k: i for i, k in enumerate(FULL_DRAW_ORDER)}
    sea = [pk for pk in _sea_polygons([_project(g, to_k) for g in coast], box_k, max_side * SEA_OFFSET_RATIO)
           if pk.area >= min_area]
    m = len(kinds)
    gk = np.empty(m + len(sea), object)
    gk[:n_other] = geoms
    gk[n_other:m] = b_geoms
    del geoms, b_geoms
    if m:
        gk[:m] = _project(gk[:m], to_k)
    gk[m:] = sea   # 바다 면은 이미 투영(m) 좌표
    kinds += ["sea"] * len(sea)
    classes += [None] * len(sea)
    heights += [None] * len(sea)
    kind_arr = np.asarray(kinds, object)
    is_poly = shapely.get_type_id(gk) == 3
    size = np.where(is_poly, shapely.area(gk), shapely.length(gk))
    is_bld = kind_arr == "building"
    poly_only = np.isin(kind_arr, POLYGON_KINDS)
    floor = np.where(is_bld, min_bld, min_area)
    keep = np.where(is_poly, size >= floor, (size >= min_len) & ~poly_only)
    sel = np.nonzero(keep)[0]
    is_road = kind_arr[sel] == "road"
    road_rank = np.asarray([FULL_ROAD_CLASSES.index(c) if c is not None else 0 for c in classes], np.int64)
    k1 = np.where(is_road, road_rank[sel], np.where(is_poly[sel], 0, 1))
    k0 = np.asarray([draw[k] for k in kind_arr[sel]], np.int64)
    sel = sel[np.lexsort((-size[sel], k1, k0))]
    recs = []
    if len(sel):
        cand = gk[sel]
        del gk
        # 작은 구멍(면을 버리는 기준과 같은 면적 미만)은 버린다. 구멍이 있는 면만 Python으로 본다.
        for j in np.nonzero(shapely.get_num_interior_rings(cand) > 0)[0]:
            cand[j] = _drop_small_holes(cand[j], float(floor[sel[j]]))
        # 점이 적은 도형(2점 선, 사각형 건물 등)은 단순화해도 그대로라 건너뛴다(촘촘한 도심에서 대부분이 건물).
        simple = cand.copy()
        many = shapely.get_num_coordinates(cand) > 5
        simple[many] = shapely.simplify(cand[many], tol, preserve_topology=True)
        back = _project(simple, to_ll)
        del cand, simple
        # 투영을 되돌리면 bbox 경계에서 아주 작은 오차가 생길 수 있어 다시 자른다(경계를 넘는 도형만).
        bx = shapely.bounds(back)
        out = (bx[:, 0] < w) | (bx[:, 1] < s) | (bx[:, 2] > e) | (bx[:, 3] > n)
        back[out] = shapely.clip_by_rect(back[out], w, s, e, n)
        parts, owner = _single_parts(back)
        del back
        tid = shapely.get_type_id(parts)
        for part_i, (ci, gj) in enumerate(zip(owner.tolist(), _geojson_batch(parts))):
            i = int(sel[ci])
            kind = kinds[i]
            if gj is None or (tid[part_i] != 3 and kind in POLYGON_KINDS):
                continue   # 퇴화했거나 면을 자르다 생긴 선 조각
            geometry, n_coords, coord_bytes = gj
            f = {"kind": kind, "geometry": geometry}
            road_class = height = None
            if kind == "road":
                road_class = f["road_class"] = classes[i]
            elif kind == "building":
                height = f["height_m"] = heights[i]
            recs.append((kind, road_class, float(size[i]), f, n_coords,
                         _feature_bytes(kind, geometry["type"], road_class, height, coord_bytes)))
    meta = buildings_metadata(buildings_dir) if available else None
    return {"osm_data_timestamp": (getattr(store, "metadata", None) or {}).get("osm_data_timestamp"),
            "buildings_available": available,
            "buildings_osm_data_timestamp": (meta or {}).get("osm_data_timestamp"),
            "features": _fit_full_limits(recs)}

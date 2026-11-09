"""전국 창 → 명시적 엔진 입력. 모듈 전역 또는 클래스 패치를 하지 않는다."""
from dataclasses import dataclass
from pathlib import Path

from .fit import APP_MAX_M, MAX_END_SNAP_M
from .store import WindowEnvCache


@dataclass
class WindowRegion:
    source: object
    extract: dict
    extract_poly: object
    extract_sha256: str
    env: dict
    dem: object
    dem_path: str
    cache: object
    prepared: object


def make_pipeline(store, prep, spec, *, mode='enforce', fast=True):
    import geopandas as gpd
    from pyproj import Transformer
    from shapely.geometry import box
    from shapely.ops import transform
    from runway_routing.pipeline import RoutePipeline
    window = store.window(spec)
    layers_path = store.path / 'envcache/layers.gpkg'
    layers = gpd.read_file(layers_path, layer='env', bbox=window.extent_wsen)
    region = WindowRegion(
        source=window.source(),
        extract={'file': 'national.osm.pbf', 'osm_data_timestamp': store.metadata.get('osm_data_timestamp'),
                 'bbox_wsen': list(window.extent_wsen)},
        extract_poly=transform(Transformer.from_crs(5179, 32652, always_xy=True).transform, box(*spec.bounds)),
        extract_sha256=store.extract_sha256,
        env={'name': 'wide', 'layers': layers, 'extent_wsen': store.coverage,
             'path': str(layers_path), 'note': '전국 자료의 요청 창'},
        dem=window.dem, dem_path=str(store.path / 'dem/z.npy'),
        cache=WindowEnvCache(window), prepared=prep.slice(store, window))
    # 부산 고정 self-test는 다른 지역 창에서 실행할 수 없다. 요청 알고리즘은 동일하다.
    pipeline = RoutePipeline('wide', mode=mode, fast=fast, self_test=False, region=region)
    if pipeline.shape_cfg['app_km']['max']*1000 != APP_MAX_M:
        raise ValueError('fitted radius requires frozen app max 21.1 km')
    if pipeline.ug2['end_point_rules']['PE1']['max_destination_snap_m'] != MAX_END_SNAP_M:
        raise ValueError('fitted radius requires frozen destination snap 250 m')
    return pipeline

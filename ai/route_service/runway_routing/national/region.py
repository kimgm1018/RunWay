"""전국 창 → 명시적 엔진 입력. 모듈 전역 또는 클래스 패치를 하지 않는다."""
from dataclasses import dataclass
from pathlib import Path

from runway_routing.env_flags import flag as env_flag

from .fit import APP_MAX_M, MAX_END_SNAP_M
from .store import WindowEnvCache

# S15P31E105-644: 창의 env 레이어(gpkg)를 처음 쓸 때 읽는다. LOOP·OAB는 env 거리를 WindowEnvCache에서 꺼내므로 읽지 않고,
# P2P는 도착점 PE5 판정(snap.env_geoms)에서 읽는다. 같은 파일·같은 bbox·같은 호출이라 읽은 표는 같다.
# RUNWAY_LAZY_ENV_LAYERS=0이면 예전처럼 창을 만들 때 읽는다(env_flags 규칙, import 시 읽음).
LAZY_ENV_LAYERS = env_flag("RUNWAY_LAZY_ENV_LAYERS")
_PENDING = object()


class LazyLayersEnv(dict):
    """env dict(name, layers, extent_wsen, path, note)인데 'layers' 값만 처음 읽을 때 만든다(S15P31E105-644).

    key 순서와 값은 예전 dict와 같다('layers' 자리는 처음부터 있고, 읽기 전에는 내부 표시 값). 값을 꺼내는 모든 길
    ([], get, values, items, 복사·비교·출력)이 먼저 읽어 채우므로 표시 값이 밖으로 나가지 않는다. __iter__를 다시 정의해
    dict(env)·{**env} 같은 C 복사도 keys()+[]를 거친다. 한 요청 lock 안에서만 쓰므로 thread 보호는 하지 않는다."""

    def __init__(self, load, items):
        super().__init__(items)
        self._load = load

    def _fill(self):
        load, self._load = self._load, None
        if load is not None:
            dict.__setitem__(self, 'layers', load())
        return dict.__getitem__(self, 'layers')

    def _ready(self):
        if dict.get(self, 'layers') is _PENDING:
            self._fill()

    def __getitem__(self, key):
        v = dict.__getitem__(self, key)
        return self._fill() if v is _PENDING else v

    def get(self, key, default=None):
        v = dict.get(self, key, default)
        return self._fill() if v is _PENDING else v

    def __iter__(self):
        self._ready()
        return dict.__iter__(self)

    def keys(self):
        self._ready()
        return dict.keys(self)

    def values(self):
        self._ready()
        return dict.values(self)

    def items(self):
        self._ready()
        return dict.items(self)

    def copy(self):
        self._ready()
        return dict(dict.items(self))

    def pop(self, *args):
        self._ready()
        return dict.pop(self, *args)

    def popitem(self):
        self._ready()
        return dict.popitem(self)

    def setdefault(self, key, default=None):
        self._ready()
        return dict.setdefault(self, key, default)

    def __eq__(self, other):
        self._ready()
        return dict.__eq__(self, other)

    __hash__ = None

    def __repr__(self):
        self._ready()
        return dict.__repr__(self)

    def __reduce__(self):
        self._ready()
        return (dict, (dict(dict.items(self)),))


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
    layers_path, bbox = store.path / 'envcache/layers.gpkg', window.extent_wsen

    def read_layers():   # window 전체가 아니라 경로와 bbox만 잡는다(창 배열을 더 오래 붙잡지 않게)
        return gpd.read_file(layers_path, layer='env', bbox=bbox)
    env = {'name': 'wide', 'layers': _PENDING if LAZY_ENV_LAYERS else read_layers(), 'extent_wsen': store.coverage,
           'path': str(layers_path), 'note': '전국 자료의 요청 창'}
    if LAZY_ENV_LAYERS:
        env = LazyLayersEnv(read_layers, env)
    region = WindowRegion(
        source=window.source(),
        extract={'file': 'national.osm.pbf', 'osm_data_timestamp': store.metadata.get('osm_data_timestamp'),
                 'bbox_wsen': list(window.extent_wsen)},
        extract_poly=transform(Transformer.from_crs(5179, 32652, always_xy=True).transform, box(*spec.bounds)),
        extract_sha256=store.extract_sha256,
        env=env,
        dem=window.dem, dem_path=str(store.path / 'dem/z.npy'),
        cache=WindowEnvCache(window), prepared=prep.slice(store, window))
    # 부산 고정 self-test는 다른 지역 창에서 실행할 수 없다. 요청 알고리즘은 동일하다.
    pipeline = RoutePipeline('wide', mode=mode, fast=fast, self_test=False, region=region)
    if pipeline.shape_cfg['app_km']['max']*1000 != APP_MAX_M:
        raise ValueError('fitted radius requires frozen app max 21.1 km')
    if pipeline.ug2['end_point_rules']['PE1']['max_destination_snap_m'] != MAX_END_SNAP_M:
        raise ValueError('fitted radius requires frozen destination snap 250 m')
    return pipeline

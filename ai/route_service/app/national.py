"""요청 잠금 안에서 창 파이프라인을 선택하는 전국 엔진 어댑터."""
from collections import OrderedDict
import gc
import threading

from runway_routing.national.fit import outside_extract

WARMUP_LAT, WARMUP_LON = 37.5013, 127.0396  # 서울 SSAFY 인근 고정점


def _anon_mib():
    """Linux 익명 메모리(MiB). 다른 OS나 읽기 실패면 None."""
    try:
        with open('/proc/self/status', encoding='ascii') as f:
            for line in f:
                if line.startswith('RssAnon:'):
                    return int(line.split()[1]) / 1024
    except OSError:
        return None
    return None


def _malloc_trim():
    try:
        import ctypes
        ctypes.CDLL('libc.so.6').malloc_trim(0)
    except (OSError, AttributeError):
        pass


class NationalPipeline:
    def __init__(self, settings, *, store=None, prep=None, builder=None):
        from runway_routing.national.store import NationalStore
        from runway_routing.national.prep import PreparedStore
        from runway_routing.national.region import make_pipeline
        self.store = store if store is not None else NationalStore(settings.national_dir / 'store')
        self.prep = prep if prep is not None else PreparedStore(settings.national_dir / 'store_prep', self.store)
        self.settings = settings
        self.builder = builder or make_pipeline
        self.lock = threading.Lock()
        self._windows = OrderedDict()
        self.active = None
        self._last_signature = None
        # import/Numba 준비와 고정 창 엔진 생성을 ready 전에 끝낸다.
        self._pipeline(self.store.spec(WARMUP_LAT, WARMUP_LON, 5000))
        self._shape_cfg = self.active.shape_cfg
        # S15P31E105-644: 창의 env 레이어는 처음 쓸 때 읽는다(region.LazyLayersEnv). 시작 창에서만 미리 읽어 gpkg가
        # 열리는지 ready 전에 확인하고, 첫 P2P 요청이 GDAL 첫 열기 비용을 내지 않게 한다(값은 쓰지 않음).
        env = getattr(getattr(self.active, 'data', None), 'env', None)
        if isinstance(env, dict):
            env.get('layers')

    def _pipeline(self, spec):
        if spec.key not in self._windows:
            # 새 창 생성 전에 퇴출하여 기본 1칸에서 두 엔진을 동시에 보유하지 않는다.
            self.active = None
            evicted = False
            while len(self._windows) >= self.settings.window_cache_size:
                self._windows.popitem(last=False)
                evicted = True
            if evicted:
                # generator → ArraySource → Substrate → generator 순환 참조도 회수한다.
                gc.collect()
            pipeline = self.builder(self.store, self.prep, spec,
                                    mode=self.settings.gate_mode, fast=self.settings.fast_graph)
            self._windows[spec.key] = pipeline
        self._windows.move_to_end(spec.key)
        self.active = self._windows[spec.key]
        return self.active

    @property
    def shape_cfg(self):
        return self._shape_cfg

    @property
    def gate(self):
        return self.active.gate

    def check_area(self, lat, lon, shape, end_lat, end_lon):
        from runway_routing.national.store import OutOfArea
        if not self.store.contains(lat, lon) or (shape == 'point_to_point' and not self.store.contains(end_lat, end_lon)):
            raise OutOfArea('OUT_OF_AREA: 요청 좌표가 전국 자료 범위 밖')

    def _release_if_new(self, signature):
        """다른 조건의 요청을 시작하기 전에, 메모리를 많이 쓰는 graph 캐시를 비운다.

        서울 21.1 km 요청은 끝난 뒤에도 생성기의 (G, rg), 요청 graph, P2P mask
        캐시가 익명 메모리 약 1.7 GiB를 잡고 있었다. 그 위에 다른 조건의 새 graph를
        만들면 2 GiB 컨테이너가 메모리 부족(OOM)으로 죽어서, 먼저 비울 필요가 있다.
        조건(lat, lon, target_m, shape, end_lat, end_lon)이 같고 seed만 다른 재추천은
        캐시를 그대로 쓴다. 캐시는 결과를 바꾸지 않는다(pipeline.py RoutePipeline 설명).
        기준이 0이면 다른 조건 요청마다 비운다. Linux가 아니어서 /proc이 없거나
        익명 메모리를 읽을 수 없으면 아무것도 하지 않는다.
        """
        if signature == self._last_signature:
            return
        self._last_signature = signature
        anon = _anon_mib()
        if (anon is None or self.active is None
                or (self.settings.release_anon_mib > 0 and anon <= self.settings.release_anon_mib)):
            return
        p = self.active
        p.gen._cache.clear()
        p.graphs._graphs.clear()
        if p.substrate is not None:
            p.substrate._masks.clear()
        gc.collect()
        _malloc_trim()

    def run(self, lat, lon, target_m, **kwargs):
        shape = kwargs.get('shape') or 'loop'
        end_lat, end_lon = kwargs.get('end_lat'), kwargs.get('end_lon')
        self._release_if_new((lat, lon, target_m, shape, end_lat, end_lon))
        spec = self.store.spec(lat, lon, target_m, shape, end_lat, end_lon)
        pipeline = self._pipeline(spec)
        out = pipeline.run(lat, lon, target_m, **kwargs)
        if spec.small and outside_extract(out):
            # 같은 seed/prefs/shown/attempts로 원래 anchor 창에서 정확히 한 번.
            # 작은 창 결과를 잡고 있지 않아 RSS 정점을 줄인다.
            del out, pipeline
            pipeline = self._pipeline(spec.anchor_spec())
            out = pipeline.run(lat, lon, target_m, **kwargs)
        return out

    def graph(self, *args):
        return self.active.graph(*args)

"""전국 mmap 저장소: 원본을 수정하지 않고 whole-way 창을 복사한다."""
from dataclasses import dataclass
from pathlib import Path
import hashlib
import json
import time
import numpy as np
from ..fast_unique import sorted_unique
from .fit import window_spec

class OutOfArea(ValueError):
    """요청 좌표 또는 창이 전국 자료의 범위 밖이다."""


class NoRoad(ValueError):
    """전국 범위 안이지만 선택할 도로가 없다."""


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def check_files(path, manifest):
    files = manifest.get('files')
    if not isinstance(files, dict) or not files:
        raise ValueError('manifest files missing')
    for name, meta in files.items():
        p = (path / name).resolve()
        if not p.is_relative_to(path.resolve()) or not p.is_file() or p.stat().st_size != meta['bytes']:
            raise ValueError(f'manifest file size mismatch: {name}')

def gather_ranges(starts, ends):
    """CSR 여러 행을 Python의 원소별 반복 없이 펼친다. 빈 행도 지원한다."""
    starts, ends = np.asarray(starts, np.int64), np.asarray(ends, np.int64)
    lengths = ends - starts
    total = int(lengths.sum())
    if not total:
        return np.empty(0, np.int64)
    base = np.cumsum(lengths) - lengths
    return np.repeat(starts - base, lengths) + np.arange(total, dtype=np.int64)


def anchor_xy(x, y):
    return (int(np.floor((x-700000)/5000))*5000 + 702500,
            int(np.floor((y-1300000)/5000))*5000 + 1302500)


def select_window(grid, net, cells):
    ids = grid['cell_ids']
    p = np.searchsorted(ids, cells)
    valid = p < len(ids)
    p = p[valid]
    p = p[ids[p] == np.asarray(cells)[valid]]
    if not len(p):
        raise NoRoad('NO_ROAD_NEARBY: 창에 도로 칸이 없음')
    cp = grid['cell_offsets']
    inner = grid['cell_node_idx'][gather_ranges(cp[p], cp[p+1])]
    nptr = net['node_way_ptr']
    ways = sorted_unique(net['node_way_idx'][gather_ranges(nptr[inner], nptr[inner+1])])
    if not len(ways):
        raise NoRoad('NO_ROAD_NEARBY: 창에 way가 없음')
    rp, sp = net['ref_ptr'], net['way_seg_ptr']
    refs = gather_ranges(rp[ways], rp[ways+1])
    nodes = sorted_unique(net['ref_pos'][refs])
    segments = gather_ranges(sp[ways], sp[ways+1])
    return {'ways': ways, 'nodes': nodes, 'refs': refs, 'segments': segments}


def signature(arrays):
    """dtype·shape까지 포함한 결정성 지문. 시간 측정 밖에서 호출한다."""
    out = {}
    for k, a in sorted(arrays.items()):
        h = hashlib.sha256()
        h.update(str(a.dtype).encode())
        h.update(str(a.shape).encode())
        h.update(np.ascontiguousarray(a).tobytes())
        out[k] = h.hexdigest()
    return out


@dataclass
class Window:
    anchor: tuple
    net: dict
    dist_dm: np.ndarray
    dem: object
    extent_wsen: tuple
    timings: dict
    strings: list
    store: object

    def fingerprints(self):
        return signature({**self.net, 'dist_dm': self.dist_dm, 'dem_z': self.dem.z,
                          'dem_transform': np.asarray(tuple(self.dem.t), np.float64)})

    def source(self):
        from runway_routing.network_store import CompactSource
        return CompactSource(self.net, self.strings, self.store.path / 'national.osm.pbf')


class NationalStore:
    def __init__(self, path, verify=False):
        self.path = path = Path(path)
        self.manifest = json.loads((path / 'MANIFEST.json').read_text(encoding='utf-8'))
        if self.manifest.get('format') != 1:
            raise ValueError('저장소 format 불일치')
        check_files(path, self.manifest)
        if verify:
            self.verify()
        self.grid = self._arrays('grid')
        self.net = self._arrays('network')
        self.env = self._arrays('envcache')
        self.strings = json.loads((path / 'network/strings.json').read_text(encoding='utf-8'))
        self.dem_z = np.load(path / 'dem/z.npy', mmap_mode='r', allow_pickle=False)
        self.dem_meta = json.loads((path / 'dem/metadata.json').read_text(encoding='utf-8'))
        from pyproj import Transformer
        self.to_k = Transformer.from_crs(4326, 5179, always_xy=True)
        self.to_ll = Transformer.from_crs(5179, 4326, always_xy=True)
        self.grid_meta = json.loads((path / 'grid/metadata.json').read_text(encoding='utf-8'))
        if self.grid_meta != {'crs': 'EPSG:5179', 'origin_xy': [700000, 1300000],
                              'nx': 800, 'ny': 900, 'cell_m': 1000, 'anchor_m': 5000,
                              'half_window_m': 20000, 'bounds': 'half-open [min,max)'}:
            raise ValueError('unsupported national grid format')
        from . import legacy
        meta = path.parent / 'env_layers_national.json'
        if self.manifest.get('national_metadata') is not None:
            self.metadata = self.manifest['national_metadata']
        elif meta.is_file():
            self.metadata = json.loads(meta.read_text(encoding='utf-8'))
        elif sha256(path / 'MANIFEST.json') == legacy.STORE_MANIFEST:
            self.metadata = {'bbox_wsen': legacy.COVERAGE, 'osm_data_timestamp': legacy.TIMESTAMP}
        else:
            raise ValueError('env_layers_national.json missing from national mount')
        self.coverage = tuple(self.metadata['bbox_wsen'])
        if (len(self.coverage) != 4 or not np.isfinite(self.coverage).all()
                or not (-180 <= self.coverage[0] < self.coverage[2] <= 180)
                or not (-90 <= self.coverage[1] < self.coverage[3] <= 90)):
            raise ValueError('invalid national coverage bbox')
        ec = json.loads((path / 'envcache/metadata.json').read_text(encoding='utf-8'))
        from runway_routing.data import _code_sha, ENV_CLASSES
        if not ec.get('complete') or ec['code_sha256'] != _code_sha() or ec['classes'] != ENV_CLASSES:
            raise ValueError('envcache code/classes mismatch')
        self.extract_sha256 = ec['pbf_sha256']

    def contains(self, lat, lon):
        """원본 extract의 bbox를 검사한다. 도로 없는 셀은 NO_ROAD와 구분한다."""
        if not np.isfinite([lat, lon]).all():
            return False
        w, s, e, n = self.coverage
        return w <= lon <= e and s <= lat <= n

    def spec(self, lat, lon, target_m, shape='loop', end_lat=None, end_lon=None, *, anchor=False):
        if not self.contains(lat, lon):
            raise OutOfArea('OUT_OF_AREA: 출발점이 전국 자료 범위 밖')
        x, y = self.to_k.transform(lon, lat)
        end = None
        if shape == 'point_to_point':
            if end_lat is None or end_lon is None:
                raise ValueError('P2P end required')
            if not self.contains(end_lat, end_lon):
                raise OutOfArea('OUT_OF_AREA: 도착점이 전국 자료 범위 밖')
            ex, ey = self.to_k.transform(end_lon, end_lat)
            end = (ex-x, ey-y)
        return window_spec((x, y), shape, target_m, end, anchor=anchor)

    def _arrays(self, group):
        paths = sorted((self.path / group).glob('*.npy'))
        if any(p.relative_to(self.path).as_posix() not in self.manifest['files'] for p in paths):
            raise ValueError(f'unmanifested array in {group}')
        return {p.stem: np.load(p, mmap_mode='r', allow_pickle=False) for p in paths}

    def verify(self):
        # 배포/빌드 검증 단계에서 한 번. 매 요청 전국 해싱은 하지 않는다.
        for name, meta in self.manifest['files'].items():
            p = self.path / name
            if not p.is_file() or p.stat().st_size != meta['bytes'] or sha256(p) != meta['sha256']:
                raise ValueError(f'저장소 해시 불일치: {name}')

    def window(self, spec):
        t = time.perf_counter()
        ax, ay = spec.centre
        west, south, east, north = spec.bounds
        # 정사각형과 겹치는 1 km 칸을 보수적으로 모두 담는다(가장자리 반 칸 포함).
        ix0, ix1 = int(np.floor((west-700000)/1000)), int(np.ceil((east-700000)/1000))
        iy0, iy1 = int(np.floor((south-1300000)/1000)), int(np.ceil((north-1300000)/1000))
        xs, ys = np.meshgrid(np.arange(max(0, ix0), min(800, ix1)), np.arange(max(0, iy0), min(900, iy1)))
        sel = select_window(self.grid, self.net, (ys*800+xs).ravel())
        phases = {'select_s': time.perf_counter()-t}
        t1 = time.perf_counter()
        n, w, r, s = (sel[k] for k in ('nodes', 'ways', 'refs', 'segments'))
        src = self.net
        # 재배치는 정렬된 선택 위치를 통해 한다. 전국 길이의 임시 역색인은 만들지 않는다.
        tp = src['tag_ptr']
        tags = gather_ranges(tp[w], tp[w+1])
        net = {'node_ids': src['node_ids'][n], 'lonlat': src['lonlat'][n], 'xy': src['xy'][n],
               'way_ids': src['way_ids'][w],
               'ref_ptr': np.r_[0, np.cumsum(src['ref_ptr'][w+1]-src['ref_ptr'][w])].astype(np.int32),
               'ref_pos': np.searchsorted(n, src['ref_pos'][r]).astype(np.int32),
               'tag_ptr': np.r_[0, np.cumsum(tp[w+1]-tp[w])].astype(np.int32),
               'tag_k': src['tag_k'][tags], 'tag_v': src['tag_v'][tags],
               'seg_w': np.searchsorted(w, src['seg_w'][s]).astype(np.int32),
               # 엔진은 lo * node_count로 pair key를 만든다. 이 두 위치는 int64여야 넘치지 않는다.
               'seg_a': np.searchsorted(n, src['seg_a'][s]).astype(np.int64),
               'seg_b': np.searchsorted(n, src['seg_b'][s]).astype(np.int64), 'seg_len': src['seg_len'][s]}
        dist_dm = self.env['dist_dm'][self.env['segment_row'][s]]
        phases['arrays_s'] = time.perf_counter()-t1
        # DEM은 way 전체 node를 덮는다. 매우 긴 way가 있으면 필요한 DEM 크기도 그대로 기록한다.
        ll = net['lonlat']
        bounds = (float(ll[:, 0].min()), float(ll[:, 1].min()), float(ll[:, 0].max()), float(ll[:, 1].max()))
        dem = self._dem(bounds)
        phases['dem_s'] = time.perf_counter()-t1-phases['arrays_s']
        blon, blat = self.to_ll.transform([west, west, east, east], [south, north, south, north])
        extent = (min(blon), min(blat), max(blon), max(blat))
        phases['window_s'] = time.perf_counter()-t
        for a in list(net.values()) + [dist_dm, dem.z]:
            a.flags.writeable = False
        return Window((ax, ay), net, dist_dm, dem, extent, phases, self.strings, self)

    def _dem(self, bounds):
        from affine import Affine
        from runway_routing.data import Dem
        t = Affine(*self.dem_meta['transform'])
        west, south, east, north = bounds
        c0 = max(0, int(np.floor((west-t.c)/t.a))-2)
        c1 = min(self.dem_z.shape[1], int(np.ceil((east-t.c)/t.a))+2)
        r0 = max(0, int(np.floor((north-t.f)/t.e))-2)
        r1 = min(self.dem_z.shape[0], int(np.ceil((south-t.f)/t.e))+2)
        if c1 <= c0 or r1 <= r0:
            raise ValueError('OUT_OF_AREA: DEM 범위 밖')
        dem = object.__new__(Dem)
        dem.z = np.array(self.dem_z[r0:r1, c0:c1], dtype=np.float32, order='C')
        dem.t = t * Affine.translation(c0, r0)
        dem.meta = self.dem_meta
        return dem


class WindowEnvCache:
    """정렬된 segment key 조회. pandas MultiIndex를 상주시킬 필요가 없다."""
    def __init__(self, window):
        t = time.perf_counter()
        n = window.net
        ids = n['node_ids']
        a, b = ids[n['seg_a']], ids[n['seg_b']]
        self.dtype = np.dtype([('a', '<i8'), ('b', '<i8'), ('w', '<i8')])
        keys = np.empty(len(a), self.dtype)
        keys['a'], keys['b'], keys['w'] = np.minimum(a, b), np.maximum(a, b), n['way_ids'][n['seg_w']]
        # S15P31E105-626: 구조체 배열의 안정 argsort는 필드 (a, b, w) 순 사전식 비교라 lexsort((w, b, a))와 같은
        # 순서다(둘 다 안정 정렬). lexsort가 5–6배 빠르다(서울 21.1 km 창 약 0.3 s → 0.05 s).
        order = np.lexsort((keys['w'], keys['b'], keys['a']))
        sorted_keys = keys[order]
        keep = np.r_[True, sorted_keys[1:] != sorted_keys[:-1]] if len(order) else np.empty(0, bool)
        self.keys, self.dist_dm = sorted_keys[keep], window.dist_dm[order[keep]]
        # S15P31E105-640: 창 segment 위치 -> 그 segment key의 조회 결과 행(lookup이 찾는 행과 같은 행). edge가 나온
        # segment를 알면 구조체 배열 searchsorted 없이 같은 거리를 꺼낸다(lookup_segments).
        self.seg_row = np.empty(len(order), np.int64)
        self.seg_row[order] = np.cumsum(keep) - 1 if len(order) else np.empty(0, np.int64)
        self.load_seconds = time.perf_counter()-t
        self.prov = {'created_utc': window.store.manifest['created_utc'], 'segments': len(self.keys)}

    def lookup_segments(self, seg):
        """lookup과 같은 (거리, 빠짐) 결과를 창 segment 위치로 찾는다. 창의 모든 segment는 key가 있으므로 빠짐은 없다.
        seg: redges 행마다 그 edge를 만든 이 창의 segment 위치."""
        dm = self.dist_dm[self.seg_row[seg]]
        out = np.where(dm == -1, np.inf, dm / 10)
        return out, np.zeros(len(seg), bool)

    def lookup(self, redges):
        a = redges['osm_u'].to_numpy(np.int64)
        b = redges['osm_v'].to_numpy(np.int64)
        keys = np.empty(len(a), self.dtype)
        keys['a'], keys['b'], keys['w'] = np.minimum(a, b), np.maximum(a, b), redges['osmid'].to_numpy(np.int64)
        p = np.searchsorted(self.keys, keys)
        ok = p < len(self.keys)
        ok[ok] &= self.keys[p[ok]] == keys[ok]
        # 기존 attach_env가 빠진 edge의 정확한 거리 계산을 담당한다.
        out = np.full((len(keys), 6), np.nan)
        dm = self.dist_dm[p[ok]]
        out[ok] = np.where(dm == -1, np.inf, dm / 10)
        return out, ~ok



"""창별 way 정적 표. B2 값은 복원하고 요청별 그래프는 원래 엔진이 만든다."""
from collections import OrderedDict
from importlib.metadata import version
import json
import hashlib
from pathlib import Path

import numpy as np

from .store import check_files, sha256
from . import legacy

VERSION = 'national-way-prep-v1'
ARRAY_NAMES = ('attrs', 'status', 'reason', 'flags', 'table')


def code_key():
    from runway_routing.data import ROOT
    import pandas as pd
    try:
        arrow = version('pyarrow')
    except Exception:
        arrow = None
    options = {}
    for option in ('future.infer_string', 'mode.string_storage'):
        try:
            options[option] = pd.get_option(option)
        except pd.errors.OptionError:
            options[option] = None
    return {'engine': {name: hashlib.sha256((ROOT / name).read_text(encoding='utf-8').encode()).hexdigest()
                       for name in legacy.RUNTIME},
            'packages': {n: version(n) for n in ('numpy', 'pandas', 'osmnx', 'shapely', 'pyproj', 'geopandas')},
            'pyarrow': arrow,
            'pandas_options': options}


def way_indices(national_ids, selected_ids):
    ids = np.asarray(selected_ids)
    if ids.ndim != 1 or (len(ids) > 1 and not np.all(ids[1:] > ids[:-1])):
        raise ValueError('창 way ID는 중복 없이 오름차순이어야 함')
    p = np.searchsorted(national_ids, ids)
    if len(p) and (p.max() >= len(national_ids) or not np.array_equal(national_ids[p], ids)):
        raise ValueError('창 way ID가 전국 저장소에 없음')
    return p


def slice_arrays(arrays, indices):
    out = {k: np.asarray(v[indices]) for k, v in arrays.items()}
    for v in out.values():
        v.flags.writeable = False
    return out


def decode(codes, vocab):
    return np.asarray([None, *vocab], dtype=object)[np.asarray(codes, np.int64)+1]


class PreparedStore:
    def __init__(self, path, store, *, verify=False):
        from runway_routing import graph as G
        self.path = Path(path)
        m = self.manifest = json.loads((self.path / 'MANIFEST.json').read_text(encoding='utf-8'))
        self.legacy = m.get('version') == 'b2-way-prep-v1'
        key = code_key()
        if self.legacy:
            # B2에는 절대 경로와 전체 구버전 코드 key가 있다. 경로를 재사용하거나
            # 버전 검사를 끄지 않고 검증된 한 자료와 현재 포팅 코드만 명시적으로 허용한다.
            if sha256(self.path / 'MANIFEST.json') != legacy.PREP_MANIFEST or key['engine'] != legacy.RUNTIME:
                raise ValueError('B2 compatibility mismatch; rebuild store_prep with current builder')
            if any(key[k] != m['code_key'].get(k) for k in ('packages', 'pyarrow', 'pandas_options')):
                raise ValueError('B2 package/string options mismatch; rebuild store_prep')
        elif m.get('version') != VERSION or m.get('code_key') != key:
            raise ValueError('prep version/code key mismatch; rebuild store_prep')
        if m['store_manifest_sha256'] != sha256(store.path / 'MANIFEST.json'):
            raise ValueError('prep source store mismatch')
        check_files(self.path, m)
        if m['useful'] != G.USEFUL or m['edge_tags'] != G.EDGE_TAGS or m['ways'] != len(store.net['way_ids']):
            raise ValueError('prep columns/way count mismatch')
        if m.get('flags') != ['runnable', 'pe4', 'pe5', 'bridge']:
            raise ValueError('prep flag columns mismatch')
        self.vocab = json.loads((self.path / 'b2_vocab.json').read_text(encoding='utf-8'))
        self.arrays = {k: np.load(self.path / f'b2_{k}.npy', mmap_mode='r', allow_pickle=False) for k in ARRAY_NAMES}
        count = m['ways']
        shapes = {'attrs': (count, len(G.USEFUL)), 'status': (count,), 'reason': (count,),
                  'flags': (count, 4), 'table': (count, len(G.EDGE_TAGS)-1)}
        for k, a in self.arrays.items():
            if a.shape != shapes[k] or a.dtype != np.dtype('bool' if k == 'flags' else 'int32'):
                raise ValueError(f'prep shape/dtype mismatch: {k}')
        if verify:
            self.verify()

    def verify(self):
        for name, meta in self.manifest['files'].items():
            if sha256(self.path / name) != meta['sha256']:
                raise ValueError(f'prep hash mismatch: {name}')

    def slice(self, store, window):
        if window.store is not store:
            raise ValueError('window belongs to another store')
        indices = way_indices(store.net['way_ids'], window.net['way_ids'])
        return PreparedSlice(slice_arrays(self.arrays, indices), self.vocab)


class PreparedSlice:
    def __init__(self, arrays, vocab):
        self.arrays, self.vocab = arrays, vocab

    def sidecar(self, sc, src):
        from runway_routing import graph as G, network_store as N
        a, net = self.arrays, src.net
        sc.way_ids = net['way_ids'].tolist()
        sc.ptr, sc.ref_pos = net['ref_ptr'], net['ref_pos']
        sc.refs = N.RefsView(net)
        sc.attrs = object.__new__(N.AttrsView)
        sc.attrs._s, sc.attrs._useful, sc.attrs._wid = src.strings, G.USEFUL, sc.way_ids
        sc.attrs.codes = a['attrs']
        sc.way_status = decode(a['status'], self.vocab).tolist()
        sc.way_reason = decode(a['reason'], self.vocab).tolist()
        sc.cls = N.ClsView(net['way_ids'], sc.way_status, sc.way_reason)

    def substrate(self, sub, gen, ug2):
        from runway_routing import network_store as N
        from runway_routing.graph import Sidecar
        src = gen.source
        sc = gen.sidecar if gen.sidecar is not None else Sidecar(src, self)
        sub.gen, sub.src, sub.sc = gen, src, sc
        sub.ids = src.node_ids
        sub._pos_lookup = N._Lookup(sub.ids)
        net, ll = src.net, src.net['lonlat']
        sub.lon, sub.lat, sub.xy = ll[:, 0].copy(), ll[:, 1].copy(), src.xy
        sub.seg_w, sub.seg_a, sub.seg_b, sub.seg_len = (net[k] for k in ('seg_w', 'seg_a', 'seg_b', 'seg_len'))
        sub.way_of_ref = np.repeat(np.arange(len(sc.way_ids)), np.diff(sc.ptr))
        sub.runnable, sub.pe4, sub.pe5, sub.bridge = (self.arrays['flags'][:, j].copy() for j in range(4))
        sub._masks = OrderedDict()

    def array_source(self, arr, sub):
        from runway_routing import graph as G, array_graph as A
        import pandas as pd
        arr.S, arr.h_templates = sub, A._HTemplates(sub.sc)
        columns = [k for k in G.EDGE_TAGS if k != 'osmid']
        values = decode(self.arrays['table'], self.vocab)
        arr.way_table = pd.DataFrame({k: values[:, j].tolist() for j, k in enumerate(columns)}, columns=columns)
        arr.way_table.insert(G.EDGE_TAGS.index('osmid'), 'osmid', np.asarray(sub.sc.way_ids, np.int64))

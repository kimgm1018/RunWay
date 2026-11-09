"""4개 node / 2개 way인 실제 npy 형식의 합성 자료를 임시 폴더에 만든다."""
import json
from pathlib import Path

import numpy as np
from pyproj import Transformer


def write_store(root):
    from runway_routing.data import ENV_CLASSES, _code_sha
    from runway_routing.national.store import sha256
    root = Path(root)
    path = root / 'store'
    ll = np.array([[127.0396, 37.5013], [127.0406, 37.5013], [127.1406, 37.5013], [127.0416, 37.5023]])
    xy = np.column_stack(Transformer.from_crs(4326, 32652, always_xy=True).transform(ll[:, 0], ll[:, 1]))
    k = np.column_stack(Transformer.from_crs(4326, 5179, always_xy=True).transform(ll[:, 0], ll[:, 1]))
    cell = (np.floor((k[:, 1]-1300000)/1000).astype(int)*800 + np.floor((k[:, 0]-700000)/1000).astype(int))
    order = np.argsort(cell, kind='stable')
    ids, ptr = np.unique(cell[order], return_index=True)
    network = dict(node_ids=np.arange(1, 5, dtype=np.int64), lonlat=ll, xy=xy, xy_utmk=k,
                   way_ids=np.array([10, 40], np.int64), ref_ptr=np.array([0, 3, 5], np.int32),
                   ref_pos=np.array([0, 1, 2, 1, 3], np.int32),
                   tag_ptr=np.array([0, 2, 4], np.int32), tag_k=np.array([0, 2, 0, 4], np.int32),
                   tag_v=np.array([1, 3, 1, 5], np.int32),
                   seg_w=np.array([0, 0, 1], np.int32), seg_a=np.array([0, 1, 1], np.int32),
                   seg_b=np.array([1, 2, 3], np.int32), seg_len=np.array([90., 9000., 130.]),
                   way_seg_ptr=np.array([0, 2, 3], np.int32),
                   node_way_ptr=np.array([0, 1, 3, 4, 5], np.int32), node_way_idx=np.array([0, 0, 1, 0, 1], np.int32))
    groups = {'network': network,
              'grid': {'cell_ids': ids.astype(np.int32), 'cell_offsets': np.r_[ptr, 4].astype(np.int32),
                       'cell_node_idx': order.astype(np.int32)},
              'envcache': {'dist_dm': np.arange(18, dtype=np.int32).reshape(3, 6),
                           'segment_row': np.arange(3, dtype=np.int32)},
              'dem': {'z': np.ones((120, 140), np.float32)}}
    for group, arrays in groups.items():
        (path / group).mkdir(parents=True)
        for name, a in arrays.items():
            np.save(path / group / f'{name}.npy', a, allow_pickle=False)
    def save(name, obj):
        (path / name).write_text(json.dumps(obj), encoding='utf-8')
    save('network/strings.json', ['highway', 'footway', 'name', ' raw name ', 'bridge', 'yes'])
    save('grid/metadata.json', {'crs': 'EPSG:5179', 'origin_xy': [700000, 1300000], 'nx': 800, 'ny': 900,
                              'cell_m': 1000, 'anchor_m': 5000, 'half_window_m': 20000, 'bounds': 'half-open [min,max)'})
    save('dem/metadata.json', {'transform': [0.01, 0, 126.5, 0, -0.01, 38.0], 'shape': [120, 140]})
    save('envcache/metadata.json', {'complete': True, 'code_sha256': _code_sha(), 'classes': ENV_CLASSES,
                                  'pbf_sha256': '0'*64})
    meta = {'bbox_wsen': [124, 32, 132, 39], 'osm_data_timestamp': '2026-10-20T20:23:47Z'}
    (root / 'env_layers_national.json').write_text(json.dumps(meta), encoding='utf-8')
    files = {p.relative_to(path).as_posix(): {'bytes': p.stat().st_size, 'sha256': sha256(p)}
             for p in sorted(path.rglob('*')) if p.is_file()}
    save('MANIFEST.json', {'format': 1, 'created_utc': 'fixture', 'national_metadata': meta,
                           'files': files, 'counts': {'ways': 2, 'nodes': 4, 'segments': 3}})
    return path

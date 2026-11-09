"""전국 highway PBF → 무압축 npy 저장소. python -B build_store.py [--stage ...]."""
import argparse
from array import array
from pathlib import Path
import sys
CODE = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(CODE))
import gc
import json
import time

from tools.data.national.common import wait_ram, save, sha, code_key, configure
import numpy as np


def put(group, name, value, dtype=None):
    path = STORE / group / (name + '.npy')
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, np.asarray(value, dtype=dtype), allow_pickle=False)


def get(group, name):
    return np.load(STORE / group / (name + '.npy'), mmap_mode='r', allow_pickle=False)


def csr(keys, values, n):
    order = np.argsort(keys, kind='stable')
    ptr = np.r_[0, np.cumsum(np.bincount(keys, minlength=n), dtype=np.int64)]
    if ptr[-1] >= 2**31:
        raise OverflowError('int32 CSR 범위 초과')
    return ptr.astype(np.int32), values[order].astype(np.int32)


def network():
    """기존 parser와 같은 모든 way·tag·참조를 보존한다. 큰 Python dict는 만들지 않는다."""
    import osmium
    from pyproj import Transformer
    from osmnx.distance import great_circle
    pbf = PBF
    ids, ll = array('q'), array('d')
    for n in osmium.FileProcessor(str(pbf), osmium.osm.NODE):
        ids.append(n.id)
        ll.extend((n.location.lon, n.location.lat))
    node_ids = np.asarray(ids, dtype=np.int64)
    lonlat = np.asarray(ll, dtype=np.float64).reshape(-1, 2)
    assert np.all(node_ids[1:] > node_ids[:-1]), 'node id 순서가 오름차순이어야 함'
    assert np.isfinite(lonlat).all()
    put('network', 'node_ids', node_ids)
    put('network', 'lonlat', lonlat)
    for crs, name in [('EPSG:32652', 'xy'), ('EPSG:5179', 'xy_utmk')]:
        x, y = Transformer.from_crs('EPSG:4326', crs, always_xy=True).transform(lonlat[:, 0], lonlat[:, 1])
        put('network', name, np.column_stack((x, y)))
        del x, y
    del ids, ll, lonlat
    gc.collect()
    wait_ram('network ways')
    wid, refs = array('q'), array('q')
    rp, tp, tk, tv = array('i', [0]), array('i', [0]), array('i'), array('i')
    strings, sid = [], {}
    for w in osmium.FileProcessor(str(pbf), osmium.osm.WAY):
        wid.append(w.id)
        refs.extend(n.ref for n in w.nodes)
        rp.append(len(refs))
        for k, v in w.tags:
            for s, out in ((k, tk), (v, tv)):
                if s not in sid:
                    sid[s] = len(strings)
                    strings.append(s)
                out.append(sid[s])
        tp.append(len(tk))
    way_ids = np.asarray(wid, dtype=np.int64)
    assert np.all(way_ids[1:] > way_ids[:-1]), 'way id 순서가 오름차순이어야 함'
    rp = np.asarray(rp, dtype=np.int32)
    assert np.all(np.diff(rp) > 0), '빈 way는 reduceat에서 지원하지 않음'
    rawrefs = np.asarray(refs, dtype=np.int64)
    pos = np.searchsorted(node_ids, rawrefs)
    assert np.all(pos < len(node_ids)) and np.array_equal(node_ids[pos], rawrefs), '빠진 node 참조'
    for name, val in [('way_ids', way_ids), ('ref_ptr', rp), ('ref_pos', pos.astype(np.int32)),
                      ('tag_ptr', tp), ('tag_k', tk), ('tag_v', tv)]:
        put('network', name, val)
    save(STORE / 'network/strings.json', strings)
    del rawrefs, refs, tk, tv, tp, wid, strings, sid
    gc.collect()
    wait_ram('network CSR and segments')
    wref = np.repeat(np.arange(len(way_ids), dtype=np.int32), np.diff(rp))
    ptr, idx = csr(pos, wref, len(node_ids))
    put('network', 'node_way_ptr', ptr)
    put('network', 'node_way_idx', idx)
    del ptr, idx
    # osmnx/groupby와 같이 연속 중복 참조만 제거한다.
    pair = np.flatnonzero((wref[1:] == wref[:-1]) & (pos[1:] != pos[:-1]))
    a, b, sw = pos[pair].astype(np.int32), pos[pair + 1].astype(np.int32), wref[pair]
    put('network', 'seg_a', a)
    put('network', 'seg_b', b)
    put('network', 'seg_w', sw)
    put('network', 'way_seg_ptr', np.r_[0, np.cumsum(np.bincount(sw, minlength=len(way_ids)))], np.int32)
    ll = get('network', 'lonlat')
    # 길이는 float64. 요청 graph에서도 기존 대권거리 함수를 그대로 쓴다.
    out = np.lib.format.open_memmap(STORE / 'network/seg_len.npy', mode='w+', dtype=np.float64, shape=(len(a),))
    for s in range(0, len(a), 250_000):
        aa, bb = a[s:s+250_000], b[s:s+250_000]
        d = great_circle(ll[aa, 1], ll[aa, 0], ll[bb, 1], ll[bb, 0])
        out[s:s+len(aa)] = np.nan_to_num(d, nan=0)
    out.flush()
    save(STORE / 'network/READY.json', {'nodes': len(node_ids), 'ways': len(way_ids), 'segments': len(a)})


def grid():
    xy = get('network', 'xy_utmk')
    ix = np.floor((xy[:, 0] - 700000) / 1000).astype(np.int32)
    iy = np.floor((xy[:, 1] - 1300000) / 1000).astype(np.int32)
    assert np.all((ix >= 0) & (ix < 800) & (iy >= 0) & (iy < 900))
    cell = iy * 800 + ix
    order = np.argsort(cell, kind='stable')
    ids, starts = np.unique(cell[order], return_index=True)
    put('grid', 'cell_ids', ids, np.int32)
    put('grid', 'cell_offsets', np.r_[starts, len(cell)], np.int32)
    put('grid', 'cell_node_idx', order, np.int32)
    save(STORE / 'grid/metadata.json', {'crs': 'EPSG:5179', 'origin_xy': [700000, 1300000],
                                      'nx': 800, 'ny': 900, 'cell_m': 1000, 'anchor_m': 5000,
                                      'half_window_m': 20000, 'bounds': 'half-open [min,max)'})


def envcache():
    from runway_routing import data as D
    import geopandas as gpd
    xy = get('network', 'xy_utmk')
    a, b = get('network', 'seg_a'), get('network', 'seg_b')
    ec = STORE / 'envcache'
    ec.mkdir(exist_ok=True)
    # 각 segment는 midpoint 칸에 한 번 저장. 창 밖으로 뻗는 way도 역색인으로 모두 조회한다.
    mid = (xy[a] + xy[b]) * .5
    cell = (np.floor((mid[:, 1] - 1300000) / 1000).astype(np.int32) * 800
            + np.floor((mid[:, 0] - 700000) / 1000).astype(np.int32))
    order = np.argsort(cell, kind='stable').astype(np.int32)
    ids, starts = np.unique(cell[order], return_index=True)
    inverse = np.empty(len(order), dtype=np.int32)
    inverse[order] = np.arange(len(order), dtype=np.int32)
    put('envcache', 'cell_ids', ids, np.int32)
    put('envcache', 'cell_offsets', np.r_[starts, len(order)], np.int32)
    put('envcache', 'segment_idx', order)
    put('envcache', 'segment_row', inverse)
    del cell, mid, inverse
    # 같은 함수에 같은 투영 자료를 준다. 이미 투영한 GDF의 to_crs는 좌표를 다시 계산하지 않는다.
    layers = gpd.read_file(NATIONAL / 'env_layers_national.geojson')
    # 요청 때 전국 GeoJSON을 다시 훑지 않도록 공간 색인이 있는 보조 파일을 둔다.
    layers.to_file(ec / 'layers.gpkg', layer='env', driver='GPKG', index=False)
    layers = layers.to_crs(D.UTM_CRS)
    p = ec / 'dist_dm.npy'
    state = ec / 'progress.json'
    identity = {'code_sha256': D._code_sha(), 'env_sha256': sha(NATIONAL / 'env_layers_national.geojson'),
                'pbf_sha256': sha(PBF)}
    done = 0
    if p.exists() and state.exists():
        old = json.loads(state.read_text(encoding='utf-8'))
        if old['identity'] != identity:
            raise RuntimeError('부분 env cache 원본/코드가 다름: 별도 작업 폴더에서 다시 빌드해야 함')
        done = old['done']
    out = np.lib.format.open_memmap(p, mode='r+' if done else 'w+', dtype=np.int32, shape=(len(a), len(D.ENV_CLASSES)))
    x52 = get('network', 'xy')
    for s in range(done, len(a), 250_000):
        wait_ram(f'env {s}/{len(a)}')
        selected = order[s:s+250_000]
        d = D.edge_distances(D._Segments(x52[:, 0], x52[:, 1], a[selected], b[selected]), layers)
        values = d[[c + '_dist_m' for c in D.ENV_CLASSES]].to_numpy()
        dm = np.where(np.isfinite(values), np.rint(values * 10), D.NO_GEOMETRY)
        assert dm.min() >= -1 and dm.max() <= np.iinfo(np.int32).max
        out[s:s+len(selected)] = dm.astype(np.int32)
        out.flush()
        save(state, {'identity': identity, 'done': s+len(selected), 'total': len(a)})
    save(ec / 'metadata.json', {**identity, 'classes': D.ENV_CLASSES, 'no_geometry': -1,
                               'order': 'segment midpoint 1 km cell, stable segment order',
                               'segments': len(a), 'complete': True})


def dem():
    import rasterio
    from rasterio.windows import Window
    d = STORE / 'dem'
    d.mkdir(exist_ok=True)
    with rasterio.open(NATIONAL / 'copernicus_glo30_national.tif') as src:
        assert src.crs.to_epsg() == 4326 and src.transform.b == 0 and src.transform.d == 0
        out = np.lib.format.open_memmap(d / 'z.npy', mode='w+', dtype=np.float32, shape=(src.height, src.width))
        for row in range(0, src.height, 256):
            wait_ram(f'dem row {row}')
            z = src.read(1, window=Window(0, row, src.width, min(256, src.height-row)), out_dtype='float32')
            if src.nodata is not None:
                z[z == src.nodata] = np.nan
            out[row:row+len(z)] = z
        out.flush()
        save(d / 'metadata.json', {'transform': list(src.transform)[:6], 'crs': str(src.crs),
                                   'shape': [src.height, src.width], 'nodata': 'NaN', 'dtype': 'float32'})


def manifest():
    required = ['network/READY.json', 'grid/metadata.json', 'envcache/metadata.json', 'dem/metadata.json']
    assert all((STORE / p).is_file() for p in required), '저장소 단계 누락'
    env = json.loads((STORE / 'envcache/metadata.json').read_text(encoding='utf-8'))
    assert env['complete']
    files = {p.relative_to(STORE).as_posix(): {'sha256': sha(p), 'bytes': p.stat().st_size}
             for p in sorted(STORE.rglob('*')) if p.is_file() and p.name != 'MANIFEST.json'}
    sources = {p.name: {'sha256': sha(p), 'bytes': p.stat().st_size}
               for p in (PBF, NATIONAL / 'env_layers_national.geojson', NATIONAL / 'env_layers_national.json', NATIONAL / 'copernicus_glo30_national.tif')}
    save(STORE / 'MANIFEST.json', {'format': 1, 'source_snapshot': sources, 'national_metadata': json.loads((NATIONAL / 'env_layers_national.json').read_text(encoding='utf-8')), 'code_key': code_key(),
                                  'counts': json.loads((STORE / 'network/READY.json').read_text(encoding='utf-8')),
                                  'files': files, 'total_bytes_without_manifest': sum(v['bytes'] for v in files.values()),
                                  'created_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--stage', choices=['all', 'network', 'grid', 'envcache', 'dem', 'manifest'], default='all')
    ap.add_argument('--input-dir', type=Path, required=True)
    ap.add_argument('--output-dir', type=Path, default=CODE / 'artifacts/national')
    args = ap.parse_args()
    global ROOT, STORE, NATIONAL, PBF
    ROOT, STORE, NATIONAL, PBF = configure(args.input_dir, args.output_dir)
    ROOT.mkdir(parents=True, exist_ok=True)
    if (STORE / 'MANIFEST.json').exists():
        raise FileExistsError('완료된 store는 덮어쓰지 않습니다. 새 output-dir을 사용하세요.')
    save(ROOT / 'env_layers_national.json', json.loads((NATIONAL / 'env_layers_national.json').read_text(encoding='utf-8')))
    STORE.mkdir(exist_ok=True)
    # 한 프로세스로 순차 실행: 무거운 작업 동시 수 1. 최종 manifest가 없으면 사용 불가.
    (STORE / 'MANIFEST.json').unlink(missing_ok=True)
    times = {}
    for name, fn in [('network', network), ('grid', grid), ('envcache', envcache), ('dem', dem), ('manifest', manifest)]:
        if args.stage not in ('all', name):
            continue
        wait_ram(name)
        t = time.perf_counter()
        fn()
        times[name] = time.perf_counter()-t
        save(ROOT / ('build_' + name + '.json'), {'seconds': times[name]})
        gc.collect()
    print(json.dumps(times), flush=True)


if __name__ == '__main__':
    main()

"""현재 생성자의 정적 way 결과를 묶음 단위로 저장한다."""
import argparse
import gc
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace
import numpy as np
CODE = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(CODE))
from tools.data.national.common import save, sha, wait_ram, memory
from runway_routing.national.prep import VERSION, code_key, PreparedStore
from runway_routing.national.store import NationalStore

def encode_table(values, vocab, lookup):
    values = np.asarray(values, dtype=object)
    out = np.empty(values.shape, np.int32)
    for i, value in enumerate(values.flat):
        if value is None or (isinstance(value, (float, np.floating)) and np.isnan(value)):
            code = -1
        else:
            if type(value) is not str:
                raise TypeError(f'문자열/None 표만 지원: {type(value)}')
            if value not in lookup:
                lookup[value] = len(vocab)
                vocab.append(value)
            code = lookup[value]
        out.flat[i] = code
    return out


def chunk_net(net, start, end):
    """정적 way 생성자가 읽지 않는 좌표/참조는 빈 배열로 둬 전국 노드를 만지지 않는다."""
    p, q = int(net['tag_ptr'][start]), int(net['tag_ptr'][end])
    count = end-start
    return dict(way_ids=net['way_ids'][start:end], tag_ptr=net['tag_ptr'][start:end+1]-p,
                tag_k=net['tag_k'][p:q], tag_v=net['tag_v'][p:q],
                node_ids=np.empty(0, np.int64), lonlat=np.empty((0, 2), np.float64),
                xy=np.empty((0, 2), np.float64), ref_ptr=np.zeros(count+1, np.int32),
                ref_pos=np.empty(0, np.int32), seg_w=np.empty(0, np.int32),
                seg_a=np.empty(0, np.int64), seg_b=np.empty(0, np.int64), seg_len=np.empty(0, np.float64))


def build(root, chunk):
    from runway_routing import graph as G, network_store as N, substrate as S, array_graph as A, gate
    from runway_routing import usability_gate as UG
    store = NationalStore(root / 'store', verify=True)
    prep_path = root / 'store_prep'
    if prep_path.exists():
        raise FileExistsError('store_prep는 덮어쓰지 않습니다. 새 폴더를 사용하세요.')
    ug2 = UG.load_config(gate.UG_V1, gate.UG_V2)['v2']
    count = len(store.net['way_ids'])
    shapes = {'attrs': (count, len(G.USEFUL)), 'status': (count,), 'reason': (count,),
              'flags': (count, 4), 'table': (count, len(G.EDGE_TAGS)-1)}
    prep_path.mkdir()
    out = {k: np.lib.format.open_memmap(prep_path / f'b2_{k}.npy', mode='w+',
           dtype=np.bool_ if k == 'flags' else np.int32, shape=shape) for k, shape in shapes.items()}
    vocab, lookup = [], {}
    t0 = time.perf_counter()
    for start in range(0, count, chunk):
        wait_ram(f'prep {start}/{count}')
        end = min(count, start+chunk)
        src = N.CompactSource(chunk_net(store.net, start, end), store.strings, store.path / 'national.osm.pbf')
        sc = G.Sidecar(src)
        sub = S.Substrate(SimpleNamespace(source=src, sidecar=sc), ug2)
        arr = A.ArraySource(sub)
        out['attrs'][start:end] = sc.attrs.codes
        out['status'][start:end] = encode_table(sc.way_status, vocab, lookup)
        out['reason'][start:end] = encode_table(sc.way_reason, vocab, lookup)
        out['flags'][start:end] = np.column_stack([sub.runnable, sub.pe4, sub.pe5, sub.bridge])
        out['table'][start:end] = encode_table(arr.way_table.drop(columns='osmid').to_numpy(), vocab, lookup)
        for a in out.values():
            a.flush()
        del src, sc, sub, arr
        gc.collect()
    for a in out.values():
        a.flush()
        a._mmap.close()
    del out, a
    save(prep_path / 'b2_vocab.json', vocab)
    wait_ram('final manifest')
    files = {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)}
             for p in sorted(prep_path.iterdir()) if p.is_file()}
    save(prep_path / 'MANIFEST.json', {
        'version': VERSION, 'code_key': code_key(), 'store_manifest_sha256': sha(store.path / 'MANIFEST.json'),
        'ways': count, 'useful': G.USEFUL, 'edge_tags': G.EDGE_TAGS,
        'flags': ['runnable', 'pe4', 'pe5', 'bridge'], 'files': files,
        'build_seconds': time.perf_counter()-t0, **memory(),
        'created_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})
    PreparedStore(prep_path, store, verify=True)
    print(f'준비 자료 생성/해시 확인: {count:,} ways')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--national-dir', type=Path, default=CODE / 'artifacts/national')
    ap.add_argument('--chunk', type=int, default=8192)
    ap.add_argument('--verify', action='store_true')
    args = ap.parse_args()
    if not 1 <= args.chunk <= 32768:
        ap.error('--chunk must be 1..32768')
    if args.verify:
        store = NationalStore(args.national_dir / 'store', verify=True)
        PreparedStore(args.national_dir / 'store_prep', store, verify=True)
        print('store + store_prep 전체 해시 확인 완료')
    else:
        build(args.national_dir, args.chunk)


if __name__ == '__main__':
    main()



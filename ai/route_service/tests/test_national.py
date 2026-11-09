"""전국 원본 없이 창 선택과 현재 엔진의 준비 표 복원을 검증한다."""
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from runway_routing.national.fit import CAP_M, half_size_m, window_geometry, window_spec
from runway_routing.national.store import NationalStore, select_window
from runway_routing.national.prep import slice_arrays, way_indices


@pytest.fixture
def tiny():
    raw = json.loads((Path(__file__).parent / 'fixtures/national.json').read_text())
    return {g: {k: np.asarray(v, dtype=np.int64) for k, v in rows.items()} for g, rows in raw.items()}


def test_whole_ways_and_determinism(tiny):
    a = select_window(tiny['grid'], tiny['network'], [0])
    b = select_window(tiny['grid'], tiny['network'], [0, 0])
    assert a['ways'].tolist() == [0, 1]
    assert a['nodes'].tolist() == [0, 1, 2, 3]  # 창 밖 node 2, 3도 보존
    assert a['refs'].tolist() == [0, 1, 2, 3, 4]
    assert a['segments'].tolist() == [0, 1, 2]
    for k in a:
        np.testing.assert_array_equal(a[k], b[k])
    with pytest.raises(ValueError, match='NO_ROAD_NEARBY'):
        select_window(tiny['grid'], tiny['network'], [999])


@pytest.mark.parametrize('shape,target,expected', [
    ('loop', 3000, 3000), ('loop', 5000, 5000), ('loop', 10000, 7000),
    ('loop', 15000, 10000), ('out_and_back', 10000, 7000),
    ('loop', 21100, 13000), ('out_and_back', 21100, 13000),
    ('point_to_point', 5000, 14000), ('loop', 100000, 20000),
])
def test_fitted_size(shape, target, expected):
    assert half_size_m(shape, target, (3000, 0)) == expected


def test_midpoint_containment_and_anchor():
    assert half_size_m('point_to_point', 5000) == 20000
    assert half_size_m('point_to_point', 21100) == CAP_M
    assert window_geometry((702500, 1302500), 'point_to_point', 5000, (3000, 0)) == ((704000, 1302500), 14000)
    small = window_spec((702500, 1302500), 'loop', 5000)
    assert small.small and small.bounds == (697500, 1297500, 707500, 1307500)
    # 607: 편도는 중점 칸 기준. 직선 30 km 편도도 중점 창(반쪽 16 km)으로 끝점을 담는다.
    far = window_spec((702500, 1302500), 'point_to_point', 5000, (30000, 0))
    assert far.small and far.bounds == (701500, 1286500, 733500, 1318500)
    assert far.anchor_spec().bounds == (697500, 1282500, 737500, 1322500)
    # 21.1 km 상한의 가장 먼 편도(직선 23.71 km)도 창 안에 두 끝점이 있다.
    for end in ((23710, 0), (0, -23710), (16766, 16766)):
        w, s, e, n = window_spec((702500, 1302500), 'point_to_point', 21100, end).bounds
        for px, py in ((702500, 1302500), (702500+end[0], 1302500+end[1])):
            assert w + 250 < px < e - 250 and s + 250 < py < n - 250
    assert window_spec((702500, 1302500), 'loop', 5000, anchor=True) == small.anchor_spec()


@pytest.mark.parametrize('target', [0, -1, float('nan'), float('inf')])
def test_invalid_fitted_target(target):
    with pytest.raises(ValueError):
        half_size_m('loop', target)


def test_prep_slice():
    pos = way_indices(np.array([10, 20, 30, 40]), np.array([10, 40]))
    result = slice_arrays({'attrs': np.arange(12).reshape(4, 3)}, pos)['attrs']
    assert result.tolist() == [[0, 1, 2], [9, 10, 11]]
    assert not result.flags.writeable
    for bad in ([40, 10], [10, 10], [99]):
        with pytest.raises(ValueError):
            way_indices(np.array([10, 20, 30, 40]), np.array(bad))


def test_manifest_size_and_format_fail_before_open(tmp_path):
    p = tmp_path / 'x.npy'
    np.save(p, np.arange(3))
    m = {'format': 1, 'files': {'x.npy': {'bytes': p.stat().st_size + 1, 'sha256': ''}}}
    (tmp_path / 'MANIFEST.json').write_text(json.dumps(m))
    with pytest.raises(ValueError, match='size'):
        NationalStore(tmp_path)
    m['format'] = 999
    (tmp_path / 'MANIFEST.json').write_text(json.dumps(m))
    with pytest.raises(ValueError, match='format'):
        NationalStore(tmp_path)


@pytest.fixture
def store(tmp_path):
    from fixtures.national_store import write_store
    return NationalStore(write_store(tmp_path), verify=True)


def test_mmap_cut_and_cache_lookup(store):
    from runway_routing.national.store import WindowEnvCache
    import pandas as pd
    spec = store.spec(37.5013, 127.0396, 1000)
    a, b = store.window(spec), store.window(spec)
    assert a.fingerprints() == b.fingerprints()
    assert a.net['way_ids'].tolist() == [10, 40]
    assert a.net['node_ids'].tolist() == [1, 2, 3, 4]  # 약 9 km 바깥 node 포함
    assert a.net['seg_a'].dtype == np.int64
    assert a.net['seg_b'].dtype == np.int64
    assert isinstance(store.net['node_ids'], np.memmap)
    assert not store.net['node_ids'].flags.writeable and not a.net['xy'].flags.writeable
    cache = WindowEnvCache(a)
    dist, missing = cache.lookup(pd.DataFrame({'osm_u': [1, 3, 999], 'osm_v': [2, 2, 998], 'osmid': [10, 10, 40]}))
    assert missing.tolist() == [False, False, True]
    np.testing.assert_array_equal(dist[:2], np.arange(12).reshape(2, 6)/10)


def test_full_prep_build_slice_equals_current_constructors(store):
    from tools.data.national.build_prep import build
    from runway_routing.national.prep import PreparedStore
    from runway_routing import graph as G, substrate as S, array_graph as A, gate
    from runway_routing import usability_gate as UG
    import pandas as pd
    build(store.path.parent, 1)
    prep = PreparedStore(store.path.parent / 'store_prep', store, verify=True)
    window = store.window(store.spec(37.5013, 127.0396, 1000))
    src = window.source()
    prepared = prep.slice(store, window)
    raw, fast = G.Sidecar(src), G.Sidecar(src, prepared)
    assert list(raw.attrs) == list(fast.attrs)
    assert raw.way_status == fast.way_status and raw.way_reason == fast.way_reason
    ug2 = UG.load_config(gate.UG_V1, gate.UG_V2)['v2']
    sub0 = S.Substrate(SimpleNamespace(source=src, sidecar=raw), ug2)
    sub1 = S.Substrate(SimpleNamespace(source=src, sidecar=fast), ug2, prepared=prepared)
    for name in ('ids', 'lon', 'lat', 'xy', 'seg_w', 'seg_a', 'seg_b', 'seg_len', 'way_of_ref', 'runnable', 'pe4', 'pe5', 'bridge'):
        np.testing.assert_array_equal(getattr(sub0, name), getattr(sub1, name))
    arr0, arr1 = A.ArraySource(sub0), A.ArraySource(sub1, prepared=prepared)
    pd.testing.assert_frame_equal(arr0.way_table, arr1.way_table)
    assert arr0.status_objs == arr1.status_objs
    np.testing.assert_array_equal(arr0.status_code, arr1.status_code)


def test_invalid_start_and_p2p_end(store):
    from runway_routing.national.store import OutOfArea
    with pytest.raises(OutOfArea):
        store.spec(0, 0, 5000)
    with pytest.raises(OutOfArea):
        store.spec(37.5013, 127.0396, 5000, 'point_to_point', 0, 0)


def test_same_size_corruption_only_explicit_verify_detects(store):
    path = store.path / 'network/strings.json'
    text = path.read_text()
    path.write_text(text.replace('raw name', 'bad name'))
    # 시작 시 크기 검사와 달리 명시 검증은 같은 크기의 내용 변경도 찾는다.
    with pytest.raises(ValueError, match='해시'):
        store.verify()

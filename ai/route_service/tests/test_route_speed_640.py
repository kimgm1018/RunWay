"""S15P31E105-640: full_status Mapping과 창 segment env 조회가 원래 dict·key 조회와 같은 값을 주는지(합성 자료)."""
from types import SimpleNamespace

import numpy as np

from runway_routing import array_graph as A
from runway_routing.national.store import WindowEnvCache


def _source_and_graph(rng, n_nodes=40, n_seg=300, n_way=25):
    ids = np.sort(rng.choice(10**9, n_nodes, replace=False)).astype(np.int64)
    seg_w = rng.integers(0, n_way, n_seg)
    statuses = ["RUNNABLE", "EXCLUDED", "CONDITIONAL"]
    way_status = [statuses[i] for i in rng.integers(0, 3, n_way)]
    source = SimpleNamespace(S=SimpleNamespace(ids=ids, seg_w=seg_w))
    A.ArraySource._status_codes(source, SimpleNamespace(way_status=way_status))
    g_nodes = rng.permutation(n_nodes)                       # G 노드 순서는 위치 순서와 다르다
    G = SimpleNamespace(node_ids=ids[g_nodes], positions=g_nodes)
    G.node_index = {int(x): i for i, x in enumerate(G.node_ids)}
    g_rank = np.empty(n_nodes, np.int64)
    g_rank[g_nodes] = np.arange(n_nodes)
    a, b = rng.integers(0, n_nodes, n_seg), rng.integers(0, n_nodes, n_seg)
    sg = np.arange(n_seg)
    return source, G, g_rank, a, b, sg


def test_status_map_equals_full_status_dict():
    rng = np.random.default_rng(640)
    for _ in range(5):
        source, G, g_rank, a, b, sg = _source_and_graph(rng)
        old = A._full_status(source, a, b, sg)
        new = A._StatusMap(source, G, g_rank[a], g_rank[b], sg)
        assert new == old and len(new) == len(old) and set(new) == set(old)
        ids = G.node_ids.tolist()
        probes = list(old) + [(x, y) for x in ids[:15] for y in ids[:15]] + [(1, 2), ("x", 1), (None,)]
        for k in probes:
            assert new.get(k, "D") == old.get(k, "D"), k
            assert (k in new) == (k in old), k


def test_lookup_segments_equals_key_lookup():
    rng = np.random.default_rng(6400)
    n_nodes, n_seg = 30, 400
    ids = np.sort(rng.choice(10**9, n_nodes, replace=False)).astype(np.int64)
    seg_a, seg_b = rng.integers(0, n_nodes, n_seg), rng.integers(0, n_nodes, n_seg)
    seg_w = rng.integers(0, 10, n_seg)
    way_ids = np.sort(rng.choice(10**8, 10, replace=False)).astype(np.int64)
    dist = rng.integers(-1, 500, (n_seg, 6)).astype(np.int32)
    key = (np.minimum(ids[seg_a], ids[seg_b]), np.maximum(ids[seg_a], ids[seg_b]), way_ids[seg_w])
    for i in range(n_seg):                                     # 같은 key(같은 선분·way)는 같은 거리(실제 자료와 같음)
        same = np.flatnonzero((key[0] == key[0][i]) & (key[1] == key[1][i]) & (key[2] == key[2][i]))
        dist[i] = dist[same[0]]
    window = SimpleNamespace(net={"node_ids": ids, "seg_a": seg_a, "seg_b": seg_b, "seg_w": seg_w, "way_ids": way_ids},
                             dist_dm=dist, store=SimpleNamespace(manifest={"created_utc": "t"}))
    cache = WindowEnvCache(window)
    seg = rng.integers(0, n_seg, 200)
    import pandas as pd
    redges = pd.DataFrame({"osm_u": ids[seg_a[seg]], "osm_v": ids[seg_b[seg]], "osmid": way_ids[seg_w[seg]]})
    d1, m1 = cache.lookup(redges)
    d2, m2 = cache.lookup_segments(seg)
    assert not m1.any() and not m2.any()
    np.testing.assert_array_equal(d1, d2)
    assert d1.dtype == d2.dtype

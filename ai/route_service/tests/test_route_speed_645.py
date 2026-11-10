"""S15P31E105-645: 생성 disk·요청 graph의 빠른 경로가 기존 식과 같은 배열을 주는지(합성 자료)."""
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from runway_routing import array_graph as A
from runway_routing import array_pair_kernels as K
from runway_routing import graph as Gm

pytestmark = pytest.mark.skipif(K.njit is None, reason="Numba 없음: 기존 식만 쓴다")


def test_first_rank_equals_unique_argsort():
    rng = np.random.default_rng(645)
    for size, n in ((0, 5), (1, 3), (50, 10), (5000, 300), (20000, 20000)):
        flat = rng.integers(0, n, size).astype(np.int64)
        nodes, first = np.unique(flat, return_index=True)
        want = np.full(n, -1, np.int64)
        want[nodes[np.argsort(first)]] = np.arange(len(nodes))
        rank, vals = K.first_rank(flat, n)
        assert np.array_equal(rank, want) and rank.dtype == want.dtype
        assert np.array_equal(vals, nodes[np.argsort(first)]) and vals.dtype == np.int64


def test_shortest_per_key_equals_unique_lexsort():
    rng = np.random.default_rng(6451)
    for size, nk in ((1, 1), (40, 5), (3000, 200), (20000, 3000)):
        key = rng.integers(0, nk, size).astype(np.int64) * 7919
        lengths = rng.choice([0.0, -0.0, 1.5, 2.25, 2.25, 3.0, 10.0], size)   # 같은 길이(동점)가 많다
        _, first = np.unique(key, return_index=True)
        by = np.lexsort((np.arange(size), lengths, key))
        best = by[np.r_[True, key[by][1:] != key[by][:-1]]]
        f, b = K.shortest_per_key(key, lengths)
        assert np.array_equal(f, first) and np.array_equal(b, best)
    assert K.shortest_per_key(np.array([1, 1], np.int64), np.array([np.nan, 1.0])) is None   # NaN이면 기존 식


def test_adapter_first_equals_lexsort():
    rng = np.random.default_rng(6452)
    n_nodes, n_way, n_seg = 60, 9, 400
    seg_a = rng.integers(0, n_nodes, n_seg).astype(np.int64)
    seg_b = rng.integers(0, n_nodes, n_seg).astype(np.int64)
    seg_w = rng.integers(0, n_way, n_seg).astype(np.int32)
    seg_b[:40] = seg_a[40:80]            # 같은 (lo, hi, way) 묶음을 일부러 만든다
    seg_a[:40] = seg_b[40:80]
    seg_w[:40] = seg_w[40:80]
    S = SimpleNamespace(ids=np.arange(n_nodes) * 10 + 3, seg_a=seg_a, seg_b=seg_b, seg_w=seg_w,
                        sc=SimpleNamespace(way_ids=list(range(n_way))))
    for _ in range(5):
        chosen = rng.choice(n_seg, 250, replace=False)
        g_seg = rng.permutation(np.r_[chosen, chosen])            # segment마다 정·역방향 두 간선, 섞인 G 순서
        rev = np.zeros(len(g_seg), bool)
        seen = set()
        for i, s in enumerate(g_seg):
            rev[i] = s in seen
            seen.add(s)
        G = object.__new__(A.ArrayG)
        G.seg = g_seg
        G.a = np.where(rev, seg_b[g_seg], seg_a[g_seg])
        G.b = np.where(rev, seg_a[g_seg], seg_b[g_seg])
        ways = seg_w[g_seg]
        lo, hi = np.minimum(G.a, G.b), np.maximum(G.a, G.b)
        o = np.lexsort((ways, hi, lo))
        start = np.ones(len(o), bool)
        start[1:] = (lo[o][1:] != lo[o][:-1]) | (hi[o][1:] != hi[o][:-1]) | (ways[o][1:] != ways[o][:-1])
        assert np.array_equal(G._adapter_first(S), np.sort(o[start]))


def _redges(rng, n):
    hw = ["footway", "path", "residential", "primary", "primary_link", "service", "track", "steps", "cycleway",
          "living_street", "secondary", "tertiary_link", "unclassified", "pedestrian", "", None]
    fw = ["sidewalk", "crossing", "traffic_island", "access_aisle", "yes", None]
    tun = ["yes", "no", "building_passage", "culvert", None]
    br = ["yes", "no", None]
    pick = lambda xs: [xs[i] for i in rng.integers(0, len(xs), n)]
    e = pd.DataFrame({"highway": pd.array(pick(hw), dtype="str"), "footway": pd.array(pick(fw), dtype="str"),
                      "tunnel": pd.array(pick(tun), dtype="str"), "bridge": pd.array(pick(br), dtype="str"),
                      "length": rng.random(n) * 100, "u": rng.integers(0, 50, n), "osmid": rng.integers(1, 9, n),
                      "recovered": np.zeros(n, bool)})
    for f in Gm.ENV_FLAGS[:3]:
        e[f] = rng.random(n) < 0.5
    return e


@pytest.mark.parametrize("n", [0, 1, 7, 3000])
def test_prepare_edge_arrays_same(monkeypatch, n):
    e = _redges(np.random.default_rng(n), n)
    g_old, g_new = SimpleNamespace(redges=e), SimpleNamespace(redges=e)
    monkeypatch.setattr(Gm, "FAST_EDGE_ARRAYS", False)
    Gm.prepare_edge_arrays(g_old)
    monkeypatch.setattr(Gm, "FAST_EDGE_ARRAYS", True)
    Gm.prepare_edge_arrays(g_new)
    assert list(g_old.ea) == list(g_new.ea)
    for k in g_old.ea:
        x, y = g_old.ea[k], g_new.ea[k]
        assert x.dtype == y.dtype and np.array_equal(x, y), k

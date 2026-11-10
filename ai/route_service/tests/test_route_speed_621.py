"""S15P31E105-621 결과 동일성 테스트(데이터 불필요).

A*      shortest_path_numba.astar가 bidirectional과 같은 경로를 고른다(동점이 있는 격자 graph 포함, 동점이면 bidirectional로 다시 찾음).
unique  fast_unique.sorted_unique가 np.unique와 같은 값·dtype이다.
"""
import itertools
from types import SimpleNamespace

import networkx as nx
import numpy as np
import pytest

from runway_routing import shortest_path_numba as native
from runway_routing.fast_unique import sorted_unique
from runway_routing.graph import RouteCSR


def _csr(H):
    return RouteCSR(SimpleNamespace(H=H))


def _xy(csr, pos):
    return np.array([pos[n] for n in csr.ids], dtype=np.float64)


def _check_all_pairs(csr, xy, rng, rounds=3):
    n, m = len(csr.ids), len(csr.length)
    for _ in range(rounds):
        mult = rng.choice([0.4, 0.7, 1.0, 1.0, 1.0, 1.6, 4.0], size=m)
        used = rng.integers(0, 3, size=m).astype(np.int64)
        for s in range(n):
            for t in range(n):
                expected = native.bidirectional(csr, s, t, mult, used, 4.0)
                actual = native.astar(csr, xy, s, t, mult, used, 4.0, float(mult.min()))
                assert actual == expected, (s, t)


def test_astar_equals_bidirectional_on_random_geometric_graphs():
    rng = np.random.default_rng(621)
    for g in range(6):
        pos = {i: (float(x), float(y)) for i, (x, y) in enumerate(rng.uniform(0, 1000, size=(40, 2)))}
        H = nx.Graph()
        H.add_nodes_from(pos)
        for a, b in itertools.combinations(pos, 2):
            d = float(np.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]))
            if d < 260:
                H.add_edge(a, b, length=d * float(rng.uniform(1.0, 1.4)))   # road length >= straight line
        csr = _csr(H)
        _check_all_pairs(csr, _xy(csr, pos), rng, rounds=2)


def test_astar_ties_on_grid_match_bidirectional():
    """격자: 길이가 같은 경로가 많다. A*가 동점을 보면 bidirectional로 다시 찾으므로 결과가 같아야 한다."""
    rng = np.random.default_rng(1)
    k = 6
    pos = {i * k + j: (100.0 * i, 100.0 * j) for i in range(k) for j in range(k)}
    for order in range(3):
        H = nx.Graph()
        nodes = list(pos)
        rng.shuffle(nodes)
        H.add_nodes_from(nodes)
        edges = [(a, b) for a in pos for b in pos if a < b and abs(pos[a][0] - pos[b][0]) + abs(pos[a][1] - pos[b][1]) == 100.0]
        rng.shuffle(edges)
        H.add_edges_from((a, b, {"length": 100.0}) for a, b in edges)
        csr = _csr(H)
        xy = _xy(csr, pos)
        mult, used = np.ones(len(csr.length)), np.zeros(len(csr.length), np.int64)
        for s in range(len(csr.ids)):
            for t in range(len(csr.ids)):
                assert native.astar(csr, xy, s, t, mult, used, 4.0, 1.0) == native.bidirectional(csr, s, t, mult, used, 4.0)
        _check_all_pairs(csr, xy, rng, rounds=1)


def test_astar_unreachable_same_node_and_negative_penalty():
    H = nx.Graph()
    H.add_nodes_from(range(4))
    H.add_edge(0, 1, length=1.0)
    H.add_edge(1, 2, length=1.0)
    csr = _csr(H)
    xy = np.array([[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [5.0, 5.0]])
    mult, used = np.ones(2), np.zeros(2, np.int64)
    assert native.astar(csr, xy, 0, 3, mult, used, 4.0, 1.0) is None
    assert native.astar(csr, xy, 2, 2, mult, used, 4.0, 1.0) == [2]
    assert native.astar(csr, xy, 0, 2, mult, used, -0.5, 1.0) == native.bidirectional(csr, 0, 2, mult, used, -0.5)


@pytest.mark.parametrize("dtype", [np.int32, np.int64, np.uint32, np.bool_])
def test_sorted_unique_equals_np_unique(dtype):
    rng = np.random.default_rng(7)
    for n in (0, 1, 2, 17, 5000):
        a = rng.integers(0, 50 if dtype is not np.bool_ else 2, size=n).astype(dtype)
        got, want = sorted_unique(a), np.unique(a)
        assert got.dtype == want.dtype and np.array_equal(got, want)
    f = rng.normal(size=100)
    assert np.array_equal(sorted_unique(f), np.unique(f))   # not integer: np.unique itself

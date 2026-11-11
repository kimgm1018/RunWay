"""S15P31E105-626 결과 동일성 테스트(데이터 불필요).

gate     gate._Incident가 usability_gate.build_context의 incident(node)와 같은 목록·순서·타입이다.
routing  graph._routing_rows + _PairIndex가 _build_routing의 pandas 처리·pair_to_eid dict와 같다.
length   candidates.path_length(A*)가 기존 Python Dijkstra와 같은 값(bit 단위)이다.
"""
import itertools
from types import SimpleNamespace

import networkx as nx
import numpy as np
import pandas as pd
import pytest

from runway_routing import candidates, gate, graph, shortest_path
from runway_routing import usability_gate as UG
from runway_routing.data import RUNNABLE


def test_incident_equals_build_context_adj():
    rng = np.random.default_rng(626)
    for _ in range(5):
        n = 400
        u = rng.integers(1_000_000_000, 1_000_000_060, n)
        v = rng.integers(1_000_000_000, 1_000_000_060, n)   # self loops and repeats included
        w = rng.integers(10**9, 10**9 + 20, n)
        old = UG.build_context({}, {}, zip(u, v, w), None)
        inc = gate._Incident(u, v, w)
        for node in list(range(999_999_995, 1_000_000_065)) + [None, "x", 1.5]:
            assert inc(node) == old.incident(node), node
        for node in set(u.tolist()):
            got = inc(np.int64(node))
            assert got == old.incident(node)
            assert all(type(a) is int and type(b) is int for a, b in got)


def _edges(rng, n_nodes, n_edges):
    u = rng.integers(0, n_nodes, n_edges)
    v = rng.integers(0, n_nodes, n_edges)
    lo, hi = np.minimum(u, v), np.maximum(u, v)
    status = rng.choice([RUNNABLE, "EXCLUDED", "CONDITIONAL"], n_edges, p=[0.7, 0.2, 0.1])
    length = rng.choice([1.0, 2.5, 2.5, 7.0, 0.05], n_edges) + rng.integers(0, 3, n_edges)  # many equal lengths
    return pd.DataFrame({"highway": rng.choice(["footway", "residential", None], n_edges), "osmid": rng.integers(1, 9, n_edges),
                         "runway_status": status, "u": lo.astype(np.int64), "v": hi.astype(np.int64),
                         "length": length.astype(float), "recovered": False})


def _old_routing(e):
    run = e[e["runway_status"] == RUNNABLE].copy()
    run = run.sort_values("length").drop_duplicates(["u", "v"], keep="first")
    return run.sort_values(["u", "v"]).reset_index().rename(columns={"index": "all_idx"})


def test_routing_rows_and_pair_index_equal_pandas_and_dict():
    rng = np.random.default_rng(7)
    for n_nodes, n_edges in ((30, 200), (300, 2000), (5, 40)):
        e = _edges(rng, n_nodes, n_edges)
        want = _old_routing(e)
        got = e.take(graph._routing_rows(e)).reset_index().rename(columns={"index": "all_idx"})
        pd.testing.assert_frame_equal(got, want)
        u, v = want["u"].to_numpy(), want["v"].to_numpy()
        d = {(int(a), int(b)): i for i, (a, b) in enumerate(zip(u, v))}
        p = graph._PairIndex(u, v, n_nodes)
        assert len(p) == len(d)
        for a, b in itertools.product(range(-1, n_nodes + 1), repeat=2):
            assert p.get((a, b)) == d.get((a, b)), (a, b)
            assert p.get((np.int64(a), np.int64(b))) == d.get((a, b))


def test_routing_rows_falls_back_on_nan_or_other_index():
    e = _edges(np.random.default_rng(3), 20, 50)
    e.loc[3, "length"] = np.nan
    assert graph._routing_rows(e) is None
    e2 = _edges(np.random.default_rng(3), 20, 50)
    e2.index = e2.index + 5
    assert graph._routing_rows(e2) is None


@pytest.mark.skipif(not shortest_path.ASTAR, reason="numba A* off")
def test_path_length_astar_equals_dijkstra():
    rng = np.random.default_rng(626)
    for g in range(4):
        pos = {i: (float(x), float(y)) for i, (x, y) in enumerate(rng.uniform(0, 1000, size=(45, 2)))}
        H = nx.Graph()
        H.add_nodes_from(pos)
        for a, b in itertools.combinations(pos, 2):
            d = float(np.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]))
            if d < 250:
                H.add_edge(a, b, length=d * float(rng.uniform(1.0, 1.3)))
        csr = graph.RouteCSR(SimpleNamespace(H=H))
        xy = np.array([pos[n] for n in csr.ids], dtype=np.float64)
        rg = SimpleNamespace(H=SimpleNamespace(csr=csr, xy=xy), _route_csr=csr)
        for s, t in itertools.product(list(pos)[:15], list(pos)):
            try:
                want = nx.shortest_path_length(H, s, t, weight="length")
            except nx.NetworkXNoPath:
                with pytest.raises(nx.NetworkXNoPath):
                    candidates.path_length(rg, s, t)
                continue
            got = candidates.path_length(rg, s, t)
            assert type(got) is type(want) and float(got).hex() == float(want).hex(), (s, t)

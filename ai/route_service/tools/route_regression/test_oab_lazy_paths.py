"""OAB 반환점 탐색의 지연 경로(RUNWAY_OAB_LAZY_PATHS=1)가 예전 전체 경로 dict 방식(=0)과 bit 단위로 같은지(합성 graph).

비교: (1) pred 트리 → 경로 복원이 single_source_paths와 같은 dict(key 순서·원소까지), (2) 트리 길이가 _tree_lengths와
float.hex까지 같음(key 순서 포함), (3) oab_candidates 출력(반환점·sector·attempt·경로·half_m)이 플래그 켬/끔에서 같음,
(4) sum() probe가 거짓일 때의 폴백도 같음. graph 종류: 무작위 실수 길이, 동점이 많은 격자, 끊긴 graph, cutoff 경계(정수 길이),
Neumaier 보정이 값을 바꾸는 큰 수 간선. 실제 disk 결과는 교육장 golden(tools/route_regression)이 확인한다."""
import random
import unittest
from types import SimpleNamespace
from unittest import mock

import networkx as nx

from runway_routing import candidates, graph

SEEDS = range(12)
CUTOFFS = (3.0, 7.5, 1e9)
CFG = {"oab_window": {"value": 0.25}, "oab_sectors": {"value": 12},
       "oab_turnaround_min_degree": {"value": 3}, "attempts": {"value": 24}}


def _rg(H):
    rg = SimpleNamespace(H=H)
    rg._route_csr = graph.RouteCSR(rg)
    return rg


def _xy(H, r):
    for n in H:
        H.nodes[n].setdefault("x", r.uniform(-50.0, 50.0))
        H.nodes[n].setdefault("y", r.uniform(-50.0, 50.0))
    return H


def _random_graph(seed):
    r = random.Random(seed)
    H = nx.gnm_random_graph(150, 420, seed=seed)
    for u, v in H.edges:
        H[u][v]["length"] = r.random() * 4.0 + 1e-3
    return _xy(H, r)


def _tie_grid(seed):
    """동점 경로가 아주 많은 격자: 길이 1.0 / 2.0 / 0.1+0.2 뿐."""
    r = random.Random(seed)
    G = nx.grid_2d_graph(11, 11)
    H = nx.Graph()
    for (a, b), (c, d) in G.edges:
        H.add_edge(a * 11 + b, c * 11 + d, length=r.choice([1.0, 1.0, 2.0, 0.1 + 0.2]))
    for (a, b) in G.nodes:
        H.nodes[a * 11 + b]["x"], H.nodes[a * 11 + b]["y"] = float(a), float(b)
    return H


def _disconnected(seed):
    """두 덩어리 + 고립 node. 출발점 쪽 덩어리만 도달한다."""
    r = random.Random(seed)
    H = nx.disjoint_union(nx.gnm_random_graph(40, 90, seed=seed), nx.gnm_random_graph(30, 60, seed=seed + 1000))
    for u, v in H.edges:
        H[u][v]["length"] = r.choice([0.5, 1.5, r.uniform(0.2, 3.0)])
    H.add_node(500)
    H.add_node(501)
    return _xy(H, r)


def _int_lengths(seed):
    """정수 길이: cutoff와 정확히 같은 거리가 많아 `> cutoff` 경계(같으면 포함)를 시험한다."""
    r = random.Random(seed)
    H = nx.gnm_random_graph(90, 260, seed=seed)
    for u, v in H.edges:
        H[u][v]["length"] = float(r.randint(1, 3))
    return _xy(H, r)


def _big_small(seed):
    """1e16 간선 뒤 작은 간선: 단순 누적합과 sum()(Neumaier)이 다른 경우."""
    r = random.Random(seed)
    H = nx.Graph()
    H.add_edge(0, 1, length=1e16)
    for k in range(2, 40):
        H.add_edge(r.randrange(1, k), k, length=r.choice([1.0, 0.1, 1e-3, 3.3]))
    return _xy(H, r)


FAMILIES = {"random": _random_graph, "tie_grid": _tie_grid, "disconnected": _disconnected,
            "int_cutoff": _int_lengths, "big_small": _big_small}


def _mult(rg, seed):
    r = random.Random(seed * 31 + 7)
    return {k: r.choice([0.4, 1.0, 1.7, 4.0]) for k in rg._route_csr.keys if r.random() < 0.4}


def _hex(d):
    return [(n, v.hex()) for n, v in d.items()]


def _cases():
    for name, make in FAMILIES.items():
        for seed in SEEDS:
            H = make(seed)
            rg = _rg(H)
            for mult in ({}, _mult(rg, seed)):
                for cutoff in CUTOFFS + ((2.0, 4.0) if name == "int_cutoff" else ()):
                    yield name, seed, rg, mult, cutoff


class LazyTreeEqualsFullPaths(unittest.TestCase):
    def test_tree_paths_and_lengths_bit_identical(self):
        n = 0
        for name, seed, rg, mult, cutoff in _cases():
            start = next(iter(rg.H))
            with self.subTest(family=name, seed=seed, cutoff=cutoff, mult=bool(mult)):
                want = candidates.single_source_paths(rg, start, cutoff, mult)
                order, parent = candidates.single_source_tree(rg, start, cutoff, mult)
                self.assertEqual(order, list(want))                       # pop 순서 = key 순서
                got = candidates._paths_from_tree(order, parent)
                self.assertEqual(list(got), list(want))
                self.assertEqual(got, want)
                for t, p in want.items():
                    q = candidates.path_from_tree(parent, start, t)
                    self.assertEqual(q, p)
                    self.assertEqual([type(x) for x in q], [type(x) for x in p])
                self.assertEqual(_hex(candidates._parent_tree_lengths(rg, order, parent)),
                                 _hex(candidates._tree_lengths(rg, want)))
                n += 1
        self.assertGreaterEqual(n, len(FAMILIES) * len(SEEDS) * 2 * len(CUTOFFS))

    def test_fallback_without_sum_probe_is_identical(self):
        for name, seed, rg, mult, cutoff in _cases():
            if seed > 3:
                continue
            start = next(iter(rg.H))
            with self.subTest(family=name, seed=seed, cutoff=cutoff), \
                    mock.patch.object(candidates, "_SUM_STEPS_EXACT", False):
                want = candidates.single_source_paths(rg, start, cutoff, mult)
                order, parent = candidates.single_source_tree(rg, start, cutoff, mult)
                self.assertEqual(_hex(candidates._parent_tree_lengths(rg, order, parent)),
                                 _hex(candidates._tree_lengths(rg, want)))

    def test_missing_start_raises_like_before(self):
        rg = _rg(_random_graph(0))
        with self.assertRaises(nx.NodeNotFound):
            candidates.single_source_paths(rg, -1, 5.0, {})
        with self.assertRaises(nx.NodeNotFound):
            candidates.single_source_tree(rg, -1, 5.0, {})


class OabCandidatesFlagParity(unittest.TestCase):
    def _run(self, rg, start, target, seed, mult, forbidden, lazy, exact=True):
        with mock.patch.object(candidates, "_array_rg", lambda _rg: True), \
                mock.patch.object(candidates, "OAB_LAZY_PATHS", lazy), \
                mock.patch.object(candidates, "_SUM_STEPS_EXACT", exact):
            return candidates.oab_candidates(rg, start, target, seed, CFG, mult=mult, forbidden=forbidden)

    def _assert_same(self, a, b):
        self.assertEqual(a, b)
        for x, y in zip(a, b):
            self.assertEqual(x["half_m"].hex(), y["half_m"].hex())
            self.assertEqual([type(v) for v in x["path"]], [type(v) for v in y["path"]])

    def test_flag_on_off_identical(self):
        n_cases = n_cands = 0
        for name, make in FAMILIES.items():
            for seed in SEEDS:
                H = make(seed)
                rg = _rg(H)
                nodes = list(H)
                r = random.Random(seed)
                for mult in ({}, _mult(rg, seed)):
                    for target in (4.0, 9.0, 15.0):
                        start = r.choice(nodes)
                        forbidden = set(r.sample(nodes, 5))
                        with self.subTest(family=name, seed=seed, target=target, mult=bool(mult)):
                            new = self._run(rg, start, target, seed, mult, forbidden, True)
                            old = self._run(rg, start, target, seed, mult, forbidden, False)
                            self._assert_same(new, old)
                            if seed < 3:   # sum() probe 폴백 경로
                                self._assert_same(self._run(rg, start, target, seed, mult, forbidden, True, False),
                                                  self._run(rg, start, target, seed, mult, forbidden, False, False))
                        n_cases += 1
                        n_cands += len(new)
        self.assertGreater(n_cands, n_cases)   # 반환점이 실제로 많이 뽑혔다(빈 결과끼리만 비교한 것이 아님)


if __name__ == "__main__":
    unittest.main()

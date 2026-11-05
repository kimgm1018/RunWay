"""Exact component metadata against NetworkX 3.7 (stdlib unittest runner)."""
import itertools
from pathlib import Path
import random
import sys
from types import SimpleNamespace
import unittest

import networkx as nx
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def ordered_csr(graph):
    """Independent fixture adapter: preserve the graph's node/neighbor order."""
    ids = list(graph)
    index = {n: i for i, n in enumerate(ids)}
    keys = list(graph.edges)
    edge_index = {frozenset(k): i for i, k in enumerate(keys)}
    ptr, nbr, ned = [0], [], []
    for n in ids:
        for neighbor in graph[n]:
            nbr.append(index[neighbor])
            ned.append(edge_index[frozenset((n, neighbor))])
        ptr.append(len(nbr))
    return SimpleNamespace(ids=ids, index=index, keys=keys, ptr=ptr,
                           nbr=nbr, ned=ned,
                           length=[graph[u][v]["length"] for u, v in keys])


def canonical_layout(graph):
    raw = list(nx.connected_components(graph))
    lengths = [sum(d["length"] for *_, d in graph.subgraph(c).edges(data=True))
               for c in raw]
    order = sorted(range(len(raw)), key=lambda i: -lengths[i])
    return ({n: i for i, j in enumerate(order) for n in raw[j]},
            [lengths[j] / 1000 for j in order])


class ComponentLayout(unittest.TestCase):
    def assert_layout(self, graph):
        from runway_routing.array_components import component_layout, component_layout_fast
        expected_comp, expected_km = canonical_layout(graph)
        csr = ordered_csr(graph)
        comp, km = component_layout(csr)
        self.assertEqual(list(comp.items()), list(expected_comp.items()))
        self.assertEqual(km, expected_km)
        # S15P31E105-437 Numba 경로: 같은 item 순서, float bit, node index별 component 번호
        comp_f, km_f, comp_idx = component_layout_fast(
            csr, np.array(csr.ptr, np.int64), np.array(csr.nbr, np.int64), np.array(csr.ned, np.int64),
            np.array(csr.length, np.float64))
        self.assertEqual(list(comp_f.items()), list(expected_comp.items()))
        self.assertEqual([x.hex() for x in km_f], [x.hex() for x in expected_km])
        self.assertEqual([type(x) for x in km_f], [type(x) for x in expected_km])
        self.assertEqual(comp_idx.tolist(), [expected_comp[n] for n in csr.ids])

    def test_fast_path_is_active(self):
        from runway_routing import array_components
        self.assertTrue(array_components.FAST_OK, "Numba component sums differ from builtins.sum or Numba missing")

    def test_empty_isolated_and_stable_equal_length_components(self):
        from runway_routing.array_components import component_layout
        self.assertEqual(component_layout(ordered_csr(nx.Graph())), ({}, []))
        self.assert_layout(nx.Graph())
        graph = nx.Graph()
        graph.add_nodes_from([65, 1, 129, 2, 257])
        graph.add_edge(65, 1, length=1000.0)
        graph.add_edge(129, 2, length=1000.0)
        self.assert_layout(graph)
        self.assertEqual(component_layout(ordered_csr(graph))[1], [1.0, 1.0, 0.0])

    def test_node_and_edge_insertion_permutations_with_self_loop(self):
        edges = [(65, 1, 0.1), (1, 129, 1e16), (129, 65, 1.0), (1, 1, 0.25)]
        for nodes in itertools.permutations([65, 1, 129]):
            for ordered_edges in itertools.permutations(edges):
                graph = nx.Graph()
                graph.add_nodes_from(nodes)
                graph.add_weighted_edges_from(ordered_edges, weight="length")
                with self.subTest(nodes=nodes, edges=ordered_edges):
                    self.assert_layout(graph)

    def test_small_half_and_large_components_with_float_sum_order(self):
        rng = random.Random(7183)
        # Hash collisions exercise BFS-set growth and subgraph's fresh set.
        ids = [1 + 32 * i for i in range(40)]
        lengths = [1e16, 0.1, 1.0, 1.125, 2.0, 1e-12]
        for size in [3, 19, 20, 21, 39, 40]:
            for trial in range(30):
                nodes = ids[:]
                rng.shuffle(nodes)
                edges = [(ids[i - 1], ids[i], rng.choice(lengths)) for i in range(1, size)]
                edges.extend((ids[i], ids[i], rng.choice(lengths)) for i in range(size))
                edges.extend((ids[i], ids[(i + 3) % size], rng.choice(lengths))
                             for i in range(size))
                rng.shuffle(edges)
                graph = nx.Graph()
                graph.add_nodes_from(nodes)
                graph.add_weighted_edges_from(edges, weight="length")
                with self.subTest(size=size, trial=trial):
                    self.assert_layout(graph)

    def test_compensated_sums_many_components(self):
        # 보정 합이 단순 누적과 달라지는 길이(1e16, 0.1, 1e-12 ...)와 길이 0 component(int 0), 동점 component 정렬
        rng = random.Random(437)
        lengths = [1e16, 0.1, 0.2, 0.3, 1.0, 1e-12, 7.25, 1e300, 2.0 ** -40]
        for trial in range(60):
            graph = nx.Graph()
            nodes = [rng.randrange(1, 10 ** 11) for _ in range(rng.randrange(1, 90))]
            graph.add_nodes_from(nodes)
            for _ in range(rng.randrange(0, 160)):
                a, b = rng.choice(nodes), rng.choice(nodes)
                graph.add_edge(a, b, length=rng.choice(lengths))
            with self.subTest(trial=trial):
                self.assert_layout(graph)


if __name__ == "__main__":
    unittest.main()

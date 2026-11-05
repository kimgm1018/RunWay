"""Exact component metadata against NetworkX 3.7 (stdlib unittest runner)."""
import itertools
from pathlib import Path
import random
import sys
from types import SimpleNamespace
import unittest

import networkx as nx

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
        from runway_routing.array_components import component_layout
        expected_comp, expected_km = canonical_layout(graph)
        comp, km = component_layout(ordered_csr(graph))
        self.assertEqual(list(comp.items()), list(expected_comp.items()))
        self.assertEqual(km, expected_km)

    def test_empty_isolated_and_stable_equal_length_components(self):
        from runway_routing.array_components import component_layout
        self.assertEqual(component_layout(ordered_csr(nx.Graph())), ({}, []))
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


if __name__ == "__main__":
    unittest.main()

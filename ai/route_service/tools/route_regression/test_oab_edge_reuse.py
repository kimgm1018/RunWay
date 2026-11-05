"""OAB 실제 거리 트리 누적과 ArrayG 간선 조회 재사용 계약 테스트(stdlib unittest)."""
from types import SimpleNamespace
import unittest

import networkx as nx
import numpy as np


def _per_path(rg, paths):
    from runway_routing import candidates
    return {n: candidates.length(rg, p) for n, p in paths.items()}


class OabTreeLengths(unittest.TestCase):
    def test_sum_probe_holds_on_this_interpreter(self):
        from runway_routing import candidates
        self.assertTrue(candidates._SUM_STEPS_EXACT)

    def test_bit_identical_where_plain_prefix_sum_differs(self):
        from runway_routing import candidates
        H = nx.Graph()
        H.add_edge(0, 1, length=1e16)
        H.add_edge(1, 2, length=1.0)
        H.add_edge(2, 3, length=1.0)
        H.add_edge(1, 4, length=0.1)
        rg = SimpleNamespace(H=H)
        _, paths = nx.single_source_dijkstra(H, 0, weight="length")
        got, ref = candidates._tree_lengths(rg, paths), _per_path(rg, paths)
        self.assertEqual(list(got), list(ref))
        self.assertEqual([v.hex() for v in got.values()], [v.hex() for v in ref.values()])
        self.assertNotEqual((1e16 + 1.0) + 1.0, got[3])   # 단순 누적합이면 틀린다
        self.assertEqual(got[0], 0.0)

    def test_random_graphs_with_multipliers(self):
        import random
        from runway_routing import candidates
        rnd = random.Random(7)
        for seed in range(15):
            H = nx.gnm_random_graph(120, 360, seed=seed)
            for u, v in H.edges:
                H[u][v]["length"] = rnd.random() * 250.0
            mult = {(min(u, v), max(u, v)): rnd.choice([0.6, 1.0, 2.4]) for u, v in H.edges}
            _, paths = nx.single_source_dijkstra(H, 0, cutoff=600.0,
                                                 weight=lambda u, v, d: d["length"] * mult[(min(u, v), max(u, v))])
            rg = SimpleNamespace(H=H)
            got, ref = candidates._tree_lengths(rg, paths), _per_path(rg, paths)
            self.assertEqual([v.hex() for v in got.values()], [v.hex() for v in ref.values()])

    def test_non_float_lengths_fall_back_to_per_path_sum(self):
        from runway_routing import candidates
        H = nx.Graph()
        H.add_edge(0, 1, length=np.float64(0.1))
        H.add_edge(1, 2, length=np.float64(0.2))
        rg = SimpleNamespace(H=H)
        _, paths = nx.single_source_dijkstra(H, 0, weight="length")
        self.assertEqual(candidates._tree_lengths(rg, paths), _per_path(rg, paths))


class ArrayEdgeLookupReuse(unittest.TestCase):
    def _graph(self, table):
        from runway_routing.array_graph import ArrayG, _MISSING
        G = ArrayG.__new__(ArrayG)
        G._edge_lookup = {}
        calls = []

        def find(a, b):
            calls.append((a, b))
            return table.get((a, b), _MISSING)
        G._find_edge_data = find
        return G, calls

    def test_found_pair_is_looked_up_once_and_reused(self):
        data = {0: {"osmid": 5, "runway_status": "RUNNABLE"}, 1: {"osmid": 6, "runway_status": "EXCLUDED"}}
        G, calls = self._graph({(1, 2): data})
        first = G.get_edge_data(1, 2)
        self.assertIs(first, data)
        self.assertIs(G.get_edge_data(np.int64(1), np.int64(2), default="x"), data)
        self.assertEqual(calls, [(1, 2)])

    def test_missing_pair_returns_each_calls_default(self):
        G, calls = self._graph({})
        marker = object()
        self.assertIsNone(G.get_edge_data(3, 4))
        self.assertIs(G.get_edge_data(3, 4, marker), marker)
        empty = {}
        self.assertIs(G.get_edge_data(3, 4, default=empty), empty)
        self.assertEqual(calls, [(3, 4)])

    def test_direction_matters(self):
        G, calls = self._graph({(1, 2): {0: {}}})
        self.assertIsNone(G.get_edge_data(2, 1))
        self.assertEqual(G.get_edge_data(1, 2), {0: {}})
        self.assertEqual(calls, [(2, 1), (1, 2)])


if __name__ == "__main__":
    unittest.main()

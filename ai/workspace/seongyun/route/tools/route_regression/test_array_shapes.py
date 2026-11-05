"""H21 B3: OAB/P2P 배열 경로의 Dijkstra 이식이 networkx와 같은 결과(동점 경로, cutoff, 경로 없음)를 내는지(합성 graph).

실제 disk 비교는 reports/route_opt_round3_2026-11-03/h21/b3_parity.py가 한다."""
import random
import unittest
from types import SimpleNamespace

import networkx as nx

from runway_routing import candidates, graph


def _rg(H):
    """networkx H의 RouteCSR(H._adj 순서)만 가진 rg. candidates의 배열 경로는 rg._route_csr만 읽는다."""
    rg = SimpleNamespace(H=H)
    rg._route_csr = graph.RouteCSR(rg)
    return rg


def _graph(seed, n=60, p=0.12, tie=True):
    r = random.Random(seed)
    H = nx.Graph()
    for u in range(n):
        for v in range(u + 1, n):
            if r.random() < p:
                # 같은 길이를 많이 만들어 동점 처리(heap counter 순서)를 시험한다
                H.add_edge(u, v, length=float(r.choice([1.0, 2.0, 2.5, 0.1 + 0.2])) if tie else r.uniform(0.5, 9.0))
    H.add_node(n + 1)    # 고립 node: 경로 없음
    return H


class DijkstraPort(unittest.TestCase):
    def test_single_source_paths_equal_networkx(self):
        for seed in range(30):
            H = _graph(seed, tie=seed % 3 != 0)
            rg = _rg(H)
            keys = list(rg._route_csr.keys)
            r = random.Random(seed)
            mult = {k: r.choice([0.4, 1.0, 1.7, 4.0]) for k in keys if r.random() < 0.4}
            src = next(iter(H))
            for cutoff in (2.0, 5.5, 1e9):
                def w(u, v, d):
                    return d["length"] * mult.get(candidates.rrg._key(u, v), 1.0)
                _, want = nx.single_source_dijkstra(H, src, cutoff=cutoff, weight=w)
                got = candidates.single_source_paths(rg, src, cutoff, mult)
                self.assertEqual(list(want), list(got))            # key 순서(pop 순서)까지
                self.assertEqual(want, got)

    def test_path_length_equal_networkx(self):
        for seed in range(30):
            H = _graph(seed)
            rg = _rg(H)
            nodes = list(H)
            r = random.Random(seed)
            for _ in range(15):
                s, t = r.choice(nodes), r.choice(nodes)
                try:
                    want = nx.shortest_path_length(H, s, t, weight="length")
                except nx.NetworkXNoPath:
                    with self.assertRaises(nx.NetworkXNoPath):
                        candidates.path_length(rg, s, t)
                    continue
                got = candidates.path_length(rg, s, t)
                self.assertEqual(type(want), type(got))
                self.assertEqual(float(want).hex(), float(got).hex())
            with self.assertRaises(nx.NodeNotFound):
                candidates.path_length(rg, -1, nodes[0])


if __name__ == "__main__":
    unittest.main()

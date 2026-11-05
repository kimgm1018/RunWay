"""H21 B2: 압축 도로망 view(ways / lonlat / pos, Sidecar refs / attrs / cls)가 dict 경로와 같은 값·순서를 주는지(합성 extract).

실제 부산 extract 비교는 reports/route_opt_round3_2026-11-03/h21/b1_check.py · b2_parity.py가 한다(여기서는 데이터 없이 규칙만)."""
import unittest
from pathlib import Path

import numpy as np

from runway_routing import graph, network_store as NS
from runway_routing.data import api


def _parsed():
    """BusanSource와 같은 필드를 가진 작은 합성 source(way 순서 = 삽입 순서, 노드 id 정렬 안 됨, tag 순서 섞임)."""
    src = object.__new__(api.busan.BusanSource)
    src.path = Path("synthetic.osm.pbf")
    src.ways = {30: ([5, 7, 7, 9], {"name": "강변로", "highway": "residential", "sidewalk": "no"}),
                12: ([9, 3], {"highway": "trunk", "bridge": "yes", "oneway": "yes"}),
                44: ([3, 5, 11], {"highway": "footway", "foot": "no", "man_made": "pier", "ford": "yes"})}
    src.node_ids = np.array([5, 7, 9, 3, 11], np.int64)
    ll = np.array([[129.1, 35.1], [129.1001, 35.1002], [129.1003, 35.1001], [129.1004, 35.0999], [129.1006, 35.1005]])
    src.lonlat = dict(zip(src.node_ids.tolist(), map(tuple, ll.tolist())))
    x, y = api.busan.TO_UTM.transform(ll[:, 0], ll[:, 1])
    src.xy = np.column_stack([x, y])
    src.pos = {int(n): i for i, n in enumerate(src.node_ids)}
    return src


class NetworkStoreViews(unittest.TestCase):
    def setUp(self):
        self.src = _parsed()
        arrays, strings = NS._fields(self.src)
        self.cs = NS._restore(arrays, strings, self.src.path)

    def test_source_views_equal_dicts(self):
        self.assertEqual(NS.compare(self.src, self.cs), [])
        self.assertIsInstance(self.cs, api.busan.BusanSource)            # disk_graph 등 canonical 메서드 그대로
        self.assertEqual(list(self.cs.ways.items()), list(self.src.ways.items()))
        self.assertEqual(list(self.cs.ways[30][1]), ["name", "highway", "sidewalk"])   # way별 tag 순서
        self.assertIsNone(self.cs.ways.get(99))
        self.assertIsNone(self.cs.lonlat.get(99))
        self.assertIsNone(self.cs.pos.get(99))
        with self.assertRaises(KeyError):
            self.cs.pos[99]
        for n, p in self.src.lonlat.items():
            q = self.cs.lonlat[n]
            self.assertEqual((p[0].hex(), p[1].hex()), (q[0].hex(), q[1].hex()))
            self.assertIs(type(q[0]), float)

    def test_sidecar_compact_equals_dict_path(self):
        a, b = graph.Sidecar(self.src), graph.Sidecar(self.cs)
        self.assertEqual(a.way_ids, b.way_ids)
        self.assertTrue(np.array_equal(a.ptr, b.ptr) and a.ptr.dtype == b.ptr.dtype)
        self.assertTrue(np.array_equal(a.ref_pos, b.ref_pos) and a.ref_pos.dtype == b.ref_pos.dtype)
        for i in range(len(a.way_ids)):
            self.assertEqual(a.refs[i], b.refs[i])
            self.assertEqual(list(a.attrs[i].items()), list(b.attrs[i].items()))
        self.assertEqual({w: a.cls[w] for w in a.way_ids}, {w: b.cls[w] for w in b.way_ids})
        self.assertEqual((a.way_status, a.way_reason), (b.way_status, b.way_reason))
        self.assertNotIn("ford", b.attrs[2])          # useful tag가 아닌 key는 attrs에 없다(원본 tag view에는 있다)
        self.assertEqual(self.cs.ways[44][1]["ford"], "yes")

    def test_segments_match_substrate_rule(self):
        seg = NS.segments(self.src.node_ids, np.array([self.src.lonlat[n] for n in self.src.node_ids.tolist()]),
                          (r for r, _ in self.src.ways.values()))
        self.assertEqual(seg["seg_w"].tolist(), [0, 0, 1, 2, 2])          # 7, 7 연속 중복은 한 번(osmnx)
        self.assertEqual(seg["seg_a"].dtype, np.int64)
        self.assertEqual(seg["seg_w"].dtype, np.int32)


if __name__ == "__main__":
    unittest.main()

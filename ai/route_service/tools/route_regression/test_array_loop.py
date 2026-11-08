"""Array LOOP activation and graph contract tests (stdlib unittest)."""
import importlib.util
import os
import json
from pathlib import Path
from collections import OrderedDict
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class ArrayLoopContract(unittest.TestCase):
    def test_array_bundle_is_available(self):
        self.assertIsNotNone(importlib.util.find_spec("runway_routing.array_graph"),
                             "The validated CSR prototype is not yet a runtime graph bundle")

    def test_loop_does_not_build_networkx_graphs_after_startup(self):
        from runway_routing.pipeline import RoutePipeline
        from runway_routing import graph
        with patch.dict(os.environ, {"RUNWAY_ARRAY_LOOP": "1"}):
            p = RoutePipeline("wide", mode="enforce", self_test=False)
        with patch.object(graph, "build_fast", side_effect=AssertionError("legacy request graph constructed")):
            with patch("networkx.Graph", side_effect=AssertionError("NetworkX H constructed")):
                with patch("networkx.MultiDiGraph", side_effect=AssertionError("NetworkX G constructed")):
                    with p.lock:
                        out = p.run(35.1508879, 129.1167806, 5000, seed=1, attempts=24)
        self.assertEqual([r["candidate_id"] for r in out["baseline"][:3]], [5, 16, 12])

    def test_mixed_cache_materializes_original_exact_disk(self):
        from runway_routing.array_graph import ArrayLoopGenerator
        from runway_routing import graph
        gen = ArrayLoopGenerator.__new__(ArrayLoopGenerator)
        gen.array_enabled, gen.array_source, gen.array_active = True, object(), False
        gen.sidecar = object()
        original = (35.15088791, 129.11678061, 3000.1, object())
        key = (round(original[0], 6), round(original[1], 6), round(original[2]))
        G = SimpleNamespace(_is_array_graph=True, original_args=original)
        gen._cache = OrderedDict([(key, (G, object()))])
        legacy_pair = object(), object()
        with patch.object(graph, "build_fast", return_value=legacy_pair) as build:
            actual = gen._graph(35.15088792, 129.11678062, 3000.2, object())
        build.assert_called_once_with(gen.sidecar, *original)
        self.assertEqual(actual, (*legacy_pair, True))
        self.assertEqual(gen._cache[key], legacy_pair)

    def test_empty_waypoint_and_runnable_errors_match_legacy(self):
        import numpy as np
        from runway_routing import graph
        from runway_routing.array_graph import ArraySource, build_array_pair
        from runway_routing.substrate import Substrate
        lat, lon = graph.REGIONS["gwangalli"].center
        coords = {100000001: (lon, lat), 100000009: (lon + .001, lat)}
        ids = np.array(list(coords), dtype=np.int64)
        cfg = json.loads((Path(__file__).resolve().parents[2] / "runway_routing/config/ug-v2.json").read_text(encoding="utf-8"))
        for highway in ("footway", "motorway"):
            with self.subTest(highway=highway):
                src = SimpleNamespace(ways={200000001: (ids.tolist(), {"highway": highway})}, node_ids=ids,
                                      lonlat=coords, pos={int(n): i for i, n in enumerate(ids)},
                                      xy=np.array([graph.busan.TO_UTM.transform(*coords[int(n)]) for n in ids]))
                gen = SimpleNamespace(source=src, sidecar=graph.Sidecar(src))
                source = ArraySource(Substrate(gen, cfg))
                region = graph.api._region(lat, lon)
                with self.assertRaises(IndexError) as original:
                    graph.build_fast(gen.sidecar, lat, lon, 1000, region)
                with self.assertRaises(IndexError) as actual:
                    build_array_pair(source, lat, lon, 1000, region)
                self.assertEqual(str(actual.exception), str(original.exception))


if __name__ == "__main__":
    unittest.main()

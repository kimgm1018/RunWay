"""Engine selection/dependency isolation and exact-path regression (stdlib unittest)."""
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


class EngineSelection(unittest.TestCase):
    def run_engine(self, engine=None, backend=None, block_numba=False, unverified_version=False):
        env = dict(os.environ)
        env.pop("RUNWAY_SP_ENGINE", None)
        env.pop("RUNWAY_SP_KERNEL", None)
        if engine is not None:
            env["RUNWAY_SP_ENGINE"] = engine
        if backend is not None:
            env["RUNWAY_SP_KERNEL"] = backend
        guard = '''
import builtins
original_import = builtins.__import__
def guarded(name, *args, **kwargs):
    if name == "numba" or name.startswith("numba."):
        raise ImportError("numba intentionally unavailable")
    return original_import(name, *args, **kwargs)
builtins.__import__ = guarded
''' if block_numba else ""
        version = 'import networkx; networkx.__version__ = "unverified"\n' if unverified_version else ""
        code = guard + version + '''
import json, sys
from runway_routing import shortest_path as sp
print(json.dumps({"engine": getattr(sp, "ENGINE", None), "backend": sp.BACKEND,
                  "numba_imported": "numba" in sys.modules,
                  "compiled": hasattr(sp, "bidirectional_numba")}))
'''
        return subprocess.run([sys.executable, "-B", "-c", code], cwd=ROOT, env=env,
                              capture_output=True, text=True, encoding="utf-8")

    def test_default_uses_compiled_numba(self):
        r = self.run_engine()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"engine": "numba", "backend": "py",
                                              "numba_imported": True, "compiled": True})

    def test_python_rollback_without_numba(self):
        r = self.run_engine("python", block_numba=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout), {"engine": "python", "backend": "py",
                                              "numba_imported": False, "compiled": False})

    def test_networkx_rollback_without_numba(self):
        r = self.run_engine("numba", "nx", block_numba=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["backend"], "nx")
        self.assertFalse(json.loads(r.stdout)["numba_imported"])

    def test_explicit_numba_missing_fails_clearly(self):
        r = self.run_engine("numba", block_numba=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("numba intentionally unavailable", r.stderr)

    def test_unverified_networkx_falls_back_without_numba(self):
        r = self.run_engine(block_numba=True, unverified_version=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["backend"], "nx")
        self.assertFalse(json.loads(r.stdout)["numba_imported"])

    def test_invalid_engine_fails(self):
        r = self.run_engine("typo")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("RUNWAY_SP_ENGINE", r.stderr)


class ExactPaths(unittest.TestCase):
    def test_ties_unreachable_and_reused_workspace(self):
        import networkx as nx
        import numpy as np
        from types import SimpleNamespace
        from runway_routing.graph import RouteCSR
        from runway_routing.shortest_path import bidirectional as python_sp
        from runway_routing import shortest_path_numba as native
        for edges in itertools.permutations([(0, 1), (0, 2), (1, 3), (2, 3)]):
            H = nx.Graph()
            H.add_nodes_from(range(5))  # isolated vertex 4
            H.add_edges_from((a, b, {"length": 1.0}) for a, b in edges)
            csr = RouteCSR(SimpleNamespace(H=H))
            for s, t in [(0, 3), (3, 0), (1, 2), (0, 0), (0, 4), (4, 0), (0, 3)]:
                for scale in [1., 0.8, 1.]:
                    mult = np.full(len(csr.length), scale)
                    used = np.arange(len(csr.length), dtype=np.int64) % 2
                    expected = python_sp(csr, s, t, mult.tolist(), used.tolist(), 4.)
                    actual = native.bidirectional(csr, s, t, mult, used, 4.)
                    self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()

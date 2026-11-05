"""H22: LRU 칸 수 환경변수 RUNWAY_GRAPH_CACHE_SIZE / RUNWAY_MASK_CACHE_SIZE.

- 해석 규칙: 없으면 4, 1 이상의 10진 정수만, 잘못된 값은 ValueError(기동 실패).
- import 시 1회 읽어 graph.GRAPH_CACHE_SIZE / substrate.MASK_CACHE_SIZE가 되고, pipeline은 같은 값을 generator의
  (G, rg) LRU(graph_cache_size)로 넘긴다(H21 b4_lru monkeypatch와 같은 효과). 결과 동일성은 Golden·b4 요청 열로 따로 본다.
import 시점 값은 별도 프로세스에서 확인한다(이 프로세스의 import 상태를 건드리지 않음)."""
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

from runway_routing import graph

ROOT = Path(__file__).resolve().parents[2]
NAMES = ("RUNWAY_GRAPH_CACHE_SIZE", "RUNWAY_MASK_CACHE_SIZE")

PROBE = r"""
import json
from runway_routing import graph, pipeline, substrate
seen = {}
class Stub:
    def __init__(self, *a, **kw):
        seen.update(kw)
        raise SystemExit(0)
pipeline.ArrayLoopGenerator = Stub
try:
    pipeline.RoutePipeline("wide", mode="enforce", self_test=False)
except SystemExit:
    pass
print(json.dumps({"graph": graph.GRAPH_CACHE_SIZE, "mask": substrate.MASK_CACHE_SIZE,
                  "gen": seen.get("graph_cache_size")}))
"""


def _probe(**env):
    e = {k: v for k, v in os.environ.items() if k not in NAMES}
    e.update(env)
    return subprocess.run([sys.executable, "-B", "-W", "ignore", "-c", PROBE], cwd=ROOT, env=e, capture_output=True,
                          text=True, encoding="utf-8", timeout=300)


class Parse(unittest.TestCase):
    def _get(self, value):
        env = {} if value is None else {"RUNWAY_TEST_CACHE": value}
        with mock.patch.dict(os.environ, env, clear=False):
            if value is None:
                os.environ.pop("RUNWAY_TEST_CACHE", None)
            return graph.cache_size_env("RUNWAY_TEST_CACHE")

    def test_default_and_valid(self):
        self.assertEqual(self._get(None), 4)
        for raw, want in (("1", 1), ("2", 2), ("4", 4), (" 2 ", 2), ("16", 16)):
            self.assertEqual(self._get(raw), want, raw)

    def test_invalid_raises(self):
        for raw in ("", " ", "0", "-1", "2.0", "1e3", "two", "+2", "٣"):
            with self.assertRaises(ValueError, msg=repr(raw)) as cm:
                self._get(raw)
            self.assertIn("RUNWAY_TEST_CACHE", str(cm.exception))


class ImportTime(unittest.TestCase):
    def test_default_is_4_everywhere(self):
        r = _probe()
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertEqual(r.stdout.strip().splitlines()[-1], '{"graph": 4, "mask": 4, "gen": 4}')

    def test_env_sets_graph_gen_and_mask(self):
        r = _probe(RUNWAY_GRAPH_CACHE_SIZE="2", RUNWAY_MASK_CACHE_SIZE="3")
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        self.assertEqual(r.stdout.strip().splitlines()[-1], '{"graph": 2, "mask": 3, "gen": 2}')

    def test_invalid_env_fails_at_import(self):
        for name in NAMES:
            r = _probe(**{name: "0"})
            self.assertNotEqual(r.returncode, 0)
            self.assertIn(f"ValueError: {name} must be an integer >= 1", r.stderr)


if __name__ == "__main__":
    unittest.main()

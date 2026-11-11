"""S15P31E105-677: 큰길 거리(graph.traffic_node_distance)의 격자 훑기 빠른 경로가 기존 STRtree 식과 같은 배열을 주는지(합성 자료)."""
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from runway_routing import graph as Gm
from runway_routing import traffic_kernels as T

pytestmark = pytest.mark.skipif(T.njit is None, reason="Numba 없음: 기존 식만 쓴다")
CFG = {"traffic": {"traffic_highway": ["primary", "tertiary"], "beside_m": 15,
                   "major_highway": ["primary"], "levels": {"on": 2, "beside": 1, "away": 0}}}


def _graph(rng, n, m, span):
    x = rng.uniform(0, span, n) + 300000.0
    y = rng.uniform(0, span, n) + 4100000.0
    # 격자 위 좌표·같은 점·반경 경계에 가까운 점이 섞이게 일부를 반올림·복사한다
    x[: n // 5] = np.round(x[: n // 5], 0)
    y[: n // 5] = np.round(y[: n // 5], 0)
    x[n // 5: n // 4], y[n // 5: n // 4] = x[: n // 4 - n // 5], y[: n // 4 - n // 5] + 16.0
    u, v = rng.integers(0, n, m), rng.integers(0, n, m)
    v[:5] = u[:5]                      # 길이 0 선분
    hw = rng.choice(["primary", "tertiary", "residential", "footway"], m)
    e = pd.DataFrame({"u": u, "v": v, "highway": hw})
    return SimpleNamespace(node_ids=np.arange(n), x=x, y=y, edges_all=e, redges=e)


@pytest.mark.parametrize("seed,n,m,span", [(1, 50, 20, 200.0), (2, 3000, 1500, 3000.0), (3, 20000, 9000, 8000.0),
                                           (4, 500, 2000, 300.0)])
def test_fast_equals_strtree(monkeypatch, seed, n, m, span):
    cg = _graph(np.random.default_rng(seed), n, m, span)
    monkeypatch.setattr(Gm, "TRAFFIC_DIST_FAST", False)
    old = Gm.traffic_node_distance(cg, CFG)
    monkeypatch.setattr(Gm, "TRAFFIC_DIST_FAST", True)
    new = Gm.traffic_node_distance(cg, CFG)
    assert old.dtype == new.dtype and old.tobytes() == new.tobytes()   # inf·0.0까지 비트 단위로 같음
    assert np.isfinite(old).any()
    lo, ln = Gm.edge_levels(cg, old, CFG), Gm.edge_levels(cg, new, CFG)
    assert all(np.array_equal(lo[k], ln[k]) for k in lo)


def test_no_traffic_edges(monkeypatch):
    cg = _graph(np.random.default_rng(5), 30, 10, 100.0)
    cg.edges_all["highway"] = "footway"
    monkeypatch.setattr(Gm, "TRAFFIC_DIST_FAST", True)
    assert np.isinf(Gm.traffic_node_distance(cg, CFG)).all()

"""S15P31E105-653: P2P 도착점 찾기(substrate.DiskMask)의 빠른 계산이 예전 식과 같은 배열·같은 PE5 선 순서를 주는지(합성 자료)."""
from types import SimpleNamespace

import numpy as np
import pytest

from runway_routing import array_pair_kernels as K
from runway_routing import substrate as SB

pytestmark = pytest.mark.skipif(K.njit is None, reason="Numba 없음: 기존 식만 쓴다")

LAT0, LON0 = 35.15, 129.05
UG2 = {"end_point_rules": {"PE1": {"max_destination_snap_m": 250}, "PE5": {"blocking_env_classes": ["river"]}}}
ARRAYS = ("sel", "keep", "seg", "g_nodes", "h_seg", "h_lo", "h_hi", "h_len", "h_nodes", "main")


def _substrate(rng, n_nodes=1500, n_way=500):
    ids = np.sort(rng.choice(10**10, n_nodes, replace=False)).astype(np.int64)
    lat = LAT0 + rng.uniform(-0.03, 0.03, n_nodes)
    lon = LON0 + rng.uniform(-0.03, 0.03, n_nodes)
    x, y = SB.busan.TO_UTM.transform(lon, lat)
    refs, seg_w, seg_a, seg_b = [], [], [], []
    for w in range(n_way):
        k = int(rng.integers(2, 7))
        start = int(rng.integers(0, n_nodes))
        nodes = [(start + int(d)) % n_nodes for d in np.cumsum(rng.integers(0, 4, k))]   # 이웃 node, 반복·중복 포함
        if w % 7 == 0:
            nodes = nodes + nodes[:1]                                                        # 고리 way
        refs.append([int(ids[p]) for p in nodes])
        dedup = [nodes[0]] + [b for a, b in zip(nodes, nodes[1:]) if b != a]
        for a, b in zip(dedup, dedup[1:]):
            seg_w.append(w), seg_a.append(a), seg_b.append(b)
    seg_a, seg_b = np.array(seg_a, np.int64), np.array(seg_b, np.int64)
    seg_len = np.round(np.hypot(x[seg_a] - x[seg_b], y[seg_a] - y[seg_b]) / 25) * 25   # 같은 길이(동점)가 많다
    lens = np.array([len(r) for r in refs])
    ref_pos = np.searchsorted(ids, np.array([i for r in refs for i in r], np.int64))
    sc = SimpleNamespace(refs=refs, ref_pos=ref_pos, ptr=np.r_[0, np.cumsum(lens)], way_ids=list(range(n_way)))
    pos = {int(i): p for p, i in enumerate(ids)}
    S = SimpleNamespace(sc=sc, ids=ids, xy=np.c_[x, y], lon=lon, lat=lat, seg_w=np.array(seg_w, np.int32), seg_a=seg_a,
                        seg_b=seg_b, seg_len=seg_len, way_of_ref=np.repeat(np.arange(n_way), lens),
                        runnable=rng.random(n_way) < 0.8, pe5=rng.random(n_way) < 0.3, pe4=rng.random(n_way) < 0.2,
                        bridge=rng.random(n_way) < 0.1, src=SimpleNamespace(pos=pos))
    S.pos_of = lambda xs: np.searchsorted(ids, np.asarray(xs, np.int64))
    return S


def _mask(monkeypatch, S, fast, *args):
    monkeypatch.setattr(SB, "MASK_FAST", fast)
    return SB.DiskMask(S, *args)


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_disk_mask_fast_equals_old(monkeypatch, seed):
    rng = np.random.default_rng(seed)
    S = _substrate(rng)
    for radius in (60.0, 900.0, 1800.0, 4000.0):
        lat, lon = LAT0 + rng.uniform(-0.005, 0.005), LON0 + rng.uniform(-0.005, 0.005)
        try:
            old = _mask(monkeypatch, S, False, lat, lon, radius)
        except Exception as exc:   # 빈 disk·빈 RUNNABLE: 빠른 경로도 같은 예외
            with pytest.raises(type(exc)):
                _mask(monkeypatch, S, True, lat, lon, radius)
            continue
        new = _mask(monkeypatch, S, True, lat, lon, radius)
        for k in ARRAYS:
            x, y = getattr(old, k), getattr(new, k)
            assert x.dtype == y.dtype and np.array_equal(x, y), k
        for k in ("data", "indices", "indptr"):
            x, y = getattr(old.A, k), getattr(new.A, k)
            assert x.dtype == y.dtype and np.array_equal(x, y), k
        rank = old._g_node_rank()
        nodes = S.ids[old.g_nodes].tolist()
        fast = new._g_node_rank_of(nodes)
        assert sorted(nodes, key=rank.__getitem__) == sorted(nodes, key=fast.__getitem__)
        for _ in range(15):
            plat, plon = lat + rng.uniform(-0.006, 0.006), lon + rng.uniform(-0.006, 0.006)
            monkeypatch.setattr(SB, "MASK_FAST", False)
            e_old = old._pe5_edges_in_G_order(plon, plat)
            monkeypatch.setattr(SB, "MASK_FAST", True)
            e_new = new._pe5_edges_in_G_order(plon, plat)
            assert [g.wkb for g in e_old] == [g.wkb for g in e_new]
            monkeypatch.setattr(SB, "MASK_FAST", False)
            s_old = old.snap_end(plat, plon, UG2, {})
            monkeypatch.setattr(SB, "MASK_FAST", True)
            s_new = new.snap_end(plat, plon, UG2, {})
            for k in ("node", "snap_m", "code", "rejected"):
                assert s_old[k] == s_new[k], k
            assert [g.wkb for g in s_old["pe5_inputs"]["edge_lines"]] == [g.wkb for g in s_new["pe5_inputs"]["edge_lines"]]


def test_sorted_unique_pos_equals_sorted_unique():
    rng = np.random.default_rng(7)
    for n, size in ((1, 1), (10, 30), (5000, 20000)):
        a, b = rng.integers(0, n, size), rng.integers(0, n, size // 2 + 1)
        for dt in (np.int32, np.int64):
            want = SB.sorted_unique(np.r_[a.astype(dt), b.astype(dt)])
            got = SB._sorted_unique_pos((a.astype(dt), b.astype(dt)), n, dt)
            assert got.dtype == want.dtype and np.array_equal(got, want)

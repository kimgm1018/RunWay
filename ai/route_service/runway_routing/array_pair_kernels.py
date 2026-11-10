"""build_array_pair·populate_adapter의 정렬·np.unique 몇 개를 같은 결과의 한 번 훑기(Numba)로 바꾼다 (S15P31E105-645).

모두 정수 위치 계산이고 결과 배열이 기존 식과 원소 단위로 같다(합성 자료 시험: tests/test_route_speed_645.py).
- first_rank: np.unique(flat, return_index=True) → 처음 나온 순서로 매긴 번호(projected, h_rank)와 그 순서의 값(hn).
- shortest_per_key: np.unique(key, return_index=True)의 first와 lexsort((arange, lengths, key))의 key별 첫 행(best).
  key 안정 정렬 한 번 + 훑기. length에 NaN이 있으면 None(호출자가 기존 식을 쓴다; lexsort의 NaN 순서를 따라 하지 않음).
- first_position: 값마다 처음 나온 위치(없으면 -1).
Numba가 없으면 None을 돌려주고 호출자는 기존 식을 쓴다(결과 같음).
"""
import numpy as np

try:
    from numba import njit
except ImportError:          # Numba가 없으면 기존 식만 쓴다(결과 같음)
    njit = None

if njit is not None:
    @njit("int64(int64[::1], int64[::1], int64[::1])", cache=True)
    def _first_rank(flat, rank, vals):
        c = 0
        for i in range(len(flat)):
            v = flat[i]
            if rank[v] < 0:
                rank[v] = c
                vals[c] = v
                c += 1
        return c

    @njit("void(int64[::1], int64[::1])", cache=True)
    def _first_position(values, out):
        for i in range(len(values)):
            v = values[i]
            if out[v] < 0:
                out[v] = i

    @njit("int64(int64[::1], int64[::1], float64[::1], int64[::1], int64[::1])", cache=True)
    def _shortest_per_key(order, key, lengths, first, best):
        g = -1
        prev = 0
        for j in range(len(order)):
            i = order[j]
            k = key[i]
            if g < 0 or k != prev:
                g += 1
                prev = k
                first[g] = i          # 안정 정렬이라 key 안에서 가장 앞(작은) 행
                best[g] = i
            elif lengths[i] < lengths[best[g]]:   # 같은 길이면 앞 행을 둔다(lexsort의 arange 기준과 같음)
                best[g] = i
        return g + 1


def first_rank(flat, n):
    """(rank, vals): rank[v] = v가 flat에서 처음 나온 순번(없으면 -1), vals = 처음 나온 순서의 서로 다른 값."""
    if njit is None:
        return None
    flat = np.ascontiguousarray(flat, np.int64)
    rank = np.full(n, -1, np.int64)
    vals = np.empty(len(flat), np.int64)
    c = _first_rank(flat, rank, vals)
    return rank, vals[:c].copy()   # 남는 버퍼를 붙잡지 않게 복사


def first_position(values, n):
    """out[v] = values에서 v가 처음 나온 위치(없으면 -1). 0 <= v < n."""
    if njit is None:
        return None
    out = np.full(n, -1, np.int64)
    _first_position(np.ascontiguousarray(values, np.int64), out)
    return out


def shortest_per_key(key, lengths):
    """(first, best): np.unique(key, return_index=True)[1]과 lexsort((arange, lengths, key))에서 key별 첫 행."""
    if njit is None:
        return None
    lengths = np.ascontiguousarray(lengths, np.float64)
    if np.isnan(lengths).any():
        return None
    key = np.ascontiguousarray(key, np.int64)
    order = np.argsort(key, kind="stable")
    first, best = np.empty(len(key), np.int64), np.empty(len(key), np.int64)
    m = _shortest_per_key(order, key, lengths, first, best)
    return first[:m], best[:m]

"""Numba engine of the D-exact kernel: shortest_path.bidirectional compiled, same algorithm line by line.

요약: shortest_path.bidirectional(networkx 3.7 bidirectional Dijkstra 이식)을 Numba로 컴파일한 엔진. 결과는 같아야 한다.
위치: candidates._route_through_exact가 기본으로 부른다(RUNWAY_SP_ENGINE=python이면 기존 Python 엔진).
주의: Python 엔진과 같은 경로를 고르는 것이 목표다. 아래 순서·비교·연산 중 하나라도 바꾸면 동점 경로가 달라진다.

What is kept exactly (see shortest_path.bidirectional):
  - directions alternate, forward first; each direction pops its own heap ordered by (distance, counter); ONE counter
    shared by both heaps (pushes: source 0, target 1, then every relaxation) -- counters are unique, so the pop order
    is the tuple order of Python's heapq, whatever the heap layout;
  - neighbours scanned in RouteCSR order (ptr / nbr / ned = H._adj order);
  - cost = length[e] * mult[e] * (1 + pen * used[e]) in float64, the same operations in the same order, no fastmath;
  - relax when w is not final and (unseen or strictly shorter); a final w with a shorter path raises like networkx;
    meet update when the new total is strictly shorter; stop when the popped node is final in the other direction;
    path = forward preds from the meet node (reversed) + backward preds from the meet node's backward pred.
Membership ("v in dists", "w in seen") uses per-call stamps on workspace arrays kept on the RouteCSR object, so a call
never clears O(N) memory. Not thread-safe (one workspace per graph), like the rest of the pipeline (callers hold p.lock).
Compiled eagerly at import with an explicit signature and cache=True: the first request never compiles; a later
process loads the cached machine code (NUMBA_CACHE_DIR or this package's __pycache__).
"""
import numpy as np
from numba import njit

_SIG = ("int64(int64[::1], int64[::1], int64[::1], float64[::1], float64[::1], int64[::1], float64, int64, int64, "
        "int64[:, ::1], float64[:, ::1], int64[:, ::1], float64[:, ::1], int64[:, ::1], int64[:, ::1], int64[::1], "
        "int64[::1])")


@njit(cache=True, inline="always")
def _less(hd, hc, d, i, j):
    """Heap order of Python's heapq on (distance, counter, node): distance, then the unique counter."""
    return hd[d, i] < hd[d, j] or (hd[d, i] == hd[d, j] and hc[d, i] < hc[d, j])


@njit(cache=True)
def _push(hd, hc, hn, size, d, dist, cnt, node):
    i = size[d]
    size[d] = i + 1
    hd[d, i], hc[d, i], hn[d, i] = dist, cnt, node
    while i > 0:
        parent = (i - 1) >> 1
        if _less(hd, hc, d, i, parent):
            hd[d, i], hd[d, parent] = hd[d, parent], hd[d, i]
            hc[d, i], hc[d, parent] = hc[d, parent], hc[d, i]
            hn[d, i], hn[d, parent] = hn[d, parent], hn[d, i]
            i = parent
        else:
            break


@njit(cache=True)
def _pop(hd, hc, hn, size, d):
    """Remove the smallest entry (slot 0); the caller reads hd / hn at slot 0 before calling."""
    last = size[d] - 1
    size[d] = last
    hd[d, 0], hc[d, 0], hn[d, 0] = hd[d, last], hc[d, last], hn[d, last]
    i = 0
    while True:
        lft = 2 * i + 1
        if lft >= last:
            break
        small = lft
        rgt = lft + 1
        if rgt < last and _less(hd, hc, d, rgt, lft):
            small = rgt
        if _less(hd, hc, d, small, i):
            hd[d, i], hd[d, small] = hd[d, small], hd[d, i]
            hc[d, i], hc[d, small] = hc[d, small], hc[d, i]
            hn[d, i], hn[d, small] = hn[d, small], hn[d, i]
            i = small
        else:
            break


@njit(_SIG, cache=True)
def _bidirectional(ptr, nbr, ned, L, M, used, pen, s, t, mark, val, pred, hd, hc, hn, out, meta):
    """Path length written to out[:k] (node indices s .. t), or -1 when there is no path.
    mark rows: 0 / 1 = final (dists) forward / backward, 2 / 3 = seen forward / backward; val holds the matching
    distances; pred rows 0 / 1 = preds forward / backward (-1 = the search root, networkx's None)."""
    if s == t:
        out[0] = s
        return 1
    meta[0] += 1
    stamp = meta[0]
    size = np.zeros(2, np.int64)
    mark[2, s] = stamp
    val[2, s] = 0.0
    pred[0, s] = -1
    mark[3, t] = stamp
    val[3, t] = 0.0
    pred[1, t] = -1
    c = 0
    _push(hd, hc, hn, size, 0, 0.0, c, s)
    c += 1
    _push(hd, hc, hn, size, 1, 0.0, c, t)
    c += 1
    have_final = False
    finaldist = 0.0
    meetnode = -1
    direction = 1
    while size[0] > 0 and size[1] > 0:
        direction = 1 - direction
        dist = hd[direction, 0]
        v = hn[direction, 0]
        _pop(hd, hc, hn, size, direction)
        if mark[direction, v] == stamp:                      # v in dists[direction]
            continue
        mark[direction, v] = stamp
        val[direction, v] = dist
        if mark[1 - direction, v] == stamp:                  # v in dists[1 - direction]
            if meetnode == -1:                               # networkx: preds[1][None] -> KeyError (never seen)
                raise ValueError("bidirectional: no meet node at termination")
            k = 0
            x = meetnode                                     # _path(preds[0], meetnode)[::-1]
            while x != -1:
                out[k] = x
                k += 1
                x = pred[0, x]
            i, j = 0, k - 1
            while i < j:
                out[i], out[j] = out[j], out[i]
                i += 1
                j -= 1
            x = pred[1, meetnode]                            # + _path(preds[1], preds[1][meetnode])
            while x != -1:
                out[k] = x
                k += 1
                x = pred[1, x]
            return k
        sd = 2 + direction
        so = 3 - direction
        for jj in range(ptr[v], ptr[v + 1]):
            w = nbr[jj]
            e = ned[jj]
            cost = L[e] * M[e] * (1 + pen * used[e])
            vwLength = dist + cost
            if mark[direction, w] == stamp:                  # w in dists[direction]
                if vwLength < val[direction, w]:
                    raise ValueError("Contradictory paths found: negative weights?")
            elif mark[sd, w] != stamp or vwLength < val[sd, w]:
                mark[sd, w] = stamp
                val[sd, w] = vwLength
                _push(hd, hc, hn, size, direction, vwLength, c, w)
                c += 1
                pred[direction, w] = v
                if mark[so, w] == stamp:                     # w in seen[1 - direction]
                    finaldist_w = vwLength + val[so, w]
                    if not have_final or finaldist > finaldist_w:
                        have_final = True
                        finaldist = finaldist_w
                        meetnode = w
    return -1


class _Arrays:
    """RouteCSR as contiguous numpy arrays + the per-graph workspace (built once, stored on the RouteCSR object)."""

    def __init__(self, csr):
        n, arcs = len(csr.ids), len(csr.nbr)
        self.ptr = np.asarray(csr.ptr, dtype=np.int64)
        self.nbr = np.asarray(csr.nbr, dtype=np.int64)
        self.ned = np.asarray(csr.ned, dtype=np.int64)
        self.length = np.asarray(csr.length, dtype=np.float64)   # the same Python floats, bit for bit
        cap = arcs + 2                                             # pushes per direction <= 1 + arcs scanned
        self.mark = np.zeros((4, n), np.int64)
        self.val = np.zeros((4, n), np.float64)
        self.pred = np.zeros((2, n), np.int64)
        self.hd = np.zeros((2, cap), np.float64)
        self.hc = np.zeros((2, cap), np.int64)
        self.hn = np.zeros((2, cap), np.int64)
        self.out = np.zeros(max(n, 1), np.int64)
        self.meta = np.zeros(1, np.int64)


def arrays(csr) -> _Arrays:
    a = getattr(csr, "_numba_arrays", None)
    if a is None:
        a = csr._numba_arrays = _Arrays(csr)
    return a


def bidirectional(csr, s: int, t: int, M: np.ndarray, used: np.ndarray, pen: float) -> list | None:
    """Same contract as shortest_path.bidirectional, with M (float64) and used (int64) as numpy arrays."""
    a = arrays(csr)
    k = _bidirectional(a.ptr, a.nbr, a.ned, a.length, M, used, float(pen), s, t, a.mark, a.val, a.pred,
                       a.hd, a.hc, a.hn, a.out, a.meta)
    return None if k < 0 else a.out[:k].tolist()


def warm_up() -> None:
    """Run the compiled kernel once on a 3-node graph (loads / links the machine code at start-up, not on a request)."""
    class _Tiny:
        ids = [10, 11, 12]
        ptr = [0, 1, 3, 4]
        nbr = [1, 0, 2, 1]
        ned = [0, 0, 1, 1]
        length = [1.0, 2.0]
    tiny = _Tiny()
    got = bidirectional(tiny, 0, 2, np.ones(2), np.zeros(2, np.int64), 4.0)
    if got != [0, 1, 2]:
        raise RuntimeError(f"numba D-exact warm-up returned {got}")

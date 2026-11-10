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
        self.x = self.y = None                                     # A* 좌표(csr 노드 순서), astar()가 처음 부를 때 채운다


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


# ------------------------------------------------------------------ A* (S15P31E105-621)
# 요약: 같은 구간 비용(L*M*(1+pen*used))의 A*. 확장 노드가 4–5배 줄어 탐색이 빠르다.
# h(v) = hscale * 직선거리(UTM), hscale = 0.995 * min(M). 비용 >= L * min(M) >= 직선거리 * min(M)이고 0.995는
# OSM 측지 길이와 UTM 거리 차이(축척 계수, 국내 <0.2 %)의 여유라 h는 admissible이며 consistent하다.
# 동점 처리: A*는 길이가 (거의) 같은 경로가 둘 이상일 때 bidirectional과 다른 것을 고를 수 있다. 그래서 탐색 중에
# 어떤 노드에 다른 경로로 상대 오차 tie_eps 안의 같은 비용이 나오면 그 노드에 표시하고, 찾은 경로의 노드 중 하나라도
# 표시되어 있으면(-2) 그 구간만 bidirectional로 다시 찾는다. 거의 같은 다른 경로가 있으면 그 경로는 찾은 경로와 어느
# 노드에서 다시 만나고, 그 노드의 두 이전 노드는 h의 여유(0.5 %) 때문에 t보다 먼저 확장되므로 표시가 빠지지 않는다.
# 최단 경로가 하나뿐이면(차이가 tie_eps보다 크면) 두 알고리즘의 답은 같다. 그러니 결과는 bidirectional과 같다.
# mark rows 0 / 1 = closed / seen, val row 0 = g, pred row 0, heap row 0: bidirectional과 같은 작업 배열을 쓴다.
_ASIG = ("int64(int64[::1], int64[::1], int64[::1], float64[::1], float64[::1], int64[::1], float64, int64, int64, "
         "float64[::1], float64[::1], float64, float64, int64[:, ::1], float64[:, ::1], int64[:, ::1], "
         "float64[:, ::1], int64[:, ::1], int64[:, ::1], int64[::1], int64[::1])")


@njit(_ASIG, cache=True)
def _astar(ptr, nbr, ned, L, M, used, pen, s, t, X, Y, hscale, tie_eps, mark, val, pred, hd, hc, hn, out, meta):
    """Path length written to out[:k] (node indices s .. t), -1 when there is no path, -2 when a near tie decided a
    node of the found path, -3 when a closed node would improve (the caller then runs _bidirectional for this leg).
    Heap order (f, counter). mark row 2 = near-tie stamp."""
    if s == t:
        out[0] = s
        return 1
    meta[0] += 1
    stamp = meta[0]
    size = np.zeros(2, np.int64)
    tx, ty = X[t], Y[t]
    mark[1, s] = stamp
    val[0, s] = 0.0
    pred[0, s] = -1
    c = 0
    _push(hd, hc, hn, size, 0, hscale * np.hypot(X[s] - tx, Y[s] - ty), c, s)
    c += 1
    while size[0] > 0:
        v = hn[0, 0]
        _pop(hd, hc, hn, size, 0)
        if mark[0, v] == stamp:
            continue
        mark[0, v] = stamp
        if v == t:
            k = 0
            x = t
            while x != -1:
                if mark[2, x] == stamp:                      # a near tie decided a node of this path
                    return -2
                out[k] = x
                k += 1
                x = pred[0, x]
            i, j = 0, k - 1
            while i < j:
                out[i], out[j] = out[j], out[i]
                i += 1
                j -= 1
            return k
        gv = val[0, v]
        pv = pred[0, v]
        for jj in range(ptr[v], ptr[v + 1]):
            w = nbr[jj]
            if w == pv:                                      # back along v's own tree edge: not another path to w
                continue
            e = ned[jj]
            nd = gv + L[e] * M[e] * (1 + pen * used[e])
            if mark[1, w] == stamp:
                gw = val[0, w]
                if abs(nd - gw) <= tie_eps * max(nd, gw):
                    mark[2, w] = stamp                       # two (almost) equal ways into w: checked on the path
                    continue
                if nd >= gw:
                    continue
                if mark[0, w] == stamp:                      # a closed node improved: h was not consistent here
                    return -3
            mark[1, w] = stamp
            val[0, w] = nd
            pred[0, w] = v
            _push(hd, hc, hn, size, 0, nd + hscale * np.hypot(X[w] - tx, Y[w] - ty), c, w)
            c += 1
    return -1


TIE_EPS = 1e-9            # 상대 오차. 합산 순서 차이(약 1e-13)보다 훨씬 크고 실제 길이 차이(mm 단위)보다 훨씬 작다.
STATS = {"astar": 0, "fallback": 0}


def astar(csr, xy, s: int, t: int, M: np.ndarray, used: np.ndarray, pen: float, min_mult: float) -> list | None:
    """bidirectional()과 같은 결과(같은 경로). xy: csr 노드 순서의 UTM 좌표 (n, 2). min_mult = M.min().
    pen < 0 이거나 min_mult <= 0이면 h가 하한이 아니므로 bidirectional을 그대로 쓴다."""
    if pen < 0 or not min_mult > 0:
        return bidirectional(csr, s, t, M, used, pen)
    a = arrays(csr)
    if a.x is None:
        xy = np.asarray(xy, dtype=np.float64)
        a.x, a.y = np.ascontiguousarray(xy[:, 0]), np.ascontiguousarray(xy[:, 1])
    k = _astar(a.ptr, a.nbr, a.ned, a.length, M, used, float(pen), s, t, a.x, a.y, 0.995 * float(min_mult), TIE_EPS,
               a.mark, a.val, a.pred, a.hd, a.hc, a.hn, a.out, a.meta)
    STATS["astar"] += 1
    if k <= -2:
        STATS["fallback"] += 1
        return bidirectional(csr, s, t, M, used, pen)
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
    xy = np.array([[0.0, 0.0], [1.0, 0.0], [3.0, 0.0]])
    got = astar(tiny, xy, 0, 2, np.ones(2), np.zeros(2, np.int64), 4.0, 1.0)
    if got != [0, 1, 2]:
        raise RuntimeError(f"numba A* warm-up returned {got}")

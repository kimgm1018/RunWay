"""Canonical NetworkX 3.7 component metadata without constructing a graph.

The input is an ordered RouteCSR of a simple undirected graph, with Python int
node ids and Python float edge lengths. Node and adjacency orders must match H.
Python set construction and built-in sum intentionally mirror the canonical
operations: both component item order and floating-point sums are observable.

component_layout_fast (S15P31E105-437): 같은 결과를 Numba로 빠르게 만든다.
- BFS 방문 순서(= set에 넣는 순서)와 길이 합산(builtins.sum의 Neumaier 보정 단계, 왼쪽부터)을 Numba로 계산한다.
- set·dict는 Python에서 같은 순서로 넣어 만든다(set 순회 순서가 결과 dict 순서를 정하므로 set 자체는 그대로 만든다).
- import 때 probe로 이 interpreter의 sum()과 bit 단위로 같은지 확인한다. 다르거나 Numba가 없으면 component_layout을 쓴다.
"""
import math

import numpy as np

try:
    from numba import njit
except ImportError:          # Numba가 없으면 Python 경로만 쓴다(결과 같음)
    njit = None


def component_layout(csr):
    """Return ``(comp, comp_km)`` in ``route_graph_fast``'s exact order.

    This preserves NetworkX 3.7 BFS set insertion, subgraph view iteration,
    undirected edge reporting (including self-loops), and stable length sorting.
    No NetworkX imports or graph construction are required.
    """
    ids, index = csr.ids, csr.index
    ptr, nbr, ned, length = csr.ptr, csr.nbr, csr.ned, csr.length
    count = len(ids)
    visited = set()
    raw = []
    for source in ids:
        if source in visited:
            continue
        remaining = count - len(visited)
        seen = {source}
        nextlevel = [source]
        while nextlevel:
            thislevel = nextlevel
            nextlevel = []
            complete = False
            for node in thislevel:
                i = index[node]
                for arc in range(ptr[i], ptr[i + 1]):
                    neighbor = ids[nbr[arc]]
                    if neighbor not in seen:
                        seen.add(neighbor)
                        nextlevel.append(neighbor)
                if len(seen) == remaining:
                    complete = True
                    break
            if complete:
                break
        visited.update(seen)
        raw.append(seen)

    def component_lengths(component):
        # Graph.subgraph -> show_nodes(nbunch_iter(component)). nbunch_iter is
        # a generator, so set(component) would incorrectly use set-copy layout.
        selected = set(n for n in component if n in index)
        nodes = selected if 2 * len(selected) < count else (n for n in ids if n in selected)
        reported = {}
        for node in nodes:
            i = index[node]
            for arc in range(ptr[i], ptr[i + 1]):
                neighbor = ids[nbr[arc]]
                if neighbor in selected and neighbor not in reported:
                    yield length[ned[arc]]
            reported[node] = 1

    # Use the runtime's sum implementation, including its float compensation,
    # exactly as canonical does rather than repeatedly accumulating with +=.
    lengths = [sum(component_lengths(c)) for c in raw]
    order = sorted(range(len(raw)), key=lambda i: -lengths[i])
    comp = {n: i for i, j in enumerate(order) for n in raw[j]}
    return comp, [lengths[j] / 1000 for j in order]


# ---------------------------------------------------------------- Numba 경로 (같은 결과)
if njit is not None:
    @njit("void(int64[::1], int64[::1], int64[::1], int64[::1])", cache=True)
    def _bfs_order(ptr, nbr, order, starts):
        """networkx connected_components의 set 삽입 순서: ids 순서로 시작점, 단계별 BFS(= FIFO), 이웃은 ptr 순서.
        order[k] = k번째로 seen에 들어간 node index, starts[c] = c번째 component의 시작 위치(마지막 칸 = n)."""
        n = len(ptr) - 1
        seen = np.zeros(n, np.bool_)
        pos = 0
        c = 0
        for s in range(n):
            if seen[s]:
                continue
            starts[c] = pos
            c += 1
            seen[s] = True
            order[pos] = s
            pos += 1
            head = starts[c - 1]
            while head < pos:
                i = order[head]
                head += 1
                for arc in range(ptr[i], ptr[i + 1]):
                    w = nbr[arc]
                    if not seen[w]:
                        seen[w] = True
                        order[pos] = w
                        pos += 1
        starts[c] = pos
        starts[c + 1:] = -1

    @njit("void(int64[::1], int64[::1], int64[::1], float64[::1], int64[::1], int64[::1], float64[::1], int64[::1])",
          cache=True)
    def _component_sums(ptr, nbr, ned, length, seq, seq_ptr, out, n_items):
        """component마다 seq(subgraph 순회 node 순서)대로 아직 보고되지 않은 이웃 간선 길이를 더한다.
        더하기는 builtins.sum의 float 단계 그대로: 첫 항 0 + x, 이후 Neumaier 보정, 끝에 보정이 0이 아니고 유한하면 더함."""
        reported = np.zeros(len(ptr) - 1, np.bool_)
        for c in range(len(seq_ptr) - 1):
            f = 0.0
            comp = 0.0
            k = 0
            for p in range(seq_ptr[c], seq_ptr[c + 1]):
                i = seq[p]
                for arc in range(ptr[i], ptr[i + 1]):
                    w = nbr[arc]
                    if not reported[w]:
                        x = length[ned[arc]]
                        if k == 0:
                            f = 0.0 + x
                        else:
                            t = f + x
                            if abs(f) >= abs(x):
                                comp += (f - t) + x
                            else:
                                comp += (x - t) + f
                            f = t
                        k += 1
                reported[i] = True
            if comp != 0.0 and math.isfinite(comp):
                f = f + comp
            out[c] = f
            n_items[c] = k


def _probe() -> bool:
    """Numba 합산이 이 interpreter의 sum()과 bit 단위로 같은지(보정이 드러나는 입력 포함) import 때 확인한다."""
    if njit is None:
        return False
    cases = ([1e16, 1.0, -1e16], [0.1] * 10, [3.0, 1e-17, 2.5e-17, 7.25, 1e-30], [5.5], [1e308, 1e308, -1e308],
             [0.3, 0.6, 0.1, 1e-16, 2.0 ** -60])
    for xs in cases:
        # 경로 graph 0-1-2-...: node 0부터 순서대로 간선 하나씩 보고된다
        n = len(xs) + 1
        ptr = np.zeros(n + 1, np.int64)
        nbr, ned = [], []
        for i in range(n):
            for j, e in ((i - 1, i - 1), (i + 1, i)):
                if 0 <= j < n:
                    nbr.append(j)
                    ned.append(e)
            ptr[i + 1] = len(nbr)
        out, cnt = np.zeros(1), np.zeros(1, np.int64)
        _component_sums(ptr, np.array(nbr, np.int64), np.array(ned, np.int64), np.array(xs, np.float64),
                        np.arange(n, dtype=np.int64), np.array([0, n], np.int64), out, cnt)
        if float(out[0]).hex() != float(sum(xs)).hex() or cnt[0] != len(xs):
            return False
    return True


FAST_OK = _probe()


def component_layout_fast(csr, ptr, nbr, ned, length):
    """component_layout(csr)와 같은 (comp, comp_km)에 더해 H node index별 component 번호 배열을 돌려준다.

    ptr/nbr/ned: int64 배열(csr의 list와 같은 값), length: float64 배열(csr.length와 같은 값).
    FAST_OK가 아니면 component_layout 결과로 같은 배열을 만든다."""
    ids, index = csr.ids, csr.index
    count = len(ids)
    if not FAST_OK:
        comp, comp_km = component_layout(csr)
        return comp, comp_km, np.fromiter((comp[n] for n in ids), np.int64, count)
    order = np.empty(count, np.int64)
    starts = np.empty(count + 2, np.int64)
    _bfs_order(ptr, nbr, order, starts)
    starts = starts[:np.flatnonzero(starts == count)[0] + 1] if count else np.zeros(1, np.int64)
    ordered = list(map(ids.__getitem__, order.tolist()))   # csr.ids의 같은 int 객체(새 int를 만들지 않음)
    # raw[c]: networkx와 같은 순서로 넣어 만든 set(순회 순서가 comp dict 순서를 정한다)
    raw = [set(ordered[s:e]) for s, e in zip(starts[:-1].tolist(), starts[1:].tolist())]
    # subgraph 순회 순서: 작은 component는 set(nbunch_iter(c)) 순회 순서, 절반 이상이면 ids 순서
    seq, seq_ptr = [], [0]
    for s, e, c in zip(starts[:-1].tolist(), starts[1:].tolist(), raw):
        if 2 * (e - s) < count:
            seq.append(np.fromiter(map(index.__getitem__, set(iter(c))), np.int64, e - s))
        else:
            seq.append(np.sort(order[s:e]))
        seq_ptr.append(seq_ptr[-1] + (e - s))
    out, n_items = np.empty(len(raw)), np.empty(len(raw), np.int64)
    if raw:
        _component_sums(ptr, nbr, ned, length, np.concatenate(seq), np.array(seq_ptr, np.int64), out, n_items)
    # 간선이 없는 component는 sum()이 int 0을 돌려준다(정렬 key·km 값은 같지만 그대로 맞춘다)
    lengths = [x if k else 0 for x, k in zip(out.tolist(), n_items.tolist())]
    rank_order = sorted(range(len(raw)), key=lambda i: -lengths[i])
    keys, values = [], []
    for r, j in enumerate(rank_order):
        keys.extend(raw[j])
        values.extend([r] * len(raw[j]))
    comp = dict(zip(keys, values))
    rank_of = np.empty(len(raw), np.int64)
    rank_of[rank_order] = np.arange(len(raw))
    comp_idx = np.empty(count, np.int64)
    comp_idx[order] = np.repeat(rank_of, np.diff(starts))
    return comp, [lengths[j] / 1000 for j in rank_order], comp_idx

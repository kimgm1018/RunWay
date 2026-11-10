"""Shortest-path kernel of candidates.route_through: networkx 3.7 bidirectional_dijkstra, ported exactly ("D-exact").

요약: 후보 생성의 구간 최단 경로 kernel(networkx 3.7 bidirectional Dijkstra를 순서까지 그대로 옮김).
위치: candidates.route_through 안. LOOP/OAB/P2P 모두 여기를 지난다.
주의: heap counter와 이웃 순회 순서가 동점 경로 선택을 정한다. 순서를 바꾸면 추천이 바뀐다.

nx.shortest_path(H, s, t, weight=callable) runs networkx.bidirectional_dijkstra (networkx 3.7,
algorithms/shortest_paths/weighted.py). bidirectional() below is that function line by line on graph.RouteCSR arrays:
  - directions alternate (forward first); each pops its own heap of (distance, counter, node);
  - ONE counter shared by both heaps, so equal distances pop in push order -- the whole tie-break;
  - neighbours are scanned in H._adj order (RouteCSR keeps it);
  - relax: vwLength = dist + cost; update when unseen or strictly shorter; meet-node update when the new total is
    strictly shorter; stop when a node is final in both directions; path rebuilt from the preds at that moment;
  - leg cost = length[e] * mult[e] * (1 + penalty * used[e]): route_through's callback expression, same order of
    floating-point operations, with arrays instead of dict / Counter lookups (mult 1.0 where the dict has no key).
Same inputs -> the same path, ties included (verified leg by leg against networkx and by the golden).

BACKEND: "py" (this kernel, default) or "nx" (networkx itself). RUNWAY_SP_KERNEL=nx is the rollback switch; any
networkx other than VERIFIED_NETWORKX also falls back to "nx", because the port reproduces that version's code.
ENGINE (only with BACKEND "py"): "numba" (default, the same algorithm compiled) or "python" (bidirectional below,
rollback with RUNWAY_SP_ENGINE=python). Asking for "numba" without a working
numba fails at import (no silent fallback); it is compiled / loaded from cache and warmed up at import, not on a request.

왜 "더 빠른 최단 경로"가 아니라 NetworkX 3.7을 그대로 옮겼나: 길이가 같은 경로가 여러 개면 어느 것을 고르느냐가
heap의 push 순서와 이웃 순회 순서로 정해진다. 다른 알고리즘(A*, scipy 등)이나 다른 순서는 동점 경로를 다르게 골라
후보·TOP3·golden이 바뀐다. 그래서 이 파일은 순서까지 networkx와 같게 유지해야 하고, networkx 버전이 바뀌면 자동으로
"nx"로 돌아간다. 수정할 때는 golden 4 mode + random P2P로 동일성을 다시 확인한다.

A*(S15P31E105-621, RUNWAY_SP_ASTAR, 기본 1): Numba 엔진이고 배열 graph(rg.H.xy가 있음)일 때 구간 탐색을
shortest_path_numba.astar로 한다. 비용이 거의 같은 경로가 하나라도 보이면 그 구간은 bidirectional로 다시 찾으므로
고르는 경로는 위 kernel과 같다. RUNWAY_SP_ASTAR=0이면 예전처럼 bidirectional만 쓴다(결과 같음, 느려짐).
"""
import os
from heapq import heappop, heappush

import networkx

from .env_flags import flag as _flag

VERIFIED_NETWORKX = "3.7"


def _backend() -> str:
    want = os.environ.get("RUNWAY_SP_KERNEL", "py")
    if want not in ("py", "nx"):
        raise ValueError(f"RUNWAY_SP_KERNEL must be py or nx, not {want!r}")
    return want if want == "nx" or networkx.__version__ == VERIFIED_NETWORKX else "nx"


BACKEND = _backend()


def _engine() -> str:
    want = os.environ.get("RUNWAY_SP_ENGINE", "numba")
    if want not in ("python", "numba"):
        raise ValueError(f"RUNWAY_SP_ENGINE must be python or numba, not {want!r}")
    return want


ENGINE = _engine()
if BACKEND == "py" and ENGINE == "numba":
    from . import shortest_path_numba as _numba   # compiles (or loads the cache) here, at start-up
    _numba.warm_up()
    bidirectional_numba = _numba.bidirectional
    ASTAR = _flag("RUNWAY_SP_ASTAR", True)
    astar_numba = _numba.astar
    astar_length_numba = _numba.astar_length
else:
    ASTAR = False


def bidirectional(csr, s: int, t: int, M: list, used: list, pen: float) -> list | None:
    """Node-index path s -> t on csr (networkx 3.7 bidirectional_dijkstra), or None when there is no path."""
    if s == t:
        return [s]
    ptr, nbr, ned, L = csr.ptr, csr.nbr, csr.ned, csr.length
    dists = [{}, {}]
    preds = [{s: None}, {t: None}]
    fringe = [[], []]
    seen = [{s: 0}, {t: 0}]
    # tie-break: 두 heap이 counter c 하나를 같이 쓴다. 거리가 같으면 먼저 push된 것이 먼저 나온다(networkx와 동일).
    c = 0
    heappush(fringe[0], (0, c, s))
    c += 1
    heappush(fringe[1], (0, c, t))
    c += 1
    finaldist = None
    meetnode = None
    direction = 1
    while fringe[0] and fringe[1]:
        direction = 1 - direction
        dist, _, v = heappop(fringe[direction])
        dd = dists[direction]
        if v in dd:
            continue
        dd[v] = dist
        if v in dists[1 - direction]:
            return _path(preds[0], meetnode)[::-1] + _path(preds[1], preds[1][meetnode])
        sd, so, pd, fr = seen[direction], seen[1 - direction], preds[direction], fringe[direction]
        for j in range(ptr[v], ptr[v + 1]):
            w = nbr[j]
            e = ned[j]
            cost = L[e] * M[e] * (1 + pen * used[e])
            vwLength = dist + cost
            if w in dd:
                if vwLength < dd[w]:
                    raise ValueError("Contradictory paths found: negative weights?")
            elif w not in sd or vwLength < sd[w]:
                sd[w] = vwLength
                heappush(fr, (vwLength, c, w))
                c += 1
                pd[w] = v
                if w in so:
                    finaldist_w = vwLength + so[w]
                    if finaldist is None or finaldist > finaldist_w:
                        finaldist, meetnode = finaldist_w, w
    return None


def _path(preds: dict, curr) -> list:
    """Follow preds from curr back to its search root (networkx's path(): reversed for the forward side)."""
    ret = []
    while curr is not None:
        ret.append(curr)
        curr = preds[curr]
    return ret

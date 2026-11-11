"""graph.traffic_node_distance의 STRtree dwithin 조회 + shapely.distance를 같은 값의 격자 훑기(Numba)로 바꾼다.

기존: 큰길 중심선(2점 선분)마다 STRtree를 만들고, 모든 node 점에서 반경 r(beside_m + 1 m) 안의 선분을 찾은 뒤
GEOS 거리(DistanceOp → Distance::pointToSegment)의 최솟값을 node 거리로 둔다. 반경 밖 node는 inf.
여기서는 선분 bbox를 r만큼 넓혀 격자 칸에 넣고, node 점이 든 칸의 선분만 GEOS와 같은 식·같은 연산 순서로 거리를 구해
r 이하인 것의 최솟값을 둔다(합성 자료·실제 요청 graph에서 배열 원소 단위로 같음: tests/test_route_speed_677.py).
값을 쓰는 곳은 edge_levels의 "<= beside_m"뿐이고, r은 그보다 1 m 크므로 r 경계의 반올림 차이도 등급을 바꾸지 않는다.
Numba가 없으면 None을 돌려주고 호출자는 기존 식을 쓴다(결과 같음).
"""
import math

import numpy as np

try:
    from numba import njit
except ImportError:          # Numba가 없으면 기존 식만 쓴다(결과 같음)
    njit = None

if njit is not None:
    @njit("float64(float64, float64, float64, float64, float64, float64)", cache=True)
    def _point_to_segment(px, py, ax, ay, bx, by):
        # GEOS algorithm::Distance::pointToSegment (3.14)과 같은 식·같은 순서. CoordinateXY::distance = sqrt(dx*dx + dy*dy).
        if ax == bx and ay == by:
            dx, dy = px - ax, py - ay
            return math.sqrt(dx * dx + dy * dy)
        len2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay)
        r = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2
        if r <= 0.0:
            dx, dy = px - ax, py - ay
            return math.sqrt(dx * dx + dy * dy)
        if r >= 1.0:
            dx, dy = px - bx, py - by
            return math.sqrt(dx * dx + dy * dy)
        s = ((ay - py) * (bx - ax) - (ax - px) * (by - ay)) / len2
        return abs(s) * math.sqrt(len2)

    @njit("void(float64[::1], float64[::1], float64[::1], float64[::1], float64[::1], float64[::1], float64, float64, "
          "float64[::1])", cache=True)
    def _min_segment_distance(px, py, ax, ay, bx, by, radius, cell, out):
        m = len(ax)
        x0 = y0 = np.inf
        x1 = y1 = -np.inf
        for k in range(m):
            x0 = min(x0, min(ax[k], bx[k]))
            y0 = min(y0, min(ay[k], by[k]))
            x1 = max(x1, max(ax[k], bx[k]))
            y1 = max(y1, max(ay[k], by[k]))
        x0 -= radius
        y0 -= radius
        x1 += radius
        y1 += radius
        nx = int((x1 - x0) // cell) + 1
        ny = int((y1 - y0) // cell) + 1
        count = np.zeros(nx * ny + 1, np.int64)
        for k in range(m):
            i0 = int((min(ax[k], bx[k]) - radius - x0) // cell)
            i1 = int((max(ax[k], bx[k]) + radius - x0) // cell)
            j0 = int((min(ay[k], by[k]) - radius - y0) // cell)
            j1 = int((max(ay[k], by[k]) + radius - y0) // cell)
            for i in range(max(i0, 0), min(i1, nx - 1) + 1):
                for j in range(max(j0, 0), min(j1, ny - 1) + 1):
                    count[i * ny + j + 1] += 1
        for c in range(nx * ny):
            count[c + 1] += count[c]
        fill = count[:-1].copy()
        seg = np.empty(count[nx * ny], np.int64)
        for k in range(m):
            i0 = int((min(ax[k], bx[k]) - radius - x0) // cell)
            i1 = int((max(ax[k], bx[k]) + radius - x0) // cell)
            j0 = int((min(ay[k], by[k]) - radius - y0) // cell)
            j1 = int((max(ay[k], by[k]) + radius - y0) // cell)
            for i in range(max(i0, 0), min(i1, nx - 1) + 1):
                for j in range(max(j0, 0), min(j1, ny - 1) + 1):
                    c = i * ny + j
                    seg[fill[c]] = k
                    fill[c] += 1
        for p in range(len(px)):
            x, y = px[p], py[p]
            if not (x0 <= x <= x1 and y0 <= y <= y1):
                continue
            i = min(int((x - x0) // cell), nx - 1)
            j = min(int((y - y0) // cell), ny - 1)
            c = i * ny + j
            best = out[p]
            for q in range(count[c], count[c + 1]):
                k = seg[q]
                d = _point_to_segment(x, y, ax[k], ay[k], bx[k], by[k])
                if d <= radius and d < best:
                    best = d
            out[p] = best


def min_segment_distance(x, y, u, v, radius, out):
    """out[p] = min(out[p], 선분 (u[k], v[k]) 중 GEOS 거리 <= radius인 것의 최소 거리). x, y는 node 좌표(m).

    격자 칸 크기는 2 * radius(최소 1 m). 칸마다 r만큼 넓힌 선분 bbox가 걸친 선분을 모두 담으므로 r 안의 선분은 빠짐이 없다.
    Numba가 없으면 None(호출자는 기존 STRtree 식을 쓴다)."""
    if njit is None:
        return None
    x = np.ascontiguousarray(x, np.float64)
    y = np.ascontiguousarray(y, np.float64)
    u, v = np.asarray(u, np.int64), np.asarray(v, np.int64)
    if not len(u):
        return out
    _min_segment_distance(x, y, np.ascontiguousarray(x[u]), np.ascontiguousarray(y[u]),
                          np.ascontiguousarray(x[v]), np.ascontiguousarray(y[v]),
                          float(radius), max(2.0 * float(radius), 1.0), out)
    return out

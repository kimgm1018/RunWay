"""Ordered array request graphs for LOOP; canonical consumers and Gate stay unchanged.

No NetworkX G/H objects are constructed here. Read-only views expose only the
operations used by canonical generation/features; NetworkX rollback uses legacy graphs.
"""
from bisect import bisect_left, bisect_right
from collections.abc import Mapping
import os

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.ops import transform

from . import graph as legacy
from . import shortest_path
from . import array_pair_kernels as K
from .array_components import component_layout, component_layout_fast
from .env_flags import flag as env_flag
from .fast_unique import sorted_unique

# S15P31E105-437: 작업판 생성의 Python 반복문을 배열/Numba로(결과 같음). "0"이면 기존 반복문(rollback, 재시작 필요).
_FAST_FLAG = os.environ.get("RUNWAY_ARRAY_PAIR_FAST", "1")
if _FAST_FLAG not in ("0", "1"):
    raise ValueError("RUNWAY_ARRAY_PAIR_FAST must be 0 or 1")
FAST = _FAST_FLAG == "1"
# S15P31E105-645 (env_flags 규칙, import 시 읽음, 둘 다 결과 같음):
#   RUNWAY_ARRAY_PAIR_KERNELS=0  build_array_pair의 처음 나온 순서 번호·pair별 가장 짧은 간선을 다시 np.unique·lexsort로,
#                                G node 번호 dict를 다시 dict comprehension으로
#   RUNWAY_ADAPTER_REUSE=0       요청 graph(populate_adapter)가 G의 node 번호 dict를 복사하고, 첫 간선을 G 간선 전체 lexsort로,
#                                양 끝 번호를 searchsorted로 다시 찾는다(예전 경로)
PAIR_KERNELS = env_flag("RUNWAY_ARRAY_PAIR_KERNELS")
ADAPTER_REUSE = env_flag("RUNWAY_ADAPTER_REUSE")


class _Selection:
    """Exact disk selection only; no duplicate CSR/components from the P2P mask."""
    def __init__(self, S, lat, lon, radius):
        self.S = S
        sc = S.sc
        cx, cy = legacy.busan.TO_UTM.transform(lon, lat)
        inside = ((S.xy[:, 0] - cx) ** 2 + (S.xy[:, 1] - cy) ** 2) <= radius ** 2
        self.sel = np.logical_or.reduceat(inside[sc.ref_pos], sc.ptr[:-1])
        if not self.sel.any():
            raise legacy.InsufficientResponseError("No data elements in server response. Check query location/filters and log.")
        cand = sorted_unique(sc.ref_pos[self.sel[S.way_of_ref]])
        self.disk_ll = legacy.busan._disk_ll(cx, cy, radius)
        self.keep = np.zeros(len(S.ids), bool)
        self.keep[cand[shapely.intersects_xy(self.disk_ll, S.lon[cand], S.lat[cand])]] = True
        if not self.keep.any():
            raise ValueError("Found no graph nodes within the requested polygon.")
        self.seg = np.flatnonzero(self.sel[S.seg_w] & self.keep[S.seg_a] & self.keep[S.seg_b])
        self.g_nodes = sorted_unique(np.r_[S.seg_a[self.seg], S.seg_b[self.seg]])

    def g_nodes_in_set_order(self):
        """build_array_pair의 g_nodes(= S.pos_of(list(_g_node_rank())))를 dict 없이 만든다.
        선택된 way의 node id를 way 순서·way 안 순서 그대로 한 번에(flat 배열 slice) 꺼내 같은 순서로 set에 넣는다.
        set(list)는 원소를 하나씩 넣으므로(presize 없음) way마다 update한 set과 순회 순서가 같다."""
        S = self.S
        used = set(S.ids[S.sc.ref_pos[self.sel[S.way_of_ref]]].tolist())
        alive = np.zeros(len(S.ids), bool)
        alive[self.g_nodes] = True
        pos = S.pos_of(list(used))
        return pos[alive[pos]]

    def _g_node_rank(self):
        used = set()
        for i in np.flatnonzero(self.sel):
            used.update(self.S.sc.refs[i])
        alive = np.zeros(len(self.S.ids), bool)
        alive[self.g_nodes] = True
        # set 순회 순서 그대로(같은 int를 같은 순서로 넣은 set). 위치 조회만 배열로 한 번에 한다.
        order = list(used)
        keep = alive[self.S.pos_of(order)].tolist()
        return {n: r for r, n in enumerate(n for n, k in zip(order, keep) if k)}


class ArraySource:
    """Request-independent normalized per-way rows, backed by the existing Substrate."""
    def __init__(self, substrate, *, prepared=None):
        if prepared is not None:
            prepared.array_source(self, substrate)
            self._status_codes(substrate.sc)
            return
        self.S = substrate
        sc = substrate.sc
        compact = getattr(substrate.src, "net", None) is not None
        self.h_templates = _HTemplates(sc) if compact else []   # 압축 도로망: 접근할 때 같은 dict를 만든다
        rows = []
        for i, wid in enumerate(sc.way_ids):
            raw = dict(sc.attrs[i], runway_status=sc.way_status[i], runway_reason=sc.way_reason[i])
            if not compact:
                self.h_templates.append({k: raw.get(k) for k in legacy.rrg.EDGE_ATTRS})
            rows.append({k: legacy._s(raw.get(k)) for k in legacy.EDGE_TAGS})
        self.way_table = pd.DataFrame(rows, columns=legacy.EDGE_TAGS)
        self.way_table["osmid"] = self.way_table["osmid"].astype("int64")
        # full_status 배열 경로용: way별 status 번호와 번호 -> 원래 문자열(처음 나온 way의 객체)
        self._status_codes(sc)

    def _status_codes(self, sc):
        codes, self.status_objs = {}, []
        for st in sc.way_status:
            if st not in codes:
                codes[st] = len(self.status_objs)
                self.status_objs.append(st)
        self.status_code = np.fromiter((codes[st] for st in sc.way_status), np.int64, len(sc.way_status))


class _HTemplates:
    """ArraySource.h_templates[i] built on access (rrg.EDGE_ATTRS of the way's raw attrs + status), same dict as the list."""

    def __init__(self, sc):
        self.sc = sc

    def __getitem__(self, i):
        sc = self.sc
        raw = dict(sc.attrs[i], runway_status=sc.way_status[i], runway_reason=sc.way_reason[i])
        return {k: raw.get(k) for k in legacy.rrg.EDGE_ATTRS}

    def __len__(self):
        return len(self.sc.way_ids)


class _Nodes(Mapping):
    def __init__(self, ids, index, x, y, projected=False):
        self.ids, self.index, self.x, self.y = ids, index, x, y
        self.projected = projected

    def __iter__(self):
        return iter(self.ids)

    def __len__(self):
        return len(self.ids)

    def __getitem__(self, node):
        i = self.index[node]
        if self.projected:
            return {"x": float(self.x[i]), "y": float(self.y[i])}
        return {"y": float(self.y[i]), "x": float(self.x[i])}

    def __call__(self, data=False, default=None):
        if data is False:
            return iter(self)
        if data is True:
            return ((n, self[n]) for n in self)
        return ((n, self[n].get(data, default)) for n in self)


class _HEdges:
    def __init__(self, H):
        self.H = H

    def __iter__(self):
        return ((self.H.csr.ids[a], self.H.csr.ids[b]) for a, b in zip(self.H.eu, self.H.ev))

    def __len__(self):
        return len(self.H.csr.keys)

    def __call__(self, data=False, default=None):
        if data is False:
            return iter(self)
        return ((u, v, self.H.edge_data(i) if data is True else self.H.edge_data(i).get(data, default))
                for i, (u, v) in enumerate(self))


class _Neighbors(Mapping):
    def __init__(self, H, node):
        self.H, self.node = H, node
        self.i = H.csr.index[node]

    def __iter__(self):
        c = self.H.csr
        return (c.ids[c.nbr[j]] for j in range(c.ptr[self.i], c.ptr[self.i + 1]))

    def __len__(self):
        c = self.H.csr
        return c.ptr[self.i + 1] - c.ptr[self.i]

    def __getitem__(self, other):
        return self.H.edge_data(self.H.csr.eid[legacy.rrg._key(self.node, other)])


class _Adjacency(Mapping):
    def __init__(self, H):
        self.H = H

    def __iter__(self):
        return iter(self.H.csr.ids)

    def __len__(self):
        return len(self.H.csr.ids)

    def __getitem__(self, node):
        return _Neighbors(self.H, node)


class ArrayH:
    def __init__(self, source, csr, xy, selected_segments, ends=None):
        self.source, self.csr, self.selected = source, csr, selected_segments
        self.xy = xy
        self.nodes = _Nodes(csr.ids, csr.index, xy[:, 0], xy[:, 1], projected=True)
        self._node = self.nodes
        self._adj = self.adj = _Adjacency(self)
        self.edges = _HEdges(self)
        self._data_cache = {}
        self._templates = {}   # way index -> h_templates[way] (압축 도로망 view를 간선마다 다시 만들지 않는다; 복사해서만 쓴다)
        if ends is not None:   # build_array_pair가 배열로 계산한 (eu, ev): 아래 식과 같은 값
            self.eu, self.ev = ends
        else:
            pairs = [(csr.index[a], csr.index[b]) for a, b in csr.keys]
            self.eu = np.array([min(a, b) for a, b in pairs], dtype=np.int64)
            self.ev = np.array([max(a, b) for a, b in pairs], dtype=np.int64)
        self.degrees = np.diff(csr.ptr).astype(np.int64)
        loops = self.eu[self.eu == self.ev]
        np.add.at(self.degrees, loops, 1)

    def edge_data(self, eid):
        data = self._data_cache.get(eid)
        if data is None:
            S = self.source.S
            way = int(S.seg_w[self.selected[eid]])
            tmpl = self._templates.get(way)
            if tmpl is None:
                tmpl = self._templates[way] = self.source.h_templates[way]
            data = dict(tmpl)
            data["length"] = float(self.csr.length[eid])
            self._data_cache[eid] = data
        return data

    def __iter__(self):
        return iter(self.csr.ids)

    def __len__(self):
        return len(self.csr.ids)

    def __contains__(self, node):
        return node in self.csr.index

    def __getitem__(self, node):
        return _Neighbors(self, node)

    def has_edge(self, a, b):
        return legacy.rrg._key(a, b) in self.csr.eid

    def degree(self, node):
        return int(self.degrees[self.csr.index[node]])


class _GEdges:
    def __init__(self, G):
        self.G = G

    def __len__(self):
        return len(self.G.a)

    def __iter__(self):
        G, S = self.G, self.G.source.S
        return ((int(S.ids[a]), int(S.ids[b])) for a, b in zip(G.a, G.b))

    def __call__(self, data=False, keys=False):
        G = self.G
        def values():
            previous, key = None, -1
            for i, pair in enumerate(self):
                key = key + 1 if pair == previous else 0
                previous = pair
                row = (*pair, key) if keys else pair
                if data is not False:
                    attrs = G.edge_data(i)
                    row = (*row, attrs if data is True else attrs.get(data))
                yield row
        return values()


_MISSING = object()   # ArrayG.get_edge_data: 없는 간선 표시


class ArrayG:
    _is_array_graph = True
    def __init__(self, source, g_nodes, a, b, segments, reverse, original_args):
        self.source, self.positions = source, g_nodes
        S = source.S
        self.node_ids = S.ids[g_nodes]
        if PAIR_KERNELS:   # 같은 dict(같은 Python int key, 같은 값, 같은 삽입 순서)를 C 반복으로
            self.node_index = dict(zip(self.node_ids.tolist(), range(len(self.node_ids))))
        else:
            self.node_index = {int(n): i for i, n in enumerate(self.node_ids)}
        self.lon, self.lat = S.lon[g_nodes], S.lat[g_nodes]
        self.nodes = _Nodes(self.node_ids.tolist(), self.node_index, self.lon, self.lat)
        self._node = self.nodes
        self.a, self.b, self.seg, self.reverse = a, b, segments, reverse
        self.original_args = original_args
        self.graph = {"crs": legacy.ox.settings.default_crs}
        self.edges = _GEdges(self)
        keys = a * len(S.ids) + b
        self._pairs, self._starts, self._counts = np.unique(keys, return_index=True, return_counts=True)
        self._edge_lookup = {}   # (a, b) -> 병렬 간선 사전 또는 _MISSING; graph와 함께 LRU에서 해제된다

    def __len__(self):
        return len(self.node_ids)

    def number_of_nodes(self):
        return len(self.node_ids)

    def edge_data(self, i):
        S = self.source.S
        way = int(S.seg_w[self.seg[i]])
        attrs = dict(S.sc.attrs[way], oneway=False, reversed=bool(self.reverse[i]))
        attrs["length"] = S.seg_len[self.seg[i]]
        attrs["runway_status"], attrs["runway_reason"] = S.sc.way_status[way], S.sc.way_reason[way]
        return attrs

    def get_edge_data(self, a, b, default=None):
        # 같은 방향 pair는 첫 조회 결과를 재사용한다(networkx처럼 같은 사전을 돌려주므로 호출자는 읽기만 한다).
        # 없는 간선은 _MISSING으로 기억하고 매 호출의 default를 그대로 돌려준다.
        pair = (int(a), int(b))
        data = self._edge_lookup.get(pair)
        if data is None:
            data = self._edge_lookup[pair] = self._find_edge_data(*pair)
        return default if data is _MISSING else data

    def _find_edge_data(self, a, b):
        S = self.source.S
        pa, pb = S.src.pos.get(a), S.src.pos.get(b)
        if pa is None or pb is None:
            return _MISSING
        key = pa * len(S.ids) + pb
        i = int(np.searchsorted(self._pairs, key))
        if i == len(self._pairs) or self._pairs[i] != key:
            return _MISSING
        start, count = int(self._starts[i]), int(self._counts[i])
        return {k: self.edge_data(start + k) for k in range(count)}

    def populate_adapter(self, cg):
        """CanonicalRoutingGraph._load without iterating/materializing G attribute dicts."""
        S = self.source.S
        cg.full = self
        # S15P31E105-645: node 번호 dict는 G와 같은 내용이고 둘 다 읽기만 한다(get/[]). 복사하지 않고 같은 객체를 쓴다.
        cg.node_ids, cg.node_index = self.node_ids.copy(), (self.node_index if ADAPTER_REUSE else dict(self.node_index))
        cg.lon, cg.lat = self.lon.copy(), self.lat.copy()
        cg.x, cg.y = cg._to_utm.transform(cg.lon, cg.lat)
        cg.node_highway = np.full(len(cg.node_ids), None, dtype=object)
        ways = S.seg_w[self.seg]
        # Canonical retains the first directed G edge for each unordered node pair+way.
        # S15P31E105-621: np.unique(rows, axis=0, return_index=True) + sort == each distinct (lo, hi, way)'s first
        # position, ascending. A stable lexsort + run starts gives the same indices without the row-view unique.
        first = self._adapter_first(S) if ADAPTER_REUSE else None
        if first is None:
            lo, hi = np.minimum(self.a, self.b), np.maximum(self.a, self.b)
            o = np.lexsort((ways, hi, lo))
            lo_o, hi_o, w_o = lo[o], hi[o], ways[o]
            start = np.ones(len(o), bool)
            start[1:] = (lo_o[1:] != lo_o[:-1]) | (hi_o[1:] != hi_o[:-1]) | (w_o[1:] != w_o[:-1])
            first = np.sort(o[start])
        e = self.source.way_table.iloc[ways[first]].reset_index(drop=True).copy()
        if ADAPTER_REUSE:
            # S15P31E105-645: G node 번호 = 창 node 위치 -> self.positions 안 위치(g_rank). 아래 searchsorted와 같은 값.
            g_rank = np.full(len(S.ids), -1, np.int64)
            g_rank[np.asarray(self.positions)] = np.arange(len(self.positions))
            u, v = g_rank[self.a[first]], g_rank[self.b[first]]
            if len(first) and ((u < 0).any() or (v < 0).any()):
                raise KeyError("populate_adapter: edge end outside the graph nodes")   # the dict lookup's error
        else:
            # cg.node_index[S.ids[p]] == p's position in self.positions (node_ids = S.ids[positions], ids are unique):
            # the same values by searchsorted instead of one dict lookup per edge.
            gord = np.argsort(self.positions, kind="stable")
            gpos = np.asarray(self.positions)[gord]
            ia, ib = np.searchsorted(gpos, self.a[first]), np.searchsorted(gpos, self.b[first])
            if len(first) and not (gpos[np.minimum(ia, len(gpos) - 1)] == self.a[first]).all()                 or len(first) and not (gpos[np.minimum(ib, len(gpos) - 1)] == self.b[first]).all():
                raise KeyError("populate_adapter: edge end outside the graph nodes")   # the dict lookup's error
            u, v = gord[ia].astype(np.int64), gord[ib].astype(np.int64)
        e["u"], e["v"] = np.minimum(u, v), np.maximum(u, v)
        e["osm_u"], e["osm_v"] = cg.node_ids[e["u"]], cg.node_ids[e["v"]]
        e["length"] = S.seg_len[self.seg[first]].astype(float)
        e["recovered"] = False
        cg.edges_all = e
        # S15P31E105-640: edges_all 행마다 그 행을 만든 창 segment 위치(env 거리 조회용, graph.attach_env)
        cg.edges_all_seg = np.asarray(self.seg[first], np.int64)
        pairs = pd.unique(e["u"].to_numpy() * 10**7 + e["v"].to_numpy())
        cg.full_degree = np.zeros(len(cg.node_ids), dtype=np.int32)
        np.add.at(cg.full_degree, pairs // 10**7, 1)
        np.add.at(cg.full_degree, pairs % 10**7, 1)
        cg.coverage_wgs = cg._coverage
        cg.coverage_utm = transform(cg._to_utm.transform, cg._coverage)
        cg.coverage_boundary_utm = cg.coverage_utm.boundary


    def _adapter_first(self, S):
        """populate_adapter의 first(서로 다른 (lo, hi, way)마다 G 순서로 처음 나온 간선 위치, 오름차순)를 창 segment 단위로.

        G 간선은 선택된 segment마다 정방향·역방향 두 개이고 둘의 (lo, hi, way)는 그 segment의 값과 같다. 그래서
        segment마다 G에서 처음 나온 위치(두 방향 중 앞)를 구하고, segment를 (lo, hi, way) 한 정수 key로 안정 정렬해
        묶음마다 가장 앞 위치를 고르면 G 간선 전체(2배 길이) 3열 lexsort와 같은 위치 집합이 된다. key가 int64를 넘을 수
        있거나 Numba가 없거나 segment마다 두 방향이 아니면 None(기존 lexsort)."""
        n, nw = len(S.ids), len(S.sc.way_ids)
        if n == 0 or nw == 0 or n * n * nw >= 2 ** 62:
            return None
        seg = np.asarray(self.seg, np.int64)
        pos = K.first_position(seg, len(S.seg_w))
        if pos is None:
            return None
        segs = np.flatnonzero(pos >= 0)
        if 2 * len(segs) != len(seg):
            return None
        sa, sb = S.seg_a[segs].astype(np.int64), S.seg_b[segs].astype(np.int64)
        key = (np.minimum(sa, sb) * n + np.maximum(sa, sb)) * nw + S.seg_w[segs].astype(np.int64)
        if not len(key):
            return np.empty(0, np.int64)
        o = np.argsort(key, kind="stable")
        ko = key[o]
        starts = np.flatnonzero(np.r_[True, ko[1:] != ko[:-1]])
        return np.sort(np.minimum.reduceat(pos[segs][o], starts))


class ArrayCSR:
    def mult_array(self, mult):
        return [mult.get(k, 1.0) for k in self.keys]


def build_array_pair(source, lat, lon, radius, region):
    """Exact disk -> original G/projected/H ordering -> metadata and read-only views."""
    S = source.S
    mask = _Selection(S, lat, lon, radius)
    seg, n = mask.seg, len(S.ids)
    sw = S.seg_w[seg]
    a, b, sg = np.r_[S.seg_a[seg], S.seg_b[seg]], np.r_[S.seg_b[seg], S.seg_a[seg]], np.r_[seg, seg]
    reverse = np.r_[np.zeros(len(seg), bool), np.ones(len(seg), bool)]
    insertion = np.lexsort((sg, reverse, np.r_[sw, sw]))
    a, b, sg, reverse = a[insertion], b[insertion], sg[insertion], reverse[insertion]
    g_nodes = mask.g_nodes_in_set_order() if FAST else S.pos_of(list(mask._g_node_rank()))
    g_rank = np.full(n, -1, np.int64)
    g_rank[g_nodes] = np.arange(len(g_nodes))
    _, pair_first, inverse = np.unique(a * n + b, return_index=True, return_inverse=True)
    event = np.arange(len(a))
    g_order = np.lexsort((event, pair_first[inverse], g_rank[a]))
    G = ArrayG(source, g_nodes, a[g_order], b[g_order], sg[g_order], reverse[g_order], (lat, lon, radius, region))
    flat = np.column_stack((a[g_order], b[g_order])).ravel()
    fr = K.first_rank(flat, n) if PAIR_KERNELS else None
    if fr is not None:   # S15P31E105-645: 처음 나온 순번(아래 np.unique + argsort와 같은 배열)을 한 번 훑어서
        projected, nodes, first = fr[0], None, None
    else:
        nodes, first = np.unique(flat, return_index=True)
        projected = np.full(n, -1, np.int64)
        projected[nodes[np.argsort(first)]] = np.arange(len(nodes))
    order = np.lexsort((event, pair_first[inverse], projected[a]))
    # full_status는 다른 결과와 독립이다. 배열 경로는 임시 배열이 커서, 작업판(H·CSR·component)이 쌓이기 전에 먼저 만든다
    # (메모리 최대치를 기존 이하로 유지; 값·순서는 그대로).
    # S15P31E105-640: dict 대신 정렬 배열 조회(_StatusMap). 같은 key에 같은 status 집합을 돌려준다.
    full_status = _StatusMap(source, G, g_rank[a[order]], g_rank[b[order]], sg[order]) if FAST else None
    run = order[S.runnable[S.seg_w[sg[order]]]]
    if not len(run):
        # Canonical route_graph_fast fails when its empty waypoint array indexes
        # H nodes. Preserve that existing API error instead of changing policy.
        raise IndexError("arrays used as indices must be of integer (or boolean) type")
    ra, rb, rs = a[run], b[run], sg[run]
    key = np.minimum(ra, rb) * n + np.maximum(ra, rb)
    lengths = S.seg_len[rs]
    sk = K.shortest_per_key(key, lengths) if PAIR_KERNELS else None
    if sk is not None:   # S15P31E105-645: key 안정 정렬 한 번 + 훑기(아래 np.unique·lexsort와 같은 first·best)
        first, best = sk
        uniq = by_shortest = keep = None
    else:
        uniq, first = np.unique(key, return_index=True)
        by_shortest = np.lexsort((np.arange(len(run)), lengths, key))
        keep = np.r_[True, key[by_shortest][1:] != key[by_shortest][:-1]]
        best = by_shortest[keep]
    flat = np.column_stack((ra, rb)).ravel()
    fr = K.first_rank(flat, n) if PAIR_KERNELS else None
    if fr is not None:
        h_rank, hn, hi = fr[0], fr[1], None
    else:
        hn, hi = np.unique(flat, return_index=True)
        hn = hn[np.argsort(hi)]
        h_rank = np.full(n, -1, np.int64)
        h_rank[hn] = np.arange(len(hn))
    ha, hb = ra[first], rb[first]
    other = ha != hb
    aa, bb = np.r_[ha, hb[other]], np.r_[hb, ha[other]]
    pair = np.r_[np.arange(len(first)), np.arange(len(first))[other]]
    horder = np.lexsort((np.r_[first, first[other]], h_rank[aa]))
    aa, bb, pair = aa[horder], bb[horder], pair[horder]
    _, edge_first = np.unique(pair, return_index=True)
    edge_order = np.argsort(edge_first)
    eid = np.empty(len(first), np.int64)
    eid[edge_order] = np.arange(len(first))
    csr = ArrayCSR()
    csr.ids = S.ids[hn].tolist()
    ptr = np.r_[0, np.cumsum(np.bincount(h_rank[aa], minlength=len(hn)))]
    nbr, ned, length = h_rank[bb], eid[pair], lengths[best][edge_order]
    csr.ptr = ptr.tolist()
    csr.nbr, csr.ned = nbr.tolist(), ned.tolist()
    csr.length = length.tolist()
    xy = S.xy[hn].copy()
    if not FAST:
        csr.index = {node: i for i, node in enumerate(csr.ids)}
        csr.keys = [(min(int(S.ids[ha[i]]), int(S.ids[hb[i]])), max(int(S.ids[ha[i]]), int(S.ids[hb[i]]))) for i in edge_order]
        csr.eid = {key: i for i, key in enumerate(csr.keys)}
        H = ArrayH(source, csr, xy, rs[best][edge_order])
        comp, comp_km = component_layout(csr)
        full_status = {}
        for i in order:
            u, v = int(S.ids[a[i]]), int(S.ids[b[i]])
            full_status.setdefault(legacy.rrg._key(u, v), set()).add(S.sc.way_status[int(S.seg_w[sg[i]])])
    else:
        # 같은 dict·list를 반복문 없이: 삽입 순서(= 원래 반복 순서)와 값(Python int / float / 같은 status 문자열)이 같다.
        csr.index = dict(zip(csr.ids, range(len(csr.ids))))
        ia, ib = S.ids[ha[edge_order]], S.ids[hb[edge_order]]
        csr.keys = list(zip(np.minimum(ia, ib).tolist(), np.maximum(ia, ib).tolist()))
        csr.eid = dict(zip(csr.keys, range(len(csr.keys))))
        ra_, rb_ = h_rank[ha[edge_order]], h_rank[hb[edge_order]]     # csr.index[key 양 끝] = h_rank
        H = ArrayH(source, csr, xy, rs[best][edge_order], ends=(np.minimum(ra_, rb_), np.maximum(ra_, rb_)))
        # 여기부터는 G·CSR·H에 복사가 끝난 생성용 배열이 필요 없다. component 계산 전에 놓아 메모리 최대치를 낮춘다(값 무관).
        del a, b, sg, reverse, insertion, g_rank, pair_first, inverse, event, g_order, flat, nodes, first, projected
        del order, run, ra, rb, key, uniq, by_shortest, keep, hi, aa, bb, pair, horder, ia, ib, ra_, rb_
        comp, comp_km, comp_idx = component_layout_fast(
            csr, np.asarray(ptr, np.int64), np.asarray(nbr, np.int64), np.asarray(ned, np.int64),
            np.asarray(length, np.float64))
    boundary = gpd.GeoSeries([mask.disk_ll], crs="EPSG:4326").to_crs(legacy.busan.UTM).iloc[0]
    rg = legacy.rrg.RouteGraph(region, H, legacy.busan.UTM, full_status, np.array(csr.ids), xy, comp, comp_km, boundary)
    if not FAST:
        pool = np.array([i for i, node in enumerate(csr.ids) if comp[node] == 0 and H.degree(node) >= 3])
    else:
        pool = np.flatnonzero((comp_idx == 0) & (H.degrees >= 3))
        if not len(pool):
            pool = np.array([])   # 원래 np.array([])는 float라 아래 index에서 같은 IndexError가 난다
    rg.wp_nodes, rg.wp_xy = rg.nodes[pool], xy[pool]
    rg._route_csr = csr
    rg._array_snap_endpoints = (xy[H.eu], xy[H.ev])
    return G, rg


class _StatusMap(Mapping):
    """rg.full_status를 dict 없이: {(작은 id, 큰 id): {status, ...}} 읽기 전용 Mapping (S15P31E105-640).

    _full_status(같은 입력)와 key 집합과 각 key의 status 집합이 같다(Mapping ==). 원래 dict는 무방향 pair마다 tuple과
    set을 만들어 서울 21.1 km에서 약 1.1–1.3 s(1 CPU)와 큰 메모리를 썼다. 소비자는 생성기 route_features의
    full_status.get(_key(a, b), set())뿐이라, (G 노드 번호 pair, status 번호)를 정렬해 두고 조회 때 bisect로 찾는다.
    G 노드 번호는 G.node_index(id -> 번호, 이미 있는 dict)로 얻는다. get은 매번 새 set을 돌려준다(읽기만 하는 호출자).
    한 번 찾은 key는 _memo에 둔다(같은 key -> 같은 set 객체, 원래 dict와 같음).
    순회(iter/items) 순서는 pair 번호 순이다(원래는 첫 등장 순; 순서를 쓰는 곳은 없고 graph.routegraph_sig는 정렬한다)."""

    def __init__(self, source, G, ga, gb, osg):
        n = len(G.node_ids)
        K = len(source.status_objs)
        st = source.status_code[source.S.seg_w[osg]]
        combo = sorted_unique((np.minimum(ga, gb) * n + np.maximum(ga, gb)) * K + st)
        pk = combo // K
        self._keys, self._codes = pk.tolist(), (combo % K).tolist()
        self._uniq = sorted_unique(pk)
        self._n, self._objs, self._index, self._ids = n, source.status_objs, G.node_index, G.node_ids
        self._memo = {}

    def _range(self, key):
        try:
            a, b = key
            if a > b:                      # dict key는 (작은 id, 큰 id)뿐이다
                return None
        except (TypeError, ValueError):
            return None
        ia, ib = self._index.get(a), self._index.get(b)
        if ia is None or ib is None:
            return None
        k = min(ia, ib) * self._n + max(ia, ib)
        i = bisect_left(self._keys, k)
        if i == len(self._keys) or self._keys[i] != k:
            return None
        return i, bisect_right(self._keys, k, i)

    def get(self, key, default=None):
        # 한 번 찾은 key는 기억한다(같은 graph에서 후보마다 같은 pair를 다시 묻는다). 원래 dict처럼 같은 key에는 같은 set 객체.
        hit = self._memo.get(key, _MISSING)        # hash 안 되는 key는 원래 dict.get처럼 TypeError
        if hit is _MISSING:
            r = self._range(key)
            if r is None:
                hit = None
            else:
                objs = self._objs
                hit = {objs[c] for c in self._codes[r[0]:r[1]]}
            self._memo[key] = hit
        return default if hit is None else hit

    def __getitem__(self, key):
        r = self.get(key)
        if r is None:
            raise KeyError(key)
        return r

    def __contains__(self, key):
        return self.get(key) is not None

    def __len__(self):
        return len(self._uniq)

    def __iter__(self):
        ids, n = self._ids, self._n
        ia, ib = ids[self._uniq // n], ids[self._uniq % n]
        return iter(zip(np.minimum(ia, ib).tolist(), np.maximum(ia, ib).tolist()))


def _full_status(source, oa, ob, osg):
    """{(작은 id, 큰 id): {status, ...}}: 원래 반복(order 순서로 setdefault(...).add(status))과 같은 dict.
    key 삽입 순서 = 그 무방향 pair가 처음 나온 순서, set에는 status를 처음 나온 순서로 넣는다(같은 원소 재삽입은 무변화)."""
    S = source.S
    n = len(S.ids)
    if not len(oa):
        return {}
    pk = np.minimum(oa, ob) * n + np.maximum(oa, ob)
    _, first, inv = np.unique(pk, return_index=True, return_inverse=True)
    by_first = np.argsort(first, kind="stable")
    grank = np.empty(len(first), np.int64)
    grank[by_first] = np.arange(len(first))
    g = grank[inv.ravel()]                       # 처음 나온 순서로 매긴 pair 번호
    st = source.status_code[S.seg_w[osg]]
    K = len(source.status_objs)
    _, pfirst = np.unique(g * K + st, return_index=True)
    pfirst.sort()                                # (pair, status) 첫 등장 위치 순서 = 원래 add 순서
    pg, ps = g[pfirst], st[pfirst]
    by = np.lexsort((pfirst, pg))                # pair 번호 순, 그 안에서 첫 등장 순
    pg, ps = pg[by], ps[by]
    fidx = first[by_first]
    ia, ib = S.ids[oa[fidx]], S.ids[ob[fidx]]
    keys = zip(np.minimum(ia, ib).tolist(), np.maximum(ia, ib).tolist())
    objs = source.status_objs
    bounds = np.r_[0, np.flatnonzero(pg[1:] != pg[:-1]) + 1, len(pg)]
    sets = [{objs[c]} for c in ps[bounds[:-1]].tolist()]
    for r in np.flatnonzero(np.diff(bounds) > 1).tolist():
        sets[r] = set(objs[c] for c in ps[bounds[r]:bounds[r + 1]].tolist())
    return dict(zip(keys, sets))


class ArrayLoopGenerator(legacy.FastGraphRouteGenerator):
    """Same logical canonical LRU; array physical representation only for active LOOP."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.array_source = None
        self.array_active = False
        flag = os.environ.get("RUNWAY_ARRAY_LOOP", "1")
        if flag not in ("0", "1"):
            raise ValueError("RUNWAY_ARRAY_LOOP must be 0 or 1")
        self.array_enabled = flag == "1" and self.sidecar is not None and shortest_path.BACKEND != "nx"

    def _graph(self, lat, lon, radius, region):
        if not self.array_enabled or self.array_source is None:
            return super()._graph(lat, lon, radius, region)
        key = (round(lat, 6), round(lon, 6), round(radius))
        if key in self._cache:
            self._cache.move_to_end(key)
            G, rg = self._cache[key]
            if not self.array_active and getattr(G, "_is_array_graph", False):
                # A rounded key hit must preserve the FIRST exact disk's arguments.
                G, rg = legacy.build_fast(self.sidecar, *G.original_args)
                self._cache[key] = (G, rg)
            return G, rg, True
        if not self.array_active:
            return super()._graph(lat, lon, radius, region)
        pair = build_array_pair(self.array_source, lat, lon, radius, region)
        self._cache[key] = pair
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return (*pair, False)

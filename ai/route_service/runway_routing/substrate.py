"""Global array substrate of the extract + exact disk masks: POINT_TO_POINT's two 8.5 km app-max disks without networkx.

요약: P2P의 app-max 탐색 영역(snap용, d_min용 disk 2개)을 배열 기반 exact disk mask로 제공한다.
위치: pipeline._shape의 P2P snap 단계. 후보 생성 graph는 대체하지 않는다.
주의: networkx disk graph와 집합·순서가 같아야 한다(PE5 선 순서 포함).

P2P snaps both ends on an app-maximum disk and measures d_min on a second one (snap.p2p_endpoints). Building those two
networkx graphs (110k nodes / 250k edges each) was ~60 % of a cold P2P request. Here the extract is held once as flat
arrays (Substrate, built at start-up) and each disk is a set of numpy masks (DiskMask) computed by build_fast's rules:

  ways   with any node inside the exact UTM circle                          (build_fast: inside -> reduceat)
  nodes  of those ways intersecting the lon/lat disk polygon (_disk_ll)      (build_fast: _intersect_index_quadrats)
  G      consecutive node pairs of selected ways with both ends kept; isolated nodes dropped
  H      RUNNABLE pairs of G; per node pair the shortest (the first on ties) (route_graph_fast: has_edge / <=)
  main   the longest connected component of H                                (route_graph_fast)

The sets are identical to the networkx graphs (nodes, edges, chosen way and length, main component, coordinates; verified
bit for bit on 10 disks), and the P2P results are identical to the networkx path (golden 4 modes + 30 random P2P). The
one order that reaches the output -- the PE5 blocking lines in G.edges() order, carried into the Gate input -- is
rebuilt exactly (_pe5_edges_in_G_order). LOOP / OUT_AND_BACK and the P2P generation disk still use networkx graphs.

RUNWAY_P2P_SUBSTRATE=0 switches back to the networkx app-max disks (snap.p2p_endpoints).

왜 app-max disk 2개만 대체하나: 이 두 disk(반경 8.5 km)는 snap과 최단거리 d_min만 계산하고 후보 생성에는 쓰이지 않는다.
그래서 배열 mask로 바꿔도 결과가 같다는 것을 집합 단위로 증명할 수 있었다. 생성 disk와 LOOP/OAB는 features, Gate,
canonical generator가 networkx graph를 직접 읽기 때문에 그대로 두었다(바꾸려면 그 소비자들을 모두 옮겨야 한다).

알려진 차이 1건(의도됨, 2026-10-29 승인): golden shadow 모드 GS-26의 out.canonical.graph.from_cache가
False(이전) -> True(현재). 이전에는 앞선 P2P 요청이 app-max networkx graph 2개를 generator LRU(4칸)에 넣어 GS-26이 쓸
graph를 밀어냈고, GS-26이 graph를 새로 만들었다. 지금은 app-max graph를 만들지 않아 그 graph가 cache에 남아 있고,
GS-26이 재사용한다(내용은 같다). 응답, 경로, Gate 로그는 동일하다. tools/route_regression/known_differences.json에 그 한 건만
정확한 위치로 등록되어 있다(from_cache 전체를 무시하지 않는다).
"""
import math
import time
from collections import OrderedDict
from itertools import groupby, pairwise

import geopandas as gpd
import numpy as np
import shapely
from osmnx import distance
from osmnx._errors import InsufficientResponseError
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from shapely.geometry import Point

from . import array_pair_kernels as K
from . import network_store
from . import snap as SNAP
from .data import RUNNABLE, api, classify
from .env_flags import flag as env_flag
from .fast_unique import sorted_unique
from .graph import Sidecar, cache_size_env

busan = api.busan
# disk masks kept for repeated P2P requests (a few MB each; results do not depend on it). RUNWAY_MASK_CACHE_SIZE, 기본 4
MASK_CACHE_SIZE = cache_size_env("RUNWAY_MASK_CACHE_SIZE")
# S15P31E105-653 (env_flags 규칙, import 시 읽음, 결과 같음): P2P 도착점 찾기(app-max disk mask 2개 + PE5 선 순서)의 빠른 계산.
#   prepared disk 원 판정, 쌍마다 가장 짧은 선분을 key 안정 정렬 한 번(Numba), 정렬된 node 집합을 bool 표시로,
#   PE5 선 순서에 필요한 G node 순번을 set 하나로(필요한 node만) 구한다. "0"이면 예전 식(rollback, 재시작 필요).
MASK_FAST = env_flag("RUNWAY_P2P_MASK_FAST")


def _sorted_unique_pos(parts, n: int, dtype) -> np.ndarray:
    """sorted_unique(np.r_[*parts]) for substrate positions 0 <= v < n: the same values and dtype, by a bool mark."""
    m = np.zeros(n, bool)
    for x in parts:
        m[x] = True
    return np.flatnonzero(m).astype(dtype, copy=False)


class Substrate:
    """The extract as flat arrays (BusanSource node order), built once: nodes, de-duplicated consecutive node pairs
    ("segments", great-circle length = osmnx's formula as in build_fast), per-way RUNNABLE / PE4 / PE5 / bridge flags.

    pipeline이 시작할 때 한 번 만든다(부산 extract 기준 약 30 MB). 요청마다 disk()로 DiskMask를 얻고, p2p_endpoints가
    snap.p2p_endpoints와 같은 info와 반환값을 만든다. mask LRU(MASK_CACHE_SIZE)는 반복 요청용이며 결과에 영향이 없다."""

    def __init__(self, gen, ug2: dict, *, prepared=None):
        t0 = time.perf_counter()
        if prepared is not None:
            prepared.substrate(self, gen, ug2)
            self.build_s = round(time.perf_counter() - t0, 2)
            return
        src = gen.source
        sc = gen.sidecar if gen.sidecar is not None else Sidecar(src)   # RUNWAY_FAST_GRAPH=0 has no sidecar
        self.gen, self.src, self.sc = gen, src, sc
        self.ids = src.node_ids
        self._pos_lookup = network_store._Lookup(self.ids)
        net = getattr(src, "net", None)
        if net is not None:   # 압축 도로망: 저장된 좌표·선분(network_store.segments = 아래 loop와 같은 식)
            ll = net["lonlat"]
            self.lon, self.lat = ll[:, 0].copy(), ll[:, 1].copy()
            self.xy = src.xy
            self.seg_w, self.seg_a, self.seg_b, self.seg_len = net["seg_w"], net["seg_a"], net["seg_b"], net["seg_len"]
        else:
            ll = np.array([src.lonlat[int(n)] for n in self.ids])
            self.lon, self.lat = ll[:, 0].copy(), ll[:, 1].copy()
            self.xy = src.xy
            pos = src.pos
            sw, sa, sb = [], [], []
            for i, refs in enumerate(sc.refs):
                nodes = [g[0] for g in groupby(refs)]
                for a, b in pairwise(nodes):
                    sw.append(i)
                    sa.append(pos[a])
                    sb.append(pos[b])
            self.seg_w = np.array(sw, np.int32)
            self.seg_a = np.array(sa, np.int64)
            self.seg_b = np.array(sb, np.int64)
            d = distance.great_circle(self.lat[self.seg_a], self.lon[self.seg_a], self.lat[self.seg_b], self.lon[self.seg_b])
            d[np.isnan(d)] = 0
            self.seg_len = d
        W = len(sc.way_ids)
        self.way_of_ref = np.repeat(np.arange(W), np.diff(sc.ptr))
        st = sc.way_status
        self.runnable = np.array([s == RUNNABLE for s in st])
        r4 = ug2["end_point_rules"]["PE4"]["forbidden_incident_edges"]
        r5 = ug2["end_point_rules"]["PE5"]["blocking_edges"]
        h4, s4, h5, s5 = set(r4["highways"]), set(r4["status"]), set(r5["highways"]), set(r5["status"])
        pe4, pe5, bridge = [], [], []
        for a, s in zip(sc.attrs, st):
            d_ = {**a, "runway_status": s}
            pe4.append(bool(SNAP._hw(d_) & h4) or SNAP._s(s) in s4 or SNAP._road_tunnel(d_))
            pe5.append(bool(SNAP._hw(d_) & h5) or SNAP._s(s) in s5)
        if net is not None:
            # usability_gate.end_node_on_bridge reads the raw way tags + classify. bridge와 classify가 읽는 RULE_TAGS는 모두
            # useful tag라 attrs 값이 원본 tag 값과 같고(str), classify(원본) == classify(attrs) == way_status다.
            for a, s in zip(sc.attrs, st):
                bridge.append(a.get("bridge") not in (None, "", "no") and s == RUNNABLE)
        else:
            for w in sc.way_ids:                      # usability_gate.end_node_on_bridge reads the raw way tags + classify
                tags = src.ways[w][1]
                bridge.append(tags.get("bridge") not in (None, "", "no") and classify(tags)[0] == RUNNABLE)
        self.pe4, self.pe5, self.bridge = np.array(pe4), np.array(pe5), np.array(bridge)
        self._masks: OrderedDict = OrderedDict()
        self.build_s = round(time.perf_counter() - t0, 2)

    def pos_of(self, node_ids) -> np.ndarray:
        """Substrate positions (int64) of OSM node ids, all present (src.pos[n] for each, without the dict)."""
        return self._pos_lookup.many(np.asarray(node_ids, dtype=np.int64))

    def disk(self, lat: float, lon: float, radius: float) -> "DiskMask":
        """DiskMask of the generator's disk key (round(lat, 6), round(lon, 6), round(radius)); small LRU."""
        key = (round(lat, 6), round(lon, 6), round(radius))
        m = self._masks.get(key)
        if m is None:
            m = self._masks[key] = DiskMask(self, lat, lon, radius)
            while len(self._masks) > MASK_CACHE_SIZE:
                self._masks.popitem(last=False)
        else:
            self._masks.move_to_end(key)
        return m

    def p2p_endpoints(self, gen, clat, clon, lat, lon, end_lat, end_lon, info: dict, shape_cfg: dict, ug2: dict, env: dict):
        """snap.p2p_endpoints (same rules, same info, same return) on two DiskMasks instead of two networkx graphs."""
        app_max_m = shape_cfg["app_km"]["max"] * 1000
        tol = shape_cfg["tolerance"]["value"]
        rad = gen.working_radius_m(app_max_m)
        gen._check_coverage(clat, clon, rad)
        D = self.disk(clat, clon, rad)
        snap = D.snap_start(lat, lon)
        s = int(snap["start_node"])
        e = D.snap_end(end_lat, end_lon, ug2, env)
        info["start"] = {"node": s, "snap_node_dist_m": snap["snap_node_dist_m"], "shift_to_main_m": snap["shift_to_main_m"]}
        info["end"] = {"node": e["node"], "snap_m": e["snap_m"], "rejected": e["rejected"]}
        info["start_node"], info["end_node"] = s, e["node"]
        if e["node"] is None:
            info["_issues"] = [{"code": f"END_SNAP_{e['code']}",
                                "message": "도착지 근처에서 달릴 수 있는 안전한 길을 찾지 못했어요.", "blocking": True}]
            return None
        t = int(e["node"])
        info["_pe5"] = e["pe5_inputs"]
        (sx, sy), (tx, ty) = D.xy_of(s), D.xy_of(t)
        m_lon, m_lat = SNAP.TO_LL.transform((sx + tx) / 2, (sy + ty) / 2)
        if math.hypot(*np.subtract(SNAP.to_utm(m_lon, m_lat), SNAP.to_utm(clon, clat))) > 1.0:
            gen._check_coverage(m_lat, m_lon, rad)
            D = self.disk(m_lat, m_lon, rad)
        info["d_min_disk"] = {"centre_lat": m_lat, "centre_lon": m_lon, "radius_m": rad}
        if not D.has(s) or not D.has(t):
            info["d_min_m"] = None
            return (1 + tol) * app_max_m * 1.0001
        p = D.shortest_len(s, t)
        if p is None:
            info["d_min_m"] = None
            return (1 + tol) * app_max_m * 1.0001   # no path within the 8.5 km disk -> OUT_OF_APP_RANGE
        info["d_min_m"] = float(p)
        return float(p)


class DiskMask:
    """One disk of the substrate: G / H as index arrays, H's CSR matrix and components.

    생성(__init__)이 mask를 만드는 곳이다: build_fast와 같은 규칙으로 way → node → G 선분 → H(RUNNABLE, 쌍마다 가장 짧은 것,
    동점은 먼저 나온 것) → main component. networkx graph의 node/edge 집합, 길이, main component와 bit 단위로 같아야 한다.
    snap_start / snap_end / shortest_len이 snap.start / snap.snap_end / nx.shortest_path_length를 대신한다."""

    def __init__(self, S: Substrate, lat, lon, radius):
        t0 = time.perf_counter()
        sc = S.sc
        cx, cy = busan.TO_UTM.transform(lon, lat)
        inside = ((S.xy[:, 0] - cx) ** 2 + (S.xy[:, 1] - cy) ** 2) <= radius ** 2
        sel = np.logical_or.reduceat(inside[sc.ref_pos], sc.ptr[:-1])
        if not sel.any():
            raise InsufficientResponseError("No data elements in server response. Check query location/filters and log.")
        cand = sorted_unique(sc.ref_pos[sel[S.way_of_ref]])
        self.disk_ll = busan._disk_ll(cx, cy, radius)
        if MASK_FAST:   # prepared geometry: the same exact predicate, indexed (GEOS PreparedGeometry)
            shapely.prepare(self.disk_ll)
        keep = np.zeros(len(S.ids), bool)
        keep[cand[shapely.intersects_xy(self.disk_ll, S.lon[cand], S.lat[cand])]] = True
        if not keep.any():
            raise ValueError("Found no graph nodes within the requested polygon.")
        segm = sel[S.seg_w] & keep[S.seg_a] & keep[S.seg_b]
        self.S, self.seg = S, np.flatnonzero(segm)
        self.sel, self.keep = sel, keep
        n_ids = len(S.ids)
        sa_, sb_ = S.seg_a[self.seg], S.seg_b[self.seg]
        self.g_nodes = (_sorted_unique_pos((sa_, sb_), n_ids, sa_.dtype) if MASK_FAST
                        else sorted_unique(np.r_[sa_, sb_]))
        run = self.seg[S.runnable[S.seg_w[self.seg]]]
        a, b, ln = S.seg_a[run], S.seg_b[run], S.seg_len[run]
        lo, hi = np.minimum(a, b), np.maximum(a, b)
        key = lo * n_ids + hi
        sk = K.shortest_per_key(key, ln) if MASK_FAST and len(run) else None   # 빈 RUNNABLE: 예전 식 그대로(같은 예외)
        if sk is not None:   # key 안정 정렬 한 번 + 훑기 = 아래 lexsort의 key별 첫 행(같은 순서: key 오름차순)
            pick = sk[1]
        else:
            order = np.lexsort((np.arange(len(run)), ln, key))       # per pair: shortest, then first
            first = np.r_[True, key[order][1:] != key[order][:-1]]
            pick = order[first]
        self.h_seg = run[pick]
        self.h_lo, self.h_hi, self.h_len = lo[pick], hi[pick], ln[pick]
        if MASK_FAST:
            hn = _sorted_unique_pos((self.h_lo, self.h_hi), n_ids, self.h_lo.dtype)
            inv = np.empty(n_ids, np.int32 if len(hn) < 2 ** 31 else np.int64)
            inv[hn] = np.arange(len(hn))
            ia, ib = inv[self.h_lo].astype(np.intp), inv[self.h_hi].astype(np.intp)   # = searchsorted(hn, ...)
            del inv
        else:
            hn = sorted_unique(np.r_[self.h_lo, self.h_hi])
            ia, ib = np.searchsorted(hn, self.h_lo), np.searchsorted(hn, self.h_hi)
        self.h_nodes = hn                                           # substrate positions
        n = len(hn)
        self.A = csr_matrix((np.r_[self.h_len, self.h_len], (np.r_[ia, ib], np.r_[ib, ia])), shape=(n, n))
        ncomp, lab = connected_components(self.A, directed=False)
        km = np.bincount(lab[ia], weights=self.h_len, minlength=ncomp)
        self.main = lab == int(np.argmax(km))
        self.mask_s = round(time.perf_counter() - t0, 3)

    def snap_start(self, lat, lon) -> dict:
        """The canonical start snap (rrg.snap_start): nearest H node, moved to the nearest main-component node."""
        S = self.S
        p = gpd.GeoSeries([Point(lon, lat)], crs="EPSG:4326").to_crs(busan.UTM).iloc[0]
        hx, hy = S.xy[self.h_nodes, 0], S.xy[self.h_nodes, 1]
        d2 = (hx - p.x) ** 2 + (hy - p.y) ** 2
        i = int(d2.argmin())
        d_node = float(math.sqrt(d2[i]))
        info = {"nearest_node": int(S.ids[self.h_nodes[i]]), "snap_node_dist_m": round(d_node, 1)}
        if self.main[i]:
            info["start_node"], info["shift_to_main_m"] = int(S.ids[self.h_nodes[i]]), 0.0
        else:
            m = np.flatnonzero(self.main)
            j = int(d2[m].argmin())
            info["start_node"], info["shift_to_main_m"] = int(S.ids[self.h_nodes[m[j]]]), round(float(math.sqrt(d2[m][j])), 1)
        return info

    def snap_end(self, lat, lon, ug2, env) -> dict:
        """snap.snap_end on the mask: main-component nodes within PE1, nearest first, PE4 / PE5 (same pe5_blocked)."""
        S = self.S
        max_m = ug2["end_point_rules"]["PE1"]["max_destination_snap_m"]
        px, py = SNAP.to_utm(lon, lat)
        m = np.flatnonzero(self.main)
        nodes = self.h_nodes[m]
        d = np.hypot(S.xy[nodes, 0] - px, S.xy[nodes, 1] - py)
        if MASK_FAST:   # PE1 안의 node만 안정 정렬: 아래 반복이 보는 앞부분(d <= max_m)의 순서가 전체 안정 정렬과 같다
            near_k = np.flatnonzero(d <= max_m)
            order = near_k[np.argsort(d[near_k], kind="stable")]
        else:
            order = np.argsort(d, kind="stable")
        sa, sb, sw = S.seg_a[self.seg], S.seg_b[self.seg], S.seg_w[self.seg]
        f4 = S.pe4[sw]
        forbidden = set(S.ids[np.r_[sa[f4], sb[f4]]].tolist())
        edges = self._pe5_edges_in_G_order(lon, lat)
        lines, polys = SNAP.env_geoms(env, ug2["end_point_rules"]["PE5"]["blocking_env_classes"])
        lines, polys = SNAP.near(lines, lon, lat), SNAP.near(polys, lon, lat)
        rejected = []
        for k in order:
            if d[k] > max_m:
                break
            pnode = nodes[k]
            n = int(S.ids[pnode])
            if n in forbidden:
                rejected.append(("PE4", n))
                continue
            inc = (sa == pnode) | (sb == pnode)
            is_bridge = bool(S.bridge[sw[inc]].any())
            if SNAP.pe5_blocked((lon, lat), (S.lon[pnode], S.lat[pnode]), edges, polys, lines, end_is_bridge=is_bridge):
                rejected.append(("PE5", n))
                continue
            return {"node": n, "snap_m": float(d[k]), "code": None, "rejected": rejected,
                    "pe5_inputs": {"edge_lines": edges, "env_polys": polys, "env_lines": lines}}
        codes = {c for c, _ in rejected}
        code = "PE5" if "PE5" in codes else "PE4" if "PE4" in codes else "PE1"
        return {"node": None, "snap_m": None, "code": code, "rejected": rejected,
                "pe5_inputs": {"edge_lines": edges, "env_polys": polys, "env_lines": lines}}

    def _g_node_rank(self) -> dict:
        """Position of every G node in networkx's node order: the Python set build_fast iterates (way order), kept."""
        sc, S = self.S.sc, self.S
        used = set()
        for i in np.flatnonzero(self.sel):
            used.update(sc.refs[i])
        alive = np.zeros(len(S.ids), bool)
        alive[self.g_nodes] = True
        order = list(used)                       # set 순회 순서 그대로; 위치 조회만 배열로
        keep = alive[S.pos_of(order)].tolist()
        return {n: r for r, n in enumerate(n for n, k in zip(order, keep) if k)}

    def _g_node_rank_of(self, nodes) -> dict:
        """{n: key} for the given G nodes, ordered exactly as _g_node_rank()[n] (only comparisons are used: the sort in
        _pe5_edges_in_G_order). The key is n's position in the iteration order of the same Python set _g_node_rank
        builds: the selected ways' node ids in way order and in-way order (one flat slice, = sc.refs[i] for each
        selected way i), inserted one by one (set(list) has no presize, so its table and iteration order equal the
        set grown by per-way update()). _g_node_rank's rank is the position among the alive (G) nodes of that same order,
        a strictly increasing function of this position for G nodes."""
        S = self.S
        used = set(S.ids[S.sc.ref_pos[self.sel[S.way_of_ref]]].tolist())
        want, out = set(nodes), {}
        for i, n in enumerate(used):
            if n in want:
                out[n] = i
                if len(out) == len(want):
                    break
        return out

    def _pe5_edges_in_G_order(self, lon, lat) -> tuple:
        """snap.pe5_blockers(G) + near(): every blocking directed edge of G (both directions, multi-edge keys) whose
        line meets the 0.004 deg box, in G.edges() order (node order -> first insertion of the target in the node's
        adjacency -> key order). build_fast's insertion events: per selected way, forward pairs, then reversed pairs.
        The order matters: the lines go into the Gate's RouteInput and the internal out."""
        S = self.S
        seg = self.seg
        sw, sa, sb = S.seg_w[seg], S.seg_a[seg], S.seg_b[seg]
        f5 = np.flatnonzero(S.pe5[sw])
        if not len(f5):
            return ()
        box = shapely.box(lon - 0.004, lat - 0.004, lon + 0.004, lat + 0.004)
        Lf = shapely.linestrings(np.stack([np.c_[S.lon[sa[f5]], S.lat[sa[f5]]], np.c_[S.lon[sb[f5]], S.lat[sb[f5]]]], axis=1))
        hit = f5[shapely.intersects(Lf, box)]
        if not len(hit):
            return ()
        ids, pos = S.ids, S.src.pos
        directed = []
        for k in hit:
            directed.append((int(ids[sa[k]]), int(ids[sb[k]]), (int(sw[k]), 0, int(seg[k]))))
            directed.append((int(ids[sb[k]]), int(ids[sa[k]]), (int(sw[k]), 1, int(seg[k]))))
        rank = self._g_node_rank_of({d[0] for d in directed}) if MASK_FAST else self._g_node_rank()
        adj_rank = {}
        for u in {d[0] for d in directed}:               # u's out-edge events over ALL kept segments of G
            pu = pos[u]
            first = {}
            for m in np.flatnonzero((sa == pu) | (sb == pu)):
                if sa[m] == pu:
                    ev, v = (int(sw[m]), 0, int(seg[m])), int(ids[sb[m]])
                else:
                    ev, v = (int(sw[m]), 1, int(seg[m])), int(ids[sa[m]])
                if v not in first or ev < first[v]:
                    first[v] = ev
            for r, v in enumerate(sorted(first, key=first.get)):
                adj_rank[(u, v)] = r
        directed.sort(key=lambda d: (rank[d[0]], adj_rank[(d[0], d[1])], d[2]))
        return tuple(shapely.LineString([(S.lon[pos[u]], S.lat[pos[u]]), (S.lon[pos[v]], S.lat[pos[v]])])
                     for u, v, _ in directed)

    def has(self, osm_id) -> bool:
        p = self.S.src.pos.get(int(osm_id))
        if p is None:
            return False
        i = np.searchsorted(self.h_nodes, p)
        return i < len(self.h_nodes) and self.h_nodes[i] == p

    def shortest_len(self, s, t):
        """Shortest RUNNABLE path length s -> t on H (None when unreachable)."""
        S = self.S
        i = int(np.searchsorted(self.h_nodes, S.src.pos[int(s)]))
        j = int(np.searchsorted(self.h_nodes, S.src.pos[int(t)]))
        d = dijkstra(self.A, directed=False, indices=i)[j]
        return None if not np.isfinite(d) else float(d)

    def xy_of(self, osm_id):
        p = self.S.src.pos[int(osm_id)]
        return float(self.S.xy[p, 0]), float(self.S.xy[p, 1])

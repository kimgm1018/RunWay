"""Canonical interface of the RunWay round-trip route generator (integration entry point).

Other modules (Environment, Preference) should call this file only. It wraps, without changing:
  - analysis/runway_busan_graph.py      Busan highway extract -> start-centred classified graph
  - analysis/runway_walk_filter.py      classify(): RUNNABLE / EXCLUDED / UNCERTAIN per edge
  - analysis/runway_route_generator.py  make_candidate / route_features / dedupe (the algorithm)
The cached 3 km survey graphs (runway_route_generator.run / load_graph) are a PoC reference only.

Request:  start_lat, start_lon, target_distance_m, seed (default 1000), candidate_count (default 10)
Response: RouteResponse with up to candidate_count distinct closed routes on RUNNABLE edges only,
          each with geometry, node / edge sequence and every route feature computed today.
          No scoring or ranking: candidates are in generation (seed) order.

Graph: working radius R_work = (1 + 0.10) * L / 2 + 250 m around the input point
(runway_busan_graph.working_radius), cut from data/osm/busan/busan_highways_<date>.osm.pbf.

Usage (library only; the verify / benchmark / route CLI was removed with the Route service split, S15P31E105-381):
    from runway_route_api import RouteGenerator
    gen = RouteGenerator()                                  # loads the Busan extract once (~15 s)
    res = gen.generate(35.1509, 129.1168, 5000, seed=1000, candidate_count=10)
    res.to_dict()
"""
import json
import sys
import time
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point, box

sys.path.insert(0, str(Path(__file__).resolve().parent))  # -I drops the script dir from sys.path
import runway_busan_graph as busan  # noqa: E402
import runway_route_generator as rrg  # noqa: E402

SCHEMA = "runway.route.v1"
DEFAULT_SEED = rrg.SEED0          # 1000: reproduces the reported Busan runs
DEFAULT_CANDIDATES = 10
DEFAULT_ATTEMPTS = rrg.ATTEMPTS   # 40 generation attempts per request
GRAPH_CACHE_SIZE = 4              # recent (start, radius) graphs kept for repeated calls at one start

# Route features copied from runway_route_generator.route_features into RouteCandidate.features.
FEATURE_KEYS = [
    "node_count", "edge_count", "unique_edge_count",
    "unique_edge_ratio", "repeated_edge_ratio", "out_and_back_ratio", "route_shape",
    "loop_compactness", "enclosed_area_km2", "self_crossing_count", "node_revisit_count", "uturn_count",
    "intersection_count", "intersection_per_km", "turns_per_km", "minor_road_turns_per_km",
    "footway_ratio", "pedestrian_ratio", "path_ratio", "residential_ratio", "service_ratio",
    "tertiary_ratio", "secondary_ratio", "major_road_ratio", "trail_ratio", "walk_dedicated_ratio",
    "cycleway_ratio", "steps_count", "steps_length_m", "bridge_length_m", "tunnel_length_m",
    "max_dist_from_start_m", "min_dist_to_bbox_edge_m", "bbox_edge_hug_m",
]


class OutOfCoverageError(ValueError):
    """The working disk is not fully inside the local extract; the graph would be cut at its edge."""


@dataclass
class RouteCandidate:
    candidate_id: int                 # = seed of the attempt that produced it (stable for a request)
    label: str                        # "Candidate n", generation order, not a rank
    geometry: dict                    # GeoJSON LineString, WGS84 [lon, lat], closed (first == last)
    node_sequence: list               # OSM node ids, closed
    edge_sequence: list               # one dict per traversed edge: u, v, osm_way_id, highway, name, length_m
    distance_m: float
    target_distance_m: float
    distance_error_pct: float         # 100 * (distance - target) / target
    features: dict                    # FEATURE_KEYS
    flags: list                       # quality flags that do not disqualify (see interface doc)
    generation: dict                  # waypoints, k, iterations, spurs_trimmed, theta_deg, rho_m


@dataclass
class RouteResponse:
    schema: str
    request: dict
    status: str                       # "ok" | "shortfall" (fewer than requested) | "no_candidates"
    warnings: list
    start: dict
    graph: dict
    counts: dict
    timings_s: dict
    candidates: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


class RouteGenerator:
    """Canonical round-trip generator. Not thread-safe (OSMnx settings are global): one per worker."""

    def __init__(self, extract_path: Path | None = None, graph_cache_size: int = GRAPH_CACHE_SIZE):
        t0 = time.perf_counter()
        self.source = busan.BusanSource(extract_path)
        meta = json.loads((busan.BUSAN_DIR / "EXTRACT.json").read_text(encoding="utf-8"))
        self.extract = {"file": self.source.path.name, "osm_data_timestamp": meta.get("osm_data_timestamp"),
                        "bbox_wsen": list(busan.BUSAN_BBOX)}
        self._extract_poly = gpd.GeoSeries([box(*busan.BUSAN_BBOX)], crs="EPSG:4326").to_crs(busan.UTM).iloc[0]
        self._cache: OrderedDict = OrderedDict()
        self._cache_size = graph_cache_size
        self.load_seconds = round(time.perf_counter() - t0, 2)

    @staticmethod
    def working_radius_m(target_distance_m: float) -> float:
        """R_work = 0.55 L + 250 m (runway_busan_graph.working_radius)."""
        return busan.working_radius(target_distance_m)

    def _graph(self, lat: float, lon: float, radius: float, region) -> tuple:
        key = (round(lat, 6), round(lon, 6), round(radius))
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key] + (True,)
        G, disk = self.source.disk_graph(lat, lon, radius)
        rg = busan.route_graph(G, disk, region)
        self._cache[key] = (G, rg)
        while len(self._cache) > self._cache_size:
            self._cache.popitem(last=False)
        return G, rg, False

    def subgraph(self, start_lat: float, start_lon: float, target_distance_m: float):
        """The classified graph (all statuses, WGS84 MultiDiGraph) a request at this start would route on."""
        rad = self.working_radius_m(target_distance_m)
        self._check_coverage(start_lat, start_lon, rad)
        return self._graph(start_lat, start_lon, rad, _region(start_lat, start_lon))[0]

    def _check_coverage(self, lat: float, lon: float, rad: float) -> float:
        margin = self._extract_poly.exterior.distance(Point(busan.TO_UTM.transform(lon, lat))) - rad
        inside = self._extract_poly.contains(Point(busan.TO_UTM.transform(lon, lat)))
        if not inside or margin <= 0:
            raise OutOfCoverageError(f"working disk r={rad:.0f} m around ({lat}, {lon}) is not inside the extract "
                                     f"bbox {busan.BUSAN_BBOX} (margin {margin:.0f} m)")
        return margin

    def generate(self, start_lat: float, start_lon: float, target_distance_m: float,
                 seed: int = DEFAULT_SEED, candidate_count: int = DEFAULT_CANDIDATES,
                 max_attempts: int = DEFAULT_ATTEMPTS) -> RouteResponse:
        if target_distance_m <= 0 or candidate_count <= 0 or max_attempts <= 0:
            raise ValueError("target_distance_m, candidate_count and max_attempts must be positive")
        t0 = time.perf_counter()
        rad = self.working_radius_m(target_distance_m)
        margin = self._check_coverage(start_lat, start_lon, rad)
        G, rg, cached = self._graph(start_lat, start_lon, rad, _region(start_lat, start_lon))
        t1 = time.perf_counter()

        snap = rrg.snap_start(rg, start_lat, start_lon)
        start = snap["start_node"]
        rows, paths = [], {}
        for i in range(max_attempts):
            c = rrg.make_candidate(rg, start, target_distance_m, seed + i)
            if c["failure"]:
                rows.append(c)
                continue
            path = c.pop("path")
            paths[c["seed"]] = path
            rows.append({**{k: v for k, v in c.items() if k != "err"}, **rrg.route_features(rg, path, target_distance_m)})
        ok = [c for c in rows if not c["failure"]]
        valid = [c for c in ok if c["valid"]]
        good = [c for c in valid if c["quality_ok"]]
        distinct, _ = rrg.dedupe(good, rrg.DEDUP_OVERLAP)        # seed order
        chosen = distinct[:candidate_count]
        t2 = time.perf_counter()

        cands = [self._candidate(rg, c, paths[c["seed"]], n, target_distance_m) for n, c in enumerate(chosen, 1)]
        warnings = []
        if snap["snap_node_dist_m"] > busan.WORK_BUFFER_M:
            warnings.append(f"start_far_from_network: nearest runnable node {snap['snap_node_dist_m']} m away "
                            f"(> {busan.WORK_BUFFER_M} m buffer)")
        if not snap["start_in_main_component"]:
            warnings.append(f"start_moved_to_main_component: {snap['shift_to_main_m']} m")
        status = "no_candidates" if not cands else "shortfall" if len(cands) < candidate_count else "ok"
        sx, sy = rg.H.nodes[start]["x"], rg.H.nodes[start]["y"]
        slon, slat = busan.TO_LL.transform(sx, sy)
        return RouteResponse(
            schema=SCHEMA,
            request={"start_lat": start_lat, "start_lon": start_lon, "target_distance_m": target_distance_m,
                     "seed": seed, "candidate_count": candidate_count, "max_attempts": max_attempts},
            status=status, warnings=warnings,
            start={"input_lat": start_lat, "input_lon": start_lon, "node_id": int(start),
                   "node_lat": round(slat, 7), "node_lon": round(slon, 7),
                   "snap_node_dist_m": snap["snap_node_dist_m"], "snap_edge_dist_m": snap["snap_edge_dist_m"],
                   "in_main_component": bool(snap["start_in_main_component"]),
                   "shift_to_main_m": snap["shift_to_main_m"]},
            graph={**self.extract, "working_radius_m": round(rad), "radius_rule": "(1 + 0.10) * L / 2 + 250 m",
                   "disk_margin_to_extract_edge_m": round(margin), "nodes": G.number_of_nodes(),
                   "runnable_km": round(sum(rg.comp_km), 2),
                   "main_component_pct_km": round(100 * rg.comp_km[0] / sum(rg.comp_km), 1),
                   "from_cache": cached},
            counts={"attempts": max_attempts, "generated": len(ok), "valid": len(valid),
                    "quality_ok": len(good), "distinct": len(distinct), "returned": len(cands)},
            timings_s={"graph": round(t1 - t0, 2), "generate": round(t2 - t1, 2),
                       "total": round(time.perf_counter() - t0, 2)},
            candidates=cands)

    @staticmethod
    def _candidate(rg, c: dict, path: list, n: int, target: float) -> RouteCandidate:
        H = rg.H
        xs = [H.nodes[p]["x"] for p in path]
        ys = [H.nodes[p]["y"] for p in path]
        lon, lat = busan.TO_LL.transform(xs, ys)
        edges = [{"u": int(a), "v": int(b), "osm_way_id": int(H[a][b]["osmid"]), "highway": H[a][b]["highway"],
                  "name": H[a][b].get("name"), "length_m": round(float(H[a][b]["length"]), 2)}
                 for a, b in zip(path[:-1], path[1:])]
        return RouteCandidate(
            candidate_id=int(c["seed"]), label=f"Candidate {n}",
            geometry={"type": "LineString", "coordinates": [[round(x, 7), round(y, 7)] for x, y in zip(lon, lat)]},
            node_sequence=[int(p) for p in path], edge_sequence=edges,
            distance_m=c["distance_m"], target_distance_m=target, distance_error_pct=c["distance_error_pct"],
            features={k: (c[k].item() if hasattr(c[k], "item") else c[k]) for k in FEATURE_KEYS},
            flags=[f for f in c["flags"].split(";") if f],
            generation={"waypoints": [int(w) for w in c["waypoints"]], "k": c["k"], "iterations": c["iterations"],
                        "spurs_trimmed": c["spurs_trimmed"], "theta_deg": c["theta_deg"], "rho_m": round(c["rho_m"], 1)})


def _region(lat: float, lon: float):
    """route_graph() / _summary() expect a Region; requests are not tied to a survey region."""
    return rrg.Region("request", "request", "", (lat, lon))

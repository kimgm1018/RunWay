"""Data layer: where every external file lives and how it is loaded. No routing algorithm here.

요약: 외부 파일(부산 OSM extract, env layer, env edge cache, DEM, config)을 시작 시 한 번 읽는다.
위치: pipeline 시작 단계. 요청 처리 중에는 읽기만 한다.
주의: env edge cache는 edge_distances 소스 텍스트의 hash에 묶여 있다(아래 계약 참조).

Everything the recommendation backend reads from disk goes through this module:
  OSM extract   data/osm/busan/busan_highways_*.osm.pbf + EXTRACT.json. BusanSource (analysis, canonical) parses it
                once inside graph.FastGraphRouteGenerator; the extract path rule is canonical's (_busan_pbf).
  env layer     reports/_route_canonical_work/env_layers_wide.geojson (+ .json meta); fallback "poc5" =
                reports/_route_poc_work/env_layers.geojson (five survey boxes only)
  env cache     reports/_route_canonical_work/env_edge_cache/{edge_env_distances.npz, provenance.json}
  DEM           reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif; fallback the PoC clip
  configs       runway_routing/config/*.json (see config/CONFIG_NOTES.md for values production does not read)
All paths are relative to the RunWay root. Nothing here writes files.

Env cache contract (do not break silently): EnvFeatureCache.load() accepts the cache only when its provenance matches
the extract, the env layer file and _code_sha() = sha256(source text of edge_distances + repr(ENV_CLASSES) + cache
version). Editing edge_distances in any way -- even whitespace -- or ENV_CLASSES invalidates the cache: every cold
graph then recomputes the distances (same values, much slower) and /api/status shows env_cache.valid = false.
"""
import hashlib
import inspect
import json
import sys
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
CONFIG_DIR = Path(__file__).resolve().parent / "config"

# The canonical generator (analysis/, another workstream, read only) imports its sibling modules by top-level name,
# so analysis/ goes on sys.path here, once, before anything imports it. Other modules take `api` from this module.
sys.path.insert(0, str(ROOT / "analysis"))
from osm_walk_inspect import REGIONS  # noqa: E402  (region definitions: single source of truth)
import runway_route_api as api  # noqa: E402
from runway_walk_filter import ROAD_HW, classify  # noqa: E402,F401  (Traversability rules, re-exported)

REGION_KEYS = ["gwangalli", "haeundae", "centum", "citizenpark", "hwangnyeongsan"]

RUNNABLE, EXCLUDED, UNCERTAIN = "RUNNABLE", "EXCLUDED", "UNCERTAIN"

UTM_CRS = "EPSG:32652"  # Busan lies in UTM zone 52N; metres for every distance computation

# Environment polygons of the "poc5" fallback layer cover the five survey boxes plus this margin.
ENV_MARGIN_M = 400

POC_WORK = REPORTS / "_route_poc_work"
DEM_PATH = POC_WORK / "dem" / "copernicus_glo30_busan_clip.tif"      # PoC five-box clip (fallback only)
ENV_LAYERS_PATH = POC_WORK / "env_layers.geojson"                     # "poc5" env layer (fallback only)
WORK = REPORTS / "_route_canonical_work"
WIDE_ENV_PATH = WORK / "env_layers_wide.geojson"
WIDE_ENV_META = WORK / "env_layers_wide.json"
WIDE_DEM_PATH = WORK / "dem" / "copernicus_glo30_canonical_clip.tif"
CACHE_DIR = WORK / "env_edge_cache"
ARRAYS_PATH = CACHE_DIR / "edge_env_distances.npz"
PROVENANCE_PATH = CACHE_DIR / "provenance.json"
CACHE_VERSION = 1
NO_GEOMETRY = -1      # stored for inf (the layer has no geometry of that class)
ENV_CLASSES = ["river", "water", "coast", "beach", "park", "green"]


# ------------------------------------------------------------------ configs
def load_config(name: str) -> dict:
    """runway_routing/config/<name> (values are never changed by code)."""
    return json.loads((CONFIG_DIR / name).read_text(encoding="utf-8"))


def load_scoring_config() -> dict:
    return load_config("scoring_config.json")


# ------------------------------------------------------------------ env layer
def env_bbox() -> tuple[float, float, float, float]:
    """(west, south, east, north) of the five survey boxes plus the margin."""
    w = min(REGIONS[k].bbox[0] for k in REGION_KEYS)
    s = min(REGIONS[k].bbox[1] for k in REGION_KEYS)
    e = max(REGIONS[k].bbox[2] for k in REGION_KEYS)
    n = max(REGIONS[k].bbox[3] for k in REGION_KEYS)
    dlat = ENV_MARGIN_M / 111_320
    dlon = ENV_MARGIN_M / (111_320 * np.cos(np.radians((s + n) / 2)))
    return (w - dlon, s - dlat, e + dlon, n + dlat)


def load_layers() -> gpd.GeoDataFrame | None:
    """The "poc5" fallback env layer (five survey boxes), or None."""
    if not ENV_LAYERS_PATH.exists():
        return None
    return gpd.read_file(ENV_LAYERS_PATH)


def load_env(name: str) -> dict:
    """Env layer + its extent. "wide" falls back to "poc5" (with a note) when the wide file is missing."""
    if name == "wide" and WIDE_ENV_PATH.exists():
        import geopandas as gpd
        meta = json.loads(WIDE_ENV_META.read_text(encoding="utf-8"))
        return {"name": "wide", "layers": gpd.read_file(WIDE_ENV_PATH), "extent_wsen": tuple(meta["bbox_wsen"]),
                "path": str(WIDE_ENV_PATH.relative_to(REPORTS.parent)), "note": None}
    layers = load_layers()
    if layers is None:
        return {"name": None, "layers": None, "extent_wsen": None, "path": None, "note": "no env layer file"}
    note = None if name == "poc5" else f"{WIDE_ENV_PATH.name} missing (run fetch-env); using the five-box layer"
    return {"name": "poc5", "layers": layers, "extent_wsen": env_bbox(),
            "path": "reports/_route_poc_work/env_layers.geojson", "note": note}


def edge_distances(graph, layers: gpd.GeoDataFrame) -> pd.DataFrame:
    """Distance (m) from every routing edge segment to the nearest geometry of each env class."""
    re_ = graph.redges
    u, v = re_["u"].to_numpy(), re_["v"].to_numpy()
    segs = shapely.linestrings(np.stack([np.c_[graph.x[u], graph.y[u]], np.c_[graph.x[v], graph.y[v]]], axis=1))
    lay = layers.to_crs(UTM_CRS)
    out = pd.DataFrame(index=re_.index)
    for cls in ENV_CLASSES:
        geoms = lay.loc[lay["env_class"] == cls, "geometry"].to_numpy()
        if len(geoms) == 0:
            out[f"{cls}_dist_m"] = np.inf
            continue
        tree = shapely.STRtree(geoms)
        idx, dist = tree.query_nearest(segs, return_distance=True, all_matches=False)
        d = np.full(len(segs), np.inf)
        d[idx[0]] = dist
        out[f"{cls}_dist_m"] = d.round(1)
    return out

def edge_flags(dist: pd.DataFrame, thresholds: dict) -> pd.DataFrame:
    """Boolean "near" flags from distances; waterfront = river or other water or coast/beach."""
    f = pd.DataFrame(index=dist.index)
    for cls in ENV_CLASSES:
        f[f"{cls}_near"] = dist[f"{cls}_dist_m"] <= thresholds[cls]
    f["coastal_near"] = f["coast_near"] | f["beach_near"]
    f["waterfront_near"] = f["river_near"] | f["water_near"] | f["coastal_near"]
    return f


class _Segments:
    """The minimal graph edge_distances() reads: redges (u, v node indices) and x / y (UTM)."""

    def __init__(self, x, y, u, v):
        self.x, self.y = x, y
        self.redges = pd.DataFrame({"u": u, "v": v})


# ------------------------------------------------------------------ DEM
class Dem:
    """Bilinear sampler over the local clip."""

    def __init__(self, path=DEM_PATH):
        import rasterio
        with rasterio.open(path) as src:
            self.z = src.read(1).astype(float)
            if src.nodata is not None:
                self.z[self.z == src.nodata] = np.nan
            self.t = src.transform
        self.meta = json.loads(path.with_suffix(".json").read_text(encoding="utf-8")) if path.with_suffix(".json").exists() else {}

    def sample(self, lon, lat) -> np.ndarray:
        lon, lat = np.asarray(lon, float), np.asarray(lat, float)
        # pixel centres: col = (lon - x0) / dx - 0.5
        c = (lon - self.t.c) / self.t.a - 0.5
        r = (lat - self.t.f) / self.t.e - 0.5
        c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
        fc, fr = c - c0, r - r0
        H, W = self.z.shape
        ok = (c0 >= 0) & (r0 >= 0) & (c0 + 1 < W) & (r0 + 1 < H)
        out = np.full(lon.shape, np.nan)
        c0, r0, fc, fr = c0[ok], r0[ok], fc[ok], fr[ok]
        z = self.z
        out[ok] = (z[r0, c0] * (1 - fc) * (1 - fr) + z[r0, c0 + 1] * fc * (1 - fr)
                   + z[r0 + 1, c0] * (1 - fc) * fr + z[r0 + 1, c0 + 1] * fc * fr)
        return out

def load_dem():
    if not DEM_PATH.exists():
        return None
    try:
        return Dem()
    except Exception as exc:  # a broken clip must not take the PoC down; the UI shows it as unavailable
        print("DEM load failed:", exc)
        return None


def load_dem_any():
    """(Dem, 상대 경로): canonical 범위 DEM(wide) 우선, 없으면 PoC 다섯 구역 clip, 둘 다 없으면 (None, None).
    DEM이 없으면 고도 feature와 난이도 점수 항이 빠질 뿐 추천은 계속된다."""
    if WIDE_DEM_PATH.exists():
        return Dem(WIDE_DEM_PATH), str(WIDE_DEM_PATH.relative_to(REPORTS.parent))
    dem = load_dem()
    return dem, (str(DEM_PATH.relative_to(REPORTS.parent)) if dem is not None else None)


# ------------------------------------------------------------------ env edge cache
def _sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def _code_sha() -> str:
    """Hash of everything the cached numbers depend on in code: edge_distances, classes, rounding."""
    # 왜 소스 텍스트 hash인가: cache 값은 edge_distances가 계산한 숫자다. 함수가 바뀌었는데 옛 숫자를 쓰면 환경 feature가
    # 조용히 틀린다. 그래서 소스(공백·docstring 포함)가 한 글자라도 다르면 cache를 버리고 정확히 다시 계산한다(느려질 뿐).
    src = inspect.getsource(edge_distances) + repr(ENV_CLASSES) + f"v{CACHE_VERSION}"
    return hashlib.sha256(src.encode()).hexdigest()

def _extract_meta() -> dict:
    meta = json.loads((api.busan.BUSAN_DIR / "EXTRACT.json").read_text(encoding="utf-8"))
    return {"file": meta["extract_file"], "sha256": meta["extract_sha256"],
            "osm_data_timestamp": meta.get("osm_data_timestamp")}

class EnvFeatureCache:
    """미리 계산한 edge별 환경 거리(강·물·해안·해변·공원·녹지, 0.1 m 단위)를 (osm_u, osm_v, osmid) key로 찾는 표.
    load()가 extract, env layer, 코드 hash를 모두 확인한 뒤에만 만든다. 없거나 맞지 않으면 graph.attach_env가 같은 값을
    직접 계산한다(결과 동일, cold 요청이 크게 느려짐). 다시 만드는 도구는 tools/data/build_env_cache.py이다."""

    def __init__(self, prov: dict):
        t0 = time.perf_counter()
        z = np.load(ARRAYS_PATH)
        keys = z["keys"]
        self.dist_dm = z["dist_dm"]
        self.index = pd.MultiIndex.from_arrays([keys[:, 0], keys[:, 1], keys[:, 2]])
        self.index.get_indexer(self.index[:1])  # build the hash engine now, not on the first request
        self.prov = prov
        self.load_seconds = round(time.perf_counter() - t0, 2)

    @classmethod
    def load(cls, env: dict) -> tuple["EnvFeatureCache | None", str]:
        """(cache, "") when the cache matches the extract, env layer and code on disk; else (None, why)."""
        if not PROVENANCE_PATH.exists() or not ARRAYS_PATH.exists():
            return None, "no cache (run: python -B tools/data/build_env_cache.py build)"
        prov = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
        if prov.get("cache_version") != CACHE_VERSION:
            return None, f"cache version {prov.get('cache_version')} != {CACHE_VERSION}"
        if prov["extract"]["sha256"] != _extract_meta()["sha256"]:
            return None, "Busan extract changed since the cache was built"
        if env["name"] is None or env["path"] is None or prov["env_layer"]["name"] != env["name"]:
            return None, f"env layer {env['name']} != cached {prov['env_layer']['name']}"
        if prov["env_layer"]["sha256"] != _sha256(REPORTS.parent / env["path"]):
            return None, "env layer file changed since the cache was built"
        if prov["code_sha256"] != _code_sha():
            return None, "distance code changed since the cache was built"
        return cls(prov), ""

    def lookup(self, redges: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        """(distances in m, shape (E, 6) in ENV_CLASSES order, NaN where missing; missing mask)."""
        a, b = redges["osm_u"].to_numpy(np.int64), redges["osm_v"].to_numpy(np.int64)
        idx = self.index.get_indexer(pd.MultiIndex.from_arrays([np.minimum(a, b), np.maximum(a, b),
                                                                redges["osmid"].to_numpy(np.int64)]))
        missing = idx < 0
        dm = self.dist_dm[np.where(missing, 0, idx)]
        d = np.where(dm == NO_GEOMETRY, np.inf, dm / 10)
        d[missing] = np.nan
        return d, missing


# ------------------------------------------------------------------ everything static, loaded once
class RunwayData:
    """Static data of one pipeline: scoring / suitability / shape configs, env layer, DEM, env edge cache."""

    def __init__(self, env_layer: str = "wide"):
        t0 = time.perf_counter()
        self.scfg = load_scoring_config()
        self.thresholds = {k: v for k, v in self.scfg["env_thresholds_m"].items() if not k.startswith("_")}
        self.env = load_env(env_layer)
        self.dem, self.dem_path = load_dem_any()
        self.load_seconds = round(time.perf_counter() - t0, 2)
        self.cache, self.cache_note = EnvFeatureCache.load(self.env)
        self.rs_cfg = load_config("running_suitability_config.json")
        self.shape_cfg = load_config("shape_config.json")

    def env_cache_status(self) -> dict:
        return ({"valid": True, "created_utc": self.cache.prov["created_utc"],
                 "segments": self.cache.prov["segments"], "load_seconds": self.cache.load_seconds}
                if self.cache else {"valid": False, "reason": self.cache_note})

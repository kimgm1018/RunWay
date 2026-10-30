"""Build (or inspect) the env edge cache: per highway segment of the Busan extract, the distance to the nearest geometry
of each env class (river, water, coast, beach, park, green).

    python -B tools/data/build_env_cache.py info
    python -B tools/data/build_env_cache.py build [--env-layer wide] [--out-dir DIR]

What it makes   <out-dir>/edge_env_distances.npz (keys int64[S,3] = (min osm node, max osm node, way id), dist_dm int32[S,6]
                in decimetres, -1 = class has no geometry) + <out-dir>/provenance.json (extract sha, env layer sha, code sha).
Input           data/osm/busan/<extract>.osm.pbf + EXTRACT.json, the env layer (reports/_route_canonical_work/env_layers_wide.geojson).
Output default  reports/_route_canonical_work/env_edge_cache/ (= runway_routing.data.CACHE_DIR, what production reads).
When to run     after the Busan extract or the env layer changes, or when /api/status shows env_cache.valid = false.
                Without a valid cache production computes the same distances per request (same results, much slower cold).
Read by         runway_routing.data.EnvFeatureCache.load (start-up) -> graph.attach_env (every request graph).

The distances come from runway_routing.data.edge_distances itself, and the code hash is runway_routing.data._code_sha, so a
cache built here is exactly the one production accepts. This tool only imports production code; it never edits it.
Build time: ~3 min (565,867 segments).
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.dont_write_bytecode = True

import numpy as np  # noqa: E402
import pyproj  # noqa: E402

from runway_routing import data as D  # noqa: E402

CHUNK = 50_000


def _env_meta(env: dict) -> dict:
    path = D.REPORTS.parent / env["path"]
    meta_path = path.with_suffix(".json")
    return {"name": env["name"], "file": env["path"].replace("\\", "/"), "sha256": D._sha256(path),
            "meta": json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else None}


def build(env_layer: str, out_dir: Path) -> dict:
    t0 = time.perf_counter()
    env = D.load_env(env_layer)
    if env["name"] != env_layer:
        raise SystemExit(f"env layer {env_layer} not available ({env['note']})")
    source = D.api.busan.BusanSource()
    t_load = time.perf_counter() - t0

    rows = {}
    for wid, (refs, _tags) in source.ways.items():
        for a, b in zip(refs[:-1], refs[1:]):
            rows[(a, b, wid) if a <= b else (b, a, wid)] = None
    keys = np.array(list(rows), dtype=np.int64)
    del rows
    nodes = np.unique(keys[:, :2])
    pos = {int(n): i for i, n in enumerate(nodes)}
    ll = np.array([source.lonlat[int(n)] for n in nodes])
    x, y = pyproj.Transformer.from_crs("EPSG:4326", D.UTM_CRS, always_xy=True).transform(ll[:, 0], ll[:, 1])
    u = np.array([pos[int(n)] for n in keys[:, 0]])
    v = np.array([pos[int(n)] for n in keys[:, 1]])
    t_seg = time.perf_counter() - t0 - t_load

    dist = np.empty((len(keys), len(D.ENV_CLASSES)), dtype=np.int32)
    t1 = time.perf_counter()
    for s in range(0, len(keys), CHUNK):
        d = D.edge_distances(D._Segments(x, y, u[s:s + CHUNK], v[s:s + CHUNK]), env["layers"])
        arr = d[[f"{c}_dist_m" for c in D.ENV_CLASSES]].to_numpy()
        dist[s:s + CHUNK] = np.where(np.isfinite(arr), np.rint(arr * 10), D.NO_GEOMETRY).astype(np.int32)
        print(f"  {min(s + CHUNK, len(keys)):,}/{len(keys):,} segments  {time.perf_counter() - t1:.0f}s", flush=True)
    t_dist = time.perf_counter() - t1

    out_dir.mkdir(parents=True, exist_ok=True)
    arrays = out_dir / D.ARRAYS_PATH.name
    np.savez_compressed(arrays, keys=keys, dist_dm=dist)
    prov = {"cache_version": D.CACHE_VERSION, "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "extract": D._extract_meta(), "env_layer": _env_meta(env), "code_sha256": D._code_sha(),
            "env_classes": D.ENV_CLASSES, "key": ["min_osm_node", "max_osm_node", "osm_way_id"],
            "value": "distance to nearest env geometry, integer decimetres (-1 = class has no geometry)",
            "segments": int(len(keys)), "ways": len(source.ways), "nodes": int(len(nodes)),
            "arrays_file": arrays.name, "arrays_bytes": arrays.stat().st_size, "arrays_sha256": D._sha256(arrays),
            "build_seconds": {"load_extract_and_layer": round(t_load, 1), "segments": round(t_seg, 1),
                              "distances": round(t_dist, 1), "total": round(time.perf_counter() - t0, 1)},
            "not_cached": "near flags (thresholds), highway-tag flags, DEM elevation, preferences, scores"}
    (out_dir / D.PROVENANCE_PATH.name).write_text(json.dumps(prov, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(prov, ensure_ascii=False, indent=1))
    return prov


def info(env_layer: str) -> int:
    """Provenance of the production cache and whether production would accept it (EnvFeatureCache.load)."""
    if D.PROVENANCE_PATH.exists():
        print(D.PROVENANCE_PATH.read_text(encoding="utf-8"))
    cache, why = D.EnvFeatureCache.load(D.load_env(env_layer))
    print("valid" if cache else f"INVALID: {why}")
    return 0 if cache else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("cmd", choices=["build", "info"])
    ap.add_argument("--env-layer", default="wide")
    ap.add_argument("--out-dir", default=str(D.CACHE_DIR), help="default: the production cache directory")
    a = ap.parse_args()
    if a.cmd == "info":
        return info(a.env_layer)
    build(a.env_layer, Path(a.out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())

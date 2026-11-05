# Route data tools

Production reads these files at start-up (`runway_routing/data.py`) from the data root `RUNWAY_DATA_DIR` (default: `ai/route_service`). They are data, not code, and are rebuilt only when their source changes. Run every command from `ai/route_service` with the Route venv. Each tool's docstring gives the details.

| tool | makes | input | default output (= what production reads) | run when |
|---|---|---|---|---|
| `fetch_env_layer.py` | env layer (river / water / coast / beach / park / green) | OSM via one Overpass query (osmnx, response cached) | `reports/_route_canonical_work/env_layers_wide.geojson` + `.json` | refreshing environment data from newer OSM |
| `fetch_dem.py` | DEM clip (Copernicus GLO-30) | public Copernicus COG tile N35 E129 over HTTP | `reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif` + `.json` | the clip is missing or must cover a new area |
| `build_env_cache.py` | env edge cache: distance of every extract segment to each env class | Busan extract + env layer | `reports/_route_canonical_work/env_edge_cache/` (`edge_env_distances.npz`, `provenance.json`) | after the extract or env layer changes, or when `RoutePipeline.status()` shows `env_cache.valid = false` |
| `analysis/runway_busan_graph.py extract` | Busan highway extract | Geofabrik `south-korea-*.osm.pbf` in `data/osm/geofabrik/` | `data/osm/busan/busan_highways_<date>.osm.pbf` + `EXTRACT.json` | refreshing OSM roads |
| `verify_bundle.py` | - | a data bundle folder + its `DATA_MANIFEST.md` | prints ok / MISMATCH / MISSING per file | before using or shipping a bundle (the Dockerfile runs it) |

```bash
python -B tools/data/fetch_env_layer.py --dry-run          # bbox, tags, output paths; no network
python -B tools/data/fetch_dem.py --dry-run                # DEM window and source; no network
python -B tools/data/build_env_cache.py info               # current cache provenance + "valid" / "INVALID: why"

# refresh order after new OSM data (each step invalidates what follows):
python -B analysis/runway_busan_graph.py extract           # roads (needs the Geofabrik PBF)
python -B tools/data/fetch_env_layer.py --overpass-url https://gall.openstreetmap.de/api
python -B tools/data/build_env_cache.py build              # ~3 min
python -B tools/route_regression/run_regression.py --tag newdata   # results WILL differ from the baseline: review them
```

Notes:
- **Data bundle v2 (S15P31E105-435) covers all of Busan.** Its env layer and DEM span the road extract bbox [128.73, 34.85, 129.35, 35.42]. `fetch_env_layer.py` and `fetch_dem.py` still make the old demo-area files (v1, five-region disk / tile N35 E129 only). Do not use them to refresh v2: that would shrink the coverage again. The v2 files were built from the same Geofabrik PBF with the scripts recorded in `route_data_bundle_v2/DATA_MANIFEST.md`. After any env layer change, run `build_env_cache.py build` again. Bundle v2 is stored in the private Hugging Face repo `AnSeongYun/runway-hr-models`, folder `route_data_v2/`, revision `4952478476ce2d76579e1b6ba16363214e6a6914`.
- `build_env_cache.py` imports `runway_routing.data.edge_distances` and `_code_sha`. A cache it builds is exactly the one production accepts. Do not edit `edge_distances`: its source text (even whitespace) is part of the cache hash.
- `--out-dir` / `--out` write somewhere else for testing. The defaults overwrite production data.
- The PoC "poc5" fallback layer and DEM (`reports/_route_poc_work/`) are only used when the wide files are missing. They are not rebuilt here.

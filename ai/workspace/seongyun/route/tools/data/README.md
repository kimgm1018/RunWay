# Route data tools

Production reads these files at start-up (`runway_routing/data.py`). They are data, not code, and are rebuilt only when their source changes. Run every command from the repository root with the Route venv. Each tool's docstring gives the details.

| tool | makes | input | default output (= what production reads) | run when |
|---|---|---|---|---|
| `fetch_env_layer.py` | env layer (river / water / coast / beach / park / green) | OSM via one Overpass query (osmnx, response cached) | `reports/_route_canonical_work/env_layers_wide.geojson` + `.json` | refreshing environment data from newer OSM |
| `fetch_dem.py` | DEM clip (Copernicus GLO-30) | public Copernicus COG tile N35 E129 over HTTP | `reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif` + `.json` | the clip is missing or must cover a new area |
| `build_env_cache.py` | env edge cache: distance of every extract segment to each env class | Busan extract + env layer | `reports/_route_canonical_work/env_edge_cache/` (`edge_env_distances.npz`, `provenance.json`) | after the extract or env layer changes, or when `/api/status` shows `env_cache.valid = false` |
| `analysis/runway_busan_graph.py extract` (other workstream, not moved) | Busan highway extract | Geofabrik `south-korea-*.osm.pbf` in `data/osm/geofabrik/` | `data/osm/busan/busan_highways_<date>.osm.pbf` + `EXTRACT.json` | refreshing OSM roads |

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
- `build_env_cache.py` imports `runway_routing.data.edge_distances` and `_code_sha`. A cache it builds is exactly the one production accepts. Do not edit `edge_distances`: its source text (even whitespace) is part of the cache hash.
- `--out-dir` / `--out` write somewhere else for testing. The defaults overwrite production data.
- The PoC "poc5" fallback layer and DEM (`reports/_route_poc_work/`) are only used when the wide files are missing. They are not rebuilt here.

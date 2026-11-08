# Route data tools

Production reads these files at start-up (`runway_routing/data.py`) from the data root `RUNWAY_DATA_DIR` (default: `ai/route_service`). They are data, not code, and are rebuilt only when their source changes. Run every command from `ai/route_service` with the Route venv. Each tool's docstring gives the details.

**Current data = bundle v2 (S15P31E105-435).** It covers all of Busan: road extract, env layer and DEM all span the extract bbox [128.73, 34.85, 129.35, 35.42]. Bundle v2 is stored in the private Hugging Face repo `AnSeongYun/runway-hr-models`, folder `route_data_v2/`, revision `4952478476ce2d76579e1b6ba16363214e6a6914`. Its `DATA_MANIFEST.md` lists every file with size and sha256. **Rebuilding any of these files changes recommendations**: review the Golden diff and record a new baseline (see `tools/route_regression/README.md`, "When the baseline must change").

| tool | makes | input | default output (= what production reads) | run when |
|---|---|---|---|---|
| `analysis/runway_busan_graph.py extract` | Busan highway extract | Geofabrik `south-korea-*.osm.pbf` in `data/osm/geofabrik/` | `data/osm/busan/busan_highways_<date>.osm.pbf` + `EXTRACT.json` | refreshing OSM roads |
| `build_env_cache.py` | env edge cache: distance of every extract segment to each env class | Busan extract + env layer | `reports/_route_canonical_work/env_edge_cache/` (`edge_env_distances.npz`, `provenance.json`) | after the extract or env layer changes, or when `RoutePipeline.status()` shows `env_cache.valid = false` |
| `verify_bundle.py` | - | a data bundle folder + its `DATA_MANIFEST.md` | prints ok / MISMATCH / MISSING / UNEXPECTED / NOT LISTED per problem | before using or shipping a bundle (the Dockerfile runs it) |

The env layer (`env_layers_wide.geojson` + `.json`) and the DEM (`dem/copernicus_glo30_canonical_clip.tif` + `.json`) of bundle v2 are **not built by a tool in this repository** (see below).

```bash
python -B tools/data/build_env_cache.py info               # current cache provenance + "valid" / "INVALID: why"
python -B tools/data/verify_bundle.py <bundle folder>      # exit 0 only when the bundle is exactly its manifest

# after new OSM roads (each step invalidates what follows):
python -B analysis/runway_busan_graph.py extract           # roads (needs the Geofabrik PBF)
#   then rebuild the env layer from the SAME Geofabrik PBF (v2 scripts below), then:
python -B tools/data/build_env_cache.py build              # ~3 min
python -B tools/route_regression/run_regression.py --tag newdata --app demo --demo-dir <demo copy> --baseline <baseline_v2>
#   results WILL differ from the baseline: review them before recording a new baseline
```

## How the v2 env layer and DEM were made

The bundle v2 env layer and DEM were built outside this repository (S15P31E105-435). The scripts and logs are kept with the data, in `RunWay_data/route_busan_full_data_2026-11-04/scripts/` (team share, not in git):

| script | makes | notes |
|---|---|---|
| `build_env_layer_from_pbf.py` | env layer from the local Geofabrik PBF (no Overpass), same snapshot as the road extract | imports `OSM_TAGS`, `classify_features()` and `WIDE_MARGIN_M` from the old `tools/data/fetch_env_layer.py` (deleted in S15P31E105-441, below). To rerun it, restore that file from git first: `git show 52e93e6:ai/route_service/tools/data/fetch_env_layer.py > tools/data/fetch_env_layer.py` (do not commit it back). It also has the absolute path of the original workspace in `REPO`; change it |
| `build_dem_mosaic.py` | DEM: Copernicus GLO-30 tiles N34/N35 x E128/E129, mosaicked and clipped to the extract bbox | same grid rules as the old `fetch_dem.py` (no resampling, float32, deflate); tile URLs and sha256 are in the DEM `.json` |
| `check_dem.py`, `sanity_env_diff.py`, `write_manifest.py` | checks and `DATA_MANIFEST.md` | |

Moving these scripts into the repository (with the tag table inlined and no absolute paths) is a separate task; it overlaps the national expansion data work.

## Removed: v1-only collectors (S15P31E105-441)

`fetch_env_layer.py` (Overpass query around the five demo regions) and `fetch_dem.py` (one DEM tile, N35 E129) only made the **v1 demo-area** files, and wrote them over the production file names by default. Running them on bundle v2 would have shrunk the coverage again. They were deleted; they stay in git history (last at commit `52e93e6`, `ai/route_service/tools/data/`).

## Notes
- `build_env_cache.py` imports `runway_routing.data.edge_distances` and `_code_sha`. A cache it builds is exactly the one production accepts. Do not edit `edge_distances`: its source text (even whitespace) is part of the cache hash.
- Production checks the cache before using it (S15P31E105-441): provenance shape, cache version, the extract sha256 in `EXTRACT.json` **and of the actual PBF file**, env layer file, code hash, the arrays file size + sha256 recorded by `build_env_cache.py`, and the array shapes. Any mismatch -> the distances are computed directly (same values, slower cold requests) and `env_cache.reason` says why.
- `--out-dir` writes somewhere else for testing. The default overwrites production data.
- The PoC "poc5" fallback layer and DEM (`reports/_route_poc_work/`) are only used when the wide files are missing. They are not rebuilt here.

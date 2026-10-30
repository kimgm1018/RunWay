"""Fetch the DEM clip production samples node elevations from (Copernicus GLO-30, ~30 m).

    python -B tools/data/fetch_dem.py --dry-run
    python -B tools/data/fetch_dem.py [--out PATH]

What it makes   copernicus_glo30_canonical_clip.tif (GeoTIFF, deflate) + .json (source, window, shape, min/max, licence).
Input           the public Copernicus GLO-30 tile N35 E129 (cloud-optimised GeoTIFF on AWS), read over HTTP with GDAL /vsicurl;
                only the window of the env layer's bbox (five region centres + 6,150 m, clamped to the tile) is downloaded.
Output default  reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif (= runway_routing.data.WIDE_DEM_PATH).
When to run     only if the clip is missing or must cover a new area. Elevation features and the "flat" score term use it;
                without it the backend still runs (those features are just absent).
Read by         runway_routing.data.load_dem_any -> Dem.sample (bilinear) in graph.attach_elevation (every request graph).
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.dont_write_bytecode = True

import numpy as np  # noqa: E402

from fetch_env_layer import wide_bbox  # noqa: E402  (the DEM covers the env layer's bbox)
from runway_routing import data as D  # noqa: E402

DEM_SOURCE_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/"
                  "Copernicus_DSM_COG_10_N35_00_E129_00_DEM/Copernicus_DSM_COG_10_N35_00_E129_00_DEM.tif")
DEM_TILE_WSEN = (129.0, 35.0, 130.0, 36.0)   # Copernicus tile N35 E129


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(D.WIDE_DEM_PATH), help="default: where production reads the DEM")
    ap.add_argument("--dry-run", action="store_true", help="print the window and output, download nothing")
    a = ap.parse_args()
    out = Path(a.out)
    w, s, e, n = wide_bbox()
    tw, ts, te, tn = DEM_TILE_WSEN
    win_bbox = (max(w, tw), max(s, ts), min(e, te), min(n, tn))
    if a.dry_run:
        print(json.dumps({"source": DEM_SOURCE_URL, "requested_bbox_wsen": [w, s, e, n], "bbox_wsen": win_bbox,
                          "writes": [str(out), str(out.with_suffix(".json"))]}, indent=1))
        return 0
    import rasterio
    from rasterio.windows import from_bounds
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_TIMEOUT="60"):
        with rasterio.open("/vsicurl/" + DEM_SOURCE_URL) as src:
            win = from_bounds(*win_bbox, transform=src.transform).round_offsets().round_lengths()
            arr = src.read(1, window=win)
            prof = src.profile.copy()
            prof.update(driver="GTiff", width=arr.shape[1], height=arr.shape[0],
                        transform=src.window_transform(win), compress="deflate", tiled=False)
            for k in ("blockxsize", "blockysize", "interleave"):
                prof.pop(k, None)
            meta = {"source": DEM_SOURCE_URL, "fetched_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "bbox_wsen": list(win_bbox), "requested_bbox_wsen": [w, s, e, n], "shape": list(arr.shape),
                    "crs": str(src.crs), "res_deg": list(src.res), "nodata": src.nodata,
                    "min_m": float(np.nanmin(arr)), "max_m": float(np.nanmax(arr)),
                    "license": "Copernicus DEM GLO-30, (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space "
                               "GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA"}
    with rasterio.open(out, "w", **prof) as dst:
        dst.write(arr, 1)
    out.with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=1))
    print("wrote", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

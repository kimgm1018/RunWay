"""Fetch and classify the "wide" environment layer (river / water / coast / beach / park / green polygons and lines).

    python -B tools/data/fetch_env_layer.py --dry-run
    python -B tools/data/fetch_env_layer.py [--overpass-url URL] [--out-dir DIR] [--cache-dir DIR]

What it makes   env_layers_wide.geojson (one row per (OSM feature, class): env_class, osm_id, name, tag, area_m2, geometry)
                + env_layers_wide.json (bbox, margin, Overpass URL, fetch time, counts, licence).
Input           OSM via one Overpass query (osmnx features_from_bbox) over the five Busan region centres +
                (working radius of a 10 km course + 400 m) = 6,150 m. osmnx caches the raw response in --cache-dir.
Output default  reports/_route_canonical_work/ (= runway_routing.data.WIDE_ENV_PATH / WIDE_ENV_META, what production reads).
When to run     only to refresh the layer from newer OSM data. Afterwards rebuild the env edge cache
                (tools/data/build_env_cache.py build): its provenance pins the layer's sha256, so a new layer invalidates it.
Read by         runway_routing.data.load_env (start-up) -> env near flags / ratios, PE5 blocking water and coast.

Classes (OSM tags -> class), unchanged from the layer production uses:
  river : waterway=river/stream/canal lines (not culverted / underground), natural=water with water=river/stream/canal/
          oxbow, waterway=riverbank
  water : every other natural=water polygon, landuse=reservoir/basin
  coast : natural=coastline lines, minus the stretch running up a river estuary (within 100 m of a river polygon)
  beach : natural=beach polygons
  park  : leisure=park/garden/nature_reserve
  green : park + natural=wood/scrub/grassland/heath + landuse=forest/meadow/recreation_ground/village_green + landuse=grass
          from 2,000 m2 up (smaller grass polygons are mostly road verges)
The production layer (2026-10-22) was fetched with --overpass-url https://gall.openstreetmap.de/api.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.dont_write_bytecode = True

import geopandas as gpd  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from runway_routing import data as D  # noqa: E402

WIDE_MARGIN_M = D.api.RouteGenerator.working_radius_m(10000) + 400   # 10 km working disk + 400 m
OSM_TAGS = {
    "natural": ["water", "coastline", "beach", "wood", "scrub", "grassland", "heath", "bay", "sand", "wetland"],
    "waterway": ["river", "stream", "canal", "riverbank", "drain", "ditch"],
    "leisure": ["park", "garden", "nature_reserve"],
    "landuse": ["forest", "grass", "meadow", "recreation_ground", "village_green", "reservoir", "basin"],
}
RIVER_WATER = {"river", "stream", "canal", "oxbow", "riverbank"}
RIVER_LINES = {"river", "stream", "canal"}
PARK_LEISURE = {"park", "garden", "nature_reserve"}
GREEN_NATURAL = {"wood", "scrub", "grassland", "heath"}
GREEN_LANDUSE = {"forest", "meadow", "recreation_ground", "village_green"}
ENV_GRASS_MIN_AREA_M2 = 2000.0
ESTUARY_BUFFER_M = 100.0


def wide_bbox(margin_m: float = WIDE_MARGIN_M) -> tuple[float, float, float, float]:
    """(west, south, east, north): the five region centres plus margin_m."""
    lats = [D.REGIONS[k].center[0] for k in D.REGION_KEYS]
    lons = [D.REGIONS[k].center[1] for k in D.REGION_KEYS]
    dlat = margin_m / 111_320
    dlon = margin_m / (111_320 * np.cos(np.radians(np.mean(lats))))
    return (min(lons) - dlon, min(lats) - dlat, max(lons) + dlon, max(lats) + dlat)


def _col(df: pd.DataFrame, c: str) -> pd.Series:
    return df[c].astype("object") if c in df.columns else pd.Series(None, index=df.index, dtype="object")


def classify_features(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """One output row per (feature, class); a park with a pond inside contributes two rows."""
    g = gdf.reset_index()
    nat, ww, lei, lu = (_col(g, c) for c in ("natural", "waterway", "leisure", "landuse"))
    water, tunnel, layer = _col(g, "water"), _col(g, "tunnel"), _col(g, "layer")
    gt = g.geometry.geom_type
    is_area = gt.isin(["Polygon", "MultiPolygon"])
    is_line = gt.isin(["LineString", "MultiLineString"])
    underground = tunnel.isin(["culvert", "yes"]) | layer.astype(str).str.startswith("-")
    area_m2 = g.geometry.to_crs(D.UTM_CRS).area
    masks = {
        "river": ((ww.isin(RIVER_LINES) & is_line & ~underground)
                  | ((nat == "water") & water.isin(RIVER_WATER) & is_area)
                  | ((ww == "riverbank") & is_area)),
        "water": (((nat == "water") & ~water.isin(RIVER_WATER) & is_area)
                  | (lu.isin(["reservoir", "basin"]) & is_area)),
        "coast": (nat == "coastline") & is_line,
        "beach": (nat == "beach") & is_area,
        "park": lei.isin(PARK_LEISURE) & is_area,
    }
    masks["green"] = (masks["park"]
                      | (nat.isin(GREEN_NATURAL) & is_area)
                      | (lu.isin(GREEN_LANDUSE) & is_area)
                      | ((lu == "grass") & is_area & (area_m2 >= ENV_GRASS_MIN_AREA_M2)))
    out = []
    for cls, m in masks.items():
        sub = g[m]
        out.append(gpd.GeoDataFrame({
            "env_class": cls,
            "osm_id": sub["element"].astype(str) + "/" + sub["id"].astype(str),
            "name": _col(sub, "name"),
            "tag": (_col(sub, "natural").fillna("") + "|" + _col(sub, "waterway").fillna("") + "|"
                    + _col(sub, "leisure").fillna("") + "|" + _col(sub, "landuse").fillna("") + "|"
                    + _col(sub, "water").fillna("")),
            "area_m2": area_m2[m].round(0),
        }, geometry=sub.geometry, crs=gdf.crs))
    return _drop_estuary_coastline(pd.concat(out, ignore_index=True))


def _drop_estuary_coastline(layers: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """OSM natural=coastline runs up the Suyeong River estuary (to ~35.19 N), which would label the riverside cycleway as
    "coast". Coastline within ESTUARY_BUFFER_M of a river polygon is dropped from the coast class."""
    utm = layers.to_crs(D.UTM_CRS)
    river_area = utm[(utm["env_class"] == "river") & utm.geom_type.isin(["Polygon", "MultiPolygon"])].union_all()
    if river_area.is_empty:
        return layers
    is_coast = utm["env_class"] == "coast"
    utm.loc[is_coast, "geometry"] = utm.loc[is_coast].geometry.difference(river_area.buffer(ESTUARY_BUFFER_M))
    utm.loc[is_coast, "tag"] = utm.loc[is_coast, "tag"] + "|estuary_clipped"
    utm = utm[~utm.geometry.is_empty]
    return utm.to_crs("EPSG:4326")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out-dir", default=str(D.WORK), help="default: where production reads the layer")
    ap.add_argument("--cache-dir", default=str(D.WORK / "env_cache"), help="osmnx response cache")
    ap.add_argument("--overpass-url", default=None)
    ap.add_argument("--dry-run", action="store_true", help="print the query and output paths, fetch nothing")
    a = ap.parse_args()
    out_dir = Path(a.out_dir)
    geo, meta_path = out_dir / D.WIDE_ENV_PATH.name, out_dir / D.WIDE_ENV_META.name
    bbox = wide_bbox()
    if a.dry_run:
        print(json.dumps({"bbox_wsen": bbox, "margin_m": WIDE_MARGIN_M, "tags": OSM_TAGS, "overpass_url": a.overpass_url,
                          "cache_dir": a.cache_dir, "writes": [str(geo), str(meta_path)]}, indent=1))
        return 0
    import osmnx as ox
    ox.settings.use_cache = True
    ox.settings.cache_folder = Path(a.cache_dir)
    ox.settings.log_console = False
    if a.overpass_url:
        ox.settings.overpass_url = a.overpass_url
    gdf = ox.features.features_from_bbox(bbox, tags=OSM_TAGS)
    layers = classify_features(gdf)
    out_dir.mkdir(parents=True, exist_ok=True)
    layers.to_file(geo, driver="GeoJSON")
    meta = {"bbox_wsen": list(bbox), "margin_m": WIDE_MARGIN_M, "overpass_url": ox.settings.overpass_url,
            "fetched_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"), "raw_features": len(gdf),
            "layer_counts": layers["env_class"].value_counts().to_dict(),
            "source": "OSM via Overpass, (c) OpenStreetMap contributors, ODbL 1.0"}
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(meta, ensure_ascii=False, indent=1))
    print("wrote", geo)
    return 0


if __name__ == "__main__":
    sys.exit(main())

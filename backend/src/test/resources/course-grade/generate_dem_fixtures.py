"""Independent GeoTIFF fixtures (synthetic grid; no user GPS or production DEM).

From repository root:
uv run --python 3.12 --with rasterio==1.4.3 --with numpy==2.5.2 \
    python backend/src/test/resources/course-grade/generate_dem_fixtures.py

Pixel (row, col) elevation = row * 10 + col, metres. Pixel centres begin at
(10.5, 49.5), grid resolution one degree, origin (10, 50). A broad grid makes
bilinear expected values hand-verifiable. This is not a geographic dataset.
"""
from pathlib import Path
import struct
import numpy as np
import rasterio
from rasterio.transform import from_origin, Affine

out = Path(__file__).with_name("dem")
out.mkdir(exist_ok=True)
grid = (np.arange(16)[:, None] * 10 + np.arange(16)[None, :]).astype("float32")

def write(name, *, array=grid, crs="EPSG:4326", point=False,
          transform=from_origin(10, 50, 1, 1), **options):
    with rasterio.open(out / f"{name}.tif", "w", driver="GTiff", width=16, height=16,
                       count=1, dtype="float32", crs=crs, transform=transform,
                       nodata=-9999, **options) as dst:
        if point:
            dst.update_tags(AREA_OR_POINT="Point")
        dst.write(array, 1)

write("area")
write("point", point=True)
write("deflate", compress="deflate")
write("tiled", tiled=True, blockxsize=16, blockysize=16, compress="deflate")
write("predictor3", compress="deflate", predictor=3)
missing = grid.copy()
missing[0, 0] = -9999
write("nodata", array=missing)
write("projected", crs="EPSG:3857")
write("rotated", transform=Affine(1, .1, 10, .1, -1, 50))

def mutate(name, tag, change):
    data = bytearray((out / "area.tif").read_bytes())
    endian = "<" if data[:2] == b"II" else ">"
    ifd = struct.unpack_from(endian + "I", data, 4)[0]
    count = struct.unpack_from(endian + "H", data, ifd)[0]
    for i in range(count):
        entry = ifd + 2 + 12 * i
        tag_id, kind, n, pointer = struct.unpack_from(endian + "HHII", data, entry)
        if tag_id == tag:
            change(data, endian, entry, pointer, n)
            (out / f"{name}.tif").write_bytes(data)
            return
    raise AssertionError(f"Missing tag {tag}")

def nonzero_tiepoint(data, endian, entry, pointer, count):
    struct.pack_into(endian + "6d", data, pointer, 3, 4, 0, 13, 46, 0)

mutate("nonzero-tiepoint", 33922, nonzero_tiepoint)
mutate("multiband", 277, lambda d, e, p, _, n: struct.pack_into(e + "H", d, p + 8, 2))
mutate("missing-scale", 33550, lambda d, e, p, _, n: struct.pack_into(e + "H", d, p, 65000))
print("Generated", len(list(out.glob("*.tif"))), "synthetic DEM fixtures with rasterio", rasterio.__version__)

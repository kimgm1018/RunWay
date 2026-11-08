"""Check a Route data bundle against its DATA_MANIFEST.md (size + sha256 of every listed file, and nothing else).

    python -B tools/data/verify_bundle.py <bundle root> [--manifest <DATA_MANIFEST.md>]   -> exit 0 iff all match

The manifest table lists `relative path | bytes | sha256 | ...`; paths are relative to the bundle root (the data root
the service reads as RUNWAY_DATA_DIR: data/osm/busan/..., reports/_route_canonical_work/...). Used by the Dockerfile
before the network store / source snapshot are built. Default manifest: <bundle root>/DATA_MANIFEST.md.

Fails (exit 1) when (S15P31E105-441 R14):
  - a listed file is missing or its size / sha256 differs;
  - a listed path is absolute, contains "..", or is listed twice;
  - a file the service needs (REQUIRED below, one Busan extract) is not listed;
  - the bundle holds a file that the manifest does not list (e.g. a second busan_highways_*.osm.pbf or a v1 leftover),
    except the manifest itself and Hugging Face download metadata under a top-level .cache/ folder.
Exit 2: no file rows in the manifest.
"""
import hashlib
import re
import sys
from pathlib import Path, PurePosixPath

ROW = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([0-9a-f]{64})`\s*\|")
# what runway_routing/data.py and analysis/runway_busan_graph.py read (bundle v2 layout, same names as v1)
REQUIRED = ("data/osm/busan/EXTRACT.json",
            "reports/_route_canonical_work/env_layers_wide.geojson",
            "reports/_route_canonical_work/env_layers_wide.json",
            "reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif",
            "reports/_route_canonical_work/env_edge_cache/edge_env_distances.npz",
            "reports/_route_canonical_work/env_edge_cache/provenance.json")
PBF = re.compile(r"^data/osm/busan/busan_highways_[^/]+\.osm\.pbf$")   # analysis/runway_busan_graph._busan_pbf glob
IGNORED_TOP = {".cache"}   # huggingface_hub local_dir metadata


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main(argv: list[str]) -> int:
    root = Path(argv[0])
    manifest = Path(argv[argv.index("--manifest") + 1]) if "--manifest" in argv else root / "DATA_MANIFEST.md"
    rows = [m.groups() for line in manifest.read_text(encoding="utf-8").splitlines() if (m := ROW.match(line))]
    if not rows:
        print(f"no file rows in {manifest}")
        return 2
    bad = 0
    listed = [rel for rel, _, _ in rows]
    for rel in sorted({r for r in listed if listed.count(r) > 1}):
        print(f"DUPLICATE ROW {rel}")
        bad += 1
    for rel, size, want in rows:
        pp = PurePosixPath(rel)
        if pp.is_absolute() or ".." in pp.parts or "\\" in rel or ":" in rel:
            print(f"BAD PATH {rel}")
            bad += 1
            continue
        p = root / rel
        if not p.is_file():
            print(f"MISSING  {rel}")
            bad += 1
        elif p.stat().st_size != int(size) or sha256(p) != want:
            print(f"MISMATCH {rel}")
            bad += 1
        else:
            print(f"ok       {rel}")
    for rel in REQUIRED:
        if rel not in listed:
            print(f"NOT LISTED (required) {rel}")
            bad += 1
    pbfs = [rel for rel in listed if PBF.match(rel)]
    if len(pbfs) != 1:
        print(f"EXPECTED ONE Busan extract row, found {len(pbfs)}: {pbfs}")
        bad += 1
    allowed = set(listed) | {manifest.resolve().relative_to(root.resolve()).as_posix()
                             if manifest.resolve().is_relative_to(root.resolve()) else ""}
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if rel.split("/", 1)[0] in IGNORED_TOP:
            continue
        if rel not in allowed:
            print(f"UNEXPECTED {rel}")
            bad += 1
    print(f"{len(rows)} listed files; {'all checks pass' if not bad else f'{bad} problem(s)'} ({manifest.name})")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

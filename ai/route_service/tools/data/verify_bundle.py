"""Check a Route data bundle against its DATA_MANIFEST.md (size + sha256 of every listed file).

    python -B tools/data/verify_bundle.py <bundle root> [--manifest <DATA_MANIFEST.md>]   -> exit 0 iff all match

The manifest table lists `relative path | bytes | sha256 | ...`; paths are relative to the bundle root (the data root
the service reads as RUNWAY_DATA_DIR: data/osm/busan/..., reports/_route_canonical_work/...). Used by the Dockerfile
before the network store / source snapshot are built. Default manifest: <bundle root>/DATA_MANIFEST.md.
"""
import hashlib
import re
import sys
from pathlib import Path

ROW = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|\s*`([0-9a-f]{64})`\s*\|")


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
    for rel, size, want in rows:
        p = root / rel
        if not p.is_file():
            print(f"MISSING  {rel}")
            bad += 1
        elif p.stat().st_size != int(size) or sha256(p) != want:
            print(f"MISMATCH {rel}")
            bad += 1
        else:
            print(f"ok       {rel}")
    print(f"{len(rows) - bad}/{len(rows)} files match {manifest.name}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

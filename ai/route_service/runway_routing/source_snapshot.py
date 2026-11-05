"""Validated on-disk snapshot of the parsed Busan extract (analysis BusanSource), to skip the PBF parse at start-up.

요약: BusanSource(PBF 파싱, 약 3.6초)의 필드를 npz(allow_pickle=False) + json으로 저장해 두고, 기동 때 key가 모두 같을
때만 읽는다. 하나라도 다르거나 파일이 깨졌으면 지금처럼 PBF를 파싱한다(느리지만 같은 결과).
위치: FastGraphRouteGenerator.__init__ (graph.py)가 canonical RouteGenerator.__init__ 동안만 BusanSource 생성을 이 모듈로
돌린다. analysis/ 코드는 바꾸지 않는다.
key: extract sha256 + 파서/스냅샷 소스 sha256 + Python/numpy/osmium/pyproj/PROJ 버전 + FORMAT. 파일 sha256은 manifest에 있고
읽을 때 다시 확인한다. pickle은 쓰지 않는다.
만들기(배포/image build 단계, 런타임은 읽기만):  python -m runway_routing.source_snapshot build <dir>
환경변수 RUNWAY_SOURCE_SNAPSHOT: 없으면 data/osm/busan/source_snapshot, "0"이면 끔(항상 PBF 파싱), 그 밖에는 디렉터리 경로.
"""
from contextlib import contextmanager
import hashlib
from importlib.metadata import version as pkg_version
import json
import os
from pathlib import Path
import platform
import sys
import time

import numpy as np

FORMAT = 1
MANIFEST, ARRAYS, STRINGS = "manifest.json", "source.npz", "strings.json"
_HERE = Path(__file__).resolve().parent


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot_dir() -> Path | None:
    from .data import api
    d = os.environ.get("RUNWAY_SOURCE_SNAPSHOT")
    if d == "0":
        return None
    return Path(d) if d else api.busan.BUSAN_DIR / "source_snapshot"


def key(extract: Path) -> dict:
    """Everything the parsed fields depend on. Any difference -> the snapshot is not used."""
    import osmium
    import pyproj
    from .data import api
    return {"format": FORMAT, "extract_file": extract.name, "extract_sha256": _sha256(extract),
            "parser_sha256": _sha256(Path(api.busan.__file__)), "snapshot_code_sha256": _sha256(_HERE / "source_snapshot.py"),
            "python": sys.version, "platform": platform.machine(), "numpy": np.__version__,
            "osmium": pkg_version("osmium"), "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str}


def _fields(src) -> tuple[dict, list]:
    """BusanSource -> (numpy arrays, string table). Tags keep each way's own key order."""
    way_ids = np.fromiter(src.ways.keys(), np.int64, len(src.ways))
    ref_ptr, tag_ptr, refs, tk, tv = [0], [0], [], [], []
    strings, sid = [], {}
    for refs_w, tags in src.ways.values():
        refs.extend(refs_w)
        ref_ptr.append(len(refs))
        for k, v in tags.items():
            for s, out in ((k, tk), (v, tv)):
                i = sid.get(s)
                if i is None:
                    i = sid[s] = len(strings)
                    strings.append(s)
                out.append(i)
        tag_ptr.append(len(tk))
    ll = np.array([src.lonlat[n] for n in src.node_ids.tolist()])
    arrays = {"way_ids": way_ids, "ref_ptr": np.array(ref_ptr, np.int64), "refs": np.array(refs, np.int64),
              "tag_ptr": np.array(tag_ptr, np.int64), "tag_k": np.array(tk, np.int32), "tag_v": np.array(tv, np.int32),
              "node_ids": src.node_ids, "lonlat": ll, "xy": src.xy}
    return arrays, strings


def _restore(a: dict, strings: list, path: Path, cls=None):
    """Same fields, types and orders as BusanSource.__init__ (analysis/runway_busan_graph.py)."""
    from .data import api
    src = object.__new__(cls or api.busan.BusanSource)
    src.path = path
    refs, rp = a["refs"].tolist(), a["ref_ptr"].tolist()
    keys = [strings[i] for i in a["tag_k"].tolist()]
    vals = [strings[i] for i in a["tag_v"].tolist()]
    tp = a["tag_ptr"].tolist()
    src.ways = {w: (refs[rp[i]:rp[i + 1]], dict(zip(keys[tp[i]:tp[i + 1]], vals[tp[i]:tp[i + 1]])))
                for i, w in enumerate(a["way_ids"].tolist())}
    src.node_ids = a["node_ids"]
    src.lonlat = dict(zip(src.node_ids.tolist(), map(tuple, a["lonlat"].tolist())))  # as BusanSource: plain floats
    src.xy = a["xy"]
    src.pos = {int(n): i for i, n in enumerate(src.node_ids)}
    return src


def build(out: Path, extract: Path | None = None) -> dict:
    """Parse the extract, write the snapshot (manifest last), then load it back and require field equality."""
    from .data import api
    extract = extract or api.busan._busan_pbf()
    out.mkdir(parents=True, exist_ok=True)
    (out / MANIFEST).unlink(missing_ok=True)       # no manifest = not usable while writing
    t0 = time.perf_counter()
    src = api.busan.BusanSource(extract)
    parse_s = time.perf_counter() - t0
    arrays, strings = _fields(src)
    np.savez(out / ARRAYS, **arrays)
    (out / STRINGS).write_text(json.dumps(strings, ensure_ascii=False), encoding="utf-8")
    back = _restore(dict(np.load(out / ARRAYS, allow_pickle=False)), strings, extract)
    diff = compare(src, back)
    if diff:
        raise RuntimeError(f"snapshot differs from the parsed extract: {diff}")
    man = {"key": key(extract), "files": {f: _sha256(out / f) for f in (ARRAYS, STRINGS)},
           "counts": {"ways": len(src.ways), "nodes": int(len(src.node_ids)), "strings": len(strings)},
           "parse_s": round(parse_s, 3), "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    (out / MANIFEST).write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    return man


def load(d: Path, extract: Path, status: dict, cls=None):
    """BusanSource from the snapshot in d, or None (status["reason"] says why) when anything does not match."""
    try:
        man = json.loads((d / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError) as ex:
        status["reason"] = f"no manifest: {type(ex).__name__}"
        return None
    want = key(extract)
    if man.get("key") != want:
        status["reason"] = "key mismatch: " + ",".join(k for k in want if man.get("key", {}).get(k) != want[k])
        return None
    for f in (ARRAYS, STRINGS):
        if not (d / f).is_file() or _sha256(d / f) != man["files"].get(f):
            status["reason"] = f"file hash mismatch: {f}"
            return None
    with np.load(d / ARRAYS, allow_pickle=False) as z:
        arrays = {k: z[k] for k in z.files}
    strings = json.loads((d / STRINGS).read_text(encoding="utf-8"))
    status["reason"] = ""
    return _restore(arrays, strings, extract, cls)


def compare(a, b) -> list:
    """Field-by-field equality of two BusanSource objects (values, dtypes, orders; dict order included)."""
    out = []
    if list(vars(a)) != list(vars(b)):
        out.append(("fields", list(vars(a)), list(vars(b))))
    for k in vars(a):
        x, y = getattr(a, k), getattr(b, k, None)
        if isinstance(x, np.ndarray):
            same = (isinstance(y, np.ndarray) and x.dtype == y.dtype and x.shape == y.shape
                    and x.flags.c_contiguous == y.flags.c_contiguous and x.tobytes() == y.tobytes())
        elif isinstance(x, dict):
            same = (isinstance(y, dict) and list(x.keys()) == list(y.keys()) and x == y
                    and all(type(v) is type(y[q]) for q, v in x.items()))
            if same and k == "ways":
                same = all(list(t.items()) == list(y[w][1].items()) and type(r) is type(y[w][0])
                           for w, (r, t) in x.items())
            if same and k == "lonlat":
                same = all(p[0].hex() == y[n][0].hex() and p[1].hex() == y[n][1].hex() for n, p in x.items())
        else:
            same = x == y and type(x) is type(y)
        if not same:
            out.append(k)
    return out


@contextmanager
def source_from_snapshot(busan_module, status: dict):
    """While active, busan_module.BusanSource(path) loads the validated snapshot (or parses the PBF when it does not
    match). Used only around the canonical RouteGenerator.__init__; restores the class afterwards."""
    d = snapshot_dir()
    if d is None:
        status.update(used=False, reason="disabled (RUNWAY_SOURCE_SNAPSHOT=0)")
        yield
        return
    parse = busan_module.BusanSource

    def factory(path=None):
        extract = path or busan_module._busan_pbf()
        t0 = time.perf_counter()
        src = load(d, Path(extract), status, parse)
        status.update(used=src is not None, dir=str(d), load_s=round(time.perf_counter() - t0, 3))
        return src if src is not None else parse(path)

    busan_module.BusanSource = factory
    try:
        yield
    finally:
        busan_module.BusanSource = parse


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "build":
        target = Path(sys.argv[2]) if len(sys.argv) > 2 else snapshot_dir()
        print(json.dumps(build(target), ensure_ascii=False, indent=1))
    else:
        print("usage: python -m runway_routing.source_snapshot build [dir]")

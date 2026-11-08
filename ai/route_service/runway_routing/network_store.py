"""Compact on-disk Busan road network (all highway ways, all tags, node coordinates, segments) read as numpy arrays.

요약: BusanSource(way 7.3만 개, node 52만 개)를 Python dict 대신 배열로 들고 있게 한다. 파일은 npz(allow_pickle=False) +
json이고, 런타임은 dict를 만들지 않고 view(ways / lonlat / pos)로 필요한 순간에만 값을 꺼낸다(기동 메모리 약 −250 MiB).
위치: FastGraphRouteGenerator.__init__ (graph.py)가 canonical RouteGenerator.__init__ 동안만 BusanSource 생성을 이 모듈로
돌린다(S1 source_snapshot 안쪽). key가 하나라도 다르거나 파일이 깨졌으면 S1 snapshot → PBF 순으로 내려간다(같은 결과).
주의: way·node·tag를 하나도 빼지 않는다. 달릴 수 없는 길도 교차로 수, Gate, 교통 거리, node 순서(set 순회)에 쓰인다.
분류(classify) 결과는 저장하지 않고 기동 때 계산한다(분류 코드가 바뀌어도 이 파일이 낡지 않는다).

key: extract sha256 + analysis/runway_busan_graph.py·이 모듈 sha256 + Python/platform/numpy/osmium/pyproj/PROJ/osmnx 버전 +
FORMAT. 파일 sha256은 manifest에 있고 읽을 때 다시 확인한다.
만들기(배포/image build 단계, 런타임은 읽기만):  python -B -m runway_routing.network_store build [dir]
환경변수 RUNWAY_NETWORK_STORE: 없으면 data/osm/busan/network_v1, "0"이면 끔(S1 snapshot / PBF), 그 밖에는 디렉터리 경로.
"""
from collections.abc import Mapping, Sequence
from contextlib import contextmanager
import hashlib
from importlib.metadata import version as pkg_version
from itertools import groupby, pairwise
import json
import os
from pathlib import Path
import platform
import sys
import time
import zipfile

import numpy as np

from .data import api

FORMAT = 1
MANIFEST, ARRAYS, STRINGS = "manifest.json", "network.npz", "strings.json"
_HERE = Path(__file__).resolve().parent
_PARSE = api.busan.BusanSource          # the real parser class (hooks replace the module attribute only temporarily)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def store_dir() -> Path | None:
    d = os.environ.get("RUNWAY_NETWORK_STORE")
    if d == "0":
        return None
    return Path(d) if d else api.busan.BUSAN_DIR / "network_v1"


def key(extract: Path) -> dict:
    """Everything the stored arrays depend on. Any difference -> the store is not used."""
    import osmium
    import pyproj
    return {"format": FORMAT, "extract_file": extract.name, "extract_sha256": _sha256(extract),
            "parser_sha256": _sha256(Path(api.busan.__file__)), "store_code_sha256": _sha256(_HERE / "network_store.py"),
            "python": sys.version, "platform": platform.machine(), "numpy": np.__version__,
            "osmium": pkg_version("osmium"), "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
            "osmnx": pkg_version("osmnx")}


# ------------------------------------------------------------------ arrays <-> BusanSource
def segments(node_ids, lonlat, way_refs) -> dict:
    """Substrate's segments: per way, consecutive distinct node pairs (osmnx drops repeats), great-circle length as in
    build_fast (osmnx distance.great_circle, NaN -> 0). Same loop and expression as substrate.Substrate."""
    from osmnx import distance
    pos = {int(n): i for i, n in enumerate(node_ids.tolist())}
    sw, sa, sb = [], [], []
    for i, refs in enumerate(way_refs):
        nodes = [g[0] for g in groupby(refs)]
        for a, b in pairwise(nodes):
            sw.append(i)
            sa.append(pos[a])
            sb.append(pos[b])
    seg_w, seg_a, seg_b = np.array(sw, np.int32), np.array(sa, np.int64), np.array(sb, np.int64)
    lon, lat = lonlat[:, 0].copy(), lonlat[:, 1].copy()
    d = distance.great_circle(lat[seg_a], lon[seg_a], lat[seg_b], lon[seg_b])
    d[np.isnan(d)] = 0
    return {"seg_w": seg_w, "seg_a": seg_a, "seg_b": seg_b, "seg_len": d}


def _fields(src) -> tuple[dict, list]:
    """BusanSource -> (numpy arrays, string table). Tags keep each way's own key order; every way and tag is kept."""
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
    flat = np.array(refs, np.int64)
    order = np.argsort(src.node_ids)
    ref_pos = order[np.searchsorted(src.node_ids, flat, sorter=order)]      # graph.Sidecar.ref_pos (same expression)
    arrays = {"way_ids": way_ids, "ref_ptr": np.array(ref_ptr, np.int64), "ref_pos": ref_pos,
              "tag_ptr": np.array(tag_ptr, np.int64), "tag_k": np.array(tk, np.int32), "tag_v": np.array(tv, np.int32),
              "node_ids": src.node_ids, "lonlat": ll, "xy": src.xy}
    arrays |= segments(src.node_ids, ll, (src.ways[w][0] for w in src.ways))
    return arrays, strings


class _Lookup:
    """Exact int64 id -> position (searchsorted on the sorted ids; no Python dict). KeyError / default when absent."""

    def __init__(self, ids: np.ndarray):
        self.ids = ids
        self.order = None if bool(np.all(ids[1:] > ids[:-1])) else np.argsort(ids, kind="stable")
        self.sorted = ids if self.order is None else ids[self.order]

    def find(self, x) -> int:
        try:
            x = int(x)
        except (TypeError, ValueError):
            return -1
        i = int(np.searchsorted(self.sorted, x))
        if i == len(self.sorted) or int(self.sorted[i]) != x:
            return -1
        return i if self.order is None else int(self.order[i])

    def many(self, xs: np.ndarray) -> np.ndarray:
        """Positions of every id in xs (all must exist)."""
        i = np.searchsorted(self.sorted, xs)
        if len(xs) and (i.max() >= len(self.sorted) or not np.array_equal(self.sorted[i], xs)):
            raise KeyError("id not in the network")
        return i if self.order is None else self.order[i]


class PosView(Mapping):
    """BusanSource.pos {node id: position} without the dict."""

    def __init__(self, lookup: _Lookup):
        self._l = lookup

    def __getitem__(self, n):
        i = self._l.find(n)
        if i < 0:
            raise KeyError(n)
        return i

    def get(self, n, default=None):
        i = self._l.find(n)
        return default if i < 0 else i

    def __contains__(self, n):
        return self._l.find(n) >= 0

    def __iter__(self):
        return iter(self._l.ids.tolist())

    def __len__(self):
        return len(self._l.ids)

    def many(self, ids) -> np.ndarray:
        return self._l.many(np.asarray(ids, dtype=np.int64))


class LonLatView(Mapping):
    """BusanSource.lonlat {node id: (lon, lat)} without the dict: the same Python floats (float64 values)."""

    def __init__(self, lookup: _Lookup, lonlat: np.ndarray):
        self._l, self._ll = lookup, lonlat

    def __getitem__(self, n):
        i = self._l.find(n)
        if i < 0:
            raise KeyError(n)
        return float(self._ll[i, 0]), float(self._ll[i, 1])

    def get(self, n, default=None):
        i = self._l.find(n)
        return default if i < 0 else (float(self._ll[i, 0]), float(self._ll[i, 1]))

    def __contains__(self, n):
        return self._l.find(n) >= 0

    def __iter__(self):
        return iter(self._l.ids.tolist())

    def __len__(self):
        return len(self._l.ids)


class WaysView(Mapping):
    """BusanSource.ways {way id: (refs list, tags dict)} without the dicts: each access builds a fresh (refs, tags) in the
    original order (way order = file order, tag order = the way's own). Callers only read them."""

    def __init__(self, net: dict, strings: list):
        self._net, self._s = net, strings
        self._l = _Lookup(net["way_ids"])
        self._ids = net["node_ids"]

    def way(self, i: int) -> tuple:
        n, s = self._net, self._s
        a, b = int(n["ref_ptr"][i]), int(n["ref_ptr"][i + 1])
        refs = self._ids[n["ref_pos"][a:b]].tolist()
        p, q = int(n["tag_ptr"][i]), int(n["tag_ptr"][i + 1])
        tags = {s[k]: s[v] for k, v in zip(n["tag_k"][p:q].tolist(), n["tag_v"][p:q].tolist())}
        return refs, tags

    def __getitem__(self, w):
        i = self._l.find(w)
        if i < 0:
            raise KeyError(w)
        return self.way(i)

    def get(self, w, default=None):
        i = self._l.find(w)
        return default if i < 0 else self.way(i)

    def __contains__(self, w):
        return self._l.find(w) >= 0

    def __iter__(self):
        return iter(self._net["way_ids"].tolist())

    def __len__(self):
        return len(self._net["way_ids"])

    def keys(self):
        return self._net["way_ids"].tolist()

    def items(self):
        return ((w, self.way(i)) for i, w in enumerate(self._net["way_ids"].tolist()))

    def values(self):
        return (self.way(i) for i in range(len(self)))


class CompactSource(_PARSE):
    """BusanSource from the store: same attribute names and values, views instead of dicts (disk_graph is canonical's).
    net: the stored arrays (way_ids, ref_ptr, ref_pos, tag_*, node_ids, lonlat, xy, seg_*), strings: the tag table."""

    def __init__(self, arrays: dict, strings: list, path: Path):   # noqa: super().__init__ parses the PBF; not called
        self.path = path
        self.net, self.strings = arrays, strings
        self.node_ids = arrays["node_ids"]
        self.xy = arrays["xy"]
        nodes = _Lookup(self.node_ids)
        self.lonlat = LonLatView(nodes, arrays["lonlat"])
        self.pos = PosView(nodes)
        self.ways = WaysView(arrays, strings)


class RefsView(Sequence):
    """Sidecar.refs[i] (the way's node id list) built on access."""

    def __init__(self, net: dict):
        self._net = net

    def __getitem__(self, i):
        n = self._net
        return n["node_ids"][n["ref_pos"][int(n["ref_ptr"][i]):int(n["ref_ptr"][i + 1])]].tolist()

    def __len__(self):
        return len(self._net["way_ids"])


class AttrsView(Sequence):
    """Sidecar.attrs[i] = {"osmid": wid, useful tags in `useful` order: str value} built on access from a code matrix."""

    def __init__(self, net: dict, strings: list, useful: list, way_ids: list):
        self._s, self._useful, self._wid = strings, useful, way_ids
        col = {k: j for j, k in enumerate(useful)}
        kcol = np.array([col.get(s, -1) for s in strings], np.int64)[net["tag_k"]]
        row = np.repeat(np.arange(len(way_ids)), np.diff(net["tag_ptr"]))
        m = kcol >= 0
        codes = np.full((len(way_ids), len(useful)), -1, np.int32)
        codes[row[m], kcol[m]] = net["tag_v"][m]
        self.codes = codes

    def __getitem__(self, i):
        s = self._s
        a = {"osmid": self._wid[i]}
        for t, c in zip(self._useful, self.codes[i].tolist()):
            if c >= 0:
                a[t] = s[c]
        return a

    def __len__(self):
        return len(self._wid)


class ClsView(Mapping):
    """Sidecar.cls {wid: (status, reason)} from the per-way lists."""

    def __init__(self, way_ids_arr: np.ndarray, status: list, reason: list):
        self._l, self._st, self._re = _Lookup(way_ids_arr), status, reason

    def __getitem__(self, w):
        i = self._l.find(w)
        if i < 0:
            raise KeyError(w)
        return self._st[i], self._re[i]

    def __iter__(self):
        return iter(self._l.ids.tolist())

    def __len__(self):
        return len(self._st)


def _restore(arrays: dict, strings: list, path: Path) -> CompactSource:
    return CompactSource(arrays, strings, path)


def compare(a, b) -> list:
    """Field equality of a parsed BusanSource and a CompactSource (every way: refs, tag order and values; every node:
    lonlat float hex, position; numpy bytes). Returns the differing field names."""
    out = []
    for k in ("node_ids", "xy"):
        x, y = getattr(a, k), getattr(b, k)
        if not (x.dtype == y.dtype and x.shape == y.shape and x.tobytes() == y.tobytes()):
            out.append(k)
    if list(a.ways.keys()) != list(b.ways.keys()):
        out.append("ways.keys")
    else:
        for w, (r, t) in a.ways.items():
            r2, t2 = b.ways[w]
            if r != r2 or type(r2) is not list or list(t.items()) != list(t2.items()):
                out.append(f"ways[{w}]")
                break
    if list(a.lonlat.keys()) != list(b.lonlat.keys()):
        out.append("lonlat.keys")
    elif any(p[0].hex() != q[0].hex() or p[1].hex() != q[1].hex()
             for p, q in zip(a.lonlat.values(), (b.lonlat[n] for n in a.lonlat))):
        out.append("lonlat.values")
    if any(b.pos[n] != i for n, i in a.pos.items()):
        out.append("pos")
    if b.ways.get(-1) is not None or b.lonlat.get(-1) is not None or b.pos.get(-1) is not None:
        out.append("missing-id semantics")
    return out


def build(out: Path, extract: Path | None = None) -> dict:
    """Parse the extract, write the store (manifest last), load it back and require field equality."""
    extract = extract or api.busan._busan_pbf()
    out.mkdir(parents=True, exist_ok=True)
    (out / MANIFEST).unlink(missing_ok=True)        # no manifest = not usable while writing
    t0 = time.perf_counter()
    src = _PARSE(extract)
    parse_s = time.perf_counter() - t0
    arrays, strings = _fields(src)
    np.savez(out / ARRAYS, **arrays)
    (out / STRINGS).write_text(json.dumps(strings, ensure_ascii=False), encoding="utf-8")
    with np.load(out / ARRAYS, allow_pickle=False) as z:
        back_arrays = {k: z[k] for k in z.files}
    for k, v in arrays.items():
        w = back_arrays[k]
        if not (v.dtype == w.dtype and v.shape == w.shape and v.tobytes() == w.tobytes()):
            raise RuntimeError(f"array {k} changed on the round trip")
    back = _restore(back_arrays, json.loads((out / STRINGS).read_text(encoding="utf-8")), extract)
    diff = compare(src, back)
    if diff:
        raise RuntimeError(f"store differs from the parsed extract: {diff}")
    man = {"key": key(extract), "files": {f: _sha256(out / f) for f in (ARRAYS, STRINGS)},
           "counts": {"ways": len(src.ways), "nodes": int(len(src.node_ids)), "strings": len(strings),
                      "tag_pairs": int(len(arrays["tag_k"])), "segments": int(len(arrays["seg_w"]))},
           "parse_s": round(parse_s, 3), "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    (out / MANIFEST).write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    return man


def load(d: Path, extract: Path, status: dict):
    """CompactSource from the store in d, or None (status["reason"] says why) when anything does not match."""
    try:
        man = json.loads((d / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError) as ex:
        status["reason"] = f"no manifest: {type(ex).__name__}"
        return None
    want = key(extract)   # hashes the extract: a missing PBF still raises here (not a derived-file problem)
    # 441 R4: a malformed manifest (not an object, no "files", wrong types), an unreadable file or a broken npz / strings
    # file is a derived-file problem -> record why and return None, so the factory falls back (snapshot / PBF).
    try:
        if not isinstance(man, dict) or not isinstance(man.get("key"), dict):
            status["reason"] = "malformed manifest"
            return None
        if man["key"] != want:
            status["reason"] = "key mismatch: " + ",".join(k for k in want if man["key"].get(k) != want[k])
            return None
        for f in (ARRAYS, STRINGS):
            if not (d / f).is_file() or _sha256(d / f) != man["files"].get(f):
                status["reason"] = f"file hash mismatch: {f}"
                return None
        with np.load(d / ARRAYS, allow_pickle=False) as z:
            arrays = {k: z[k] for k in z.files}
        strings = json.loads((d / STRINGS).read_text(encoding="utf-8"))
        src = _restore(arrays, strings, extract)
    except (OSError, ValueError, KeyError, IndexError, TypeError, AttributeError, EOFError, zipfile.BadZipFile) as ex:
        status["reason"] = f"unreadable or malformed: {type(ex).__name__}"
        return None
    status["reason"] = ""
    return src


@contextmanager
def source_from_store(busan_module, status: dict):
    """While active, busan_module.BusanSource(path) returns the CompactSource of the validated store, else whatever
    busan_module.BusanSource was on entry (the S1 snapshot loader / the PBF parser). Restores the attribute afterwards."""
    d = store_dir()
    if d is None:
        status.update(used=False, reason="disabled (RUNWAY_NETWORK_STORE=0)")
        yield
        return
    previous = busan_module.BusanSource

    def factory(path=None):
        extract = path or busan_module._busan_pbf()
        t0 = time.perf_counter()
        src = load(d, Path(extract), status)
        status.update(used=src is not None, dir=str(d), load_s=round(time.perf_counter() - t0, 3))
        return src if src is not None else previous(path)

    busan_module.BusanSource = factory
    try:
        yield
    finally:
        busan_module.BusanSource = previous


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "build":
        target = Path(sys.argv[2]) if len(sys.argv) > 2 else store_dir()
        print(json.dumps(build(target), ensure_ascii=False, indent=1))
    else:
        print("usage: python -B -m runway_routing.network_store build [dir]")

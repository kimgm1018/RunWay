"""Compare two golden runs (capture.py output directories).

    python -B tools/route_regression/compare.py <A: baseline dir> <B: new run dir> [--known tools/route_regression/known_differences.json]
                                                   -> exit 0 iff every required artifact matches

Required (byte compare after removing timing keys, key order kept): HTTP status, response body, status_start/end,
gate JSONL lines, pipeline `out` dicts. The scenario list (ids and order) must be the same and non-empty. Every
scenario must have resp.json in both directories; a scenario that ran the pipeline in A (meta "runs") must have
out.json and gate.jsonl in both. A missing required artifact fails. An `out` whose key order differs fails (S15P31E105-441:
README "out key order is part of the Golden contract"); before, this was informational only.
Informational: raw (unstripped) byte equality.

Without --known the comparison is strict. With --known, an entry applies only when its mode matches the mode of BOTH
directories (the part after the last "_" in the directory name, or the whole name: baseline/shadow, mytag_shadow) and
the artifact differs at exactly that path, with exactly those values, and nowhere else. It is then reported under
"known_differences" instead of failing.
"""
import json
import sys
from pathlib import Path

TIMING = {"seconds", "canonical_timings_s", "build_s", "env_s", "runtime_s", "timings_s", "load_s", "load_seconds",
          "sidecar_build_s", "self_test_s", "ts"}


def strip(o):
    if isinstance(o, dict):
        return {k: strip(v) for k, v in o.items() if k not in TIMING}
    if isinstance(o, list):
        return [strip(v) for v in o]
    return o


def dump(o, sort=False) -> str:
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"), sort_keys=sort)


def load(p: Path):
    raw = p.read_bytes()
    try:
        return raw, json.loads(raw.decode("utf-8"))
    except ValueError:
        return raw, None


def known_for(A: Path, B: Path, path: str | None):
    if not path:
        return []
    mode = A.name.rsplit("_", 1)[-1]
    es = json.loads(Path(path).read_text(encoding="utf-8"))["entries"]
    return [e for e in es if e["mode"] == mode and B.name.rsplit("_", 1)[-1] == mode]


def is_known(sid, kind, ja, jb, known):
    for e in known:
        if (e["scenario"], e["artifact"]) != (sid, kind):
            continue
        try:
            a, b = ja, jb
            for k in e["path"][:-1]:
                a, b = a[k], b[k]
            last = e["path"][-1]
            if a[last] is not e["before"] or b[last] is not e["after"]:
                continue
            a[last] = b[last] = None          # mask the one allowed field, the rest must match exactly
            ok = dump(ja, True) == dump(jb, True)
            a[last], b[last] = e["before"], e["after"]
        except (KeyError, IndexError, TypeError):
            continue
        if ok:
            return e["id"]
    return None


def main() -> int:
    args = sys.argv[1:]
    kpath = args[args.index("--known") + 1] if "--known" in args else None
    A, B = Path(args[0]), Path(args[1])
    known = known_for(A, B, kpath)
    ma, mb = json.loads((A / "meta.json").read_text()), json.loads((B / "meta.json").read_text())
    ia, ib = {x["id"]: x for x in ma["items"]}, {x["id"]: x for x in mb["items"]}
    fails, info = [], {"raw_identical": 0, "out_keyorder_diff": [], "artifacts": 0}
    if kpath:
        info["known_differences"] = []
    if not ia:
        fails.append(("scenario_list", "A has no scenarios"))
    if list(ia) != list(ib):
        fails.append(("scenario_list", "ids or order differ", sorted(set(ia) ^ set(ib))))
    for sid in ia:
        if sid not in ib:
            continue
        if ia[sid]["http"] != ib[sid]["http"]:
            fails.append((sid, "http", ia[sid]["http"], ib[sid]["http"]))
        required = ("resp.json", "out.json", "gate.jsonl") if "runs" in ia[sid] else ("resp.json",)
        for kind in ("resp.json", "out.json", "gate.jsonl"):
            pa, pb = A / f"{sid}.{kind}", B / f"{sid}.{kind}"
            if not pa.exists() and not pb.exists():
                if kind in required:
                    fails.append((sid, kind, "missing in both"))
                continue
            info["artifacts"] += 1
            if not (pa.exists() and pb.exists()):
                fails.append((sid, kind, "missing"))
                continue
            if pa.read_bytes() == pb.read_bytes():
                info["raw_identical"] += 1
            if kind == "gate.jsonl":
                la = [dump(strip(json.loads(x))) for x in pa.read_text(encoding="utf-8").splitlines()]
                lb = [dump(strip(json.loads(x))) for x in pb.read_text(encoding="utf-8").splitlines()]
                if la != lb:
                    fails.append((sid, kind, len(la), len(lb)))
                continue
            (_, ja), (_, jb) = load(pa), load(pb)
            if ja is None or jb is None:
                if pa.read_bytes() != pb.read_bytes():
                    fails.append((sid, kind, "non-json differs"))
                continue
            if kind == "resp.json":
                if dump(strip(ja)) != dump(strip(jb)):
                    fails.append((sid, kind, first_diff(strip(ja), strip(jb))))
            else:
                sa, sb = strip(ja), strip(jb)
                order = key_order_diff(sa, sb)
                if order:
                    info["out_keyorder_diff"].append(sid)
                    fails.append((sid, kind, "key order", order))
                elif dump(sa) != dump(sb):
                    kid = is_known(sid, kind, sa, sb, known)
                    if kid:
                        info["known_differences"].append((kid, sid, kind, first_diff(sa, sb)))
                    else:
                        fails.append((sid, kind, first_diff(sa, sb)))
    for f in ("status_start.json", "status_end.json"):
        (_, ja), (_, jb) = load(A / f), load(B / f)
        info["artifacts"] += 1
        if dump(strip(ja)) != dump(strip(jb)):
            fails.append((f, first_diff(strip(ja), strip(jb))))
    print(json.dumps({"A": str(A.name), "B": str(B.name), "fails": len(fails), **info}, ensure_ascii=False))
    for f in fails[:40]:
        print("FAIL", f)
    return 1 if fails else 0


def key_order_diff(a, b, path="$"):
    """First path where both sides are dicts with the same keys in a different order (values are not compared)."""
    if isinstance(a, dict) and isinstance(b, dict):
        if list(a) != list(b) and set(a) == set(b):
            return f"{path}: {list(a)[:12]} != {list(b)[:12]}"
        for k in a:
            if k in b:
                d = key_order_diff(a[k], b[k], f"{path}.{k}")
                if d:
                    return d
    elif isinstance(a, list) and isinstance(b, list):
        for i, (x, y) in enumerate(zip(a, b)):
            d = key_order_diff(x, y, f"{path}[{i}]")
            if d:
                return d
    return None


def first_diff(a, b, path="$"):
    if type(a) is not type(b):
        return f"{path}: type {type(a).__name__} != {type(b).__name__}"
    if isinstance(a, dict):
        if list(a) != list(b):
            return f"{path}: keys {list(a)[:12]} != {list(b)[:12]}"
        for k in a:
            d = first_diff(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: len {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    return None if a == b else f"{path}: {str(a)[:80]} != {str(b)[:80]}"


if __name__ == "__main__":
    sys.exit(main())

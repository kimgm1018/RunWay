"""Index-only V2 Train window cache (Stage 2). Writes only under outputs/cache_v2_train/ of this experiment.

Stores canonical 5 s row arrays of the 44,836 optimizer sessions, every 5 s candidate t0 (physiology_v1 rules) with
HR0 source / LOCF age / quality flags, the session table (Personal4 row, canonical rows, History range) and the
causal History row store. Stride and HR0 policy are chosen by train_data at load time. Same inputs + same config
-> same content_hash (timestamps and code hashes are recorded but excluded from it).

    python -m ptv2.train_cache build --workers 8
    python -m ptv2.train_cache verify <cache_dir>     # recompute everything in memory and compare content_hash
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import platform
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow

from . import config as C
from . import v2_data
from .train_scan import (HISTORY_STORE_FEATURES, build_history, causal_violations, scan_canonical, session_table)

CACHE_SCHEMA = "ptv2_v2_train_index_v1"
CACHE_ROOT = C.OUTPUT_ROOT / "cache_v2_train"
ROLES_MANIFEST = Path("~/data/fitrec/manifests/fitrec_hr_v2/session_roles_train_val.parquet").expanduser()
ARRAYS = {"rows_hr": ("hr", np.float32), "rows_speed": ("speed", np.float32), "rows_vertical": ("vertical", np.float32),
          "rows_elapsed": ("elapsed", np.float64), "rows_flags": ("row_flags", np.uint8),
          "win_row": ("win_row", np.int64), "win_session": ("win_session", np.int32), "win_local": ("win_local", np.int32),
          "win_hr0_age": ("win_hr0_age", np.float32), "win_flags": ("win_flags", np.uint16),
          "win_target_valid": ("win_target_valid", np.uint8), "win_past_filled": ("win_past_filled", np.uint8)}
SESSION_COLUMNS = ["session_index", "session_id", "subject_id", "identity_group", "subject_index", "part_file", "row_lo",
                   "row_hi", "n_candidates", "start_ns", "end_ns", "start_native", "hist_lo", "hist_hi", "n_prior",
                   "history_prefix"]
REQUIRED_MANIFEST_KEYS = ("created_utc", "cache_schema", "content_hash", "config", "source", "counts", "causal",
                          "array_sha256", "sessions_sha256", "subject_map_sha256", "code_sha256", "versions")


def sha_array(a) -> str:
    h = hashlib.sha256(f"{np.dtype(a.dtype).str}{tuple(a.shape)}".encode())
    h.update(np.ascontiguousarray(a).tobytes())
    return h.hexdigest()


def sha_frame(df: pd.DataFrame) -> str:
    h = hashlib.sha256()
    for col in df.columns:
        values = df[col].to_numpy()
        h.update(col.encode())
        h.update("\x1f".join(map(str, values)).encode() if values.dtype == object else np.ascontiguousarray(values).tobytes())
    return h.hexdigest()


def sha_file(path) -> str:
    return v2_data.reference().protocol.sha256_file(path)


def code_hashes() -> dict:
    root = Path(__file__).resolve().parent
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob("*.py"))}


def cache_config(per_sec, time_unit) -> dict:
    return dict(
        cache_schema=CACHE_SCHEMA, train_rule="Training Amendment 1 Full Causal Train (shared.fitrec_v2 assign_roles default)",
        grid_s=C.GRID_S, past_steps=C.PAST_STEPS, future_steps=C.FUTURE_STEPS, horizon_index=C.HORIZON_INDEX,
        window_rules="shared/fitrec_v2/windows.py physiology_v1 on canonical 5 s rows; every 5 s t0 kept "
                     "(the 30 s anchor is the stride=30/phase=0 selection)",
        candidate_stride_s=5, selectable_strides_s=[5, 10, 30],
        hr0_policy="none at cache level: each candidate stores HR0 source (measured/LOCF) and LOCF age; the loader applies "
                   "'all' | 'measured' | 'max_age_s=<x>'",
        history_policy=dict(rule="apple_pretrain_v2 AppleChunkDataset/_history_from_prior: same subject_id, workouts with "
                                 "start < current start and end <= current start, last 512 valid 10 s rows",
                            source="V2 Train 10 s derived cache (read-only)", stored_features=list(HISTORY_STORE_FEATURES),
                            load_time_feature="log1p((current start - workout start) / 1 day)", sentinel="[[-1]*5] when empty",
                            max_rows=C.HISTORY_MAX_LENGTH, time_unit=time_unit, per_sec=per_sec),
        personal4="subject_index = position of subject_id in the sorted Train subject list of the V2 Train cache")


def compute(ctx, workers):
    scan = scan_canonical(ctx, workers=workers)
    sessions = session_table(ctx, scan)
    if len(sessions) != len(ctx.optimizer) or set(sessions.session_id) != set(ctx.optimizer.session_id):
        raise AssertionError("scanned sessions differ from the optimizer manifest")
    hist = build_history(ctx, sessions)
    causal = causal_violations(hist)
    if causal["violations"]:
        raise AssertionError(f"causal History violations: {causal}")
    for key in ("start_ns", "end_ns", "start_native", "hist_lo", "hist_hi", "n_prior"):
        sessions[key] = hist[key]
    sessions["history_prefix"] = hist["prefix"]
    sessions = sessions[SESSION_COLUMNS]
    arrays = {name: np.ascontiguousarray(scan[key].astype(dtype, copy=False)) for name, (key, dtype) in ARRAYS.items()}
    arrays["hist_feat"] = np.ascontiguousarray(hist["hist_feat"].astype(np.float32, copy=False))
    arrays["hist_owner"] = np.ascontiguousarray(hist["hist_owner"].astype(np.int32, copy=False))
    return arrays, sessions, hist, causal


def summary(ctx, arrays, sessions, hist, causal):
    cfg = cache_config(hist["per_sec"], hist["time_unit"])
    array_hashes = {name: sha_array(a) for name, a in sorted(arrays.items())}
    subject_map_hash = hashlib.sha256(json.dumps(sorted(ctx.subject_map.items())).encode()).hexdigest()
    sessions_hash = sha_frame(sessions)
    source = dict(split_path=str(ctx.split.path), split_sha256=ctx.split.sha256, fitrec_root=str(C.FITREC_ROOT),
                  canonical_sessions_sha256=sha_file(C.FITREC_ROOT / "sessions.parquet"),
                  canonical_build_summary_sha256=sha_file(C.FITREC_ROOT / "build_summary.json"),
                  roles_manifest=str(ROLES_MANIFEST), roles_manifest_sha256=sha_file(ROLES_MANIFEST),
                  v2_train_derived_cache=str(ctx.manifest.cache_dir),
                  v2_train_derived_fingerprint=json.loads((Path(ctx.manifest.cache_dir) / "manifest.json").read_text())["source_fingerprint"],
                  reference_root=str(C.REF_ROOT))
    local = arrays["win_local"] - (C.PAST_STEPS - 1)
    counts = dict(sessions=len(sessions), subjects=int(sessions.subject_id.nunique()),
                  identity_groups=int(sessions.identity_group.nunique()), subjects_in_map=len(ctx.subject_map),
                  sessions_with_candidates=int((sessions.n_candidates > 0).sum()), rows=int(len(arrays["rows_hr"])),
                  candidates_5s=int(len(arrays["win_row"])),
                  windows_by_stride={f"{s}s": int((local % (s // C.GRID_S) == 0).sum()) for s in (5, 10, 30)},
                  history_store_rows=int(len(arrays["hist_owner"])), sessions_with_history=causal["sessions_with_history"],
                  non_prefix_sessions=hist["n_exceptions"])
    content = hashlib.sha256(json.dumps(dict(config=cfg, source={k: v for k, v in source.items() if "sha256" in k or "fingerprint" in k},
                                             counts=counts, arrays=array_hashes, sessions=sessions_hash,
                                             subject_map=subject_map_hash), sort_keys=True).encode()).hexdigest()
    return dict(cache_schema=CACHE_SCHEMA, content_hash=content, config=cfg, source=source, counts=counts, causal=causal,
                array_sha256=array_hashes, sessions_sha256=sessions_hash, subject_map_sha256=subject_map_hash)


def find_cache(explicit=None):
    if explicit:
        return str(explicit) if (Path(explicit) / "manifest.json").is_file() else None
    found = sorted(CACHE_ROOT.glob(f"{CACHE_SCHEMA}_*/manifest.json"), key=lambda p: p.stat().st_mtime) if CACHE_ROOT.is_dir() else []
    return str(found[-1].parent) if found else None


def build(args):
    started = time.time()
    ctx = v2_data.load_train_context()
    arrays, sessions, hist, causal = compute(ctx, args.workers)
    info = summary(ctx, arrays, sessions, hist, causal)
    final = CACHE_ROOT / f"{CACHE_SCHEMA}_{info['content_hash'][:16]}"
    if final.exists():
        raise FileExistsError(f"{final} exists; refusing to overwrite")
    tmp = final.with_name(final.name + ".partial")
    tmp.mkdir(parents=True, exist_ok=False)
    for name, a in arrays.items():
        np.save(tmp / f"{name}.npy", a)
    sessions.to_parquet(tmp / "sessions.parquet", index=False)
    (tmp / "subject_map.json").write_text(json.dumps(ctx.subject_map, sort_keys=True), encoding="utf-8")
    manifest = dict(created_utc=datetime.now(timezone.utc).isoformat(), **info, code_sha256=code_hashes(),
                    versions=dict(python=platform.python_version(), numpy=np.__version__, pandas=pd.__version__,
                                  pyarrow=pyarrow.__version__),
                    build_seconds=round(time.time() - started, 1))
    (tmp / "manifest.json").write_text(json.dumps(manifest, indent=1, default=str), encoding="utf-8")
    tmp.rename(final)
    size = sum(p.stat().st_size for p in final.iterdir())
    print(f"CACHE_BUILT {final} content_hash={info['content_hash']} bytes={size} seconds={manifest['build_seconds']}", flush=True)


def verify(args):
    manifest = json.loads((Path(args.cache_dir) / "manifest.json").read_text())
    ctx = v2_data.load_train_context()
    arrays, sessions, hist, causal = compute(ctx, args.workers)
    info = summary(ctx, arrays, sessions, hist, causal)
    same = info["content_hash"] == manifest["content_hash"] and info["counts"] == manifest["counts"]
    print(f"VERIFY_{'OK' if same else 'FAIL'} rebuilt={info['content_hash']} stored={manifest['content_hash']} "
          f"counts_equal={info['counts'] == manifest['counts']}", flush=True)
    if not same:
        raise SystemExit(1)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build")
    b.add_argument("--workers", type=int, default=8)
    v = sub.add_parser("verify")
    v.add_argument("cache_dir")
    v.add_argument("--workers", type=int, default=8)
    args = p.parse_args(argv)
    {"build": build, "verify": verify}[args.command](args)


if __name__ == "__main__":
    main()

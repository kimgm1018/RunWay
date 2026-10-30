"""Current-session context (v1): causal summary of the running session from its first row up to t0 (inclusive).

For a window whose t0 row is k in session s the summary uses only rows r with row_start(s) <= r <= k. Rows are stored in
(session, segment, elapsed) order and `check_time_order` verifies that this is time order inside every session, so the
prefix is exactly session_start <= time <= t0. No row after t0 and no whole-session aggregate enters a summary.

Features (raw units; the model normalises them with the frozen V2 Train statistics written by `--build`):
  hr_mean, hr_std, hr_min, hr_max   rows with valid HR (ROW_HR_VALID: measured or LOCF, as in the past tokens)
  speed_mean, speed_std             rows whose speed and grade are valid (finite vertical-speed proxy)
  vspeed_mean, vspeed_std           vertical-speed proxy speed * sin(atan(grade / 100)) on the same rows (grade proxy)
  hr_slope_per_min, speed_slope_per_min
                                    OLS slope per minute over the prefix (time from the session's first row)

The Train summaries are precomputed once per Train cache (one row per candidate window, aligned with win_row):

    python -m ptv2.session_context --build
"""
from __future__ import annotations

import argparse
from dataclasses import replace
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import pandas as pd

from . import config as C
from .train_cache import find_cache
from .train_data import TrainStore, select_windows
from .train_scan import ROW_HR_VALID

VERSION = "session_context_v1"
FEATURES = ("hr_mean", "hr_std", "hr_min", "hr_max", "speed_mean", "speed_std", "vspeed_mean", "vspeed_std",
            "hr_slope_per_min", "speed_slope_per_min")
N_FEATURES = len(FEATURES)
EXCLUDED = {
    "elapsed_at_t0": "already a model input (past_time = elapsed / 1200 on every past token)",
    "hr_recent_minus_session_mean": "linear in hr_mean and the raw past-HR tokens the model already sees",
    "speed_recent_minus_session_mean": "linear in speed_mean and the raw past-speed tokens",
    "hr_speed_slope": "cov(hr, speed) / var(speed) is unstable early in a session and at near-constant pace",
    "grade_mean / grade_std": "raw grade is not in the row store; the vertical-speed proxy (speed x grade) is used",
}
STATS_WINDOWS = dict(stride_s=30, phase=0, hr0_policy="max_age_s=10")  # the Base Train windows
BLOCK_ROWS = 4_000_000


def check_time_order(elapsed, session_row_start, session_row_end) -> int:
    """Number of consecutive row pairs inside a session whose elapsed time does not increase (0 = row order is time order)."""
    el = np.asarray(elapsed, np.float64)
    first = np.zeros(len(el), bool)
    first[np.asarray(session_row_start, np.int64)] = True
    if len(el) and int(np.asarray(session_row_end, np.int64).max()) != len(el):
        raise ValueError("session row ranges do not cover the row arrays")
    return int((np.diff(el)[~first[1:]] <= 0).sum())


def _block(hr, speed, vertical, elapsed, flags, starts, first, t0):
    """Summaries for windows whose session prefix [first, t0] lies in this block of whole sessions (block-local rows)."""
    n = len(hr)
    row_first = starts[np.searchsorted(starts, np.arange(n), side="right") - 1]
    t = (elapsed - elapsed[row_first]) / 60.0
    hv = ((flags & ROW_HR_VALID) != 0) & np.isfinite(hr)
    x = np.where(hv, hr - C.HR_CENTER, 0.0)
    th = np.where(hv, t, 0.0)
    sv = np.isfinite(vertical) & np.isfinite(speed)
    sp = np.where(sv, speed, 0.0)
    vs = np.where(sv, vertical, 0.0)
    ts = np.where(sv, t, 0.0)
    cols = np.column_stack((hv, x, x * x, th, th * th, th * x, sv, sp, sp * sp, vs, vs * vs, ts, ts * ts, ts * sp))
    csum = np.vstack((np.zeros((1, cols.shape[1])), np.cumsum(cols, axis=0)))
    s = csum[t0 + 1] - csum[first]
    hm = pd.Series(np.where(hv, hr, np.nan))
    key = pd.Series(row_first)
    run_min = hm.groupby(key).cummin().groupby(key).ffill().to_numpy()
    run_max = hm.groupby(key).cummax().groupby(key).ffill().to_numpy()
    out = np.full((len(t0), N_FEATURES), np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        nh, ns = s[:, 0], s[:, 6]
        mx = s[:, 1] / nh
        out[:, 0] = C.HR_CENTER + mx
        out[:, 1] = np.sqrt(np.maximum(s[:, 2] / nh - mx * mx, 0.0))
        out[:, 2], out[:, 3] = run_min[t0], run_max[t0]
        ms, mv = s[:, 7] / ns, s[:, 9] / ns
        out[:, 4], out[:, 5] = ms, np.sqrt(np.maximum(s[:, 8] / ns - ms * ms, 0.0))
        out[:, 6], out[:, 7] = mv, np.sqrt(np.maximum(s[:, 10] / ns - mv * mv, 0.0))
        for col, n_, st, stt, sty, sy in ((8, nh, s[:, 3], s[:, 4], s[:, 5], s[:, 1]),
                                          (9, ns, s[:, 11], s[:, 12], s[:, 13], s[:, 7])):
            den = n_ * stt - st * st
            slope = np.where(den > 1e-9 * np.maximum(n_ * stt, 1.0), (n_ * sty - st * sy) / den, 0.0)
            out[:, col] = np.where(n_ > 0, slope, np.nan)
    out[nh == 0, 0:4] = np.nan
    out[nh == 0, 8] = np.nan
    out[ns == 0, 4:8] = np.nan
    out[ns == 0, 9] = np.nan
    return out


def window_summaries(rows: dict, session_row_start, win_row, win_session, *, block_rows: int = BLOCK_ROWS) -> np.ndarray:
    """[n_windows, N_FEATURES] float32 summaries of rows session_start..t0; NaN where a feature has no valid prefix row.

    ``rows``: hr, speed, vertical, elapsed, flags (row arrays); ``session_row_start``: first row of every session;
    ``win_row`` / ``win_session``: t0 row and session index of every window.
    """
    hr = np.asarray(rows["hr"], np.float64)
    speed = np.asarray(rows["speed"], np.float64)
    vertical = np.asarray(rows["vertical"], np.float64)
    elapsed = np.asarray(rows["elapsed"], np.float64)
    flags = np.asarray(rows["flags"])
    n = len(hr)
    session_row_start = np.asarray(session_row_start, np.int64)
    starts = np.sort(session_row_start)
    win_row = np.asarray(win_row, np.int64)
    first = session_row_start[np.asarray(win_session, np.int64)]
    nxt = np.searchsorted(starts, first, side="right")
    end = np.where(nxt < len(starts), starts[np.minimum(nxt, len(starts) - 1)], n)
    if len(win_row) and ((first > win_row).any() or (win_row >= end).any()):
        raise ValueError("every window's t0 row must lie inside its own session")
    out = np.full((len(win_row), N_FEATURES), np.nan, np.float32)
    order = np.argsort(win_row, kind="stable")
    by_row = win_row[order]
    b = 0
    while b < n:
        i = np.searchsorted(starts, b + block_rows)
        e = int(starts[i]) if i < len(starts) else n
        sel = order[np.searchsorted(by_row, b):np.searchsorted(by_row, e)]
        if len(sel):
            local = starts[(starts >= b) & (starts < e)] - b
            out[sel] = _block(hr[b:e], speed[b:e], vertical[b:e], elapsed[b:e], flags[b:e], local,
                              first[sel] - b, win_row[sel] - b)
        b = e
    return out


def train_statistics(x: np.ndarray) -> dict:
    """Frozen normalisation statistics (V2 Train only): per-feature mean / std (floored) and quantiles, NaN ignored."""
    q = np.nanpercentile(x, [1, 50, 99], axis=0)
    return dict(features=list(FEATURES), mean=np.nanmean(x, axis=0).tolist(),
                std=np.maximum(np.nanstd(x, axis=0), 1e-6).tolist(), p01=q[0].tolist(), p50=q[1].tolist(),
                p99=q[2].tolist(), missing=np.isnan(x).sum(axis=0).astype(int).tolist(), n_windows=int(len(x)))


def artifact_dir(store: TrainStore) -> Path:
    return C.OUTPUT_ROOT / "session_context" / f"{VERSION}-{store.manifest['content_hash'][:16]}"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 24), b""):
            digest.update(block)
    return digest.hexdigest()


def build_train_artifact(store: TrainStore, *, log=print) -> Path:
    """Summaries of every Train candidate window + frozen Train statistics, in a new directory (never overwritten)."""
    out = artifact_dir(store)
    if out.exists():
        raise FileExistsError(out)
    start = time.time()
    sessions = pd.read_parquet(Path(store.path) / "sessions.parquet", columns=["row_lo", "row_hi"])
    rows = {k: store.arrays[f"rows_{k}"] for k in ("hr", "speed", "vertical", "elapsed", "flags")}
    violations = check_time_order(rows["elapsed"], sessions.row_lo.to_numpy(), sessions.row_hi.to_numpy())
    if violations:
        raise ValueError(f"{violations} row pairs out of time order: the row prefix is not a time prefix")
    summary = window_summaries(rows, sessions.row_lo.to_numpy(), store.arrays["win_row"], store.arrays["win_session"])
    stats_index = select_windows(store, **STATS_WINDOWS)
    stats = train_statistics(summary[stats_index])
    missing = np.isnan(summary)
    summary = np.where(missing, np.asarray(stats["mean"], np.float32), summary).astype(np.float32)
    tmp = out.with_name(out.name + ".partial")
    tmp.mkdir(parents=True, exist_ok=False)
    np.save(tmp / "win_summary.npy", summary)
    manifest = dict(version=VERSION, created_utc=datetime.now(timezone.utc).isoformat(), cache=str(store.path),
                    cache_content_hash=store.manifest.get("content_hash"), n_windows=int(len(summary)),
                    features=list(FEATURES), excluded=EXCLUDED, definition=__doc__, stats_window_set=STATS_WINDOWS,
                    train_statistics=stats, time_order_violations=violations,
                    missing_filled_with_train_mean=dict(zip(FEATURES, missing.sum(axis=0).astype(int).tolist())),
                    summary_sha256=_sha256(tmp / "win_summary.npy"), code_sha256=_sha256(Path(__file__)),
                    seconds=round(time.time() - start, 1))
    (tmp / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    tmp.rename(out)
    log(f"[session_context] built {out}: {len(summary):,} windows, stats over {len(stats_index):,} "
        f"({manifest['seconds']}s)")
    return out


def attach_train(store: TrainStore, *, log=print) -> TrainStore:
    """The Train store with its precomputed summaries (memory-mapped) and frozen statistics attached."""
    d = artifact_dir(store)
    if not d.exists():
        raise FileNotFoundError(f"{d} missing: run python -m ptv2.session_context --build")
    manifest = json.loads((d / "manifest.json").read_text())
    if manifest["version"] != VERSION or manifest["cache_content_hash"] != store.manifest.get("content_hash"):
        raise ValueError(f"{d} was built for another cache or version")
    summary = np.load(d / "win_summary.npy", mmap_mode="r")
    if summary.shape != (len(store.arrays["win_row"]), N_FEATURES):
        raise ValueError(f"{d}: summary shape {summary.shape} does not match the cache")
    stats = dict(manifest["train_statistics"], version=VERSION, artifact=str(d),
                 summary_sha256=manifest["summary_sha256"], stats_window_set=manifest["stats_window_set"],
                 excluded=manifest["excluded"])
    log(f"[session_context] attached {d} ({summary.shape[0]:,} windows)")
    return replace(store, session_summary=summary, session_stats=stats)


def val_summaries(scan: dict, stats: dict) -> tuple[np.ndarray, dict]:
    """Summaries of every scanned Val window (aligned with scan['win_row']); missing values -> frozen Train mean."""
    violations = check_time_order(scan["elapsed"], scan["session_row_start"], scan["session_row_end"])
    if violations:
        raise ValueError(f"{violations} Val row pairs out of time order")
    rows = dict(hr=scan["hr"], speed=scan["speed"], vertical=scan["vertical"], elapsed=scan["elapsed"],
                flags=scan["row_flags"])
    summary = window_summaries(rows, scan["session_row_start"], scan["win_row"], scan["win_session"])
    missing = np.isnan(summary)
    summary = np.where(missing, np.asarray(stats["mean"], np.float32), summary).astype(np.float32)
    return summary, dict(version=VERSION, n_windows=int(len(summary)), time_order_violations=violations,
                         missing_filled_with_train_mean=dict(zip(FEATURES, missing.sum(axis=0).astype(int).tolist())))


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--build", action="store_true", help="precompute the Train summaries and statistics")
    p.add_argument("--cache")
    args = p.parse_args(argv)
    if not args.build:
        p.error("nothing to do (use --build)")
    build_train_artifact(TrainStore.load(find_cache(args.cache)))


if __name__ == "__main__":
    main()

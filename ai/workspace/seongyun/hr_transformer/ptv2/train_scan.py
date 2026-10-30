"""Full Final Split V2 Train scan (Training Amendment 1, all optimizer sessions). Read-only; shared by train_audit
(statistics only) and train_cache (index-only cache).

Canonical part: canonical 5 s rows of the optimizer sessions and every candidate t0 on the 5 s grid under the
physiology_v1 window rules of shared/fitrec_v2/windows.py (the 30 s anchor filter is applied later, per stride),
plus HR0 source (measured / LOCF) and LOCF age at t0.
History part: the 10 s derived Train cache of the V2 loader, one row store per subject in chronological workout
order; a session's History = the last <= 512 valid rows of that subject's workouts that started before it and ended
no later than its start (apple_pretrain_v2.data._history_from_prior). The log-gap feature depends on the current
session, so it is computed at load time from the stored workout start.
"""
from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
import multiprocessing
import time

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from . import config as C
from . import v2_data

H_ROWS = np.array([C.HORIZON_INDEX[h] + 1 for h in (30, 60, 120)])   # t0 + 6 / 12 / 24 rows
ROW_HR_VALID, ROW_HR_FILLED, ROW_HR_FILLED_NAN = 1, 2, 4
WIN_MEASURED, WIN_FILLED_NAN, WIN_T0_LOW, WIN_ANY_LOW = 1, 2, 4, 8
WIN_TARGET_FILLED = (16, 32, 64)   # target row at +30 / +60 / +120 s is LOCF
HISTORY_STORE_FEATURES = ("hr_norm=(hr-142)/22", "time=elapsed_s/1200", "speed_mps", "vertical_speed_mps")


def _all_ok(bad, start, length):
    cs = np.r_[0, np.cumsum(bad)]
    return (cs[start + length] - cs[start]) == 0


def scan_part(job):
    """One canonical part file -> row arrays and candidate windows of the given sessions (5 s stride)."""
    path, session_ids = job
    table = pq.read_table(path, columns=v2_data.TS_COLUMNS, filters=[("session_id", "in", session_ids)])
    df = table.to_pandas()
    df["session_id"] = df.session_id.astype(str)
    df = df.sort_values(["session_id", "segment_id", "elapsed_s"], kind="stable").reset_index(drop=True)
    n = len(df)
    sess, seg = df.session_id.to_numpy(), df.segment_id.to_numpy()
    new = np.ones(n, bool)
    new[1:] = (sess[1:] != sess[:-1]) | (seg[1:] != seg[:-1])
    starts = np.flatnonzero(new)
    lens = np.diff(np.r_[starts, n])
    seg_of_row = np.repeat(np.arange(len(starts)), lens)
    seg_start = starts[seg_of_row]
    local = np.arange(n) - seg_start
    seg_len = lens[seg_of_row]
    el = df.elapsed_s.to_numpy(np.float64)
    if not np.all(np.diff(el)[~new[1:]] == C.GRID_S):
        raise ValueError(f"non-contiguous 5 s grid in {path}")
    hr = df.hr_bpm.to_numpy(np.float32)
    sp = df.speed_mps.to_numpy(np.float32)
    gr = df.grade_observed_pct.to_numpy(np.float32)
    hq = df.hr_quality.isin(v2_data.ROW_QUALITY).to_numpy()
    sq = df.speed_quality.isin(v2_data.ROW_QUALITY).to_numpy()
    gq = df.grade_quality.isin(v2_data.ROW_QUALITY).to_numpy()
    hr_valid, sp_valid, gr_valid = np.isfinite(hr) & hq, np.isfinite(sp) & sq, np.isfinite(gr) & gq
    filled_nan = df.hr_is_filled.isna().to_numpy()
    filled = df.hr_is_filled.fillna(True).to_numpy(bool)
    hr_low = (df.hr_quality == "LOW").to_numpy()
    any_low = hr_low | (df.speed_quality == "LOW").to_numpy() | (df.grade_quality == "LOW").to_numpy()
    vertical = v2_data.vertical_speed_proxy(sp, gr, sq, gq)

    k = np.flatnonzero((local >= C.PAST_STEPS - 1) & (local <= seg_len - C.FUTURE_STEPS - 1))
    hr_bad, sp_bad, gr_bad = ~hr_valid, ~sp_valid, ~gr_valid
    ok = (_all_ok(hr_bad | sp_bad | gr_bad, k - C.PAST_STEPS + 1, C.PAST_STEPS)
          & _all_ok(sp_bad | gr_bad, k + 1, C.FUTURE_STEPS))
    ok &= ~hr_bad[k[:, None] + H_ROWS[None, :]].any(axis=1)
    k = k[ok]

    measured = hr_valid & ~filled
    last = np.maximum.accumulate(np.where(measured, np.arange(n), -1))
    lk = last[k]
    in_segment = lk >= seg_start[k]
    age = np.where(in_segment, el[k] - el[np.maximum(lk, 0)], np.nan).astype(np.float32)
    flags = (measured[k] * WIN_MEASURED | filled_nan[k] * WIN_FILLED_NAN | hr_low[k] * WIN_T0_LOW
             | (~_all_ok(any_low, k - C.PAST_STEPS + 1, C.PAST_STEPS + C.FUTURE_STEPS)) * WIN_ANY_LOW)
    for j, bit in enumerate(WIN_TARGET_FILLED):
        flags = flags | filled[k + H_ROWS[j]] * bit
    future = k[:, None] + np.arange(1, C.FUTURE_STEPS + 1)[None, :]
    past = k[:, None] + np.arange(-(C.PAST_STEPS - 1), 1)[None, :]
    sess_new = np.ones(n, bool)
    sess_new[1:] = sess[1:] != sess[:-1]
    s_starts = np.flatnonzero(sess_new)
    return dict(path=str(path), session_ids=sess[s_starts].astype(object), session_row_start=s_starts.astype(np.int64),
                session_row_end=np.r_[s_starts[1:], n].astype(np.int64), n_rows=n,
                hr=hr, speed=sp, vertical=vertical, elapsed=el,
                row_flags=(hr_valid * ROW_HR_VALID | filled * ROW_HR_FILLED | filled_nan * ROW_HR_FILLED_NAN).astype(np.uint8),
                win_row=k.astype(np.int64), win_local=local[k].astype(np.int32), win_hr0_age=age,
                win_flags=flags.astype(np.uint16), win_target_valid=hr_valid[future].sum(axis=1).astype(np.uint8),
                win_past_filled=filled[past].sum(axis=1).astype(np.uint8),
                win_y=hr[k[:, None] + H_ROWS[None, :]].astype(np.float32), win_segment_start=seg_start[k].astype(np.int64))


def scan_canonical(ctx, *, workers=8, log=print) -> dict:
    """All optimizer sessions of the Train context, concatenated in (part_file, session_id) order."""
    jobs = [(str(C.FITREC_ROOT / "timeseries" / str(part)), sorted(g.session_id.astype(str)))
            for part, g in ctx.optimizer.groupby("part_file", sort=True)]
    start = time.time()
    with ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context("spawn")) as ex:
        parts = []
        for i, part in enumerate(ex.map(scan_part, jobs), 1):
            parts.append(part)
            log(f"[scan] {i}/{len(jobs)} {part['path'].rsplit('/', 1)[-1]}: rows {part['n_rows']:,} "
                f"candidates {len(part['win_row']):,} ({time.time() - start:.0f}s)")
    out, offset = {}, 0
    row_keys = ("hr", "speed", "vertical", "elapsed", "row_flags")
    win_keys = ("win_local", "win_hr0_age", "win_flags", "win_target_valid", "win_past_filled", "win_y")
    for key in row_keys + win_keys + ("session_ids",):
        out[key] = np.concatenate([p[key] for p in parts])
    out["win_row"] = np.concatenate([p["win_row"] + o for p, o in zip(parts, np.cumsum([0] + [p["n_rows"] for p in parts[:-1]]))])
    out["win_segment_start"] = np.concatenate(
        [p["win_segment_start"] + o for p, o in zip(parts, np.cumsum([0] + [p["n_rows"] for p in parts[:-1]]))])
    starts, ends = [], []
    for p in parts:
        starts.append(p["session_row_start"] + offset)
        ends.append(p["session_row_end"] + offset)
        offset += p["n_rows"]
    out["session_row_start"], out["session_row_end"] = np.concatenate(starts), np.concatenate(ends)
    session_of_row = np.repeat(np.arange(len(out["session_ids"]), dtype=np.int32),
                               out["session_row_end"] - out["session_row_start"])
    out["win_session"] = session_of_row[out["win_row"]]
    out["part_of_session"] = np.concatenate([np.full(len(p["session_ids"]), p["path"].rsplit("/", 1)[-1], dtype=object)
                                             for p in parts])
    out["seconds"] = round(time.time() - start, 1)
    return out


def session_table(ctx, scan) -> pd.DataFrame:
    """Session index (scan order) -> metadata, Personal4 row and canonical row range."""
    meta = ctx.optimizer.set_index("session_id")
    sids = pd.Index(scan["session_ids"].astype(str))
    if sids.duplicated().any():
        raise ValueError("a session was scanned twice")
    table = pd.DataFrame({"session_index": np.arange(len(sids), dtype=np.int32), "session_id": sids.to_numpy()})
    table["subject_id"] = meta.subject_id.reindex(sids).to_numpy()
    table["identity_group"] = meta.identity_group.reindex(sids).to_numpy()
    table["subject_index"] = table.subject_id.map(ctx.subject_map).astype(np.int32)
    table["part_file"] = scan["part_of_session"].astype(str)
    table["row_lo"], table["row_hi"] = scan["session_row_start"], scan["session_row_end"]
    table["n_candidates"] = np.bincount(scan["win_session"], minlength=len(sids)).astype(np.int64)
    return table


def build_history(ctx, sessions: pd.DataFrame, *, limit=C.HISTORY_MAX_LENGTH, log=print) -> dict:
    """Per-subject chronological row store + per-session causal History range (see module docstring)."""
    R = v2_data.reference()
    start = time.time()
    _, workouts = R.apple_data.load_derived_workouts(ctx.manifest, None, set(sessions.session_id))
    log(f"[history] {len(workouts):,} derived workouts loaded ({time.time() - start:.0f}s)")
    index_of = {sid: i for i, sid in enumerate(sessions.session_id)}
    missing = sorted(set(index_of) - set(workouts))
    if missing:
        raise ValueError(f"{len(missing)} optimizer sessions missing from the derived Train cache, e.g. {missing[:3]}")
    units = {workouts[s].start_time.unit for s in sessions.session_id}
    if len(units) != 1:
        raise ValueError(f"mixed timestamp units {units}")
    unit = units.pop()
    per_sec = {"s": 1, "ms": 1_000, "us": 1_000_000, "ns": 1_000_000_000}[unit]
    n = len(sessions)
    start_ns, end_ns = np.zeros(n, np.int64), np.zeros(n, np.int64)
    for sid, i in index_of.items():
        start_ns[i] = workouts[sid].start_time.value
        end_ns[i] = pd.Timestamp(workouts[sid].end_time).value
    start_native = start_ns // (1_000_000_000 // per_sec)   # same resolution as Timedelta.total_seconds() upstream
    by_subject: dict = {}
    for sid in sessions.session_id:
        by_subject.setdefault(workouts[sid].subject_id, []).append(sid)
    feats, owners, total = [], [], 0
    w_lo, w_hi = np.zeros(n, np.int64), np.zeros(n, np.int64)
    hist_lo, hist_hi = np.zeros(n, np.int64), np.zeros(n, np.int64)
    n_prior = np.zeros(n, np.int32)
    prefix = np.ones(n, bool)
    exceptions, valid_rows, all_rows, invalid = [], 0, 0, dict(hr=0, speed=0, grade=0)
    for subject in sorted(by_subject):
        ordered = sorted(by_subject[subject], key=lambda s: (workouts[s].start_time, s))
        for sid in ordered:
            w, i = workouts[sid], index_of[sid]
            valid = R.apple_data.row_validity(w)
            block = np.column_stack(((w.hr_bpm - 142.) / 22., w.elapsed_s / 1200.,
                                     R.apple_data.activity_channels(w)))[valid].astype(np.float32, copy=False)
            all_rows += len(valid)
            valid_rows += int(valid.sum())
            invalid["hr"] += int((~(np.isfinite(w.hr_bpm) & R.apple_data.quality_valid(w.hr_quality))).sum())
            invalid["speed"] += int((~(np.isfinite(w.speed_mps) & R.apple_data.quality_valid(w.speed_quality))).sum())
            invalid["grade"] += int((~(np.isfinite(w.grade_observed_pct) & R.apple_data.quality_valid(w.grade_quality))).sum())
            w_lo[i], w_hi[i] = total, total + len(block)
            feats.append(block)
            owners.append(np.full(len(block), i, np.int32))
            total += len(block)
        idx = np.array([index_of[s] for s in ordered])
        s, e = start_ns[idx], end_ns[idx]
        for j, i in enumerate(idx):
            mask = (s < s[j]) & (e <= s[j])
            m = int(mask.sum())
            n_prior[i] = m
            if m and not mask[:m].all():
                prefix[i] = False
                exceptions.append((i, idx[mask]))
            elif m:
                hist_hi[i] = w_hi[idx[m - 1]]
                hist_lo[i] = max(w_lo[idx[0]], hist_hi[i] - limit)
    store = np.concatenate(feats) if feats else np.zeros((0, 4), np.float32)
    owner = np.concatenate(owners) if owners else np.zeros(0, np.int32)
    extra_feat, extra_owner = [store], [owner]
    for i, prior in exceptions:   # non-prefix prior sets: explicit copies appended to the store
        rows = np.concatenate([np.arange(w_lo[p], w_hi[p]) for p in prior])[-limit:]
        hist_lo[i] = total
        hist_hi[i] = total + len(rows)
        extra_feat.append(store[rows])
        extra_owner.append(owner[rows])
        total += len(rows)
    log(f"[history] store {total:,} rows, {len(exceptions)} non-prefix sessions ({time.time() - start:.0f}s)")
    return dict(hist_feat=np.concatenate(extra_feat), hist_owner=np.concatenate(extra_owner), hist_lo=hist_lo,
                hist_hi=hist_hi, n_prior=n_prior, prefix=prefix, start_ns=start_ns, end_ns=end_ns, start_native=start_native,
                time_unit=unit, per_sec=per_sec, derived_rows=all_rows, derived_valid_rows=valid_rows,
                derived_invalid=invalid, n_exceptions=len(exceptions), seconds=round(time.time() - start, 1),
                workouts=workouts)


def causal_violations(hist) -> dict:
    """max(history workout start) < session start, max(end) <= start, current session absent; every session."""
    start, end, owner = hist["start_ns"], hist["end_ns"], hist["hist_owner"]
    bad_start = bad_end = self_ref = 0
    for i, (lo, hi) in enumerate(zip(hist["hist_lo"], hist["hist_hi"])):
        if hi > lo:
            o = owner[lo:hi]
            bad_start += int(start[o].max() >= start[i])
            bad_end += int(end[o].max() > start[i])
            self_ref += int((o == i).any())
    return dict(sessions_checked=len(start), sessions_with_history=int((hist["hist_hi"] > hist["hist_lo"]).sum()),
                start_not_before_current=bad_start, end_after_current_start=bad_end, contains_current_session=self_ref,
                violations=bad_start + bad_end + self_ref)


def history_array(hist, i) -> np.ndarray:
    """[L, 5] History of session i rebuilt from the store (sentinel when empty)."""
    lo, hi = hist["hist_lo"][i], hist["hist_hi"][i]
    if hi <= lo:
        return np.full((1, C.HISTORY_FEATURE_DIM), -1.0, np.float32)
    owner = hist["hist_owner"][lo:hi]
    gap = (hist["start_native"][i] - hist["start_native"][owner]) / hist["per_sec"] / 86400.
    return np.column_stack((hist["hist_feat"][lo:hi], np.log1p(gap).astype(np.float32)))

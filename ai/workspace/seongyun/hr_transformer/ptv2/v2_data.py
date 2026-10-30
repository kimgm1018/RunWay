"""Final Split V2 adapter: read-only reuse of the verified V2 infrastructure under ``config.REF_ROOT``.

* split, SHA, cohorts, roles (Training Amendment 1 Full Causal Train; support/query; cold start), group counts:
  shared.fitrec_v2.protocol
* window rules (physiology_v1: 5 s grid, 24 past / 24 future rows, 30 s anchors, targets +30/+60/+120 s):
  shared.fitrec_v2.windows.windows_from_frame, applied to canonical 5 s rows
* Personal4 row: subject map of the V2 Train derived cache (rule of v2_protocol.prepare_training_data_v2)
* History rows for History8: apple_pretrain_v2.data._history_from_prior over earlier, completed workouts of the
  10 s derived caches (Train: same subject's optimizer workouts; support: same subject's support workouts;
  personalized query: the group's support workouts; population / cold start: the no-history sentinel)
Caches are opened read-only (never built), Test cohorts are never requested, answer-key HR columns are never read.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from . import config as C

ROW_QUALITY = ("GOOD", "LOW")
TS_COLUMNS = ["subject_id", "session_id", "segment_id", "elapsed_s", "hr_bpm", "speed_mps", "grade_observed_pct",
              "hr_quality", "speed_quality", "grade_quality", "hr_is_filled"]
ANSWER_KEY_COLUMNS = ["window_id", "identity_group", "subject_id", "session_id", "cohort", "role", "t0_elapsed_s",
                      "segment_id", "hr0_bpm", "hr0_is_filled", "start_time_utc"]   # no y_true_* columns
_REF = None


def reference() -> SimpleNamespace:
    """Import shared.fitrec_v2 and apple_pretrain_v2 from REF_ROOT with the frozen V2 split pinned."""
    global _REF
    if _REF is None:
        if not (C.REF_ROOT / "shared" / "fitrec_v2" / "protocol.py").is_file():
            raise FileNotFoundError(f"V2 reference package not found at {C.REF_ROOT} (set PTV2_REF_ROOT)")
        sys.dont_write_bytecode = True                    # never write __pycache__ into the reference tree
        os.environ["FITREC_ROOT"] = str(C.FITREC_ROOT)
        os.environ["FITREC_SPLIT"] = str(C.SPLIT_V2_PATH)  # apple config reads it at import time
        if str(C.REF_ROOT) not in sys.path:
            sys.path.insert(0, str(C.REF_ROOT))
        from shared.fitrec_v2 import protocol, windows
        from experiments.ode_cnn.apple_pretrain_v1 import data as apple_v1_data
        from experiments.ode_cnn.apple_pretrain_v2 import config as apple_config, data as apple_data
        _REF = SimpleNamespace(protocol=protocol, windows=windows, apple_v1_data=apple_v1_data,
                               apple_config=apple_config, apple_data=apple_data)
    return _REF


def vertical_speed_proxy(speed, grade, speed_valid, grade_valid) -> np.ndarray:
    """apple_pretrain_v2.data.vertical_speed_proxy with boolean validity (speed * sin(arctan(grade / 100)))."""
    speed, grade = np.asarray(speed), np.asarray(grade)
    valid = np.isfinite(speed) & np.isfinite(grade) & np.asarray(speed_valid) & np.asarray(grade_valid)
    return np.where(valid, speed * np.sin(np.arctan(grade / 100.0)), np.nan).astype(np.float32)


def session_arrays(frame: pd.DataFrame) -> dict:
    """One session's canonical 5 s rows, sorted by (segment_id, elapsed_s)."""
    hr = frame.hr_bpm.to_numpy(np.float32)
    speed = frame.speed_mps.to_numpy(np.float32)
    grade = frame.grade_observed_pct.to_numpy(np.float32)
    speed_ok = frame.speed_quality.isin(ROW_QUALITY).to_numpy()
    grade_ok = frame.grade_quality.isin(ROW_QUALITY).to_numpy()
    return dict(subject_id=str(frame.subject_id.iloc[0]), elapsed=frame.elapsed_s.to_numpy(np.float64),
                segment=frame.segment_id.to_numpy(), hr=hr,
                hr_valid=np.isfinite(hr) & frame.hr_quality.isin(ROW_QUALITY).to_numpy(),
                hr_is_filled=frame.hr_is_filled.fillna(True).to_numpy(bool), speed=speed,
                vertical=vertical_speed_proxy(speed, grade, speed_ok, grade_ok))


def canonical_rows(sessions: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    """Per-session arrays and the concatenated canonical frame (read-only) for sessions with ``part_file``."""
    rows, frames = {}, []
    for part, group in sessions.groupby("part_file", sort=True):
        table = pq.read_table(C.FITREC_ROOT / "timeseries" / str(part), columns=TS_COLUMNS,
                              filters=[("session_id", "in", group.session_id.astype(str).tolist())])
        frame = table.to_pandas()
        frame["session_id"] = frame.session_id.astype(str)
        frame = frame.sort_values(["session_id", "segment_id", "elapsed_s"], kind="stable").reset_index(drop=True)
        frames.append(frame)
        for sid, f in frame.groupby("session_id", sort=False):
            rows[str(sid)] = session_arrays(f)
    return rows, (pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=TS_COLUMNS))


def window_item(r: dict, session_id, segment_id, t0_elapsed_s, hr0_bpm, *, history, subject_index, window_id) -> dict:
    """Slice rows t0-23 .. t0+24 of one session into the batch contract (see batch.py)."""
    hits = np.flatnonzero((r["elapsed"] == float(t0_elapsed_s)) & (r["segment"] == segment_id))
    if len(hits) != 1:
        raise ValueError(f"{window_id}: t0 row found {len(hits)} times")
    k = int(hits[0])
    lo, hi = k - C.PAST_STEPS + 1, k + C.FUTURE_STEPS
    if lo < 0 or hi >= len(r["hr"]) or r["segment"][lo] != segment_id or r["segment"][hi] != segment_id:
        raise ValueError(f"{window_id}: window leaves its segment")
    if not np.all(np.diff(r["elapsed"][lo:hi + 1]) == C.GRID_S):
        raise ValueError(f"{window_id}: rows are not a contiguous 5 s grid")
    if float(r["hr"][k]) != float(hr0_bpm):
        raise ValueError(f"{window_id}: HR0 differs from the canonical t0 row")
    past, future = np.arange(lo, k + 1), np.arange(k + 1, hi + 1)

    def action(rows):
        return np.column_stack((r["speed"][rows], r["vertical"][rows])).astype(np.float32)

    item = dict(window_id=str(window_id), session_id=str(session_id), subject_id=r["subject_id"],
                past_hr=r["hr"][past].astype(np.float32), past_hr_is_filled=r["hr_is_filled"][past].copy(),
                past_action=action(past), past_time=(r["elapsed"][past] / C.TIME_SCALE_S).astype(np.float32),
                future_action=action(future), future_time=(r["elapsed"][future] / C.TIME_SCALE_S).astype(np.float32),
                hr0=np.float32(r["hr"][k]), target_mask=r["hr_valid"][future].copy(),
                history=np.asarray(history, dtype=np.float32), subject_index=int(subject_index))
    item["target_hr"] = np.where(item["target_mask"], r["hr"][future], 0.0).astype(np.float32)
    for key in ("past_hr", "past_action", "future_action"):
        if not np.isfinite(item[key]).all():
            raise ValueError(f"{window_id}: non-finite {key} (window rules violated)")
    return item


def histories_for(target_ids, workouts: dict) -> dict:
    """History rows per target from the same subject's earlier, completed workouts (AppleChunkDataset rule)."""
    R = reference()
    by_subject: dict = {}
    for w in workouts.values():
        by_subject.setdefault(w.subject_id, []).append(w)
    for values in by_subject.values():
        values.sort(key=lambda w: (w.start_time, w.session_id))
    out = {}
    for sid in target_ids:
        w = workouts[sid]
        prior = [p for p in by_subject[w.subject_id] if p.start_time < w.start_time and p.end_time <= w.start_time]
        out[sid] = (R.apple_data._history_from_prior(w, prior, C.HISTORY_MAX_LENGTH), tuple(p.session_id for p in prior))
    return out


def _items(windows: pd.DataFrame, rows: dict, history_of, subject_index_of) -> list[dict]:
    return [window_item(rows[w.session_id], w.session_id, w.segment_id, w.t0_elapsed_s, w.hr0_bpm,
                        history=history_of(w.session_id), subject_index=subject_index_of(w.session_id),
                        window_id=w.window_id) for w in windows.itertuples()]


# ----------------------------------------------------------------------------------------------- Train (optimizer)
@dataclass
class TrainContext:
    split: object
    manifest: object
    roles: pd.DataFrame
    optimizer: pd.DataFrame
    subject_map: dict
    group_counts: dict


def load_train_context() -> TrainContext:
    R = reference()
    split = R.protocol.load_v2_split(C.SPLIT_V2_PATH)
    if Path(R.apple_config.SPLIT_PATH).expanduser().resolve() != split.path:
        raise R.protocol.V2ContractError("apple_pretrain_v2 config.SPLIT_PATH is not the frozen V2 split")
    manifest = R.apple_data.build_or_load_derived_view(R.apple_config.FITREC_DIR, R.apple_config.CACHE_ROOT,
                                                       read_only=True)
    meta = pd.read_parquet(manifest.cache_dir / "sessions.parquet")
    meta["subject_id"], meta["session_id"] = meta.subject_id.astype(str), meta.session_id.astype(str)
    if not set(meta.subject_id) <= split.subjects("train"):
        raise R.protocol.V2ContractError("V2 Train cache contains non-Train subjects")
    meta["start_time_utc"] = pd.to_datetime(meta.start_time_utc, utc=True)
    meta["identity_group"] = meta.subject_id.map(split.group_of_subject)
    meta["cohort"] = "train"
    roles = R.protocol.assign_roles(meta)   # default: Training Amendment 1, Full Causal Train
    counts = R.protocol.check_group_counts(roles)
    optimizer = roles[roles.role == R.protocol.TRAIN_OPTIMIZER].reset_index(drop=True)
    if len(optimizer) != R.protocol.EXPECTED_TRAIN_OPTIMIZER_SESSIONS or len(optimizer) != len(roles):
        raise R.protocol.V2ContractError(f"optimizer manifest has {len(optimizer)} sessions, expected "
                                         f"{R.protocol.EXPECTED_TRAIN_OPTIMIZER_SESSIONS} (Amendment 1)")
    subject_map = {s: i for i, s in enumerate(sorted(meta.subject_id.unique()))}
    return TrainContext(split, manifest, roles, optimizer, subject_map, counts)


def sample_train_windows(ctx: TrainContext, *, n_subjects=4, sessions_per_subject=2, seed=1729) -> tuple[list, dict]:
    """Windows of the latest optimizer sessions of a few seeded Train subjects (smoke-sized, not a training set)."""
    R = reference()
    per_subject = ctx.optimizer.groupby("subject_id").size()
    eligible = sorted(per_subject[per_subject > sessions_per_subject].index)
    rng = np.random.default_rng(seed)
    subjects = sorted(str(s) for s in rng.choice(eligible, size=n_subjects, replace=False))
    chosen = ctx.optimizer[ctx.optimizer.subject_id.isin(subjects)]
    _, workouts = R.apple_data.load_derived_workouts(ctx.manifest, None, set(chosen.session_id))
    targets = []
    for s in subjects:
        ordered = chosen[chosen.subject_id == s].sort_values(["start_time_utc", "session_id"], kind="stable")
        targets += [x for x in ordered.session_id if x in workouts][-sessions_per_subject:]
    history = histories_for(targets, workouts)
    rows, frame = canonical_rows(chosen[chosen.session_id.isin(targets)])
    windows = R.windows.windows_from_frame(frame)
    if not len(windows):
        raise ValueError("no V2 windows in the sampled Train sessions")
    items = _items(windows, rows, lambda sid: history[sid][0], lambda sid: ctx.subject_map[rows[sid]["subject_id"]])
    start = chosen.set_index("session_id").start_time_utc
    leaks = [sid for sid, (_, src) in history.items() if sid in src or any(start[x] >= start[sid] for x in src)]
    return items, dict(subjects=subjects, target_sessions=targets, windows=len(items),
                       windows_per_session=windows.groupby("session_id").size().to_dict(),
                       history_rows={sid: int(len(h)) for sid, (h, _) in history.items()},
                       history_source_sessions={sid: len(src) for sid, (_, src) in history.items()},
                       history_leaks=leaks, optimizer_sessions=len(ctx.optimizer),
                       train_subjects_in_map=len(ctx.subject_map), group_counts=ctx.group_counts)


# ------------------------------------------------------------------------------------- Val (support / query / cold)
@dataclass
class ValContext:
    split: object
    sessions: pd.DataFrame
    manifest: object
    group_counts: dict


def _read_only_val_manifest(split):
    """The existing V2 Val 10 s cache of apple_pretrain_v2 (never built or modified here)."""
    R = reference()
    root = R.apple_config.OUTPUT_ROOT / "cache_v2_val"
    found = []
    for mp in sorted(root.glob(f"{R.apple_config.DERIVED_SCHEMA}_v2val_*/manifest.json")):
        payload = json.loads(mp.read_text())
        if payload.get("split_sha256") == split.sha256 and all(
                (mp.parent / "timeseries" / p).is_file() for p in payload["part_files"]):
            found.append((mp.parent, payload))
    if len(found) != 1:
        raise FileNotFoundError(f"expected one complete V2 Val cache under {root}, found {len(found)}")
    out, p = found[0]
    return R.apple_v1_data.DerivedViewManifest(out, p["source_fingerprint"], p["n_sessions"], p["n_subjects"],
                                               p["n_rows_10s"], R.apple_config.DERIVED_SCHEMA)


def load_val_context() -> ValContext:
    R = reference()
    split = R.protocol.load_v2_split(C.SPLIT_V2_PATH)
    sessions = R.protocol.assign_roles(R.protocol.usable_sessions(C.FITREC_ROOT, split, R.protocol.VAL_COHORTS))
    counts = R.protocol.check_group_counts(sessions)
    return ValContext(split, sessions, _read_only_val_manifest(split), counts)


def _val_workouts(val: ValContext, session_ids) -> dict:
    R = reference()
    _, workouts = R.apple_v1_data.load_derived_workouts(val.manifest, None, set(session_ids))
    R.protocol.assert_no_test({w.subject_id for w in workouts.values()}, val.split)
    return workouts


def support_windows(val: ValContext, group: str) -> tuple[list, dict, dict]:
    """Chronological support windows of one personalized_val group (adaptation input; subject_index 0)."""
    R = reference()
    rows_g = val.sessions[val.sessions.identity_group == group]
    if rows_g.cohort.iloc[0] != "personalized_val":
        raise ValueError(f"{group} is not a personalized_val group")
    support = rows_g[rows_g.role == R.protocol.SUPPORT]
    workouts = _val_workouts(val, support.session_id)
    ids = [s for s in support.session_id if s in workouts]
    history = histories_for(ids, workouts)
    rows, frame = canonical_rows(support[support.session_id.isin(ids)])
    windows = R.windows.windows_from_frame(frame)
    if not len(windows):
        return [], workouts, dict(group=group, support_sessions=len(support), windows=0)
    windows["start"] = windows.session_id.map(support.set_index("session_id").start_time_utc)
    windows = windows.sort_values(["start", "session_id", "t0_elapsed_s"], kind="stable")
    items = _items(windows, rows, lambda sid: history[sid][0], lambda sid: 0)
    return items, workouts, dict(group=group, support_sessions=len(support), support_sessions_with_workouts=len(ids),
                                 windows=len(items), query_sessions=int((rows_g.role == R.protocol.QUERY).sum()))


def load_answer_key() -> pd.DataFrame:
    R = reference()
    key = pd.read_parquet(C.ANSWER_KEY_PATH, columns=ANSWER_KEY_COLUMNS)
    if set(key.cohort) - set(R.protocol.VAL_COHORTS):
        raise R.protocol.V2ContractError("answer key contains non-Val cohorts")
    return key


def answer_key_items(val: ValContext, key: pd.DataFrame, group: str, condition: str, support_workouts=None) -> list:
    """Model inputs for the answer-key windows of one group. personalized: History from the group's support
    workouts completed before the query workout (query_history="support_only"); population / cold_start: sentinel."""
    R = reference()
    windows = key[key.identity_group == group]
    sessions = val.sessions[val.sessions.session_id.isin(set(windows.session_id))]
    rows, _ = canonical_rows(sessions)
    sentinel = R.apple_v1_data.NO_HISTORY_SENTINEL
    if condition == "personalized":
        start = sessions.set_index("session_id").start_time_utc
        support = sorted(support_workouts.values(), key=lambda w: (w.start_time, w.session_id))
        cache = {}

        def history_of(sid):
            if sid not in cache:
                target = SimpleNamespace(start_time=start[sid])
                prior = [w for w in support if w.start_time < target.start_time and w.end_time <= target.start_time]
                cache[sid] = R.apple_data._history_from_prior(target, prior, C.HISTORY_MAX_LENGTH)
            return cache[sid]
    elif condition in ("population", "cold_start"):
        def history_of(sid):
            return sentinel.copy()
    else:
        raise ValueError(f"unknown condition {condition}")
    return _items(windows, rows, history_of, lambda sid: 0)

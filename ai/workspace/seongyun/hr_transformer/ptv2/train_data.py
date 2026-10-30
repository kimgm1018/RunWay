"""V2 Train windows over the index-only cache (train_cache.py). Stride and HR0 policy are explicit, required
arguments: the cache keeps every 5 s candidate with its HR0 source / LOCF age, so no policy is baked in.

Batches follow ptv2.batch (model contract) plus target_hr / target_mask and a ``meta`` dict (candidate, session,
t0 elapsed, HR0 source and age) for tracing. Windows are gathered vectorised from memory-mapped arrays, so a batch
is one fancy-index per array and DataLoader workers share the pages (fork).
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader, Dataset, Sampler

from . import config as C
from .train_scan import ROW_HR_FILLED, ROW_HR_VALID, WIN_MEASURED

STRIDES_S = (5, 10, 30)
ARRAY_NAMES = ("rows_hr", "rows_speed", "rows_vertical", "rows_elapsed", "rows_flags", "win_row", "win_session",
               "win_local", "win_hr0_age", "win_flags", "win_target_valid", "hist_feat", "hist_owner")
PAST_OFFSETS = np.arange(-(C.PAST_STEPS - 1), 1)
FUTURE_OFFSETS = np.arange(1, C.FUTURE_STEPS + 1)
INPUT_KEYS = ("past_hr", "past_action", "past_time", "future_action", "future_time", "history")


@dataclass
class TrainStore:
    arrays: dict
    session_ids: np.ndarray
    subject_index: np.ndarray
    start_native: np.ndarray
    per_sec: int
    hist_lo: np.ndarray
    hist_hi: np.ndarray
    manifest: dict
    path: Path | None
    session_summary: np.ndarray | None = None  # [n_windows, F] current-session summary (session_context.py); None = off
    session_stats: dict | None = None  # frozen V2 Train statistics of that summary

    @classmethod
    def load(cls, cache_dir, *, mmap=True) -> "TrainStore":
        d = Path(cache_dir)
        manifest = json.loads((d / "manifest.json").read_text())
        arrays = {n: np.load(d / f"{n}.npy", mmap_mode="r" if mmap else None) for n in ARRAY_NAMES}
        s = pd.read_parquet(d / "sessions.parquet")
        return cls(arrays, s.session_id.to_numpy(object), s.subject_index.to_numpy(np.int64),
                   s.start_native.to_numpy(np.int64), int(manifest["config"]["history_policy"]["per_sec"]),
                   s.hist_lo.to_numpy(np.int64), s.hist_hi.to_numpy(np.int64), manifest, d)


def parse_hr0_policy(policy: str):
    """'all' -> None, 'measured' -> 0.0 (measured HR0 only), 'max_age_s=<x>' -> x (measured or LOCF age <= x)."""
    if policy == "all":
        return None
    if policy == "measured":
        return 0.0
    if isinstance(policy, str) and policy.startswith("max_age_s="):
        return float(policy.split("=", 1)[1])
    raise ValueError(f"unknown hr0_policy {policy!r}; use 'all', 'measured' or 'max_age_s=<seconds>'")


def select_windows(store: TrainStore, *, stride_s: int, hr0_policy: str, phase: int = 0, subset=None) -> np.ndarray:
    if stride_s not in STRIDES_S:
        raise ValueError(f"stride_s must be one of {STRIDES_S}")
    k = stride_s // C.GRID_S
    if not 0 <= phase < k:
        raise ValueError(f"phase must be in [0, {k})")
    keep = ((np.asarray(store.arrays["win_local"]) - (C.PAST_STEPS - 1)) % k) == phase
    max_age = parse_hr0_policy(hr0_policy)
    if max_age is not None:
        measured = (np.asarray(store.arrays["win_flags"]) & WIN_MEASURED) != 0
        keep &= measured | (np.asarray(store.arrays["win_hr0_age"]) <= max_age)
    index = np.flatnonzero(keep)
    if subset is not None:
        index = np.intersect1d(index, np.asarray(subset, np.int64))
    return index


def gather_history(store: TrainStore, sessions: np.ndarray):
    lo, hi = store.hist_lo[sessions], store.hist_hi[sessions]
    length = hi - lo
    width = max(1, int(length.max()) if len(length) else 1)
    steps = np.arange(width)
    mask = steps[None, :] < length[:, None]
    pos = np.where(mask, lo[:, None] + steps[None, :], 0)
    n = len(sessions)
    if len(store.arrays["hist_owner"]):
        feat = np.asarray(store.arrays["hist_feat"][pos.ravel()]).reshape(n, width, 4)
        owner = np.asarray(store.arrays["hist_owner"][pos.ravel()]).reshape(n, width)
    else:
        feat, owner = np.zeros((n, width, 4), np.float32), np.zeros((n, width), np.int64)
    with np.errstate(all="ignore"):
        gap = np.log1p((store.start_native[sessions][:, None] - store.start_native[owner]) / store.per_sec / 86400.)
    history = np.concatenate((feat, gap.astype(np.float32)[..., None]), axis=-1)
    history[~mask] = 0.0
    empty = length == 0
    history[empty, 0, :] = -1.0          # NO_HISTORY_SENTINEL of the V2 loader
    return history, np.where(empty, 1, length)


def gather(store: TrainStore, cand, *, on_nonfinite="raise") -> tuple[dict, int]:
    a = store.arrays
    cand = np.asarray(cand, np.int64)
    t0 = np.asarray(a["win_row"][cand])
    past, future = t0[:, None] + PAST_OFFSETS[None, :], t0[:, None] + FUTURE_OFFSETS[None, :]
    hr, speed, vertical, elapsed, flags = (a[n] for n in ("rows_hr", "rows_speed", "rows_vertical", "rows_elapsed", "rows_flags"))
    sessions = np.asarray(a["win_session"][cand]).astype(np.int64)
    history, length = gather_history(store, sessions)
    target_mask = (np.asarray(flags[future]) & ROW_HR_VALID) != 0
    out = dict(past_hr=np.asarray(hr[past], np.float32),
               past_hr_is_filled=(np.asarray(flags[past]) & ROW_HR_FILLED) != 0,
               past_action=np.stack((speed[past], vertical[past]), axis=-1).astype(np.float32),
               past_time=(np.asarray(elapsed[past]) / C.TIME_SCALE_S).astype(np.float32),
               future_action=np.stack((speed[future], vertical[future]), axis=-1).astype(np.float32),
               future_time=(np.asarray(elapsed[future]) / C.TIME_SCALE_S).astype(np.float32),
               hr0=np.asarray(hr[t0], np.float32), subject_index=store.subject_index[sessions],
               history=history, history_length=length, target_mask=target_mask,
               target_hr=np.where(target_mask, hr[future], 0.0).astype(np.float32))
    if store.session_summary is not None:
        out["session_summary"] = np.asarray(store.session_summary[cand], np.float32)
    bad = np.zeros(len(cand), bool)
    for key in INPUT_KEYS + (("session_summary",) if "session_summary" in out else ()):
        bad |= ~np.isfinite(out[key]).reshape(len(cand), -1).all(axis=1)
    if bad.any():
        if on_nonfinite == "raise":
            raise ValueError(f"non-finite model inputs in candidates {cand[bad][:5].tolist()}")
        keep = ~bad
        out = {k: v[keep] for k, v in out.items()}
        cand, sessions, t0 = cand[keep], sessions[keep], t0[keep]
        # history width may now exceed the kept rows' maximum; that is harmless right padding
    win_flags = np.asarray(a["win_flags"][cand])
    batch = {k: torch.from_numpy(np.ascontiguousarray(v)) for k, v in out.items()}
    batch["meta"] = dict(candidate_index=torch.from_numpy(cand), session_index=torch.from_numpy(sessions),
                         t0_elapsed_s=torch.from_numpy(np.asarray(elapsed[t0], np.float64)),
                         hr0_is_measured=torch.from_numpy((win_flags & WIN_MEASURED) != 0),
                         hr0_age_s=torch.from_numpy(np.asarray(a["win_hr0_age"][cand], np.float32)),
                         target_valid_count=torch.from_numpy(np.asarray(a["win_target_valid"][cand]).astype(np.int64)))
    return batch, int(bad.sum())


class TrainWindowDataset(Dataset):
    """Map-style dataset whose ``__getitem__`` takes an array of positions and returns one collated batch."""

    def __init__(self, store: TrainStore, *, stride_s: int, hr0_policy: str, phase: int = 0, subset=None,
                 on_nonfinite: str = "raise"):
        if on_nonfinite not in ("raise", "drop"):
            raise ValueError("on_nonfinite must be 'raise' or 'drop'")
        self.store, self.on_nonfinite = store, on_nonfinite
        self.index = select_windows(store, stride_s=stride_s, hr0_policy=hr0_policy, phase=phase, subset=subset)
        self.config = dict(cache_content_hash=store.manifest.get("content_hash"), stride_s=stride_s,
                           hr0_policy=hr0_policy, phase=phase, subset=None if subset is None else len(subset),
                           windows=int(len(self.index)))
        digest = hashlib.sha256(json.dumps(self.config, sort_keys=True).encode())
        digest.update(self.index.astype(np.int64).tobytes())
        self.sample_manifest_hash = digest.hexdigest()
        self.dropped_nonfinite = 0

    def __len__(self):
        return len(self.index)

    def gather(self, cand):
        batch, dropped = gather(self.store, cand, on_nonfinite=self.on_nonfinite)
        self.dropped_nonfinite += dropped
        return batch

    def __getitem__(self, positions):
        return self.gather(self.index[np.asarray(positions, np.int64)])

    def session_id(self, session_index: int) -> str:
        return str(self.store.session_ids[session_index])


class EpochBatchSampler(Sampler):
    """Yields arrays of dataset positions; order = permutation(seed, epoch), so any epoch can be replayed."""

    def __init__(self, n: int, batch_size: int, *, seed: int, shuffle: bool = True, drop_last: bool = False):
        if n < 1 or batch_size < 1:
            raise ValueError("need a non-empty dataset and a positive batch size")
        self.n, self.batch_size, self.seed, self.shuffle, self.drop_last, self.epoch = n, batch_size, seed, shuffle, drop_last, 0

    def set_epoch(self, epoch: int):
        self.epoch = int(epoch)

    def order(self) -> np.ndarray:
        return np.random.default_rng([self.seed, self.epoch]).permutation(self.n) if self.shuffle else np.arange(self.n)

    def __iter__(self):
        order = self.order()
        for i in range(0, self.n, self.batch_size):
            chunk = order[i:i + self.batch_size]
            if self.drop_last and len(chunk) < self.batch_size:
                return
            yield chunk

    def __len__(self):
        return self.n // self.batch_size if self.drop_last else math.ceil(self.n / self.batch_size)


def _identity(batch):
    return batch


def make_loader(dataset: TrainWindowDataset, *, batch_size: int, seed: int, shuffle: bool = True, drop_last: bool = False,
                num_workers: int = 0, pin_memory: bool = False, prefetch_factor: int | None = None,
                persistent_workers: bool = False) -> DataLoader:
    sampler = EpochBatchSampler(len(dataset), batch_size, seed=seed, shuffle=shuffle, drop_last=drop_last)
    kwargs = dict(batch_size=None, sampler=sampler, collate_fn=_identity, num_workers=num_workers, pin_memory=pin_memory,
                  persistent_workers=persistent_workers and num_workers > 0)
    if num_workers > 0 and prefetch_factor:
        kwargs["prefetch_factor"] = prefetch_factor
    return DataLoader(dataset, **kwargs)

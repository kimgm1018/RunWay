"""Batch tensor contract, collation of window items and a synthetic batch generator.

One window item (numpy) / one batch row (torch), B = batch size, Lh = padded history length:
  past_hr            [B, 24]    float32  HR rows t0-23 .. t0 (bpm); past_hr[:, -1] == hr0
  past_hr_is_filled  [B, 24]    bool     canonical LOCF flag
  past_action        [B, 24, 2] float32  speed_mps, vertical speed proxy (m/s)
  past_time          [B, 24]    float32  elapsed_s / 1200
  future_action      [B, 24, 2] float32  planned speed_mps, vertical speed proxy, rows t0+1 .. t0+24
  future_time        [B, 24]    float32  elapsed_s / 1200
  hr0                [B]        float32  measured HR at t0
  subject_index      [B]        int64    Personal4 row
  history            [B, Lh, 5] float32  earlier-workout rows (right-padded with zeros)
  history_length     [B]        int64    valid history rows (>= 1; the no-history sentinel has length 1)
  target_hr          [B, 24]    float32  optional, HR rows t0+1 .. t0+24 (0 where invalid)
  target_mask        [B, 24]    bool     optional, HR finite with GOOD/LOW quality
"""
from __future__ import annotations

import numpy as np
import torch

from . import config as C

ARRAY_KEYS = ("past_hr", "past_hr_is_filled", "past_action", "past_time", "future_action", "future_time",
              "target_hr", "target_mask")
FINITE_KEYS = ("past_hr", "past_action", "past_time", "future_action", "future_time", "hr0", "history")


def check_batch(batch: dict) -> None:
    """Raise ValueError unless ``batch`` follows the contract above."""
    hr0 = batch["hr0"]
    if hr0.ndim != 1 or hr0.shape[0] < 1:
        raise ValueError("hr0 must have shape [B]")
    b = hr0.shape[0]
    expected = {"past_hr": (b, C.PAST_STEPS), "past_hr_is_filled": (b, C.PAST_STEPS),
                "past_action": (b, C.PAST_STEPS, 2), "past_time": (b, C.PAST_STEPS),
                "future_action": (b, C.FUTURE_STEPS, 2), "future_time": (b, C.FUTURE_STEPS),
                "subject_index": (b,), "history_length": (b,)}
    for key, shape in expected.items():
        if tuple(batch[key].shape) != shape:
            raise ValueError(f"{key} has shape {tuple(batch[key].shape)}, expected {shape}")
    history = batch["history"]
    if history.ndim != 3 or history.shape[0] != b or history.shape[2] != C.HISTORY_FEATURE_DIM:
        raise ValueError(f"history has shape {tuple(history.shape)}, expected [B, Lh, {C.HISTORY_FEATURE_DIM}]")
    lengths = batch["history_length"]
    if (lengths < 1).any() or (lengths > history.shape[1]).any():
        raise ValueError("history_length must be in 1..Lh")
    if "session_summary" in batch:
        summary = batch["session_summary"]
        if summary.ndim != 2 or summary.shape[0] != b:
            raise ValueError(f"session_summary has shape {tuple(summary.shape)}, expected [B, F]")
        if not torch.isfinite(summary).all():
            raise ValueError("session_summary has non-finite values")
    for key in FINITE_KEYS:
        if not torch.isfinite(batch[key]).all():
            raise ValueError(f"{key} has non-finite values")
    if not torch.equal(batch["past_hr"][:, -1], hr0):
        raise ValueError("hr0 must be the measured HR of the last past token (row t0)")


def collate_windows(items: list[dict]) -> dict:
    if not items:
        raise ValueError("Cannot collate an empty batch")
    max_history = max(len(item["history"]) for item in items)
    history = np.zeros((len(items), max_history, C.HISTORY_FEATURE_DIM), dtype=np.float32)
    for row, item in enumerate(items):
        history[row, :len(item["history"])] = item["history"]
    batch = {key: torch.from_numpy(np.stack([item[key] for item in items])) for key in ARRAY_KEYS if key in items[0]}
    batch.update(
        hr0=torch.tensor([float(item["hr0"]) for item in items], dtype=torch.float32),
        subject_index=torch.tensor([int(item["subject_index"]) for item in items], dtype=torch.long),
        history=torch.from_numpy(history),
        history_length=torch.tensor([len(item["history"]) for item in items], dtype=torch.long),
        window_id=[item["window_id"] for item in items],
    )
    return batch


def move_batch(batch: dict, device) -> dict:
    return {key: value.to(device) if torch.is_tensor(value) else value for key, value in batch.items()}


def batches(items: list[dict], batch_size: int) -> list[dict]:
    """Consecutive (order-preserving) batches."""
    return [collate_windows(items[i:i + batch_size]) for i in range(0, len(items), batch_size)]


def synthetic_items(batch_size: int, n_subjects: int, *, history_length: int = 40, seed: int = 0) -> list[dict]:
    """Physiologically plausible random windows that satisfy the contract (no real data)."""
    g = np.random.default_rng(seed)
    steps = C.PAST_STEPS + C.FUTURE_STEPS
    t0 = g.uniform(300.0, 3000.0, size=(batch_size, 1))
    offsets = C.GRID_S * np.arange(-(C.PAST_STEPS - 1), C.FUTURE_STEPS + 1)
    time = ((t0 + offsets) / C.TIME_SCALE_S).astype(np.float32)
    speed = g.uniform(1.5, 4.5, size=(batch_size, 1)) + 0.2 * g.standard_normal((batch_size, steps))
    vertical = speed * np.sin(np.arctan(g.normal(0.0, 3.0, size=(batch_size, steps)) / 100.0))
    action = np.stack((speed, vertical), axis=-1).astype(np.float32)
    hr = (140.0 + 15.0 * g.standard_normal((batch_size, 1))
          + np.cumsum(g.normal(0.0, 0.8, size=(batch_size, steps)), axis=1)).astype(np.float32)
    items = []
    for i in range(batch_size):
        n_history = int(g.integers(1, history_length + 1))
        items.append(dict(
            window_id=f"synthetic@{i}", past_hr=hr[i, :C.PAST_STEPS].copy(),
            past_hr_is_filled=np.zeros(C.PAST_STEPS, dtype=bool), past_action=action[i, :C.PAST_STEPS].copy(),
            past_time=time[i, :C.PAST_STEPS].copy(), future_action=action[i, C.PAST_STEPS:].copy(),
            future_time=time[i, C.PAST_STEPS:].copy(), hr0=np.float32(hr[i, C.PAST_STEPS - 1]),
            target_hr=hr[i, C.PAST_STEPS:].copy(), target_mask=np.ones(C.FUTURE_STEPS, dtype=bool),
            history=g.normal(0.0, 1.0, size=(n_history, C.HISTORY_FEATURE_DIM)).astype(np.float32),
            subject_index=int(g.integers(n_subjects))))
    return items


def synthetic_batch(batch_size: int, n_subjects: int, *, history_length: int = 40, seed: int = 0) -> dict:
    return collate_windows(synthetic_items(batch_size, n_subjects, history_length=history_length, seed=seed))

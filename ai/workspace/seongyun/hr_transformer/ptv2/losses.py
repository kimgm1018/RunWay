"""Smoke objective and horizon helpers. The final training objective is not fixed yet."""
from __future__ import annotations

import math

import torch

from . import config as C


def trajectory_l1(output: dict, batch: dict) -> torch.Tensor:
    """Mean |HR_hat - HR| (bpm) over the valid future rows t0+1 .. t0+24."""
    mask = batch["target_mask"].to(output["heart_rate"].dtype)
    if float(mask.sum()) == 0:
        raise ValueError("no valid future HR rows in the batch")
    return ((output["heart_rate"] - batch["target_hr"]).abs() * mask).sum() / mask.sum()


def horizon_predictions(heart_rate: torch.Tensor) -> dict:
    return {h: heart_rate[:, i] for h, i in C.HORIZON_INDEX.items()}


def horizon_mae(output: dict, batch: dict) -> dict:
    out = {}
    for h, i in C.HORIZON_INDEX.items():
        valid = batch["target_mask"][:, i]
        error = (output["heart_rate"][:, i] - batch["target_hr"][:, i]).abs()[valid]
        out[h] = float(error.mean()) if len(error) else math.nan
    return out

"""CPU-only pre-run forward; cache keys retain every input row and shape.

The serving model is immutable/eval for the lifetime of this runtime. No
neural-network computation is reduced to a different batch shape.
"""
from __future__ import annotations

from collections import OrderedDict
import hashlib
import logging
import threading
from typing import Dict, Tuple

import numpy as np
import torch
from torch import Tensor

_LOG = logging.getLogger(__name__)
_PERSON_KEYS = ("p4", "p4_keep", "group_index", "history", "history_length", "u_vals", "u_mask")


def _bit_equal(a: Tensor | np.ndarray, b: Tensor | np.ndarray) -> bool:
    """Exact values and shape, allowing NaNs only at matching positions."""
    a, b = torch.as_tensor(a), torch.as_tensor(b)
    return a.shape == b.shape and bool(((a == b) | (torch.isnan(a) & torch.isnan(b))).all())


def _integrate(hr0: Tensor, d0: Tensor, intensity: Tensor,
               p: Dict[str, Tensor]) -> Tuple[Tensor, Tensor, Tensor]:
    """Float32 RK4 with NumPy arithmetic and PyTorch transcendental kernels."""
    k = torch.exp(p["B"]) / 60.0
    e_half, e_full = torch.exp(-0.5 * k).numpy(), torch.exp(-k).numpy()
    exp_a = torch.exp(p["A"]).numpy()
    hr_min, hr_max = p["hr_min"].numpy(), p["hr_max"].numpy()
    values = intensity.numpy()
    hr, dem = hr0.numpy().copy(), d0.numpy().copy()
    size, length = values.shape
    hrs = np.empty((size, length), dtype=np.float32)
    epsilon, sixty = np.float32(1e-3), np.float32(60.0)
    half, two, six = np.float32(0.5), np.float32(2.0), np.float32(6.0)

    def rate(h, demand):
        f_min_base = (np.abs(h - hr_min + epsilon) + epsilon) / sixty
        f_max_base = (np.abs(hr_max - h + epsilon) + epsilon) / sixty
        # Keep each pow's original [B] shape and row positions (SIMD/tail).
        f_min = torch.from_numpy(f_min_base).pow(p["alpha"]).numpy()
        f_max = torch.from_numpy(f_max_base).pow(p["beta"]).numpy()
        normal = exp_a * f_min * f_max * (demand - h) / sixty
        return np.where(h >= hr_max, np.minimum(normal, hr_max - h),
                        np.where(h <= hr_min, np.maximum(normal, hr_min - h), normal))

    # torch는 발산(inf/NaN)을 경고 없이 돌려준다. 같은 값을 내면서 numpy 경고만 끈다.
    with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
        for i in range(intensity.shape[1]):
            inten = values[:, i]
            gap = dem - inten
            d_half, d_full = inten + gap * e_half, inten + gap * e_full
            k1 = rate(hr, dem)
            k2 = rate(hr + half * k1, d_half)
            k3 = rate(hr + half * k2, d_half)
            k4 = rate(hr + k3, d_full)
            hr = hr + (k1 + two * k2 + two * k3 + k4) / six
            dem = d_full
            hrs[:, i] = hr
    return torch.from_numpy(hrs), torch.from_numpy(hr), torch.from_numpy(dem)


def integrate(hr0: Tensor, d0: Tensor, intensity: Tensor, p: dict, model_module) -> Tensor:
    tensors = (hr0, d0, intensity, *p.values())
    if (model_module.BOUND_RULE != "max"
            or any(v.device.type != "cpu" or v.dtype != torch.float32 or v.requires_grad
                   for v in tensors)):
        return model_module.integrate(hr0, d0, intensity, p)[0]

    return _integrate(hr0, d0, intensity, p)[0]


def _tensor_key(batch: dict, names) -> tuple:
    parts = []
    for name in names:
        value = batch.get(name)
        if value is None:
            parts.append((name, None))
            continue
        data = value.detach().contiguous()
        digest = hashlib.blake2b(data.numpy().tobytes(), digest_size=32).digest()
        parts.append((name, tuple(data.shape), str(data.dtype), digest))
    return tuple(parts)


class PreRunFast:
    """One runtime's bounded caches and one-time bit-equivalence guard."""

    def __init__(self, model, model_module):
        self.model = model
        self.model_module = model_module
        self._caches = {name: OrderedDict() for name in ("person", "today", "parameters", "fatigue")}
        self._cache_lock = threading.Lock()
        self._check_lock = threading.Lock()
        self.checked = False
        self.disabled = False

    def _cached(self, kind, batch, names, compute):
        key = _tensor_key(batch, names)
        with self._cache_lock:
            cache = self._caches[kind]
            if key in cache:
                cache.move_to_end(key)
                return cache[key]
        value = compute()
        with self._cache_lock:
            cache[key] = value
            cache.move_to_end(key)
            while len(cache) > 32:
                cache.popitem(last=False)
        return value

    def forward(self, batch) -> Tensor:
        model = self.model
        zp = self._cached("person", batch, _PERSON_KEYS, lambda: model.person_z(batch))
        dz, o = self._cached("today", batch, ("today_window", "today_summary"),
                             lambda: model.today_encoder(batch["today_window"], batch["today_summary"]))
        z = zp + dz
        d0 = batch["hr_t0"] + self.model_module.D0_SCALE * torch.tanh(o)
        p = self._cached("parameters", {"z": z}, ("z",), lambda: model.parameter_values(z))
        activity, time = batch["activity"], batch["time"]
        activity_coefficient = model.activity_fn(activity, z.unsqueeze(1).expand(-1, activity.shape[1], -1))
        fatigue = self._cached("fatigue", batch, ("time",),
                               lambda: model.fatigue_fn(time.unsqueeze(-1)).squeeze(-1))
        intensity = activity_coefficient * fatigue
        return integrate(batch["hr_t0"].to(intensity.dtype), d0.to(intensity.dtype),
                         intensity, p, self.model_module)

    def _self_check(self, template):
        # Entirely synthetic inputs; match feature/window dimensions only.
        batch = {}
        for name in _PERSON_KEYS + ("today_window", "today_summary", "hr_t0"):
            if name in template:
                value = template[name]
                batch[name] = torch.zeros((3,) + tuple(value.shape[1:]), dtype=value.dtype)
        batch["group_index"].fill_(-1)
        batch["p4_keep"].fill_(True)
        batch["history_length"].fill_(batch["history"].shape[1])
        batch["hr_t0"].fill_(85.0)
        batch["activity"] = torch.full((3, 9, 2), 0.25, dtype=template["activity"].dtype)
        batch["activity"][1, 5:, 0] = 0.5
        batch["activity"][2, 7:, 1] = -0.125
        batch["time"] = (torch.arange(9, dtype=template["time"].dtype) / 360.0).repeat(3, 1)
        # Cover identical and heterogeneous neural inputs/initial states.
        for heterogeneous in (False, True):
            if heterogeneous:
                batch["history"][1].fill_(0.125)
                batch["u_vals"][2].fill_(0.25)
                batch["u_mask"][2].fill_(True)
                batch["hr_t0"][2] = 95.0
            expected = self.model(batch)["heart_rate"]
            if not _bit_equal(self.forward(batch), expected):
                return False
        generator = torch.Generator().manual_seed(488)
        for size in (1, 7, 15, 16, 17, 22, 23, 31, 32, 33, 45):
            p = {name: low + (high - low) * torch.rand(size, generator=generator)
                 for name, (low, high) in self.model_module.BOUNDS.items()}
            intensity = 40 + 190 * torch.rand(size, 120, generator=generator)
            hr0 = 40 + 170 * torch.rand(size, generator=generator)
            hr0[::3] = p["hr_min"][::3] - 10
            hr0[1::3] = p["hr_max"][1::3] + 10
            d0 = 40 + 190 * torch.rand(size, generator=generator)
            expected, demand = self.model_module.integrate(hr0, d0, intensity, p)
            actual, last_hr, last_dem = _integrate(hr0, d0, intensity, p)
            if (not _bit_equal(actual, expected)
                    or not _bit_equal(last_hr, expected[:, -1])
                    or not _bit_equal(last_dem, demand[:, -1])):
                return False
        return True

    def predict(self, batch) -> Tensor:
        if not self.checked:
            with self._check_lock:
                if not self.checked:
                    try:
                        self.disabled = not self._self_check(batch)
                    except Exception:
                        self.disabled = True
                    if self.disabled:
                        _LOG.warning("ODEV21_PRERUN_FAST disabled: bit-equivalence self-check failed")
                    self.checked = True
        if self.disabled:
            return self.model(batch)["heart_rate"]
        return self.forward(batch)

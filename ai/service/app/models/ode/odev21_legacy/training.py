"""학습 step, lr 일정, 가중치 EMA, 파라미터 통계, 일괄 예측 (CONTRACT 4.3·4.4절)."""
from __future__ import annotations

import copy
import math

import numpy as np
import torch

from . import batch as Bt
from . import model as M

LR_PEAK, LR_FLOOR, WARMUP = 5e-4, 5e-5, 200
EMA_DECAY = 0.998
SATURATION = (('B_ge_7.9', 'B', 'ge', 7.9), ('alpha_le_0.04', 'alpha', 'le', 0.04),
              ('hr_min_ge_119.9', 'hr_min', 'ge', 119.9),
              ('B_ge_4.9', 'B', 'ge', 4.9), ('alpha_le_0.11', 'alpha', 'le', 0.11), ('hr_min_ge_89.9', 'hr_min', 'ge', 89.9))


def to_device(b: dict, device) -> dict:
    return {k: v.to(device, non_blocking=True) for k, v in b.items()}


def lr_at(step: int, total_steps: int, peak: float = LR_PEAK, floor: float = LR_FLOOR, warmup: int = WARMUP) -> float:
    """완료한 step 수 → 그 다음 step의 lr. warmup은 floor → peak 선형, 그 뒤 total까지 peak → floor cosine."""
    if step < warmup:
        return floor + (peak - floor) * step / warmup
    frac = min(1.0, (step - warmup) / max(1, total_steps - warmup))
    return floor + (peak - floor) * 0.5 * (1.0 + math.cos(math.pi * frac))


def set_lr(optimizer, lr: float) -> None:
    for g in optimizer.param_groups:
        g['lr'] = float(lr)


class EMA:
    """가중치 지수이동평균. 모델 사본(model)을 갖고 optimizer step 뒤마다 update한다. buffer는 그대로 복사."""

    def __init__(self, model, decay: float = EMA_DECAY) -> None:
        self.decay = float(decay)
        self.model = copy.deepcopy(model)
        self.model.eval()
        for p in self.model.parameters():
            p.requires_grad_(False)

    @torch.no_grad()
    def update(self, model) -> None:
        d = self.decay
        for e, p in zip(self.model.parameters(), model.parameters()):
            e.mul_(d).add_(p.detach(), alpha=1.0 - d)
        for e, b in zip(self.model.buffers(), model.buffers()):
            e.copy_(b)

    def state_dict(self) -> dict:
        return dict(decay=self.decay, model=self.model.state_dict())

    def load_state_dict(self, state: dict) -> None:
        self.decay = float(state['decay'])
        self.model.load_state_dict(state['model'])


def train_step(model, optimizer, b: dict, device, clip: float = 5.0, ema: EMA | None = None,
               lr: float | None = None) -> dict:
    """가중 Apple 손실로 한 step. 손실·gradient가 유한하지 않으면 RuntimeError(PROJECT_RULES 7 중단 사유)."""
    model.train()
    if lr is not None:
        set_lr(optimizer, lr)
    b = to_device(b, device)
    out = model(b)
    loss, parts = M.apple_loss(out['heart_rate'], b['y'], b['mask'], out['z'], weight=b.get('weight'))
    value = float(loss.detach())
    if not np.isfinite(value):
        raise RuntimeError(f'손실이 유한하지 않다: {value}')
    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    grad_norm = float(torch.nn.utils.clip_grad_norm_(model.parameters(), clip, error_if_nonfinite=True))
    optimizer.step()
    if ema is not None:
        ema.update(model)
    return dict(loss=value, reconstruction=float(parts['reconstruction'].detach()), z_l2=float(parts['z_l2'].detach()),
                grad_norm=grad_norm, clipped=float(grad_norm > clip), l1_sum=float(parts['l1_sum']),
                n_points=int(parts['n_points']), parameters={k: v.detach() for k, v in out['parameters'].items()},
                d0_minus_hr=float((out['d0'] - b['hr_t0']).abs().mean().detach()))


def param_stats(parameters: dict, prefix: str = 'param') -> dict:
    """ODE 파라미터 p05/p50/p95/mean과 포화 비율(v2.1 경계와 v2 경계 둘 다). 보고만."""
    stats = {}
    arr = {k: v.detach().float().cpu().numpy() for k, v in parameters.items()}
    for name, x in arr.items():
        for q in (5, 50, 95):
            stats[f'{prefix}/{name}_p{q:02d}'] = float(np.percentile(x, q))
        stats[f'{prefix}/{name}_mean'] = float(x.mean())
    for label, name, op, th in SATURATION:
        if name in arr:
            x = arr[name]
            stats[f'{prefix}/{label}'] = float((x >= th).mean() if op == 'ge' else (x <= th).mean())
    return stats


def predict_items(model, items, stats: dict, device, batch_size: int = 256, max_points: int | None = None) -> list:
    """표본마다 t0 뒤 30초 점 예측(float64, 길이 ⌊(6·n_cell − r0)/6⌋, max_points로 자름)과 파라미터."""
    model.eval()

    def n_pts(it):
        n = (6 * int(it.rec.prep['n_cell']) - int(it.r0)) // 6
        return min(n, max_points) if max_points is not None else n

    order = sorted(range(len(items)), key=lambda i: n_pts(items[i]))
    out = [None] * len(items)
    with torch.inference_mode():
        for s in range(0, len(order), batch_size):
            idx = order[s:s + batch_size]
            max_steps = 3 * max(n_pts(items[i]) for i in idx)
            b = to_device(Bt.collate([items[i] for i in idx], stats, max_steps=max_steps), device)
            o = model(b)
            hr = o['heart_rate'].double().cpu()
            params = {k: v.double().cpu() for k, v in o['parameters'].items()}
            for j, i in enumerate(idx):
                n = n_pts(items[i])
                out[i] = dict(pred=M.points30(hr[j:j + 1], n)[0].numpy().copy(),
                              params={k: float(v[j]) for k, v in params.items()})
    return out


def predict_horizons(model, items, stats: dict, device, batch_size: int = 256, index=(2, 5, 11)) -> np.ndarray:
    """표본마다 t0 + 30·60·120초(10초 출력 index 2·5·11) 예측 [n, 3] float64. rollout은 12 step(미래 4 cell)만 한다."""
    model.eval()
    out = np.zeros((len(items), len(index)), np.float64)
    steps = max(index) + 1
    with torch.inference_mode():
        for s in range(0, len(items), batch_size):
            b = to_device(Bt.collate(items[s:s + batch_size], stats, max_steps=steps), device)
            hr = model(b)['heart_rate'].double().cpu().numpy()
            out[s:s + len(hr)] = hr[:, list(index)]
    return out

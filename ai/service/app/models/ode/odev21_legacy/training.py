"""ODE 개인 적합에서 공유하는 tensor 이동·학습 유틸리티."""
from __future__ import annotations

import copy

import torch

EMA_DECAY = 0.998


def to_device(b: dict, device) -> dict:
    return {k: v.to(device, non_blocking=True) for k, v in b.items()}


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

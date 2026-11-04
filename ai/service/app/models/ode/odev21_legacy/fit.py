"""새 사용자 Personal4 적합 (CONTRACT 5절, "80% 학습").

모델 전체를 고정하고 사람마다 P4(4D)만 Adam으로 맞춘다. 손실 = 학습과 같은 가중 Apple 손실 + λ‖P4‖².
표본 = support 세션마다 t0 = 0과 5초 격자 무작위 anchor 하나(seed 고정). step마다 사람당 표본 per_step개를 뽑는다(구현 세부).
사람마다 난수열이 따로라 여러 사람을 한 batch로 맞춰도 각자 따로 맞춘 것과 같다(Adam은 원소별).
"""
from __future__ import annotations

from dataclasses import replace
import hashlib

import numpy as np
import torch

from . import batch as Bt
from . import model as M
from . import samples as Sm
from . import training as Tr

GRID_STEPS = (50, 100, 200)               # v2.1 확장 격자(CONTRACT 6절). v2 최적(3e-2, 0.1, 100)을 포함한다
GRID_LR = (3e-2, 1e-1, 3e-1)
GRID_LAMBDA = (0.1, 0.3, 1.0)
FIXED = dict(lr=3e-2, lam=0.1, steps=100)  # 상위 3 epoch 재채점용(CONTRACT 5절 2단계)
PER_STEP = 4


def group_seed(name: str) -> int:
    return int(hashlib.sha256(str(name).encode()).hexdigest()[:8], 16)


def fit_items(records, contexts, seed: int = 1729) -> list:
    """support 세션 → [t0 = 0 표본, 무작위 anchor 표본(있으면)]. P4·dropout 없음, group −1."""
    out = []
    for r in records:
        if r.prep is None:
            continue
        ctx = contexts[r.session_id]
        out.append(Bt.Item(rec=r, r0=0, ctx=ctx, group_index=-1, drop=np.zeros(4, bool)))
        cands = Sm.anchor_candidates(r.prep)
        if len(cands):
            r0 = int(np.random.default_rng([seed, group_seed(r.session_id)]).choice(cands))
            out.append(Bt.Item(rec=r, r0=r0, ctx=ctx, group_index=-1, drop=np.zeros(4, bool)))
    return out


def fit_p4(model, items_by_group: dict, stats: dict, lr: float, lam: float, steps=GRID_STEPS, per_step: int = PER_STEP,
           seed: int = 1729, device='cpu', group_seeds: dict | None = None) -> dict:
    """{step: {group: P4 (np.float32[4])}}. 모델 파라미터는 바꾸지 않는다."""
    groups = sorted(g for g, its in items_by_group.items() if its)
    prepared_by_group = {
        group: tuple(replace(item, p4=np.zeros(M.P4_DIM, np.float32), drop=np.zeros(4, bool))
                     for item in items_by_group[group])
        for group in groups
    }
    gs = group_seeds or {}
    rngs = [np.random.default_rng([seed, gs.get(g, group_seed(g))]) for g in groups]
    owners = [gi for gi, group in enumerate(groups)
              for _ in range(min(per_step, len(prepared_by_group[group])))]
    owner_index = torch.tensor(owners, dtype=torch.long, device=device)
    P = torch.zeros(len(groups), M.P4_DIM, device=device, requires_grad=True)
    opt = torch.optim.Adam([P], lr=lr)
    flags = [p.requires_grad for p in model.parameters()]
    for p in model.parameters():
        p.requires_grad_(False)
    model.eval()
    snaps = {}
    try:
        for step in range(1, max(steps) + 1):
            items = []
            for gi, g in enumerate(groups):
                its = prepared_by_group[g]
                for t in rngs[gi].choice(len(its), size=min(per_step, len(its)), replace=False):
                    items.append(its[t])
            b = Tr.to_device(Bt.collate(items, stats), device)
            b['p4'] = P[owner_index]
            out = model(b)
            loss, _ = M.apple_loss(out['heart_rate'], b['y'], b['mask'], out['z'], weight=b['weight'])
            loss = loss + lam * P.square().sum()
            if not torch.isfinite(loss):
                raise RuntimeError('P4 적합 손실이 유한하지 않다')
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            if step in steps:
                snaps[step] = {g: P[gi].detach().cpu().numpy().astype(np.float32).copy() for gi, g in enumerate(groups)}
    finally:
        for p, f in zip(model.parameters(), flags):
            p.requires_grad_(f)
    return snaps


def support_loss(model, items_by_group: dict, stats: dict, p4_by_group: dict, device, batch_size: int = 256) -> float:
    """주어진 P4로 표본 전체의 가중 ((HR̂ − HR)/σ)² 합 / 점 수."""
    model.eval()
    items = [replace(it, p4=np.asarray(p4_by_group[g], np.float32)) for g, its in items_by_group.items() for it in its]
    total, n = 0.0, 0
    with torch.inference_mode():
        for s in range(0, len(items), batch_size):
            b = Tr.to_device(Bt.collate(items[s:s + batch_size], stats), device)
            out = model(b)
            _, parts = M.apple_loss(out['heart_rate'], b['y'], b['mask'], out['z'], weight=b['weight'])
            total += float(parts['reconstruction'])
            n += int(parts['n_points'])
    return total / max(n, 1)

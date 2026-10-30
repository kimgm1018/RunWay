"""Personal4-only adaptation on support windows (V2 personalized condition).

Mirrors apple_pretrain_v2.official_val121 / v2_protocol: an evaluation-local copy whose Personal4 table is one
row initialised with the mean of the trained subject rows; every shared weight (History8 encoder, transformer,
heads) frozen; Adam on that row only, chronological support batches cycled up to ``steps`` updates; the shared
model is never modified (digest-checked by the caller).
"""
from __future__ import annotations

import hashlib

import torch
from torch import nn

from .config import AdaptConfig
from .losses import trajectory_l1

PERSONAL4_PARAM = "personalization.subject_embedding.weight"


def state_digest(model: nn.Module, exclude=()) -> str:
    digest = hashlib.sha256()
    for key, value in model.state_dict().items():
        if key in exclude:
            continue
        digest.update(key.encode())
        digest.update(value.detach().cpu().contiguous().numpy().tobytes())
    return digest.hexdigest()


def personal4_init(model: nn.Module, rows=None) -> torch.Tensor:
    weight = model.personalization.subject_embedding.weight.detach()
    return (weight if rows is None else weight[list(rows)]).float().mean(dim=0)


def local_personal4_model(model_factory, source: nn.Module, personal4: torch.Tensor, device) -> nn.Module:
    local = model_factory()
    local.load_state_dict(source.state_dict())
    local.personalization.subject_embedding = nn.Embedding.from_pretrained(
        personal4.detach().clone().float().reshape(1, -1), freeze=False,
        max_norm=source.personalization.subject_embedding.max_norm)
    local.to(device).eval()
    for name, parameter in local.named_parameters():
        parameter.requires_grad_(name == PERSONAL4_PARAM)
    return local


def adapt_personal4(local: nn.Module, support_batches: list, cfg: AdaptConfig = AdaptConfig(),
                    loss_fn=trajectory_l1) -> dict:
    trainable = [name for name, p in local.named_parameters() if p.requires_grad]
    if trainable != [PERSONAL4_PARAM]:
        raise AssertionError(f"only Personal4 may be trainable, got {trainable}")
    weight = local.personalization.subject_embedding.weight
    optimizer = torch.optim.Adam([weight], lr=cfg.learning_rate, weight_decay=0.0)
    losses, updates = [], 0
    while support_batches and updates < cfg.steps:
        for batch in support_batches:
            optimizer.zero_grad(set_to_none=True)
            with torch.enable_grad():
                output = local(batch)
                loss = loss_fn(output, batch) + cfg.personal4_l2 * output["personal4"].square().sum(-1).mean()
            if not torch.isfinite(loss):
                raise FloatingPointError("non-finite adaptation loss")
            loss.backward()
            if weight.grad is None or not torch.isfinite(weight.grad).all():
                raise FloatingPointError("Personal4 has an invalid gradient")
            torch.nn.utils.clip_grad_norm_([weight], cfg.gradient_clip_norm)
            optimizer.step()
            updates += 1
            losses.append(float(loss.detach()))
            if updates == cfg.steps:
                break
    return dict(updates=updates, losses=losses)

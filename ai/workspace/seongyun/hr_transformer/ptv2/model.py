"""Personalized Action-Conditioned Transformer (Base).

48 temporal tokens: 24 past rows (t0-23 .. t0: HR, LOCF flag, speed, vertical speed, time) and 24 future rows
(t0+1 .. t0+24: planned speed, vertical speed, time). z12 = [Personal4 | History8] is projected to d_model and
added to every token. One Pre-Norm Transformer encoder (bidirectional over the 48 tokens; future tokens carry no
HR). The 24 future hidden states give delta HR in bpm; heart_rate = measured HR0 + delta HR.
"""
from __future__ import annotations

import torch
from torch import Tensor, nn

from . import config as C
from .batch import check_batch


class HistoryEncoder(nn.Module):
    """History8 from right-padded earlier-workout rows [B, Lh, 5]: masked 1-D CNN and masked mean.

    History rows keep the V2 loader's raw scale (vertical speed ~0.1 m/s); ``vertical_scale`` rescales that one
    channel inside the model so it matches the token path (VERTICAL_SPEED_SCALE). 1.0 = Stage 1/2 behaviour.
    """

    def __init__(self, hidden: int = 32, out_dim: int = C.HISTORY_DIM, vertical_scale: float = 1.0) -> None:
        super().__init__()
        self.conv1 = nn.Conv1d(C.HISTORY_FEATURE_DIM, hidden, kernel_size=5, padding=2)
        self.conv2 = nn.Conv1d(hidden, hidden, kernel_size=5, padding=2)
        self.out = nn.Linear(hidden, out_dim)
        self.activation = nn.GELU()
        scale = torch.ones(C.HISTORY_FEATURE_DIM)
        scale[3] = vertical_scale
        self.register_buffer("input_scale", scale, persistent=False)

    def forward(self, history: Tensor, lengths: Tensor) -> Tensor:
        valid = (torch.arange(history.shape[1], device=history.device)[None, :] < lengths[:, None]).to(history.dtype)
        mask = valid[:, None, :]
        # Padded rows are zeroed after every layer, so padding acts exactly like the conv's own zero border.
        x = (history * self.input_scale * valid[..., None]).transpose(1, 2)
        x = self.activation(self.conv1(x)) * mask
        x = self.activation(self.conv2(x)) * mask
        return self.out(x.sum(dim=-1) / valid.sum(dim=-1, keepdim=True))


class Personalization(nn.Module):
    """z12 = [Personal4 (per-Train-subject embedding) | History8 (earlier workouts)].

    The History8 producer is pluggable: any module mapping (history [B, Lh, F], lengths [B]) -> [B, HISTORY_DIM]
    (e.g. a later Readiness / load encoder) can be passed in without touching the transformer body.
    """

    def __init__(self, n_subjects: int, cfg: C.ModelConfig, history_encoder: nn.Module | None = None) -> None:
        super().__init__()
        if n_subjects < 1:
            raise ValueError("n_subjects must be positive")
        self.subject_embedding = nn.Embedding(n_subjects, C.PERSONAL_DIM, max_norm=cfg.personal_max_norm)
        self.history_encoder = history_encoder if history_encoder is not None else \
            HistoryEncoder(cfg.history_hidden, vertical_scale=cfg.history_vertical_scale)

    def forward(self, subject_index: Tensor, history: Tensor, history_length: Tensor) -> tuple[Tensor, Tensor, Tensor]:
        personal4 = self.subject_embedding(subject_index.to(torch.long))
        history8 = self.history_encoder(history, history_length)
        return torch.cat((personal4, history8), dim=-1), personal4, history8


class PersonalizedActionTransformer(nn.Module):
    def __init__(self, n_subjects: int, cfg: C.ModelConfig = C.ModelConfig(), history_encoder: nn.Module | None = None) -> None:
        super().__init__()
        self.cfg = cfg
        d = cfg.d_model
        self.personalization = Personalization(n_subjects, cfg, history_encoder)
        self.past_proj = nn.Linear(len(C.PAST_FEATURES), d)
        self.future_proj = nn.Linear(len(C.FUTURE_FEATURES), d)
        self.z_proj = nn.Linear(C.Z_DIM, d)
        self.position = nn.Parameter(torch.empty(C.N_TOKENS, d))
        nn.init.normal_(self.position, std=0.02)
        self.token_type = nn.Embedding(2, d)  # 0 = past, 1 = future plan
        layer = nn.TransformerEncoderLayer(d, cfg.n_heads, cfg.ff_dim, cfg.dropout, activation="gelu",
                                           batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, cfg.n_layers, norm=nn.LayerNorm(d), enable_nested_tensor=False)
        self.head = nn.Linear(d, 1)
        nn.init.normal_(self.head.weight, std=cfg.head_init_std)
        nn.init.zeros_(self.head.bias)
        self.register_buffer("token_type_ids", torch.tensor([0] * C.PAST_STEPS + [1] * C.FUTURE_STEPS),
                             persistent=False)
        if cfg.session_context_dim:
            if len(cfg.session_mean) != cfg.session_context_dim or len(cfg.session_std) != cfg.session_context_dim:
                raise ValueError("session_mean / session_std must have session_context_dim entries")
            # Created last so the Base parameters keep their initialisation; the zero output layer makes the untrained
            # current-session context an exact no-op (the model starts identical to the Base).
            self.register_buffer("session_mean", torch.tensor(cfg.session_mean, dtype=torch.float32))
            self.register_buffer("session_std", torch.tensor(cfg.session_std, dtype=torch.float32))
            self.session_proj = nn.Sequential(nn.Linear(cfg.session_context_dim, cfg.session_context_hidden), nn.GELU(),
                                              nn.Linear(cfg.session_context_hidden, d))
            nn.init.zeros_(self.session_proj[2].weight)
            nn.init.zeros_(self.session_proj[2].bias)
        else:
            self.session_proj = None

    def tokens(self, batch: dict, z: Tensor, session: Tensor | None = None) -> Tensor:
        hr = batch["past_hr"]
        past = torch.stack(((hr - C.HR_CENTER) / C.HR_SCALE, batch["past_hr_is_filled"].to(hr.dtype),
                            batch["past_action"][..., 0], batch["past_action"][..., 1] * C.VERTICAL_SPEED_SCALE,
                            batch["past_time"]), dim=-1)
        future = torch.stack((batch["future_action"][..., 0], batch["future_action"][..., 1] * C.VERTICAL_SPEED_SCALE,
                              batch["future_time"]), dim=-1)
        x = torch.cat((self.past_proj(past), self.future_proj(future)), dim=1)
        x = x + self.position + self.token_type(self.token_type_ids) + self.z_proj(z)[:, None, :]
        if session is not None:
            x = x + session[:, None, :]
        return x

    def context(self, batch: dict) -> Tensor:
        """z12 per row; an MPC caller can compute it once per t0 and pass it to forward(..., z=) for all candidates."""
        return self.personalization(batch["subject_index"], batch["history"], batch["history_length"])[0]

    def session_context(self, batch: dict) -> Tensor:
        """Current-session summary [B, F] -> frozen Train normalisation (clipped) -> d_model context vector."""
        if "session_summary" not in batch:
            raise ValueError("this model was built with session context; the batch needs session_summary")
        s = (batch["session_summary"] - self.session_mean) / self.session_std
        return self.session_proj(s.clamp(-C.SESSION_CONTEXT_CLIP, C.SESSION_CONTEXT_CLIP))

    def forward(self, batch: dict, z: Tensor | None = None) -> dict:
        check_batch(batch)
        if z is None:
            z, personal4, history8 = self.personalization(batch["subject_index"], batch["history"], batch["history_length"])
        else:
            personal4, history8 = z[:, :C.PERSONAL_DIM], z[:, C.PERSONAL_DIM:]
        session = self.session_context(batch) if self.session_proj is not None else None
        hidden = self.encoder(self.tokens(batch, z, session))
        delta = self.head(hidden[:, C.PAST_STEPS:]).squeeze(-1) * C.HR_SCALE
        return {"heart_rate": batch["hr0"][:, None] + delta, "delta_hr": delta, "z": z,
                "personal4": personal4, "history8": history8, "session_context": session}


def parameter_count(model: nn.Module) -> dict:
    total = sum(p.numel() for p in model.parameters())
    per_subject = model.personalization.subject_embedding.weight.numel()
    return dict(total=total, trainable=sum(p.numel() for p in model.parameters() if p.requires_grad),
                personal4_table=per_subject, shared_without_personal4=total - per_subject,
                by_module={name: sum(p.numel() for p in m.parameters()) for name, m in model.named_children()}
                | {"position": model.position.numel()})

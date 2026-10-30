"""Paths, tensor contract and Base hyper-parameters of the Personalized Action-Conditioned Transformer (Final Split V2)."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import os
from pathlib import Path

EXPERIMENT_DIR = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = EXPERIMENT_DIR / "outputs"

# Verified Final Split V2 infrastructure, used read-only: shared/fitrec_v2 and experiments/ode_cnn/apple_pretrain_v2.
REF_ROOT = Path(os.environ.get(
    "PTV2_REF_ROOT", "~/workspace/seongyun/runway_shared_residual_horizon/personal_RunWay_b_mode")).expanduser()
FITREC_ROOT = Path(os.environ.get("FITREC_ROOT", "~/data/fitrec/fitrec_v1")).expanduser()
SPLIT_V2_PATH = Path(os.environ.get("FITREC_SPLIT_V2", "~/data/fitrec/splits/fitrec_hr_v2.json")).expanduser()
ANSWER_KEY_PATH = Path(os.environ.get(
    "PTV2_ANSWER_KEY", "~/data/fitrec/eval_windows/fitrec_hr_v2/val_windows.parquet")).expanduser()

# Window / token contract = shared/fitrec_v2/windows.py (physiology_v1 rules on the canonical 5 s grid).
GRID_S = 5
PAST_STEPS = 24      # rows t0-23 .. t0 (120 s; the last token is t0, whose HR is the measured HR0)
FUTURE_STEPS = 24    # rows t0+1 .. t0+24 (120 s candidate speed/grade plan)
N_TOKENS = PAST_STEPS + FUTURE_STEPS
HORIZON_INDEX = {30: 5, 60: 11, 120: 23}   # index into the 24 future outputs

PERSONAL_DIM = 4
HISTORY_DIM = 8
Z_DIM = PERSONAL_DIM + HISTORY_DIM
HISTORY_FEATURE_DIM = 5      # apple_pretrain_v2.data._history_from_prior: hr, elapsed, speed, vertical speed, log gap
HISTORY_MAX_LENGTH = 512     # 10 s history rows, same limit as the V2 loader

# Fixed input scaling (provisional; not fit on data).
HR_CENTER, HR_SCALE = 142.0, 22.0    # same as the History feature (hr - 142) / 22; also the delta-HR output unit
TIME_SCALE_S = 1200.0                # same as the Apple time input elapsed_s / 1200
VERTICAL_SPEED_SCALE = 10.0          # speed_v_proxy is ~0.1 m/s
SESSION_CONTEXT_CLIP = 5.0  # normalised current-session summary is clipped to +-5 Train SDs (session_context.py)
PAST_FEATURES = ("hr_norm", "hr_is_filled", "speed_mps", "vertical_speed_x10", "time")
FUTURE_FEATURES = ("speed_mps", "vertical_speed_x10", "time")


@dataclass(frozen=True)
class ModelConfig:
    d_model: int = 128
    n_heads: int = 4
    n_layers: int = 4
    ff_dim: int = 512
    dropout: float = 0.1
    history_hidden: int = 32
    head_init_std: float = 1e-3       # near-zero delta at init: prediction starts at persistence (HR0)
    personal_max_norm: float = 5.0    # same Personal4 bound as Apple
    history_vertical_scale: float = 1.0   # 1.0 = Stage 1/2 behaviour; Stage 3 uses VERTICAL_SPEED_SCALE like the tokens
    session_context_dim: int = 0  # 0 = off (Base); else the number of current-session summary features
    session_context_hidden: int = 32
    session_mean: tuple = ()  # frozen V2 Train statistics of those features (normalisation inside the model)
    session_std: tuple = ()

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class AdaptConfig:
    """Personal4-only adaptation; mirrors apple_pretrain_v2.official_val121.PROTOCOL (provisional)."""
    learning_rate: float = 5e-2
    steps: int = 20
    batch_size: int = 128
    gradient_clip_norm: float = 5.0
    personal4_l2: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)

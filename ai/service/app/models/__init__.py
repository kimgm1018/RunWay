import importlib
import sys

import numpy as np

from app.config import Settings
from app.models.base import FUTURE_STEPS, HORIZONS_SEC, HRModel, ModelInfo

__all__ = ["HRModel", "ModelInfo", "load_model", "check_hr_model"]


def load_model(settings: Settings) -> HRModel:
    """HR_MODEL_TYPE에 맞는 모델을 불러온다. gru 외 모델은 HR_MODEL_PLUGIN으로 끼운다(문서: app/models/HR_MODEL_PLUGIN.md)."""
    if settings.model_type == "gru":
        from app.models.gru import load_gru
        return load_gru(settings)
    if not settings.model_plugin:
        raise ValueError(f"지원하지 않는 HR_MODEL_TYPE: {settings.model_type} "
                         "(gru 외 모델은 HR_MODEL_PLUGIN=모듈:팩토리 가 필요합니다)")
    module_name, _, factory_name = settings.model_plugin.partition(":")
    if not module_name or not factory_name:
        raise ValueError("HR_MODEL_PLUGIN은 '모듈:팩토리' 형식이어야 합니다")
    if settings.model_plugin_dir is not None and str(settings.model_plugin_dir) not in sys.path:
        sys.path.insert(0, str(settings.model_plugin_dir))
    model = getattr(importlib.import_module(module_name), factory_name)(settings)
    check_hr_model(model, settings.model_type)
    return model


def check_hr_model(model, model_type: str) -> None:
    """시작할 때 HRModel 규격을 합성 배치로 확인한다. 예측 품질 검증이 아니다."""
    info = getattr(model, "info", None)
    if not isinstance(info, ModelInfo) or not callable(getattr(model, "predict", None)):
        raise ValueError("HR 모델은 info(ModelInfo)와 predict(batch)를 가져야 합니다")
    if info.model_type.strip().lower() != model_type:
        raise ValueError(f"모델 info.model_type({info.model_type})과 HR_MODEL_TYPE({model_type})이 다릅니다")
    if tuple(info.horizons_sec) != HORIZONS_SEC or info.min_samples < 1:
        raise ValueError("HR 모델은 horizons_sec=(30, 60, 120), min_samples>=1 이어야 합니다")
    n, length = 2, 12
    batch = {
        "hr": np.full((n, length), 150.0, np.float32), "speed": np.full((n, length), 3.0, np.float32),
        "grade": np.zeros((n, length), np.float32), "segment": None,
        "elapsed_s": np.full(n, 600.0, np.float32),
        "future_speed": np.full((n, FUTURE_STEPS), 3.0, np.float32),
        "future_grade": np.vstack([np.zeros(FUTURE_STEPS, np.float32), np.full(FUTURE_STEPS, np.nan, np.float32)]),
        "session_start_s": None,
    }
    output = np.asarray(model.predict(batch), dtype=float)
    if output.shape != (n, len(HORIZONS_SEC)) or not np.isfinite(output).all():
        raise ValueError(f"HR 모델 출력은 유한한 [N, 3] (HR@30/60/120 bpm)이어야 합니다: shape={output.shape}")

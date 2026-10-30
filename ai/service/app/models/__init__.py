from app.config import Settings
from app.models.base import HRModel, ModelInfo

__all__ = ["HRModel", "ModelInfo", "load_model"]


def load_model(settings: Settings) -> HRModel:
    """HR_MODEL_TYPE에 맞는 모델을 불러온다. 모델을 추가하면 여기에 갈래를 더한다."""
    if settings.model_type == "gru":
        from app.models.gru import load_gru
        return load_gru(settings)
    raise ValueError(f"지원하지 않는 HR_MODEL_TYPE: {settings.model_type}")

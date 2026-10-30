"""GRU HR Predictor(ai/workspace/doyeon/gru) 어댑터. 개인화 없이 기본(population) 상태로 예측한다."""
import hashlib
import sys
import threading
from pathlib import Path

import numpy as np

from app.config import Settings
from app.models.base import ModelInfo

MISSING_POLICY = {
    "history": "t0와 같은 구간에서 심박·속도·경사 중 빈 값이 있는 칸은 빼고 최근 72칸(6분)을 쓴다. 짧으면 앞을 빈칸으로 채운다",
    "hr0": "t0 심박(hrBpm 마지막 칸)이 없으면 INPUT_INSUFFICIENT",
    "futureGrade": "후보의 futureGradePct가 null이거나 빈 칸이 있으면 미래 경사 없이 학습한 모델(M3-006)로 예측한다",
}


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


class GRUModel:
    def __init__(self, predictor, sha256: str):
        self.predictor = predictor
        self.lock = threading.Lock()   # predictor는 개인화 상태를 객체에 끼우므로 한 번에 한 요청만 쓴다
        self.info = ModelInfo(
            model_type="gru",
            model_version=f"gru-m3-005+m3-006-{sha256[:8]}",
            window_sec=predictor.hist * 5,
            min_samples=1,
            missing_policy=MISSING_POLICY,
        )

    def predict(self, batch: dict) -> np.ndarray:
        with self.lock:
            return self.predictor.predict(batch, personalized=False)


def load_gru(settings: Settings) -> GRUModel:
    if not settings.model_path.is_file():
        raise FileNotFoundError(f"체크포인트가 없습니다: {settings.model_path.name} (README의 모델 파일 준비 참고)")
    sha256 = sha256_of(settings.model_path)
    if settings.model_sha256 and sha256 != settings.model_sha256:
        raise ValueError(f"체크포인트 SHA256이 다릅니다: {sha256[:12]}… ≠ HR_MODEL_SHA256 {settings.model_sha256[:12]}…")

    import torch
    torch.set_num_threads(settings.torch_threads)
    sys.path.insert(0, str(settings.gru_src_dir))
    from predictor import load   # noqa: E402  (HR_GRU_SRC_DIR의 GRU predictor)

    return GRUModel(load(settings.model_path, settings.device), sha256)

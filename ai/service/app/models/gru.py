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
        self.sha256 = sha256.lower()
        # 기존 predictor 호환용. 실제 GRU 예측은 공유 상태를 바꾸지 않아 lock이 필요 없다.
        self.lock = threading.Lock()
        self.info = ModelInfo(
            model_type="gru",
            model_version=f"gru-m3-005+m3-006-{sha256[:8]}",
            window_sec=predictor.hist * 5,
            min_samples=1,
            missing_policy=MISSING_POLICY,
        )

    @property
    def _mutation_free(self) -> bool:
        return all(hasattr(self.predictor, name) for name in ("models", "base", "make_input"))

    def _predict_with_head(self, batch, state=None) -> np.ndarray:
        """predictor.predict의 전처리·계산 순서를 유지하며 요청의 출력층만 읽는다."""
        import torch
        from torch.nn import functional as F

        predictor = self.predictor
        state = predictor.base if state is None else state
        # load_state처럼 모든 모델의 head가 필요하며, 다른 모델의 head는 허용하지 않는다.
        for key in predictor.models:
            if key not in state:
                raise KeyError(key)
        if set(state) != set(predictor.models):
            raise ValueError("GRU 출력층 key가 로드한 모델과 다릅니다.")
        module = sys.modules[type(predictor).__module__]
        batch = module.batch_to_windows(batch)
        if len(batch) == 0:
            return np.zeros((0, 3), np.float32)
        hr0 = np.array([w["hr0"] if w.get("hr0") is not None else w["hr"][-1] for w in batch], np.float32)
        if np.isnan(hr0).any():
            raise ValueError("HR0(hr의 마지막 칸 또는 hr0)는 실제 측정값이어야 한다")
        missing = (np.array([predictor.grade_missing(w) for w in batch])
                   if module.NOGRADE in predictor.models else np.zeros(len(batch), bool))
        delta = np.zeros((len(batch), 3), np.float32)
        for key, rows in [(module.MAIN, np.flatnonzero(~missing)),
                          (module.NOGRADE, np.flatnonzero(missing))]:
            if len(rows) == 0:
                continue
            x = torch.from_numpy(np.stack([
                predictor.make_input(batch[i], predictor.flats[key]) for i in rows
            ])).to(predictor.device)
            with torch.no_grad():
                model = predictor.models[key]
                weight, bias = state[key]
                # load_state의 copy_와 같은 device/dtype으로 읽되 모듈에는 쓰지 않는다.
                weight = weight.to(device=model.head.weight.device, dtype=model.head.weight.dtype).contiguous()
                bias = bias.to(device=model.head.bias.device, dtype=model.head.bias.dtype).contiguous()
                delta[rows] = F.linear(model.features(x), weight, bias).cpu().numpy() * predictor.std[2]
        return hr0[:, None] + delta

    def predict(self, batch: dict) -> np.ndarray:
        if self._mutation_free:
            return self._predict_with_head(batch)
        with self.lock:
            return self.predictor.predict(batch, personalized=False)

    def predict_with_state(self, batch: dict, state: dict) -> np.ndarray:
        """공유 모듈을 바꾸지 않고 사용자 출력층으로 예측한다."""
        if self._mutation_free:
            return self._predict_with_head(batch, state)
        with self.lock:
            try:
                self.predictor.load_state(state)
                return self.predictor.predict(batch, personalized=True)
            finally:
                self.predictor.load_state(None)


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

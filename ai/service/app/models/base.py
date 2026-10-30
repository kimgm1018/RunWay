"""HR 예측 모델 공통 모양. 모델이 바뀌어도 API는 이 모양만 쓴다."""
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

STEP_SEC = 5
FUTURE_STEPS = 24
HORIZONS_SEC = (30, 60, 120)


@dataclass(frozen=True)
class ModelInfo:
    model_type: str
    model_version: str
    window_sec: int                                 # 모델이 실제로 읽는 과거 길이
    min_samples: int                                # t0와 같은 구간에서 심박·속도·경사가 모두 있는 최소 칸 수
    required_metrics: tuple[str, ...] = ("hrBpm", "speedMps", "gradePct")
    missing_policy: dict = field(default_factory=dict)


class HRModel(Protocol):
    info: ModelInfo

    def predict(self, batch: dict) -> np.ndarray:
        """batch(키마다 후보 N개를 묶은 dict) → [N, 3] 절대 HR(bpm) = [HR@30, HR@60, HR@120].

        batch 키 (인계 predictor와 같은 형식, 5초 간격, 마지막 칸이 t0):
          hr, speed, grade : [N, L] (빈 값 NaN)
          segment          : [N, L] 또는 None
          elapsed_s        : [N] t0의 러닝 시작 후 경과 시간(초)
          future_speed     : [N, 24] m/s
          future_grade     : [N, 24] %, 모르는 후보는 그 행이 NaN
          session_start_s  : [N] 러닝 시작 시각(UTC epoch 초) 또는 None
        """
        ...

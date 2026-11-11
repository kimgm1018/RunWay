"""ODE식 GRU 개인 보정 g·b (S15P31E105-641, 631 실험 M2).

예측마다 pred' = hr_now + g·(gru_pred − hr_now) + b.
- AI06: 사용자 과거 런(support)에서 기본 GRU의 예측 변화량 x와 실제 변화량 y로 y = g·x + b를 최소제곱(닫힌 해)으로
  맞추고, g는 0.5~2.0, b는 ±8 bpm으로 자른 뒤 n/(n+k)로 g=1, b=0 쪽으로 줄인다(n = 쓴 런 수, k=50은 631 Train 선택).
  결과는 summaryU 안의 gruGain·gruOffsetBpm·gruSupportN으로 저장된다(백엔드는 summaryU를 그대로 JSONB에 넣는다).
- AI04·AI10: 학습 심박 기준선과 같은 행에서 두 값을 읽어 기본 GRU 출력에 적용한다. 없거나 잘못된 값은 g=1, b=0.
- GRU_GB_PERSONALIZATION_ENABLED가 꺼져 있으면 계산·적용을 하지 않아 출력이 이전과 비트 단위로 같다.
"""
from __future__ import annotations

from contextlib import nullcontext
import logging
import math
import os

import numpy as np

from app.ai_logging import log_ai_error

GAIN_KEY = "gruGain"
OFFSET_KEY = "gruOffsetBpm"
SUPPORT_KEY = "gruSupportN"
GAIN_RANGE = (0.5, 2.0)
OFFSET_LIMIT_BPM = 8.0
SHRINK_K = 50.0
DEFAULT_MAX_WINDOWS = 3000
UNAVAILABLE_LOG = "GRU_GB_UNAVAILABLE"


def gru_gb_enabled() -> bool:
    return os.getenv("GRU_GB_PERSONALIZATION_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}


def max_windows() -> int:
    try:
        return max(1, int(os.getenv("GRU_GB_MAX_WINDOWS", str(DEFAULT_MAX_WINDOWS))))
    except (TypeError, ValueError):
        return DEFAULT_MAX_WINDOWS


# ---------------------------------------------------------------- 읽기·검증·적용 (AI04·AI10)
def _number(value) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def parse_gb(gain, offset) -> tuple[float, float]:
    """저장값 검증. 둘 중 하나라도 없거나 범위를 벗어나면 보정 없음(1, 0)."""
    g, b = _number(gain), _number(offset)
    if g is None or b is None:
        return 1.0, 0.0
    if not GAIN_RANGE[0] <= g <= GAIN_RANGE[1] or abs(b) > OFFSET_LIMIT_BPM:
        return 1.0, 0.0
    return g, b


def is_identity(gain: float, offset: float) -> bool:
    return gain == 1.0 and offset == 0.0


def parse_support_n(value) -> int:
    """저장된 러닝 수. 없거나 잘못되면 0."""
    number = _number(value)
    if number is None or number < 0 or number != int(number):
        return 0
    return int(number)


def personal_weight(n: int, gain: float = 0.0, offset: float = 0.0) -> float:
    """개인 값의 비중 n/(n+k). 실제로 보정이 적용되지 않으면(g=1, b=0) 0."""
    if n <= 0 or is_identity(gain, offset):
        return 0.0
    return n / (n + SHRINK_K)


def apply_gb(prediction: np.ndarray, hr_now: float | None, gain: float, offset: float) -> np.ndarray:
    """[N, 3] 예측에 g·b를 적용한다. 보정 없음이거나 hr_now가 없으면 입력 배열을 그대로 돌려준다."""
    if is_identity(gain, offset) or hr_now is None:
        return prediction
    hr = float(hr_now)
    if not math.isfinite(hr):
        return prediction
    return hr + gain * (prediction - hr) + offset


# ---------------------------------------------------------------- 계산 (AI06)
def fit_gb(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """y = g·x + b 최소제곱(631 fit_gb와 같음). 자료가 부족하면 (1, 0). 자른 원값을 돌려준다."""
    x = np.asarray(x, np.float64).ravel()
    y = np.asarray(y, np.float64).ravel()
    if len(x) < 2:
        return 1.0, 0.0
    mx, my = x.mean(), y.mean()
    dx = x - mx
    var = float(np.mean(dx * dx))
    if var < 1e-9:
        return 1.0, 0.0
    g = float(np.mean(dx * (y - my)) / var)
    b = float(my - g * mx)
    return float(np.clip(g, *GAIN_RANGE)), float(np.clip(b, -OFFSET_LIMIT_BPM, OFFSET_LIMIT_BPM))


def shrink_gb(g: float, b: float, n: int, k: float = SHRINK_K) -> tuple[float, float]:
    s = n / (n + k) if n + k > 0 else 0.0
    return 1.0 + s * (g - 1.0), s * b


def support_pairs(model, frames, *, limit: int | None = None):
    """support 런(최신 런부터)의 창마다 기본 GRU 예측 변화량 x, 실제 변화량 y(bpm), 쓴 런 수를 모은다.

    창 규칙·입력은 기존 개인화 head와 같은 predictor.support_features(30초 간격, 실측 GOOD 정답만)이다.
    주 모델(미래 경사 있음)로 계산하고, 경사가 없어 주 모델 창이 하나도 없으면 미래 경사 없는 모델로 계산한다.
    창 수가 limit에 닿으면 더 오래된 런은 쓰지 않는다.
    """
    predictor = model.predictor
    limit = max_windows() if limit is None else max(1, int(limit))
    keys = [key for key in ("main", "nograde") if key in predictor.models]
    import torch
    from torch.nn import functional as F

    std = float(predictor.std[2])
    with nullcontext() if getattr(model, "_mutation_free", False) else model.lock:
        for key in keys:
            weight, bias = predictor.base[key]
            xs, ys, used, total = [], [], 0, 0
            for frame in frames:
                if total >= limit:
                    break
                features = predictor.support_features([frame], key)
                if features is None:
                    continue
                h, y, m = features
                take = min(int(h.shape[0]), limit - total)
                h, y, m = h[:take], y[:take], m[:take] > 0
                with torch.no_grad():
                    x = F.linear(h, weight.to(h.device, h.dtype), bias.to(h.device, h.dtype)) * std
                m_np = m.cpu().numpy()
                if not m_np.any():
                    continue
                xs.append(x.cpu().numpy().astype(np.float64)[m_np])
                ys.append((y.cpu().numpy().astype(np.float64) * std)[m_np])
                used += 1
                total += take
            if used:
                return np.concatenate(xs), np.concatenate(ys), used
    return np.zeros(0), np.zeros(0), 0


def compute_gb(model, frames, *, limit: int | None = None) -> dict:
    """summaryU에 넣을 세 값을 계산한다(런이 없으면 g=1, b=0, n=0)."""
    x, y, n = support_pairs(model, frames, limit=limit)
    g, b = shrink_gb(*fit_gb(x, y), n) if n else (1.0, 0.0)
    return {GAIN_KEY: round(float(g), 6), OFFSET_KEY: round(float(b), 4), SUPPORT_KEY: int(n)}


def add_gb_to_summary(result: dict, body, model) -> None:
    """AI06 응답의 summaryU에 g·b를 넣는다. 실패하면 키를 넣지 않는다(읽는 쪽은 보정 없음으로 처리)."""
    summary = result.get("summaryU")
    if not isinstance(summary, dict) or model is None or getattr(model, "predictor", None) is None:
        return
    try:
        from app.gru_personalization import support_to_frames
        summary.update(compute_gb(model, support_to_frames(body)))
    except Exception as exc:
        log_ai_error(UNAVAILABLE_LOG, "/v1/hr/personalize", exc, level=logging.WARNING)


__all__ = ["GAIN_KEY", "OFFSET_KEY", "SUPPORT_KEY", "add_gb_to_summary", "apply_gb", "compute_gb", "fit_gb",
           "gru_gb_enabled", "is_identity", "parse_gb", "parse_support_n", "personal_weight", "shrink_gb",
           "support_pairs"]

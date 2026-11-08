"""개인 보폭 모델: 보폭 = (μa + c × (키 − H_REF) + Δa) + (μb + Δb) × (속도 − V_REF).

공개 데이터로 평균 직선 μ와 사람 간 퍼짐 G, 측정 노이즈 σ²를 학습하고(prior),
사용자 기록으로 그 사람의 차이 (Δa, Δb)를 베이지안으로 보정한다.
키 항(c)은 키를 넣어 학습한 prior에만 있다(height_coef). 키가 없으면 0으로 둔다.
"""
import json
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd


V_REF = 3.0     # 속도 기준(m/s). 절편 = 3 m/s에서의 보폭
H_REF = 175.0   # 키 기준(cm)


@dataclass
class StridePrior:
    mu: np.ndarray       # [μa, μb] 평균 직선
    G: np.ndarray        # 2×2 사람 간 (Δa, Δb) 공분산
    sigma2: float        # 측정 노이즈 분산 (m²)
    v_ref: float = V_REF
    height_coef: float = 0.0             # 키 1cm당 보폭 변화(m). 0이면 키를 쓰지 않는 prior
    h_ref: float = H_REF
    h_range: tuple[float, float] | None = None   # 학습한 키 범위. 밖이면 잘라서 쓴다

    @property
    def uses_height(self) -> bool:
        return self.height_coef != 0.0

    def to_dict(self) -> dict:
        return {"mu": self.mu.tolist(), "G": self.G.tolist(), "sigma2": self.sigma2, "v_ref": self.v_ref,
                "height_coef": self.height_coef, "h_ref": self.h_ref,
                "h_range": None if self.h_range is None else list(self.h_range)}

    @classmethod
    def from_dict(cls, d: dict) -> "StridePrior":
        h_range = d.get("h_range")
        return cls(np.array(d["mu"]), np.array(d["G"]), float(d["sigma2"]), float(d["v_ref"]),
                   float(d.get("height_coef", 0.0)), float(d.get("h_ref", H_REF)),
                   None if h_range is None else tuple(h_range))

    def save(self, path: Path):
        path.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "StridePrior":
        return cls.from_dict(json.loads(path.read_text(encoding="utf-8")))


def design(prior: StridePrior, speeds) -> np.ndarray:
    v = np.asarray(speeds, dtype=float) - prior.v_ref
    return np.column_stack([np.ones_like(v), v])


def height_shift(prior: StridePrior, height_cm) -> float:
    """키에 따른 보폭 이동(m). 키를 쓰지 않는 prior이거나 키를 모르면 0."""
    if not prior.uses_height or height_cm is None or np.isnan(height_cm):
        return 0.0
    if prior.h_range is not None:
        height_cm = float(np.clip(height_cm, *prior.h_range))
    return prior.height_coef * (height_cm - prior.h_ref)


def fit_prior(table: pd.DataFrame, use_height: bool = False) -> StridePrior:
    """subject_id, speed_mps, stride_m(, height_cm) 표로 혼합효과 모델을 맞춘다."""

    import statsmodels.formula.api as smf   # 학습할 때만 필요하다(AI 서비스에는 설치하지 않는다)

    data = table.assign(v=table["speed_mps"] - V_REF)
    formula = "stride_m ~ v"
    if use_height:
        data = data.dropna(subset=["height_cm"]).assign(h=lambda d: d["height_cm"] - H_REF)
        formula += " + h"
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="The MLE may be on the boundary")
        result = smf.mixedlm(formula, data, groups=data["subject_id"], re_formula="~v").fit(reml=True)
    if not result.converged:
        raise RuntimeError("MixedLM이 수렴하지 않았습니다")
    prior = StridePrior(
        mu=result.fe_params[["Intercept", "v"]].to_numpy(),
        G=result.cov_re.to_numpy(),
        sigma2=float(result.scale),
    )
    if use_height:
        prior.height_coef = float(result.fe_params["h"])
        prior.h_range = (float(data["height_cm"].min()), float(data["height_cm"].max()))
    return prior


def base_stride(prior: StridePrior, speeds, height_cm=None) -> np.ndarray:
    """사용자 기록 없이 예측한 보폭 (평균 직선 + 키 이동)."""
    return design(prior, speeds) @ prior.mu + height_shift(prior, height_cm)


def personal_offset(prior: StridePrior, speeds, strides, height_cm=None) -> np.ndarray:
    """사용자 기록(속도, 보폭)으로 그 사람의 차이 (Δa, Δb)의 사후 평균을 구한다. 기록이 없으면 0."""
    if len(speeds) == 0:
        return np.zeros(2)
    X = design(prior, speeds)
    y = np.asarray(strides, dtype=float)
    P = np.linalg.inv(np.linalg.inv(prior.G) + X.T @ X / prior.sigma2)
    return P @ X.T @ (y - base_stride(prior, speeds, height_cm)) / prior.sigma2


def predict_stride(prior: StridePrior, speeds, offset=None, height_cm=None) -> np.ndarray:
    stride = base_stride(prior, speeds, height_cm)
    if offset is not None:
        stride = stride + design(prior, speeds) @ offset
    return stride


def predict_cadence(prior: StridePrior, speeds, offset=None, height_cm=None) -> np.ndarray:
    speeds = np.asarray(speeds, dtype=float)
    return 60 * speeds / predict_stride(prior, speeds, offset, height_cm)
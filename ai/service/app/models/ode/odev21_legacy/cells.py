"""30초 cell action → 10초 ODE 입력, 10초 학습 정답 (CONTRACT 2절 5번, 3.2절).

세션·cell 규칙은 Pre-run Validation harness의 pv_data.prepare_session을 그대로 쓴다(읽기 전용 import).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..validation import pv_data

STEP_S = 10                 # ODE 시간 1 = 10초
STEPS_PER_CELL = 3          # 30초 cell = 10초 step 3개
TIME_SCALE_S = 1200.0       # Apple fatigue 입력: 경과초 / 1200


def activity_from_cells(cell_speed, cell_grade) -> np.ndarray:
    """cell 평균 (속도 v̄, 경사 ḡ%) → Apple activity (v̄, v̄·sin(atan(ḡ/100))). float32 [n, 2]."""
    v = np.asarray(cell_speed, np.float64)
    g = np.asarray(cell_grade, np.float64)
    return np.stack([v, v * np.sin(np.arctan(g / 100.0))], axis=1).astype(np.float32)


def expand10(act_cells: np.ndarray) -> np.ndarray:
    """cell k의 action을 10초 step 3k−3, 3k−2, 3k−1에 그대로 둔다(zero-order hold)."""
    return np.repeat(np.asarray(act_cells, np.float32), STEPS_PER_CELL, axis=0)


def time10(n_steps: int) -> np.ndarray:
    """10초 step i의 fatigue 입력 = 10·i / 1200 (step 시작 시각)."""
    return (np.arange(n_steps, dtype=np.float64) * STEP_S / TIME_SCALE_S).astype(np.float32)


def measured_hr(df: pd.DataFrame) -> np.ndarray:
    """채점 정답 행: HR 유효 + hr_is_filled == False (NaN flag는 filled로 본다)."""
    hr_ok, _, _ = pv_data.valid_masks(df)
    filled = df.hr_is_filled.astype(object).fillna(True).to_numpy(bool)
    return hr_ok & ~filled


def targets10(df: pd.DataFrame, n_cell: int) -> np.ndarray:
    """10초 점 j = 1..3·n_cell의 정답 = row 2j 실측 HR, 아니면 NaN. float32."""
    rows = 2 * np.arange(1, STEPS_PER_CELL * n_cell + 1)
    hr = df.hr_bpm.to_numpy(np.float64)
    return np.where(measured_hr(df)[rows], hr[rows], np.nan).astype(np.float32)

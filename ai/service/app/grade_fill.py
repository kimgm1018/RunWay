"""Retry excluded support sessions with invalid grades treated as flat."""
from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.models.ode.validation import pv_data


@dataclass(frozen=True)
class GradeFillInfo:
    filled: bool
    rows: int
    missing_rows: int


def prepare_with_grade_fallback(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict | str, GradeFillInfo]:
    prepared = pv_data.prepare_session(frame)
    invalid = (~np.isfinite(frame.grade_observed_pct.to_numpy(dtype=float, na_value=np.nan))
               | ~frame.grade_quality.isin(pv_data.QUALITY_ALLOWED).to_numpy())
    info = GradeFillInfo(filled=False, rows=len(frame), missing_rows=int(invalid.sum()))
    if isinstance(prepared, dict):
        return frame, prepared, info

    filled_frame = frame.copy()
    filled_frame.loc[invalid, "grade_observed_pct"] = 0.0
    filled_frame.loc[invalid, "grade_quality"] = "LOW"
    filled_prepared = pv_data.prepare_session(filled_frame)
    if isinstance(filled_prepared, dict):
        return filled_frame, filled_prepared, GradeFillInfo(True, info.rows, info.missing_rows)
    return frame, prepared, info

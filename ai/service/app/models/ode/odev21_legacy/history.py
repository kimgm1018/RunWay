"""Apple history 입력 (CONTRACT 3.3절, Apple prepare_history · 감사 #4 _history_from_prior와 같은 꼴)."""
from __future__ import annotations

from dataclasses import dataclass
import datetime as dt

import numpy as np
import pandas as pd

from .cells import measured_hr
from ..validation import pv_data

HISTORY_LIMIT = 512
HISTORY_DIM = 5
SENTINEL = np.full((1, HISTORY_DIM), -1.0, np.float32)      # Apple: 과거 workout이 없으면 −1로 채운 (1, 5)
HR_CENTER, HR_SCALE = 142.0, 22.0


@dataclass(frozen=True)
class PastSession:
    start: dt.datetime
    end: dt.datetime
    rows: np.ndarray            # [m, 4] = (HR norm, elapsed/1200, speed, speed_v). 간격 채널은 쓸 때 붙인다
    session_id: str = ''


def session_history_rows(df: pd.DataFrame) -> np.ndarray:
    """세션 전체 행 중 elapsed가 10초 배수이고 HR(실측)·speed·grade가 모두 유효한 행. float32 [m, 4]."""
    _, sp_ok, gr_ok = pv_data.valid_masks(df)
    el = df.elapsed_s.to_numpy(np.float64)
    keep = measured_hr(df) & sp_ok & gr_ok & (np.mod(el, 10.0) == 0.0)
    hr = df.hr_bpm.to_numpy(np.float64)[keep]
    v = df.speed_mps.to_numpy(np.float64)[keep]
    g = df.grade_observed_pct.to_numpy(np.float64)[keep]
    return np.column_stack(((hr - HR_CENTER) / HR_SCALE, el[keep] / 1200.0, v,
                            v * np.sin(np.arctan(g / 100.0)))).astype(np.float32)


def build_history(prior, target_start, limit: int = HISTORY_LIMIT) -> np.ndarray:
    """시작·끝이 모두 target_start 이전인 세션을 최근 것부터 모아 최근 limit행. 순서는 과거 → 최근. float32 [h, 5]."""
    usable = sorted((p for p in prior if p.start < target_start and p.end <= target_start),
                    key=lambda p: (p.start, p.session_id))
    blocks, remaining = [], limit
    for p in reversed(usable):
        if len(p.rows) == 0:
            continue
        gap_days = (target_start - p.start).total_seconds() / 86400.0
        block = np.column_stack((p.rows, np.full(len(p.rows), np.log1p(gap_days), np.float32)))
        used = block[-remaining:]
        blocks.append(used)
        remaining -= len(used)
        if remaining <= 0:
            break
    return np.concatenate(blocks[::-1]).astype(np.float32) if blocks else SENTINEL.copy()
